-- Migration: 006_conversation_learning.sql
-- Create table to track successful conversation patterns for AI learning

CREATE TABLE IF NOT EXISTS conversation_learning (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    conversation_id INTEGER,
    customer_phone TEXT,
    user_query TEXT NOT NULL,
    ai_response TEXT NOT NULL,
    outcome_type TEXT NOT NULL, -- 'order_placed', 'question_answered', 'lead_qualified', 'customer_confused', etc.
    was_successful BOOLEAN NOT NULL DEFAULT 1,
    context_used TEXT, -- JSON: { "website": true, "products": true, "history": true }
    response_time_ms INTEGER,
    customer_satisfaction_score INTEGER, -- 1-5 if feedback collected
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
);

-- Index for fast lookups by tenant and outcome
CREATE INDEX IF NOT EXISTS idx_learning_tenant_outcome 
ON conversation_learning(tenant_id, outcome_type, was_successful);

-- Index for time-based queries
CREATE INDEX IF NOT EXISTS idx_learning_created 
ON conversation_learning(created_at);

-- Index for finding similar queries
CREATE INDEX IF NOT EXISTS idx_learning_query 
ON conversation_learning(user_query);
