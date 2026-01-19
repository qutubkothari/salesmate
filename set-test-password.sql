-- Set test password for user 1234567890
-- Password: testpass123
UPDATE users 
SET password_hash = '$2a$10$S93eg/29rTj8MiFj.ZxmeecxWldJcaRUZk0qbaNBfarrBOdcWX5yG' 
WHERE phone = '1234567890';

SELECT phone, role, name, LENGTH(password_hash) as pw_len 
FROM users 
WHERE phone = '1234567890';
