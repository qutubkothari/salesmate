const { supabase } = require('./services/config');

async function updateZohoOrgId() {
    const tenantId = '45bebb5d-cbab-4338-a3eb-a5b0c4aeea4e';
    const organizationId = '60006942979';
    
    console.log('Updating Zoho Organization ID...');
    
    const { data, error } = await supabase
        .from('tenants')
        .update({ 
            zoho_organization_id: organizationId 
        })
        .eq('id', tenantId)
        .select();
    
    if (error) {
        console.error('Error:', error);
        process.exit(1);
    }
    
    console.log('✅ Organization ID updated successfully');
    console.log('Tenant:', data[0].business_name);
    console.log('Zoho Org ID:', data[0].zoho_organization_id);
    console.log('\nNext steps:');
    console.log('1. Get Client ID from https://api-console.zoho.com/');
    console.log('2. Get Client Secret from the same page');
    console.log('3. Generate Refresh Token using the Client ID & Secret');
    console.log('4. Add all 3 to Settings in dashboard');
    
    process.exit(0);
}

updateZohoOrgId();
