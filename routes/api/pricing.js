/**
 * Pricing Management API
 * Endpoints for managing pricing tiers, rules, promotions, and calculations
 */

const express = require('express');
const router = express.Router();
const { db } = require('../../services/config');
const PricingEngine = require('../../services/pricing-engine');

// Calculate price for a product
router.post('/calculate', (req, res) => {
  try {
    const { tenantId, productId, quantity, customerId, tierCode, promoCode, region } = req.body;

    if (!tenantId || !productId) {
      return res.status(400).json({ error: 'tenantId and productId are required' });
    }

    const result = PricingEngine.calculatePrice({
      tenantId,
      productId,
      quantity: quantity || 1,
      customerId,
      tierCode,
      promoCode,
      region
    });

    res.json(result);
  } catch (error) {
    console.error('Price calculation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Calculate pricing for entire cart
router.post('/calculate-cart', (req, res) => {
  try {
    const { tenantId, items, customerId, tierCode, promoCode, region } = req.body;

    if (!tenantId || !items || !Array.isArray(items)) {
      return res.status(400).json({ error: 'tenantId and items array are required' });
    }

    const result = PricingEngine.calculateCartPricing(tenantId, items, customerId, tierCode, promoCode, region);
    res.json(result);
  } catch (error) {
    console.error('Cart pricing error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ===== PRICING TIERS =====

// Get all pricing tiers
router.get('/tiers/:tenantId', (req, res) => {
  try {
    const { tenantId } = req.params;
    const tiers = db.prepare(`
      SELECT * FROM pricing_tiers 
      WHERE tenant_id = ? 
      ORDER BY tier_name
    `).all(tenantId);

    res.json({ tiers });
  } catch (error) {
    console.error('Get tiers error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create pricing tier
router.post('/tiers', (req, res) => {
  try {
    const { tenantId, tierCode, tierName, description, discountPercentage } = req.body;
    const id = require('crypto').randomBytes(16).toString('hex');

    db.prepare(`
      INSERT INTO pricing_tiers (id, tenant_id, tier_code, tier_name, description, discount_percentage)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, tenantId, tierCode, tierName, description, discountPercentage || 0);

    res.json({ success: true, id });
  } catch (error) {
    console.error('Create tier error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update pricing tier
router.put('/tiers/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { tierName, description, discountPercentage, isActive } = req.body;

    const updates = [];
    const values = [];

    if (tierName !== undefined) { updates.push('tier_name = ?'); values.push(tierName); }
    if (description !== undefined) { updates.push('description = ?'); values.push(description); }
    if (discountPercentage !== undefined) { updates.push('discount_percentage = ?'); values.push(discountPercentage); }
    if (isActive !== undefined) { updates.push('is_active = ?'); values.push(isActive ? 1 : 0); }
    updates.push('updated_at = ?');
    values.push(new Date().toISOString());

    values.push(id);

    db.prepare(`
      UPDATE pricing_tiers 
      SET ${updates.join(', ')}
      WHERE id = ?
    `).run(...values);

    res.json({ success: true });
  } catch (error) {
    console.error('Update tier error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ===== VOLUME DISCOUNTS =====

// Get volume discounts
router.get('/volume-discounts/:tenantId', (req, res) => {
  try {
    const { tenantId } = req.params;
    const discounts = db.prepare(`
      SELECT vd.*, p.name as product_name
      FROM volume_discounts vd
      LEFT JOIN products p ON vd.product_id = p.id
      WHERE vd.tenant_id = ?
      ORDER BY vd.priority DESC, vd.min_quantity ASC
    `).all(tenantId);

    res.json({ discounts });
  } catch (error) {
    console.error('Get volume discounts error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create volume discount
router.post('/volume-discounts', (req, res) => {
  try {
    const { tenantId, name, productId, category, minQuantity, maxQuantity, discountType, discountValue, priority } = req.body;
    const id = require('crypto').randomBytes(16).toString('hex');

    db.prepare(`
      INSERT INTO volume_discounts (id, tenant_id, name, product_id, category, min_quantity, max_quantity, 
        discount_type, discount_value, priority)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, tenantId, name, productId || null, category || null, minQuantity, maxQuantity || null, 
      discountType || 'percentage', discountValue, priority || 0);

    res.json({ success: true, id });
  } catch (error) {
    console.error('Create volume discount error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ===== ACCOUNT-SPECIFIC PRICING =====

// Get account pricing for customer
router.get('/account-pricing/:tenantId/:customerId', (req, res) => {
  try {
    const { tenantId, customerId } = req.params;
    const pricing = db.prepare(`
      SELECT ap.*, p.name as product_name, p.sku
      FROM account_pricing ap
      JOIN products p ON ap.product_id = p.id
      WHERE ap.tenant_id = ? AND ap.customer_id = ?
      ORDER BY ap.created_at DESC
    `).all(tenantId, customerId);

    res.json({ pricing });
  } catch (error) {
    console.error('Get account pricing error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Set account-specific price
router.post('/account-pricing', (req, res) => {
  try {
    const { tenantId, customerId, productId, customPrice, effectiveFrom, effectiveTo, contractReference, approvedBy, notes } = req.body;

    const result = PricingEngine.setAccountPrice(
      tenantId, customerId, productId, customPrice, 
      effectiveFrom, effectiveTo, contractReference, approvedBy, notes
    );

    res.json(result);
  } catch (error) {
    console.error('Set account pricing error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ===== PROMOTIONS =====

// Get promotions
router.get('/promotions/:tenantId', (req, res) => {
  try {
    const { tenantId } = req.params;
    const { active } = req.query;
    
    let query = 'SELECT * FROM promotions WHERE tenant_id = ?';
    const params = [tenantId];

    if (active === 'true') {
      query += ' AND is_active = 1 AND start_date <= ? AND end_date >= ?';
      const now = new Date().toISOString();
      params.push(now, now);
    }

    query += ' ORDER BY created_at DESC';

    const promotions = db.prepare(query).all(...params);
    res.json({ promotions });
  } catch (error) {
    console.error('Get promotions error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create promotion
router.post('/promotions', (req, res) => {
  try {
    const { 
      tenantId, code, name, description, discountType, discountValue,
      minOrderValue, maxDiscountAmount, applicableProducts, applicableCategories,
      applicableTiers, startDate, endDate, usageLimit
    } = req.body;

    const id = require('crypto').randomBytes(16).toString('hex');

    db.prepare(`
      INSERT INTO promotions (
        id, tenant_id, code, name, description, discount_type, discount_value,
        min_order_value, max_discount_amount, applicable_products, applicable_categories,
        applicable_tiers, start_date, end_date, usage_limit
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, tenantId, code, name, description, discountType, discountValue,
      minOrderValue || null, maxDiscountAmount || null,
      applicableProducts ? JSON.stringify(applicableProducts) : null,
      applicableCategories ? JSON.stringify(applicableCategories) : null,
      applicableTiers ? JSON.stringify(applicableTiers) : null,
      startDate, endDate, usageLimit || null
    );

    res.json({ success: true, id });
  } catch (error) {
    console.error('Create promotion error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Validate promo code
router.post('/promotions/validate', (req, res) => {
  try {
    const { tenantId, code, productId } = req.body;
    const promo = PricingEngine.getPromotion(tenantId, code, productId);

    if (promo) {
      res.json({ valid: true, promotion: promo });
    } else {
      res.json({ valid: false, message: 'Promotion code is invalid or expired' });
    }
  } catch (error) {
    console.error('Validate promo error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ===== PRICE LISTS =====

// Get price lists
router.get('/price-lists/:tenantId', (req, res) => {
  try {
    const { tenantId } = req.params;
    const priceLists = db.prepare(`
      SELECT * FROM price_lists 
      WHERE tenant_id = ?
      ORDER BY is_default DESC, created_at DESC
    `).all(tenantId);

    res.json({ priceLists });
  } catch (error) {
    console.error('Get price lists error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create price list
router.post('/price-lists', (req, res) => {
  try {
    const { tenantId, name, description, currency, effectiveFrom, effectiveTo, isDefault } = req.body;
    const id = require('crypto').randomBytes(16).toString('hex');

    // If setting as default, unset other defaults
    if (isDefault) {
      db.prepare('UPDATE price_lists SET is_default = 0 WHERE tenant_id = ?').run(tenantId);
    }

    db.prepare(`
      INSERT INTO price_lists (id, tenant_id, name, description, currency, effective_from, effective_to, is_default)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, tenantId, name, description, currency || 'INR', effectiveFrom || null, effectiveTo || null, isDefault ? 1 : 0);

    res.json({ success: true, id });
  } catch (error) {
    console.error('Create price list error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Set product price in price list
router.post('/product-prices', (req, res) => {
  try {
    const { priceListId, productId, basePrice, costPrice, minPrice, maxPrice } = req.body;
    const id = require('crypto').randomBytes(16).toString('hex');

    // Check if already exists
    const existing = db.prepare(`
      SELECT id FROM product_prices WHERE price_list_id = ? AND product_id = ?
    `).get(priceListId, productId);

    if (existing) {
      // Update
      db.prepare(`
        UPDATE product_prices 
        SET base_price = ?, cost_price = ?, min_price = ?, max_price = ?, updated_at = ?
        WHERE id = ?
      `).run(basePrice, costPrice || null, minPrice || null, maxPrice || null, new Date().toISOString(), existing.id);

      res.json({ success: true, id: existing.id, action: 'updated' });
    } else {
      // Insert
      db.prepare(`
        INSERT INTO product_prices (id, price_list_id, product_id, base_price, cost_price, min_price, max_price)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, priceListId, productId, basePrice, costPrice || null, minPrice || null, maxPrice || null);

      res.json({ success: true, id, action: 'created' });
    }
  } catch (error) {
    console.error('Set product price error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get price history for product
router.get('/price-history/:tenantId/:productId', (req, res) => {
  try {
    const { tenantId, productId } = req.params;
    const history = db.prepare(`
      SELECT * FROM price_history
      WHERE tenant_id = ? AND product_id = ?
      ORDER BY changed_at DESC
      LIMIT 50
    `).all(tenantId, productId);

    res.json({ history });
  } catch (error) {
    console.error('Get price history error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
