# Sentetik API

Adaptör `synthetic-hmac-v1`. Twilio, Retell veya ElevenLabs imza algoritması değildir. HMAC-SHA256 girdisi `timestamp + newline + HTTP_METHOD + newline + exact_path + newline + raw_body`. Header'lar x-timestamp Unix saniyesi ve lowercase hex x-signature. Boş GET de imzalanır. Parse öncesi timing-safe kontrol ve ±300 sn freshness uygulanır. Route trusted tenant'a eşlenir; JSON tenant seçemez.

| Endpoint | Rol | Davranış |
|---|---|---|
| GET /health | Yok | local/mock durumu |
| POST /v1/tenants/{route}/events | event | Inbox+job+audit commit sonrası 200; duplicate 200, hash conflict 409 |
| GET .../knowledge | tool | Kurgusal sürümlü bilgi |
| GET .../slots | tool | Tenant'ın yapılandırılmış müsait slotları; boş envanter mümkündür |
| GET .../calls/{id} | tool | Dar çağrı durumu |
| POST .../confirmations | operator | callId, slotId, attested:true, evidenceId; sunucu confirmationId üretir |
| POST .../bookings | tool | commandId, callId, slotId, confirmationId; atomik rezervasyon, 202 pending |
| GET .../bookings/{id} | tool | state ve sadece confirmed ise bookingId |
| POST .../control | operator | kill:boolean; audit'li yerel gate |

Event: `{id,callId,type,occurredAt,data}`. Türler call.started, intent.detected, call.ended, post_call. Started isteğe bağlı E.164 callerPhone alır fakat kalıcı payload/log/response'a yazmaz. Intent data `{intent,confidence}`; sonlu 0..1 confidence ve booking/information/human/transfer/emergency/opt_out enum. Ek alanlar reddedilir.

Operator teyidi event/tool credential'ından ayrıdır. Bu fazda LLM'nin tek başına teyit ilan etmesine izin verilmez. Gerçek sesli teyit/session kanıtı Faz 3'tedir; demo attestation sesli kullanıcı rızası testi değildir. Operator key voice agent'a verilmemeli.

Budget/policy server config'den gelir. Payload confidence_threshold, signature_valid, approval_status, environment, live_enabled, mock_provider_status veya test_fault içeremez. Hata yanıtında yalnız code, server correlation ve providerMock bulunur.

Kill yeni confirmation/booking ve dispatch edilmemiş booking'i durdurur. Başlamış harici isteği geri alamaz. Unknown reconciliation ve CRM tamamlaması sürer. Gerçek PBX fallback ayrı adapter gerektirir.

## Bağımsız denetim sonrası güvenlik sözleşmesi

Opt-out, human, emergency, transfer veya düşük güvenli intent kabulü inbox ile aynı transaction'da kalıcı cancellation gate yazar. ACK'den sonra ilk dispatch transaction'ına giren worker bu gate'i görür; sonraki booking intent'i gate'i kaldırmaz. Attempted/unknown işlemler önce lookup yapar. Dispatch transaction'ı önce commit etmişse çağrı başlamış kabul edilir; ACK geçmişte başlamış dış etkiyi geri alamaz.

Confirmation `evidenceId`, tenant+call kapsamında tek operatör işlemidir. Aynı içerik ilk confirmationId sonucunu döndürür; expiry yenilenmez ve consumed teyit tekrar kullanılmaz. Aynı evidenceId farklı slot/içerikle 409 döner. Yeni attestation için yeni evidenceId gerekir.

Control isteği `{kill,operationId?,expectedRevision?}`. Yeni istemci her karar için benzersiz operationId kullanmalıdır; bu alanlar imzalanan gövdededir. Yanıt revision döndürür. Aktif kill'i kaldırmak için yeni operationId ve son kill yanıtının expectedRevision değeri zorunludur. Eski istemcinin `{kill:false}` isteği aktif kill'i kaldıramaz. Bir operationId replay'i ilk sonucu döndürür, mevcut state'i yeniden uygulamaz; dönen tarihsel sonuç güncel kontrol durumu değildir. Aynı ID farklı içerik 409'dur. Eski packets için tenant-scoped exact signed-request fingerprint de kalıcı olarak saklanır.

Event/tool/operator sayaçları ayrıdır. İmzalı ve schema-valid kill:true domain rate limit'ten muaftır; teyit ve unkill operator kotasına tabidir. Bu yerel acil durdurma erişimini korur, host seviyesinde CPU/disk DoS garantisi değildir. Kill yenilemek için yeni operationId gerekir.

DB yolları normalize/realpath ile çözülür; mevcut dosyalar device/inode ile karşılaştırılır. Aynı fiziksel core/provider dosyası INVALID_CONFIG ile reddedilir, açılıştan sonra tekrar kontrol edilir. Host dosyalarını değiştirebilen aynı kullanıcı/admin düşmanına karşı filesystem sandbox güvencesi iddia edilmez; DB dizinleri güvenilir ve başka kullanıcılarca yazılamaz olmalıdır.
