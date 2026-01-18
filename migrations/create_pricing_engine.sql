-- Advanced Pricing Engine Schema
-- Supports: Tiered, Volume, Account-specific, Contract, Seasonal, Geo-based pricing

-- Pricing Tiers (wholesale, retail, distributor, vip, etc.)
CREATE TABLE IF NOT EXISTS pricing_tiers (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    tenant_id TEXT NOT NULL,
    tier_code TEXT NOT NULL UNIQUE,
    tier_name TEXT NOT NULL,
    description TEXT,
    discount_percentage REAL DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (DATETIME('now')),
    updated_at TEXT DEFAULT (DATETIME('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- Price Lists (Master pricing with effective dates)
CREATE TABLE IF NOT EXISTS price_lists (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    currency TEXT DEFAULT 'INR',
    effective_from TEXT,
    effective_to TEXT,
    is_default INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (DATETIME('now')),
    updated_at TEXT DEFAULT (DATETIME('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- Product Prices (per price list)
CREATE TABLE IF NOT EXISTS product_prices (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    price_list_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    base_price REAL NOT NULL,
    cost_price REAL,
    min_price REAL,
    max_price REAL,
    created_at TEXT DEFAULT (DATETIME('now')),
    updated_at TEXT DEFAULT (DATETIME('now')),
    FOREIGN KEY (price_list_id) REFERENCES price_lists(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    UNIQUE(price_list_id, product_id)
);

-- Volume Discount Rules
CREATE TABLE IF NOT EXISTS volume_discounts (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    product_id TEXT,
    category TEXT,
    min_quantity INTEGER NOT NULL,
    max_quantity INTEGER,
    discount_type TEXT CHECK (discount_type IN ('percentage', 'fixed_amount')) DEFAULT 'percentage',
    discount_value REAL NOT NULL,
    priority INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (DATETIME('now')),
    updated_at TEXT DEFAULT (DATETIME('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

-- Account-Specific Pricing (Negotiated/Contract pricing)
CREATE TABLE IF NOT EXISTS account_pricing (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    tenant_id TEXT NOT NULL,
    customer_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    custom_price REAL NOT NULL,
    effective_from TEXT,
    effective_to TEXT,
    contract_reference TEXT,
    approved_by TEXT,
    notes TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (DATETIME('now')),
    updated_at TEXT DEFAULT (DATETIME('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (customer_id) REFERENCES customer_profiles_new(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    UNIQUE(customer_id, product_id, effective_from)
);

-- Promotional Campaigns
CREATE TABLE IF NOT EXISTS promotions (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    tenant_id TEXT NOT NULL,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    discount_type TEXT CHECK (discount_type IN ('percentage', 'fixed_amount', 'buy_x_get_y')) DEFAULT 'percentage',
    discount_value REAL NOT NULL,
    min_order_value REAL,
    max_discount_amount REAL,
    applicable_products TEXT, -- JSON array of product IDs
    applicable_categories TEXT, -- JSON array of categories
    applicable_tiers TEXT, -- JSON array of tier codes
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    usage_limit INTEGER,
    usage_count INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (DATETIME('now')),
    updated_at TEXT DEFAULT (DATETIME('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- Geo-Region Pricing
CREATE TABLE IF NOT EXISTS geo_pricing (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    tenant_id TEXT NOT NULL,
    region_name TEXT NOT NULL,
    state TEXT,
    city TEXT,
    pincode TEXT,
    price_adjustment_type TEXT CHECK (price_adjustment_type IN ('percentage', 'fixed_amount')) DEFAULT 'percentage',
    price_adjustment REAL DEFAULT 0,
    shipping_charges REAL DEFAULT 0,
    tax_rate REAL DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (DATETIME('now')),
    updated_at TEXT DEFAULT (DATETIME('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- Price Change History (Audit trail)
CREATE TABLE IF NOT EXISTS price_history (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    tenant_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    old_price REAL,
    new_price REAL,
    changed_by TEXT,
    reason TEXT,
    changed_at TEXT DEFAULT (DATETIME('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_pricing_tiers_tenant ON pricing_tiers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_price_lists_tenant ON price_lists(tenant_id);
CREATE INDEX IF NOT EXISTS idx_product_prices_product ON product_prices(product_id);
CREATE INDEX IF NOT EXISTS idx_volume_discounts_product ON volume_discounts(product_id);
CREATE INDEX IF NOT EXISTS idx_account_pricing_customer ON account_pricing(customer_id);
CREATE INDEX IF NOT EXISTS idx_account_pricing_product ON account_pricing(product_id);
CREATE INDEX IF NOT EXISTS idx_promotions_code ON promotions(code);
CREATE INDEX IF NOT EXISTS idx_promotions_dates ON promotions(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_geo_pricing_region ON geo_pricing(state, city);
CREATE INDEX IF NOT EXISTS idx_price_history_product ON price_history(product_id);
