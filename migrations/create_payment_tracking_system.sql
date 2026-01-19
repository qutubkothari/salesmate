-- ========================================
-- PAYMENT TRACKING & INTELLIGENCE SYSTEM
-- For Account Intelligence (Phase 1)
-- ========================================

-- Payment History Table
CREATE TABLE IF NOT EXISTS payment_history (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    customer_id TEXT,
    order_id TEXT,
    invoice_id TEXT,
    
    -- Payment Details
    payment_date DATETIME NOT NULL,
    payment_amount DECIMAL(15, 2) NOT NULL,
    payment_method VARCHAR(50), -- 'cash', 'cheque', 'bank_transfer', 'upi', 'card'
    payment_status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'cleared', 'bounced', 'cancelled'
    
    -- Reference Numbers
    transaction_ref VARCHAR(255),
    cheque_number VARCHAR(100),
    bank_name VARCHAR(255),
    
    -- Timing Analysis
    invoice_due_date DATETIME,
    days_to_payment INTEGER, -- Calculated: payment_date - invoice_date
    days_overdue INTEGER, -- Calculated: payment_date - due_date (negative if early)
    
    -- Risk Indicators
    is_late_payment BOOLEAN DEFAULT 0,
    is_partial_payment BOOLEAN DEFAULT 0,
    is_bounced BOOLEAN DEFAULT 0,
    
    -- Metadata
    payment_notes TEXT,
    processed_by TEXT,
    reconciled_at DATETIME,
    reconciled_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (customer_id) REFERENCES customer_profiles_new(id) ON DELETE CASCADE,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL
);

CREATE INDEX idx_payment_history_tenant ON payment_history(tenant_id);
CREATE INDEX idx_payment_history_customer ON payment_history(customer_id);
CREATE INDEX idx_payment_history_date ON payment_history(payment_date);
CREATE INDEX idx_payment_history_status ON payment_history(payment_status);

-- Payment Terms Table
CREATE TABLE IF NOT EXISTS payment_terms (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    customer_id TEXT NOT NULL,
    
    -- Terms
    payment_term_days INTEGER DEFAULT 30, -- Net 30, Net 60, etc.
    credit_limit DECIMAL(15, 2),
    credit_utilized DECIMAL(15, 2) DEFAULT 0,
    
    -- Early Payment Discount
    early_payment_discount_percent DECIMAL(5, 2) DEFAULT 0,
    early_payment_days INTEGER DEFAULT 7,
    
    -- Late Payment Penalty
    late_payment_penalty_percent DECIMAL(5, 2) DEFAULT 0,
    
    -- Status
    credit_status VARCHAR(20) DEFAULT 'active', -- 'active', 'suspended', 'blocked'
    credit_reason TEXT,
    
    -- Audit
    approved_by TEXT,
    approved_at DATETIME,
    effective_from DATETIME,
    valid_until DATETIME,
    
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (customer_id) REFERENCES customer_profiles_new(id) ON DELETE CASCADE,
    
    UNIQUE(tenant_id, customer_id)
);

CREATE INDEX idx_payment_terms_tenant ON payment_terms(tenant_id);
CREATE INDEX idx_payment_terms_customer ON payment_terms(customer_id);

-- Customer Credit Score Table
CREATE TABLE IF NOT EXISTS customer_credit_scores (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    customer_id TEXT NOT NULL,
    
    -- Score Components (0-100 each)
    payment_timeliness_score INTEGER DEFAULT 50,
    payment_consistency_score INTEGER DEFAULT 50,
    payment_amount_score INTEGER DEFAULT 50,
    bounce_rate_score INTEGER DEFAULT 100,
    credit_utilization_score INTEGER DEFAULT 75,
    
    -- Composite Score
    overall_credit_score INTEGER DEFAULT 65, -- Weighted average
    
    -- Risk Classification
    risk_tier VARCHAR(20) DEFAULT 'medium', -- 'very_low', 'low', 'medium', 'high', 'very_high'
    risk_factors TEXT, -- JSON array of risk factors
    
    -- Statistics
    total_payments INTEGER DEFAULT 0,
    late_payments_count INTEGER DEFAULT 0,
    bounced_payments_count INTEGER DEFAULT 0,
    average_days_to_pay DECIMAL(6, 2),
    longest_delay_days INTEGER,
    
    -- Dates
    score_calculated_at DATETIME,
    score_expires_at DATETIME,
    
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (customer_id) REFERENCES customer_profiles_new(id) ON DELETE CASCADE
);

CREATE INDEX idx_credit_scores_tenant ON customer_credit_scores(tenant_id);
CREATE INDEX idx_credit_scores_customer ON customer_credit_scores(customer_id);
CREATE INDEX idx_credit_scores_tier ON customer_credit_scores(risk_tier);

-- Payment Reminders Table
CREATE TABLE IF NOT EXISTS payment_reminders (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    customer_id TEXT NOT NULL,
    invoice_id TEXT,
    
    -- Reminder Details
    reminder_type VARCHAR(50), -- 'pre_due', 'due_today', 'overdue_7', 'overdue_15', 'overdue_30'
    reminder_date DATETIME NOT NULL,
    reminder_method VARCHAR(50), -- 'email', 'sms', 'whatsapp', 'call'
    
    -- Status
    reminder_status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'sent', 'failed', 'cancelled'
    sent_at DATETIME,
    failure_reason TEXT,
    
    -- Content
    subject TEXT,
    message_body TEXT,
    
    -- Response
    customer_response TEXT,
    response_received_at DATETIME,
    payment_promised_date DATETIME,
    
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (customer_id) REFERENCES customer_profiles_new(id) ON DELETE CASCADE
);

CREATE INDEX idx_payment_reminders_tenant ON payment_reminders(tenant_id);
CREATE INDEX idx_payment_reminders_customer ON payment_reminders(customer_id);
CREATE INDEX idx_payment_reminders_date ON payment_reminders(reminder_date);
CREATE INDEX idx_payment_reminders_status ON payment_reminders(reminder_status);

-- Payment Pattern Analysis (for ML/AI)
CREATE TABLE IF NOT EXISTS payment_patterns (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    customer_id TEXT NOT NULL,
    
    -- Pattern Detection
    payment_day_of_month INTEGER, -- Most common payment day (1-31)
    payment_frequency VARCHAR(50), -- 'weekly', 'biweekly', 'monthly', 'quarterly'
    preferred_payment_method VARCHAR(50),
    
    -- Behavioral Metrics
    average_payment_cycle_days DECIMAL(6, 2),
    payment_consistency_index DECIMAL(5, 2), -- 0-1 (how consistent payments are)
    early_payment_rate DECIMAL(5, 2), -- Percentage of payments made early
    on_time_payment_rate DECIMAL(5, 2),
    late_payment_rate DECIMAL(5, 2),
    
    -- Seasonal Patterns
    seasonal_patterns TEXT, -- JSON: {month: payment_likelihood}
    best_payment_months TEXT, -- JSON array
    worst_payment_months TEXT, -- JSON array
    
    -- Predictions
    next_expected_payment_date DATETIME,
    predicted_payment_amount DECIMAL(15, 2),
    confidence_score DECIMAL(5, 2), -- 0-1
    
    -- Analysis Metadata
    pattern_confidence VARCHAR(20), -- 'low', 'medium', 'high'
    sample_size INTEGER, -- Number of payments analyzed
    last_analyzed_at DATETIME,
    
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (customer_id) REFERENCES customer_profiles_new(id) ON DELETE CASCADE
);

CREATE INDEX idx_payment_patterns_tenant ON payment_patterns(tenant_id);
CREATE INDEX idx_payment_patterns_customer ON payment_patterns(customer_id);

-- Aging Report Snapshots (for tracking trends)
CREATE TABLE IF NOT EXISTS aging_report_snapshots (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    customer_id TEXT,
    
    -- Snapshot Info
    snapshot_date DATETIME NOT NULL,
    snapshot_type VARCHAR(50) DEFAULT 'weekly', -- 'daily', 'weekly', 'monthly'
    
    -- Aging Buckets
    current_amount DECIMAL(15, 2) DEFAULT 0, -- 0-30 days
    days_30_amount DECIMAL(15, 2) DEFAULT 0, -- 31-60 days
    days_60_amount DECIMAL(15, 2) DEFAULT 0, -- 61-90 days
    days_90_amount DECIMAL(15, 2) DEFAULT 0, -- 90+ days
    total_outstanding DECIMAL(15, 2) DEFAULT 0,
    
    -- Counts
    current_invoices INTEGER DEFAULT 0,
    days_30_invoices INTEGER DEFAULT 0,
    days_60_invoices INTEGER DEFAULT 0,
    days_90_invoices INTEGER DEFAULT 0,
    
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (customer_id) REFERENCES customer_profiles_new(id) ON DELETE SET NULL
);

CREATE INDEX idx_aging_snapshots_tenant ON aging_report_snapshots(tenant_id);
CREATE INDEX idx_aging_snapshots_customer ON aging_report_snapshots(customer_id);
CREATE INDEX idx_aging_snapshots_date ON aging_report_snapshots(snapshot_date);
