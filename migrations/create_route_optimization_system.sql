-- Route Optimization System for FSM
-- Provides intelligent route planning using TSP algorithm, GPS clustering, and traffic patterns

-- Optimized route plans with metrics
CREATE TABLE IF NOT EXISTS optimized_routes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  salesman_id TEXT NOT NULL,
  route_name TEXT NOT NULL,
  route_date DATE NOT NULL,
  
  -- Route optimization metadata
  algorithm_used TEXT DEFAULT 'nearest_neighbor_2opt', -- nearest_neighbor, 2opt, genetic, etc.
  optimization_time_ms INTEGER DEFAULT 0,
  
  -- Visit sequence (ordered JSON array of visit IDs)
  visit_sequence TEXT NOT NULL, -- JSON: ["visit1", "visit2", "visit3"]
  total_visits INTEGER DEFAULT 0,
  
  -- Route metrics
  total_distance_km REAL DEFAULT 0.0,
  estimated_travel_time_minutes INTEGER DEFAULT 0,
  estimated_fuel_cost REAL DEFAULT 0.0,
  
  -- Start/end locations
  start_latitude REAL NOT NULL,
  start_longitude REAL NOT NULL,
  end_latitude REAL,
  end_longitude REAL,
  
  -- Time constraints
  route_start_time TEXT, -- HH:MM format
  route_end_time TEXT,
  
  -- Status tracking
  route_status TEXT DEFAULT 'planned', -- planned, in_progress, completed, cancelled
  actual_distance_km REAL,
  actual_time_minutes INTEGER,
  deviation_from_plan REAL, -- percentage
  
  -- Metadata
  constraints_applied TEXT, -- JSON: {"max_visits": 10, "max_distance": 100}
  optimization_notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (salesman_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_optimized_routes_tenant ON optimized_routes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_optimized_routes_salesman ON optimized_routes(salesman_id);
CREATE INDEX IF NOT EXISTS idx_optimized_routes_date ON optimized_routes(route_date);
CREATE INDEX IF NOT EXISTS idx_optimized_routes_status ON optimized_routes(route_status);

-- GPS clusters for grouping nearby visits
CREATE TABLE IF NOT EXISTS visit_clusters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  cluster_name TEXT NOT NULL,
  
  -- Cluster center (centroid)
  center_latitude REAL NOT NULL,
  center_longitude REAL NOT NULL,
  
  -- Cluster boundaries
  min_latitude REAL,
  max_latitude REAL,
  min_longitude REAL,
  max_longitude REAL,
  radius_km REAL,
  
  -- Cluster metadata
  visit_count INTEGER DEFAULT 0,
  total_potential REAL DEFAULT 0.0,
  
  -- Geographic info
  area_name TEXT, -- City, region, zone name
  area_type TEXT, -- urban, suburban, rural, industrial
  
  -- Clustering algorithm data
  clustering_method TEXT DEFAULT 'kmeans', -- kmeans, dbscan, hierarchical
  cluster_score REAL, -- silhouette score or similar metric
  
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE INDEX IF NOT EXISTS idx_visit_clusters_tenant ON visit_clusters(tenant_id);
CREATE INDEX IF NOT EXISTS idx_visit_clusters_location ON visit_clusters(center_latitude, center_longitude);

-- Assign visits to clusters
CREATE TABLE IF NOT EXISTS visit_cluster_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visit_id TEXT NOT NULL,
  cluster_id INTEGER NOT NULL,
  tenant_id TEXT NOT NULL,
  
  -- Distance from cluster center
  distance_from_center_km REAL DEFAULT 0.0,
  
  -- Assignment metadata
  assignment_confidence REAL DEFAULT 1.0, -- 0.0 to 1.0
  is_edge_case INTEGER DEFAULT 0, -- 1 if visit is on cluster boundary
  
  assigned_at TEXT DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (visit_id) REFERENCES visits(id),
  FOREIGN KEY (cluster_id) REFERENCES visit_clusters(id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  
  UNIQUE(visit_id, cluster_id)
);

CREATE INDEX IF NOT EXISTS idx_visit_cluster_assignments_visit ON visit_cluster_assignments(visit_id);
CREATE INDEX IF NOT EXISTS idx_visit_cluster_assignments_cluster ON visit_cluster_assignments(cluster_id);

-- Traffic patterns for time-based route optimization
CREATE TABLE IF NOT EXISTS traffic_patterns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  
  -- Route segment
  from_latitude REAL NOT NULL,
  from_longitude REAL NOT NULL,
  to_latitude REAL NOT NULL,
  to_longitude REAL NOT NULL,
  
  -- Time window
  day_of_week INTEGER NOT NULL, -- 0=Sunday, 6=Saturday
  hour_of_day INTEGER NOT NULL, -- 0-23
  
  -- Traffic metrics
  average_speed_kmh REAL DEFAULT 40.0,
  congestion_level TEXT DEFAULT 'moderate', -- light, moderate, heavy, severe
  delay_factor REAL DEFAULT 1.0, -- 1.0 = normal, 1.5 = 50% slower
  
  -- Sample size
  sample_count INTEGER DEFAULT 0,
  last_updated TEXT DEFAULT CURRENT_TIMESTAMP,
  
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE INDEX IF NOT EXISTS idx_traffic_patterns_tenant ON traffic_patterns(tenant_id);
CREATE INDEX IF NOT EXISTS idx_traffic_patterns_time ON traffic_patterns(day_of_week, hour_of_day);
CREATE INDEX IF NOT EXISTS idx_traffic_patterns_location ON traffic_patterns(from_latitude, from_longitude);

-- Route optimization preferences per salesman
CREATE TABLE IF NOT EXISTS route_preferences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  salesman_id TEXT NOT NULL,
  
  -- Optimization goals (weighted)
  minimize_distance_weight REAL DEFAULT 0.4,
  minimize_time_weight REAL DEFAULT 0.4,
  maximize_visits_weight REAL DEFAULT 0.2,
  
  -- Constraints
  max_visits_per_day INTEGER DEFAULT 10,
  max_distance_per_day_km REAL DEFAULT 150.0,
  max_hours_per_day REAL DEFAULT 8.0,
  
  -- Working hours
  work_start_time TEXT DEFAULT '09:00',
  work_end_time TEXT DEFAULT '18:00',
  lunch_break_start TEXT DEFAULT '13:00',
  lunch_break_duration_minutes INTEGER DEFAULT 60,
  
  -- Visit time assumptions
  average_visit_duration_minutes INTEGER DEFAULT 45,
  travel_buffer_percentage REAL DEFAULT 1.2, -- Add 20% buffer to travel estimates
  
  -- Start/end location (home/office)
  default_start_latitude REAL,
  default_start_longitude REAL,
  return_to_start INTEGER DEFAULT 1, -- 1 = return to start at end of day
  
  -- Preferences
  prefer_highways INTEGER DEFAULT 1,
  avoid_tolls INTEGER DEFAULT 0,
  fuel_cost_per_km REAL DEFAULT 0.15, -- USD or local currency per km
  
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (salesman_id) REFERENCES users(id),
  
  UNIQUE(tenant_id, salesman_id)
);

CREATE INDEX IF NOT EXISTS idx_route_preferences_salesman ON route_preferences(salesman_id);

-- Route optimization history and analytics
CREATE TABLE IF NOT EXISTS route_optimization_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  salesman_id TEXT NOT NULL,
  route_id INTEGER,
  
  -- Optimization event
  event_type TEXT NOT NULL, -- route_created, route_started, route_completed, route_modified
  event_timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
  
  -- Comparison metrics (planned vs actual)
  planned_distance_km REAL,
  actual_distance_km REAL,
  planned_time_minutes INTEGER,
  actual_time_minutes INTEGER,
  planned_visits INTEGER,
  completed_visits INTEGER,
  skipped_visits INTEGER,
  
  -- Performance metrics
  efficiency_score REAL, -- 0-100, how well the route was executed
  time_saved_minutes INTEGER, -- compared to unoptimized route
  distance_saved_km REAL,
  fuel_saved REAL,
  
  -- Notes
  deviation_reasons TEXT, -- JSON: [{"visit_id": "x", "reason": "customer unavailable"}]
  salesman_feedback TEXT,
  
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (salesman_id) REFERENCES users(id),
  FOREIGN KEY (route_id) REFERENCES optimized_routes(id)
);

CREATE INDEX IF NOT EXISTS idx_route_history_tenant ON route_optimization_history(tenant_id);
CREATE INDEX IF NOT EXISTS idx_route_history_salesman ON route_optimization_history(salesman_id);
CREATE INDEX IF NOT EXISTS idx_route_history_route ON route_optimization_history(route_id);
CREATE INDEX IF NOT EXISTS idx_route_history_event ON route_optimization_history(event_type);

-- Time windows for customer availability
CREATE TABLE IF NOT EXISTS customer_time_windows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  
  -- Time window
  day_of_week INTEGER, -- NULL = any day, 0-6 = specific day
  window_start_time TEXT NOT NULL, -- HH:MM
  window_end_time TEXT NOT NULL, -- HH:MM
  
  -- Priority
  is_strict INTEGER DEFAULT 1, -- 1 = must visit in window, 0 = preferred
  priority_level INTEGER DEFAULT 1, -- 1-5, higher = more important
  
  -- Metadata
  window_type TEXT DEFAULT 'business_hours', -- business_hours, appointment, flexible
  notes TEXT,
  
  valid_from DATE,
  valid_until DATE,
  is_active INTEGER DEFAULT 1,
  
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE INDEX IF NOT EXISTS idx_customer_time_windows_customer ON customer_time_windows(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_time_windows_active ON customer_time_windows(is_active);

-- Sample data for testing (optional)
-- INSERT INTO route_preferences (tenant_id, salesman_id, max_visits_per_day, max_distance_per_day_km)
-- VALUES ('tenant1', 'salesman1', 8, 120.0);
