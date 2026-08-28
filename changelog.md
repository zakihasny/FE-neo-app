# Changelog

## 2026-08-28

- Added idempotent NATS JetStream stream and durable consumer bootstrap during service startup.
- Added compatibility validation and concurrent-replica handling for Queue resources.
- Added unit tests for Queue resource creation, reuse, startup races, and error propagation.
- Fixed NEO Queue token authentication for `nats://token@host:port` service URLs.
- Added credential-safe NATS URL parsing tests for token, user/password, TLS, and multiple endpoints.
- Added automatic PostgreSQL 15 startup migrations for schema, views, and employee job tracking.
- Added bounded database connection retry and a PostgreSQL advisory lock for safe multi-replica startup.
- Added optional idempotent sample seeding through `SEED_SAMPLE_DATA=true`.
- Added a standalone migration command and migration lifecycle tests.

## 2026-08-12

- Converted the static deployment artifact into a same-origin Node.js HTTP service.
- Added PostgreSQL 15 summary, metadata, guarded read-only query, persistent job, and readiness APIs.
- Added a durable NATS JetStream employee worker with publish acknowledgements and idempotent processing.
- Added the employee job migration, production Dockerfile, dependency lockfile, and automated tests.

## 2026-08-11

- Added backend-only `DATABASE_URL` and `NATS_URL` environment variable examples for PostgreSQL 15 NEO DB and NATS JetStream.
- Added credential-safe Git ignore rules and documented the Static Web to API to database/queue integration boundary.

## 2026-08-10

- Rebuilt the deployment artifact as framework-free static HTML, CSS, and JavaScript to avoid Nuxt base-path and rewrite dependencies.
- Applied BGN Web Design System v1.3.22 tokens, component rules, typography, borders, radius, focus states, responsive breakpoints, official logo assets, and five-column footer pattern.
- Preserved the NEO DB PostgreSQL 15 read contract and NEO Queue asynchronous employee write flow.
- Added relative frontend asset paths and a runtime-editable API base URL.
