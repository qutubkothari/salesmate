-- Create missing feature tables

-- Interactive messages table (for WhatsApp buttons/lists)
CREATE TABLE IF NOT EXISTS interactive_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    customer_phone TEXT NOT NULL,
    message_type TEXT NOT NULL,
    payload TEXT,
    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Follow-ups table (for scheduled follow-up messages)
CREATE TABLE IF NOT EXISTS follow_ups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    customer_phone TEXT NOT NULL,
    scheduled_at DATETIME NOT NULL,
    message TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Drip campaign subscribers table
CREATE TABLE IF NOT EXISTS drip_campaign_subscribers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    customer_phone TEXT NOT NULL,
    campaign_id INTEGER,
    subscribed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_interactive_tenant ON interactive_messages(tenant_id);
CREATE INDEX IF NOT EXISTS idx_interactive_phone ON interactive_messages(customer_phone);
CREATE INDEX IF NOT EXISTS idx_followups_tenant ON follow_ups(tenant_id);
CREATE INDEX IF NOT EXISTS idx_followups_status ON follow_ups(status);
CREATE INDEX IF NOT EXISTS idx_drip_tenant ON drip_campaign_subscribers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_drip_status ON drip_campaign_subscribers(status);
