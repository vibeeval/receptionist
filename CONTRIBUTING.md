# Katkı ve doğrulama

Node 22.x ile `npm ci`, `npm test`, `npm run test:coverage` ve `npm run demo` çalıştırılır. Testler sentetiktir; gerçek credential, müşteri verisi veya dış ağ çağrısı eklemeyin. Bir hata düzeltmesi önce hatayı gösteren testle doğrulanmalıdır. Kilit dosyasını koruyun ve değişiklikleri küçük commit'lere bölün.

`tests/audit45.test.ts` önceki denetimin 45 senaryosunu güvenli yeni sözleşmeye uyarlar. Eski n8n workflow'unun düzeltildiği anlamına gelmez. `elevenlabs-ack` sentetik HTTP kabulüdür; gerçek ElevenLabs imza testi değildir. Recording notice testi operatör attestation kontrolüdür; sesli açıklamayı ölçmez. Core/boundary/product testleri sözleşme ve durum geçişlerini, transport/process testleri gerçek loopback ve ayrı OS süreçlerindeki disk dayanıklılığını sınar.

Coverage raporu yüklenen `dist/src/**` modüllerini ölçer. Demo ayrı çalıştırılır; PostgreSQL ayrı testtir ve sunucu yokken `NOT_RUN` üretir. Tarihsel red/fail kanıtları sonraki başarılı koşuyla karıştırılmamalıdır. Coverage yüzdesi tek başına üretim kabulü değildir.

Gerçek sağlayıcı, ücretli API, arama, mesaj, deploy ve public yayın için ayrı açık yetki gerekir. Katkılar Apache-2.0 koşullarıyla sunulur; yalnız paylaşmaya yetkili olduğunuz materyali ekleyin. PR açıklamasında çalıştırılan, başarısız ve çalıştırılmamış testleri ayrı belirtin; loglara sır yazmayın.
