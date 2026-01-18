const db = require('better-sqlite3')('./local-database.db');
const fs = require('fs');

console.log('Dropping old tables...');
db.exec('DROP TABLE IF EXISTS role_permissions');
db.exec('DROP TABLE IF EXISTS user_roles');
db.exec('DROP TABLE IF EXISTS roles');
db.exec('DROP TABLE IF EXISTS permissions');
db.exec('DROP TABLE IF EXISTS resource_permissions');
db.exec('DROP TABLE IF EXISTS permission_audit_log');
db.exec('DROP TABLE IF EXISTS team_hierarchy');

console.log('Creating RBAC tables...');
const sql = fs.readFileSync('./migrations/create_rbac_system.sql', 'utf8');
db.exec(sql);

console.log('Loading permissions...');
const permsScript = fs.readFileSync('./load-permissions.js', 'utf8');
eval(permsScript.replace('const Database = require(\'better-sqlite3\');', '')
                 .replace('const path = require(\'path\');', '')
                 .replace('const db = new Database(path.join(__dirname, \'local-database.db\'));', '')
                 .replace('db.close();', ''));

console.log('Initializing system roles...');
const RBACService = require('./services/rbac-service');
const tenant = db.prepare('SELECT id FROM tenants LIMIT 1').get();
const result = RBACService.initializeSystemRoles(tenant.id);
console.log('Roles created:', result.rolesCreated);

console.log('\nRBAC setup complete!');
db.close();
