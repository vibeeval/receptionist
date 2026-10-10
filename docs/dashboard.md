# Yerel yönetim paneli

Bu dal Apache-2.0 23a691e üzerine kurulmuştur. UI Türkçe, bağımlılıksız HTML/CSS/JavaScript; sunucu Node22 ve mevcut Engine/AsyncStore'dur. Retell dashboard'u değildir. Public deployment yoktur.

## Sentetik demo

```sh
npm ci --ignore-scripts
npm run dashboard:demo
```

http://127.0.0.1:8788 adresini açın. Demo kullanıcıları `admin`, `operator`, `viewer`; yalnız bu geçici demo için herkese açık parola `demo-local-only-2026`. Gerçek kuruluma bu kullanıcıları taşımayın. Demo ayrı geçici SQLite DB'de Engine üzerinden bir sentetik çağrı/rezervasyon oluşturur; dış ağ guard ile kapalıdır. Ctrl-C/SIGTERM geçici dosyaları siler. Çökme durumunda OS temp dizinindeki demo dosyaları kalabilir; gerçek veri girmeyin. `ADMIN_PORT` ile farklı localhost port seçilebilir.

## Mevcut backend'e bağlama

`npm run start:local` varsayılan olarak panel açmaz. Yetkili yerel operatör aşağıdakileri hazırlar:

- `ADMIN_ENABLED=true`, `ADMIN_PORT=8788`.
- `ADMIN_USERS_PATH`: owner-only (`0600`) mutlak JSON yolu; username, scrypt passwordHash ve tenant→rol eşleştirmeleri. `src/admin/auth.ts` içindeki `passwordHash` salt:scrypt türetimini kullanır. Kullanıcı/provisioning web ekranı yoktur; gerçek kullanıcı oluşturma bu teslimde yapılmadı.
- `ADMIN_DB_PATH`: core/provider DB'lerinden ayrı, mutlak, özel SQLite dosyası. Güvenilir owner-only dizin zorunludur; symlink/hardlink ve grup/diğer erişimli dosyalar reddedilir. Bu dosya bağlantı kasası, taslaklar ve admin audit içerir.
- `ADMIN_ENCRYPTION_KEY`: secret manager'dan 32 byte anahtarın 64 hex gösterimi. Anahtarın güvenli yedeği olmadan kasa kurtarılamaz; değişiklik otomatik rotation değildir. Yanlış anahtarla açılış reddedilir.

Kullanıcı kaydı biçimi (parola hash'i yer tutucudur, çalışmaz):

```json
[{"username":"owner","passwordHash":"VALID_SALT_AND_SCRYPT_HASH","tenants":{"your-tenant":"admin"}}]
```

Roller: viewer yalnız okur; operator ayrıca kabulü durdurur/açar; admin ayrıca taslak, gizli bağlantı değerleri ve yerel bütçe sınırı yazar. Tenant listesi yalnız sunucu config'inden gelir. Yeni tenant/provider account eklemek, auth config değiştirmek, OAuth grant oluşturmak veya public erişim bu UI'da yoktur.

Panel yalnız `127.0.0.1` dinler. Exact Host/Origin doğrulaması vardır. Public reverse proxy'ye veya başka bilgisayarlara açmayın. Session cookie HTTP localhost için HttpOnly/SameSite=Strict'tir; Secure değildir. Public sürüm için TLS, Secure cookie, kullanıcı yaşam döngüsü/MFA ve deployment incelemesi gerekir. Panel oturumları process-localdır; birden fazla dashboard instance desteklenmez. Core store SQLite veya PostgreSQL olabilir; admin SQLite yereldir. PostgreSQL yönetim API parity bu dalda ayrıca test edilmedi.

## Çalışan / bilinçli olarak etkin olmayan alanlar

- Genel bakış, çağrılar, randevular, DLQ ve audit gerçek core DB'den tenant filtresiyle okunur. En yeni 100 kayıt; pagination/export yoktur. Transcript, müşteri telefonu, provider receipt veya raw payload döndürülmez.
- Yerel bütçe cap'i aynı core transaction'ında revision kontrolü ve audit ile uygulanır. `dashboard_limits` tablosu override'ı tutar; panel etkin açılışta yapılandırma cap'inin üzerine yeniden uygular. Panel devre dışı başlatılırsa core config cap'i tekrar geçerlidir. Birden çok worker/instance için ortak startup/limit politikası ayrıca kabul edilmeli. Adet sınırı config'den salt okunurdur.
- Durdur/devam et mevcut Engine operator/HMAC ve revision/idempotency yolunu kullanır. Başlamış aramayı veya gerçek provider faturasını durdurmaz.
- İşletme/saat formu revision kontrollü **taslak** kaydeder; mevcut slotlar/aktif configuration değişmez. Güvenli uygulama/migration ve etkinleştirme akışı henüz yoktur.
- API anahtarı alanları write-only'dir. Sunucu AES-256-GCM ile tenant+kind AAD kullanarak saklar; browser response yalnız stored/updated/verified:false/active:false döndürür. Kayıt provider'a gönderilmez, otomatik doğrulanmaz veya runtime'a uygulanmaz. Kasanın runtime secret resolver'ına kontrollü bağlanması sonraki adımdır. UI'da gerçek anahtar kullanılmadı; testler dummy değerlerle yapıldı.
- Retell gerçek fatura, bakiye, dakika veya ses performansı verisi bağlı değildir. Ekran bunları sıfır/sahte başarı gibi göstermez.
- Replay, gerçek provider testleri, telefon satın alma, canlıya alma ve deployment düğmesi yoktur.

## Güvenlik ve doğrulama

Session idle15 dakika/absolute8 saat; logout iptal eder. Parolalar scrypt hash, login rate limit10/5dk; global600/dk, kullanıcı240/dk ve secret10/dk sınırı. State changing API JSON + exact Origin + CSRF ister; tenant/role sunucuda kontrol edilir. CSP inline script/harici içerik ve frame'i kapatır; mikrofon/kamera/geolocation yasaktır. Sırlar log veya localStorage'a yazılmaz. Yerel yönetici/OS hesabı veya zararlı aynı-origin kod karşısında izolasyon garantisi verilmez.

```sh
npm run test:admin
npm test
node --check public/dashboard/app.js
```

Mac kilitli olduğu için gerçek tarayıcı görsel/klavye/mobile QA yapılmadı; kilidi aşan yöntem kullanılmadı. HTTP testleri browser render doğrulaması değildir. Bağımsız güvenlik/API ve görsel inceleme bekler.

Manuel kabul: demo login; her sayfanın boş/verili/hata durumu; mobil yatay taşma ve tab focus; viewer/operator engelleri; dummy anahtarı kaydedip yeniden açmada raw değer bulunmaması; taslak etkin değil açıklaması; bütçe ve stop/resume revision çakışması; logout sonrası geri/yenilemede veri erişimi olmaması.

Yerel admin regresyon paketi `tests/admin` altında 24 sentetik test içerir. Özel inceleme notları kaynak yedeğine dahil edilmedi.
