# SAK-SMS → Salesmate Migration Plan
**Date:** January 11, 2026  
**Objective:** Integrate all SAK-SMS intelligence features into Salesmate before discontinuing SAK-SMS  
**Approach:** Incremental implementation with backward compatibility

---

## Migration Strategy

**Goal:** Make Salesmate the **single unified platform** with all intelligence features from SAK-SMS.

**Principles:**
- ✅ Backward compatible - don't break existing features
- ✅ Incremental deployment - one phase at a time
- ✅ SQLite-first - maintain simple database architecture
- ✅ OpenAI/Gemini support - multi-provider AI
- ✅ Keep dashboard UI - extend existing tabs

---

## Phase 1: Database Schema Extensions (Week 1)

### 1.1 Salesman Management Table
```sql
CREATE TABLE IF NOT EXISTS salesman (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  user_id TEXT,  -- Link to existing user if applicable
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  
  -- Capacity Management
  capacity INTEGER DEFAULT 0,  -- Current active leads count
  min_leads_per_month INTEGER DEFAULT 0,
  max_leads_per_month INTEGER DEFAULT 50,
  use_intelligent_override BOOLEAN DEFAULT 1,  -- Allow override for hot leads
  
  -- Performance Scoring
  score REAL DEFAULT 0.0,  -- Calculated performance score
  total_success_events INTEGER DEFAULT 0,
  total_leads_handled INTEGER DEFAULT 0,
  avg_response_time_minutes REAL DEFAULT 0.0,
  
  -- Skills & Preferences
  product_skills TEXT,  -- JSON array: ["electronics", "furniture"]
  language_skills TEXT,  -- JSON array: ["en", "hi", "ar"]
  geographic_zone TEXT,  -- For territory-based assignment
  
  -- Status
  active BOOLEAN DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX idx_salesman_tenant ON salesman(tenant_id);
CREATE INDEX idx_salesman_active ON salesman(tenant_id, active);
```

### 1.2 Tasks Management Table
```sql
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  
  -- Task Details
  title TEXT NOT NULL,
  description TEXT,
  
  -- Assignment
  lead_id INTEGER,  -- Link to customer_profiles
  conversation_id INTEGER,  -- Link to conversations
  assigned_to TEXT,  -- Salesman email or user_id
  assigned_by TEXT,
  
  -- Priority & Status
  priority TEXT DEFAULT 'MEDIUM',  -- LOW, MEDIUM, HIGH, URGENT
  status TEXT DEFAULT 'PENDING',  -- PENDING, IN_PROGRESS, COMPLETED, CANCELLED
  
  -- Timing
  due_date DATETIME,
  reminder_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME,
  cancelled_at DATETIME,
  
  -- Metadata
  metadata TEXT,  -- JSON for additional context
  
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (lead_id) REFERENCES customer_profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE INDEX idx_tasks_tenant ON tasks(tenant_id);
CREATE INDEX idx_tasks_assigned ON tasks(tenant_id, assigned_to, status);
CREATE INDEX idx_tasks_due ON tasks(tenant_id, due_date);
```

### 1.3 Phone Calls Logging Table
```sql
CREATE TABLE IF NOT EXISTS calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  
  -- Call Details
  lead_id INTEGER,
  conversation_id INTEGER,
  phone_number TEXT NOT NULL,
  
  -- Call Metadata
  direction TEXT NOT NULL,  -- INBOUND, OUTBOUND
  outcome TEXT,  -- ANSWERED, NO_ANSWER, BUSY, VOICEMAIL, WRONG_NUMBER, CALLBACK_REQUESTED
  duration_seconds INTEGER DEFAULT 0,
  
  -- Notes & Recording
  notes TEXT,
  recording_url TEXT,
  
  -- Salesman
  handled_by TEXT,  -- Salesman email or user_id
  
  -- Timing
  scheduled_for DATETIME,  -- For callbacks
  started_at DATETIME,
  ended_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  -- Metadata
  metadata TEXT,  -- JSON
  
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (lead_id) REFERENCES customer_profiles(id) ON DELETE SET NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
);

CREATE INDEX idx_calls_tenant ON calls(tenant_id);
CREATE INDEX idx_calls_lead ON calls(tenant_id, lead_id);
CREATE INDEX idx_calls_scheduled ON calls(tenant_id, scheduled_for);
```

### 1.4 Success Definitions Table
```sql
CREATE TABLE IF NOT EXISTS success_definitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  
  -- Definition
  event_type TEXT NOT NULL,  -- DEMO_BOOKED, PAYMENT_RECEIVED, ORDER_RECEIVED, CONTRACT_SIGNED, CUSTOM
  name TEXT NOT NULL,
  description TEXT,
  
  -- Scoring
  weight INTEGER DEFAULT 10,  -- Points for this event
  
  -- Status
  active BOOLEAN DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  UNIQUE(tenant_id, event_type)
);

CREATE INDEX idx_success_defs_tenant ON success_definitions(tenant_id, active);
```

### 1.5 Success Events Table
```sql
CREATE TABLE IF NOT EXISTS success_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  
  -- Event Details
  definition_id INTEGER NOT NULL,
  lead_id INTEGER,
  conversation_id INTEGER,
  
  -- Salesman Attribution
  salesman_id INTEGER,
  salesman_email TEXT,
  
  -- Event Data
  notes TEXT,
  value REAL,  -- Optional monetary value
  
  -- Timing
  event_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  -- Metadata
  metadata TEXT,  -- JSON
  
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (definition_id) REFERENCES success_definitions(id) ON DELETE CASCADE,
  FOREIGN KEY (lead_id) REFERENCES customer_profiles(id) ON DELETE SET NULL,
  FOREIGN KEY (salesman_id) REFERENCES salesman(id) ON DELETE SET NULL
);

CREATE INDEX idx_success_events_tenant ON success_events(tenant_id);
CREATE INDEX idx_success_events_salesman ON success_events(tenant_id, salesman_id);
CREATE INDEX idx_success_events_lead ON success_events(tenant_id, lead_id);
```

### 1.6 SLA Rules Table
```sql
CREATE TABLE IF NOT EXISTS sla_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  
  -- Rule Definition
  name TEXT NOT NULL,
  trigger_condition TEXT NOT NULL,  -- NEW_LEAD, MESSAGE_RECEIVED, TRIAGE_ESCALATED
  
  -- Time Targets (in minutes)
  response_time_minutes INTEGER NOT NULL,
  escalation_time_minutes INTEGER,
  
  -- Filters
  heat_level TEXT,  -- Apply only to specific heat levels
  channel TEXT,  -- Apply only to specific channels
  
  -- Escalation
  notify_roles TEXT,  -- JSON array: ["manager", "admin"]
  auto_reassign BOOLEAN DEFAULT 0,
  
  -- Status
  active BOOLEAN DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX idx_sla_rules_tenant ON sla_rules(tenant_id, active);
```

### 1.7 SLA Violations Table
```sql
CREATE TABLE IF NOT EXISTS sla_violations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  
  -- Violation Details
  rule_id INTEGER NOT NULL,
  conversation_id INTEGER,
  lead_id INTEGER,
  
  -- Timing
  triggered_at DATETIME NOT NULL,
  due_at DATETIME NOT NULL,
  responded_at DATETIME,
  breach_duration_minutes INTEGER,
  
  -- Escalation
  escalated BOOLEAN DEFAULT 0,
  escalated_at DATETIME,
  notifications_sent INTEGER DEFAULT 0,
  
  -- Resolution
  resolved BOOLEAN DEFAULT 0,
  resolved_at DATETIME,
  resolution_notes TEXT,
  
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (rule_id) REFERENCES sla_rules(id) ON DELETE CASCADE,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL,
  FOREIGN KEY (lead_id) REFERENCES customer_profiles(id) ON DELETE SET NULL
);

CREATE INDEX idx_sla_violations_tenant ON sla_violations(tenant_id);
CREATE INDEX idx_sla_violations_active ON sla_violations(tenant_id, resolved);
```

### 1.8 Notes Table
```sql
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  
  -- Note Content
  content TEXT NOT NULL,
  
  -- Associations
  lead_id INTEGER,
  conversation_id INTEGER,
  task_id INTEGER,
  
  -- Author
  created_by TEXT,  -- User email or ID
  
  -- Timing
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (lead_id) REFERENCES customer_profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE INDEX idx_notes_tenant ON notes(tenant_id);
CREATE INDEX idx_notes_lead ON notes(tenant_id, lead_id);
```

### 1.9 Lead Events (Audit Trail)
```sql
CREATE TABLE IF NOT EXISTS lead_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  
  -- Event Details
  event_type TEXT NOT NULL,  -- CREATED, ASSIGNED, STATUS_CHANGED, HEAT_CHANGED, etc.
  lead_id INTEGER,
  conversation_id INTEGER,
  
  -- Actor
  triggered_by TEXT,  -- User, System, AI
  
  -- Event Data
  payload TEXT,  -- JSON with before/after values
  
  -- Timing
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (lead_id) REFERENCES customer_profiles(id) ON DELETE CASCADE
);

CREATE INDEX idx_lead_events_tenant ON lead_events(tenant_id);
CREATE INDEX idx_lead_events_lead ON lead_events(tenant_id, lead_id);
CREATE INDEX idx_lead_events_type ON lead_events(tenant_id, event_type);
```

### 1.10 Assignment Configuration Table
```sql
CREATE TABLE IF NOT EXISTS assignment_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL UNIQUE,
  
  -- Assignment Strategy
  strategy TEXT DEFAULT 'ROUND_ROBIN',  -- ROUND_ROBIN, LEAST_ACTIVE, SKILLS_BASED, GEOGRAPHIC
  
  -- Toggles
  auto_assign BOOLEAN DEFAULT 1,
  consider_capacity BOOLEAN DEFAULT 1,
  consider_score BOOLEAN DEFAULT 0,
  consider_skills BOOLEAN DEFAULT 0,
  
  -- Custom Rules
  custom_rules TEXT,  -- JSON for advanced logic
  
  -- Status
  active BOOLEAN DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
```

### 1.11 Extend Existing Tables

**conversations table - add new columns:**
```sql
ALTER TABLE conversations ADD COLUMN heat TEXT DEFAULT 'COLD';  -- COLD, WARM, HOT, VERY_HOT, ON_FIRE
ALTER TABLE conversations ADD COLUMN qualification_level TEXT;  -- HOT, WARM, COLD, QUALIFIED
ALTER TABLE conversations ADD COLUMN status TEXT DEFAULT 'OPEN';  -- OPEN, CLOSED
ALTER TABLE conversations ADD COLUMN assigned_to TEXT;  -- Salesman email/ID
ALTER TABLE conversations ADD COLUMN last_activity_at DATETIME DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE conversations ADD COLUMN ai_confidence REAL;  -- 0.0 to 1.0
ALTER TABLE conversations ADD COLUMN ai_suggested_assignment TEXT;  -- Salesman suggestion
```

**customer_profiles table - add new columns:**
```sql
ALTER TABLE customer_profiles ADD COLUMN salesman_id INTEGER;  -- Current assigned salesman
ALTER TABLE customer_profiles ADD COLUMN heat TEXT DEFAULT 'COLD';
ALTER TABLE customer_profiles ADD COLUMN qualification_level TEXT;
```

---

## Phase 2: Lead Heat Scoring System (Week 2)

### 2.1 AI Heat Scoring Service
**File:** `services/heatScoringService.js`

**Features:**
- Analyze message content for urgency indicators
- Response time analysis
- Engagement level tracking
- Budget/payment keywords detection
- Automatic heat escalation/de-escalation
- Heat history tracking

**Heat Levels:**
- 🔵 **COLD** - Low urgency, exploratory
- 🟡 **WARM** - Some interest, needs nurturing
- 🟠 **HOT** - High interest, active discussion
- 🔴 **VERY_HOT** - Ready to buy, negotiating
- 🔥 **ON_FIRE** - Urgent, closing imminent

### 2.2 Dashboard UI Updates
- Heat badges on conversation list
- Heat filter dropdown
- Sort by heat level
- Heat change timeline in lead detail
- Heat indicator in customer profiles

### 2.3 API Endpoints
```
GET  /api/leads/:tenantId/:leadId/heat
POST /api/leads/:tenantId/:leadId/heat/update
GET  /api/leads/:tenantId/by-heat/:heatLevel
```

---

## Phase 3: Smart Assignment Strategies (Week 3)

### 3.1 Assignment Service
**File:** `services/assignmentService.js`

**Strategies:**

**1. ROUND_ROBIN:**
```javascript
// Assign to next salesman in rotation
// Track last assignment per tenant
// Skip inactive/unavailable salesmen
```

**2. LEAST_ACTIVE:**
```javascript
// Assign to salesman with fewest active leads
// Calculate: SELECT salesman_id, COUNT(*) FROM conversations
//            WHERE assigned_to = salesman AND status = 'OPEN'
//            GROUP BY salesman_id ORDER BY COUNT(*) ASC
```

**3. SKILLS_BASED:**
```javascript
// Match product keywords to salesman skills
// Match language to salesman language_skills
// Fallback to round-robin if no match
```

**4. GEOGRAPHIC:**
```javascript
// Extract location from lead data
// Match to salesman geographic_zone
// Fallback to round-robin if no match
```

### 3.2 Capacity Management
```javascript
// Before assignment, check:
// 1. Current capacity < max_leads_per_month
// 2. If exceed and use_intelligent_override = true and heat >= VERY_HOT, allow
// 3. Otherwise, skip to next salesman
```

### 3.3 Salesman Management UI
**Dashboard Tab:** "Salesmen" (new tab)

**Features:**
- Add/edit/deactivate salesmen
- Set capacity limits
- Configure skills (product tags, languages)
- View current workload
- Performance metrics

### 3.4 API Endpoints
```
GET    /api/salesmen/:tenantId
POST   /api/salesmen/:tenantId
PUT    /api/salesmen/:tenantId/:salesmanId
DELETE /api/salesmen/:tenantId/:salesmanId
GET    /api/salesmen/:tenantId/:salesmanId/workload
POST   /api/leads/:tenantId/:leadId/assign
GET    /api/assignment-config/:tenantId
PUT    /api/assignment-config/:tenantId
```

---

## Phase 4: AI Triage & Confidence Scoring (Week 4)

### 4.1 Enhanced Triage Service
**File:** `services/triageService.js`

**AI Analysis on Every Message:**
```javascript
// 1. Calculate AI confidence (0.0 - 1.0)
// 2. Detect sentiment (angry, frustrated, satisfied, neutral)
// 3. Classify intent (question, complaint, purchase_intent, pricing_query)
// 4. Identify urgency keywords
// 5. Determine if human needed
```

**Auto-Escalation Rules:**
- Confidence < 0.6 → Triage queue
- Sentiment = angry → Triage queue
- High-value lead detected (budget > threshold) → Triage queue
- Technical complexity detected → Triage queue
- VIP customer (high total_spent) → Triage queue

### 4.2 Triage Queue Enhancements
**Extend triage_queue table:**
```sql
ALTER TABLE triage_queue ADD COLUMN ai_confidence REAL;
ALTER TABLE triage_queue ADD COLUMN ai_suggested_salesman TEXT;
ALTER TABLE triage_queue ADD COLUMN triage_reason TEXT;  -- LOW_CONFIDENCE, ANGRY_CUSTOMER, HIGH_VALUE, TECHNICAL, VIP
ALTER TABLE triage_queue ADD COLUMN sentiment TEXT;
ALTER TABLE triage_queue ADD COLUMN intent TEXT;
```

**Dashboard Updates:**
- Show AI confidence score
- Display triage reason badge
- Show sentiment indicator
- Suggested salesman with "Quick Assign" button

### 4.3 Draft Reply Generation
**File:** `services/draftReplyService.js`

**Features:**
- Generate contextual draft replies using OpenAI/Gemini
- Use conversation history
- Use product catalog context
- Use tenant knowledge base (website_embeddings)
- Show draft in message composer (not auto-sent)
- Edit before sending

**UI:**
- "Generate Draft" button in message composer
- Draft appears in textarea with edit capability
- "Accept & Send" or "Discard" actions

---

## Phase 5: Task Management System (Week 5)

### 5.1 Tasks Service
**File:** `services/tasksService.js`

**Features:**
- Create task (manual or auto-generated)
- Link to lead/conversation
- Assign to salesman
- Set priority and due date
- Add reminders
- Mark complete/cancel
- Task history

### 5.2 Tasks Dashboard Tab
**New Tab:** "Tasks"

**Views:**
- My Tasks (assigned to me)
- All Tasks (manager view)
- Overdue Tasks (highlighted in red)
- Completed Tasks (archive)

**Filters:**
- By status (PENDING, IN_PROGRESS, COMPLETED)
- By priority (LOW → URGENT)
- By assignee
- By due date range

**Actions:**
- Create task modal
- Quick complete checkbox
- Reassign task
- Edit task
- Delete task

### 5.3 Task Reminders
**Backend Job:** `jobs/taskReminders.js`

**Logic:**
- Run every 15 minutes
- Find tasks where reminder_at <= NOW() AND status != 'COMPLETED'
- Send WhatsApp/Email notification to assigned salesman
- Update reminder_at to avoid duplicates

### 5.4 API Endpoints
```
GET    /api/tasks/:tenantId
GET    /api/tasks/:tenantId/my-tasks  (for logged-in user)
GET    /api/tasks/:tenantId/:taskId
POST   /api/tasks/:tenantId
PUT    /api/tasks/:tenantId/:taskId
DELETE /api/tasks/:tenantId/:taskId
POST   /api/tasks/:tenantId/:taskId/complete
```

---

## Phase 6: Phone Call Logging (Week 6)

### 6.1 Calls Service
**File:** `services/callsService.js`

**Features:**
- Log call (manual entry)
- Track direction (inbound/outbound)
- Record outcome
- Save duration and notes
- Schedule callback
- Link to lead/conversation
- Upload recording (future: integrate with VoIP)

### 6.2 Call Log Dashboard Tab
**New Tab:** "Calls"

**Views:**
- All calls timeline
- Calls by lead (in lead detail view)
- Scheduled callbacks (upcoming)
- Missed calls / No answer

**Call Log Form:**
```
- Lead/Customer (search dropdown)
- Direction: Inbound / Outbound
- Outcome: Answered / No Answer / Busy / Voicemail / Wrong Number / Callback Requested
- Duration: HH:MM:SS
- Notes: (textarea)
- Recording: (file upload, optional)
- Schedule Callback: (date/time picker, optional)
```

### 6.3 Call History Widget
**In Lead Detail View:**
- Timeline of all calls
- Quick stats (total calls, avg duration, last call date)
- "Log Call" quick button

### 6.4 API Endpoints
```
GET    /api/calls/:tenantId
GET    /api/calls/:tenantId/:callId
GET    /api/calls/:tenantId/by-lead/:leadId
POST   /api/calls/:tenantId
PUT    /api/calls/:tenantId/:callId
DELETE /api/calls/:tenantId/:callId
GET    /api/calls/:tenantId/scheduled-callbacks
```

---

## Phase 7: Success Events & Salesman Scoring (Week 7)

### 7.1 Success Definitions Management
**Dashboard Settings Page:** "Success Events"

**Default Definitions:**
- DEMO_BOOKED (weight: 10)
- PAYMENT_RECEIVED (weight: 50)
- ORDER_RECEIVED (weight: 100)
- CONTRACT_SIGNED (weight: 150)
- CUSTOM (user-defined)

**UI:**
- Add/edit/delete success definitions
- Set weight (points)
- Activate/deactivate

### 7.2 Success Events Logging
**In Lead Detail View:**
- "Log Success Event" button
- Modal: Select event type, add notes, enter value (optional)
- Automatically attributes to assigned salesman
- Updates salesman score

### 7.3 Salesman Performance Scoring
**Calculation:**
```javascript
score = (
  (total_success_events * avg_event_weight) * 0.4 +  // Success events (40%)
  (conversion_rate * 100) * 0.3 +                    // Conversion rate (30%)
  (100 - avg_response_time_minutes) * 0.2 +          // Response time (20%)
  (customer_satisfaction * 20) * 0.1                 // Future: CSAT (10%)
)
```

**Auto-Update:**
- Recalculate score when success event logged
- Update on lead status change (won/lost)
- Update on response time changes

### 7.4 Leaderboard Dashboard Widget
**In Overview Tab:**
- Top 10 salesmen by score
- Monthly performance chart
- Success events breakdown

### 7.5 API Endpoints
```
GET    /api/success-definitions/:tenantId
POST   /api/success-definitions/:tenantId
PUT    /api/success-definitions/:tenantId/:defId
DELETE /api/success-definitions/:tenantId/:defId

GET    /api/success-events/:tenantId
POST   /api/success-events/:tenantId
GET    /api/success-events/:tenantId/by-salesman/:salesmanId
GET    /api/success-events/:tenantId/by-lead/:leadId

GET    /api/salesmen/:tenantId/:salesmanId/score
GET    /api/salesmen/:tenantId/leaderboard
```

---

## Phase 8: SLA Rules & Compliance (Week 8)

### 8.1 SLA Rules Engine
**File:** `services/slaService.js`

**Features:**
- Define SLA rules per tenant
- Monitor conversations for SLA compliance
- Trigger notifications on approaching breach
- Log violations
- Auto-escalate on breach (optional)
- Generate compliance reports

### 8.2 SLA Configuration UI
**Dashboard Settings Page:** "SLA Rules"

**Default Rules:**
1. NEW_LEAD → Response within 15 minutes
2. MESSAGE_RECEIVED → Response within 30 minutes
3. TRIAGE_ESCALATED → Manager response within 10 minutes

**UI:**
- Add/edit/delete SLA rules
- Set response time targets
- Configure escalation behavior
- Filter by heat level/channel

### 8.3 SLA Monitoring Service
**Backend Job:** `jobs/slaMonitor.js`

**Logic (runs every 5 minutes):**
```javascript
// 1. Find conversations with active SLA rules
// 2. Check if responded within time limit
// 3. If breached, create sla_violations record
// 4. Send notifications (WhatsApp/Email to managers)
// 5. Auto-reassign if configured
```

### 8.4 SLA Dashboard Widgets
**In Overview Tab:**
- SLA Compliance % (today, this week, this month)
- Active violations count (red badge)
- Approaching breach warnings (yellow badge)

**New Tab:** "SLA Violations"
- List all violations
- Filter by resolved/unresolved
- Sort by breach duration
- View resolution notes

### 8.5 API Endpoints
```
GET    /api/sla-rules/:tenantId
POST   /api/sla-rules/:tenantId
PUT    /api/sla-rules/:tenantId/:ruleId
DELETE /api/sla-rules/:tenantId/:ruleId

GET    /api/sla-violations/:tenantId
GET    /api/sla-violations/:tenantId/:violationId
POST   /api/sla-violations/:tenantId/:violationId/resolve
GET    /api/sla-violations/:tenantId/compliance-report
```

---

## Phase 9: Advanced Features (Week 9-10)

### 9.1 Lead Qualification Workflow
**Add to Lead Detail View:**
- BANT Checklist:
  - ✅ Budget confirmed
  - ✅ Authority identified (decision maker)
  - ✅ Need validated
  - ✅ Timeline established
- Qualification status: HOT / WARM / COLD / QUALIFIED
- Auto-update based on checklist completion

### 9.2 Lead Pipeline Status
**Add status progression:**
- NEW → CONTACTED → QUALIFIED → QUOTED → WON/LOST/ON_HOLD
- Kanban board view (future enhancement)
- Pipeline conversion analytics

### 9.3 Notes System
**In Lead Detail View:**
- "Add Note" button
- Note history timeline
- User attribution
- Search notes

### 9.4 Conversation Status Management
**Features:**
- Close conversation (manual)
- Auto-close after X days inactivity
- Reopen on new message
- Archive closed conversations

### 9.5 Multi-AI Provider Support
**Enhance tenant AI config:**
```sql
ALTER TABLE tenants ADD COLUMN preferred_ai_provider TEXT DEFAULT 'OPENAI';  -- OPENAI, GEMINI, ANTHROPIC
ALTER TABLE tenants ADD COLUMN ai_model TEXT DEFAULT 'gpt-4o-mini';
```

**Dashboard Settings:**
- Select AI provider dropdown
- Enter provider-specific API key
- Choose model (gpt-4o-mini, gemini-pro, claude-3.5-sonnet)

---

## Implementation Priority

### Critical Path (Must Have - Weeks 1-6):
1. ✅ **Database schema** (Week 1)
2. ✅ **Lead heat scoring** (Week 2) - High business value
3. ✅ **Smart assignment** (Week 3) - Core differentiator
4. ✅ **AI triage enhancement** (Week 4) - Intelligence layer
5. ✅ **Task management** (Week 5) - Essential workflow
6. ✅ **Call logging** (Week 6) - Complete lead tracking

### High Value (Should Have - Weeks 7-8):
7. ✅ **Success events & scoring** (Week 7) - Performance management
8. ✅ **SLA compliance** (Week 8) - Enterprise requirement

### Nice to Have (Could Have - Weeks 9-10):
9. ⏳ **Advanced features** (Weeks 9-10) - Refinements

---

## Database Migration Script

**File:** `migrate-add-sak-sms-features.js`

```javascript
const Database = require('better-sqlite3');
const db = new Database('./local-database.db');

console.log('🚀 Starting SAK-SMS features migration...');

// Phase 1: Create new tables
const tables = [
  // Salesman table
  `CREATE TABLE IF NOT EXISTS salesman (...)`,
  
  // Tasks table
  `CREATE TABLE IF NOT EXISTS tasks (...)`,
  
  // Calls table
  `CREATE TABLE IF NOT EXISTS calls (...)`,
  
  // ... (all table definitions from above)
];

tables.forEach((sql, index) => {
  try {
    db.exec(sql);
    console.log(`✅ Table ${index + 1}/${tables.length} created`);
  } catch (err) {
    console.error(`❌ Error creating table: ${err.message}`);
  }
});

// Phase 2: Alter existing tables
const alterations = [
  `ALTER TABLE conversations ADD COLUMN heat TEXT DEFAULT 'COLD'`,
  `ALTER TABLE conversations ADD COLUMN qualification_level TEXT`,
  // ... (all ALTER statements from above)
];

alterations.forEach((sql, index) => {
  try {
    db.exec(sql);
    console.log(`✅ Column ${index + 1}/${alterations.length} added`);
  } catch (err) {
    if (err.message.includes('duplicate column')) {
      console.log(`⏭️  Column already exists, skipping`);
    } else {
      console.error(`❌ Error: ${err.message}`);
    }
  }
});

console.log('✅ Migration complete!');
```

---

## Testing Strategy

### Unit Tests:
- Heat scoring logic
- Assignment algorithm (round-robin, least-active)
- SLA calculation
- Salesman score calculation

### Integration Tests:
- New lead → Auto-assignment
- Message → Heat update → Triage if needed
- Task due → Reminder sent
- SLA breach → Violation logged

### Manual Testing:
- Create salesman → Assign leads → Check distribution
- Log calls → Verify timeline
- Create tasks → Check reminders
- Configure SLA → Trigger violation

---

## Deployment Plan

### Week 1: Database Migration
```bash
node migrate-add-sak-sms-features.js
```

### Week 2-10: Incremental Feature Deployment
- Deploy one phase per week
- Test thoroughly before next phase
- Monitor production for issues

### Rollback Plan:
- Keep SAK-SMS running until all features verified
- Database backups before each phase
- Feature flags for gradual rollout

---

## Success Metrics

**By End of Migration:**
- ✅ 100% SAK-SMS features in Salesmate
- ✅ Auto-assignment working (>90% leads auto-assigned)
- ✅ Heat scoring active (all leads scored)
- ✅ Tasks tracked (0 missed follow-ups)
- ✅ SLA compliance >95%
- ✅ Salesman performance visible (leaderboard)
- ✅ SAK-SMS fully decommissioned

---

**End of Migration Plan**
