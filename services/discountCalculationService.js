/**
 * @title Discount Calculation Service
 * @description Core service for calculating and applying discounts to orders
 * Supports volume, customer, product, category, coupon, time-based, and other discount types
 */

const { dbClient } = require('./config');

class DiscountCalculationService {
    /**
     * Find all applicable discounts for an order
     * @param {string} tenantId - Tenant ID
     * @param {object} orderData - Order details { items, totalAmount, quantity, customerProfile, couponCode }
     * @returns {Promise<Array>} Array of applicable discount rules
     */
    async findApplicableDiscounts(tenantId, orderData) {
        try {
            const { items = [], totalAmount = 0, quantity = 0, customerProfile = null, couponCode = null } = orderData;

            console.log('[DISCOUNT_CALC] Finding discounts for tenant:', tenantId, {
                totalAmount,
                quantity,
                customerTier: customerProfile?.tier,
                couponCode
            });

            // Get all active discount rules for the tenant
            const { data: rules, error } = await dbClient
                .from('discount_rules')
                .select('*')
                .eq('tenant_id', tenantId)
                .eq('is_active', true)
                .order('priority', { ascending: false });

            if (error) throw error;

            if (!rules || rules.length === 0) {
                console.log('[DISCOUNT_CALC] No active discount rules found');
                return [];
            }

            // Filter rules based on applicability
            const applicableRules = [];

            for (const rule of rules) {
                if (await this.isRuleApplicable(rule, orderData)) {
                    applicableRules.push(rule);
                }
            }

            console.log('[DISCOUNT_CALC] Found', applicableRules.length, 'applicable discounts');
            return applicableRules;
        } catch (error) {
            console.error('[DISCOUNT_CALC] Error finding discounts:', error);
            return [];
        }
    }

    /**
     * Check if a discount rule is applicable to an order
     * @param {object} rule - Discount rule
     * @param {object} orderData - Order details
     * @returns {Promise<boolean>}
     */
    async isRuleApplicable(rule, orderData) {
        const { items = [], totalAmount = 0, quantity = 0, customerProfile = null, couponCode = null } = orderData;

        // Check coupon code (if rule requires it)
        if (rule.discount_type === 'coupon') {
            if (!couponCode || rule.coupon_code !== couponCode) {
                return false;
            }
            // Check usage limit
            if (rule.coupon_usage_limit && rule.coupon_used_count >= rule.coupon_usage_limit) {
                console.log('[DISCOUNT_CALC] Coupon usage limit reached:', rule.coupon_code);
                return false;
            }
        }

        // Check minimum order value
        if (rule.min_order_value && totalAmount < rule.min_order_value) {
            return false;
        }

        // Check quantity thresholds
        if (rule.min_quantity && quantity < rule.min_quantity) {
            return false;
        }
        if (rule.max_quantity && quantity > rule.max_quantity) {
            return false;
        }

        // Check customer tier
        if (rule.applicable_customer_tiers && rule.applicable_customer_tiers.length > 0) {
            const customerTier = customerProfile?.tier || 'regular';
            if (!rule.applicable_customer_tiers.includes(customerTier)) {
                return false;
            }
        }

        // Check specific customer IDs
        if (rule.applicable_customer_ids && rule.applicable_customer_ids.length > 0) {
            const customerId = customerProfile?.id;
            if (!customerId || !rule.applicable_customer_ids.includes(customerId)) {
                return false;
            }
        }

        // Check product applicability
        if (rule.applicable_product_ids && rule.applicable_product_ids.length > 0) {
            const hasApplicableProduct = items.some(item => 
                rule.applicable_product_ids.includes(item.product_id || item.id)
            );
            if (!hasApplicableProduct) {
                return false;
            }
        }

        // Check category applicability
        if (rule.applicable_category_ids && rule.applicable_category_ids.length > 0) {
            const hasApplicableCategory = items.some(item => 
                rule.applicable_category_ids.includes(item.category || item.category_id)
            );
            if (!hasApplicableCategory) {
                return false;
            }
        }

        // Check time-based rules
        if (!this.isWithinTimeWindow(rule)) {
            return false;
        }

        // Check first order (if applicable)
        if (rule.discount_type === 'first_order') {
            const isFirstOrder = await this.isCustomerFirstOrder(customerProfile);
            if (!isFirstOrder) {
                return false;
            }
        }

        return true;
    }

    /**
     * Check if current time is within discount validity window
     * @param {object} rule - Discount rule
     * @returns {boolean}
     */
    isWithinTimeWindow(rule) {
        const now = new Date();

        // Check validity dates
        if (rule.valid_from && new Date(rule.valid_from) > now) {
            return false;
        }
        if (rule.valid_to && new Date(rule.valid_to) < now) {
            return false;
        }

        // Check day of week
        if (rule.active_days_of_week && rule.active_days_of_week.length > 0) {
            const currentDay = now.getDay(); // 0 = Sunday, 6 = Saturday
            if (!rule.active_days_of_week.includes(currentDay)) {
                return false;
            }
        }

        // Check hours (if specified)
        if (rule.active_hours_start && rule.active_hours_end) {
            const currentTime = now.toTimeString().substring(0, 8); // HH:MM:SS
            if (currentTime < rule.active_hours_start || currentTime > rule.active_hours_end) {
                return false;
            }
        }

        return true;
    }

    /**
     * Check if this is customer's first order
     * @param {object} customerProfile
     * @returns {Promise<boolean>}
     */
    async isCustomerFirstOrder(customerProfile) {
        if (!customerProfile || !customerProfile.id) {
            return true; // Assume first order if no profile
        }

        try {
            const { count } = await dbClient
                .from('orders')
                .select('*', { count: 'exact', head: true })
                .eq('customer_profile_id', customerProfile.id)
                .eq('status', 'confirmed');

            return count === 0;
        } catch (error) {
            console.error('[DISCOUNT_CALC] Error checking first order:', error);
            return false;
        }
    }

    /**
     * Calculate discount amount for a rule
     * @param {object} rule - Discount rule
     * @param {number} orderAmount - Order amount before discount
     * @returns {number} Discount amount
     */
    calculateDiscountAmount(rule, orderAmount) {
        let discountAmount = 0;

        if (rule.discount_value_type === 'percentage') {
            discountAmount = (orderAmount * rule.discount_value) / 100;
            
            // Apply max discount cap if set
            if (rule.max_discount_amount && discountAmount > rule.max_discount_amount) {
                discountAmount = rule.max_discount_amount;
            }
        } else if (rule.discount_value_type === 'fixed_amount') {
            discountAmount = rule.discount_value;
            
            // Don't allow discount to exceed order amount
            if (discountAmount > orderAmount) {
                discountAmount = orderAmount;
            }
        }

        return Math.round(discountAmount * 100) / 100; // Round to 2 decimals
    }

    /**
     * Apply discounts to an order
     * @param {string} tenantId - Tenant ID
     * @param {object} orderData - Order details
     * @returns {Promise<object>} { originalAmount, discountAmount, finalAmount, appliedDiscounts }
     */
    async applyDiscounts(tenantId, orderData) {
        try {
            const { totalAmount, couponCode } = orderData;
            const originalAmount = totalAmount;

            console.log('[DISCOUNT_CALC] Applying discounts to order:', { tenantId, originalAmount, couponCode });

            // Find applicable discounts
            const applicableRules = await this.findApplicableDiscounts(tenantId, orderData);

            if (applicableRules.length === 0) {
                return {
                    originalAmount,
                    discountAmount: 0,
                    finalAmount: originalAmount,
                    appliedDiscounts: []
                };
            }

            // Separate stackable and non-stackable discounts
            const stackableDiscounts = applicableRules.filter(r => r.can_stack_with_other_discounts);
            const nonStackableDiscounts = applicableRules.filter(r => !r.can_stack_with_other_discounts);

            let totalDiscount = 0;
            const appliedDiscounts = [];

            // If there are non-stackable discounts, pick the best one
            if (nonStackableDiscounts.length > 0) {
                let bestDiscount = null;
                let bestDiscountAmount = 0;

                for (const rule of nonStackableDiscounts) {
                    const discountAmount = this.calculateDiscountAmount(rule, originalAmount);
                    if (discountAmount > bestDiscountAmount) {
                        bestDiscountAmount = discountAmount;
                        bestDiscount = rule;
                    }
                }

                if (bestDiscount) {
                    totalDiscount = bestDiscountAmount;
                    appliedDiscounts.push({
                        rule: bestDiscount,
                        discountAmount: bestDiscountAmount
                    });
                }
            } else {
                // Apply all stackable discounts
                let remainingAmount = originalAmount;

                for (const rule of stackableDiscounts) {
                    const discountAmount = this.calculateDiscountAmount(rule, remainingAmount);
                    totalDiscount += discountAmount;
                    remainingAmount -= discountAmount;

                    appliedDiscounts.push({
                        rule,
                        discountAmount
                    });

                    // Don't go below zero
                    if (remainingAmount <= 0) break;
                }
            }

            const finalAmount = Math.max(0, originalAmount - totalDiscount);

            console.log('[DISCOUNT_CALC] Applied discounts:', {
                originalAmount,
                totalDiscount,
                finalAmount,
                discountCount: appliedDiscounts.length
            });

            return {
                originalAmount,
                discountAmount: totalDiscount,
                finalAmount,
                appliedDiscounts
            };
        } catch (error) {
            console.error('[DISCOUNT_CALC] Error applying discounts:', error);
            return {
                originalAmount: orderData.totalAmount,
                discountAmount: 0,
                finalAmount: orderData.totalAmount,
                appliedDiscounts: [],
                error: error.message
            };
        }
    }

    /**
     * Log discount application to audit trail
     * @param {string} tenantId - Tenant ID
     * @param {object} discountRule - Applied discount rule
     * @param {object} orderInfo - Order information
     * @param {number} discountAmount - Applied discount amount
     * @returns {Promise<void>}
     */
    async logDiscountApplication(tenantId, discountRule, orderInfo, discountAmount) {
        try {
            const { orderId, customerPhone, customerProfileId, orderValueBefore, orderValueAfter, quantity } = orderInfo;

            // Log to discount_applications table
            await dbClient
                .from('discount_applications')
                .insert({
                    tenant_id: tenantId,
                    discount_rule_id: discountRule.id,
                    order_id: orderId,
                    customer_phone: customerPhone,
                    customer_profile_id: customerProfileId,
                    discount_name: discountRule.name,
                    discount_type: discountRule.discount_type,
                    discount_amount: discountAmount,
                    coupon_code: discountRule.coupon_code || null,
                    order_value_before_discount: orderValueBefore,
                    order_value_after_discount: orderValueAfter,
                    quantity: quantity || 0,
                    applied_by: 'system'
                });

            // Update discount rule statistics
            await dbClient
                .from('discount_rules')
                .update({
                    times_applied: dbClient.raw('times_applied + 1'),
                    total_discount_given: dbClient.raw(`total_discount_given + ${discountAmount}`),
                    coupon_used_count: discountRule.coupon_code ? dbClient.raw('coupon_used_count + 1') : undefined
                })
                .eq('id', discountRule.id);

            console.log('[DISCOUNT_CALC] Logged discount application:', {
                ruleId: discountRule.id,
                ruleName: discountRule.name,
                discountAmount,
                orderId
            });
        } catch (error) {
            console.error('[DISCOUNT_CALC] Error logging discount application:', error);
        }
    }

    /**
     * Validate a coupon code
     * @param {string} tenantId - Tenant ID
     * @param {string} couponCode - Coupon code to validate
     * @param {object} orderData - Order details for validation
     * @returns {Promise<object>} { valid, message, discount }
     */
    async validateCoupon(tenantId, couponCode, orderData = {}) {
        try {
            console.log('[DISCOUNT_CALC] Validating coupon:', couponCode);

            const { data: rule, error } = await dbClient
                .from('discount_rules')
                .select('*')
                .eq('tenant_id', tenantId)
                .eq('coupon_code', couponCode)
                .eq('is_active', true)
                .single();

            if (error || !rule) {
                return {
                    valid: false,
                    message: 'Invalid or expired coupon code'
                };
            }

            // Check if applicable to order
            const isApplicable = await this.isRuleApplicable(rule, {
                ...orderData,
                couponCode
            });

            if (!isApplicable) {
                // Determine specific reason
                if (rule.min_order_value && orderData.totalAmount < rule.min_order_value) {
                    return {
                        valid: false,
                        message: `Minimum order value of â‚¹${rule.min_order_value} required`
                    };
                }
                if (rule.coupon_usage_limit && rule.coupon_used_count >= rule.coupon_usage_limit) {
                    return {
                        valid: false,
                        message: 'Coupon usage limit reached'
                    };
                }
                if (!this.isWithinTimeWindow(rule)) {
                    return {
                        valid: false,
                        message: 'Coupon is not valid at this time'
                    };
                }
                return {
                    valid: false,
                    message: 'Coupon is not applicable to this order'
                };
            }

            // Calculate potential discount
            const discountAmount = this.calculateDiscountAmount(rule, orderData.totalAmount || 0);

            return {
                valid: true,
                message: `Coupon applied! You saved â‚¹${discountAmount}`,
                discount: rule,
                discountAmount
            };
        } catch (error) {
            console.error('[DISCOUNT_CALC] Error validating coupon:', error);
            return {
                valid: false,
                message: 'Error validating coupon code'
            };
        }
    }

    /**
     * Get best available discount for customer (for AI suggestions)
     * @param {string} tenantId - Tenant ID
     * @param {object} orderData - Order details
     * @returns {Promise<object|null>} Best discount suggestion
     */
    async getBestAvailableDiscount(tenantId, orderData) {
        try {
            const applicableRules = await this.findApplicableDiscounts(tenantId, orderData);

            if (applicableRules.length === 0) {
                return null;
            }

            let bestDiscount = null;
            let bestAmount = 0;

            for (const rule of applicableRules) {
                const amount = this.calculateDiscountAmount(rule, orderData.totalAmount);
                if (amount > bestAmount) {
                    bestAmount = amount;
                    bestDiscount = {
                        ...rule,
                        calculatedAmount: amount
                    };
                }
            }

            return bestDiscount;
        } catch (error) {
            console.error('[DISCOUNT_CALC] Error getting best discount:', error);
            return null;
        }
    }
}

module.exports = new DiscountCalculationService();

