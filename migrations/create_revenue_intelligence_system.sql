-- Revenue Intelligence System
-- Track Customer Acquisition Cost (CAC), Lifetime Value (LTV), and revenue metrics

-- Marketing campaigns and spend tracking
CREATE TABLE IF NOT EXISTS marketing_campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  
  -- Campaign details
  campaign_name TEXT NOT NULL,
  campaign_type TEXT NOT NULL, -- email, whatsapp, social_media, events, referral, direct_sales
  campaign_channel TEXT, -- facebook_ads, google_ads, linkedin, cold_calling, etc.
  
  -- Time period
  start_date DATE NOT NULL,
  end_date DATE,
  is_active INTEGER DEFAULT 1,
  
  -- Budget and spend
  budget_allocated REAL DEFAULT 0.0,
  actual_spend REAL DEFAULT 0.0,
  currency TEXT DEFAULT 'USD',
  
  -- Performance metrics
  impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  leads_generated INTEGER DEFAULT 0,
  customers_acquired INTEGER DEFAULT 0,
  
  -- ROI metrics
  total_revenue_generated REAL DEFAULT 0.0,
  roi_percentage REAL,
  
  -- Targeting
  target_audience TEXT, -- JSON: {"region": "North", "industry": "Manufacturing"}
  
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_tenant ON marketing_campaigns(tenant_id);
CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_dates ON marketing_campaigns(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_active ON marketing_campaigns(is_active);

-- Customer acquisition source tracking
CREATE TABLE IF NOT EXISTS customer_acquisition_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  
  -- Acquisition details
  acquisition_date DATE NOT NULL,
  acquisition_source TEXT NOT NULL, -- referral, campaign, cold_call, website, trade_show, partner
  campaign_id INTEGER, -- Link to marketing campaign if applicable
  
  -- Attribution
  first_touch_channel TEXT, -- First interaction channel
  last_touch_channel TEXT, -- Last interaction before conversion
  attribution_model TEXT DEFAULT 'last_touch', -- last_touch, first_touch, multi_touch
  
  -- Cost tracking
  acquisition_cost REAL DEFAULT 0.0, -- Cost to acquire this specific customer
  
  -- Referral tracking
  referred_by_customer_id TEXT,
  referral_reward_paid REAL DEFAULT 0.0,
  
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (campaign_id) REFERENCES marketing_campaigns(id),
  FOREIGN KEY (referred_by_customer_id) REFERENCES customers(id),
  
  UNIQUE(tenant_id, customer_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_acquisition_customer ON customer_acquisition_sources(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_acquisition_campaign ON customer_acquisition_sources(campaign_id);
CREATE INDEX IF NOT EXISTS idx_customer_acquisition_date ON customer_acquisition_sources(acquisition_date);

-- Customer lifetime value tracking
CREATE TABLE IF NOT EXISTS customer_lifetime_value (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  
  -- LTV calculations
  total_revenue REAL DEFAULT 0.0,
  total_orders INTEGER DEFAULT 0,
  average_order_value REAL DEFAULT 0.0,
  
  -- Time-based metrics
  first_order_date DATE,
  last_order_date DATE,
  customer_age_days INTEGER DEFAULT 0,
  
  -- Purchase behavior
  purchase_frequency REAL DEFAULT 0.0, -- Orders per month
  expected_lifetime_months INTEGER DEFAULT 24,
  churn_risk_score REAL DEFAULT 0.0, -- 0-100
  
  -- Predicted LTV
  predicted_ltv REAL DEFAULT 0.0,
  ltv_calculation_method TEXT DEFAULT 'historical', -- historical, predictive, hybrid
  
  -- Profitability
  total_costs REAL DEFAULT 0.0, -- COGS + acquisition + servicing
  gross_profit REAL DEFAULT 0.0,
  profit_margin_percentage REAL DEFAULT 0.0,
  
  -- Customer segment
  value_tier TEXT, -- platinum, gold, silver, bronze, at_risk
  
  last_calculated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  
  UNIQUE(tenant_id, customer_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_ltv_customer ON customer_lifetime_value(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_ltv_tier ON customer_lifetime_value(value_tier);
CREATE INDEX IF NOT EXISTS idx_customer_ltv_churn ON customer_lifetime_value(churn_risk_score);

-- Cohort analysis for retention tracking
CREATE TABLE IF NOT EXISTS customer_cohorts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  
  -- Cohort definition
  cohort_name TEXT NOT NULL,
  cohort_date DATE NOT NULL, -- Month/quarter/year customers joined
  cohort_period TEXT DEFAULT 'month', -- month, quarter, year
  
  -- Cohort metrics
  initial_customers INTEGER DEFAULT 0,
  active_customers INTEGER DEFAULT 0,
  churned_customers INTEGER DEFAULT 0,
  
  -- Revenue metrics
  cohort_revenue REAL DEFAULT 0.0,
  average_revenue_per_customer REAL DEFAULT 0.0,
  
  -- Retention rates by period
  retention_month_1 REAL,
  retention_month_3 REAL,
  retention_month_6 REAL,
  retention_month_12 REAL,
  retention_month_24 REAL,
  
  -- Cohort characteristics
  acquisition_source TEXT, -- If cohort is source-specific
  customer_type TEXT, -- B2B, B2C, etc.
  
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE INDEX IF NOT EXISTS idx_customer_cohorts_tenant ON customer_cohorts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_customer_cohorts_date ON customer_cohorts(cohort_date);

-- Cohort membership (which customers belong to which cohorts)
CREATE TABLE IF NOT EXISTS cohort_memberships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cohort_id INTEGER NOT NULL,
  customer_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  
  joined_date DATE NOT NULL,
  is_active INTEGER DEFAULT 1,
  churn_date DATE,
  
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (cohort_id) REFERENCES customer_cohorts(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  
  UNIQUE(cohort_id, customer_id)
);

CREATE INDEX IF NOT EXISTS idx_cohort_memberships_cohort ON cohort_memberships(cohort_id);
CREATE INDEX IF NOT EXISTS idx_cohort_memberships_customer ON cohort_memberships(customer_id);

-- Revenue forecasting data
CREATE TABLE IF NOT EXISTS revenue_forecasts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  
  -- Forecast period
  forecast_period DATE NOT NULL, -- Month/quarter being forecasted
  forecast_type TEXT DEFAULT 'monthly', -- monthly, quarterly, yearly
  
  -- Forecasted metrics
  forecasted_revenue REAL DEFAULT 0.0,
  forecasted_customers INTEGER DEFAULT 0,
  forecasted_orders INTEGER DEFAULT 0,
  forecasted_aov REAL DEFAULT 0.0, -- Average order value
  
  -- Confidence intervals
  confidence_level REAL DEFAULT 0.80, -- 80% confidence
  lower_bound REAL,
  upper_bound REAL,
  
  -- Actual results (filled in after period completes)
  actual_revenue REAL,
  actual_customers INTEGER,
  actual_orders INTEGER,
  forecast_accuracy_percentage REAL,
  
  -- Forecasting method
  forecasting_model TEXT DEFAULT 'moving_average', -- moving_average, linear_regression, arima
  model_parameters TEXT, -- JSON with model-specific params
  
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE INDEX IF NOT EXISTS idx_revenue_forecasts_tenant ON revenue_forecasts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_revenue_forecasts_period ON revenue_forecasts(forecast_period);

-- Product profitability tracking
CREATE TABLE IF NOT EXISTS product_profitability (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  
  -- Revenue metrics
  total_revenue REAL DEFAULT 0.0,
  total_units_sold INTEGER DEFAULT 0,
  average_selling_price REAL DEFAULT 0.0,
  
  -- Cost metrics
  cost_of_goods_sold REAL DEFAULT 0.0, -- COGS
  marketing_cost_allocated REAL DEFAULT 0.0,
  storage_cost REAL DEFAULT 0.0,
  shipping_cost REAL DEFAULT 0.0,
  
  -- Profitability
  gross_profit REAL DEFAULT 0.0,
  gross_margin_percentage REAL DEFAULT 0.0,
  net_profit REAL DEFAULT 0.0,
  net_margin_percentage REAL DEFAULT 0.0,
  
  -- Period
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE INDEX IF NOT EXISTS idx_product_profitability_product ON product_profitability(product_id);
CREATE INDEX IF NOT EXISTS idx_product_profitability_period ON product_profitability(period_start, period_end);

-- Revenue intelligence summary metrics (aggregated daily)
CREATE TABLE IF NOT EXISTS revenue_intelligence_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  metric_date DATE NOT NULL,
  
  -- CAC metrics
  total_marketing_spend REAL DEFAULT 0.0,
  new_customers_acquired INTEGER DEFAULT 0,
  average_cac REAL DEFAULT 0.0,
  
  -- LTV metrics
  average_customer_ltv REAL DEFAULT 0.0,
  ltv_to_cac_ratio REAL DEFAULT 0.0,
  
  -- Revenue metrics
  total_revenue REAL DEFAULT 0.0,
  recurring_revenue REAL DEFAULT 0.0,
  new_customer_revenue REAL DEFAULT 0.0,
  
  -- Customer metrics
  total_active_customers INTEGER DEFAULT 0,
  churned_customers INTEGER DEFAULT 0,
  churn_rate_percentage REAL DEFAULT 0.0,
  
  -- Profitability
  total_profit REAL DEFAULT 0.0,
  profit_margin_percentage REAL DEFAULT 0.0,
  
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  
  UNIQUE(tenant_id, metric_date)
);

CREATE INDEX IF NOT EXISTS idx_revenue_metrics_tenant ON revenue_intelligence_metrics(tenant_id);
CREATE INDEX IF NOT EXISTS idx_revenue_metrics_date ON revenue_intelligence_metrics(metric_date);
