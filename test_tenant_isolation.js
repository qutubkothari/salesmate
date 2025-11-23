// Test Tenant Isolation - Ensure no overlap between clients
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

async function testTenantIsolation() {
    console.log('\n🧪 Testing Tenant Isolation...\n');
    
    // Create 3 test tenants
    const testTenants = [
        { phone: '971501111111', password: 'test123', business: 'Test Business 1' },
        { phone: '971502222222', password: 'test123', business: 'Test Business 2' },
        { phone: '971503333333', password: 'test123', business: 'Test Business 3' }
    ];
    
    console.log('📝 Creating test tenants...');
    const createdTenants = [];
    
    for (const tenant of testTenants) {
        // Check if exists
        const { data: existing } = await supabase
            .from('tenants')
            .select('*')
            .eq('phone_number', tenant.phone)
            .single();
        
        if (existing) {
            console.log(`   ✅ ${tenant.phone} already exists`);
            createdTenants.push(existing);
        } else {
            const { data, error } = await supabase
                .from('tenants')
                .insert({
                    owner_whatsapp_number: tenant.phone,
                    phone_number: tenant.phone,
                    password: tenant.password,
                    business_name: tenant.business,
                    subscription_status: 'trial',
                    enabled_features: {
                        broadcast_enabled: true,
                        sales_assistant_enabled: true,
                        products_enabled: true,
                        orders_enabled: true,
                        analytics_enabled: true
                    }
                })
                .select()
                .single();
            
            if (error) {
                console.error(`   ❌ Failed to create ${tenant.phone}:`, error.message);
            } else {
                console.log(`   ✅ Created ${tenant.phone}`);
                createdTenants.push(data);
            }
        }
    }
    
    console.log('\n📊 Test Tenant Summary:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    for (const tenant of createdTenants) {
        console.log(`\n📱 ${tenant.business_name}`);
        console.log(`   Phone: ${tenant.phone_number}`);
        console.log(`   Password: test123`);
        console.log(`   Tenant ID: ${tenant.id}`);
        console.log(`   Status: ${tenant.subscription_status}`);
    }
    
    console.log('\n\n🎯 BROADCAST TESTING STEPS:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\n1. Login to Dashboard with each tenant:');
    console.log('   http://web.saksolution.com:8080/dashboard');
    console.log('   • Tenant 1: 971501111111 / test123');
    console.log('   • Tenant 2: 971502222222 / test123');
    console.log('   • Tenant 3: 971503333333 / test123');
    
    console.log('\n2. Connect Desktop Agent for EACH tenant:');
    console.log('   • Stop current agent');
    console.log('   • Edit public/download/.env with tenant ID');
    console.log('   • Run START-AGENT.bat');
    console.log('   • Scan QR code with tenant WhatsApp number');
    
    console.log('\n3. Send Test Broadcasts:');
    console.log('   • Send from Tenant 1 dashboard → Should come from 971501111111');
    console.log('   • Send from Tenant 2 dashboard → Should come from 971502222222');
    console.log('   • Send from Tenant 3 dashboard → Should come from 971503333333');
    
    console.log('\n4. Verify Isolation:');
    console.log('   • Each tenant sees ONLY their own broadcast history');
    console.log('   • Messages come from correct WhatsApp number');
    console.log('   • No cross-tenant data leakage');
    
    console.log('\n\n✅ Test tenants created! Start testing now.\n');
}

testTenantIsolation().catch(console.error);
