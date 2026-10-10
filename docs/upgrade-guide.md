# Güvenli yükseltme ve eski veri geçişi

Genel müşteri DB migration/rollback aracı yoktur. Aşağıdaki operatör reçetesi otomatik veri silme yapmaz. Yerel sentetik testler geçiş korumalarını sınar; gerçek grant veya müşteri DB geçişi bu teslimde yapılmadı.

1. Mevcut sürüm, config, manifest ve secret sürümlerini kaydedin; [backup/restore](backup-restore.md) tatbikatını bağımsız kopyada doğrulayın. Routing kapalı ve bütün instance'lar durmuş olsun. Aktif refresh intent veya unknown provider sonucu varsa önce uzlaştırın; pending state alanını elle değiştirmeyin.
2. Yeni kaynak paketini **ayrı dizine** açın. `npm ci --ignore-scripts`, `npm run check:source`, `npm test`, `npm run demo:autonomous`. Eski node_modules/dist kopyalanmaz. Aynı DB'ye eski ve yeni sürümün karışık çalışması bu teslimde kabul edilmedi.
3. Config mapping/tenant/calendar/schedule değişikliklerini sürüm yükseltmesine gizlemeyin. Mapping mismatch otomatik migration başlatmaz; ayrı incelenmiş dönüşüm gerekir. Restore kopyasında deneme startup'ı gerçek provider istekleri yapabilir; gerçek credentials/network ile “kuru test” sanmayın. Offline source testleri ayrı fixture kullanır.

## Legacy Google grant

Eski encrypted kayıtta client binding yoksa `OAUTH_CLIENT_BINDING_REQUIRED`; aynı environment referansının gerçek client ID değeri değişmişse `OAUTH_CLIENT_BINDING_MISMATCH` beklenir. İstemciyi tahmin ederek bind etmeyin. Grantı/DB'yi silmeyin veya env bootstrap tokenıyla zorla üzerine yazmayın.

Tüm instance'lar durmuşken yetkili kullanıcı [Google akışıyla](provider-setup.md) **onaylı doğru client ve iki scope** için replacement refresh grant alır. Mevcut encryption key korunur; yeni grant aynı güvenli refreshTokenRef'e yerleştirilir. CONFIG_JSON_PATH ve COMPOSITION_JSON_PATH doğru mevcut DB/config'i göstermeli:

```sh
npm run google:reauthorize
```

Bu explicit yerel CLI Google'a bağlanmaz, consent yapmaz, grantı yazdırmaz. Encrypted replacement ve client binding oluşturur; CLI sentetik testle doğrulandı. Aktif refresh intent varsa reddeder; intenti atlayıp iki process'i yarıştırmayın. Key kaybolduysa mevcut grant çözülemez; ayrı restore/yeni grant planı gerekir. Key rotasyonu otomatik re-encryption değildir.

## Önceden eklenmiş demo slotları

Yeni sürüm mevcut DB'ye demo seed eklemez. Ancak eski açılışın eklediği satırlar varsa `UNEXPECTED_COMPOSITION_SLOT` ile durabilir. Salt okunur inceleme örneği:

```sql
SELECT tenant,id,resource,start_ms,end_ms,service
FROM slots
WHERE id IN ('slot-1','slot-2','slot-overlap')
ORDER BY tenant,id;
```

İsim tek başına silme izni değildir. Config envanteri ve booking/reservation/confirmation referanslarıyla karşılaştırın; gerçekten fixture olduklarını sahibi doğrulasın. Müşteri tarafından aynı isimle oluşturulmuş veya kullanılmış satırları silmeyin. Referanslı geçmiş kayıtlar varsa tarihçeyi koruyan özel migration tasarlanır. Bu pakette otomatik DELETE komutu yok; onaylı exact-row değişikliği önce backup kopyasında test edilir, satır sayısı ve hashleri inceleme kaydına alınır. Boş DB yaratmak müşteri geçmişi migration'ının yerine geçmez.

## Açılış ve geri dönüş

Planlanmış değişiklikler sonrası private health/readiness, approved config/slots ve tek onaylı sentetik uçtan uca kabulü doğrulayın; en son routing açılır. Migration checksum veya schema uyumsuzluğu varsa dosya/checksum değerini değiştirerek bypass etmeyin. Rollback için uyumlu eski kaynak+config gerekir; DB'yi körlemesine downgrade etmeyin. Son backup'tan sonra provider işlemi/rotation olduysa restore tek başına güvenli rollback değildir; reconciliation kapısı uygulanır. Başarısız startup mevcut profile/mapping'i silerek “düzeltilmez”.
