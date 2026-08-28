BEGIN;

CREATE OR REPLACE VIEW employee_app.employee_overview AS
SELECT
  e.employee_id,
  e.full_name,
  e.email,
  e.job_title,
  e.hired_date,
  s.site_name,
  s.city,
  st.floor_number,
  st.seat_code,
  sal.salary_grade,
  sal.basic_salary,
  sal.allowance,
  ed.employee_device_id,
  ed.device_type,
  ed.device_brand,
  ed.serial_number,
  ed.assigned_date
FROM employee_app.employees AS e
JOIN employee_app.sites AS s
  ON s.site_id = e.site_id
JOIN employee_app.seating AS st
  ON st.seating_id = e.seating_id
JOIN employee_app.salaries AS sal
  ON sal.salary_id = e.salary_id
LEFT JOIN employee_app.employee_devices AS ed
  ON ed.employee_id = e.employee_id;

CREATE OR REPLACE VIEW employee_app.database_summary AS
SELECT
  (SELECT count(*) FROM employee_app.sites) AS sites,
  (SELECT count(*) FROM employee_app.employees) AS employees,
  (SELECT count(*) FROM employee_app.employee_devices) AS devices;

INSERT INTO employee_app.schema_migrations (version, description)
VALUES ('002', 'Create API support views')
ON CONFLICT (version) DO NOTHING;

COMMIT;
