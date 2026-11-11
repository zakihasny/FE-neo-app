CREATE TABLE IF NOT EXISTS employee_jobs (
 job_id CHAR(36) PRIMARY KEY, idempotency_key VARCHAR(128) NOT NULL UNIQUE,
 status VARCHAR(20) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','completed','failed')),
 request_payload JSON NOT NULL, employee_id INT, nats_stream VARCHAR(100), nats_sequence BIGINT,
 error_message VARCHAR(500), created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 published_at TIMESTAMP(3) NULL, completed_at TIMESTAMP(3) NULL, updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 FOREIGN KEY (employee_id) REFERENCES employees(employee_id) ON UPDATE CASCADE ON DELETE SET NULL,
 INDEX jobs_status_created (status,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
