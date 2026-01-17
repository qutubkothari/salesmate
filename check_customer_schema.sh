#!/bin/bash
cd /var/www/salesmate-ai
echo "=== customers_engaged_new schema ==="
sqlite3 local-database.db "PRAGMA table_info(customers_engaged_new);"
echo ""
echo "=== Sample row ==="
sqlite3 -header -column local-database.db "SELECT * FROM customers_engaged_new LIMIT 1;"
