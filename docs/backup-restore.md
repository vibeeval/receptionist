# Yedekleme ve geri yükleme reçetesi

Bu bakım reçetesi otomatik production backup ürünü değildir. Yerel sentetik SQLite/PG restore ve WAL testleri çalıştırıldı; gerçek müşteri DB, encryption key restore, offsite saklama ve production RPO/RTO kabulü yapılmadı. Komutları yalnız yetkili bakım penceresinde ve bağımsız hedefte kullanın.

## Ortak hazırlık

1. Routing/ingress'i kapatın, bütün worker/instance'ları [temiz durdurun](deployment-runbook.md). Aktif monitor/refresh/unknown işleri ve son confirmed receipt'leri salt okunur envanterleyin. Saat ve uygulama sürümünü kaydedin; son snapshot sonrası provider yan etkilerinin listesi restore için gerekecek.
2. `umask 077`; yeni, erişimi sınırlı bir backup dizini oluşturun. Core DB, onaylı core/composition config ve sürüm manifesti beraber kayıt altına alınır. Google encrypted grant DB içindedir; encryption key, OAuth client secret, core/Retell/CRM anahtarları **ayrı** secret backup politikasında saklanır. Runtime environment'daki eski bootstrap refresh token DB'deki rotated grantın yerine geçmez.
3. Yedekleri onaylı şifreli/offsite depoya taşıma, erişim logları, retention, günlük/haftalık periyot ve restore tatbikatı sahibi tanımlanır. Bunlar paket tarafından sağlanmaz. Şifresiz DB dosyasını paylaşmayın. [SQLite backup API](https://sqlite.org/backup.html) tek DB'nin tutarlı kopyasını sağlar; farklı DB/provider işlemlerini ortak transaction yapmaz.

## SQLite

Eski Python `mode=ro` reçetesi kaldırıldı: doğrulanan macOS Python/SQLite kombinasyonunda normal kapatılmış, WAL header'ı olan fakat WAL/SHM yan dosyası olmayan kaynak `unable to open database file` veriyor ve hedef0 bayt kalıyordu. Kaynak bozulması değildir; salt-okunur WAL/VFS açma davranışıdır. `immutable=1` ile bunu genel olarak atlamayın: açık WAL'deki commit'ler göz ardı edilebilir.

Yeni bağımsız bakım komutu **Node >=22.16 <23** ister (22.23.2 ile test edildi; uygulamanın temel minimumundan daha yenidir). Node SQLite backup API'sini salt-okunur kaynak bağlantısıyla kullanır. CORE_DB mevcut DB yolu, BACKUP_DB mevcut olmayan yeni dosya yolu olarak güvenli shell'de atanır; hedefin parent dizini önceden var ve güvenilir/özel olmalıdır.

```sh
npm run build
node dist/scripts/sqlite-backup.js "$CORE_DB" "$BACKUP_DB"
```

Komut hedefin bulunduğu dosya sisteminde0700 özel geçici dizin oluşturur. Backup'a ait dosyayı0600 yapar, sıfır sayfa/boş çıktıyı reddeder, hedef kopyayı standalone DELETE-journal biçimine getirir ve `integrity_check` doğrular. Dosyayı fsync eder; atomic hard-link ile yeni hedefi oluşturur, dizini fsync eder. `EEXIST` halinde hiçbir mevcut hedefi değiştirmez; ön kontrol ile oluşturma arasına giren başka işlem de korunur. Hard-link desteklemeyen dosya sisteminde başarısız olur; overwrite yapan fallback yoktur. [Node SQLite backup API](https://nodejs.org/api/sqlite.html#sqlitebackupsource-db-path-options) mevcut dosyayı kendi başına overwrite edebildiğinden doğrudan son hedefe çağrılmaz.

Başarı yalnız exit0 ve `backupComplete:true, integrity:ok, overwritten:false` çıktısıdır. Normal hata durumunda geçici dosyalar temizlenir; final hedef yayımlanmadan önceki hatalar0 bayt final backup bırakmaz. Link sonrası dizin fsync hatasında doğrulanmış hedef kalabilir ama başarı raporlanmaz: hedefi inceleyin, yeni bir adla tekrar deneyin; silip üzerine yazmayın. SIGKILL/power loss normal cleanup çalıştırmaz; özel staging dizini kalabilir. Tüm backup süreçleri durduktan sonra yalnız bu işlemin kendi staging dizinini inceleyerek temizleyin. Power-loss dayanıklılığı yerel dosya sistemi/offsite restore kabulünün yerine geçmez.

**Cold bakım modu:** tüm instance'ları durdurup komutu çalıştırın. WAL/SHM yan dosyası olmadan kapanmış Node WAL kaynağı, gerçek sentetik core/fake-provider dosyaları ve cold backup'tan yeni restore test edildi. Kaynak ana dosyası değişmedi. Restore için aynı komutta backup'ı kaynak, ayrı yeni core dosyasını hedef seçin; eski DB/WAL/SHM dizinini olduğu gibi koruyun.

**Açık WAL snapshot'ı:** aynı komut çalışan SQLite bağlantısından tek DB'nin tutarlı snapshot'ını alabilir. Ayrı OS sürecinde açık writer, WAL'de commit edilmiş iki eş değer satır ve açık commit edilmemiş transaction ile test edildi: backup commit edilmiş durumu içerdi, yarım transaction'ı içermedi. Bu test sürekli yüksek yazma yükü veya sınırsız bekleme altında SLA kanıtı değildir. Backup sırasında yeni yazılar kopyalamayı yeniden başlatabilir; bakım penceresinde yazmaları durdurmak önerilir. Bu tek DB garantisi, core/fake-provider veya gerçek Google arasında ortak snapshot garantisi değildir.

Canlı WAL dosyasını atıp yalnız ana dosyayı düz kopyalamayın. Yerel fake-provider demosu için her iki DB'yi aynı kapalı pencerede ayrı hedeflere alın. Live Google takvimi yerel fake DB'de değildir. Restore sonrası yeni config yolunu seçmeden önce commands/reservations/confirmations/idempotency içeriklerini snapshot envanteriyle karşılaştırın; secret/payload loglamayın. Aşağıdaki provider reconciliation kapısı hâlâ geçerlidir.

## PostgreSQL

Onaylı TLS bağlantısı, gereken dump/restore yetkileri ve uyumlu PG istemcileri operatörce hazırlanır. Parolayı argv yerine0600 PGPASSFILE/secret manager ile verin; PGHOST/PGPORT/PGUSER/PGDATABASE ve CA doğrulamasını güvenli environment'da ayarlayın. Runtime superuser kullanmayın; bu uygulama başlangıç migration'ları için kendi şemasında DDL yetkisi ister. TLS/role reçetesi production ortamında bu teslimde test edilmedi.

Kapalı bakım penceresinde, seçili uygulama şemasını yeni dosyaya:

```sh
pg_dump --format=custom --no-owner --no-acl --schema="$APP_SCHEMA" --file="$BACKUP_DUMP"
pg_restore --list "$BACKUP_DUMP" > "$BACKUP_DUMP.contents"
```

PGDATABASE dump sırasında kaynak DB'dir. Restore için operatör **yeni, boş, izole test/restore DB** oluşturup PGDATABASE'i o hedefe değiştirir; schema adı config ile aynı korunur, gerekli owner/grant'lar operatör tarafından atanır:

```sh
pg_restore --exit-on-error --no-owner --no-acl --dbname="$PGDATABASE" "$BACKUP_DUMP"
```

Hedefte existing tablo varsa durun; `--clean` veya `DROP SCHEMA` ile müşteri verisi silmeyin. Bu flags'lerin tamamını içeren production reçetesi uygulanmadı; test suite'i sentetik cluster'da custom-format dump/restore'u doğruluyor. Restore'u kabul etmek için migration checksum'ları, tenant/mapping, row counts, commands/receipts ve constraint'ler karşılaştırılır. Global roles/tablespaces bu schema dump'ında yok; operatör bunları ayrıca yönetir. [PostgreSQL SQL dump/restore](https://www.postgresql.org/docs/current/backup-dump.html).

## Restore sonrası kritik kapı

Restore edilen DB, snapshot sonrası gerçekleşmiş provider booking'leri veya refresh-token rotation'ını bilemez. Provider'daki son yan etkilerle uzlaşmadan, eski grantı geçerli varsaymadan veya provider kayıtlarını silmeden worker/routing açmayın. Restore edilmiş eski refresh token için bilinmeyen rotation varsa kullanıcıdan yeni grant alıp [açık geçişi](upgrade-guide.md) uygulayın. Snapshot sonrası eksik command/receipt'ler için manuel reconciliation/migration gerekir; otomatik genel restore reconciler yoktur. Replay/duplicate testinin geçmesi kaybolmuş son işlemleri geri getirmez.

Eski backup silinmiş kişisel payloadları geri getirebilir. Harici retention high-water mark yok; onaylı policy ve tekrar silme incelemesi tamamlanmalı. Key kaybı veya belirsiz provider durumu varsa fail closed kalın. Private health/readiness kontrolünü, yalnız onaylı sentetik pilotu ve sahibi imzalı restore kabulünü geçmeden canlı routing açmayın.

Tekrarlanabilir testler: `npm run build`; `node --test dist/tests/sqlite-backup.test.js`;  `node --test --test-name-pattern='restored backup' dist/tests/retention.test.js`; `npm run test:postgres:local -- /absolute/verified/postgres/prefix`. Sonuncusu sadece kendi disposable loopback cluster'ını oluşturur/siler; production bağlantı bilgisi verilmez.
