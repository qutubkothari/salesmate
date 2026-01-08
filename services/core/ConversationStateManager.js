/**
 * ConversationStateManager - Centralized State Machine for Conversations
 * 
 * This service manages conversation states with:
 * 1. Clear state definitions and transitions
 * 2. Validation of state changes
 * 3. State-specific behavior
 * 4. Escape mechanisms
 * 
 * @module services/core/ConversationStateManager
 */

const { supabase } = require('../config');
const { toWhatsAppFormat, normalizePhone } = require('../../utils/phoneUtils');

/**
 * Valid conversation states
 */
const STATES = {
    INITIAL: null, // No conversation yet or reset
    BROWSING: 'browsing', // Customer looking at products
    CART_ACTIVE: 'cart_active', // Items in cart, discussing order
    AWAITING_GST: 'awaiting_gst_details', // Waiting for GST preference
    AWAITING_SHIPPING: 'awaiting_shipping_info', // Waiting for shipping details
    AWAITING_ADDRESS: 'awaiting_address_update', // Waiting for address
    CHECKOUT_READY: 'checkout_ready', // Ready to place order
    ORDER_PLACED: 'order_placed', // Order confirmed
    MULTI_PRODUCT_DISCUSSION: 'multi_product_order_discussion' // Discussing multiple products
};

/**
 * Valid state transitions
 * Maps current state → array of allowed next states
 */
const VALID_TRANSITIONS = {
    [STATES.INITIAL]: [STATES.BROWSING, STATES.CART_ACTIVE, STATES.AWAITING_GST, STATES.MULTI_PRODUCT_DISCUSSION],
    [STATES.BROWSING]: [STATES.CART_ACTIVE, STATES.INITIAL],
    [STATES.CART_ACTIVE]: [STATES.AWAITING_GST, STATES.AWAITING_SHIPPING, STATES.CHECKOUT_READY, STATES.BROWSING, STATES.INITIAL, STATES.MULTI_PRODUCT_DISCUSSION],
    [STATES.MULTI_PRODUCT_DISCUSSION]: [STATES.AWAITING_GST, STATES.AWAITING_SHIPPING, STATES.CHECKOUT_READY, STATES.CART_ACTIVE, STATES.INITIAL],
    [STATES.AWAITING_GST]: [STATES.AWAITING_SHIPPING, STATES.CHECKOUT_READY, STATES.CART_ACTIVE, STATES.INITIAL],
    [STATES.AWAITING_SHIPPING]: [STATES.AWAITING_ADDRESS, STATES.CHECKOUT_READY, STATES.CART_ACTIVE, STATES.INITIAL],
    [STATES.AWAITING_ADDRESS]: [STATES.CHECKOUT_READY, STATES.CART_ACTIVE, STATES.INITIAL],
    [STATES.CHECKOUT_READY]: [STATES.ORDER_PLACED, STATES.CART_ACTIVE, STATES.INITIAL],
    [STATES.ORDER_PLACED]: [STATES.INITIAL, STATES.BROWSING]
};

/**
 * Validate phone number
 * @private
 */
function validatePhone(phone) {
    if (!phone || typeof phone !== 'string') {
        throw new Error('Phone number is required');
    }
    return true;
}

/**
 * Validate tenant ID
 * @private
 */
function validateTenantId(tenantId) {
    if (!tenantId) {
        throw new Error('Tenant ID is required');
    }
    return true;
}

/**
 * Validate state transition
 * @private
 */
function isValidTransition(currentState, newState) {
    // Allow resetting to INITIAL from any state
    if (newState === STATES.INITIAL) {
        return true;
    }
    
    // Check if transition is in allowed list
    const allowedStates = VALID_TRANSITIONS[currentState] || [];
    return allowedStates.includes(newState);
}

/**
 * Get current conversation state
 * 
 * @param {string} tenantId - Tenant UUID
 * @param {string} phoneNumber - Customer phone
 * @returns {Promise<{state: string|null, conversationId: string|null}>}
 */
async function getState(tenantId, phoneNumber) {
    try {
        validateTenantId(tenantId);
        validatePhone(phoneNumber);
        
        const whatsappPhone = toWhatsAppFormat(phoneNumber);
        const normalizedPhone = normalizePhone(phoneNumber);
        
        const { data, error } = await supabase
            .from('conversations')
            .select('id, state')
            .eq('tenant_id', tenantId)
            // Be tolerant: some code stores digits-only, some stores WhatsApp format.
            .or(
                [
                    `end_user_phone.eq.${whatsappPhone}`,
                    normalizedPhone ? `end_user_phone.eq.${normalizedPhone}` : null,
                    `phone_number.eq.${whatsappPhone}`,
                    normalizedPhone ? `phone_number.eq.${normalizedPhone}` : null
                ].filter(Boolean).join(',')
            )
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        
        if (error && error.code !== 'PGRST116') {
            console.error('[StateManager] Error fetching state:', error);
            throw new Error(`Failed to get conversation state: ${error.message}`);
        }
        
        if (!data) {
            console.log(`[StateManager] No conversation found for: ${whatsappPhone} (normalized: ${normalizedPhone})`);
            return { state: STATES.INITIAL, conversationId: null };
        }
        
        console.log(`[StateManager] Current state for ${whatsappPhone}: ${data.state || 'INITIAL'}`);
        return { state: data.state || STATES.INITIAL, conversationId: data.id };
        
    } catch (error) {
        console.error('[StateManager] getState failed:', error.message);
        throw error;
    }
}

/**
 * Set conversation state with validation
 * 
 * @param {string} tenantId - Tenant UUID
 * @param {string} phoneNumber - Customer phone
 * @param {string} newState - New state to set
 * @param {Object} options - Additional options
 * @param {boolean} options.force - Skip validation (use with caution)
 * @returns {Promise<{success: boolean, previousState: string, newState: string}>}
 */
async function setState(tenantId, phoneNumber, newState, options = {}) {
    try {
        validateTenantId(tenantId);
        validatePhone(phoneNumber);
        
        const whatsappPhone = toWhatsAppFormat(phoneNumber);
        const normalizedPhone = normalizePhone(phoneNumber);
        let { state: currentState, conversationId } = await getState(tenantId, phoneNumber);
        
        // Validate transition unless forced
        if (!options.force && !isValidTransition(currentState, newState)) {
            const error = `Invalid state transition: ${currentState} → ${newState}`;
            console.error(`[StateManager] ${error}`);
            throw new Error(error);
        }
        
        if (!conversationId) {
            // Create a conversation so state transitions never fail.
            console.warn('[StateManager] No conversation exists; creating one for state update');
            const { data: newConversation, error: createError } = await supabase
                .from('conversations')
                .insert({
                    tenant_id: tenantId,
                    phone_number: normalizedPhone || phoneNumber,
                    end_user_phone: normalizedPhone || phoneNumber,
                    state: STATES.INITIAL,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                })
                .select('id')
                .single();

            if (createError) {
                console.error('[StateManager] Failed to create conversation for state update:', createError);
                throw new Error('No conversation found to update state');
            }

            conversationId = newConversation?.id || null;
            currentState = STATES.INITIAL;
        }
        
        console.log(`[StateManager] State transition: ${currentState} → ${newState} for ${whatsappPhone}`);
        
        const { error } = await supabase
            .from('conversations')
            .update({
                state: newState,
                updated_at: new Date().toISOString()
            })
            .eq('id', conversationId);
        
        if (error) {
            console.error('[StateManager] Error updating state:', error);
            throw new Error(`Failed to update conversation state: ${error.message}`);
        }
        
        console.log(`[StateManager] State updated successfully: ${newState}`);
        return {
            success: true,
            previousState: currentState,
            newState: newState
        };
        
    } catch (error) {
        console.error('[StateManager] setState failed:', error.message);
        throw error;
    }
}

/**
 * Reset conversation to initial state
 * Used when customer wants to start over or escape current flow
 * 
 * @param {string} tenantId - Tenant UUID
 * @param {string} phoneNumber - Customer phone
 * @returns {Promise<boolean>}
 */
async function resetState(tenantId, phoneNumber) {
    try {
        console.log(`[StateManager] Resetting state for: ${phoneNumber}`);
        await setState(tenantId, phoneNumber, STATES.INITIAL, { force: true });
        return true;
    } catch (error) {
        console.error('[StateManager] resetState failed:', error.message);
        // Don't throw - reset should be forgiving
        return false;
    }
}

/**
 * Check if customer is in a specific state
 * 
 * @param {string} tenantId - Tenant UUID
 * @param {string} phoneNumber - Customer phone
 * @param {string} expectedState - State to check
 * @returns {Promise<boolean>}
 */
async function isInState(tenantId, phoneNumber, expectedState) {
    try {
        const { state } = await getState(tenantId, phoneNumber);
        return state === expectedState;
    } catch (error) {
        console.error('[StateManager] isInState failed:', error.message);
        return false;
    }
}

/**
 * Check if customer is in any of the given states
 * 
 * @param {string} tenantId - Tenant UUID
 * @param {string} phoneNumber - Customer phone
 * @param {Array<string>} states - States to check
 * @returns {Promise<boolean>}
 */
async function isInAnyState(tenantId, phoneNumber, states) {
    try {
        const { state } = await getState(tenantId, phoneNumber);
        return states.includes(state);
    } catch (error) {
        console.error('[StateManager] isInAnyState failed:', error.message);
        return false;
    }
}

/**
 * Transition to cart active state (when item added)
 */
async function transitionToCartActive(tenantId, phoneNumber) {
    return await setState(tenantId, phoneNumber, STATES.CART_ACTIVE);
}

/**
 * Transition to awaiting GST state
 */
async function transitionToAwaitingGST(tenantId, phoneNumber) {
    return await setState(tenantId, phoneNumber, STATES.AWAITING_GST);
}

/**
 * Transition to awaiting shipping state
 */
async function transitionToAwaitingShipping(tenantId, phoneNumber) {
    return await setState(tenantId, phoneNumber, STATES.AWAITING_SHIPPING);
}

/**
 * Transition to checkout ready state
 */
async function transitionToCheckoutReady(tenantId, phoneNumber) {
    return await setState(tenantId, phoneNumber, STATES.CHECKOUT_READY);
}

/**
 * Transition to order placed state
 */
async function transitionToOrderPlaced(tenantId, phoneNumber) {
    return await setState(tenantId, phoneNumber, STATES.ORDER_PLACED);
}

/**
 * Handle "escape" keywords that reset state
 * Returns true if message is an escape keyword
 * 
 * @param {string} message - Customer message
 * @returns {boolean}
 */
function isEscapeKeyword(message) {
    if (!message) return false;
    
    const escapePatterns = [
        /^cancel$/i,
        /^stop$/i,
        /^reset$/i,
        /^start\s+over$/i,
        /^clear$/i,
        /^forget\s+it$/i
    ];
    
    const normalizedMessage = message.trim().toLowerCase();
    return escapePatterns.some(pattern => pattern.test(normalizedMessage));
}

module.exports = {
    // State constants
    STATES,
    
    // Core functions
    getState,
    setState,
    resetState,
    
    // State checks
    isInState,
    isInAnyState,
    isEscapeKeyword,
    
    // Convenience transition functions
    transitionToCartActive,
    transitionToAwaitingGST,
    transitionToAwaitingShipping,
    transitionToCheckoutReady,
    transitionToOrderPlaced
};
