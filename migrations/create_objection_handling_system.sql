-- AI Objection Handling System
-- Detect, categorize, and respond to common sales objections using AI

-- Common objections library
CREATE TABLE IF NOT EXISTS sales_objections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  
  -- Objection details
  objection_text TEXT NOT NULL,
  objection_category TEXT NOT NULL, -- price, timing, competition, need, authority, trust
  objection_severity TEXT DEFAULT 'medium', -- low, medium, high, critical
  
  -- Context
  industry TEXT, -- Manufacturing, Retail, etc.
  customer_type TEXT, -- B2B, B2C, Government
  deal_stage TEXT, -- prospecting, qualification, proposal, negotiation
  
  -- Detection keywords
  keywords TEXT, -- JSON array: ["too expensive", "budget", "costly"]
  
  -- Usage stats
  detection_count INTEGER DEFAULT 0,
  successful_resolution_count INTEGER DEFAULT 0,
  resolution_rate REAL DEFAULT 0.0,
  
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE INDEX IF NOT EXISTS idx_sales_objections_tenant ON sales_objections(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sales_objections_category ON sales_objections(objection_category);
CREATE INDEX IF NOT EXISTS idx_sales_objections_active ON sales_objections(is_active);

-- Response templates for objections
CREATE TABLE IF NOT EXISTS objection_responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  objection_id INTEGER NOT NULL,
  tenant_id TEXT NOT NULL,
  
  -- Response details
  response_text TEXT NOT NULL,
  response_type TEXT DEFAULT 'empathize_clarify_respond', -- feel_felt_found, question_back, reframe
  response_tone TEXT DEFAULT 'professional', -- professional, friendly, assertive, consultative
  
  -- Personalization placeholders
  uses_customer_name INTEGER DEFAULT 1,
  uses_product_name INTEGER DEFAULT 1,
  uses_competitor_comparison INTEGER DEFAULT 0,
  
  -- Effectiveness
  success_rate REAL DEFAULT 0.0,
  times_used INTEGER DEFAULT 0,
  avg_response_time_seconds INTEGER DEFAULT 0,
  
  -- A/B testing
  is_variant INTEGER DEFAULT 0,
  variant_group TEXT,
  
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (objection_id) REFERENCES sales_objections(id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE INDEX IF NOT EXISTS idx_objection_responses_objection ON objection_responses(objection_id);
CREATE INDEX IF NOT EXISTS idx_objection_responses_active ON objection_responses(is_active);

-- Objection detection log
CREATE TABLE IF NOT EXISTS objection_detection_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  
  -- Source
  conversation_id TEXT NOT NULL, -- Link to WhatsApp/email conversation
  customer_id TEXT,
  deal_id TEXT,
  salesman_id TEXT,
  
  -- Detection
  detected_objection_id INTEGER,
  original_message TEXT NOT NULL,
  confidence_score REAL DEFAULT 0.0, -- 0-1 confidence in detection
  
  -- Sentiment analysis
  sentiment TEXT DEFAULT 'neutral', -- positive, neutral, negative, very_negative
  sentiment_score REAL, -- -1 to +1
  urgency_level TEXT DEFAULT 'normal', -- low, normal, high, urgent
  
  -- Response
  suggested_response_id INTEGER,
  actual_response TEXT,
  response_sent_at TEXT,
  
  -- Outcome
  was_resolved INTEGER DEFAULT 0,
  resolution_method TEXT, -- ai_response, human_intervention, escalation
  deal_progressed INTEGER DEFAULT 0, -- Did deal move forward after handling?
  
  detected_at TEXT DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (detected_objection_id) REFERENCES sales_objections(id),
  FOREIGN KEY (suggested_response_id) REFERENCES objection_responses(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (salesman_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_objection_log_tenant ON objection_detection_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_objection_log_conversation ON objection_detection_log(conversation_id);
CREATE INDEX IF NOT EXISTS idx_objection_log_customer ON objection_detection_log(customer_id);
CREATE INDEX IF NOT EXISTS idx_objection_log_detected_at ON objection_detection_log(detected_at);

-- Escalation rules
CREATE TABLE IF NOT EXISTS objection_escalation_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  
  -- Rule criteria
  rule_name TEXT NOT NULL,
  objection_category TEXT, -- NULL = applies to all
  
  -- Triggers
  sentiment_threshold REAL, -- Escalate if sentiment < this value
  repeated_objection_count INTEGER DEFAULT 3, -- Escalate after N times
  high_value_deal_threshold REAL, -- Escalate if deal value > this
  
  -- Actions
  escalate_to_role TEXT DEFAULT 'sales_manager',
  escalate_to_user_id TEXT,
  notification_method TEXT DEFAULT 'email', -- email, whatsapp, in_app
  
  -- Timing
  delay_minutes INTEGER DEFAULT 0, -- Wait N minutes before escalation
  
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (escalate_to_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_escalation_rules_tenant ON objection_escalation_rules(tenant_id);
CREATE INDEX IF NOT EXISTS idx_escalation_rules_active ON objection_escalation_rules(is_active);

-- Escalation log
CREATE TABLE IF NOT EXISTS objection_escalations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  objection_log_id INTEGER NOT NULL,
  rule_id INTEGER,
  
  -- Escalation details
  escalated_from_user_id TEXT,
  escalated_to_user_id TEXT,
  escalation_reason TEXT,
  
  -- Status
  escalation_status TEXT DEFAULT 'pending', -- pending, acknowledged, resolved, cancelled
  acknowledged_at TEXT,
  resolved_at TEXT,
  resolution_notes TEXT,
  
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (objection_log_id) REFERENCES objection_detection_log(id),
  FOREIGN KEY (rule_id) REFERENCES objection_escalation_rules(id),
  FOREIGN KEY (escalated_from_user_id) REFERENCES users(id),
  FOREIGN KEY (escalated_to_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_escalations_tenant ON objection_escalations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_escalations_status ON objection_escalations(escalation_status);
CREATE INDEX IF NOT EXISTS idx_escalations_to_user ON objection_escalations(escalated_to_user_id);

-- Insert common objections for testing
INSERT INTO sales_objections (tenant_id, objection_text, objection_category, keywords, objection_severity)
VALUES 
  ('default', 'Price is too high', 'price', '["too expensive", "costly", "price", "budget", "afford", "cheaper"]', 'high'),
  ('default', 'Need to think about it', 'timing', '["think about", "later", "not now", "get back", "need time"]', 'medium'),
  ('default', 'Already using competitor', 'competition', '["using", "competitor", "current vendor", "already have"]', 'high'),
  ('default', 'Not interested', 'need', '["not interested", "don''t need", "no use", "not relevant"]', 'critical'),
  ('default', 'Need to check with boss', 'authority', '["boss", "manager", "decision maker", "not my call", "authority"]', 'medium'),
  ('default', 'Not sure if it works', 'trust', '["not sure", "skeptical", "doubt", "proof", "guarantee", "demo"]', 'medium');
