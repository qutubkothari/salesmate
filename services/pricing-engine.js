/**
 * Advanced Pricing Engine
 * Calculates prices based on: tiered pricing, volume discounts, account-specific contracts,
 * promotions, geo-based adjustments, and seasonal campaigns
 */

const { db } = require('./config');

class PricingEngine {
  /**
   * Calculate final price for a product
   * @param {Object} params - Pricing parameters
   * @param {string} params.tenantId - Tenant ID
   * @param {string} params.productId - Product ID
   * @param {number} params.quantity - Quantity being purchased
   * @param {string} params.customerId - Customer ID (optional)
   * @param {string} params.tierCode - Pricing tier (optional)
   * @param {string} params.promoCode - Promotion code (optional)
   * @param {string} params.region - Region/location (optional)
   * @returns {Object} Final pricing breakdown
   */
  static calculatePrice(params) {
    const { tenantId, productId, quantity = 1, customerId, tierCode, promoCode, region } = params;

    try {
      // Step 1: Get base price from default price list
      const basePrice = this.getBasePrice(tenantId, productId);
      
      if (!basePrice) {
        throw new Error('Product price not found');
      }

      let finalPrice = basePrice;
      const breakdown = {
        basePrice,
        quantity,
        adjustments: []
      };

      // Step 2: Check account-specific pricing (highest priority)
      if (customerId) {
        const accountPrice = this.getAccountPrice(tenantId, customerId, productId);
        if (accountPrice) {
          finalPrice = accountPrice.custom_price;
          breakdown.adjustments.push({
            type: 'account_pricing',
            description: `Contract pricing for account`,
            oldPrice: basePrice,
            newPrice: finalPrice,
            discount: basePrice - finalPrice
          });
        }
      }

      // Step 3: Apply tier discount
      if (tierCode && !breakdown.adjustments.find(a => a.type === 'account_pricing')) {
        const tierDiscount = this.getTierDiscount(tenantId, tierCode);
        if (tierDiscount) {
          const discountAmount = finalPrice * (tierDiscount.discount_percentage / 100);
          breakdown.adjustments.push({
            type: 'tier_discount',
            description: `${tierDiscount.tier_name} discount`,
            percentage: tierDiscount.discount_percentage,
            discount: discountAmount
          });
          finalPrice -= discountAmount;
        }
      }

      // Step 4: Apply volume discounts
      const volumeDiscount = this.getVolumeDiscount(tenantId, productId, quantity);
      if (volumeDiscount) {
        let discountAmount = 0;
        if (volumeDiscount.discount_type === 'percentage') {
          discountAmount = finalPrice * (volumeDiscount.discount_value / 100);
        } else {
          discountAmount = volumeDiscount.discount_value;
        }
        breakdown.adjustments.push({
          type: 'volume_discount',
          description: `Volume discount (${quantity} units)`,
          discount: discountAmount
        });
        finalPrice -= discountAmount;
      }

      // Step 5: Apply promotional code
      if (promoCode) {
        const promo = this.getPromotion(tenantId, promoCode, productId);
        if (promo) {
          let promoDiscount = 0;
          if (promo.discount_type === 'percentage') {
            promoDiscount = finalPrice * (promo.discount_value / 100);
            if (promo.max_discount_amount) {
              promoDiscount = Math.min(promoDiscount, promo.max_discount_amount);
            }
          } else {
            promoDiscount = promo.discount_value;
          }
          breakdown.adjustments.push({
            type: 'promotion',
            description: `Promo: ${promo.name}`,
            code: promo.code,
            discount: promoDiscount
          });
          finalPrice -= promoDiscount;
        }
      }

      // Step 6: Apply geo-region adjustments
      if (region) {
        const geoAdjustment = this.getGeoAdjustment(tenantId, region);
        if (geoAdjustment) {
          let adjustment = 0;
          if (geoAdjustment.price_adjustment_type === 'percentage') {
            adjustment = finalPrice * (geoAdjustment.price_adjustment / 100);
          } else {
            adjustment = geoAdjustment.price_adjustment;
          }
          breakdown.adjustments.push({
            type: 'geo_adjustment',
            description: `Region: ${geoAdjustment.region_name}`,
            adjustment
          });
          finalPrice += adjustment;
        }
      }

      // Step 7: Ensure price doesn't go below minimum
      const productInfo = db.prepare(`
        SELECT pp.min_price, pp.max_price 
        FROM product_prices pp
        JOIN price_lists pl ON pp.price_list_id = pl.id
        WHERE pp.product_id = ? AND pl.tenant_id = ? AND pl.is_default = 1
      `).get(productId, tenantId);

      if (productInfo?.min_price && finalPrice < productInfo.min_price) {
        breakdown.adjustments.push({
          type: 'floor_price',
          description: 'Minimum price enforced',
          adjustment: productInfo.min_price - finalPrice
        });
        finalPrice = productInfo.min_price;
      }

      if (productInfo?.max_price && finalPrice > productInfo.max_price) {
        breakdown.adjustments.push({
          type: 'ceiling_price',
          description: 'Maximum price enforced',
          adjustment: productInfo.max_price - finalPrice
        });
        finalPrice = productInfo.max_price;
      }

      // Calculate totals
      breakdown.unitPrice = finalPrice;
      breakdown.subtotal = finalPrice * quantity;
      breakdown.totalDiscount = breakdown.adjustments
        .filter(a => a.discount)
        .reduce((sum, a) => sum + a.discount, 0);
      breakdown.totalSavings = (basePrice - finalPrice) * quantity;

      return {
        success: true,
        pricing: breakdown
      };

    } catch (error) {
      console.error('Pricing calculation error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get base price from default price list
   */
  static getBasePrice(tenantId, productId) {
    const result = db.prepare(`
      SELECT pp.base_price
      FROM product_prices pp
      JOIN price_lists pl ON pp.price_list_id = pl.id
      WHERE pp.product_id = ? 
        AND pl.tenant_id = ? 
        AND pl.is_default = 1 
        AND pl.is_active = 1
    `).get(productId, tenantId);

    return result?.base_price || null;
  }

  /**
   * Get account-specific pricing
   */
  static getAccountPrice(tenantId, customerId, productId) {
    const now = new Date().toISOString();
    return db.prepare(`
      SELECT custom_price, contract_reference
      FROM account_pricing
      WHERE tenant_id = ? 
        AND customer_id = ? 
        AND product_id = ?
        AND is_active = 1
        AND (effective_from IS NULL OR effective_from <= ?)
        AND (effective_to IS NULL OR effective_to >= ?)
      ORDER BY created_at DESC
      LIMIT 1
    `).get(tenantId, customerId, productId, now, now);
  }

  /**
   * Get tier discount
   */
  static getTierDiscount(tenantId, tierCode) {
    return db.prepare(`
      SELECT tier_name, discount_percentage
      FROM pricing_tiers
      WHERE tenant_id = ? 
        AND tier_code = ? 
        AND is_active = 1
    `).get(tenantId, tierCode);
  }

  /**
   * Get volume discount for quantity
   */
  static getVolumeDiscount(tenantId, productId, quantity) {
    // Try product-specific discount first
    let discount = db.prepare(`
      SELECT name, discount_type, discount_value
      FROM volume_discounts
      WHERE tenant_id = ? 
        AND product_id = ?
        AND min_quantity <= ?
        AND (max_quantity IS NULL OR max_quantity >= ?)
        AND is_active = 1
      ORDER BY priority DESC, min_quantity DESC
      LIMIT 1
    `).get(tenantId, productId, quantity, quantity);

    // If no product-specific, try category-level
    if (!discount) {
      const product = db.prepare('SELECT category FROM products WHERE id = ?').get(productId);
      if (product?.category) {
        discount = db.prepare(`
          SELECT name, discount_type, discount_value
          FROM volume_discounts
          WHERE tenant_id = ? 
            AND category = ?
            AND product_id IS NULL
            AND min_quantity <= ?
            AND (max_quantity IS NULL OR max_quantity >= ?)
            AND is_active = 1
          ORDER BY priority DESC, min_quantity DESC
          LIMIT 1
        `).get(tenantId, product.category, quantity, quantity);
      }
    }

    return discount;
  }

  /**
   * Get active promotion
   */
  static getPromotion(tenantId, promoCode, productId) {
    const now = new Date().toISOString();
    const promo = db.prepare(`
      SELECT *
      FROM promotions
      WHERE tenant_id = ?
        AND code = ?
        AND start_date <= ?
        AND end_date >= ?
        AND is_active = 1
        AND (usage_limit IS NULL OR usage_count < usage_limit)
    `).get(tenantId, promoCode, now, now);

    if (!promo) return null;

    // Check if product is applicable
    if (promo.applicable_products) {
      const products = JSON.parse(promo.applicable_products);
      if (!products.includes(productId)) return null;
    }

    return promo;
  }

  /**
   * Get geo-region pricing adjustment
   */
  static getGeoAdjustment(tenantId, region) {
    // region can be: "Maharashtra", "Mumbai", "400001"
    return db.prepare(`
      SELECT region_name, price_adjustment_type, price_adjustment, shipping_charges, tax_rate
      FROM geo_pricing
      WHERE tenant_id = ?
        AND (state = ? OR city = ? OR pincode = ?)
        AND is_active = 1
      ORDER BY pincode DESC, city DESC, state DESC
      LIMIT 1
    `).get(tenantId, region, region, region);
  }

  /**
   * Bulk calculate prices for cart/order
   */
  static calculateCartPricing(tenantId, items, customerId, tierCode, promoCode, region) {
    const results = items.map(item => {
      const pricing = this.calculatePrice({
        tenantId,
        productId: item.product_id,
        quantity: item.quantity,
        customerId,
        tierCode,
        promoCode,
        region
      });

      return {
        product_id: item.product_id,
        quantity: item.quantity,
        ...pricing
      };
    });

    const cartTotal = results.reduce((sum, item) => sum + (item.pricing?.subtotal || 0), 0);
    const totalSavings = results.reduce((sum, item) => sum + (item.pricing?.totalSavings || 0), 0);

    return {
      items: results,
      summary: {
        subtotal: cartTotal,
        totalSavings,
        itemCount: items.length,
        totalUnits: items.reduce((sum, item) => sum + item.quantity, 0)
      }
    };
  }

  /**
   * Create or update account-specific pricing
   */
  static setAccountPrice(tenantId, customerId, productId, customPrice, effectiveFrom, effectiveTo, contractRef, approvedBy, notes) {
    const id = require('crypto').randomBytes(16).toString('hex');
    
    const stmt = db.prepare(`
      INSERT INTO account_pricing (id, tenant_id, customer_id, product_id, custom_price, 
        effective_from, effective_to, contract_reference, approved_by, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(id, tenantId, customerId, productId, customPrice, 
      effectiveFrom, effectiveTo, contractRef, approvedBy, notes);

    return { success: true, id };
  }

  /**
   * Log price change for audit
   */
  static logPriceChange(tenantId, productId, oldPrice, newPrice, changedBy, reason) {
    const id = require('crypto').randomBytes(16).toString('hex');
    
    db.prepare(`
      INSERT INTO price_history (id, tenant_id, product_id, old_price, new_price, changed_by, reason)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, tenantId, productId, oldPrice, newPrice, changedBy, reason);
  }
}

module.exports = PricingEngine;
