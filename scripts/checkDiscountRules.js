// scripts/checkDiscountRules.js
require('dotenv').config();
const { dbClient } = require('../services/config');

const TENANT_ID = 'a10aa26a-b5f9-4afe-87cc-70bfb4d1f6e6';

async function checkRules() {
    console.log('[Discount Rules] Checking rules for tenant:', TENANT_ID);
    
    // Get all discount rules
    const { data: rules, error } = await dbClient
        .from('discount_rules')
        .select('*')
        .eq('tenant_id', TENANT_ID)
        .eq('is_active', true)
        .order('discount_value', { ascending: false });
    
    if (error) {
        console.error('[Discount Rules] Error:', error.message);
        return;
    }
    
    console.log('[Discount Rules] Found', rules?.length || 0, 'active rules:');
    console.log(JSON.stringify(rules, null, 2));
    
    // Test with current cart scenario (20 cartons, NFF products)
    console.log('\n[Test Scenario] 20 cartons of NFF products (category: Disposable Gloves):');
    
    const testOrder = {
        items: [
            { product_id: 'some-id', category: 'Disposable Gloves', quantity: 20, price: 2505 }
        ],
        totalAmount: 50100,
        quantity: 20
    };
    
    const applicableRules = rules.filter(rule => {
        // Check conditions
        let matches = true;
        
        // Min quantity
        if (rule.min_quantity && testOrder.quantity < rule.min_quantity) {
            matches = false;
        }
        
        // Min amount
        if (rule.min_order_value && testOrder.totalAmount < rule.min_order_value) {
            matches = false;
        }
        
        // Product-specific
        if (rule.product_id) {
            matches = testOrder.items.some(item => item.product_id === rule.product_id);
        }
        
        // Category-specific
        if (rule.category) {
            matches = testOrder.items.some(item => item.category === rule.category);
        }
        
        return matches;
    });
    
    console.log('\n[Applicable Rules]:', applicableRules.length);
    applicableRules.forEach(rule => {
        console.log(`- ${rule.rule_name}: ${rule.discount_value}% (Type: ${rule.rule_type}, Category: ${rule.category || 'All'})`);
    });
    
    if (applicableRules.length > 0) {
        const maxDiscount = Math.max(...applicableRules.map(r => r.discount_value));
        console.log('\n[Max Discount]:', maxDiscount, '%');
    }
}

checkRules().catch(console.error);

