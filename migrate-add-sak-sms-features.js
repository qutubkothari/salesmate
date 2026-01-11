/**
 * SAK-SMS Features Migration Script
 * Adds all SAK-SMS intelligence features to Salesmate database
 * Run: node migrate-add-sak-sms-features.js
 */

const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'local-database.db');
const db = new Database(dbPath);

console.log('🚀 Starting SAK-SMS features migration to Salesmate...\n');

// ==========================================
// PHASE 1: CREATE NEW TABLES
// ==========================================

const newTables = [
  {
    name: 'salesman',
    sql: `
      CREATE TABLE IF NOT EXISTS salesman (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL,
        user_id TEXT,
        name TEXT NOT NULL,
        email TEXT,
        phone TEXT,
        
        capacity INTEGER DEFAULT 0,
        min_leads_per_month INTEGER DEFAULT 0,
        max_leads_per_month INTEGER DEFAULT 50,
        use_intelligent_override BOOLEAN DEFAULT 1,
        
        score REAL DEFAULT 0.0,
        total_success_events INTEGER DEFAULT 0,
        total_leads_handled INTEGER DEFAULT 0,
        avg_response_time_minutes REAL DEFAULT 0.0,
        
        product_skills TEXT,
        language_skills TEXT,
        geographic_zone TEXT,
        
        active BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
      )
    `
  },
  
  {
    name: 'tasks',
    sql: `
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL,
        
        title TEXT NOT NULL,
        description TEXT,
        
        lead_id INTEGER,
        conversation_id INTEGER,
        assigned_to TEXT,
        assigned_by TEXT,
        
        priority TEXT DEFAULT 'MEDIUM',
        status TEXT DEFAULT 'PENDING',
        
        due_date DATETIME,
        reminder_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME,
        cancelled_at DATETIME,
        
        metadata TEXT,
        
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
        FOREIGN KEY (lead_id) REFERENCES customer_profiles(id) ON DELETE CASCADE,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      )
    `
  },
  
  {
    name: 'calls',
    sql: `
      CREATE TABLE IF NOT EXISTS calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL,
        
        lead_id INTEGER,
        conversation_id INTEGER,
        phone_number TEXT NOT NULL,
        
        direction TEXT NOT NULL,
        outcome TEXT,
        duration_seconds INTEGER DEFAULT 0,
        
        notes TEXT,
        recording_url TEXT,
        
        handled_by TEXT,
        
        scheduled_for DATETIME,
        started_at DATETIME,
        ended_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        
        metadata TEXT,
        
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
        FOREIGN KEY (lead_id) REFERENCES customer_profiles(id) ON DELETE SET NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
      )
    `
  },
  
  {
    name: 'success_definitions',
    sql: `
      CREATE TABLE IF NOT EXISTS success_definitions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL,
        
        event_type TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        
        weight INTEGER DEFAULT 10,
        
        active BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
        UNIQUE(tenant_id, event_type)
      )
    `
  },
  
  {
    name: 'success_events',
    sql: `
      CREATE TABLE IF NOT EXISTS success_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL,
        
        definition_id INTEGER NOT NULL,
        lead_id INTEGER,
        conversation_id INTEGER,
        
        salesman_id INTEGER,
        salesman_email TEXT,
        
        notes TEXT,
        value REAL,
        
        event_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        
        metadata TEXT,
        
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
        FOREIGN KEY (definition_id) REFERENCES success_definitions(id) ON DELETE CASCADE,
        FOREIGN KEY (lead_id) REFERENCES customer_profiles(id) ON DELETE SET NULL,
        FOREIGN KEY (salesman_id) REFERENCES salesman(id) ON DELETE SET NULL
      )
    `
  },
  
  {
    name: 'sla_rules',
    sql: `
      CREATE TABLE IF NOT EXISTS sla_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL,
        
        name TEXT NOT NULL,
        trigger_condition TEXT NOT NULL,
        
        response_time_minutes INTEGER NOT NULL,
        escalation_time_minutes INTEGER,
        
        heat_level TEXT,
        channel TEXT,
        
        notify_roles TEXT,
        auto_reassign BOOLEAN DEFAULT 0,
        
        active BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
      )
    `
  },
  
  {
    name: 'sla_violations',
    sql: `
      CREATE TABLE IF NOT EXISTS sla_violations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL,
        
        rule_id INTEGER NOT NULL,
        conversation_id INTEGER,
        lead_id INTEGER,
        
        triggered_at DATETIME NOT NULL,
        due_at DATETIME NOT NULL,
        responded_at DATETIME,
        breach_duration_minutes INTEGER,
        
        escalated BOOLEAN DEFAULT 0,
        escalated_at DATETIME,
        notifications_sent INTEGER DEFAULT 0,
        
        resolved BOOLEAN DEFAULT 0,
        resolved_at DATETIME,
        resolution_notes TEXT,
        
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
        FOREIGN KEY (rule_id) REFERENCES sla_rules(id) ON DELETE CASCADE,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL,
        FOREIGN KEY (lead_id) REFERENCES customer_profiles(id) ON DELETE SET NULL
      )
    `
  },
  
  {
    name: 'notes',
    sql: `
      CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL,
        
        content TEXT NOT NULL,
        
        lead_id INTEGER,
        conversation_id INTEGER,
        task_id INTEGER,
        
        created_by TEXT,
        
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
        FOREIGN KEY (lead_id) REFERENCES customer_profiles(id) ON DELETE CASCADE,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      )
    `
  },
  
  {
    name: 'lead_events',
    sql: `
      CREATE TABLE IF NOT EXISTS lead_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL,
        
        event_type TEXT NOT NULL,
        lead_id INTEGER,
        conversation_id INTEGER,
        
        triggered_by TEXT,
        
        payload TEXT,
        
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
        FOREIGN KEY (lead_id) REFERENCES customer_profiles(id) ON DELETE CASCADE
      )
    `
  },
  
  {
    name: 'assignment_config',
    sql: `
      CREATE TABLE IF NOT EXISTS assignment_config (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL UNIQUE,
        
        strategy TEXT DEFAULT 'ROUND_ROBIN',
        
        auto_assign BOOLEAN DEFAULT 1,
        consider_capacity BOOLEAN DEFAULT 1,
        consider_score BOOLEAN DEFAULT 0,
        consider_skills BOOLEAN DEFAULT 0,
        
        custom_rules TEXT,
        
        active BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
      )
    `
  }
];

// Create new tables
console.log('📋 Creating new tables...\n');
let tablesCreated = 0;

newTables.forEach((table) => {
  try {
    db.exec(table.sql);
    console.log(`  ✅ ${table.name}`);
    tablesCreated++;
  } catch (err) {
    if (err.message.includes('already exists')) {
      console.log(`  ⏭️  ${table.name} (already exists)`);
    } else {
      console.error(`  ❌ ${table.name}: ${err.message}`);
    }
  }
});

console.log(`\n📊 Tables created: ${tablesCreated}/${newTables.length}\n`);

// ==========================================
// PHASE 2: CREATE INDEXES
// ==========================================

const indexes = [
  'CREATE INDEX IF NOT EXISTS idx_salesman_tenant ON salesman(tenant_id)',
  'CREATE INDEX IF NOT EXISTS idx_salesman_active ON salesman(tenant_id, active)',
  
  'CREATE INDEX IF NOT EXISTS idx_tasks_tenant ON tasks(tenant_id)',
  'CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(tenant_id, assigned_to, status)',
  'CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(tenant_id, due_date)',
  
  'CREATE INDEX IF NOT EXISTS idx_calls_tenant ON calls(tenant_id)',
  'CREATE INDEX IF NOT EXISTS idx_calls_lead ON calls(tenant_id, lead_id)',
  'CREATE INDEX IF NOT EXISTS idx_calls_scheduled ON calls(tenant_id, scheduled_for)',
  
  'CREATE INDEX IF NOT EXISTS idx_success_defs_tenant ON success_definitions(tenant_id, active)',
  
  'CREATE INDEX IF NOT EXISTS idx_success_events_tenant ON success_events(tenant_id)',
  'CREATE INDEX IF NOT EXISTS idx_success_events_salesman ON success_events(tenant_id, salesman_id)',
  'CREATE INDEX IF NOT EXISTS idx_success_events_lead ON success_events(tenant_id, lead_id)',
  
  'CREATE INDEX IF NOT EXISTS idx_sla_rules_tenant ON sla_rules(tenant_id, active)',
  
  'CREATE INDEX IF NOT EXISTS idx_sla_violations_tenant ON sla_violations(tenant_id)',
  'CREATE INDEX IF NOT EXISTS idx_sla_violations_active ON sla_violations(tenant_id, resolved)',
  
  'CREATE INDEX IF NOT EXISTS idx_notes_tenant ON notes(tenant_id)',
  'CREATE INDEX IF NOT EXISTS idx_notes_lead ON notes(tenant_id, lead_id)',
  
  'CREATE INDEX IF NOT EXISTS idx_lead_events_tenant ON lead_events(tenant_id)',
  'CREATE INDEX IF NOT EXISTS idx_lead_events_lead ON lead_events(tenant_id, lead_id)',
  'CREATE INDEX IF NOT EXISTS idx_lead_events_type ON lead_events(tenant_id, event_type)'
];

console.log('🔍 Creating indexes...\n');
let indexesCreated = 0;

indexes.forEach((sql, index) => {
  try {
    db.exec(sql);
    indexesCreated++;
  } catch (err) {
    console.error(`  ❌ Index ${index + 1}: ${err.message}`);
  }
});

console.log(`  ✅ Created ${indexesCreated}/${indexes.length} indexes\n`);

// ==========================================
// PHASE 3: ALTER EXISTING TABLES
// ==========================================

const alterations = [
  // Conversations table
  { table: 'conversations', column: 'heat', sql: `ALTER TABLE conversations ADD COLUMN heat TEXT DEFAULT 'COLD'` },
  { table: 'conversations', column: 'qualification_level', sql: `ALTER TABLE conversations ADD COLUMN qualification_level TEXT` },
  { table: 'conversations', column: 'status', sql: `ALTER TABLE conversations ADD COLUMN status TEXT DEFAULT 'OPEN'` },
  { table: 'conversations', column: 'assigned_to', sql: `ALTER TABLE conversations ADD COLUMN assigned_to TEXT` },
  { table: 'conversations', column: 'last_activity_at', sql: `ALTER TABLE conversations ADD COLUMN last_activity_at DATETIME DEFAULT CURRENT_TIMESTAMP` },
  { table: 'conversations', column: 'ai_confidence', sql: `ALTER TABLE conversations ADD COLUMN ai_confidence REAL` },
  { table: 'conversations', column: 'ai_suggested_assignment', sql: `ALTER TABLE conversations ADD COLUMN ai_suggested_assignment TEXT` },
  
  // Customer profiles table
  { table: 'customer_profiles', column: 'salesman_id', sql: `ALTER TABLE customer_profiles ADD COLUMN salesman_id INTEGER` },
  { table: 'customer_profiles', column: 'heat', sql: `ALTER TABLE customer_profiles ADD COLUMN heat TEXT DEFAULT 'COLD'` },
  { table: 'customer_profiles', column: 'qualification_level', sql: `ALTER TABLE customer_profiles ADD COLUMN qualification_level TEXT` },
  
  // Tenants table - AI provider selection
  { table: 'tenants', column: 'preferred_ai_provider', sql: `ALTER TABLE tenants ADD COLUMN preferred_ai_provider TEXT DEFAULT 'OPENAI'` },
  { table: 'tenants', column: 'ai_model', sql: `ALTER TABLE tenants ADD COLUMN ai_model TEXT DEFAULT 'gpt-4o-mini'` }
];

console.log('🔧 Extending existing tables...\n');
let columnsAdded = 0;

alterations.forEach((alteration) => {
  try {
    db.exec(alteration.sql);
    console.log(`  ✅ ${alteration.table}.${alteration.column}`);
    columnsAdded++;
  } catch (err) {
    if (err.message.includes('duplicate column')) {
      console.log(`  ⏭️  ${alteration.table}.${alteration.column} (already exists)`);
    } else {
      console.error(`  ❌ ${alteration.table}.${alteration.column}: ${err.message}`);
    }
  }
});

console.log(`\n📊 Columns added: ${columnsAdded}/${alterations.length}\n`);

// ==========================================
// PHASE 4: SEED DEFAULT DATA
// ==========================================

console.log('🌱 Seeding default data...\n');

// Get all tenants
const tenants = db.prepare('SELECT id FROM tenants').all();

if (tenants.length > 0) {
  tenants.forEach(tenant => {
    // Create default assignment config
    try {
      const existingConfig = db.prepare('SELECT id FROM assignment_config WHERE tenant_id = ?').get(tenant.id);
      if (!existingConfig) {
        db.prepare(`
          INSERT INTO assignment_config (tenant_id, strategy, auto_assign, consider_capacity)
          VALUES (?, 'ROUND_ROBIN', 1, 1)
        `).run(tenant.id);
        console.log(`  ✅ Assignment config for tenant: ${tenant.id}`);
      }
    } catch (err) {
      console.error(`  ❌ Assignment config error: ${err.message}`);
    }
    
    // Create default success definitions
    const defaultSuccessEvents = [
      { type: 'DEMO_BOOKED', name: 'Demo Booked', weight: 10 },
      { type: 'PAYMENT_RECEIVED', name: 'Payment Received', weight: 50 },
      { type: 'ORDER_RECEIVED', name: 'Order Received', weight: 100 },
      { type: 'CONTRACT_SIGNED', name: 'Contract Signed', weight: 150 }
    ];
    
    defaultSuccessEvents.forEach(event => {
      try {
        const existing = db.prepare('SELECT id FROM success_definitions WHERE tenant_id = ? AND event_type = ?')
          .get(tenant.id, event.type);
        
        if (!existing) {
          db.prepare(`
            INSERT INTO success_definitions (tenant_id, event_type, name, weight)
            VALUES (?, ?, ?, ?)
          `).run(tenant.id, event.type, event.name, event.weight);
          console.log(`  ✅ Success definition: ${event.name} for tenant ${tenant.id}`);
        }
      } catch (err) {
        console.error(`  ❌ Success definition error: ${err.message}`);
      }
    });
    
    // Create default SLA rules
    const defaultSlaRules = [
      { name: 'New Lead Response', trigger: 'NEW_LEAD', responseTime: 15 },
      { name: 'Message Response', trigger: 'MESSAGE_RECEIVED', responseTime: 30 },
      { name: 'Triage Response', trigger: 'TRIAGE_ESCALATED', responseTime: 10 }
    ];
    
    defaultSlaRules.forEach(rule => {
      try {
        const existing = db.prepare('SELECT id FROM sla_rules WHERE tenant_id = ? AND trigger_condition = ?')
          .get(tenant.id, rule.trigger);
        
        if (!existing) {
          db.prepare(`
            INSERT INTO sla_rules (tenant_id, name, trigger_condition, response_time_minutes)
            VALUES (?, ?, ?, ?)
          `).run(tenant.id, rule.name, rule.trigger, rule.responseTime);
          console.log(`  ✅ SLA rule: ${rule.name} for tenant ${tenant.id}`);
        }
      } catch (err) {
        console.error(`  ❌ SLA rule error: ${err.message}`);
      }
    });
  });
} else {
  console.log('  ⚠️  No tenants found - skipping seed data');
}

// ==========================================
// PHASE 5: VERIFICATION
// ==========================================

console.log('\n🔍 Verifying migration...\n');

const verificationQueries = [
  { name: 'salesman', query: 'SELECT COUNT(*) as count FROM salesman' },
  { name: 'tasks', query: 'SELECT COUNT(*) as count FROM tasks' },
  { name: 'calls', query: 'SELECT COUNT(*) as count FROM calls' },
  { name: 'success_definitions', query: 'SELECT COUNT(*) as count FROM success_definitions' },
  { name: 'success_events', query: 'SELECT COUNT(*) as count FROM success_events' },
  { name: 'sla_rules', query: 'SELECT COUNT(*) as count FROM sla_rules' },
  { name: 'sla_violations', query: 'SELECT COUNT(*) as count FROM sla_violations' },
  { name: 'notes', query: 'SELECT COUNT(*) as count FROM notes' },
  { name: 'lead_events', query: 'SELECT COUNT(*) as count FROM lead_events' },
  { name: 'assignment_config', query: 'SELECT COUNT(*) as count FROM assignment_config' }
];

verificationQueries.forEach(({ name, query }) => {
  try {
    const result = db.prepare(query).get();
    console.log(`  ✅ ${name}: ${result.count} records`);
  } catch (err) {
    console.error(`  ❌ ${name}: ${err.message}`);
  }
});

// Check for new columns
console.log('\n📋 Checking new columns...');
try {
  const conversationsInfo = db.pragma('table_info(conversations)');
  const hasHeat = conversationsInfo.some(col => col.name === 'heat');
  const hasStatus = conversationsInfo.some(col => col.name === 'status');
  const hasAssignedTo = conversationsInfo.some(col => col.name === 'assigned_to');
  
  console.log(`  ${hasHeat ? '✅' : '❌'} conversations.heat`);
  console.log(`  ${hasStatus ? '✅' : '❌'} conversations.status`);
  console.log(`  ${hasAssignedTo ? '✅' : '❌'} conversations.assigned_to`);
} catch (err) {
  console.error(`  ❌ Column check failed: ${err.message}`);
}

db.close();

console.log('\n✅ SAK-SMS features migration complete!\n');
console.log('📌 Next Steps:');
console.log('   1. Review new tables in database');
console.log('   2. Start implementing services (heatScoringService.js, assignmentService.js, etc.)');
console.log('   3. Update dashboard UI with new features');
console.log('   4. Test assignment logic with sample data');
console.log('   5. Deploy incrementally (one feature at a time)\n');
