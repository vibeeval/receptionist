# Maliyet ve veri saklama

Kodun ücretsiz dağıtılması telefon, numara, model, konuşma ve barındırma hizmetlerini ücretsiz yapmaz. Gerçek maliyet: numara aylığı + çağrının bütün telefon bacakları + ses/konuşma/model kullanımı + takvim/CRM + barındırma/yedekleme + vergi. Canlı test öncesi seçilen hesap ve bölgenin güncel tarifesiyle yazılı maksimum toplam maliyet çıkarılmalıdır; bu aşamada canlı test maliyeti hesaplanmadı ve canlı test yapılmadı.

Yerel `commandCostMicros` ve tenant bütçesi sentetik booking muhasebesidir; gerçek telefon harcamasını sınırlamaz. `maxCalls` adı mevcut API'de yaşam boyu kabul edilen booking komutu kotasıdır, telefon çağrısı sayacı veya aylık reset değildir. Başarısız kesin sonuç rezervi bırakır; belirsiz sonuç bütçe/slotu tutar. Sağlayıcı limitleri, eşzamanlılık ve harcama alarmları canlı adaptörün kabul kapısıdır.

Ham webhook gövdesi ve telefon numarası log/DB'ye yazılmaz. Ancak çağrı kimliği, güvenli intent özeti, komut kimliği ve hash'ler kalıcıdır; bunlar anonim veri sayılmaz. SQL audit append-only trigger'ı DB yöneticisine karşı WORM güvencesi sağlamaz. Dosya izinleri erişimi azaltır; disk şifrelemesi ve anahtar yönetiminin yerine geçmez.

Kalıcı servis için otomatik TTL, silme işi, veri sahibi erişim/silme akışı ve doğrulanmış backup/restore henüz yoktur. SQLite verisi açıkça silinene kadar saklanır. Demo/test geçici verisini temizler. Gerçek müşteri verisi kullanımı bu eksikler kapanana kadar kabul dışıdır.

Canlıya geçişte işletme her veri kategorisi için amaç, sahip, azami süre, silme yöntemi ve yedeklerin silinme süresini kaydetmelidir. Sağlayıcının ses/transcript saklama ayarı, alt işleyenler ve ülke dışı aktarım incelenir; KVKK değerlendirmesi işletmenin yetkili danışmanıyla yapılır. Ses kaydı varsayılan kapalı tutulmalı, gerekiyorsa açıklama ve hukuki dayanak ayrıca belirlenmelidir. Operatör attestation alanı gerçek telefon anonsunun kanıtı değildir. Müşteri kaydı, klonlanmış ses veya müşteri anahtarları repoya konmaz.
