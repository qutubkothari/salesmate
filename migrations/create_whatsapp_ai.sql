-- WhatsApp AI Enhancements Schema
-- Conversational AI, smart replies, broadcast campaigns, context tracking
-- Supports: Advanced message handling, sentiment analysis, intent detection

-- AI Conversation Sessions
CREATE TABLE IF NOT EXISTS ai_conversation_sessions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  
  -- Session details
  session_start TEXT DEFAULT CURRENT_TIMESTAMP,
  session_end TEXT,
  session_status TEXT DEFAULT 'active', -- active, paused, completed, abandoned
  
  -- Context tracking
  current_intent TEXT, -- inquiry, complaint, order, support, chat
  current_topic TEXT, -- product, pricing, delivery, technical, general
  conversation_stage TEXT, -- greeting, discovery, presentation, objection, closing
  customer_sentiment TEXT, -- positive, neutral, negative, frustrated, satisfied
  
  -- AI engagement
  ai_confidence_score REAL, -- 0.0 to 1.0
  human_handoff_requested INTEGER DEFAULT 0,
  human_agent_id TEXT,
  handoff_reason TEXT,
  
  -- Metrics
  message_count INTEGER DEFAULT 0,
  ai_response_count INTEGER DEFAULT 0,
  human_response_count INTEGER DEFAULT 0,
  avg_response_time INTEGER, -- milliseconds
  session_duration INTEGER, -- seconds
  
  -- Metadata
  language TEXT DEFAULT 'en', -- en, hi, ar
  channel TEXT DEFAULT 'whatsapp', -- whatsapp, telegram, sms
  device_info TEXT, -- JSON: user agent, platform
  
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- AI Conversation Messages (detailed message log)
CREATE TABLE IF NOT EXISTS ai_conversation_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  
  -- Message details
  message_direction TEXT NOT NULL, -- incoming, outgoing
  message_type TEXT NOT NULL, -- text, image, audio, video, document, location
  message_content TEXT NOT NULL,
  
  -- AI analysis
  detected_intent TEXT, -- what user wants
  detected_entities TEXT, -- JSON: extracted entities (product names, prices, dates)
  sentiment_score REAL, -- -1.0 (negative) to 1.0 (positive)
  urgency_level TEXT, -- low, medium, high, critical
  
  -- Response metadata
  is_ai_response INTEGER DEFAULT 0,
  ai_model_used TEXT, -- gpt-4, gpt-3.5, custom
  ai_confidence REAL,
  response_time INTEGER, -- milliseconds
  
  -- Human oversight
  human_reviewed INTEGER DEFAULT 0,
  human_edited INTEGER DEFAULT 0,
  review_note TEXT,
  
  timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (session_id) REFERENCES ai_conversation_sessions(id)
);

-- Smart Reply Suggestions
CREATE TABLE IF NOT EXISTS smart_reply_templates (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  
  -- Template details
  template_name TEXT NOT NULL,
  template_category TEXT NOT NULL, -- greeting, farewell, confirmation, apology, question, objection_handling
  
  -- Trigger conditions
  intent_triggers TEXT, -- JSON: array of intents that trigger this reply
  keyword_triggers TEXT, -- JSON: array of keywords
  sentiment_triggers TEXT, -- JSON: sentiment conditions
  context_triggers TEXT, -- JSON: conversation stage, topic
  
  -- Reply content
  reply_text TEXT NOT NULL,
  reply_variants TEXT, -- JSON: alternative phrasings
  
  -- Personalization
  supports_variables INTEGER DEFAULT 1, -- {{customer_name}}, {{product_name}}
  variable_schema TEXT, -- JSON: available variables
  
  -- Settings
  language TEXT DEFAULT 'en',
  priority INTEGER DEFAULT 50, -- 0-100, higher = more likely to suggest
  is_active INTEGER DEFAULT 1,
  
  -- Analytics
  usage_count INTEGER DEFAULT 0,
  success_rate REAL, -- percentage of times used and led to positive outcome
  
  created_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Broadcast Campaigns
CREATE TABLE IF NOT EXISTS broadcast_campaigns (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  
  -- Campaign details
  campaign_name TEXT NOT NULL,
  campaign_type TEXT NOT NULL, -- promotional, informational, transactional, follow_up
  campaign_status TEXT DEFAULT 'draft', -- draft, scheduled, sending, completed, paused, cancelled
  
  -- Target audience
  target_segment TEXT, -- all, active_customers, leads, dormant, custom
  target_criteria TEXT, -- JSON: filter conditions
  target_count INTEGER,
  
  -- Message content
  message_template TEXT NOT NULL,
  message_variables TEXT, -- JSON: personalization variables
  media_url TEXT, -- image, video, document URL
  media_type TEXT, -- image, video, audio, document
  
  -- Scheduling
  scheduled_start TEXT,
  scheduled_end TEXT,
  send_interval INTEGER DEFAULT 1000, -- milliseconds between messages (rate limiting)
  
  -- Execution
  sent_count INTEGER DEFAULT 0,
  delivered_count INTEGER DEFAULT 0,
  read_count INTEGER DEFAULT 0,
  replied_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  
  -- AI features
  ai_optimization_enabled INTEGER DEFAULT 0,
  ai_send_time_optimization INTEGER DEFAULT 0, -- AI picks best time for each recipient
  ai_content_variants INTEGER DEFAULT 0, -- AI generates variations
  
  -- Analytics
  click_through_rate REAL,
  conversion_rate REAL,
  revenue_generated REAL,
  
  created_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Broadcast Recipients (individual message tracking)
CREATE TABLE IF NOT EXISTS broadcast_recipients (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  
  -- Recipient details
  customer_id TEXT,
  phone_number TEXT NOT NULL,
  customer_name TEXT,
  
  -- Message content (personalized)
  personalized_message TEXT,
  
  -- Delivery status
  send_status TEXT DEFAULT 'pending', -- pending, sent, delivered, read, replied, failed
  sent_at TEXT,
  delivered_at TEXT,
  read_at TEXT,
  replied_at TEXT,
  failed_at TEXT,
  failure_reason TEXT,
  
  -- Engagement
  replied INTEGER DEFAULT 0,
  reply_content TEXT,
  clicked_link INTEGER DEFAULT 0,
  converted INTEGER DEFAULT 0,
  conversion_value REAL,
  
  -- AI insights
  optimal_send_time TEXT, -- AI-predicted best time
  engagement_probability REAL, -- 0.0 to 1.0
  
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (campaign_id) REFERENCES broadcast_campaigns(id)
);

-- AI Training Data (learn from interactions)
CREATE TABLE IF NOT EXISTS ai_training_data (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  
  -- Training sample
  sample_type TEXT NOT NULL, -- conversation, intent, sentiment, entity
  
  -- Input/Output
  input_text TEXT NOT NULL,
  expected_output TEXT NOT NULL,
  actual_output TEXT,
  
  -- Context
  intent TEXT,
  entities TEXT, -- JSON
  sentiment TEXT,
  
  -- Quality
  is_verified INTEGER DEFAULT 0,
  verified_by TEXT,
  confidence_score REAL,
  
  -- Metadata
  source TEXT, -- human_labeled, auto_generated, corrected
  language TEXT DEFAULT 'en',
  
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Message Templates (quick responses)
CREATE TABLE IF NOT EXISTS message_templates (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  
  -- Template details
  template_name TEXT NOT NULL,
  template_category TEXT NOT NULL, -- greeting, product_info, pricing, delivery, support, closing
  
  -- Content
  template_text TEXT NOT NULL,
  template_media_url TEXT,
  template_media_type TEXT,
  
  -- Variables
  has_variables INTEGER DEFAULT 0,
  variable_list TEXT, -- JSON: [{name, type, required}]
  
  -- Settings
  language TEXT DEFAULT 'en',
  is_default INTEGER DEFAULT 0,
  
  -- Usage tracking
  usage_count INTEGER DEFAULT 0,
  last_used_at TEXT,
  
  created_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Conversation Context (maintain state across messages)
CREATE TABLE IF NOT EXISTS conversation_context (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  
  -- Context data
  context_key TEXT NOT NULL, -- current_product, quoted_price, delivery_date, etc.
  context_value TEXT NOT NULL,
  context_type TEXT DEFAULT 'string', -- string, number, date, boolean, object
  
  -- Lifecycle
  expires_at TEXT, -- auto-cleanup old context
  is_active INTEGER DEFAULT 1,
  
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (session_id) REFERENCES ai_conversation_sessions(id)
);

-- AI Performance Metrics
CREATE TABLE IF NOT EXISTS ai_performance_metrics (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  
  -- Time period
  metric_date TEXT NOT NULL, -- YYYY-MM-DD
  metric_hour INTEGER, -- 0-23 for hourly breakdown
  
  -- Conversation metrics
  total_sessions INTEGER DEFAULT 0,
  ai_handled_sessions INTEGER DEFAULT 0,
  human_handoff_sessions INTEGER DEFAULT 0,
  
  -- Response metrics
  total_messages INTEGER DEFAULT 0,
  ai_responses INTEGER DEFAULT 0,
  avg_ai_confidence REAL,
  avg_response_time INTEGER, -- milliseconds
  
  -- Quality metrics
  positive_sentiment_count INTEGER DEFAULT 0,
  neutral_sentiment_count INTEGER DEFAULT 0,
  negative_sentiment_count INTEGER DEFAULT 0,
  
  -- Intent detection
  intent_detection_accuracy REAL,
  intent_counts TEXT, -- JSON: {inquiry: 50, complaint: 10, ...}
  
  -- Engagement
  avg_session_duration INTEGER, -- seconds
  avg_messages_per_session REAL,
  customer_satisfaction_score REAL, -- 0.0 to 5.0
  
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Customer AI Preferences
CREATE TABLE IF NOT EXISTS customer_ai_preferences (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  
  -- Preferences
  prefers_ai_chat INTEGER DEFAULT 1,
  prefers_human_agent INTEGER DEFAULT 0,
  
  -- Communication style
  preferred_language TEXT DEFAULT 'en',
  preferred_tone TEXT, -- formal, casual, friendly
  communication_frequency TEXT, -- high, medium, low
  
  -- Best contact times
  best_contact_hours TEXT, -- JSON: [9, 10, 11, 14, 15, 16]
  timezone TEXT,
  
  -- Opt-outs
  opted_out_broadcast INTEGER DEFAULT 0,
  opted_out_ai_chat INTEGER DEFAULT 0,
  opted_out_at TEXT,
  
  -- Learning
  typical_inquiries TEXT, -- JSON: most common intents
  purchase_patterns TEXT, -- JSON: behavioral insights
  
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_ai_sessions_tenant ON ai_conversation_sessions(tenant_id, session_status);
CREATE INDEX IF NOT EXISTS idx_ai_sessions_customer ON ai_conversation_sessions(customer_id, session_start);
CREATE INDEX IF NOT EXISTS idx_ai_messages_session ON ai_conversation_messages(session_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_smart_replies_category ON smart_reply_templates(template_category, is_active);
CREATE INDEX IF NOT EXISTS idx_broadcast_campaigns_status ON broadcast_campaigns(tenant_id, campaign_status);
CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_campaign ON broadcast_recipients(campaign_id, send_status);
CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_phone ON broadcast_recipients(phone_number, send_status);
CREATE INDEX IF NOT EXISTS idx_conversation_context_session ON conversation_context(session_id, is_active);
CREATE INDEX IF NOT EXISTS idx_ai_metrics_date ON ai_performance_metrics(tenant_id, metric_date);
CREATE INDEX IF NOT EXISTS idx_customer_preferences ON customer_ai_preferences(customer_id, tenant_id);
CREATE INDEX IF NOT EXISTS idx_message_templates_category ON message_templates(template_category, is_active);
CREATE INDEX IF NOT EXISTS idx_training_data_type ON ai_training_data(sample_type, is_verified);
