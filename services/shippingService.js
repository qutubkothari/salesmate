// services/shippingService.js
const { dbClient } = require('./config');

/**
 * Calculate shipping charges based on carton quantity and tenant settings
 * @param {string} tenantId - Tenant ID
 * @param {number} totalCartons - Total cartons in the order
 * @param {number} subtotalAmount - Subtotal amount for free shipping check
 * @returns {Object} Shipping calculation result
 */
const calculateShippingCharges = async (tenantId, totalCartons, subtotalAmount) => {
    try {
        console.log('[SHIPPING] Calculating for:', {
            tenantId,
            totalCartons,
            subtotalAmount
        });

        // Get shipping configuration for this tenant
        const { data: shippingConfig, error } = await dbClient
            .from('shipping_config')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('is_active', true)
            .single();

        if (error || !shippingConfig) {
            console.warn('[SHIPPING] No shipping config found, using defaults');
            // Use default shipping rates if no config found
            return calculateDefaultShipping(totalCartons, subtotalAmount);
        }

        console.log('[SHIPPING] Using config:', shippingConfig);

        // Check if free shipping applies
        if (shippingConfig.free_shipping_enabled && 
            subtotalAmount >= shippingConfig.free_shipping_threshold) {
            
            console.log('[SHIPPING] Free shipping applied - threshold met');
            return {
                shippingCharges: 0,
                rateType: 'free',
                ratePerCarton: 0,
                totalCartons,
                freeShippingApplied: true,
                threshold: shippingConfig.free_shipping_threshold,
                message: `Free shipping applied! (Order above ₹${shippingConfig.free_shipping_threshold})`
            };
        }

        // Determine rate type based on carton quantity
        let ratePerCarton, rateType;
        
        if (totalCartons >= shippingConfig.high_volume_threshold) {
            ratePerCarton = shippingConfig.high_volume_rate;
            rateType = 'high_volume';
            console.log('[SHIPPING] High volume rate applied');
        } else {
            ratePerCarton = shippingConfig.standard_rate;
            rateType = 'standard';
            console.log('[SHIPPING] Standard rate applied');
        }

        const shippingCharges = totalCartons * ratePerCarton;

        return {
            shippingCharges: parseFloat(shippingCharges.toFixed(2)),
            rateType,
            ratePerCarton: parseFloat(ratePerCarton),
            totalCartons,
            freeShippingApplied: false,
            threshold: shippingConfig.free_shipping_threshold,
            message: `Shipping: ${totalCartons} cartons × ₹${ratePerCarton}/carton = ₹${shippingCharges.toFixed(2)}`
        };

    } catch (error) {
        console.error('[SHIPPING] Error calculating shipping:', error.message);
        return calculateDefaultShipping(totalCartons, subtotalAmount);
    }
};

/**
 * Default shipping calculation when no config is available
 */
const calculateDefaultShipping = (totalCartons, subtotalAmount) => {
    console.log('[SHIPPING] Using default rates');
    
    // Default free shipping at ₹10,000
    if (subtotalAmount >= 10000) {
        return {
            shippingCharges: 0,
            rateType: 'free',
            ratePerCarton: 0,
            totalCartons,
            freeShippingApplied: true,
            threshold: 10000,
            message: 'Free shipping applied! (Order above ₹10,000)'
        };
    }

    // Default rates: ₹15 for 15+ cartons, ₹20 for less
    const ratePerCarton = totalCartons >= 15 ? 15 : 20;
    const rateType = totalCartons >= 15 ? 'high_volume' : 'standard';
    const shippingCharges = totalCartons * ratePerCarton;

    return {
        shippingCharges: parseFloat(shippingCharges.toFixed(2)),
        rateType,
        ratePerCarton,
        totalCartons,
        freeShippingApplied: false,
        threshold: 10000,
        message: `Shipping: ${totalCartons} cartons × ₹${ratePerCarton}/carton = ₹${shippingCharges.toFixed(2)}`
    };
};

/**
 * Calculate total cartons from cart items
 * @param {Array} cartItems - Array of cart items with quantity and product info
 * @returns {number} Total cartons
 */
const calculateTotalCartons = (cartItems) => {
    if (!cartItems || !Array.isArray(cartItems)) {
        return 0;
    }

    return cartItems.reduce((total, item) => {
        // Assume all quantities are in cartons for shipping calculation
        // If your system stores pieces, you'll need to convert here
        return total + (item.quantity || 0);
    }, 0);
};

/**
 * Get shipping configuration for a tenant
 * @param {string} tenantId - Tenant ID
 * @returns {Object|null} Shipping configuration
 */
const getShippingConfig = async (tenantId) => {
    try {
        const { data: config, error } = await dbClient
            .from('shipping_config')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('is_active', true)
            .single();

        if (error) {
            console.warn('[SHIPPING] Error fetching config:', error.message);
            return null;
        }

        return config;
    } catch (error) {
        console.error('[SHIPPING] Error in getShippingConfig:', error.message);
        return null;
    }
};

/**
 * Update or create shipping configuration for a tenant
 * @param {string} tenantId - Tenant ID
 * @param {Object} config - Shipping configuration
 * @returns {Object} Result object
 */
const updateShippingConfig = async (tenantId, config) => {
    try {
        const {
            high_volume_threshold = 15,
            high_volume_rate = 15.00,
            standard_rate = 20.00,
            free_shipping_enabled = true,
            free_shipping_threshold = 10000.00
        } = config;

        // Try to update existing config
        const { data: updated, error: updateError } = await dbClient
            .from('shipping_config')
            .update({
                high_volume_threshold,
                high_volume_rate,
                standard_rate,
                free_shipping_enabled,
                free_shipping_threshold,
                updated_at: new Date().toISOString()
            })
            .eq('tenant_id', tenantId)
            .select()
            .single();

        if (updateError && updateError.code === 'PGRST116') {
            // No existing config, create new one
            const { data: created, error: createError } = await dbClient
                .from('shipping_config')
                .insert({
                    tenant_id: tenantId,
                    high_volume_threshold,
                    high_volume_rate,
                    standard_rate,
                    free_shipping_enabled,
                    free_shipping_threshold
                })
                .select()
                .single();

            if (createError) {
                throw createError;
            }

            return { success: true, data: created, action: 'created' };
        }

        if (updateError) {
            throw updateError;
        }

        return { success: true, data: updated, action: 'updated' };

    } catch (error) {
        console.error('[SHIPPING] Error updating config:', error.message);
        return { success: false, error: error.message };
    }
};

/**
 * Format shipping information for display in cart/order
 * @param {Object} shippingCalc - Shipping calculation result
 * @returns {string} Formatted shipping display
 */
const formatShippingDisplay = (shippingCalc) => {
    if (!shippingCalc) {
        return 'Shipping: Calculation error';
    }

    if (shippingCalc.freeShippingApplied) {
        return `Shipping: FREE (${shippingCalc.message})`;
    }

    return `Shipping: ₹${shippingCalc.shippingCharges} (${shippingCalc.totalCartons} cartons × ₹${shippingCalc.ratePerCarton})`;
};

/**
 * Validate shipping configuration
 * @param {Object} config - Configuration to validate.
 * @returns {Object} Validation result
 */
const validateShippingConfig = (config) => {
    const errors = [];

    if (config.high_volume_threshold && (config.high_volume_threshold < 1 || config.high_volume_threshold > 1000)) {
        errors.push('High volume threshold must be between 1 and 1000');
    }

    if (config.high_volume_rate && (config.high_volume_rate < 0 || config.high_volume_rate > 1000)) {
        errors.push('High volume rate must be between 0 and 1000');
    }

    if (config.standard_rate && (config.standard_rate < 0 || config.standard_rate > 1000)) {
        errors.push('Standard rate must be between 0 and 1000');
    }

    if (config.free_shipping_threshold && (config.free_shipping_threshold < 0 || config.free_shipping_threshold > 1000000)) {
        errors.push('Free shipping threshold must be between 0 and 1,000,000');
    }

    return {
        valid: errors.length === 0,
        errors
    };
};

module.exports = {
    calculateShippingCharges,
    calculateTotalCartons,
    getShippingConfig,
    updateShippingConfig,
    formatShippingDisplay,
    validateShippingConfig,
    calculateDefaultShipping
};

