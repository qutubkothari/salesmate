// services/salesTeamManagement.js
const updateSalesTeam = async (tenantId, salesNumbers) => {
    const [primary, secondary, ...additional] = salesNumbers;
    
    await dbClient
        .from('tenants')
        .update({
            sales_phone_primary: primary || null,
            sales_phone_secondary: secondary || null,
            sales_team_phones: additional.length > 0 ? additional : null
        })
        .eq('id', tenantId);
};

// Usage: updateSalesTeam(tenantId, ['+919876543210', '+919876543211', '+919876543212']);

