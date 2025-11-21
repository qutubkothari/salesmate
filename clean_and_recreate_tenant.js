/**
 * Clean Slate Script - Delete old tenant and create fresh one
 * Phone: 971507055253
 * Password: 515253
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

const OLD_TENANT_ID = '099a25c5-453e-4d16-8e88-97a8fc3bc310';
const PHONE = '971507055253';
const PASSWORD = '515253';
const BUSINESS_NAME = 'SAK';

async function cleanSlate() {
    console.log('\n🗑️  STEP 1: Finding tenant ID for phone 971507055253...\n');
    
    try {
        // Find tenant ID first
        const { data: tenants } = await supabase
            .from('tenants')
            .select('id')
            .or(`owner_whatsapp_number.eq.${PHONE},phone_number.eq.${PHONE},bot_phone_number.eq.${PHONE}`);
        
        if (!tenants || tenants.length === 0) {
            console.log('   ℹ️ No existing tenants found. Proceeding to create new one...\n');
        } else {
            console.log(`   Found ${tenants.length} tenant(s) to delete:`);
            tenants.forEach(t => console.log(`   - ${t.id}`));
            console.log('\n🗑️  STEP 2: Deleting related data...\n');
            
            // Delete related data for each tenant
            for (const tenant of tenants) {
                const tenantId = tenant.id;
                console.log(`   Processing tenant: ${tenantId}`);
                
                const tables = [
                    'proactive_messaging_analytics',
                    'orders',
                    'products',
                    'categories',
                    'conversations',
                    'customer_profiles'
                ];
                
                for (const table of tables) {
                    const { error } = await supabase
                        .from(table)
                        .delete()
                        .eq('tenant_id', tenantId);
                    
                    if (error && !error.message.includes('Could not find')) {
                        console.log(`     ⚠️  ${table}: ${error.message}`);
                    }
                }
                
                // Now delete the tenant
                const { error: deleteError } = await supabase
                    .from('tenants')
                    .delete()
                    .eq('id', tenantId);
                
                if (deleteError) {
                    console.log(`     ❌ Failed to delete tenant: ${deleteError.message}`);
                } else {
                    console.log(`     ✅ Tenant ${tenantId} deleted`);
                }
            }
        }
        
        console.log('\n✅ Cleanup complete!\n');
        
    } catch (error) {
        console.log(`   Error during deletion: ${error.message}`);
    }
    
    console.log('🆕 STEP 3: Creating fresh tenant...\n');
    
    try {
        // Create new tenant (using actual fields from database)
        const { data: newTenant, error: tenantError} = await supabase
            .from('tenants')
            .insert({
                owner_whatsapp_number: PHONE,
                phone_number: PHONE,
                password: PASSWORD, // Plaintext
                business_name: BUSINESS_NAME,
                subscription_status: 'trial',
                subscription_tier: 'free',
                status: 'active',
                is_active: true,
                bot_phone_number: PHONE,
                admin_phones: [PHONE],
                created_at: new Date().toISOString()
            })
            .select()
            .single();
        
        if (tenantError) {
            console.log(`   ❌ Error creating tenant: ${tenantError.message}`);
            return;
        }
        
        console.log(`   ✅ New tenant created!`);
        console.log(`   ID: ${newTenant.id}`);
        console.log(`   Phone: ${newTenant.phone_number}`);
        console.log(`   Business: ${newTenant.business_name}\n`);
        
        console.log('📝 STEP 4: Updating desktop agent .env files...\n');
        
        // Update desktop-agent/.env
        const desktopEnvPath = path.join(__dirname, 'desktop-agent', '.env');
        let envContent = fs.readFileSync(desktopEnvPath, 'utf8');
        envContent = envContent.replace(/TENANT_ID=.*/g, `TENANT_ID=${newTenant.id}`);
        fs.writeFileSync(desktopEnvPath, envContent);
        console.log(`   ✅ Updated: desktop-agent/.env\n`);
        
        // Update public/download/.env
        const downloadEnvPath = path.join(__dirname, 'public', 'download', '.env');
        envContent = fs.readFileSync(downloadEnvPath, 'utf8');
        envContent = envContent.replace(/TENANT_ID=.*/g, `TENANT_ID=${newTenant.id}`);
        fs.writeFileSync(downloadEnvPath, envContent);
        console.log(`   ✅ Updated: public/download/.env\n`);
        
        console.log('🎉 COMPLETE! Fresh tenant created!\n');
        console.log('═══════════════════════════════════════════════\n');
        console.log('📋 LOGIN CREDENTIALS:\n');
        console.log(`   Phone: ${PHONE}`);
        console.log(`   Password: ${PASSWORD}`);
        console.log(`   Tenant ID: ${newTenant.id}\n`);
        console.log('═══════════════════════════════════════════════\n');
        console.log('🔄 NEXT STEPS:\n');
        console.log('   1. Rebuild desktop agent executable:');
        console.log('      cd desktop-agent && npm run build\n');
        console.log('   2. Clear browser cache or use incognito\n');
        console.log('   3. Login with phone: 971507055253, password: 515253\n');
        console.log('   4. Start agent: public/download/START-AGENT.bat\n');
        
    } catch (error) {
        console.log(`\n❌ Error: ${error.message}\n`);
    }
}

cleanSlate();
