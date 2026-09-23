BEGIN;

DO $$
DECLARE
  server_major_version integer := current_setting('server_version_num')::integer / 10000;
BEGIN
  IF server_major_version <> 16 THEN
    RAISE EXCEPTION 'FE-neo-app requires PostgreSQL 16; connected server major version is %', server_major_version;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS employee_app.employee_jobs (
  job_id uuid PRIMARY KEY,
  idempotency_key varchar(128) NOT NULL UNIQUE,
  status varchar(20) NOT NULL DEFAULT 'queued',
  request_payload jsonb NOT NULL,
  employee_id integer,
  nats_stream varchar(100),
  nats_sequence bigint,
  error_message varchar(500),
  created_at timestamptz NOT NULL DEFAULT current_timestamp,
  published_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT current_timestamp,
  CONSTRAINT employee_jobs_status_check
    CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  CONSTRAINT employee_jobs_employee_fk
    FOREIGN KEY (employee_id) REFERENCES employee_app.employees(employee_id)
    ON UPDATE CASCADE
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS employee_jobs_status_created_at_idx
  ON employee_app.employee_jobs(status, created_at);

INSERT INTO employee_app.schema_migrations (version, description)
VALUES ('003', 'Create asynchronous employee job tracking')
ON CONFLICT (version) DO NOTHING;

COMMIT;
