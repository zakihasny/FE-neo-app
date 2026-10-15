# FE NEO App — containerfile

Varian build pada branch containerfile. Branch main tidak diubah. Source dasar: b3ef5c64a6b516a2586fe9ca2d3b196e8fa9c37d.

## Build containerfile

Podman 5.6.2/Buildah yang kompatibel diperlukan. Gunakan Linux dengan target amd64.

~~~sh
podman build --platform linux/amd64 -f Containerfile -t fe-neo-app:containerfile .
podman run --rm --env-file .env -p 8080:8080 fe-neo-app:containerfile
~~~

CI menjalankan Podman versi terpin dalam container build sementara, mengekspor image sebagai archive, lalu mengujinya pada Docker runner. Tidak ada file Dockerfile maupun penggantinya dengan nama tersebut.

Referensi resmi: https://docs.podman.io/en/latest/markdown/podman-build.1.html

## Kontrak aplikasi

- Node.js 22.x dan pnpm 11.16.0; dependency memakai frozen lockfile.
- HTTP listen pada 0.0.0.0, default 8080; PORT dapat mengoverride default.
- PostgreSQL harus major 16; PostgreSQL 15 sengaja ditolak.
- NATS JetStream memerlukan izin bootstrap stream NEO_APP_COMMANDS dan tiga durable consumer.
- Frontend, API, schema, migration, dan worker tetap sama dengan main.
- Worker employee/site/device berjalan di proses web, bukan service worker terpisah.
- Branch ini tidak menyimpan file bernama Dockerfile. Artefak internal builder tetap temporary dan tidak di-commit.

## Variabel runtime

| Nama | Pengaturan |
|---|---|
| DATABASE_URL | Wajib; connection string PostgreSQL 16, hanya backend |
| NATS_URL | Wajib; endpoint NATS JetStream, hanya backend |
| PORT | Opsional; default 8080 |
| NODE_ENV | production |
| RUN_DB_MIGRATIONS | true secara default |
| SEED_SAMPLE_DATA | false secara default; aktifkan hanya untuk DB demo baru |

Salin .env.example menjadi .env hanya untuk penggunaan lokal, lalu isi credential milik sendiri. Jangan commit .env, credential, atau connection string. Tidak ada credential layanan existing dalam CI maupun image. TLS dan CA PostgreSQL mengikuti binding/runtime target; jangan menonaktifkan verifikasi TLS sebagai workaround.

Aplikasi belum mengimplementasikan autentikasi pengguna: gunakan data dummy atau lindungi ingress sebelum menyimpan data asli.

## Menjalankan source lokal

~~~sh
npm install --global pnpm@11.16.0
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm start
~~~

Set DATABASE_URL dan NATS_URL pada environment shell terlebih dahulu. Aplikasi tidak otomatis membaca file .env ketika dijalankan langsung menggunakan Node.

## Menjalankan image

Gunakan nama image yang dihasilkan metode branch ini:

~~~sh
docker run --rm --env-file .env -p 8080:8080 fe-neo-app:ci
~~~

Untuk override port, isi PORT=9090 pada environment runtime dan ubah pemetaan menjadi 9090:9090. Untuk Podman, gunakan perintah run milik Podman dengan opsi yang sama.

## Health, API, dan migration

- GET/HEAD /healthz: liveness; tidak membuktikan kesiapan dependency.
- GET /health/ready: PostgreSQL 16 dan Queue siap.
- Halaman /, /input.html, /query.html; asset pada /assets/.
- API summary/meta/query, sites/employees/devices, dan jobs mempertahankan kontrak main.
- Empat migration 001–004 berjalan sebelum HTTP dibuka, dengan advisory lock dan registry migration persisten.
- Berikan startup grace minimal 240 detik. Atur probe melalui runtime/platform; metadata HEALTHCHECK image tidak selalu digunakan oleh orchestrator.
- Setelah bootstrap DB demo, set SEED_SAMPLE_DATA=false dan restart aplikasi.

## CI build dan smoke test

Workflow Build and verify berjalan pada push ke enam branch alternatif dan dapat dipanggil manual. Runner memakai Ubuntu 24.04 dan image linux/amd64. Tool, base image, dan digest ada di ci/versions.json; workflow memin Actions menggunakan commit SHA.

~~~sh
node ci/check-source.mjs
node ci/build-image.mjs
node ci/smoke.mjs
~~~

Helper build mengambil source bersih dari commit HEAD, bukan file lokal yang belum di-commit. Semua metode diuji dengan service PostgreSQL 16 dan NATS JetStream sementara, credential acak, jaringan terisolasi, dan runtime non-root. CI memeriksa halaman/asset, health, migration, seed demo, tiga jenis job, idempotency, read-only SQL, persistensi setelah restart, dan PORT=9090. Resource CI dibersihkan setelah pengujian; log error disanitasi.

Build tools belum tentu tersedia pada Windows lokal. Build image hanya dinyatakan terverifikasi setelah job CI berhasil. CI tidak push image ke registry, tidak deploy NEO App, dan tidak memakai secret layanan existing.

## Penggunaan di NEO App

Kemampuan menghasilkan image tidak otomatis berarti metode tersebut didukung sebagai build native platform. Untuk Railpack, pilih mode native Railpack bila tersedia. Untuk metode lain yang dukungan nativenya belum diverifikasi, build image menggunakan tool terkait lalu gunakan alur prebuilt image setelah image dipublikasikan secara terpisah oleh user.

Saat deployment berikutnya, gunakan port service 8080, binding PostgreSQL 16 dan Queue, serta health endpoint di atas. Jangan arahkan varian PostgreSQL 16 ini ke DB PostgreSQL 15 dari deployment ZIP sebelumnya. Pembuatan resource, publikasi registry, dan deployment tidak termasuk perubahan branch ini.
