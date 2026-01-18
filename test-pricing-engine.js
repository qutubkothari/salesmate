/**
 * Test Pricing Engine
 */

const PricingEngine = require('./services/pricing-engine');
const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'local-database.db'));
const tenant = db.prepare('SELECT id FROM tenants LIMIT 1').get();
const product = db.prepare('SELECT id, name FROM products LIMIT 1').get();

console.log('🧪 Testing Pricing Engine\n');
console.log(`Tenant: ${tenant.id}`);
console.log(`Product: ${product.name} (${product.id})\n`);

// Test 1: Base Price
console.log('📌 Test 1: Base Price (no discounts)');
let result = PricingEngine.calculatePrice({
  tenantId: tenant.id,
  productId: product.id,
  quantity: 1
});
console.log(JSON.stringify(result, null, 2));
console.log('');

// Test 2: Volume Discount (50 units)
console.log('📌 Test 2: Volume Discount (50 units → 10% off)');
result = PricingEngine.calculatePrice({
  tenantId: tenant.id,
  productId: product.id,
  quantity: 50
});
console.log(`Unit Price: ₹${result.pricing.unitPrice.toFixed(2)}`);
console.log(`Subtotal: ₹${result.pricing.subtotal.toFixed(2)}`);
console.log(`Total Savings: ₹${result.pricing.totalSavings.toFixed(2)}`);
console.log('Adjustments:', result.pricing.adjustments);
console.log('');

// Test 3: Tier Pricing (Wholesale)
console.log('📌 Test 3: Tier Pricing (WHOLESALE → 15% off)');
result = PricingEngine.calculatePrice({
  tenantId: tenant.id,
  productId: product.id,
  quantity: 5,
  tierCode: 'WHOLESALE'
});
console.log(`Unit Price: ₹${result.pricing.unitPrice.toFixed(2)}`);
console.log(`Subtotal: ₹${result.pricing.subtotal.toFixed(2)}`);
console.log(`Total Savings: ₹${result.pricing.totalSavings.toFixed(2)}`);
console.log('Adjustments:', result.pricing.adjustments);
console.log('');

// Test 4: Promo Code
console.log('📌 Test 4: Promo Code (NEWCUST2026 → 10% off)');
result = PricingEngine.calculatePrice({
  tenantId: tenant.id,
  productId: product.id,
  quantity: 3,
  promoCode: 'NEWCUST2026'
});
console.log(`Unit Price: ₹${result.pricing.unitPrice.toFixed(2)}`);
console.log(`Subtotal: ₹${result.pricing.subtotal.toFixed(2)}`);
console.log(`Total Savings: ₹${result.pricing.totalSavings.toFixed(2)}`);
console.log('Adjustments:', result.pricing.adjustments);
console.log('');

// Test 5: Combo (Volume + Tier + Promo + Geo)
console.log('📌 Test 5: COMBO (100 units + VIP + YEAR2026 + Mumbai)');
result = PricingEngine.calculatePrice({
  tenantId: tenant.id,
  productId: product.id,
  quantity: 100,
  tierCode: 'VIP',
  promoCode: 'YEAR2026',
  region: 'Mumbai'
});
console.log(`Unit Price: ₹${result.pricing.unitPrice.toFixed(2)}`);
console.log(`Subtotal: ₹${result.pricing.subtotal.toFixed(2)}`);
console.log(`Total Savings: ₹${result.pricing.totalSavings.toFixed(2)}`);
console.log('Adjustments:');
result.pricing.adjustments.forEach(adj => {
  console.log(`  - ${adj.description}: ${adj.discount ? `-₹${adj.discount.toFixed(2)}` : `+₹${adj.adjustment?.toFixed(2) || 0}`}`);
});

console.log('\n✅ All tests complete!');

db.close();
