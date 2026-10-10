# Tehdit modeli

Varsayılan tek instance/işletme, loopback local. Çok tenant yalnız izolasyon savunmasını sınar; SaaS paneli yok. İnternete doğrudan açılmak için hazır değildir.

Güven sınırı: ham bayt → scoped HMAC → strict schema → domain → transactional SQLite → ayrı fake provider DB. Provider sonucu request bayrağından türetilmez. ports.ts dar calendar/CRM sözleşmesidir; request adapter seçemez.

| Tehdit | Kontrol ve sınır |
|---|---|
| Sahte webhook | Exact path/method/raw-body HMAC; gerçek provider doğrulaması henüz yok |
| Tenant/role sıçrama | Ayrı anahtarlar, trusted route, composite tenant keys |
| Replay | Durable inbox hash, stable command, idempotent fake provider |
| Slot race | BEGIN IMMEDIATE içinde interval kontrolü/rezervasyon; farklı ID overlap da engellenir |
| Crash/timeout | Önce attempted; lease expiry unknown; authoritative lookup; unknown'da otomatik rebook yok |
| Control injection | Strict enum/payload; serbest URL/SQL/prompt tool'u yok; operator teyidi ayrı |
| PII | Unknown alan reddi, telefon minimizasyonu, server correlation, audit hash |
| Maliyet | Atomik reserve/spent, kalıcı cap, attempt/lifetime command quota; gerçek telefon dakika sayacı değil |
| DB sahibi | Append-only trigger owner saldırısına karşı WORM/tamper-proof değildir |

İş akışı: inbox/job → event state → operator confirmation → atomic command/slot/budget → lease → attempted → fake provider → confirmed+CRM outbox. CRM retry booking'i tekrarlamaz. Unknown DLQ slot/bütçeyi bırakmaz. Belirsiz sonucu eski diye no-effect saymak yasaktır.

SQLite WAL, synchronous=FULL, foreign keys, kısa transaction ve 10 sn busy timeout kullanır. DB 0600 açılır; host disk şifrelemesi ayrı konudur. Network filesystem/çok host cluster desteklenmez. 100 duplicate/20 booking yarışı OS süreçlerinde ayrıca sınanır.

Canlı engeller: telephony/session auth, provider contract, caller confirmation, PostgreSQL adapter, TLS/proxy, retention/delete, backup/restore, insan fallback ve gerçek dakika/bütçe sınırları. DLQ'da komutu SQL ile silip yeniden booking yapmak desteklenen recovery değildir. Audit'li operator replay aracı henüz yoktur.
