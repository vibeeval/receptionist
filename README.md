# Telefon resepsiyonisti çekirdeği

Kendi hesaplarıyla kurulabilen telefon/randevu otomasyonu adayı. **Proje Apache-2.0 lisanslıdır; canlı telefon kabulü yapılmadı ve public yayın yok. Retell ve canlı doğrulama yeni talimata kadar beklemededir.** Yerel demolar ücretsiz, sentetik ve sağlayıcı hesabı gerektirmez. Gerçek telefon, ses/model, hosting ve aktarım ücretleri ayrıca kullanıcıya aittir.

Bu inceleme dalında [yerel Türkçe dashboard](docs/dashboard.md) eklendi: `npm run dashboard:demo`. Canlı bağlantı ve deployment yapmaz; işletme/anahtar kayıtları etkinleştirme bekleyen taslaklardır.

Node >=22.13 <23 ile:

```sh
npm ci --ignore-scripts
npm run check:source
npm test
npm run demo:autonomous
```

Demo geçici veritabanında örnek saat/slot yükler; DTMF ve takvim yanıtını simüle eder, dosyalarını temizler. Sesli arama yapmaz. Kalıcı `start:local` örnek randevu yüklemez. Kaynak paketindeki manifest kontrolü dosya değişikliğini bulur; yayıncının kimliğini veya güvenilirliğini doğrulamaz.

- [İlk kurulum ve örnek veriler](docs/quickstart.md)
- [Google / Retell kurulumu](docs/provider-setup.md)
- [HTTPS ingress, sağlık ve işletim](docs/deployment-runbook.md)
- [Yedekleme ve geri yükleme](docs/backup-restore.md)
- [Güvenli yükseltme ve eski veriler](docs/upgrade-guide.md)
- [PostgreSQL](docs/postgres.md), [API](docs/api.md), [tehdit modeli](docs/threat-model.md)
- [Saklama](docs/retention-policy.md), [maliyet](docs/cost-retention.md), [kalan kabul işleri](docs/readiness-backlog.md)
- [Katkı](CONTRIBUTING.md), [Apache-2.0 lisansı](LICENSE) ve [kapsamı](LICENSE-OPTIONS.md), [bağımlılık bildirimleri](THIRD-PARTY-NOTICES.md)

Çekirdek idempotent inbox/outbox, kalıcı rezervasyon, bilinmeyen sonuçta lookup, Google OAuth/freeBusy sözleşmesi, Retell flow/monitor lease ve isteğe bağlı CRM webhook içerir. İnsan aktarım node'u gerçek kişinin yanıt verdiğini kanıtlamaz. Production purge, genel müşteri DB migration aracı ve operatör replay UI yoktur. n8n gerekli değildir.
