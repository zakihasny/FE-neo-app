CREATE TABLE IF NOT EXISTS command_jobs (
 job_id CHAR(36) PRIMARY KEY, idempotency_key VARCHAR(128) NOT NULL UNIQUE,
 resource_type VARCHAR(20) NOT NULL CHECK (resource_type IN ('employee','site','device')),
 operation VARCHAR(20) NOT NULL DEFAULT 'create' CHECK (operation='create'),
 status VARCHAR(20) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','completed','failed')),
 request_payload JSON NOT NULL, resource_id INT, nats_stream VARCHAR(100), nats_sequence BIGINT,
 error_message VARCHAR(500), created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 published_at TIMESTAMP(3) NULL, completed_at TIMESTAMP(3) NULL, updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 INDEX jobs_status_created (status,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
