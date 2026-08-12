# FE NEO App HTTP Service

FE NEO App menyajikan frontend Employee Database Lab dan backend API dari satu HTTP service. Backend membaca PostgreSQL 15 melalui `DATABASE_URL` dan menggunakan NATS JetStream melalui `NATS_URL`. Kedua credential hanya tersedia pada runtime container dan tidak dikirim ke browser.

## Arsitektur

```text
Browser -> HTTP service -> PostgreSQL 15 NEO DB
                        -> NATS JetStream -> employee worker -> PostgreSQL 15 NEO DB
```

HTTP service melayani halaman dan API dari origin yang sama:

- `/`: ringkasan database.
- `/query.html`: console `SELECT` read-only dengan timeout dan batas 200 baris.
- `/input.html`: formulir asynchronous tambah pegawai.
- `/api/summary`: ringkasan `employee_app.database_summary`.
- `/api/meta`: referensi site, salary, dan seating.
- `/api/query`: eksekusi query read-only.
- `/api/employees`: publish command tambah pegawai.
- `/api/jobs/:jobId`: status command.
- `/health/live` dan `/health/ready`: probe service.

## Requirement

- NEO DB PostgreSQL 15 dengan schema dari `DB-neo-app.zip`.
- Migration `migrations/003_employee_jobs.sql` sudah dijalankan.
- NEO Queue JetStream dengan resource berikut:

```text
Stream: NEO_APP_COMMANDS
Subject: employee.create.v1
Durable pull consumer: neo-app-employee-writer-v1
Acknowledgement: explicit
```

- Endpoint PostgreSQL dan NATS dapat dijangkau dari pod HTTP service.
- TLS CA yang dibutuhkan sudah tersedia dalam trust store atau mounted secret container.

## Environment

Hanya dua service binding yang wajib:

```dotenv
DATABASE_URL=postgresql://username:password@neo-db-host:5432/app?sslmode=verify-full
NATS_URL=tls://username:password@neo-queue-host:4222
```

`PORT` bersifat opsional dan default ke `8080`. Jangan menaruh nilai credential di Dockerfile, source code, `assets/config.js`, atau Git.

## Migration

Jalankan menggunakan credential pemilik schema `employee_app`:

```bash
psql "$DATABASE_URL" \
  -X \
  -v ON_ERROR_STOP=1 \
  -f migrations/003_employee_jobs.sql
```

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
docker build -t fe-neo-app:1.0.0 .
```

Jalankan menggunakan runtime secrets:

```bash
docker run --rm \
  --name fe-neo-app \
  -p 8080:8080 \
  -e DATABASE_URL="$DATABASE_URL" \
  -e NATS_URL="$NATS_URL" \
  fe-neo-app:1.0.0
```

Verifikasi:

```bash
curl --fail http://127.0.0.1:8080/health/live
curl --fail http://127.0.0.1:8080/health/ready
curl --fail http://127.0.0.1:8080/api/summary
```

## Processing Model

`POST /api/employees` membuat job persisten, publish command dengan `Nats-Msg-Id`, dan mengembalikan HTTP `202`. Durable worker memvalidasi relasi, memasukkan pegawai dalam transaksi PostgreSQL, memperbarui job, lalu mengirim acknowledgement. Unique idempotency key dan pemeriksaan status completed mencegah redelivery membuat pegawai kedua.

Query console hanya menerima satu `SELECT` atau read-only CTE. Backend menolak keyword write/admin dan menjalankan query di dalam transaksi `READ ONLY` dengan `statement_timeout` lima detik. Tetap lindungi halaman ini dengan authentication dan authorization pada ingress atau application gateway.

Visual system mengikuti BGN Web Design System v1.3.22 pada `skills.md` dan token canonical pada `assets/tokens.css`.
