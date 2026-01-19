-- Autonomous Follow-up System
-- Automated email/WhatsApp sequences with triggers and engagement tracking

-- Sequence definitions
CREATE TABLE IF NOT EXISTS followup_sequences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  
  -- Sequence details
  sequence_name TEXT NOT NULL,
  sequence_type TEXT DEFAULT 'nurture', -- nurture, onboarding, re_engagement, abandoned_cart, post_purchase
  description TEXT,
  
  -- Targeting
  target_customer_type TEXT, -- prospect, lead, customer, churned
  target_deal_stage TEXT,
  
  -- Settings
  is_active INTEGER DEFAULT 1,
  max_enrollments INTEGER, -- NULL = unlimited
  current_enrollments INTEGER DEFAULT 0,
  
  -- Performance
  total_sent INTEGER DEFAULT 0,
  total_opened INTEGER DEFAULT 0,
  total_clicked INTEGER DEFAULT 0,
  total_replied INTEGER DEFAULT 0,
  total_converted INTEGER DEFAULT 0,
  
  -- Calculated metrics
  open_rate REAL DEFAULT 0.0,
  click_rate REAL DEFAULT 0.0,
  reply_rate REAL DEFAULT 0.0,
  conversion_rate REAL DEFAULT 0.0,
  
  created_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_followup_sequences_tenant ON followup_sequences(tenant_id);
CREATE INDEX IF NOT EXISTS idx_followup_sequences_active ON followup_sequences(is_active);
CREATE INDEX IF NOT EXISTS idx_followup_sequences_type ON followup_sequences(sequence_type);

-- Sequence steps
CREATE TABLE IF NOT EXISTS sequence_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sequence_id INTEGER NOT NULL,
  tenant_id TEXT NOT NULL,
  
  -- Step details
  step_number INTEGER NOT NULL,
  step_name TEXT NOT NULL,
  
  -- Timing
  delay_days INTEGER DEFAULT 0,
  delay_hours INTEGER DEFAULT 0,
  send_time TEXT, -- HH:MM preferred send time, NULL = immediate
  skip_weekends INTEGER DEFAULT 1,
  
  -- Message details
  channel TEXT NOT NULL, -- email, whatsapp, sms
  subject_line TEXT, -- For email
  message_body TEXT NOT NULL,
  
  -- Personalization
  uses_placeholders INTEGER DEFAULT 1, -- {{customer_name}}, {{product_name}}, etc.
  
  -- A/B testing
  is_variant INTEGER DEFAULT 0,
  variant_group TEXT,
  variant_split_percentage INTEGER DEFAULT 50, -- % of enrollments using this variant
  
  -- Call to action
  cta_text TEXT, -- "Schedule a call", "View offer", etc.
  cta_url TEXT,
  
  -- Performance
  sent_count INTEGER DEFAULT 0,
  opened_count INTEGER DEFAULT 0,
  clicked_count INTEGER DEFAULT 0,
  replied_count INTEGER DEFAULT 0,
  
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (sequence_id) REFERENCES followup_sequences(id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  
  UNIQUE(sequence_id, step_number)
);

CREATE INDEX IF NOT EXISTS idx_sequence_steps_sequence ON sequence_steps(sequence_id);
CREATE INDEX IF NOT EXISTS idx_sequence_steps_number ON sequence_steps(step_number);

-- Sequence enrollments
CREATE TABLE IF NOT EXISTS sequence_enrollments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sequence_id INTEGER NOT NULL,
  tenant_id TEXT NOT NULL,
  
  -- Enrollment target
  customer_id TEXT,
  contact_id TEXT,
  deal_id TEXT,
  
  -- Enrollment details
  enrolled_by TEXT, -- User who enrolled or 'auto_trigger'
  enrollment_source TEXT DEFAULT 'manual', -- manual, trigger, api
  
  -- Status
  enrollment_status TEXT DEFAULT 'active', -- active, paused, completed, cancelled, bounced
  current_step INTEGER DEFAULT 0,
  
  -- Timing
  enrolled_at TEXT DEFAULT CURRENT_TIMESTAMP,
  next_send_at TEXT,
  completed_at TEXT,
  cancelled_at TEXT,
  cancellation_reason TEXT,
  
  -- Engagement
  total_messages_sent INTEGER DEFAULT 0,
  total_opened INTEGER DEFAULT 0,
  total_clicked INTEGER DEFAULT 0,
  total_replied INTEGER DEFAULT 0,
  
  -- Conversion
  converted INTEGER DEFAULT 0,
  converted_at TEXT,
  conversion_value REAL,
  
  FOREIGN KEY (sequence_id) REFERENCES followup_sequences(id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (enrolled_by) REFERENCES users(id),
  FOREIGN KEY (deal_id) REFERENCES deals(id)
);

CREATE INDEX IF NOT EXISTS idx_enrollments_sequence ON sequence_enrollments(sequence_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_customer ON sequence_enrollments(customer_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_status ON sequence_enrollments(enrollment_status);
CREATE INDEX IF NOT EXISTS idx_enrollments_next_send ON sequence_enrollments(next_send_at);

-- Message delivery log
CREATE TABLE IF NOT EXISTS sequence_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  enrollment_id INTEGER NOT NULL,
  step_id INTEGER NOT NULL,
  tenant_id TEXT NOT NULL,
  
  -- Message details
  channel TEXT NOT NULL,
  recipient_contact TEXT NOT NULL, -- Email or phone number
  subject_line TEXT,
  message_body TEXT NOT NULL,
  
  -- Scheduling
  scheduled_send_at TEXT NOT NULL,
  actual_sent_at TEXT,
  
  -- Delivery status
  delivery_status TEXT DEFAULT 'pending', -- pending, sent, delivered, failed, bounced
  failure_reason TEXT,
  
  -- Engagement tracking
  opened_at TEXT,
  first_clicked_at TEXT,
  replied_at TEXT,
  reply_text TEXT,
  
  -- Engagement counts
  open_count INTEGER DEFAULT 0,
  click_count INTEGER DEFAULT 0,
  
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (enrollment_id) REFERENCES sequence_enrollments(id),
  FOREIGN KEY (step_id) REFERENCES sequence_steps(id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE INDEX IF NOT EXISTS idx_sequence_messages_enrollment ON sequence_messages(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_sequence_messages_status ON sequence_messages(delivery_status);
CREATE INDEX IF NOT EXISTS idx_sequence_messages_scheduled ON sequence_messages(scheduled_send_at);

-- Trigger conditions for auto-enrollment
CREATE TABLE IF NOT EXISTS sequence_triggers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sequence_id INTEGER NOT NULL,
  tenant_id TEXT NOT NULL,
  
  -- Trigger details
  trigger_name TEXT NOT NULL,
  trigger_type TEXT NOT NULL, -- deal_stage_changed, form_submitted, visit_completed, order_placed, cart_abandoned
  
  -- Conditions (JSON)
  trigger_conditions TEXT, -- {"deal_stage": "proposal", "deal_value": ">5000"}
  
  -- Filters
  apply_to_customer_type TEXT, -- NULL = all types
  apply_to_region TEXT,
  
  -- Settings
  is_active INTEGER DEFAULT 1,
  priority INTEGER DEFAULT 1,
  
  -- Stats
  times_triggered INTEGER DEFAULT 0,
  successful_enrollments INTEGER DEFAULT 0,
  
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (sequence_id) REFERENCES followup_sequences(id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE INDEX IF NOT EXISTS idx_sequence_triggers_sequence ON sequence_triggers(sequence_id);
CREATE INDEX IF NOT EXISTS idx_sequence_triggers_type ON sequence_triggers(trigger_type);
CREATE INDEX IF NOT EXISTS idx_sequence_triggers_active ON sequence_triggers(is_active);

-- Unsubscribe management
CREATE TABLE IF NOT EXISTS sequence_unsubscribes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  
  -- Unsubscribe details
  customer_id TEXT,
  email TEXT,
  phone TEXT,
  
  -- Unsubscribe scope
  unsubscribe_type TEXT DEFAULT 'all_sequences', -- all_sequences, specific_sequence, specific_type
  sequence_id INTEGER, -- NULL if unsubscribing from all
  sequence_type TEXT, -- If unsubscribing from type
  
  -- Reason
  unsubscribe_reason TEXT,
  feedback TEXT,
  
  unsubscribed_at TEXT DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (sequence_id) REFERENCES followup_sequences(id)
);

CREATE INDEX IF NOT EXISTS idx_unsubscribes_customer ON sequence_unsubscribes(customer_id);
CREATE INDEX IF NOT EXISTS idx_unsubscribes_email ON sequence_unsubscribes(email);
CREATE INDEX IF NOT EXISTS idx_unsubscribes_phone ON sequence_unsubscribes(phone);
