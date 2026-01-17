-- Salesman Empowerment System - Database Schema
-- Run this migration to add tables for mobile/desktop app support

-- Salesman App Sessions (for tracking active devices and sync)
CREATE TABLE IF NOT EXISTS salesman_sessions (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    tenant_id TEXT NOT NULL,
    salesman_id TEXT NOT NULL,
    device_type TEXT NOT NULL CHECK(device_type IN ('mobile', 'desktop', 'web')),
    device_id TEXT NOT NULL,
    device_name TEXT,
    last_sync_at TEXT,
    app_version TEXT,
    platform TEXT CHECK(platform IN ('ios', 'android', 'windows', 'mac', 'linux', 'web')),
    is_online INTEGER DEFAULT 1,
    fcm_token TEXT, -- Firebase Cloud Messaging token for push notifications
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (salesman_id) REFERENCES salesmen(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_salesman ON salesman_sessions(salesman_id);
CREATE INDEX IF NOT EXISTS idx_sessions_device ON salesman_sessions(device_id);
CREATE INDEX IF NOT EXISTS idx_sessions_online ON salesman_sessions(is_online);

-- Offline Queue (for syncing offline changes from mobile/desktop)
CREATE TABLE IF NOT EXISTS offline_queue (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    tenant_id TEXT NOT NULL,
    salesman_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    entity_type TEXT NOT NULL CHECK(entity_type IN ('visit', 'customer', 'order', 'note', 'expense', 'photo')),
    entity_id TEXT,
    action TEXT NOT NULL CHECK(action IN ('create', 'update', 'delete')),
    data TEXT NOT NULL, -- JSON payload
    client_timestamp TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    synced INTEGER DEFAULT 0,
    synced_at TEXT,
    sync_attempts INTEGER DEFAULT 0,
    error TEXT,
    FOREIGN KEY (salesman_id) REFERENCES salesmen(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_queue_salesman ON offline_queue(salesman_id);
CREATE INDEX IF NOT EXISTS idx_queue_synced ON offline_queue(synced);
CREATE INDEX IF NOT EXISTS idx_queue_device ON offline_queue(device_id);

-- Customer Locations (for GPS tracking and route planning)
CREATE TABLE IF NOT EXISTS customer_locations (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    tenant_id TEXT NOT NULL,
    customer_id TEXT NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    address TEXT,
    city TEXT,
    state TEXT,
    pincode TEXT,
    is_verified INTEGER DEFAULT 0,
    verified_by TEXT, -- salesman_id who verified on ground
    verified_at TEXT,
    accuracy REAL, -- GPS accuracy in meters
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_customer_locations_customer ON customer_locations(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_locations_coords ON customer_locations(latitude, longitude);

-- Visit Photos (for documenting visits)
CREATE TABLE IF NOT EXISTS visit_photos (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    tenant_id TEXT NOT NULL,
    visit_id TEXT NOT NULL,
    photo_url TEXT NOT NULL,
    photo_type TEXT CHECK(photo_type IN ('checkin', 'checkout', 'product', 'shop', 'payment', 'other')),
    caption TEXT,
    latitude REAL,
    longitude REAL,
    taken_at TEXT DEFAULT (datetime('now')),
    uploaded_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (visit_id) REFERENCES visits(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_visit_photos_visit ON visit_photos(visit_id);

-- Salesman Expenses (for tracking field expenses)
CREATE TABLE IF NOT EXISTS salesman_expenses (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    tenant_id TEXT NOT NULL,
    salesman_id TEXT NOT NULL,
    expense_date TEXT NOT NULL,
    expense_type TEXT NOT NULL CHECK(expense_type IN ('travel', 'fuel', 'meals', 'accommodation', 'parking', 'toll', 'other')),
    amount REAL NOT NULL,
    description TEXT,
    receipt_url TEXT,
    visit_id TEXT, -- optional link to visit
    route_plan_id TEXT, -- optional link to route
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'paid')),
    approved_by TEXT,
    approved_at TEXT,
    rejection_reason TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (salesman_id) REFERENCES salesmen(id) ON DELETE CASCADE,
    FOREIGN KEY (visit_id) REFERENCES visits(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_expenses_salesman ON salesman_expenses(salesman_id);
CREATE INDEX IF NOT EXISTS idx_expenses_status ON salesman_expenses(status);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON salesman_expenses(expense_date);

-- Customer Notes (for salesman to record important information)
CREATE TABLE IF NOT EXISTS customer_notes (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    tenant_id TEXT NOT NULL,
    customer_id TEXT NOT NULL,
    salesman_id TEXT NOT NULL,
    note_type TEXT DEFAULT 'text' CHECK(note_type IN ('text', 'voice', 'photo')),
    note_text TEXT,
    file_url TEXT, -- for voice notes or photos
    is_important INTEGER DEFAULT 0,
    reminder_date TEXT, -- optional reminder
    visit_id TEXT, -- optional link to visit
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (salesman_id) REFERENCES salesmen(id) ON DELETE CASCADE,
    FOREIGN KEY (visit_id) REFERENCES visits(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_customer_notes_customer ON customer_notes(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_notes_salesman ON customer_notes(salesman_id);
CREATE INDEX IF NOT EXISTS idx_customer_notes_reminder ON customer_notes(reminder_date);

-- Route Plans (for daily route optimization)
CREATE TABLE IF NOT EXISTS route_plans (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    tenant_id TEXT NOT NULL,
    salesman_id TEXT NOT NULL,
    plan_date TEXT NOT NULL,
    plan_name TEXT,
    customer_sequence TEXT NOT NULL, -- JSON array of customer IDs in optimal order
    total_distance REAL, -- in kilometers
    estimated_duration INTEGER, -- in minutes
    actual_distance REAL,
    actual_duration INTEGER,
    start_time TEXT,
    end_time TEXT,
    status TEXT DEFAULT 'planned' CHECK(status IN ('planned', 'in_progress', 'completed', 'cancelled')),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (salesman_id) REFERENCES salesmen(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_route_plans_salesman ON route_plans(salesman_id);
CREATE INDEX IF NOT EXISTS idx_route_plans_date ON route_plans(plan_date);
CREATE INDEX IF NOT EXISTS idx_route_plans_status ON route_plans(status);

-- Commission Structure (for salesman earnings calculation)
CREATE TABLE IF NOT EXISTS commission_structure (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    tenant_id TEXT NOT NULL,
    rule_name TEXT NOT NULL,
    salesman_id TEXT, -- NULL means applies to all salesmen
    product_id TEXT, -- NULL means all products
    product_category TEXT, -- NULL means all categories
    customer_type TEXT, -- dealer, distributor, retailer, etc.
    commission_type TEXT NOT NULL CHECK(commission_type IN ('percentage', 'fixed', 'slab')),
    commission_value REAL NOT NULL,
    slab_data TEXT, -- JSON for slab-based commission
    min_order_value REAL,
    max_order_value REAL,
    effective_from TEXT NOT NULL,
    effective_to TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_commission_structure_salesman ON commission_structure(salesman_id);
CREATE INDEX IF NOT EXISTS idx_commission_structure_active ON commission_structure(is_active);

-- Salesman Commissions (calculated commission records)
CREATE TABLE IF NOT EXISTS salesman_commissions (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    tenant_id TEXT NOT NULL,
    salesman_id TEXT NOT NULL,
    order_id TEXT NOT NULL,
    commission_rule_id TEXT,
    order_amount REAL NOT NULL,
    commission_amount REAL NOT NULL,
    commission_percentage REAL,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'paid', 'cancelled')),
    approved_by TEXT,
    approved_at TEXT,
    paid_at TEXT,
    payment_reference TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (salesman_id) REFERENCES salesmen(id) ON DELETE CASCADE,
    FOREIGN KEY (commission_rule_id) REFERENCES commission_structure(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_commissions_salesman ON salesman_commissions(salesman_id);
CREATE INDEX IF NOT EXISTS idx_commissions_status ON salesman_commissions(status);
CREATE INDEX IF NOT EXISTS idx_commissions_order ON salesman_commissions(order_id);

-- Salesman Attendance (for tracking field presence)
CREATE TABLE IF NOT EXISTS salesman_attendance (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    tenant_id TEXT NOT NULL,
    salesman_id TEXT NOT NULL,
    attendance_date TEXT NOT NULL,
    checkin_time TEXT,
    checkin_latitude REAL,
    checkin_longitude REAL,
    checkin_address TEXT,
    checkout_time TEXT,
    checkout_latitude REAL,
    checkout_longitude REAL,
    checkout_address TEXT,
    total_visits INTEGER DEFAULT 0,
    total_orders INTEGER DEFAULT 0,
    total_revenue REAL DEFAULT 0,
    distance_travelled REAL, -- in kilometers
    status TEXT DEFAULT 'present' CHECK(status IN ('present', 'absent', 'half_day', 'leave', 'holiday')),
    leave_type TEXT, -- sick, casual, earned
    leave_reason TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (salesman_id) REFERENCES salesmen(id) ON DELETE CASCADE,
    UNIQUE(tenant_id, salesman_id, attendance_date)
);

CREATE INDEX IF NOT EXISTS idx_attendance_salesman ON salesman_attendance(salesman_id);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON salesman_attendance(attendance_date);
CREATE INDEX IF NOT EXISTS idx_attendance_status ON salesman_attendance(status);

-- Customer Visit Schedules (for recurring visit planning)
CREATE TABLE IF NOT EXISTS customer_visit_schedules (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    tenant_id TEXT NOT NULL,
    customer_id TEXT NOT NULL,
    salesman_id TEXT NOT NULL,
    frequency TEXT CHECK(frequency IN ('daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'custom')),
    day_of_week INTEGER, -- 0=Sunday, 6=Saturday (for weekly)
    day_of_month INTEGER, -- 1-31 (for monthly)
    custom_pattern TEXT, -- JSON for custom patterns
    next_visit_date TEXT,
    last_visit_date TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (salesman_id) REFERENCES salesmen(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_visit_schedules_customer ON customer_visit_schedules(customer_id);
CREATE INDEX IF NOT EXISTS idx_visit_schedules_salesman ON customer_visit_schedules(salesman_id);
CREATE INDEX IF NOT EXISTS idx_visit_schedules_next_date ON customer_visit_schedules(next_visit_date);

-- Notification Queue (for push notifications to mobile/desktop)
CREATE TABLE IF NOT EXISTS notification_queue (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    tenant_id TEXT NOT NULL,
    salesman_id TEXT NOT NULL,
    notification_type TEXT NOT NULL CHECK(notification_type IN ('target_reminder', 'visit_reminder', 'order_update', 'commission_update', 'announcement', 'urgent')),
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    data TEXT, -- JSON payload for app deep linking
    priority TEXT DEFAULT 'normal' CHECK(priority IN ('low', 'normal', 'high', 'urgent')),
    scheduled_for TEXT,
    sent_at TEXT,
    delivered_at TEXT,
    read_at TEXT,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'sent', 'delivered', 'read', 'failed')),
    error TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notifications_salesman ON notification_queue(salesman_id);
CREATE INDEX IF NOT EXISTS idx_notifications_status ON notification_queue(status);
CREATE INDEX IF NOT EXISTS idx_notifications_scheduled ON notification_queue(scheduled_for);

-- Add columns to existing visits table for mobile app support
-- (These will fail if columns already exist, which is fine)
ALTER TABLE visits ADD COLUMN checkin_time TEXT;
ALTER TABLE visits ADD COLUMN checkin_latitude REAL;
ALTER TABLE visits ADD COLUMN checkin_longitude REAL;
ALTER TABLE visits ADD COLUMN checkout_time TEXT;
ALTER TABLE visits ADD COLUMN checkout_latitude REAL;
ALTER TABLE visits ADD COLUMN checkout_longitude REAL;
ALTER TABLE visits ADD COLUMN actual_duration INTEGER; -- in minutes
ALTER TABLE visits ADD COLUMN products_discussed TEXT; -- JSON array
ALTER TABLE visits ADD COLUMN next_action TEXT;
ALTER TABLE visits ADD COLUMN next_action_date TEXT;
ALTER TABLE visits ADD COLUMN synced_from_device TEXT; -- device_id if created offline

SELECT 'Salesman Empowerment System schema created successfully!' as message;
