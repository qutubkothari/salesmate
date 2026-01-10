// scripts/syncZohoProducts.js
require('dotenv').config();
const zoho = require('../services/zohoIntegrationService');
const { dbClient } = require('../services/config');

const TENANT_ID = process.env.TENANT_ID || 'a10aa26a-b5f9-4afe-87cc-70bfb4d1f6e6';

async function syncProductsFromZoho() {
    console.log('[Product Sync] Starting Zoho product sync...\n');
    try {
        console.log('[Product Sync] Fetching items from Zoho Books...');
        
        // âœ… FIXED: Pass tenant ID to getItems
        const result = await zoho.getItems(TENANT_ID);
        
        if (!result.success) {
            throw new Error(`Failed to fetch items: ${result.error}`);
        }
        
        const items = result.data.items || [];
        console.log(`[Product Sync] Found ${items.length} items in Zoho Books\n`);
        
        let syncedCount = 0;
        let errorCount = 0;
        
        for (const item of items) {
            try {
                console.log(`[Product Sync] Syncing: ${item.name} (${item.sku || 'No SKU'})`);
                
                const productData = {
                    tenant_id: TENANT_ID,
                    zoho_item_id: item.item_id,
                    sku: item.sku || null,
                    name: item.name,
                    description: item.description || null,
                    price: parseFloat(item.rate) || 0,
                    hsn_code: item.hsn_or_sac || null,
                    stock_on_hand: parseInt(item.stock_on_hand) || 0,
                    unit: item.unit || 'pcs',
                    is_taxable: item.is_taxable !== false,
                    product_type: item.product_type || 'goods',
                    status: item.status === 'active' ? 'active' : 'inactive',
                    is_active: item.status === 'active',
                    updated_at: new Date().toISOString()
                };
                
                const { error } = await dbClient
                    .from('products')
                    .upsert(productData, { 
                        onConflict: 'zoho_item_id',
                        ignoreDuplicates: false 
                    });
                
                if (error) {
                    console.error(`  âŒ Error: ${error.message}`);
                    errorCount++;
                } else {
                    console.log(`  âœ… Synced: ${item.name} | Stock: ${item.stock_on_hand} | Price: â‚¹${item.rate}`);
                    syncedCount++;
                }
            } catch (itemError) {
                console.error(`  âŒ Failed to sync ${item.name}:`, itemError.message);
                errorCount++;
            }
        }
        
        console.log('\n' + '='.repeat(60));
        console.log('[Product Sync] Summary:');
        console.log(`  Total items in Zoho: ${items.length}`);
        console.log(`  Successfully synced: ${syncedCount}`);
        console.log(`  Errors: ${errorCount}`);
        
        // Delete products that no longer exist in Zoho
        console.log('[Product Sync] Checking for deleted products...');
        const zohoItemIds = items.map(item => item.item_id);
        let productsToDelete = [];
        
        const { data: existingProducts, error: fetchError } = await dbClient
            .from('products')
            .select('zoho_item_id, name')
            .eq('tenant_id', TENANT_ID)
            .not('zoho_item_id', 'is', null);
        
        if (fetchError) {
            console.error(`  âŒ Error fetching existing products: ${fetchError.message}`);
        } else {
            productsToDelete = existingProducts.filter(p => !zohoItemIds.includes(p.zoho_item_id));
            
            if (productsToDelete.length > 0) {
                console.log(`[Product Sync] Found ${productsToDelete.length} products to delete:`);
                
                for (const product of productsToDelete) {
                    console.log(`  ðŸ—‘ï¸  Deleting: ${product.name} (${product.zoho_item_id})`);
                }
                
                const { error: deleteError } = await dbClient
                    .from('products')
                    .delete()
                    .eq('tenant_id', TENANT_ID)
                    .in('zoho_item_id', productsToDelete.map(p => p.zoho_item_id));
                
                if (deleteError) {
                    console.error(`  âŒ Error deleting products: ${deleteError.message}`);
                } else {
                    console.log(`  âœ… Deleted ${productsToDelete.length} products from database`);
                }
            } else {
                console.log('  âœ… No products to delete');
            }
        }
        
        console.log('='.repeat(60));
        
        return {
            success: true,
            total: items.length,
            synced: syncedCount,
            errors: errorCount,
            deleted: productsToDelete.length
        };
        
    } catch (error) {
        console.error('[Product Sync] Fatal error:', error.message);
        return {
            success: false,
            error: error.message
        };
    }
}

if (require.main === module) {
    syncProductsFromZoho()
        .then(result => {
            console.log('\n[Product Sync] Completed');
            process.exit(result.success ? 0 : 1);
        })
        .catch(error => {
            console.error('[Product Sync] Unexpected error:', error);
            process.exit(1);
        });
}

module.exports = { syncProductsFromZoho };
