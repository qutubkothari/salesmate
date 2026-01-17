#!/bin/bash
cd /var/www/salesmate-ai
echo "=== Salesmen with passwords ==="
sqlite3 -header -column local-database.db "SELECT s.id, s.name, s.phone, u.role, length(u.password_hash) as pwd_len FROM salesmen s LEFT JOIN users u ON s.user_id = u.id WHERE u.password_hash IS NOT NULL LIMIT 10;"

echo ""
echo "=== Checking phone 8484830022 ==="
sqlite3 -header -column local-database.db "SELECT s.id, s.name, s.phone, s.user_id, u.phone as u_phone, u.role, length(u.password_hash) as pwd_len FROM salesmen s LEFT JOIN users u ON s.user_id = u.id WHERE s.phone LIKE '%8484830022%' OR s.phone LIKE '%484830022%';"

echo ""
echo "=== All users matching phone ==="
sqlite3 -header -column local-database.db "SELECT id, phone, role, is_active, length(password_hash) as pwd_len FROM users WHERE phone LIKE '%8484830022%' OR phone LIKE '%484830022%';"
