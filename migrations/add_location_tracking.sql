-- Location Tracking and Geo-fencing Tables
-- Stores salesman location data, check-ins, and visit tracking

-- Table: salesman_locations
-- Real-time location tracking for salesmen
CREATE TABLE IF NOT EXISTS salesman_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salesman_id UUID NOT NULL REFERENCES salesmen(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  latitude DECIMAL(10, 8) NOT NULL,
  longitude DECIMAL(11, 8) NOT NULL,
  accuracy DECIMAL(10, 2), -- GPS accuracy in meters
  recorded_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Index for finding recent locations
CREATE INDEX IF NOT EXISTS idx_salesman_locations_salesman 
ON salesman_locations(salesman_id, recorded_at DESC);

-- Index for geo-spatial queries (optional, if using PostGIS)
CREATE INDEX IF NOT EXISTS idx_salesman_locations_coords 
ON salesman_locations(latitude, longitude);

-- Table: customer_visits
-- Track salesman visits to customer locations
CREATE TABLE IF NOT EXISTS customer_visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salesman_id UUID NOT NULL REFERENCES salesmen(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customer_profiles_new(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  visit_type TEXT NOT NULL, -- 'follow_up', 'cold_call', 'delivery', 'service'
  
  -- Check-in data
  check_in_time TIMESTAMP NOT NULL,
  check_in_latitude DECIMAL(10, 8) NOT NULL,
  check_in_longitude DECIMAL(11, 8) NOT NULL,
  check_in_accuracy DECIMAL(10, 2),
  check_in_address TEXT,
  
  -- Check-out data
  check_out_time TIMESTAMP,
  check_out_latitude DECIMAL(10, 8),
  check_out_longitude DECIMAL(11, 8),
  check_out_accuracy DECIMAL(10, 2),
  
  -- Visit details
  duration_minutes INTEGER, -- Auto-calculated on check-out
  distance_from_customer DECIMAL(10, 2), -- Distance in meters from customer location
  notes TEXT,
  outcome TEXT, -- 'successful', 'not_available', 'rescheduled', 'cancelled'
  
  -- Link to follow-up if this visit was for a scheduled follow-up
  conversation_id UUID REFERENCES conversations_new(id) ON DELETE SET NULL,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Index for salesman visit history
CREATE INDEX IF NOT EXISTS idx_customer_visits_salesman 
ON customer_visits(salesman_id, check_in_time DESC);

-- Index for customer visit history
CREATE INDEX IF NOT EXISTS idx_customer_visits_customer 
ON customer_visits(customer_id, check_in_time DESC);

-- Index for daily route planning
CREATE INDEX IF NOT EXISTS idx_customer_visits_date 
ON customer_visits(tenant_id, check_in_time::date);

-- Table: customer_addresses
-- Store validated customer addresses with geocoding
CREATE TABLE IF NOT EXISTS customer_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customer_profiles_new(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  
  -- Address details
  address_line TEXT NOT NULL,
  city TEXT,
  state TEXT,
  postal_code TEXT,
  country TEXT DEFAULT 'India',
  
  -- Geocoded coordinates
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  geocoded_at TIMESTAMP,
  
  -- Address metadata
  is_primary BOOLEAN DEFAULT true,
  is_verified BOOLEAN DEFAULT false,
  verified_at TIMESTAMP,
  verified_by UUID REFERENCES salesmen(id),
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Index for customer addresses
CREATE INDEX IF NOT EXISTS idx_customer_addresses_customer 
ON customer_addresses(customer_id);

-- Ensure only one primary address per customer
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_addresses_primary 
ON customer_addresses(customer_id) 
WHERE is_primary = true;

-- Table: daily_routes
-- Optimized daily routes for salesmen
CREATE TABLE IF NOT EXISTS daily_routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salesman_id UUID NOT NULL REFERENCES salesmen(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  
  route_date DATE NOT NULL,
  
  -- Route metadata
  total_customers INTEGER DEFAULT 0,
  total_distance_km DECIMAL(10, 2), -- Estimated total distance
  estimated_duration_minutes INTEGER, -- Estimated total duration
  
  -- Route optimization
  optimized_order JSONB, -- Array of customer IDs in optimal visit order
  optimization_algorithm TEXT, -- 'nearest_neighbor', 'genetic', 'manual'
  optimized_at TIMESTAMP,
  
  -- Status tracking
  status TEXT DEFAULT 'planned', -- 'planned', 'in_progress', 'completed', 'cancelled'
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Index for finding routes by date
CREATE INDEX IF NOT EXISTS idx_daily_routes_salesman_date 
ON daily_routes(salesman_id, route_date DESC);

-- Unique constraint: one route per salesman per day
CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_routes_unique 
ON daily_routes(salesman_id, route_date);

-- Table: geo_fence_rules
-- Define geo-fencing rules for visit verification
CREATE TABLE IF NOT EXISTS geo_fence_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  
  rule_name TEXT NOT NULL,
  rule_type TEXT NOT NULL, -- 'customer_proximity', 'territory_boundary', 'office_location'
  
  -- Geo-fence parameters
  center_latitude DECIMAL(10, 8),
  center_longitude DECIMAL(11, 8),
  radius_meters INTEGER, -- For circular geo-fences
  
  -- Validation rules
  min_visit_duration_minutes INTEGER DEFAULT 5,
  max_distance_from_customer DECIMAL(10, 2) DEFAULT 100.0, -- 100 meters
  
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Index for active geo-fence rules
CREATE INDEX IF NOT EXISTS idx_geo_fence_rules_tenant 
ON geo_fence_rules(tenant_id) 
WHERE is_active = true;

-- Add location columns to customer_profiles_new (if not exists)
ALTER TABLE customer_profiles_new
ADD COLUMN IF NOT EXISTS latitude DECIMAL(10, 8),
ADD COLUMN IF NOT EXISTS longitude DECIMAL(11, 8),
ADD COLUMN IF NOT EXISTS address_geocoded_at TIMESTAMP;

-- Comments
COMMENT ON TABLE salesman_locations IS 'Real-time GPS location tracking for salesmen';
COMMENT ON TABLE customer_visits IS 'Check-in/check-out tracking for customer visits';
COMMENT ON TABLE customer_addresses IS 'Validated customer addresses with geocoding';
COMMENT ON TABLE daily_routes IS 'Optimized daily visit routes for salesmen';
COMMENT ON TABLE geo_fence_rules IS 'Geo-fencing rules for visit verification';
