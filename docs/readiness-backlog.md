# Tek açık işler listesi

2026-10-09. Yerel sentetik demo ücretsiz çalışır; bu durum telefon hizmetinin canlı kabulü değildir. Proje Apache-2.0 lisanslıdır; LICENSE ve bağımlılık bildirimleri eklendi, public yayın yapılmadı. Retell ve canlı doğrulama yeni talimata kadar beklemededir. SDK'nın Apache-2.0 lisansı sağlayıcı hizmet koşullarının yerine geçmez.

| Açık iş | Kapanış kanıtı / izin sınırı |
|---|---|
| Provider dalının bağımsız kabulü ve parity dalının incelemesi | Sabit b4bde332 + ayrı provider-pg-parity hash denetimi; bulguların açıkça kapatılması |
| Tek gerçek provider bağlantısına hazır sunucu composition | Composition dalında gateway mount/config ve injected Google transport kod bağlantısı, trusted mapping, raw signature ve sentetik HTTP akışı tamamlandı; bağımsız birleşik kabul ve gerçek wire doğrulaması bekler |
| Sesli akış ve güvenilir confirmation | Türkçe consent/eligibility/tekrar onay, intent ve slot bilgisinin güvenilir kaynağı; model kendi kendine authorization üretemez |
| Google Calendar gerçek adapter wiring | Composition Engine seçili Google adapter kullanır, native transport ve env secret references + reservation descriptor bağlandı; gerçek OAuth grant/token lifecycle/ACL kabulü bekler |
| Gerçek uçtan uca telefon | Numara/TR erişilebilirliği, Türkçe ses, kesinti, DTMF/insana transfer ve voicemail; fiyat/ülke/sağlayıcı güncel teklifleri ve açık izin olmadan çalıştırılmayacak |
| Canlı takvim doğrulaması | OAuth grant, ACL, duplicate/timeout reconciliation, diğer calendar yazarlarıyla çakışma; hesap ve gerçek veri erişim izni gerektirir |
| Production veritabanı | Test-only loopback sınırının kontrollü değiştirilmesi; role/TLS/pool/ölçek testleri, gerçek upgrade/rollback ve SQLite→PG veri göçü |
| Kapsamlı backup/restore | Bu dal sentetik provider şemasını pg_dump/pg_restore ile doğrular. Tüm uygulama + provider state tutarlı snapshot, şifreleme, RPO/RTO, offsite ve felaket tatbikatı açık |
| Retention | Session/capability TTL temizliği, çağrı transcript/telefon consent-saklama politikası, tombstone/idempotency koruması, KVKK hukuk incelemesi; sentetik TTL/dry-run/purge/replay/clock/restart/restore testleri retention-ops dalında tamamlandı; gerçek veri ve tombstone expiry kabulü açık |
| Operasyon | Health/readiness, metrics/alerting, DLQ runbook, secret rotation, rate limits, worker ölümü ve queue yaşlanması, restore sonrası güvenli yeniden açılma; yerel health/readiness, redacted log/alarm fixture ve graceful shutdown retention-ops dalında test edildi; merkezi alarm ve production işletimi açık |
| Maliyet sınırları | Provider tarafı hard cap/telefon dakika budget ve fatura mutabakatı; mevcut local synthetic rezerv bütçesi gerçek faturayı durdurma kanıtı değildir |
| Nihai ücretsiz paket/demo | Temiz offline npm ci, fake booking demo ve geçici fixture retention demo geçer. Composition dalında tek komut offline smoke, gateway HTTP demo ve tarihten bağımsız fixture var; cache paketleme ve son kullanıcı kabulü bekler |
| Proje lisansı/yayın | Apache-2.0 seçimi tamamlandı; bağımlılık inceleme kapsamı dependency-license-review.json içinde. Gerçek hizmet koşulları, public yayın/deploy ve canlı doğrulama ayrıca yetki bekler |
| Piyasa araştırması | Kullanıcıdan gelecek araştırmanın kapsam, fiyat, hedef müşteri ve Türkiye varsayımlarıyla eşleştirilmesi |

Gerçek provider API/OAuth/key/telefon/SMS/email testleri NOT_RUN. Ücret ve izin ihtiyacı kesin güncel sağlayıcı teklifiyle belirlenmeden ücretli doğrulama başlatılmaz.
