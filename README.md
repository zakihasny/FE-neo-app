# Employee Database Lab — MariaDB variant

Branch **`db-mariadb`** replaces the PostgreSQL runtime dependency with **MariaDB 11.4**, using **mariadb@3.5.5**. It targets a fresh store; it does not convert existing PostgreSQL data. Node.js 22+ and pnpm 11.16.0 are required; the retained Dockerfile uses Node.js 24.

## Architecture

The same process serves three pages and the API, publishes asynchronous commands to NATS JetStream, and runs the three command consumers:

```text
Browser -> Web/API -> MariaDB: persistent jobs
                  -> NATS JetStream -> command consumers -> MariaDB: entities + job results
```

The repository uses InnoDB transactions, parameterized statements, row locks, foreign keys, and uniqueness indexes. Site uniqueness is case-insensitive for name/city; employee emails and serial numbers are normalized by application validation. Job completion is committed together with the new entity. Duplicate delivery returns the original resource ID.

NATS remains required. Use a dedicated queue for this application variant; consumers on a shared stream process the same subjects. Retention is work queue, storage is file, and explicit acknowledgements follow persisted completion or a persisted permanent rejection. Database/network failures remain retryable.

## Pages and API

- `/`: current site, employee, and device counts.
- `/input.html`: asynchronous site, employee, and device forms.
- `/query.html`: read-only SQL console.
- `GET /api/summary`, `GET /api/meta`: counts and form references.
- `POST /api/sites`, `/api/employees`, `/api/devices`: HTTP 202 with a persistent job ID.
- `GET /api/jobs/:jobId`: queued/processing/completed/failed state and resulting resource ID.
- `GET/HEAD /healthz`: process liveness without database or Queue checks.
- `GET/HEAD /health/ready`: HTTP 200 only when storage and Queue are ready; response includes `engine`, `version`, `database`, and `queue`. Dependency failure returns 503. The old `postgresqlMajor` field is removed.

The frontend retains the existing design and data-entry fields. IDs remain numeric. A device must belong to its employee's site; a seat must belong to the employee's selected site. Credentials remain server-side. This demo has no application authentication: use synthetic data and add an appropriate access layer before handling private records.

## Runtime variables

| Variable | Requirement/default |
| --- | --- |
| `DATABASE_URL` | Required `mysql://user:password@host:3306/database`; the selected database must already exist. |
| `MARIADB_TLS` | Enable verified TLS with `true`; default `false` for private/local fixtures. |
| `MARIADB_CA_FILE` | Optional mounted CA file; requires TLS enabled. |
| `NATS_URL` | Required `nats://user:password@host:4222` or supported TLS/token endpoint. |
| `PORT` | Default `80`, overridable; HTTP binds `0.0.0.0`. |
| `NODE_ENV` | `production` in the Dockerfile. |
| `RUN_DB_MIGRATIONS` | Default `true`; performs SQL migrations before HTTP startup. |
| `SEED_SAMPLE_DATA` | Default `false`; opt in only for a fresh demo store. |

`.env.example` is a template, not an actual credential file. Native `pnpm start` reads process environment variables; it does not automatically load `.env`. Export them or use your runtime's environment/secret injection. URL-encode connection credentials. Never place connection URLs in browser assets or commit real environment files. TLS verification must remain enabled when using encrypted endpoints.

## Bootstrap and sample data

`pnpm migrate` applies four versioned migrations in the database selected by `DATABASE_URL`. No separate `employee_app` database is created. The migration account needs DDL and DML privileges in that database. A database-scoped named lock serializes bootstrap. DDL can implicitly commit, so each step is restartable and its version is recorded only after all its statements succeed. A failed migration can leave completed DDL; correct the underlying issue and rerun rather than assuming rollback removed it.

Sample data includes two sites, three salary grades, three seats, three employees, and four devices. The seed is marked once and repeat startup does not duplicate it. Enabling seed on a nonempty, unseeded store is rejected rather than overwriting data. Regular data entry requires salary/seating reference rows; those references are provided by the optional sample seed or operator-managed initialization.

## Query console

`POST /api/query` retains the `{ "sql": "SELECT 1 AS value" }` request format. The console accepts one read-only SELECT/CTE query, wraps it with an outer 200-row limit, rejects comments, session variables, locking, file access, and known side-effect functions, and runs it in a read-only transaction. Query presets use unqualified application table/view names. Reporting connections are discarded afterward so session settings do not leak to writers.

MariaDB uses `max_statement_time=5`. Server interruption is best-effort and may occur after the configured limit; a client deadline additionally destroys the reporting connection. MariaDB `JSON` is a validated LONGTEXT alias, not MySQL binary JSON. Connector BigInts are normalized before JSON responses. A six-second client deadline complements the five-second server limit.

## Local and deployment use

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm check
corepack pnpm test
# Export the required runtime variables first; PORT=8080 is convenient locally.
corepack pnpm start
```

Build with `docker build -t fe-db-mariadb:local .`. Run using runtime secrets and the matching MariaDB/NATS endpoints; do not use test Compose credentials for deployment. The image exposes port 80 by default, starts `node server/index.js`, and retains `/healthz` Docker health checking. Configure platform readiness at `/health/ready` and startup grace of at least 240 seconds. No cloud deployment is performed by the CI workflow.

## Integration tests

Docker is required for live integration. `compose.test.yaml` is an isolated fixture with **test-only credentials**, loopback host ports, persistent test volumes, NATS JetStream, and two application instances sharing the same store. The second instance exercises concurrent migrations and command handling. It is not a production deployment template.

```sh
docker compose -f compose.test.yaml up --build -d
RUN_INTEGRATION=true corepack pnpm test:integration
# Destructive cleanup of this disposable test stack and its volumes only:
docker compose -f compose.test.yaml down -v --remove-orphans
```

In PowerShell, set `$env:RUN_INTEGRATION = 'true'` before `corepack pnpm test:integration`. Live tests are skipped unless this flag is enabled. They use fixed loopback fixture endpoints, create synthetic data, and restart the test services. SQL variants additionally create and remove a uniquely named migration-recovery database using test-only administrator access.

CI runs on pushes to `db-mariadb` using Ubuntu 24.04, Node.js 24, and pnpm 11.16.0. It checks syntax and unit tests, builds the image, and verifies real storage/Queue workflows, same-key concurrent requests, redelivery, relationship/uniqueness failures, query restrictions, idempotent bootstrap/seed, failed-dependency readiness, and restart persistence. MariaDB also tests native JSON validation and server statement interruption. Logs are sanitized and isolated fixtures are removed after each run. Images are not pushed to a registry.

Unit tests use doubles where appropriate and do not establish real database compatibility. Check the branch's GitHub Actions results for live validation. Docker is not required for syntax/unit checks.
