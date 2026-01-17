#!/bin/bash
cd /var/www/salesmate-ai
echo "=== FSM-related tables ==="
sqlite3 local-database.db "SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%customer%' OR name LIKE '%visit%' OR name LIKE '%route%' OR name LIKE '%salesman%') ORDER BY name;"
