# İlk kurulum ve örnek veriler

Node >=22.13 <23, npm ve yazılabilir bir çalışma dizini gerekir. macOS/Node22.23.2 üzerinde doğrulandı; diğer işletim sistemleri bu teslimde doğrulanmadı. SQLite experimental uyarısı beklenir. SQLite backup bakım komutu Node >=22.16 ister. PostgreSQL testleri ayrıca Python3 ve PostgreSQL binary kurulumu ister; temel demo bunları istemez.

```sh
npm ci --ignore-scripts
npm run check:source
npm test
npm run demo
npm run demo:composition
npm run demo:autonomous
npm run demo:production
npm run demo:retention
```

Kurulum dependency indirirken internete ihtiyaç duyabilir. Hazır cache ile `npm ci --offline --ignore-scripts` kullanılabilir; boş cache'de offline kurulum beklenmez. Test/demo sağlayıcı API'si kullanmaz. Yerel loopback dinlemesi sandbox tarafından engellenirse yalnız localhost izni verin;0.0.0.0 açmayın.

**Örnek veriler:** `demo` ve test harness'leri yalnız kendilerinin oluşturduğu geçici DB'ye açık fixture seçimiyle sabit tarihli slotlar yükler. Composition/otonom demo kendi onaylı `slot-future` envanterini kurar. Bunlar gerçek takvime aktarılmaz; sonunda silinir. `demo:retention` kendi sentetik verisini işler, müşteri DB yolu kabul etmez. `demo:production` adı canlı çalışma anlamına gelmez; dört injected-provider senaryosudur.

**Kalıcı yerel servis:** `mkdir -p .local`, `config.example.json` → `.local/config.json`. İki farklı mutlak yerel DB yolu ve event/tool/operator için üç farklı >=32 karakter rastgele yerel anahtarı güvenli editör/secret aracıyla doldurun. Sırları terminal çıktısına veya Git'e yazmayın. `.env.example` → `.env`; `CONFIG_JSON_PATH=.local/config.json`, `PORT=8787` ayarlayın. `COMPOSITION_JSON_PATH` bu sentetik kullanımda tanımlı olmasın.

```sh
npm run start:local
```

Başka terminalde `curl --fail http://127.0.0.1:8787/health` ve `/ready` kontrol edilir. Ctrl-C ile kapanır. **Kalıcı yerel servis boş slot envanteriyle açılır**, otomatik demo seed yapmaz. Ürün içinde fixture yükleme/admin slot CLI yoktur; örnek randevu görmek için demo kullanın. Gerçek envanter yalnız [provider composition kurulumu](provider-setup.md) içindeki açık slot/schedule yapılandırmasından gelir.

`npm run check:source` dağıtım manifestindeki kaynak/test/belge dosyalarını kontrol eder; DB, .env, node_modules veya derlenmiş dist'i taramaz. Hata exit1; eksik/geçersiz manifest exit2. Yerel kaynak düzenlemesi hash uyumsuzluğu üretir; bunu beklenen değişiklik olarak inceleyin, manifesti körlemesine yeniden üretmeyin.

Sorunlar: EADDRINUSE için farklı PORT/PORT=0; INVALID_CONFIG için mutlak ve ayrı DB yolları/anahtarlar; STALE_SIGNATURE için saat/Unix saniyesi; SLOT_EXPIRED için demo dışındaki gerçek tarih; unknown için yeni booking göndermeden reconciliation; database locked için yerel disk ve tekil işlem. Gerçek kurulumda [işletim](deployment-runbook.md) ve [yükseltme](upgrade-guide.md) kodlarını izleyin.
