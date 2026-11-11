# Employee Database Lab — Redis variant

Branch **`db-redis`** replaces the PostgreSQL runtime dependency with **Redis 8.2**, using **redis@6.3.1**. It targets a fresh store; it does not convert existing PostgreSQL data. Node.js 22+ and pnpm 11.16.0 are required; the retained Dockerfile uses Node.js 24.

## Architecture

The same process serves three pages and the API, publishes asynchronous commands to NATS JetStream, and runs the three command consumers:

```text
Browser -> Web/API -> Redis: persistent jobs
                  -> NATS JetStream -> command consumers -> Redis: entities + job results
```

Redis is the sole primary store. Application entities and jobs are hashes, ordered ID indexes are sorted sets, and counters allocate incremental IDs. Uniqueness and relationships are checked by bounded Lua scripts before writes. Entity creation and job completion occur in the same atomic script. Redis scripting does not provide SQL-style rollback; unexpected key-type or counter corruption is rejected before mutation.

NATS remains required. Use a dedicated queue for this application variant; consumers on a shared stream process the same subjects. Retention is work queue, storage is file, and explicit acknowledgements follow persisted completion or a persisted permanent rejection. Database/network failures remain retryable.

## Pages and API

- `/`: current site, employee, and device counts.
- `/input.html`: asynchronous site, employee, and device forms.
- `/query.html`: read-only Redis command console.
- `GET /api/summary`, `GET /api/meta`: counts and form references.
- `POST /api/sites`, `/api/employees`, `/api/devices`: HTTP 202 with a persistent job ID.
- `GET /api/jobs/:jobId`: queued/processing/completed/failed state and resulting resource ID.
- `GET/HEAD /healthz`: process liveness without database or Queue checks.
- `GET/HEAD /health/ready`: HTTP 200 only when storage and Queue are ready; response includes `engine`, `version`, `database`, and `queue`. Dependency failure returns 503. The old `postgresqlMajor` field is removed.

The frontend retains the existing design and data-entry fields. IDs remain numeric. A device must belong to its employee's site; a seat must belong to the employee's selected site. Credentials remain server-side. This demo has no application authentication: use synthetic data and add an appropriate access layer before handling private records.

## Runtime variables

| Variable | Requirement/default |
| --- | --- |
| `REDIS_URL` | Required Redis connection URL; use `rediss://` for verified TLS. |
| `REDIS_KEY_PREFIX` | Application namespace, default `fe-neo-app`; do not share it with unrelated applications. |
| `NATS_URL` | Required `nats://user:password@host:4222` or supported TLS/token endpoint. |
| `PORT` | Default `80`, overridable; HTTP binds `0.0.0.0`. |
| `NODE_ENV` | `production` in the Dockerfile. |
| `RUN_DB_MIGRATIONS` | Default `true`; performs key-schema initialization before HTTP startup. |
| `SEED_SAMPLE_DATA` | Default `false`; opt in only for a fresh demo store. |

`.env.example` is a template, not an actual credential file. Native `pnpm start` reads process environment variables; it does not automatically load `.env`. Export them or use your runtime's environment/secret injection. URL-encode connection credentials. Never place connection URLs in browser assets or commit real environment files. TLS verification must remain enabled when using encrypted endpoints.

## Bootstrap and sample data

`pnpm migrate` initializes key-schema version 1 under the configured prefix; it never uses `FLUSHDB`, expires records, or resets existing counters. Redis must be **standalone 8.2**, with persistent disk, AOF enabled, `appendfsync always`, and `maxmemory-policy noeviction`. The included test Compose config supplies these settings. Operators must provision equivalent settings for deployment; application startup does not change server-wide configuration. Redis Cluster and a PostgreSQL fallback are not implemented.

Sample data includes two sites, three salary grades, three seats, three employees, and four devices. The seed is marked once and repeat startup does not duplicate it. Enabling seed on a nonempty, unseeded store is rejected rather than overwriting data. Regular data entry requires salary/seating reference rows; those references are provided by the optional sample seed or operator-managed initialization.

## Query console

The query page accepts a JSON command array, for example:

```json
["HGETALL", "fe-neo-app:employee:1"]
```

`POST /api/query` accepts `{ "command": ["ZRANGE", "fe-neo-app:ids:employees", "0", "199"] }`. Results retain `columns`, `rows`, `rowCount`, and `durationMs`, and return `executedCommand` instead of `executedSql`. SQL input is not accepted on this branch.

Allowed commands: `PING`, `TYPE`, `EXISTS`, `GET`, `HGET`, `HMGET`, `HGETALL`, `HLEN`, `SCARD`, `ZCARD`, and `ZRANGE`. Every key must belong to the configured prefix. Reads are capped at 200 rows, string/hash payloads at 64 KiB, and an application deadline of five seconds. Oversized hashes require selecting fields with `HMGET`; ranges must be bounded nonnegative ranks. All other commands, including writes, scripts, administration, and global key scans, are rejected. The backend uses an internal read-only Lua script to check payload bounds before returning values. Query presets obtain the configured prefix from readiness metadata.

## Local and deployment use

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm check
corepack pnpm test
# Export the required runtime variables first; PORT=8080 is convenient locally.
corepack pnpm start
```

Build with `docker build -t fe-db-redis:local .`. Run using runtime secrets and the matching Redis/NATS endpoints; do not use test Compose credentials for deployment. The image exposes port 80 by default, starts `node server/index.js`, and retains `/healthz` Docker health checking. Configure platform readiness at `/health/ready` and startup grace of at least 240 seconds. No cloud deployment is performed by the CI workflow.

## Integration tests

Docker is required for live integration. `compose.test.yaml` is an isolated fixture with **test-only credentials**, loopback host ports, persistent test volumes, NATS JetStream, and two application instances sharing the same store. The second instance exercises concurrent migrations and command handling. It is not a production deployment template.

```sh
docker compose -f compose.test.yaml up --build -d
RUN_INTEGRATION=true corepack pnpm test:integration
# Destructive cleanup of this disposable test stack and its volumes only:
docker compose -f compose.test.yaml down -v --remove-orphans
```

In PowerShell, set `$env:RUN_INTEGRATION = 'true'` before `corepack pnpm test:integration`. Live tests are skipped unless this flag is enabled. They use fixed loopback fixture endpoints, create synthetic data, and restart the test services. SQL variants additionally create and remove a uniquely named migration-recovery database using test-only administrator access.

CI runs on pushes to `db-redis` using Ubuntu 24.04, Node.js 24, and pnpm 11.16.0. It checks syntax and unit tests, builds the image, and verifies real storage/Queue workflows, same-key concurrent requests, redelivery, relationship/uniqueness failures, query restrictions, idempotent bootstrap/seed, failed-dependency readiness, and restart persistence. MariaDB also tests native JSON validation and server statement interruption. Logs are sanitized and isolated fixtures are removed after each run. Images are not pushed to a registry.

Unit tests use doubles where appropriate and do not establish real database compatibility. Check the branch's GitHub Actions results for live validation. Docker is not required for syntax/unit checks.
