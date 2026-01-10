// scripts/checkProductCategories.js
require('dotenv').config();
const { dbClient } = require('../services/config');

const TENANT_ID = 'a10aa26a-b5f9-4afe-87cc-70bfb4d1f6e6';

async function checkProducts() {
    console.log('[Product Check] Checking NFF products...\n');
    
    // Get NFF products
    const { data: products, error } = await dbClient
        .from('products')
        .select('id, name, sku, category, category_id, price')
        .eq('tenant_id', TENANT_ID)
        .ilike('name', '%NFF%')
        .limit(10);
    
    if (error) {
        console.error('[Product Check] Error:', error.message);
        return;
    }
    
    console.log('[Product Check] Found', products?.length || 0, 'NFF products:');
    products.forEach(p => {
        console.log(`- ${p.name} (${p.sku})`);
        console.log(`  Category: ${p.category}`);
        console.log(`  Category ID: ${p.category_id}`);
        console.log(`  Price: â‚¹${p.price}\n`);
    });
    
    // Get category details
    if (products && products.length > 0 && products[0].category_id) {
        const { data: category, error: catError } = await dbClient
            .from('categories')
            .select('*')
            .eq('id', products[0].category_id)
            .single();
        
        if (!catError) {
            console.log('[Category Details]:', JSON.stringify(category, null, 2));
        }
    }
    
    // Check discount rule's category
    console.log('\n[Discount Rule Category]:');
    const { data: ruleCategory } = await dbClient
        .from('categories')
        .select('*')
        .eq('id', '5714eefa-ddf0-4f82-9358-a9701eb90c63')
        .single();
    
    if (ruleCategory) {
        console.log(JSON.stringify(ruleCategory, null, 2));
    }
}

checkProducts().catch(console.error);

