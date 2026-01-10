/**
 * Setup SQLite database for local development
 * This creates all required tables and sample data
 */

const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.SQLITE_DB_PATH || process.env.DB_PATH || path.join(__dirname, 'local-database.db');
const db = new Database(dbPath);

console.log('[DB_SETUP] Creating SQLite database at:', dbPath);

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Drop existing tables
const dropTables = `
DROP TABLE IF EXISTS broadcast_batch_log;
DROP TABLE IF EXISTS bulk_schedules;
DROP TABLE IF EXISTS broadcast_processing_lock;
DROP TABLE IF EXISTS broadcast_queue;
DROP TABLE IF EXISTS broadcast_recipients;
DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS conversations;
DROP TABLE IF EXISTS customer_profiles;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS product_categories;
DROP TABLE IF EXISTS categories;
DROP TABLE IF EXISTS tenant_documents;
DROP TABLE IF EXISTS crawl_jobs;
DROP TABLE IF EXISTS website_embeddings;
DROP TABLE IF EXISTS whatsapp_connections;
DROP TABLE IF EXISTS contact_groups;
DROP TABLE IF EXISTS message_templates;
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS discounts;
DROP TABLE IF EXISTS tenants;
`;

db.exec(dropTables);
console.log('[DB_SETUP] Dropped existing tables');

// Create tables
const createTables = `
-- Tenants table
CREATE TABLE tenants (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    business_name TEXT NOT NULL,
    phone_number TEXT UNIQUE NOT NULL,
    owner_whatsapp_number TEXT,
    email TEXT,
    subscription_tier TEXT DEFAULT 'standard',
    subscription_status TEXT DEFAULT 'trial',
    trial_ends_at TEXT,
    subscription_start_date TEXT,
    subscription_end_date TEXT,
    bot_language TEXT DEFAULT 'English',
    is_active INTEGER DEFAULT 1,
    status TEXT DEFAULT 'active',
    password TEXT,
    daily_message_limit INTEGER DEFAULT 100,
    messages_sent_today INTEGER DEFAULT 0,
    last_message_reset_date TEXT DEFAULT (DATE('now')),
    business_address TEXT,
    business_website TEXT,
    industry_type TEXT,
    referral_code TEXT,
    bot_phone_number TEXT,
    currency_symbol TEXT DEFAULT '₹',
    default_packaging_unit TEXT DEFAULT 'piece',
    daily_summary_enabled INTEGER DEFAULT 1,
    abandoned_cart_delay_hours INTEGER DEFAULT 2,
    abandoned_cart_message TEXT,
    admin_phones TEXT,
    -- Optional per-tenant AI configuration
    openai_api_key TEXT,
    openai_project TEXT,
    openai_model TEXT,
    anthropic_api_key TEXT,
    gemini_api_key TEXT,
    -- Optional per-tenant Maytapi configuration
    maytapi_product_id TEXT,
    maytapi_phone_id TEXT,
    maytapi_api_key TEXT,
    created_at TEXT DEFAULT (DATETIME('now')),
    updated_at TEXT DEFAULT (DATETIME('now'))
);

-- WhatsApp Connections table
CREATE TABLE whatsapp_connections (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    tenant_id TEXT NOT NULL,
    session_name TEXT NOT NULL,
    phone_number TEXT,
    status TEXT DEFAULT 'disconnected',
    qr_code TEXT,
    last_connected TEXT,
    created_at TEXT DEFAULT (DATETIME('now')),
    updated_at TEXT DEFAULT (DATETIME('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    UNIQUE(tenant_id, session_name)
);

-- Customer Profiles table
CREATE TABLE customer_profiles (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    tenant_id TEXT NOT NULL,
    phone_number TEXT NOT NULL,
    name TEXT,
    email TEXT,
    customer_type TEXT DEFAULT 'retail',
    address TEXT,
    city TEXT,
    state TEXT,
    pincode TEXT,
    gst_number TEXT,
    lead_score INTEGER DEFAULT 0,
    total_orders INTEGER DEFAULT 0,
    total_spent REAL DEFAULT 0.00,
    last_order_date TEXT,
    created_at TEXT DEFAULT (DATETIME('now')),
    updated_at TEXT DEFAULT (DATETIME('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    UNIQUE(tenant_id, phone_number)
);

-- Conversations table
CREATE TABLE conversations (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    tenant_id TEXT NOT NULL,
    customer_profile_id TEXT,
    phone_number TEXT NOT NULL,
    state TEXT DEFAULT 'greeting',
    context TEXT DEFAULT '{}',
    last_message_time TEXT DEFAULT (DATETIME('now')),
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (DATETIME('now')),
    updated_at TEXT DEFAULT (DATETIME('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (customer_profile_id) REFERENCES customer_profiles(id) ON DELETE CASCADE
);

-- Audit Logs table
CREATE TABLE audit_logs (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    tenant_id TEXT NOT NULL,
    actor_type TEXT,
    actor_id TEXT,
    actor_name TEXT,
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id TEXT,
    summary TEXT,
    metadata TEXT,
    created_at TEXT DEFAULT (DATETIME('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- Product Categories table
CREATE TABLE product_categories (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    parent_category_id TEXT,
    display_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (DATETIME('now')),
    updated_at TEXT DEFAULT (DATETIME('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_category_id) REFERENCES product_categories(id) ON DELETE SET NULL,
    UNIQUE(tenant_id, name)
);

-- Categories table (used by dashboard/routes)
CREATE TABLE categories (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    created_at TEXT DEFAULT (DATETIME('now')),
    updated_at TEXT DEFAULT (DATETIME('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    UNIQUE(tenant_id, name)
);

-- Products table
CREATE TABLE products (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    category_id TEXT,
    category TEXT,
    brand TEXT,
    sku TEXT,
    model_number TEXT,
    price REAL DEFAULT 0.00,
    stock_quantity INTEGER DEFAULT 0,
    image_url TEXT,
    packaging_unit TEXT,
    units_per_carton INTEGER DEFAULT 1,
    carton_price REAL,
    is_active INTEGER DEFAULT 1,
    zoho_item_id TEXT,
    created_at TEXT DEFAULT (DATETIME('now')),
    updated_at TEXT DEFAULT (DATETIME('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES product_categories(id) ON DELETE SET NULL
);

-- Crawl Jobs table (used by website indexing routes)
CREATE TABLE crawl_jobs (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    tenant_id TEXT NOT NULL,
    url TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    error_message TEXT,
    pages_crawled INTEGER DEFAULT 0,
    chunks_created INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (DATETIME('now')),
    completed_at TEXT,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- Tenant Documents table (dashboard document uploads)
CREATE TABLE tenant_documents (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    tenant_id TEXT NOT NULL,
    filename TEXT,
    original_name TEXT,
    mime_type TEXT,
    size_bytes INTEGER,
    extracted_text TEXT,
    created_at TEXT DEFAULT (DATETIME('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- Orders table
CREATE TABLE orders (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    tenant_id TEXT NOT NULL,
    customer_profile_id TEXT,
    order_number TEXT UNIQUE,
    phone_number TEXT NOT NULL,
    customer_name TEXT,
    customer_type TEXT DEFAULT 'retail',
    total_amount REAL DEFAULT 0.00,
    discount_amount REAL DEFAULT 0.00,
    final_amount REAL DEFAULT 0.00,
    status TEXT DEFAULT 'pending',
    shipping_address TEXT,
    payment_status TEXT DEFAULT 'pending',
    zoho_invoice_id TEXT,
    created_at TEXT DEFAULT (DATETIME('now')),
    updated_at TEXT DEFAULT (DATETIME('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (customer_profile_id) REFERENCES customer_profiles(id) ON DELETE CASCADE
);

-- Order Items table
CREATE TABLE order_items (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    order_id TEXT NOT NULL,
    product_id TEXT,
    product_name TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price REAL NOT NULL,
    total_price REAL NOT NULL,
    created_at TEXT DEFAULT (DATETIME('now')),
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
);

-- Website Embeddings table
CREATE TABLE website_embeddings (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    tenant_id TEXT NOT NULL,
    content TEXT NOT NULL,
    embedding TEXT,
    metadata TEXT DEFAULT '{}',
    source_url TEXT,
    created_at TEXT DEFAULT (DATETIME('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- Broadcast Queue table
CREATE TABLE broadcast_queue (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    tenant_id TEXT NOT NULL,
    recipient_phone TEXT NOT NULL,
    message_text TEXT NOT NULL,
    media_url TEXT,
    scheduled_at TEXT DEFAULT (DATETIME('now')),
    status TEXT DEFAULT 'pending',
    sent_at TEXT,
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (DATETIME('now')),
    updated_at TEXT DEFAULT (DATETIME('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- Broadcast Recipients table
CREATE TABLE broadcast_recipients (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    tenant_id TEXT NOT NULL,
    phone_number TEXT NOT NULL,
    name TEXT,
    tags TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (DATETIME('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    UNIQUE(tenant_id, phone_number)
);

-- Contact Groups table
CREATE TABLE contact_groups (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    contact_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (DATETIME('now')),
    updated_at TEXT DEFAULT (DATETIME('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    UNIQUE(tenant_id, name)
);

-- Message Templates table
CREATE TABLE message_templates (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    template_text TEXT NOT NULL,
    category TEXT,
    variables TEXT DEFAULT '[]',
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (DATETIME('now')),
    updated_at TEXT DEFAULT (DATETIME('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    UNIQUE(tenant_id, name)
);

-- Discounts table
CREATE TABLE discounts (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    tenant_id TEXT NOT NULL,
    code TEXT NOT NULL,
    description TEXT,
    discount_type TEXT NOT NULL,
    discount_value REAL NOT NULL,
    min_order_amount REAL DEFAULT 0.00,
    max_discount_amount REAL,
    applicable_to TEXT DEFAULT 'all',
    valid_from TEXT DEFAULT (DATETIME('now')),
    valid_until TEXT,
    usage_limit INTEGER,
    usage_count INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (DATETIME('now')),
    updated_at TEXT DEFAULT (DATETIME('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    UNIQUE(tenant_id, code)
);

-- Broadcast Processing Lock table
CREATE TABLE broadcast_processing_lock (
    id INTEGER PRIMARY KEY,
    is_processing INTEGER DEFAULT 0,
    process_id TEXT,
    started_at TEXT,
    last_heartbeat TEXT
);

INSERT OR IGNORE INTO broadcast_processing_lock (id, is_processing) VALUES (1, 0);

-- Bulk Schedules table
CREATE TABLE bulk_schedules (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    tenant_id TEXT NOT NULL,
    to_phone_number TEXT,
    phone_number TEXT,
    campaign_id TEXT,
    campaign_name TEXT,
    message_text TEXT,
    message_body TEXT,
    image_url TEXT,
    media_url TEXT,
    scheduled_at TEXT,
    status TEXT DEFAULT 'pending',
    retry_count INTEGER DEFAULT 0,
    sequence_number INTEGER DEFAULT 0,
    delivery_status TEXT DEFAULT 'pending',
    error_message TEXT,
    processed_at TEXT,
    delivered_at TEXT,
    created_at TEXT DEFAULT (DATETIME('now')),
    updated_at TEXT DEFAULT (DATETIME('now')),
    parent_campaign_id TEXT,
    day_number INTEGER DEFAULT 1,
    total_days INTEGER DEFAULT 1,
    auto_scheduled INTEGER DEFAULT 0,
    greeting_template TEXT,
    random_delay_ms INTEGER DEFAULT 0,
    humanized INTEGER DEFAULT 0,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- Broadcast Batch Log table
CREATE TABLE broadcast_batch_log (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    process_id TEXT,
    started_at TEXT,
    completed_at TEXT,
    status TEXT,
    batch_size INTEGER DEFAULT 0,
    messages_sent INTEGER DEFAULT 0,
    messages_failed INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (DATETIME('now'))
);

-- Create indexes
CREATE INDEX idx_tenants_phone ON tenants(phone_number);
CREATE INDEX idx_tenants_active ON tenants(is_active);
CREATE INDEX idx_customer_profiles_tenant ON customer_profiles(tenant_id);
CREATE INDEX idx_customer_profiles_phone ON customer_profiles(phone_number);
CREATE INDEX idx_conversations_tenant ON conversations(tenant_id);
CREATE INDEX idx_conversations_active ON conversations(is_active);
CREATE INDEX idx_products_tenant ON products(tenant_id);
CREATE INDEX idx_products_active ON products(is_active);
CREATE INDEX idx_categories_tenant ON categories(tenant_id);
CREATE INDEX idx_crawl_jobs_tenant ON crawl_jobs(tenant_id);
CREATE INDEX idx_tenant_documents_tenant ON tenant_documents(tenant_id);
CREATE INDEX idx_orders_tenant ON orders(tenant_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_broadcast_queue_tenant ON broadcast_queue(tenant_id);
CREATE INDEX idx_broadcast_queue_status ON broadcast_queue(status);
`;

db.exec(createTables);
console.log('[DB_SETUP] Created all tables');

// Insert test tenant
const insertTenant = db.prepare(`
    INSERT INTO tenants (
        business_name,
        phone_number,
        owner_whatsapp_number,
        subscription_tier,
        bot_language,
        password,
        is_active
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
`);

try {
    const info = insertTenant.run(
        'Test Business',
        '918484862949',
        '918484862949@c.us',
        'standard',
        'English',
        '5253',
        1
    );
    console.log('[DB_SETUP] Created test tenant with ID:', info.lastInsertRowid);
    console.log('[DB_SETUP] Login with phone: 918484862949 and password: 5253');
} catch (error) {
    console.log('[DB_SETUP] Tenant might already exist:', error.message);
}

// Insert some sample products
const tenantId = db.prepare('SELECT id FROM tenants WHERE phone_number = ?').get('918484862949')?.id;

if (tenantId) {
    const insertProduct = db.prepare(`
        INSERT INTO products (tenant_id, name, description, price, stock_quantity)
        VALUES (?, ?, ?, ?, ?)
    `);
    
    try {
        insertProduct.run(tenantId, 'Sample Product 1', 'This is a test product', 100.00, 50);
        insertProduct.run(tenantId, 'Sample Product 2', 'Another test product', 200.00, 30);
        console.log('[DB_SETUP] Created sample products');
    } catch (error) {
        console.log('[DB_SETUP] Sample products might already exist');
    }
}

db.close();

console.log('[DB_SETUP] ✅ Database setup complete!');
console.log('[DB_SETUP] Database location:', dbPath);
console.log('[DB_SETUP] You can now start the application');
