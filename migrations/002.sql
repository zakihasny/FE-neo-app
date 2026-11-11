CREATE OR REPLACE VIEW employee_overview AS
SELECT e.employee_id,e.full_name,e.email,e.job_title,e.hired_date,s.site_name,s.city,st.floor_number,st.seat_code,
 sal.salary_grade,sal.basic_salary,sal.allowance,ed.employee_device_id,ed.device_type,ed.device_brand,ed.serial_number,ed.assigned_date
FROM employees e JOIN sites s ON s.site_id=e.site_id JOIN seating st ON st.seating_id=e.seating_id
JOIN salaries sal ON sal.salary_id=e.salary_id LEFT JOIN employee_devices ed ON ed.employee_id=e.employee_id;
-- next-statement
CREATE OR REPLACE VIEW database_summary AS SELECT
 (SELECT COUNT(*) FROM sites) AS sites,(SELECT COUNT(*) FROM employees) AS employees,(SELECT COUNT(*) FROM employee_devices) AS devices;
