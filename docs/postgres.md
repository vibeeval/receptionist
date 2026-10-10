# PostgreSQL

Live composition `database:{kind:"postgres",urlRef:"env:DATABASE_URL",schema:"receptionist_business",mode:"production"}` kullanabilir. Production bağlantısı doğrulamalı TLS ister; sertifika/CA, network ve least-privilege rolü operatör hazırlar. SQLite yerel disk/tek host için; çok host ortak ownership PostgreSQL gerektirir. Production TLS/HA bu teslimde test edilmedi.

Test bağlantısı ayrı `local-test` modudur: yalnız loopback, `*_test` DB ve `phone_test_*` schema kabul eder. `createPostgresEngine` helper bu test kapsamındadır; live composition ile karıştırmayın. Hazır Node22.x, Python3 ve kaynağı doğrulanmış PostgreSQL prefix ile:

```sh
npm ci --ignore-scripts
npm run test:postgres:local -- /absolute/verified/postgres/prefix
```

Runner disposable SCRAM cluster açar, sentetik testler/dump/restore/WAL recovery çalıştırır ve cluster/parolayı siler. Global servis kurmaz, PostgreSQL indirmez. PostgreSQL17.11/macOS üzerinde test edildi. Mevcut ayrı test DB için ALLOW_POSTGRES_TEST=1 ve güvenli POSTGRES_TEST_URL ile `npm run test:postgres`; URL yoksa NOT_RUN/exit2, başarı sayılmaz.

Store transaction'ları schema advisory lock ile sıralanır; tek connection/AsyncLocalStorage, sabit search_path, parametreli değerler ve migration checksum kullanılır. Varsayılan pool20; connection5s, statement10s, lock5s sınırları vardır. Genel SQL/migration framework veya yüksek yük performans garantisi değildir. Uygulama transaction'ı içinde dış provider HTTP çalıştırılmaz.

[Backup/restore](backup-restore.md), [yükseltme](upgrade-guide.md), [provider kurulumu](provider-setup.md). Müşteri DB'sini sentetik test runner'a vermeyin.
