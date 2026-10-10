# Private kaynak yedeği

Bu depo yalnız kaynak kodu için private bir yedektir. Apache-2.0 lisansı korunmuştur; public yayın ve production kabulü yapılmamıştır.

Kaynak snapshot: `f7ad17976c9b3fb35a3ef63b94f39b48e10e400d` (`dashboard-local`). Önceden doğrulanan sonuçlar: build, 119 core, 24 admin ve 59 UI/fixture testi; bu sonuçlar tüm sağlayıcıları veya production kabulünü kapsamaz. Gerçek browser Geri/İleri kontrolü geçti; runtime reduced-motion, konsol/CSP ve Safari çalıştırılmadı.

Kaynak kapsamı mevcut portable manifestten alındı. Kod, testler, bağımlılık kilidi, Apache lisansı/bağımlılık bildirimleri ve kurulum belgeleri dahil. Özel inceleme notunun bağlantısı kaldırıldı; kaynak davranışı değiştirilmedi.

Ham Git geçmişi, özel review/evidence/reference dosyaları, symlink'ler, node_modules, dist, gerçek .env, veritabanları, müşteri/çağrı kayıtları ve credential kasaları yüklenmedi. Kaynak/testlerde yalnız belgelenmiş dummy ve sentetik credential fixture'ları bulunur; gerçek kurulumda kullanılmamalıdır.

## Geri yükleme

Node >=22.13 <23 ve npm ile temiz bir dizinde:

```sh
git clone https://github.com/vibeeval/receptionist.git
cd receptionist
npm ci --ignore-scripts
npm run check:source
npm run build
node --import ./dist/tests/composition/no-egress.js --test --test-concurrency=1 dist/tests/*.test.js
node --import ./dist/tests/composition/no-egress.js --test --test-concurrency=1 dist/tests/admin/*.test.js
node --test tests/ui/*.test.js
npm run dashboard:demo
```

Bu demo geçici SQLite ve sentetik verilerle çalışır; dış ağ kapalıdır. Gerçek anahtar/konfigürasyon, veritabanı ve OAuth grant yedeği ayrıca korunmalıdır; bu GitHub deposu bunların yedeği değildir. Ortak yerel Git/worktree yapısı bu işlemde değiştirilmedi veya silinmedi.
