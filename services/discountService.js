/**
 * @title Discount Management Service
 * @description Handles discount codes, automatic discounts, and promotional offers
 */
const { dbClient } = require('./config');
const { getConversationId } = require('./historyService');

/**
 * Creates a new discount code for a tenant
 * @param {string} tenantId The ID of the tenant
 * @param {Object} discountData Discount configuration
 * @returns {Promise<string>} Success or error message
 */
const createDiscount = async (tenantId, discountData) => {
    try {
        const {
            code,
            type, // 'percentage', 'fixed', 'buy_x_get_y'
            value, // percentage (10) or fixed amount (500)
            minOrderValue = 0,
            maxDiscount = null,
            usageLimit = null,
            validFrom = new Date().toISOString(),
            validUntil = null,
            applicableProducts = [], // product IDs
            applicableCategories = [], // category names
            customerSegments = [], // 'new', 'vip', 'regular'
            description = '',
            isAutomatic = false
        } = discountData;

        // Validate required fields
        if (!code || !type || !value) {
            return 'Error: Code, type, and value are required fields.';
        }

        // Check if code already exists
        const { data: existingCode } = await dbClient
            .from('discount_codes')
            .select('id')
            .eq('tenant_id', tenantId)
            .eq('code', code.toUpperCase())
            .single();

        if (existingCode) {
            return `Discount code "${code}" already exists.`;
        }

        const { error } = await dbClient
            .from('discount_codes')
            .insert({
                tenant_id: tenantId,
                code: code.toUpperCase(),
                type,
                value: parseFloat(value),
                min_order_value: parseFloat(minOrderValue),
                max_discount: maxDiscount ? parseFloat(maxDiscount) : null,
                usage_limit: usageLimit ? parseInt(usageLimit) : null,
                valid_from: validFrom,
                valid_until: validUntil,
                applicable_products: applicableProducts,
                applicable_categories: applicableCategories,
                customer_segments: customerSegments,
                description,
                is_active: true,
                is_automatic: isAutomatic,
                usage_count: 0
            });

        if (error) throw error;

        return `✅ Discount code "${code}" created successfully!\n` +
               `Type: ${type}\n` +
               `Value: ${type === 'percentage' ? value + '%' : '₹' + value}\n` +
               `Min Order: ₹${minOrderValue}` +
               `${isAutomatic ? '\n🤖 Auto-applies when conditions are met' : ''}`;

    } catch (error) {
        console.error('Error creating discount:', error.message);
        return 'Failed to create discount code. Please try again.';
    }
};

/**
 * Applies a discount code to a cart
 * @param {string} tenantId The ID of the tenant
 * @param {string} endUserPhone Customer's phone number
 * @param {string} discountCode The discount code to apply
 * @returns {Promise<Object>} Discount application result
 */
const applyDiscount = async (tenantId, endUserPhone, discountCode) => {
    try {
        const conversationId = await getConversationId(tenantId, endUserPhone);
        if (!conversationId) {
            return { success: false, message: "Could not identify your conversation." };
        }

        // Get cart and items with carton pricing support
        const { data: cart } = await dbClient
            .from('carts')
            .select(`
                id,
                cart_items (
                    quantity,
                    carton_price_override,
                    carton_discount_amount,
                    product:products (id, name, price, technical_details, packaging_unit, units_per_carton)
                )
            `)
            .eq('conversation_id', conversationId)
            .single();

        if (!cart || !cart.cart_items.length) {
            return { success: false, message: "Your cart is empty." };
        }

        // Get discount code
        const { data: discount } = await dbClient
            .from('discount_codes')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('code', discountCode.toUpperCase())
            .eq('is_active', true)
            .single();

        if (!discount) {
            return { success: false, message: `Invalid discount code: ${discountCode}` };
        }

        // Validate discount
        const validation = await validateDiscount(discount, cart, endUserPhone);
        if (!validation.isValid) {
            return { success: false, message: validation.reason };
        }

        // Calculate discount with carton support
        const calculation = calculateDiscountWithCartons(discount, cart.cart_items);
        
        // Apply discount to cart
        await dbClient
            .from('carts')
            .update({
                applied_discount_id: discount.id,
                discount_amount: calculation.discountAmount,
                updated_at: new Date().toISOString()
            })
            .eq('id', cart.id);

        // Update usage count
        await dbClient
            .from('discount_codes')
            .update({ usage_count: discount.usage_count + 1 })
            .eq('id', discount.id);

        return {
            success: true,
            message: `🎉 Discount "${discountCode}" applied!\n` +
                    `Subtotal: ₹${calculation.subtotal.toFixed(2)}\n` +
                    `Discount: -₹${calculation.discountAmount.toFixed(2)}\n` +
                    `**Total: ₹${calculation.finalTotal.toFixed(2)}**`,
            discountAmount: calculation.discountAmount,
            finalTotal: calculation.finalTotal
        };

    } catch (error) {
        console.error('Error applying discount:', error.message);
        return { success: false, message: 'Failed to apply discount code.' };
    }
};

/**
 * Removes discount from cart
 * @param {string} tenantId The ID of the tenant
 * @param {string} endUserPhone Customer's phone number
 * @returns {Promise<Object>} Removal result
 */
const removeDiscount = async (tenantId, endUserPhone) => {
    try {
        const conversationId = await getConversationId(tenantId, endUserPhone);
        if (!conversationId) {
            return { success: false, message: "Could not identify your conversation." };
        }

        const { data: cart } = await dbClient
            .from('carts')
            .select('id, applied_discount_id')
            .eq('conversation_id', conversationId)
            .single();

        if (!cart || !cart.applied_discount_id) {
            return { success: false, message: "No discount applied to your cart." };
        }

        await dbClient
            .from('carts')
            .update({
                applied_discount_id: null,
                discount_amount: 0,
                updated_at: new Date().toISOString()
            })
            .eq('id', cart.id);

        return {
            success: true,
            message: "✅ Discount removed from your cart."
        };

    } catch (error) {
        console.error('Error removing discount:', error.message);
        return { success: false, message: 'Failed to remove discount.' };
    }
};

/**
 * Lists all discount codes for a tenant
 * @param {string} tenantId The ID of the tenant
 * @returns {Promise<string>} Formatted list of discounts
 */
const listDiscounts = async (tenantId) => {
    try {
        const { data: discounts, error } = await dbClient
            .from('discount_codes')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('is_active', true)
            .order('created_at', { ascending: false });

        if (error) throw error;

        if (!discounts || discounts.length === 0) {
            return 'No active discount codes found.';
        }

        let message = '🎫 **Active Discount Codes:**\n\n';
        
        discounts.forEach(discount => {
            const isExpired = discount.valid_until && new Date(discount.valid_until) < new Date();
            const usageInfo = discount.usage_limit ? 
                ` (Used: ${discount.usage_count}/${discount.usage_limit})` : 
                ` (Used: ${discount.usage_count} times)`;

            message += `**${discount.code}**${isExpired ? ' ⚠️ EXPIRED' : ''}${discount.is_automatic ? ' 🤖 AUTO' : ''}\n`;
            message += `- ${discount.type === 'percentage' ? discount.value + '% off' : '₹' + discount.value + ' off'}\n`;
            message += `- Min order: ₹${discount.min_order_value}${usageInfo}\n`;
            if (discount.description) {
                message += `- ${discount.description}\n`;
            }
            message += '\n';
        });

        return message;

    } catch (error) {
        console.error('Error listing discounts:', error.message);
        return 'Failed to retrieve discount codes.';
    }
};

/**
 * Validates if a discount can be applied
 * @param {Object} discount The discount object
 * @param {Object} cart The cart object with items
 * @param {string} endUserPhone Customer's phone number
 * @returns {Promise<Object>} Validation result
 */
const validateDiscount = async (discount, cart, endUserPhone) => {
    // Check expiry
    if (discount.valid_until && new Date(discount.valid_until) < new Date()) {
        return { isValid: false, reason: 'This discount code has expired.' };
    }

    if (discount.valid_from && new Date(discount.valid_from) > new Date()) {
        return { isValid: false, reason: 'This discount code is not yet active.' };
    }

    // Check usage limit
    if (discount.usage_limit && discount.usage_count >= discount.usage_limit) {
        return { isValid: false, reason: 'This discount code has reached its usage limit.' };
    }

    // Calculate cart total (with carton pricing support)
    const cartTotal = cart.cart_items.reduce((sum, item) => {
        const unitPrice = item.carton_price_override || item.product.price;
        return sum + (unitPrice * item.quantity);
    }, 0);

    // Check minimum order value
    if (cartTotal < discount.min_order_value) {
        return { 
            isValid: false, 
            reason: `Minimum order value of ₹${discount.min_order_value} required. Current cart: ₹${cartTotal.toFixed(2)}` 
        };
    }

    // Check applicable products (if specified)
    if (discount.applicable_products && discount.applicable_products.length > 0) {
        const hasApplicableProduct = cart.cart_items.some(item => 
            discount.applicable_products.includes(item.product.id));
        
        if (!hasApplicableProduct) {
            return { isValid: false, reason: 'This discount is not applicable to items in your cart.' };
        }
    }

    // Check applicable categories (if specified)
    if (discount.applicable_categories && discount.applicable_categories.length > 0) {
        const hasApplicableCategory = cart.cart_items.some(item => {
            const category = item.product.technical_details?.category;
            return category && discount.applicable_categories.includes(category);
        });
        
        if (!hasApplicableCategory) {
            return { isValid: false, reason: 'This discount is not applicable to product categories in your cart.' };
        }
    }

    return { isValid: true };
};

/**
 * Calculates discount amount based on discount type and cart contents (with carton support)
 * @param {Object} discount The discount object
 * @param {Array} cartItems Array of cart items
 * @returns {Object} Calculation results
 */
const calculateDiscountWithCartons = (discount, cartItems) => {
    const subtotal = cartItems.reduce((sum, item) => {
        const unitPrice = item.carton_price_override || item.product.price;
        return sum + (unitPrice * item.quantity);
    }, 0);

    let discountAmount = 0;

    switch (discount.type) {
        case 'percentage':
            discountAmount = (subtotal * discount.value) / 100;
            if (discount.max_discount) {
                discountAmount = Math.min(discountAmount, discount.max_discount);
            }
            break;

        case 'fixed':
            discountAmount = Math.min(discount.value, subtotal);
            break;

        case 'buy_x_get_y':
            // Enhanced BOGO logic with carton support
            const applicableItems = cartItems.filter(item => {
                if (discount.applicable_products?.length > 0) {
                    return discount.applicable_products.includes(item.product.id);
                }
                return true;
            });
            
            const totalQuantity = applicableItems.reduce((sum, item) => sum + item.quantity, 0);
            const freeItems = Math.floor(totalQuantity / (discount.value + 1)); // buy X get 1 free
            
            if (freeItems > 0) {
                const cheapestPrice = Math.min(...applicableItems.map(item => 
                    item.carton_price_override || item.product.price));
                discountAmount = freeItems * cheapestPrice;
            }
            break;
    }

    return {
        subtotal,
        discountAmount: Math.round(discountAmount * 100) / 100, // Round to 2 decimals
        finalTotal: Math.round((subtotal - discountAmount) * 100) / 100
    };
};

/**
 * Legacy function for backward compatibility
 */
const calculateDiscount = (discount, cartItems) => {
    return calculateDiscountWithCartons(discount, cartItems);
};

/**
 * Gets automatic discounts that apply to a cart
 * @param {string} tenantId The ID of the tenant
 * @param {Object} cart Cart with items
 * @returns {Promise<Array>} Array of applicable automatic discounts
 */
const getAutomaticDiscounts = async (tenantId, cart) => {
    try {
        const { data: autoDiscounts } = await dbClient
            .from('discount_codes')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('is_active', true)
            .eq('is_automatic', true)
            .order('value', { ascending: false }); // Apply highest discount first

        if (!autoDiscounts) return [];

        const applicableDiscounts = [];
        
        for (const discount of autoDiscounts) {
            const validation = await validateDiscount(discount, cart);
            if (validation.isValid) {
                const calculation = calculateDiscountWithCartons(discount, cart.cart_items);
                applicableDiscounts.push({
                    ...discount,
                    discountAmount: calculation.discountAmount
                });
            }
        }

        return applicableDiscounts;

    } catch (error) {
        console.error('Error getting automatic discounts:', error.message);
        return [];
    }
};

/**
 * Get discount usage analytics
 * @param {string} tenantId The ID of the tenant
 * @param {string} discountCode Optional specific discount code
 * @returns {Promise<Object>} Discount analytics data
 */
const getDiscountAnalytics = async (tenantId, discountCode = null) => {
    try {
        let query = dbClient
            .from('discount_usage_history')
            .select(`
                *,
                discount_codes (code, type, value),
                conversations (end_user_phone)
            `)
            .eq('tenant_id', tenantId);

        if (discountCode) {
            const { data: discount } = await dbClient
                .from('discount_codes')
                .select('id')
                .eq('tenant_id', tenantId)
                .eq('code', discountCode.toUpperCase())
                .single();

            if (discount) {
                query = query.eq('discount_id', discount.id);
            }
        }

        const { data: usage } = await query;
        
        if (!usage || usage.length === 0) {
            return {
                totalUsage: 0,
                totalSavings: 0,
                uniqueCustomers: 0,
                averageSavings: 0
            };
        }

        const totalSavings = usage.reduce((sum, u) => sum + parseFloat(u.discount_amount), 0);
        const uniqueCustomers = new Set(usage.map(u => u.conversations?.end_user_phone)).size;

        return {
            totalUsage: usage.length,
            totalSavings: Math.round(totalSavings * 100) / 100,
            uniqueCustomers,
            averageSavings: Math.round((totalSavings / usage.length) * 100) / 100
        };

    } catch (error) {
        console.error('Error getting discount analytics:', error.message);
        return {
            totalUsage: 0,
            totalSavings: 0,
            uniqueCustomers: 0,
            averageSavings: 0
        };
    }
};

module.exports = {
    createDiscount,
    applyDiscount,
    removeDiscount,
    listDiscounts,
    validateDiscount,
    calculateDiscount,
    calculateDiscountWithCartons,
    getAutomaticDiscounts,
    getDiscountAnalytics
};

