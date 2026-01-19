-- Set test password (testpass123) for real users
-- Super Admin: QK (9537653927)
UPDATE users 
SET password_hash = '$2a$10$hl29kqTpj0Y8P7bxqrYDsua/O46mgOBaOcKaGm0dgHkCRKGZLYH7O' 
WHERE phone = '9537653927';

-- Admin: Abbas Rangoonwala (9730965552)
UPDATE users 
SET password_hash = '$2a$10$hl29kqTpj0Y8P7bxqrYDsua/O46mgOBaOcKaGm0dgHkCRKGZLYH7O' 
WHERE phone = '9730965552';

-- Salesman: Alok (8600259300)
UPDATE users 
SET password_hash = '$2a$10$hl29kqTpj0Y8P7bxqrYDsua/O46mgOBaOcKaGm0dgHkCRKGZLYH7O' 
WHERE phone = '8600259300';

-- Verify updates
SELECT phone, name, role, LENGTH(password_hash) as pw_len 
FROM users 
WHERE phone IN ('9537653927', '9730965552', '8600259300');
