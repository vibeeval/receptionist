# Sentetik yerel retention policy — synthetic-v1

Bu policy yalnız test fixture'ları içindir; hukuki saklama süresi kararı veya production purge değildir. Sunucu otomatik retention çalıştırmaz ve mevcut DB yolunu alan purge CLI yoktur. `initializeSyntheticRetention` yalnız inbox/calls/commands/provider tabloları boşken, açık fixture token ile provisioning yapar. Guard token hash'i ve policy sürümü DB'de saklanır; token rapora/loga yazılmaz. Bu guard yanlış kullanım önlemidir, DB yöneticisine karşı güvenlik sınırı değildir.

- Kuru çalışma varsayılandır; rapor yalnız candidate/protected sayıları içerir. Uygulamak için açık `apply:true` ve doğru fixture token gerekir.
- Inbox payload TTL: 24 saat. Yalnız terminal `ended` veya `opted_out` çağrısının `done` event job payload'ı `{}` ile değiştirilir. Inbox id/hash korunur; exact replay yeni iş üretmez, değişmiş replay 409 alır.
- Capability TTL: kendi expires_ms değeri + 5 dakika güvenlik payı. Yalnız aynı terminal-call koşullarında kayıt silinir. Süresi geçmemiş capability silinmez.
- Pending/attempted/unknown komut varsa payload ve capability korunur. İlgili booking/CRM job'u veya tenant'ın herhangi bir tamamlanmamış event job'u varsa purge durur. DLQ ve human-state otomatik temizlenmez; muhafazakâr bekleme bilinçlidir.
- Commands, reservations, cancellation gates, session binding, inbox hash/id, operator dedupe, confirmations, jobs ve append-only audit silinmez. Session/provider-call kimlikleri bağlantılanabilir metadata olmaya devam eder; retention tamamlandı iddiası yoktur. Bunların güvenli expiry/tombstone tasarımı üretim backlog'undadır.
- İzin verilen wall/reference clock farkı en fazla 30 saniye; son apply checkpoint'inden geriye gidiş veya bir koşuda 1 saatten fazla ileri atlama reddedilir. Dry-run checkpoint'i ilerletmez. Reference clock'un bağımsız doğruluğu operatör sorumluluğudur; otomatik NTP doğrulaması yoktur.
- Restart/restore guard, policy version ve checkpoint'i korumalıdır. Policy mismatch fail-closed. Uzun kesintide 1 saat sınırı nedeniyle bloke olmak beklenir; üretim resync/migration süreci tanımlanmadan saati veya guard'ı elle değiştirerek aşmayın.
- Transaction core store ile aynı serial lock altında çalışır. Bu küçük test datası için tam tarama uygundur; büyük veri batchleme ve purge observability henüz yoktur.

Gerçek telefon/transcript baştan intake'da strip edilir; sentetik testler payload'a PRIVATE_FIXTURE sentinel koyarak purge ve log minimizasyonunu ayrıca doğrular. Disk/WAL fiziksel silme, backup kopyalarından silme veya kriptografik erasure kanıtı yoktur. Retell/Google/carrier kayıt saklaması bu policy tarafından yönetilmez.

`npm run demo:retention` kendi geçici DB'lerini oluşturur, kuru rapor ve sentetik apply/replay sonucunu gösterir, finally ile klasörü kaldırır. Gerçek kullanıcı verisi okumaz/silmez.

Eski, purge öncesi backup restore edilirse payload/PII ve önceki clock checkpoint geri gelebilir. Harici kalıcı high-water mark yoktur. Replay hashleri tek etkiyi korur; restore sonrasında policy değerlendirmesi ve açık re-purge gerekir. Purge fiziksel disk/WAL/backup erasure değildir.
