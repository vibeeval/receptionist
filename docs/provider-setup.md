# Kullanıcının Google ve Retell hesaplarıyla kurulum

Resmi belgeler2026-10-09 tarihinde okundu. Aşağıdaki gerçek hesap, izin, import/publish ve network adımları **bu teslimde çalıştırılmadı**. Hesap sahipleri onaylı test takvimi/numaraları ve bütçeyi belirledikten sonra uygular. Paket otomatik hesap veya OAuth consent sunucusu oluşturmaz.

## Google grant

1. Kullanıcının Google Cloud projesinde Calendar API'yi etkinleştirin; Google Auth Platform audience/consent ve test kullanıcılarını yapılandırın. Web application OAuth client oluşturun; gerçek callback adresini tam eşleşen authorized redirect URI olarak kaydedin.
2. Onaylı OAuth istemcinizle authorization-code akışında `access_type=offline`, CSRF korumalı `state` ve iki scope isteyin: `https://www.googleapis.com/auth/calendar.events.owned` ve `https://www.googleapis.com/auth/calendar.events.freebusy`. Callback state'i doğrulasın; code yalnız sunucuda aynı redirect URI/client ile token endpoint'ine değişilsin. Refresh token güvenli depoya alınır, loglanmaz. Callback bu uygulamada yok; Google'ın resmi örneğini ayrı yönetilen yetkilendirme aracında uygulayın. [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server).
3. Manuel pilot alternatifi: yalnız kurumunuz bu aracı onaylıyorsa [Google OAuth Playground](https://developers.google.com/oauthplayground) kullanın. Kendi web client'ınıza `https://developers.google.com/oauthplayground` redirect URI ekleyin; Settings → Use your own OAuth credentials, Server-side/offline; kendi client ID/secret'ınızı girin. İki scope'u seçip Authorize APIs, ardından Exchange authorization code for tokens çalıştırın. Dönen refresh tokenı güvenli depoya taşıyın; ekran/response paylaşmayın. Ortak Playground client'ını uygulamanızın client'ı sanmayın. Yeni consent/grant bu teslimde alınmadı.
4. Takvim sahibi kullanıcı altında özel pilot takvim oluşturun veya onaylı mevcut takvimi seçin. Calendar ayarlarından somut Calendar ID'yi alın; `primary` kullanmayın. Scope/ACL uygunluğu gerçek freeBusy ve kontrollü event kabulüyle sınanacak. [Calendar scope tanımları](https://developers.google.com/workspace/calendar/api/auth). Refresh token kalıcı çalışacak varsayılmamalı; audience/testing durumu ve yenileme/revoke koşulları Google hesabında kontrol edilir.

## Dosyalar ve sırlar

`mkdir -p .local`; `core-references.example.json` → `.local/core.json`, `production-composition.example.json` → `.local/composition.json`. Core'da iki ayrı mutlak DB yolu, tenant/route; composition'da aynı tenant, Calendar ID, bilgi tabanı, kaynak ve Europe/Istanbul çalışma saatleri doldurulur. Başlangıç `disabled` kalır. Schedules ilk başarılı composition transaction'ında güvenilir slotları üretir; demo satırları yüklenmez. Başka takvim yazarı freeBusy ile insert arasına girebilir; pilotta ayrı takvim/tek booking writer tercih edin.

Environment/secret manager anahtarları: `CORE_EVENT_KEY`, `CORE_TOOL_KEY`, `CORE_OPERATOR_KEY` ayrı >=32 karakter; `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`; `GOOGLE_CREDENTIAL_ENCRYPTION_KEY`64 hex; `RETELL_ACCOUNT_A_KEY`. Anahtarları güvenli araçta üretip yerleştirin; bu belge gerçek credential üretmez. `.env` kullanılırsa owner-only izin verin, yedeklerle ayrı koruyun; `npm run start:local` .env'yi yükler. DB'deki döndürülmüş grant bootstrap environment tokenından daha günceldir; environment kopyasını restore kaynağı sanmayın.

## Retell flow, agent ve telefon

Yerel dosya export'u (test edildi; örnek numara aranmaz):

```sh
npm run build
node dist/scripts/export-autonomous-flow.js .local/flow https://receptionist.invalid account-a +902121234567
```

Gerçek import öncesi komuttaki origin ve E.164 hedefi onaylı gerçek değerlerle değiştirin. `autonomous-flow.v1.json`, agent patch ve manifest oluşur. Manifest `templateSha256` config artifact pin'idir; materialized digest uzak export digest'i değildir.

Yetkili operatör, [Create Conversation Flow](https://docs.retellai.com/api-references/create-conversation-flow) sözleşmesinde export edilen flow gövdesiyle yeni flow oluşturur; gelen ID/version'ı kaydeder. Dashboard JSON içe aktarma mevcutsa payload'ı orada da inceleyebilir; menü ismine veya export'un değişmeden kabul edileceğine güvenmeyin. Provider normalizasyonu bu teslimde doğrulanmadı.

[Update Agent](https://docs.retellai.com/api-references/update-agent) üzerinden seçilen voice/model ile agent patch alanlarını uygulayın; `response_engine` türü conversation-flow, ID/version yeni flow'a bağlı olsun. Webhook `https://ONAYLI_ORIGIN/providers/retell/account-a/events`; events started/ended/analyzed. [Publish Agent](https://docs.retellai.com/api-references/publish-agent) ile yayınlayıp **dönen yayımlanmış versiyonu** pinleyin. Config'de aynı gerçek agent ID anahtarı pins ve remoteDigests altında yer almalı. Bu API işlemleri izinli operatörün manuel adımlarıdır; burada çalıştırılmadı.

[Get Conversation Flow](https://docs.retellai.com/api-references/get-conversation-flow) ile tam pinli uzak export'u güvenli dosyaya alın, tüm davranışları inceleyin:

```sh
node dist/scripts/retell-export-digest.js .local/reviewed-remote-flow.json
```

Sonuç `setup.remoteDigests[agentId]` alanına; `setup.origin` onaylı HTTPS origin, `handoffNumbers[accountId]` onaylı statik hedef olmalı. Runtime hem payload alt kümesini hem digest'i doğrular; uyuşmazlıkta pinleri körlemesine değiştirmeyin. Tam runtime agent/flow kontrolü için hesap GET/monitor erişimi gerekli.

Mevcut Retell veya onaylı imported/SIP numarasını bu agent'a bağlayın. Türkiye erişimi ve aktarım için carrier/ülke desteği ayrıca doğrulanmalı; numara satın alma bu reçetenin otomatik parçası değildir. Transfer web-call testinde kanıtlanamaz; telefon yolunda hedef yanıtı ve başarısızlık davranışı ölçülür. [Özel telefon bağlantısı](https://docs.retellai.com/deploy/custom-telephony), [transfer node](https://docs.retellai.com/build/conversation-flow/call-transfer-node).

## Kontrollü açılış

[HTTPS ingress](deployment-runbook.md) hazır, grant ve flow incelenmiş, test maliyeti/onayı alınmışsa `profile:"live", enableLive:true` seçilir. `.env` içinde `CONFIG_JSON_PATH=.local/core.json`, `COMPOSITION_JSON_PATH=.local/composition.json`, `PORT=8787` tanımlanır. `npm run start:local` artık gerçek provider GET/OAuth işlemleri yapabilir. `/ready` ve onaylı tek test çağrısı sonrası receipt/freeBusy/DTMF/aktarımı ayrı kabul edin. İlk başarılı startup canlı kabul değildir. CRM varsayılan kapalı; açılacaksa exact HTTPS allowlist, HMAC key ve alıcıda kalıcı idempotency kabulü gerekli. SMS/e-posta bu akışta yok.
