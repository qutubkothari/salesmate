-- Sales Pipeline Management System
-- Supports: Pipeline stages, Deals/Opportunities, Activities, Forecasting, Win/Loss Analysis

-- Pipeline Definitions (Sales Process Templates)
CREATE TABLE IF NOT EXISTS pipelines (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    tenant_id TEXT NOT NULL,
    pipeline_name TEXT NOT NULL,
    description TEXT,
    is_default INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_by TEXT,
    created_at TEXT DEFAULT (DATETIME('now')),
    updated_at TEXT DEFAULT (DATETIME('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Pipeline Stages (Lead → Qualified → Proposal → Negotiation → Won/Lost)
CREATE TABLE IF NOT EXISTS pipeline_stages (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    pipeline_id TEXT NOT NULL,
    stage_name TEXT NOT NULL,
    stage_order INTEGER NOT NULL, -- 1, 2, 3, etc.
    stage_type TEXT CHECK (stage_type IN ('open', 'won', 'lost')) DEFAULT 'open',
    probability INTEGER DEFAULT 50, -- Win probability percentage (0-100)
    expected_duration_days INTEGER, -- Average days in this stage
    color_code TEXT, -- For UI: #3B82F6
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (DATETIME('now')),
    FOREIGN KEY (pipeline_id) REFERENCES pipelines(id) ON DELETE CASCADE,
    UNIQUE(pipeline_id, stage_order)
);

-- Deals/Opportunities
CREATE TABLE IF NOT EXISTS deals (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    tenant_id TEXT NOT NULL,
    deal_name TEXT NOT NULL,
    customer_id TEXT,
    contact_person TEXT,
    pipeline_id TEXT NOT NULL,
    stage_id TEXT NOT NULL,
    owner_id TEXT NOT NULL, -- Salesperson responsible
    
    -- Financial
    deal_value REAL NOT NULL DEFAULT 0,
    currency TEXT DEFAULT 'INR',
    expected_revenue REAL, -- Weighted by probability
    discount_amount REAL DEFAULT 0,
    discount_percentage REAL DEFAULT 0,
    
    -- Dates
    created_date TEXT DEFAULT (DATETIME('now')),
    expected_close_date TEXT,
    actual_close_date TEXT,
    last_activity_date TEXT,
    
    -- Deal Details
    description TEXT,
    source TEXT, -- 'inbound', 'outbound', 'referral', 'partner'
    priority TEXT CHECK (priority IN ('low', 'medium', 'high', 'critical')) DEFAULT 'medium',
    
    -- Scoring
    score INTEGER DEFAULT 0, -- AI/Manual lead score (0-100)
    temperature TEXT CHECK (temperature IN ('cold', 'warm', 'hot')) DEFAULT 'warm',
    
    -- Status
    status TEXT CHECK (status IN ('open', 'won', 'lost', 'abandoned')) DEFAULT 'open',
    lost_reason TEXT,
    won_details TEXT,
    
    -- Competition
    competitors TEXT, -- JSON array of competitor names
    
    -- Metadata
    tags TEXT, -- JSON array of tags
    custom_fields TEXT, -- JSON for custom data
    
    created_at TEXT DEFAULT (DATETIME('now')),
    updated_at TEXT DEFAULT (DATETIME('now')),
    
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (customer_id) REFERENCES customer_profiles_new(id),
    FOREIGN KEY (pipeline_id) REFERENCES pipelines(id),
    FOREIGN KEY (stage_id) REFERENCES pipeline_stages(id),
    FOREIGN KEY (owner_id) REFERENCES users(id)
);

-- Deal Products (Line Items)
CREATE TABLE IF NOT EXISTS deal_products (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    deal_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_price REAL NOT NULL,
    discount REAL DEFAULT 0,
    total_price REAL NOT NULL,
    description TEXT,
    created_at TEXT DEFAULT (DATETIME('now')),
    FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id)
);

-- Deal Activities (Calls, Emails, Meetings, Notes)
CREATE TABLE IF NOT EXISTS deal_activities (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    deal_id TEXT NOT NULL,
    activity_type TEXT NOT NULL CHECK (activity_type IN ('call', 'email', 'meeting', 'note', 'task', 'demo', 'proposal_sent')),
    subject TEXT NOT NULL,
    description TEXT,
    performed_by TEXT NOT NULL,
    performed_at TEXT DEFAULT (DATETIME('now')),
    duration_minutes INTEGER,
    outcome TEXT, -- 'positive', 'neutral', 'negative', 'no_response'
    next_action TEXT,
    attachments TEXT, -- JSON array of file URLs
    FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE CASCADE,
    FOREIGN KEY (performed_by) REFERENCES users(id)
);

-- Stage History (Track deal movement through pipeline)
CREATE TABLE IF NOT EXISTS deal_stage_history (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    deal_id TEXT NOT NULL,
    from_stage_id TEXT,
    to_stage_id TEXT NOT NULL,
    changed_by TEXT NOT NULL,
    changed_at TEXT DEFAULT (DATETIME('now')),
    duration_days INTEGER, -- Days spent in previous stage
    notes TEXT,
    FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE CASCADE,
    FOREIGN KEY (from_stage_id) REFERENCES pipeline_stages(id),
    FOREIGN KEY (to_stage_id) REFERENCES pipeline_stages(id),
    FOREIGN KEY (changed_by) REFERENCES users(id)
);

-- Deal Notes & Comments
CREATE TABLE IF NOT EXISTS deal_notes (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    deal_id TEXT NOT NULL,
    note_text TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT DEFAULT (DATETIME('now')),
    is_pinned INTEGER DEFAULT 0,
    FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Forecasting Snapshots (Monthly/Quarterly projections)
CREATE TABLE IF NOT EXISTS forecast_snapshots (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    tenant_id TEXT NOT NULL,
    forecast_period TEXT NOT NULL, -- '2026-Q1', '2026-01'
    created_at TEXT DEFAULT (DATETIME('now')),
    created_by TEXT,
    
    -- Aggregate metrics
    total_pipeline_value REAL DEFAULT 0,
    weighted_pipeline_value REAL DEFAULT 0, -- Adjusted by probability
    expected_closures INTEGER DEFAULT 0,
    expected_revenue REAL DEFAULT 0,
    
    -- By stage
    stage_breakdown TEXT, -- JSON: {stage_id: {count, value}}
    
    -- Confidence
    confidence_level TEXT CHECK (confidence_level IN ('low', 'medium', 'high')) DEFAULT 'medium',
    
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Win/Loss Analysis
CREATE TABLE IF NOT EXISTS deal_outcomes (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    deal_id TEXT NOT NULL UNIQUE,
    outcome TEXT NOT NULL CHECK (outcome IN ('won', 'lost', 'abandoned')),
    
    -- Win reasons
    win_reason TEXT, -- 'pricing', 'features', 'relationship', 'timing'
    
    -- Loss reasons
    loss_reason TEXT, -- 'price_too_high', 'competitor', 'timing', 'budget', 'no_decision'
    competitor_name TEXT,
    
    -- Analysis
    feedback TEXT,
    lessons_learned TEXT,
    
    recorded_by TEXT,
    recorded_at TEXT DEFAULT (DATETIME('now')),
    
    FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE CASCADE,
    FOREIGN KEY (recorded_by) REFERENCES users(id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_deals_tenant ON deals(tenant_id);
CREATE INDEX IF NOT EXISTS idx_deals_customer ON deals(customer_id);
CREATE INDEX IF NOT EXISTS idx_deals_owner ON deals(owner_id);
CREATE INDEX IF NOT EXISTS idx_deals_stage ON deals(stage_id);
CREATE INDEX IF NOT EXISTS idx_deals_status ON deals(status);
CREATE INDEX IF NOT EXISTS idx_deals_close_date ON deals(expected_close_date);
CREATE INDEX IF NOT EXISTS idx_deal_activities_deal ON deal_activities(deal_id);
CREATE INDEX IF NOT EXISTS idx_deal_activities_type ON deal_activities(activity_type);
CREATE INDEX IF NOT EXISTS idx_deal_stage_history_deal ON deal_stage_history(deal_id);
CREATE INDEX IF NOT EXISTS idx_deal_products_deal ON deal_products(deal_id);
CREATE INDEX IF NOT EXISTS idx_pipelines_tenant ON pipelines(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_stages_pipeline ON pipeline_stages(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_forecast_tenant ON forecast_snapshots(tenant_id);
