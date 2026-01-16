// services/gstService.js
const { dbClient } = require('./config');

/**
 * Calculate GST amounts based on subtotal and tenant configuration
 * @param {string} tenantId - Tenant ID
 * @param {number} subtotalAmount - Subtotal amount before GST
 * @param {boolean} isInterstate - Whether the order is interstate (affects GST breakdown)
 * @returns {Object} GST calculation result
 */
const calculateGST = async (tenantId, subtotalAmount, isInterstate = false) => {
    try {
        console.log('[GST] Calculating for:', {
            tenantId,
            subtotalAmount,
            isInterstate
        });

        // Get GST configuration for this tenant (if any)
        const gstRate = await getGSTRate(tenantId);
        
        console.log('[GST] Using GST rate:', gstRate);

        // Calculate total GST amount
        const gstAmount = (subtotalAmount * gstRate) / 100;
        
        let cgstAmount = 0;
        let sgstAmount = 0; 
        let igstAmount = 0;

        if (isInterstate) {
            // Inter-state: All GST goes to IGST
            igstAmount = gstAmount;
            console.log('[GST] Interstate transaction - using IGST');
        } else {
            // Same state: Split between CGST and SGST
            cgstAmount = gstAmount / 2;
            sgstAmount = gstAmount / 2;
            console.log('[GST] Same state transaction - using CGST + SGST');
        }

        const totalWithGST = subtotalAmount + gstAmount;

        return {
            subtotal: parseFloat(subtotalAmount.toFixed(2)),
            gstRate: gstRate,
            gstAmount: parseFloat(gstAmount.toFixed(2)),
            cgstAmount: parseFloat(cgstAmount.toFixed(2)),
            sgstAmount: parseFloat(sgstAmount.toFixed(2)),
            igstAmount: parseFloat(igstAmount.toFixed(2)),
            isInterstate: isInterstate,
            total: parseFloat(totalWithGST.toFixed(2))
        };

    } catch (error) {
        console.error('[GST] Error calculating GST:', error.message);
        
        // Fallback to 18% GST if calculation fails
        return calculateDefaultGST(subtotalAmount, isInterstate);
    }
};

/**
 * Get GST rate for a tenant from tenant configuration
 * @param {string} tenantId - Tenant ID
 * @returns {number} GST rate percentage
 */
const getGSTRate = async (tenantId) => {
    try {
        // GST rate is standard 18% for all tenants
        // Tenant-specific GST configuration can be added in future if needed
        return 18;

    } catch (error) {
        console.error('[GST] Error in getGSTRate:', error.message);
        return 18; // Default fallback
    }
};

/**
 * Default GST calculation when no config is available
 */
const calculateDefaultGST = (subtotalAmount, isInterstate = false) => {
    console.log('[GST] Using default 18% GST rate');
    
    const gstRate = 18;
    const gstAmount = (subtotalAmount * gstRate) / 100;
    
    let cgstAmount = 0;
    let sgstAmount = 0;
    let igstAmount = 0;

    if (isInterstate) {
        igstAmount = gstAmount;
    } else {
        cgstAmount = gstAmount / 2;
        sgstAmount = gstAmount / 2;
    }

    const totalWithGST = subtotalAmount + gstAmount;

    return {
        subtotal: parseFloat(subtotalAmount.toFixed(2)),
        gstRate: gstRate,
        gstAmount: parseFloat(gstAmount.toFixed(2)),
        cgstAmount: parseFloat(cgstAmount.toFixed(2)),
        sgstAmount: parseFloat(sgstAmount.toFixed(2)),
        igstAmount: parseFloat(igstAmount.toFixed(2)),
        isInterstate: isInterstate,
        total: parseFloat(totalWithGST.toFixed(2))
    };
};

/**
 * Format GST information for display in cart/order
 * @param {Object} gstCalc - GST calculation result
 * @param {boolean} detailed - Whether to show detailed breakdown
 * @returns {string} Formatted GST display
 */
const formatGSTDisplay = (gstCalc, detailed = false) => {
    if (!gstCalc) {
        return 'GST: Calculation error';
    }

    if (!detailed) {
        return `GST (${gstCalc.gstRate}%): ₹${gstCalc.gstAmount}`;
    }

    let display = `GST Breakdown (${gstCalc.gstRate}%):\n`;
    
    if (gstCalc.isInterstate) {
        display += `IGST: ₹${gstCalc.igstAmount}`;
    } else {
        display += `CGST: ₹${gstCalc.cgstAmount}\n`;
        display += `SGST: ₹${gstCalc.sgstAmount}`;
    }
    
    display += `\nTotal GST: ₹${gstCalc.gstAmount}`;
    
    return display;
};

/**
 * Determine if transaction is interstate based on business and customer location
 * @param {string} tenantId - Tenant ID
 * @param {string} customerState - Customer state code (optional)
 * @returns {boolean} Whether transaction is interstate
 */
const determineIfInterstate = async (tenantId, customerState = null) => {
    try {
        if (!customerState) {
            // If customer state is unknown, assume same state
            console.log('[GST] Customer state unknown, assuming same state');
            return false;
        }

        // Get tenant's business state
        const { data: tenant, error } = await dbClient
            .from('tenants')
            .select('business_state')
            .eq('id', tenantId)
            .single();

        if (error || !tenant?.business_state) {
            console.warn('[GST] Cannot determine business state, assuming same state');
            return false;
        }

        const isInterstate = tenant.business_state.toLowerCase() !== customerState.toLowerCase();
        
        console.log('[GST] Interstate check:', {
            businessState: tenant.business_state,
            customerState,
            isInterstate
        });

        return isInterstate;

    } catch (error) {
        console.error('[GST] Error determining interstate status:', error.message);
        return false; // Default to same state
    }
};

/**
 * Update or create GST configuration for a tenant
 * @param {string} tenantId - Tenant ID
 * @param {Object} gstConfig - GST configuration
 * @returns {Object} Result object
 */
const updateGSTConfig = async (tenantId, gstConfig) => {
    try {
        const {
            gst_rate = 18,
            business_state = null
        } = gstConfig;

        // Validate GST rate
        if (gst_rate < 0 || gst_rate > 50) {
            throw new Error('GST rate must be between 0% and 50%');
        }

        // Update tenant's GST configuration
        const { data: updated, error } = await dbClient
            .from('tenants')
            .update({
                gst_rate,
                business_state,
                updated_at: new Date().toISOString()
            })
            .eq('id', tenantId)
            .select('gst_rate, business_state')
            .single();

        if (error) {
            throw error;
        }

        return { 
            success: true, 
            data: updated,
            message: `GST rate updated to ${gst_rate}%` + 
                    (business_state ? ` for ${business_state}` : '')
        };

    } catch (error) {
        console.error('[GST] Error updating config:', error.message);
        return { success: false, error: error.message };
    }
};

/**
 * Get GST configuration for a tenant
 * @param {string} tenantId - Tenant ID
 * @returns {Object|null} GST configuration
 */
const getGSTConfig = async (tenantId) => {
    try {
        const { data: tenant, error } = await dbClient
            .from('tenants')
            .select('gst_rate, business_state')
            .eq('id', tenantId)
            .single();

        if (error) {
            console.warn('[GST] Error fetching GST config:', error.message);
            return {
                gst_rate: 18,
                business_state: null
            };
        }

        return {
            gst_rate: tenant?.gst_rate || 18,
            business_state: tenant?.business_state || null
        };

    } catch (error) {
        console.error('[GST] Error in getGSTConfig:', error.message);
        return {
            gst_rate: 18,
            business_state: null
        };
    }
};

/**
 * Calculate reverse GST (when you have total with GST and need to find base amount).
 * @param {number} totalWithGST - Total amount including GST
 * @param {number} gstRate - GST rate percentage
 * @returns {Object} Reverse GST calculation
 */
const calculateReverseGST = (totalWithGST, gstRate = 18) => {
    const multiplier = 1 + (gstRate / 100);
    const subtotal = totalWithGST / multiplier;
    const gstAmount = totalWithGST - subtotal;

    return {
        subtotal: parseFloat(subtotal.toFixed(2)),
        gstAmount: parseFloat(gstAmount.toFixed(2)),
        gstRate: gstRate,
        total: parseFloat(totalWithGST.toFixed(2))
    };
};

module.exports = {
    calculateGST,
    calculateDefaultGST,
    getGSTRate,
    formatGSTDisplay,
    determineIfInterstate,
    updateGSTConfig,
    getGSTConfig,
    calculateReverseGST
};

