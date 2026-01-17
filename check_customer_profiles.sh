#!/bin/bash
cd /var/www/salesmate-ai
echo "=== customer_profiles_new schema ==="
sqlite3 local-database.db "PRAGMA table_info(customer_profiles_new);"
echo ""
echo "=== Sample customer ==="
sqlite3 -header -column local-database.db "SELECT * FROM customer_profiles_new LIMIT 1;"
