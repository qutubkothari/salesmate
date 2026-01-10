const { dbClient } = require('./services/config');

async function createTenant() {
    const tenantData = {
        id: '45bebb5d-cbab-4338-a3eb-a5b0c4aeea4e',
        business_name: 'SAK Solutions',
        phone_number: '971507055253',
        owner_whatsapp_number: '919537653927',
        plan: 'premium'
    };
    
    console.log('Creating tenant:', tenantData);
    
    const { data, error } = await dbClient
        .from('tenants')
        .insert(tenantData)
        .select();
    
    if (error) {
        console.error('Error creating tenant:', error);
        process.exit(1);
    }
    
    console.log('âœ… Tenant created successfully:', data);
    process.exit(0);
}

createTenant();

