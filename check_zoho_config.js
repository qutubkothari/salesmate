const { supabase } = require('./services/config');

async function checkZohoConfig() {
    console.log('Checking Zoho configuration for both tenants...\n');
    
    // Check old tenant
    const { data: oldTenant, error: error1 } = await supabase
        .from('tenants')
        .select('id, business_name, zoho_client_id, zoho_client_secret, zoho_refresh_token, zoho_organization_id')
        .eq('id', 'c93fbde0-7d5d-473c-ab2b-5f677c9a495c')
        .single();
    
    console.log('=== OLD TENANT (c93fbde0) ===');
    if (oldTenant) {
        console.log('Business:', oldTenant.business_name);
        console.log('Zoho Client ID:', oldTenant.zoho_client_id ? '✅ Configured' : '❌ Not set');
        console.log('Zoho Client Secret:', oldTenant.zoho_client_secret ? '✅ Configured' : '❌ Not set');
        console.log('Zoho Refresh Token:', oldTenant.zoho_refresh_token ? '✅ Configured' : '❌ Not set');
        console.log('Zoho Organization ID:', oldTenant.zoho_organization_id ? '✅ Configured' : '❌ Not set');
    } else {
        console.log('Tenant not found:', error1);
    }
    
    console.log('\n=== NEW TENANT (45bebb5d) ===');
    // Check new tenant
    const { data: newTenant, error: error2 } = await supabase
        .from('tenants')
        .select('id, business_name, zoho_client_id, zoho_client_secret, zoho_refresh_token, zoho_organization_id')
        .eq('id', '45bebb5d-cbab-4338-a3eb-a5b0c4aeea4e')
        .single();
    
    if (newTenant) {
        console.log('Business:', newTenant.business_name);
        console.log('Zoho Client ID:', newTenant.zoho_client_id ? '✅ Configured' : '❌ Not set');
        console.log('Zoho Client Secret:', newTenant.zoho_client_secret ? '✅ Configured' : '❌ Not set');
        console.log('Zoho Refresh Token:', newTenant.zoho_refresh_token ? '✅ Configured' : '❌ Not set');
        console.log('Zoho Organization ID:', newTenant.zoho_organization_id ? '✅ Configured' : '❌ Not set');
    } else {
        console.log('Tenant not found:', error2);
    }
    
    process.exit(0);
}

checkZohoConfig();
