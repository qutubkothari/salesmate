/**
 * Database Migration: Add Feature Flags to Tenants
 * 
 * Run this to add the enabled_features column to your tenants table
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function addFeatureFlagsColumn() {
  console.log('\n🔄 Adding feature flags to tenants table...\n');
  
  try {
    // Note: Supabase doesn't support ALTER TABLE via client
    // You need to run this SQL in Supabase SQL Editor:
    
    const sqlCommand = `
-- Add enabled_features column to tenants table
ALTER TABLE tenants 
ADD COLUMN IF NOT EXISTS enabled_features JSONB DEFAULT '{
  "broadcast_enabled": true,
  "sales_assistant_enabled": true,
  "products_enabled": true,
  "orders_enabled": true,
  "analytics_enabled": true
}'::jsonb;

-- Update existing tenants to have all features enabled by default
UPDATE tenants 
SET enabled_features = '{
  "broadcast_enabled": true,
  "sales_assistant_enabled": true,
  "products_enabled": true,
  "orders_enabled": true,
  "analytics_enabled": true
}'::jsonb
WHERE enabled_features IS NULL;

-- Add index for faster queries
CREATE INDEX IF NOT EXISTS idx_tenants_features ON tenants USING gin(enabled_features);
    `;
    
    console.log('📋 Copy and run this SQL in your Supabase SQL Editor:\n');
    console.log('━'.repeat(70));
    console.log(sqlCommand);
    console.log('━'.repeat(70));
    console.log('\n✅ After running the SQL, all tenants will have feature flags!\n');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

addFeatureFlagsColumn();
