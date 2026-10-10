# HTTPS ingress ve işletim

Yerel servis yalnız127.0.0.1 dinler. Bu belge onaylı altyapı operatörü için reçetedir; gerçek DNS, sertifika, proxy, deployment veya provider çağrısı bu teslimde çalıştırılmadı. Yerel health/readiness/SIGTERM sentetik olarak doğrulandı.

## Proxy hazırlığı

Onaylı hostname'i sunucunuza yönlendirin; kurumunuzun sertifika yöneticisinden hostname'e uygun geçerli TLS sertifikası ve chain alın. Private key owner-only okunur olsun. Node servisini ayrı yetkisiz kullanıcıyla8787 üzerinde çalıştırın; yalnız proxy443 public, uygulama portu localhost kalmalı. Süreç yöneticisi çalışma dizini, Node22.x, secret environment, graceful SIGTERM ve kontrollü restart sağlamalı. Bir systemd/launchd kurulumu pakette yok; aşağıdaki proxy örneği dağıtılmadı veya `nginx -t` ile doğrulanmadı.

Nginx server örneği; alan adı ve mevcut sertifika yolları operatör tarafından doldurulur:

```nginx
server {
    listen 443 ssl;
    server_name receptionist.example.invalid;
    ssl_certificate /etc/receptionist/tls/fullchain.pem;
    ssl_certificate_key /etc/receptionist/tls/privkey.pem;
    client_max_body_size 64k;
    access_log off;
    location ^~ /providers/retell/ {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header Connection "";
        proxy_connect_timeout 5s;
        proxy_read_timeout 20s;
    }
    location / { return 404; }
}
```

64k sınırını core `maxBodyBytes` ile eşleştirin; büyük örnek payload gerekiyorsa iki katmanı birlikte ve inceleyerek ayarlayın. `proxy_pass` URI eki kullanmaz; path/body/header yeniden yazan JSON middleware/WAF transform eklemeyin. POST body ve `x-retell-signature` aynen uygulamaya ulaşmalı. Provider imzası doğrulaması uygulamadadır; proxy başarılı2xx taklidi yapmamalı. [Nginx proxy modülü](https://nginx.org/en/docs/http/ngx_http_proxy_module.html), [Retell imza doğrulama](https://docs.retellai.com/features/secure-webhook). Private health/admin uçlarını bu public location'a eklemeyin.

Operatör önce `nginx -t`, sonra kendi servis yöneticisiyle onaylı reload uygular; bu komutlar burada çalıştırılmadı. Dışarıdan izinli sentetik webhook testi ile TLS chain, hostname, unchanged raw body, signature reject ve response sürelerini doğrular. Backend kendisi outbound HTTPS/WSS üzerinden Google/Retell'e bağlanır; monitor için public inbound WebSocket proxy route'u gerekmez. Egress443/DNS ve PostgreSQL bağlantısı gereksinimlerini ayrı onaylayın. WAF/rate limits gerçek webhook retry akışını bozmayacak şekilde ölçülmeli.

## Sağlık ve teşhis

`curl --fail http://127.0.0.1:8787/health`: liveness/local veya providerMock bilgisi. `curl --fail http://127.0.0.1:8787/ready`: DB/worker; composition varsa credential/setup kontrolü.500ms sınırı yalnız Operations DB kontrolünündür; live provider kontrolünün ek süreleri vardır. Health200 boş envanteri veya gerçek çağrı başarısını kanıtlamaz.

| Kod | İnceleme / eylem |
|---|---|
| LIVE_MODE_DISABLED | Intentional enableLive/profile seçimi; bypass etmeyin |
| PROVIDER_SETUP_NOT_READY | Pinli published agent/flow, digest, webhook ve yetkiler; otomatik re-pin yok |
| OAUTH_CLIENT_BINDING_REQUIRED/MISMATCH | [Eski grant geçişi](upgrade-guide.md); farklı istemciyle grantı tekrar tekrar denemeyin |
| NEEDS_REAUTH | Yetkili kullanıcı replacement grantı ve açık yerel reauthorize |
| COMPOSITION_MAPPING_CHANGE_REQUIRES_MIGRATION | Mevcut DB config değişikliği için ayrı migration planı |
| UNEXPECTED_COMPOSITION_SLOT | Beklenmeyen envanteri inceleyin; otomatik DELETE yok |
| WORKER_UNAVAILABLE | Worker latch restart'a kadar kalır; DB/lease/unknown nedeni çözülmeden restart döngüsü kurmayın |
| QUEUE_ATTENTION | Overdue/DLQ; gerçek merkezi pager veya replay UI yok |
| SHUTDOWN_TIMEOUT | Normal kapanış sayılmaz; restart öncesi unknown/lease durumunu inceleyin |

Sırlar, URL credential'ları, telefon, ham transcript/body veya tam stack'i destek kaydına taşımayın. Booking unknown ise yeni command ile tekrar POST göndermeyin; mevcut lookup/receipt reconciliation sürer. Kill gate provider faturasını veya başlamış aramayı kesmez.

## Kapatma ve açma

Önce carrier routing/ingress'i onaylı bakım hedefine yönlendirin; yeni arama/test göndermeyin. Yerel operator kill yalnız yeni booking kabulünü sınırlar. Aktif çağrı/işleri güvenle boşaltın; her uygulama instance'ına SIGTERM verin ve SHUTDOWN_COMPLETE/exit0 doğrulayın. Beş saniyelik drain timeout olursa işlemi normal kapanmış saymayın. Monitor lease15s/heartbeat3s, recovery5s sağlıklı tarama ve hatada en fazla8s backoff kullanır; anlık failover değildir.

[Backup/restore](backup-restore.md) ve [yükseltme](upgrade-guide.md) sonrası önce private health/readiness, sonra tek onaylı sentetik çağrı, receipt ve handoff kabulü; en son routing açılır. Gerçek test sayısı/süresi, toplam AI+carrier+transfer+hosting ücret üst sınırı ve durdurma sahibi önceden onaylanır. Yerel budgetMicros gerçek sağlayıcı hard cap değildir. Proje Apache-2.0 lisanslıdır; public yayın/deploy için ayrıca yetki gerekir. Retell ve canlı doğrulama yeni talimata kadar beklemededir.
