#!/bin/bash
cd /var/www/salesmate-ai
echo "=== visits table schema ==="
sqlite3 local-database.db "PRAGMA table_info(visits);"
