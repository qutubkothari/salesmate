const { dbClient } = require('./config');

/**
 * Volume-based discount tiers
 * Based on total cartons in order
 */
const DISCOUNT_SLABS = [
    { minQty: 1, maxQty: 10, minDiscount: 0, maxDiscount: 0 },
    { minQty: 11, maxQty: 25, minDiscount: 2, maxDiscount: 3 },
    { minQty: 26, maxQty: 50, minDiscount: 3, maxDiscount: 5 },
    { minQty: 51, maxQty: 100, minDiscount: 5, maxDiscount: 7 },
    { minQty: 101, maxQty: Infinity, minDiscount: 7, maxDiscount: 10 }
];

/**
 * Get discount slab for a given quantity of cartons
 * @param {number} totalCartons - Total number of cartons
 * @returns {Object} Discount slab with min/max discount percentages
 */
function getDiscountSlab(totalCartons) {
    for (const slab of DISCOUNT_SLABS) {
        if (totalCartons >= slab.minQty && totalCartons <= slab.maxQty) {
            return slab;
        }
    }
    // Default to no discount if somehow out of range
    return { minQty: 0, maxQty: 0, minDiscount: 0, maxDiscount: 0 };
}

/**
 * Calculate discount amount
 * @param {number} subtotal - Subtotal before discount
 * @param {number} totalCartons - Total cartons
 * @param {string} discountType - 'min', 'max', or 'custom'
 * @param {number} customPercent - Custom discount percentage (if discountType is 'custom')
 * @returns {Object} Discount details
 */
function calculateDiscount(subtotal, totalCartons, discountType = 'min', customPercent = null) {
    const slab = getDiscountSlab(totalCartons);
    
    let discountPercent = 0;
    
    if (discountType === 'custom' && customPercent !== null) {
        // Validate custom discount is within slab range
        if (customPercent >= slab.minDiscount && customPercent <= slab.maxDiscount) {
            discountPercent = customPercent;
        } else {
            // If out of range, use min discount
            console.log('[DISCOUNT] Custom discount out of range, using min discount');
            discountPercent = slab.minDiscount;
        }
    } else if (discountType === 'max') {
        discountPercent = slab.maxDiscount;
    } else {
        // Default to min discount
        discountPercent = slab.minDiscount;
    }
    
    const discountAmount = (subtotal * discountPercent) / 100;
    
    return {
        slab: {
            minQty: slab.minQty,
            maxQty: slab.maxQty === Infinity ? '100+' : slab.maxQty,
            minDiscount: slab.minDiscount,
            maxDiscount: slab.maxDiscount
        },
        discountPercent,
        discountAmount: parseFloat(discountAmount.toFixed(2)),
        subtotal,
        finalAmount: parseFloat((subtotal - discountAmount).toFixed(2))
    };
}

/**
 * Format discount message for WhatsApp
 * @param {Object} discountInfo - Discount information
 * @param {number} totalCartons - Total cartons
 * @returns {string} Formatted message
 */
function formatDiscountMessage(discountInfo, totalCartons) {
    const { slab, discountPercent, discountAmount, subtotal, finalAmount } = discountInfo;
    
    if (discountPercent === 0) {
        return `📦 Volume: ${totalCartons} cartons (no bulk discount for 1-10 cartons)`;
    }
    
    let message = `\n💰 Volume Discount Applied!\n`;
    message += `━━━━━━━━━━━━━━━━━\n`;
    message += `📦 Total Cartons: ${totalCartons}\n`;
    message += `🎯 Discount Slab: ${slab.minQty}-${slab.maxQty} cartons\n`;
    message += `💵 Discount Range: ${slab.minDiscount}% - ${slab.maxDiscount}%\n`;
    message += `✨ Your Discount: ${discountPercent}%\n\n`;
    message += `💸 Subtotal: ₹${subtotal.toFixed(2)}\n`;
    message += `🎁 Discount: -₹${discountAmount.toFixed(2)}\n`;
    message += `━━━━━━━━━━━━━━━━━\n`;
    message += `💰 Final Amount: ₹${finalAmount.toFixed(2)}`;
    
    return message;
}

/**
 * Calculate next discount tier message
 * @param {number} currentCartons - Current carton count
 * @returns {string} Message about next discount tier
 */
function getNextTierMessage(currentCartons) {
    const currentSlab = getDiscountSlab(currentCartons);
    
    // Find next slab
    const currentIndex = DISCOUNT_SLABS.findIndex(s => s.minQty === currentSlab.minQty);
    
    if (currentIndex < DISCOUNT_SLABS.length - 1) {
        const nextSlab = DISCOUNT_SLABS[currentIndex + 1];
        const cartonsNeeded = nextSlab.minQty - currentCartons;
        
        return `\n💡 Tip: Order ${cartonsNeeded} more carton${cartonsNeeded > 1 ? 's' : ''} to get ${nextSlab.minDiscount}%-${nextSlab.maxDiscount}% discount!`;
    }
    
    return ''; // Already at highest tier
}

/**
 * Apply discount to order items
 * @param {Array} orderItems - Array of order items with price and quantity
 * @param {string} discountType - 'min', 'max', or 'custom'
 * @param {number} customPercent - Custom discount percentage
 * @returns {Object} Updated order with discount applied
 */
function applyDiscountToOrder(orderItems, discountType = 'min', customPercent = null) {
    // Calculate total cartons
    const totalCartons = orderItems.reduce((sum, item) => {
        // If quantity is in pieces, convert to cartons (assuming 1 carton = standard unit)
        const cartons = item.unit === 'pieces' ? Math.ceil(item.quantity / (item.unitsPerCarton || 1500)) : item.quantity;
        return sum + cartons;
    }, 0);
    
    // Calculate subtotal
    const subtotal = orderItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    
    // Get discount info
    const discountInfo = calculateDiscount(subtotal, totalCartons, discountType, customPercent);
    
    return {
        ...discountInfo,
        totalCartons,
        orderItems
    };
}

/**
 * Format price with discount for single product inquiry
 * @param {Object} product - Product details
 * @param {number} quantity - Quantity being inquired
 * @param {string} unit - 'cartons' or 'pieces'
 * @returns {string} Formatted message with potential discount
 */
function formatPriceWithPotentialDiscount(product, quantity, unit = 'cartons') {
    const cartons = unit === 'pieces' ? Math.ceil(quantity / (product.units_per_carton || 1500)) : quantity;
    const price = unit === 'pieces' ? product.price_per_piece : product.price;
    const subtotal = price * quantity;
    
    const discountInfo = calculateDiscount(subtotal, cartons);
    const slab = discountInfo.slab;
    
    let message = `📦 ${product.name}\n\n`;
    message += `💰 Price: ₹${price.toFixed(2)}/${unit === 'pieces' ? 'pc' : 'carton'}\n`;
    message += `📊 Quantity: ${quantity} ${unit}\n`;
    message += `💵 Subtotal: ₹${subtotal.toFixed(2)}\n`;
    
    if (discountInfo.discountPercent > 0) {
        message += `\n🎁 Bulk Discount: ${discountInfo.discountPercent}%\n`;
        message += `💸 Discount: -₹${discountInfo.discountAmount.toFixed(2)}\n`;
        message += `━━━━━━━━━━━━━━━━━\n`;
        message += `✨ Final Price: ₹${discountInfo.finalAmount.toFixed(2)}`;
    } else {
        message += `\n📍 Current Slab: ${slab.minQty}-${slab.maxQty} cartons (${slab.minDiscount}%-${slab.maxDiscount}% discount)`;
        message += getNextTierMessage(cartons);
    }
    
    return message;
}

/**
 * Save discount configuration to database (for future admin customization)
 * @param {string} tenantId - Tenant ID
 * @param {Array} discountSlabs - Array of discount slab configurations
 */
async function saveDiscountConfig(tenantId, discountSlabs) {
    try {
        const { data, error } = await dbClient
            .from('tenant_settings')
            .upsert({
                tenant_id: tenantId,
                setting_key: 'volume_discount_slabs',
                setting_value: JSON.stringify(discountSlabs),
                updated_at: new Date().toISOString()
            }, {
                onConflict: 'tenant_id,setting_key'
            });
        
        if (error) {
            console.error('[DISCOUNT] Error saving config:', error);
            return { success: false, error };
        }
        
        return { success: true, data };
    } catch (error) {
        console.error('[DISCOUNT] Exception saving config:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Load discount configuration from database
 * @param {string} tenantId - Tenant ID
 * @returns {Array} Discount slabs
 */
async function loadDiscountConfig(tenantId) {
    try {
        const { data, error } = await dbClient
            .from('tenant_settings')
            .select('setting_value')
            .eq('tenant_id', tenantId)
            .eq('setting_key', 'volume_discount_slabs')
            .single();
        
        if (error || !data) {
            console.log('[DISCOUNT] No custom config found, using defaults');
            return DISCOUNT_SLABS;
        }
        
        return JSON.parse(data.setting_value);
    } catch (error) {
        console.error('[DISCOUNT] Exception loading config:', error);
        return DISCOUNT_SLABS;
    }
}

module.exports = {
    getDiscountSlab,
    calculateDiscount,
    formatDiscountMessage,
    getNextTierMessage,
    applyDiscountToOrder,
    formatPriceWithPotentialDiscount,
    saveDiscountConfig,
    loadDiscountConfig,
    DISCOUNT_SLABS
};


