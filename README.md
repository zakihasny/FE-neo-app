# FE NEO App HTTP Service

FE NEO App menyajikan frontend Employee Database Lab dan backend API dari satu HTTP service. Backend membaca PostgreSQL 15 melalui `DATABASE_URL` dan menggunakan NATS JetStream melalui `NATS_URL`. Kedua credential hanya tersedia pada runtime container dan tidak dikirim ke browser.

## Arsitektur

```text
Browser -> HTTP service -> PostgreSQL 15 NEO DB
                        -> NATS JetStream -> command workers -> PostgreSQL 15 NEO DB
```

HTTP service melayani halaman dan API dari origin yang sama:

- `/`: ringkasan database.
- `/query.html`: console `SELECT` read-only dengan timeout dan batas 200 baris.
- `/input.html`: formulir asynchronous tambah pegawai, site, dan device.
- `/api/summary`: ringkasan `employee_app.database_summary`.
- `/api/meta`: referensi site, salary, seating, dan pegawai.
- `/api/query`: eksekusi query read-only.
- `/api/employees`: publish command tambah pegawai.
- `/api/sites`: publish command tambah site.
- `/api/devices`: publish command tambah device.
- `/api/jobs/:jobId`: status command.
- `/health/live` dan `/health/ready`: probe service.

## Requirement

- NEO DB PostgreSQL 15 yang dapat dijangkau dari HTTP service.
- Credential pada `DATABASE_URL` memiliki izin membuat schema, table, view, index, dan constraint saat migration pertama. Setelah bootstrap, gunakan credential dengan privilege yang lebih sempit bila lifecycle NEO App memungkinkan rotasi binding.
- NEO Queue dengan JetStream aktif. Saat startup, service otomatis membuat resource berikut bila belum ada:

```text
Stream: NEO_APP_COMMANDS
Subjects: employee.create.v1, site.create.v1, device.create.v1
Durable pull consumers:
- neo-app-employee-writer-v1
- neo-app-site-writer-v1
- neo-app-device-writer-v1
Acknowledgement: explicit
Retention: work queue
Storage: file
```

Bootstrap Queue bersifat idempotent dan aman untuk beberapa replica yang startup bersamaan. Credential `NATS_URL` harus memiliki izin membaca, membuat, dan memperbarui stream serta membuat consumer. Stream lama yang hanya memiliki subject pegawai otomatis ditambahkan subject site dan device tanpa menghapus subject lain. Startup gagal dengan pesan yang jelas bila resource bernama sama memiliki retention, storage, atau konfigurasi consumer yang tidak kompatibel.

- Endpoint PostgreSQL dan NATS dapat dijangkau dari pod HTTP service.
- TLS CA PostgreSQL yang dibutuhkan sudah tersedia dalam trust store atau mounted secret container.

## Environment

Hanya dua service binding yang wajib:

```dotenv
DATABASE_URL=postgresql://username:password@neo-db-host:5432/app?sslmode=verify-full
NATS_URL=nats://token@message-neo-app:4222
```

Untuk NEO Queue dengan token authentication, token ditempatkan sebelum `@`. Format `nats://username:password@host:port` dari service binding NEO App juga didukung. Service memisahkan credential dari endpoint dan meneruskannya melalui opsi autentikasi NATS; credential tidak dicetak ke log.

`PORT` bersifat opsional dan default ke `8080`. Jangan menaruh nilai credential di Dockerfile, source code, `assets/config.js`, atau Git.

Startup migration aktif secara default. Dua kontrol non-secret berikut bersifat opsional:

```dotenv
RUN_DB_MIGRATIONS=true
SEED_SAMPLE_DATA=false
```

Jangan aktifkan sample seed pada production database.

## Migration

Sebelum membuka HTTP port, container menunggu NEO DB, mengambil PostgreSQL advisory lock, dan menjalankan migration yang belum tercatat pada `employee_app.schema_migrations`:

```text
001_schema.sql
002_views.sql
003_employee_jobs.sql
004_command_jobs.sql
```

Lock mencegah beberapa replica menjalankan migration bersamaan. Jika NEO DB belum dapat dijangkau, startup mencoba kembali maksimal 30 kali dengan interval dua detik. Service gagal start bila koneksi atau migration tetap gagal.

Migration juga dapat dijalankan sebagai command terpisah:

```bash
pnpm migrate
```

Set `RUN_DB_MIGRATIONS=false` hanya jika migration dikelola oleh pipeline terpisah.

## Local Development

```bash
corepack enable
corepack prepare pnpm@11.16.0 --activate
pnpm install --frozen-lockfile
pnpm test
pnpm start
```

Buka `http://127.0.0.1:8080/`.

## Docker

Build image:

```bash
docker build -t fe-neo-app:1.3.0 .
```

Jalankan menggunakan runtime secrets:

```bash
docker run --rm \
  --name fe-neo-app \
  -p 8080:8080 \
  -e DATABASE_URL="$DATABASE_URL" \
  -e NATS_URL="$NATS_URL" \
  fe-neo-app:1.3.0
```

Verifikasi:

```bash
curl --fail http://127.0.0.1:8080/health/live
curl --fail http://127.0.0.1:8080/health/ready
curl --fail http://127.0.0.1:8080/api/summary
```

## Processing Model

`POST /api/employees`, `POST /api/sites`, dan `POST /api/devices` membuat job persisten pada `employee_app.command_jobs`, publish command dengan `Nats-Msg-Id`, dan mengembalikan HTTP `202`. Setiap jenis data memakai subject dan durable pull consumer terpisah. Worker memvalidasi relasi, menyimpan data dalam transaksi PostgreSQL, memperbarui job, lalu mengirim acknowledgement. Unique idempotency key dan pemeriksaan status `completed` mencegah redelivery membuat data ganda. Saat menambah device, site otomatis mengikuti site pegawai dan divalidasi kembali oleh worker.

Query console hanya menerima satu `SELECT` atau read-only CTE. Backend menolak keyword write/admin dan menjalankan query di dalam transaksi `READ ONLY` dengan `statement_timeout` lima detik. Tetap lindungi halaman ini dengan authentication dan authorization pada ingress atau application gateway.

Visual system mengikuti BGN Web Design System v1.3.22 pada `skills.md` dan token canonical pada `assets/tokens.css`.
