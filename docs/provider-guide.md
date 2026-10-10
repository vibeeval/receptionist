# Sağlayıcıya geçiş rehberi

Çalışan profil yalnız `FakeProvider`'dır. Ayrı disk veritabanına yazar, ağ isteği yapmaz ve yanıtları `providerMock: true` taşır. `CalendarPort` ve `CrmPort` sınırları hazırdır; gerçek telefon, konuşma, takvim ve CRM adaptörü henüz yoktur. Yerel HMAC protokolü herhangi bir sağlayıcının gerçek webhook imza şeması olduğunu iddia etmez.

İlk canlı aday: Retell + mevcut Türkiye operatörünün +90 numarası/SIP trunk'ı + bu kontrollü backend. Bu bir değerlendirme adayıdır; Türkçe kalite, numara kullanılabilirliği, arama yönleri ve ticari koşullar doğrulanmadı. Tek adayın kabul testi bitmeden paralel sağlayıcı uygulamaları eklenmemelidir. ElevenLabs gerekirse ayrı Türkçe kalite karşılaştırmasında değerlendirilir.

1. İşletmenin kendi sağlayıcı hesabı, numara kullanım hakkı ve onaylı sesi kullanılır. Hesap açma, numara satın alma ve gerçek arama ayrı izin gerektirir.
2. Sağlayıcının güncel resmi imza doğrulaması ham gövde üzerinden uygulanır. Proxy davranışı, tekrar teslim, zaman toleransı ve session/tool kimliği test edilir. Payload içindeki tenant/approved gibi alanlara güvenilmez.
3. Takvim adapter'ı yalnız sunucunun verdiği slot kimliğini kabul eder. `book` idempotency anahtarı ve `lookup` gerekir. Eventual consistency kaynaklı bulunamadı sonucu kesin `absent` değildir; `unknown` kalmalıdır.
4. Test hesabı/takviminde bildirimler kapatılır. Gerçek kişilere SMS/e-posta gönderilmez. İnsana aktarma hedefi işletme tarafından doğrulanır; başarısız aktarım için geri arama kuyruğu ve mesai dışı yanıt tanımlanır.
5. Onaylı bütçe, maksimum çağrı süresi, eşzamanlılık, sağlayıcı harcama alarmı, veri saklama ve acil durdurma doğrulanmadan canlı trafik açılmaz.

Önerilen kalite kabulü: önceden tanımlı en az 100 Türkçe test çağrısında görev başarısı ≥%95, kritik isim/tarih/saat doğruluğu ≥%98, kritik güvenlik ihlali sıfır; yanıt gecikmesi p50 ≤1 sn/p95 ≤1,8 sn ve söz kesmeye tepki ≤500 ms hedeflenir. Bunlar ölçülmüş sonuç veya SLA değildir. Aksan, gürültü, sessizlik, yanlış numara, mükerrer webhook, meşgul transfer, kesilen bağlantı ve acil durum senaryoları dahildir.

Retell simülasyonunda mock yapılmayan araçlar gerçek sisteme gidebilir; MCP araçları mock ayarlarını yok sayabilir. Bu nedenle bu repodaki offline demo ile sağlayıcı simülasyonu eşdeğer değildir. [Resmi simülasyon rehberi](https://docs.retellai.com/test/llm-simulation-testing). Vapi transcriber fallback başka sağlayıcıya ses aktarabilir; veri akışı ayrıca onaylanmalıdır. [Fallback rehberi](https://docs.vapi.ai/customization/transcriber-fallback-plan).

n8n isteğe bağlı orkestrasyon katmanıdır; çekirdek onsuz çalışır. n8n runtime'ı dağıtıma dahil edilmez.
