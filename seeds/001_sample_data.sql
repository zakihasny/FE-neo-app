BEGIN;

INSERT INTO employee_app.sites (site_id, site_name, city, address) VALUES
  (1, 'Head Office', 'Jakarta', 'Jl. Testing No. 1'),
  (2, 'Branch Office', 'Bandung', 'Jl. Sample No. 2')
ON CONFLICT DO NOTHING;

INSERT INTO employee_app.salaries
  (salary_id, salary_grade, basic_salary, allowance)
VALUES
  (1, 'Junior', 6000000.00, 750000.00),
  (2, 'Middle', 10000000.00, 1250000.00),
  (3, 'Senior', 15000000.00, 2000000.00)
ON CONFLICT DO NOTHING;

INSERT INTO employee_app.seating
  (seating_id, site_id, floor_number, seat_code)
VALUES
  (1, 1, '10', 'JKT-10-A01'),
  (2, 1, '10', 'JKT-10-A02'),
  (3, 2, '3', 'BDG-03-B01')
ON CONFLICT DO NOTHING;

INSERT INTO employee_app.employees
  (employee_id, site_id, salary_id, seating_id, full_name, email, job_title, hired_date)
VALUES
  (1, 1, 1, 1, 'Ahmad Zaki', 'ahmad.zaki@example.com', 'Frontend Developer', DATE '2026-01-15'),
  (2, 1, 2, 2, 'Budi Santoso', 'budi.santoso@example.com', 'Backend Developer', DATE '2025-09-01'),
  (3, 2, 3, 3, 'Citra Lestari', 'citra.lestari@example.com', 'Project Manager', DATE '2024-05-20')
ON CONFLICT DO NOTHING;

INSERT INTO employee_app.employee_devices
  (employee_device_id, employee_id, site_id, device_type, device_brand, serial_number, assigned_date)
VALUES
  (1, 1, 1, 'Laptop', 'Lenovo', 'LNV-JKT-0001', DATE '2026-01-16'),
  (2, 2, 1, 'Laptop', 'Dell', 'DLL-JKT-0002', DATE '2025-09-02'),
  (3, 3, 2, 'Laptop', 'HP', 'HP-BDG-0003', DATE '2024-05-21'),
  (4, 1, 1, 'Monitor', 'LG', 'LG-JKT-0004', DATE '2026-01-16')
ON CONFLICT DO NOTHING;

SELECT setval(
  pg_get_serial_sequence('employee_app.sites', 'site_id'),
  coalesce((SELECT max(site_id) FROM employee_app.sites), 1),
  EXISTS (SELECT 1 FROM employee_app.sites)
);

SELECT setval(
  pg_get_serial_sequence('employee_app.salaries', 'salary_id'),
  coalesce((SELECT max(salary_id) FROM employee_app.salaries), 1),
  EXISTS (SELECT 1 FROM employee_app.salaries)
);

SELECT setval(
  pg_get_serial_sequence('employee_app.seating', 'seating_id'),
  coalesce((SELECT max(seating_id) FROM employee_app.seating), 1),
  EXISTS (SELECT 1 FROM employee_app.seating)
);

SELECT setval(
  pg_get_serial_sequence('employee_app.employees', 'employee_id'),
  coalesce((SELECT max(employee_id) FROM employee_app.employees), 1),
  EXISTS (SELECT 1 FROM employee_app.employees)
);

SELECT setval(
  pg_get_serial_sequence('employee_app.employee_devices', 'employee_device_id'),
  coalesce((SELECT max(employee_device_id) FROM employee_app.employee_devices), 1),
  EXISTS (SELECT 1 FROM employee_app.employee_devices)
);

COMMIT;
