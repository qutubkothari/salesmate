/**
 * Update Tenant Features Script
 * 
 * This script adds/updates feature flags for tenants to control:
 * - Broadcast messaging
 * - AI Sales Assistant
 * - Product catalog
 * - Order management
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

/**
 * Feature Flags:
 * - broadcast_enabled: Can send bulk WhatsApp broadcasts
 * - sales_assistant_enabled: AI-powered sales conversations
 * - products_enabled: Product catalog and management
 * - orders_enabled: Order processing and tracking
 * - analytics_enabled: View statistics and reports
 */

async function updateTenantFeatures(phoneNumber, features) {
  console.log(`\n🔧 Updating features for tenant: ${phoneNumber}\n`);
  
  try {
    // Check if tenant exists
    const { data: tenant, error: fetchError } = await supabase
      .from('tenants')
      .select('*')
      .eq('phone_number', phoneNumber)
      .single();
    
    if (fetchError || !tenant) {
      console.error('❌ Tenant not found:', phoneNumber);
      return;
    }
    
    console.log('✅ Found tenant:', tenant.business_name || tenant.phone_number);
    console.log('Current features:', tenant.enabled_features);
    
    // Update features
    const { data, error } = await supabase
      .from('tenants')
      .update({
        enabled_features: features,
        updated_at: new Date().toISOString()
      })
      .eq('phone_number', phoneNumber)
      .select();
    
    if (error) {
      console.error('❌ Update failed:', error.message);
      return;
    }
    
    console.log('\n✅ Features updated successfully!\n');
    console.log('New features:', features);
    console.log('\n📋 Feature Summary:');
    console.log(`  • Broadcast: ${features.broadcast_enabled ? '✅ ENABLED' : '❌ DISABLED'}`);
    console.log(`  • Sales Assistant: ${features.sales_assistant_enabled ? '✅ ENABLED' : '❌ DISABLED'}`);
    console.log(`  • Products: ${features.products_enabled ? '✅ ENABLED' : '❌ DISABLED'}`);
    console.log(`  • Orders: ${features.orders_enabled ? '✅ ENABLED' : '❌ DISABLED'}`);
    console.log(`  • Analytics: ${features.analytics_enabled ? '✅ ENABLED' : '❌ DISABLED'}`);
    console.log('');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

// ==================== CONFIGURATION PRESETS ====================

const PRESETS = {
  // Only broadcast - no AI, no products, no orders
  broadcast_only: {
    broadcast_enabled: true,
    sales_assistant_enabled: false,
    products_enabled: false,
    orders_enabled: false,
    analytics_enabled: true
  },
  
  // Broadcast + Sales Assistant - no products/orders
  broadcast_and_assistant: {
    broadcast_enabled: true,
    sales_assistant_enabled: true,
    products_enabled: false,
    orders_enabled: false,
    analytics_enabled: true
  },
  
  // Full features - everything enabled
  full_features: {
    broadcast_enabled: true,
    sales_assistant_enabled: true,
    products_enabled: true,
    orders_enabled: true,
    analytics_enabled: true
  },
  
  // Sales only - no broadcast
  sales_only: {
    broadcast_enabled: false,
    sales_assistant_enabled: true,
    products_enabled: true,
    orders_enabled: true,
    analytics_enabled: true
  }
};

// ==================== USAGE EXAMPLES ====================

async function main() {
  const phoneNumber = process.argv[2];
  const preset = process.argv[3];
  
  if (!phoneNumber) {
    console.log('\n📚 Usage:\n');
    console.log('  node update_tenant_features.js <phone_number> <preset>\n');
    console.log('Available presets:');
    console.log('  • broadcast_only          - Only bulk messaging');
    console.log('  • broadcast_and_assistant - Broadcast + AI assistant');
    console.log('  • sales_only              - Sales assistant without broadcast');
    console.log('  • full_features           - Everything enabled\n');
    console.log('Examples:');
    console.log('  node update_tenant_features.js 971507055253 broadcast_only');
    console.log('  node update_tenant_features.js 971507055253 full_features\n');
    return;
  }
  
  if (!preset || !PRESETS[preset]) {
    console.error('\n❌ Invalid preset. Choose from:', Object.keys(PRESETS).join(', '));
    return;
  }
  
  await updateTenantFeatures(phoneNumber, PRESETS[preset]);
}

// ==================== RUN ====================

if (require.main === module) {
  main().then(() => {
    console.log('✅ Done!\n');
    process.exit(0);
  }).catch(err => {
    console.error('❌ Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { updateTenantFeatures, PRESETS };
