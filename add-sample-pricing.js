/**
 * Add Sample Pricing Data
 * Creates realistic pricing tiers, volume discounts, and promotions
 */

const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

const dbPath = path.join(__dirname, 'local-database.db');
const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

// Get the first tenant
const tenant = db.prepare('SELECT id FROM tenants LIMIT 1').get();
if (!tenant) {
  console.log('❌ No tenant found. Please set up a tenant first.');
  process.exit(1);
}
const tenantId = tenant.id;

console.log(`📊 Adding Sample Pricing Data for tenant: ${tenantId}\n`);

try {
  // Get some product IDs
  const products = db.prepare('SELECT id, name, category FROM products LIMIT 10').all();
  
  if (products.length === 0) {
    console.log('❌ No products found. Please add products first.');
    process.exit(1);
  }

  // 1. Create Default Price List
  console.log('1️⃣  Creating default price list...');
  const priceListId = crypto.randomBytes(16).toString('hex');
  db.prepare(`
    INSERT INTO price_lists (id, tenant_id, name, description, currency, is_default, is_active)
    VALUES (?, ?, ?, ?, ?, 1, 1)
  `).run(priceListId, tenantId, 'Standard Price List 2026', 'Default pricing for all products', 'INR');
  console.log('   ✅ Created: Standard Price List 2026\n');

  // 2. Set Base Prices for Products
  console.log('2️⃣  Setting base prices for products...');
  products.forEach(product => {
    const basePrice = Math.random() * 5000 + 500; // Random price 500-5500
    const costPrice = basePrice * 0.6; // 40% margin
    const minPrice = costPrice * 1.1; // 10% above cost
    
    db.prepare(`
      INSERT INTO product_prices (id, price_list_id, product_id, base_price, cost_price, min_price)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(crypto.randomBytes(16).toString('hex'), priceListId, product.id, 
      basePrice.toFixed(2), costPrice.toFixed(2), minPrice.toFixed(2));
    
    console.log(`   ✅ ${product.name}: ₹${basePrice.toFixed(2)}`);
  });
  console.log('');

  // 3. Create Pricing Tiers
  console.log('3️⃣  Creating pricing tiers...');
  const tiers = [
    { code: 'RETAIL', name: 'Retail', discount: 0, desc: 'Standard retail pricing' },
    { code: 'WHOLESALE', name: 'Wholesale', discount: 15, desc: 'Wholesale buyers (15% off)' },
    { code: 'DISTRIBUTOR', name: 'Distributor', discount: 25, desc: 'Authorized distributors (25% off)' },
    { code: 'VIP', name: 'VIP Account', discount: 30, desc: 'Premium VIP customers (30% off)' }
  ];

  tiers.forEach(tier => {
    db.prepare(`
      INSERT INTO pricing_tiers (id, tenant_id, tier_code, tier_name, description, discount_percentage)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(crypto.randomBytes(16).toString('hex'), tenantId, tier.code, tier.name, tier.desc, tier.discount);
    console.log(`   ✅ ${tier.name}: ${tier.discount}% discount`);
  });
  console.log('');

  // 4. Create Volume Discounts
  console.log('4️⃣  Creating volume discounts...');
  const volumeRules = [
    { name: 'Bulk Order (10-49 units)', min: 10, max: 49, discount: 5, type: 'percentage' },
    { name: 'Large Order (50-99 units)', min: 50, max: 99, discount: 10, type: 'percentage' },
    { name: 'Wholesale Order (100+ units)', min: 100, max: null, discount: 15, type: 'percentage' }
  ];

  volumeRules.forEach((rule, idx) => {
    db.prepare(`
      INSERT INTO volume_discounts (id, tenant_id, name, product_id, min_quantity, max_quantity, discount_type, discount_value, priority)
      VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?)
    `).run(crypto.randomBytes(16).toString('hex'), tenantId, rule.name, rule.min, rule.max, rule.type, rule.discount, idx);
    console.log(`   ✅ ${rule.name}: ${rule.discount}% off`);
  });
  console.log('');

  // 5. Create Promotions
  console.log('5️⃣  Creating promotional campaigns...');
  const now = new Date();
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  
  const promotions = [
    { 
      code: 'NEWCUST2026', 
      name: 'New Customer Welcome',
      desc: 'First time buyer discount',
      type: 'percentage',
      value: 10,
      minOrder: 1000,
      maxDiscount: 500
    },
    {
      code: 'YEAR2026',
      name: '2026 New Year Sale',
      desc: 'Celebrate 2026 with great savings',
      type: 'percentage',
      value: 20,
      minOrder: 2000,
      maxDiscount: 2000
    }
  ];

  promotions.forEach(promo => {
    db.prepare(`
      INSERT INTO promotions (id, tenant_id, code, name, description, discount_type, discount_value, 
        min_order_value, max_discount_amount, start_date, end_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomBytes(16).toString('hex'), tenantId, promo.code, promo.name, promo.desc,
      promo.type, promo.value, promo.minOrder, promo.maxDiscount,
      now.toISOString(), endOfMonth.toISOString()
    );
    console.log(`   ✅ ${promo.code}: ${promo.value}% off (valid until ${endOfMonth.toLocaleDateString()})`);
  });
  console.log('');

  // 6. Create Geo-based Pricing
  console.log('6️⃣  Creating geo-region pricing...');
  const regions = [
    { name: 'Mumbai Metro', state: 'Maharashtra', city: 'Mumbai', adjustment: 5, shipping: 100, tax: 18 },
    { name: 'Delhi NCR', state: 'Delhi', city: 'Delhi', adjustment: 3, shipping: 120, tax: 18 },
    { name: 'Bangalore Tech Hub', state: 'Karnataka', city: 'Bangalore', adjustment: 4, shipping: 150, tax: 18 }
  ];

  regions.forEach(region => {
    db.prepare(`
      INSERT INTO geo_pricing (id, tenant_id, region_name, state, city, price_adjustment_type, 
        price_adjustment, shipping_charges, tax_rate)
      VALUES (?, ?, ?, ?, ?, 'percentage', ?, ?, ?)
    `).run(crypto.randomBytes(16).toString('hex'), tenantId, region.name, region.state, region.city,
      region.adjustment, region.shipping, region.tax);
    console.log(`   ✅ ${region.name}: +${region.adjustment}% regional adjustment`);
  });
  console.log('');

  console.log('✅ Sample pricing data added successfully!\n');
  
  // Summary
  console.log('📋 Summary:');
  console.log(`   • ${products.length} products with base prices`);
  console.log(`   • ${tiers.length} pricing tiers`);
  console.log(`   • ${volumeRules.length} volume discount rules`);
  console.log(`   • ${promotions.length} active promotions`);
  console.log(`   • ${regions.length} geo-pricing regions`);

  db.close();
  
} catch (error) {
  console.error('❌ Error:', error);
  process.exit(1);
}
