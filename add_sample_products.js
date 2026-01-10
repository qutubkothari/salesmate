const { dbClient } = require('./services/config');

async function addSampleProducts() {
    const tenantId = '45bebb5d-cbab-4338-a3eb-a5b0c4aeea4e';
    
    const products = [
        {
            tenant_id: tenantId,
            name: 'Laptop HP EliteBook',
            description: 'High-performance business laptop with Intel i7 processor, 16GB RAM, 512GB SSD',
            price: 65000,
            stock_quantity: 10,
            category: 'Laptops',
            sku: 'LAP-HP-001',
            is_active: true
        },
        {
            tenant_id: tenantId,
            name: 'iPhone 15 Pro',
            description: 'Latest Apple iPhone with A17 Pro chip, 256GB storage, Titanium design',
            price: 134900,
            stock_quantity: 15,
            category: 'Smartphones',
            sku: 'PHN-APL-001',
            is_active: true
        },
        {
            tenant_id: tenantId,
            name: 'Dell Monitor 27"',
            description: '4K UHD monitor with HDR support, USB-C connectivity',
            price: 28000,
            stock_quantity: 20,
            category: 'Monitors',
            sku: 'MON-DEL-001',
            is_active: true
        },
        {
            tenant_id: tenantId,
            name: 'Logitech MX Master 3',
            description: 'Advanced wireless mouse with ergonomic design and precision scrolling',
            price: 8500,
            stock_quantity: 50,
            category: 'Accessories',
            sku: 'ACC-LOG-001',
            is_active: true
        },
        {
            tenant_id: tenantId,
            name: 'Samsung SSD 1TB',
            description: 'High-speed NVMe SSD with 7000MB/s read speed',
            price: 9500,
            stock_quantity: 30,
            category: 'Storage',
            sku: 'STO-SAM-001',
            is_active: true
        }
    ];
    
    console.log(`Adding ${products.length} sample products...`);
    
    const { data, error } = await dbClient
        .from('products')
        .insert(products)
        .select();
    
    if (error) {
        console.error('Error adding products:', error);
        process.exit(1);
    }
    
    console.log('âœ… Sample products added successfully:');
    data.forEach(p => console.log(`  - ${p.name} (â‚¹${p.price})`));
    process.exit(0);
}

addSampleProducts();

