BEGIN;

CREATE TABLE IF NOT EXISTS employee_app.command_jobs (
  job_id uuid PRIMARY KEY,
  idempotency_key varchar(128) NOT NULL UNIQUE,
  resource_type varchar(20) NOT NULL,
  operation varchar(20) NOT NULL DEFAULT 'create',
  status varchar(20) NOT NULL DEFAULT 'queued',
  request_payload jsonb NOT NULL,
  resource_id integer,
  nats_stream varchar(100),
  nats_sequence bigint,
  error_message varchar(500),
  created_at timestamptz NOT NULL DEFAULT current_timestamp,
  published_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT current_timestamp,
  CONSTRAINT command_jobs_resource_type_check
    CHECK (resource_type IN ('employee', 'site', 'device')),
  CONSTRAINT command_jobs_operation_check
    CHECK (operation IN ('create')),
  CONSTRAINT command_jobs_status_check
    CHECK (status IN ('queued', 'processing', 'completed', 'failed'))
);

CREATE INDEX IF NOT EXISTS command_jobs_status_created_at_idx
  ON employee_app.command_jobs(status, created_at);

INSERT INTO employee_app.command_jobs (
  job_id,
  idempotency_key,
  resource_type,
  operation,
  status,
  request_payload,
  resource_id,
  nats_stream,
  nats_sequence,
  error_message,
  created_at,
  published_at,
  completed_at,
  updated_at
)
SELECT
  job_id,
  idempotency_key,
  'employee',
  'create',
  status,
  request_payload,
  employee_id,
  nats_stream,
  nats_sequence,
  error_message,
  created_at,
  published_at,
  completed_at,
  updated_at
FROM employee_app.employee_jobs
ON CONFLICT DO NOTHING;

CREATE UNIQUE INDEX IF NOT EXISTS sites_name_city_unique_idx
  ON employee_app.sites (lower(site_name), lower(city));

INSERT INTO employee_app.schema_migrations (version, description)
VALUES ('004', 'Create generic asynchronous command job tracking')
ON CONFLICT (version) DO NOTHING;

COMMIT;
