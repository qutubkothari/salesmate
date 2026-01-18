-- Advanced Analytics & Reporting System
-- Custom dashboards, reports, KPIs, metrics, scheduled reports, data exports

-- Custom Dashboards
CREATE TABLE IF NOT EXISTS analytics_dashboards (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    tenant_id TEXT NOT NULL,
    dashboard_name TEXT NOT NULL,
    description TEXT,
    dashboard_type TEXT CHECK (dashboard_type IN ('sales', 'marketing', 'operations', 'executive', 'custom')) DEFAULT 'custom',
    
    -- Layout & Configuration
    layout_config TEXT, -- JSON: widget positions, sizes
    refresh_interval INTEGER DEFAULT 300, -- Seconds
    
    -- Visibility
    is_public INTEGER DEFAULT 0,
    owner_id TEXT,
    shared_with TEXT, -- JSON array of user IDs
    
    -- Settings
    date_range_default TEXT DEFAULT 'last_30_days', -- 'today', 'last_7_days', 'last_30_days', 'this_month', 'custom'
    timezone TEXT DEFAULT 'Asia/Kolkata',
    is_active INTEGER DEFAULT 1,
    
    created_at TEXT DEFAULT (DATETIME('now')),
    updated_at TEXT DEFAULT (DATETIME('now')),
    
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (owner_id) REFERENCES users(id)
);

-- Dashboard Widgets (charts, tables, metrics)
CREATE TABLE IF NOT EXISTS analytics_widgets (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    dashboard_id TEXT NOT NULL,
    widget_name TEXT NOT NULL,
    widget_type TEXT CHECK (widget_type IN (
        'line_chart', 'bar_chart', 'pie_chart', 'donut_chart',
        'metric_card', 'table', 'funnel', 'gauge', 'heatmap', 'trend'
    )) NOT NULL,
    
    -- Data Source
    data_source TEXT NOT NULL, -- 'deals', 'orders', 'customers', 'activities', 'custom_query'
    query_config TEXT, -- JSON: filters, aggregations, grouping
    
    -- Visualization
    chart_config TEXT, -- JSON: colors, axes, legends
    
    -- Position & Size
    position_x INTEGER DEFAULT 0,
    position_y INTEGER DEFAULT 0,
    width INTEGER DEFAULT 4,
    height INTEGER DEFAULT 3,
    
    -- Refresh
    auto_refresh INTEGER DEFAULT 1,
    cache_duration INTEGER DEFAULT 60, -- Seconds
    
    created_at TEXT DEFAULT (DATETIME('now')),
    
    FOREIGN KEY (dashboard_id) REFERENCES analytics_dashboards(id) ON DELETE CASCADE
);

-- KPIs & Metrics Definitions
CREATE TABLE IF NOT EXISTS analytics_kpis (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    tenant_id TEXT NOT NULL,
    kpi_name TEXT NOT NULL,
    kpi_category TEXT CHECK (kpi_category IN (
        'sales', 'revenue', 'conversion', 'customer', 'pipeline', 'performance'
    )) NOT NULL,
    
    -- Calculation
    calculation_type TEXT CHECK (calculation_type IN (
        'sum', 'avg', 'count', 'max', 'min', 'ratio', 'percentage', 'custom'
    )) NOT NULL,
    calculation_config TEXT, -- JSON: formula, fields
    
    -- Target & Goals
    target_value REAL,
    target_period TEXT, -- 'daily', 'weekly', 'monthly', 'quarterly', 'yearly'
    
    -- Display
    display_format TEXT DEFAULT 'number', -- 'number', 'currency', 'percentage'
    currency_symbol TEXT DEFAULT '₹',
    decimal_places INTEGER DEFAULT 0,
    
    -- Status Thresholds
    critical_threshold REAL, -- Below this is critical
    warning_threshold REAL, -- Below this is warning
    good_threshold REAL, -- Above this is good
    
    -- Metadata
    description TEXT,
    is_active INTEGER DEFAULT 1,
    
    created_at TEXT DEFAULT (DATETIME('now')),
    updated_at TEXT DEFAULT (DATETIME('now')),
    
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- KPI Values (historical tracking)
CREATE TABLE IF NOT EXISTS analytics_kpi_values (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    kpi_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    
    -- Value
    calculated_value REAL NOT NULL,
    target_value REAL,
    achievement_percentage REAL,
    
    -- Status
    status TEXT CHECK (status IN ('critical', 'warning', 'on_track', 'exceeding')) DEFAULT 'on_track',
    
    -- Period
    period_type TEXT, -- 'daily', 'weekly', 'monthly', 'quarterly', 'yearly'
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    
    -- Metadata
    calculation_details TEXT, -- JSON: breakdown of calculation
    
    calculated_at TEXT DEFAULT (DATETIME('now')),
    
    FOREIGN KEY (kpi_id) REFERENCES analytics_kpis(id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- Saved Reports
CREATE TABLE IF NOT EXISTS analytics_reports (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    tenant_id TEXT NOT NULL,
    report_name TEXT NOT NULL,
    report_type TEXT CHECK (report_type IN (
        'sales_summary', 'pipeline_analysis', 'customer_insights',
        'performance_review', 'forecasting', 'custom'
    )) NOT NULL,
    
    -- Configuration
    data_sources TEXT, -- JSON array of tables/sources
    filters TEXT, -- JSON: date ranges, user filters, status filters
    columns TEXT, -- JSON array of columns to include
    grouping TEXT, -- JSON: group by fields
    sorting TEXT, -- JSON: sort order
    
    -- Aggregations
    aggregations TEXT, -- JSON: sum, avg, count for specified fields
    
    -- Formatting
    display_config TEXT, -- JSON: formatting rules, conditional formatting
    
    -- Access Control
    owner_id TEXT,
    is_public INTEGER DEFAULT 0,
    shared_with TEXT, -- JSON array of user IDs
    
    -- Schedule
    is_scheduled INTEGER DEFAULT 0,
    schedule_frequency TEXT, -- 'daily', 'weekly', 'monthly'
    schedule_time TEXT, -- Time to run
    schedule_recipients TEXT, -- JSON array of email addresses
    
    -- Metadata
    description TEXT,
    is_active INTEGER DEFAULT 1,
    last_generated_at TEXT,
    
    created_at TEXT DEFAULT (DATETIME('now')),
    updated_at TEXT DEFAULT (DATETIME('now')),
    
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (owner_id) REFERENCES users(id)
);

-- Report Runs (execution history)
CREATE TABLE IF NOT EXISTS analytics_report_runs (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    report_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    
    -- Execution
    triggered_by TEXT, -- 'manual', 'scheduled', 'api'
    triggered_by_user TEXT,
    
    -- Results
    status TEXT CHECK (status IN ('pending', 'running', 'completed', 'failed')) DEFAULT 'pending',
    rows_generated INTEGER DEFAULT 0,
    execution_time_ms INTEGER,
    
    -- Output
    output_format TEXT, -- 'json', 'csv', 'pdf', 'excel'
    output_path TEXT, -- File path or URL
    output_size_bytes INTEGER,
    
    -- Error Handling
    error_message TEXT,
    
    started_at TEXT,
    completed_at TEXT,
    
    FOREIGN KEY (report_id) REFERENCES analytics_reports(id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (triggered_by_user) REFERENCES users(id)
);

-- Data Export Configurations
CREATE TABLE IF NOT EXISTS analytics_exports (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    tenant_id TEXT NOT NULL,
    export_name TEXT NOT NULL,
    
    -- Source
    data_source TEXT NOT NULL, -- Table or query name
    custom_query TEXT, -- SQL query if data_source is 'custom'
    
    -- Filters
    filters TEXT, -- JSON: conditions
    
    -- Format
    export_format TEXT CHECK (export_format IN ('csv', 'excel', 'json', 'pdf')) DEFAULT 'csv',
    include_headers INTEGER DEFAULT 1,
    
    -- Schedule
    is_scheduled INTEGER DEFAULT 0,
    schedule_frequency TEXT,
    schedule_time TEXT,
    
    -- Destination
    destination_type TEXT CHECK (destination_type IN ('download', 'email', 'cloud_storage')) DEFAULT 'download',
    destination_config TEXT, -- JSON: email addresses, storage paths
    
    -- Metadata
    owner_id TEXT,
    last_executed_at TEXT,
    is_active INTEGER DEFAULT 1,
    
    created_at TEXT DEFAULT (DATETIME('now')),
    
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (owner_id) REFERENCES users(id)
);

-- Custom Metrics (user-defined calculations)
CREATE TABLE IF NOT EXISTS analytics_custom_metrics (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    tenant_id TEXT NOT NULL,
    metric_name TEXT NOT NULL,
    
    -- Calculation
    formula TEXT NOT NULL, -- E.g., "total_revenue / total_customers"
    data_sources TEXT, -- JSON: tables/fields used
    
    -- Display
    display_format TEXT DEFAULT 'number',
    unit TEXT, -- 'currency', 'percentage', 'days', etc.
    
    -- Metadata
    description TEXT,
    category TEXT,
    owner_id TEXT,
    is_active INTEGER DEFAULT 1,
    
    created_at TEXT DEFAULT (DATETIME('now')),
    
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (owner_id) REFERENCES users(id)
);

-- Analytics Insights (AI-generated observations)
CREATE TABLE IF NOT EXISTS analytics_insights (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    tenant_id TEXT NOT NULL,
    
    -- Insight Details
    insight_type TEXT CHECK (insight_type IN (
        'trend', 'anomaly', 'opportunity', 'risk', 'achievement'
    )) NOT NULL,
    insight_title TEXT NOT NULL,
    insight_description TEXT,
    
    -- Context
    metric_name TEXT,
    metric_value REAL,
    comparison_value REAL, -- Previous period or target
    change_percentage REAL,
    
    -- Significance
    severity TEXT CHECK (severity IN ('critical', 'high', 'medium', 'low')) DEFAULT 'medium',
    confidence_score REAL DEFAULT 0.0,
    
    -- Recommendation
    recommended_action TEXT,
    
    -- Period
    period_start TEXT,
    period_end TEXT,
    
    -- Status
    is_read INTEGER DEFAULT 0,
    is_dismissed INTEGER DEFAULT 0,
    
    created_at TEXT DEFAULT (DATETIME('now')),
    
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- Saved Filters (reusable filter configurations)
CREATE TABLE IF NOT EXISTS analytics_saved_filters (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    tenant_id TEXT NOT NULL,
    filter_name TEXT NOT NULL,
    
    -- Filter Configuration
    filter_config TEXT NOT NULL, -- JSON: all filter settings
    applies_to TEXT, -- 'deals', 'customers', 'orders', 'all'
    
    -- Access
    owner_id TEXT,
    is_public INTEGER DEFAULT 0,
    
    created_at TEXT DEFAULT (DATETIME('now')),
    
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (owner_id) REFERENCES users(id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_dashboards_tenant ON analytics_dashboards(tenant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_dashboards_owner ON analytics_dashboards(owner_id);
CREATE INDEX IF NOT EXISTS idx_widgets_dashboard ON analytics_widgets(dashboard_id);
CREATE INDEX IF NOT EXISTS idx_kpis_tenant ON analytics_kpis(tenant_id, kpi_category);
CREATE INDEX IF NOT EXISTS idx_kpi_values_kpi ON analytics_kpi_values(kpi_id, period_start DESC);
CREATE INDEX IF NOT EXISTS idx_kpi_values_tenant ON analytics_kpi_values(tenant_id, calculated_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_tenant ON analytics_reports(tenant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_reports_owner ON analytics_reports(owner_id);
CREATE INDEX IF NOT EXISTS idx_report_runs_report ON analytics_report_runs(report_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_exports_tenant ON analytics_exports(tenant_id, is_scheduled);
CREATE INDEX IF NOT EXISTS idx_insights_tenant ON analytics_insights(tenant_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_saved_filters_tenant ON analytics_saved_filters(tenant_id, applies_to);
