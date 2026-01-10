/**
 * ErrorRecoveryService - Human-like Error Handling with Context
 * 
 * This service provides intelligent error recovery that:
 * 1. Remembers what the user was doing when error occurred
 * 2. Provides contextual recovery options
 * 3. Tracks retry attempts and suggests alternatives
 * 4. Uses natural, varied language
 * 
 * @module services/core/ErrorRecoveryService
 */

const { dbClient } = require('../config');
const ConversationMemory = require('./ConversationMemory');

class ErrorRecoveryService {
    
    /**
     * Handle error with context-aware recovery
     * @param {Object} context - Error context
     * @param {string} context.errorType - Type of error (gst_verification, product_search, checkout, etc.)
     * @param {string} context.tenantId - Tenant ID
     * @param {string} context.conversationId - Conversation ID
     * @param {string} context.phoneNumber - User phone number
     * @param {Object} context.conversationState - Current conversation state
     * @param {Object} context.errorDetails - Specific error details
     * @param {string} context.userInput - What user just said
     * @returns {Promise<Object>} Recovery response with suggested actions
     */
    async handleError(context) {
        const {
            errorType,
            tenantId,
            conversationId,
            phoneNumber,
            conversationState,
            errorDetails,
            userInput
        } = context;
        
        console.log(`[ErrorRecovery] Handling ${errorType} error for conversation ${conversationId}`);
        
        // Track retry count for this error type
        const retryCount = await this.getRetryCount(conversationId, errorType);
        
        // Get conversation history for context
        const memory = await ConversationMemory.getMemory(tenantId, conversationId);
        const recentContext = memory ? memory.recent_messages.slice(-3) : [];
        
        // Generate contextual recovery based on error type
        let recovery;
        switch (errorType) {
            case 'gst_verification':
                recovery = await this.recoverFromGSTError(context, retryCount, recentContext);
                break;
            case 'product_search':
                recovery = await this.recoverFromProductSearchError(context, retryCount, recentContext);
                break;
            case 'checkout':
                recovery = await this.recoverFromCheckoutError(context, retryCount, recentContext);
                break;
            case 'cart_update':
                recovery = await this.recoverFromCartError(context, retryCount, recentContext);
                break;
            case 'api_failure':
                recovery = await this.recoverFromAPIError(context, retryCount, recentContext);
                break;
            default:
                recovery = await this.recoverFromGenericError(context, retryCount, recentContext);
        }
        
        // Save recovery attempt
        await this.saveRecoveryAttempt(conversationId, errorType, recovery);
        
        return recovery;
    }
    
    /**
     * Handle GST verification errors with contextual recovery
     */
    async recoverFromGSTError(context, retryCount, recentContext) {
        const { errorDetails, userInput, conversationState } = context;
        
        // Check if user was in checkout flow
        const wasCheckingOut = conversationState?.state === 'AWAITING_GST' || 
                               recentContext.some(m => m.content?.includes('checkout') || m.content?.includes('confirm order'));
        
        let message;
        let suggestedActions = [];
        
        if (retryCount === 0) {
            // First attempt - be helpful and specific
            message = `âŒ GST Verification Failed\n\n` +
                     `The GST number "${errorDetails?.gstNumber || userInput}" could not be verified in government records.\n\n` +
                     `This could mean:\n` +
                     `â€¢ The number has a typo\n` +
                     `â€¢ GST registration is inactive\n` +
                     `â€¢ Government portal is temporarily down\n\n`;
            
            suggestedActions = [
                { action: 'retry_gst', label: 'Re-enter GST number (15 characters)' },
                { action: 'upload_certificate', label: 'Upload GST certificate PDF' },
                { action: 'skip_gst', label: 'Proceed without GST billing' }
            ];
            
            if (wasCheckingOut) {
                message += `I noticed you were checking out. `;
                suggestedActions.push({ action: 'continue_checkout', label: 'Continue to checkout' });
            }
            
            message += `\nWhat would you like to do?\n` +
                      suggestedActions.map((a, i) => `${i + 1}. ${a.label}`).join('\n');
            
        } else if (retryCount === 1) {
            // Second attempt - offer alternative
            message = `I see you've tried that GST number twice. Let me help differently:\n\n` +
                     `ðŸ“Ž Upload your GST Certificate PDF for instant verification\n` +
                     `OR\n` +
                     `ðŸ’¬ Reply "No GST" to proceed without GST billing\n\n` +
                     `(You can always add GST details later from your profile)`;
            
            suggestedActions = [
                { action: 'upload_certificate', label: 'Upload PDF' },
                { action: 'skip_gst', label: 'Continue without GST' }
            ];
            
        } else {
            // Third+ attempt - suggest moving forward
            message = `I understand GST verification is challenging right now.\n\n` +
                     `Let's move forward - you can:\n` +
                     `â€¢ Continue your order without GST (add it later)\n` +
                     `â€¢ Contact our support team for manual verification\n\n` +
                     `Reply "Continue" to proceed with your order.`;
            
            suggestedActions = [
                { action: 'skip_gst', label: 'Continue without GST' },
                { action: 'contact_support', label: 'Contact support' }
            ];
        }
        
        return {
            success: true,
            message,
            suggestedActions,
            nextState: wasCheckingOut ? 'AWAITING_GST_RECOVERY' : 'AWAITING_GST',
            retryCount: retryCount + 1
        };
    }
    
    /**
     * Handle product search errors
     */
    async recoverFromProductSearchError(context, retryCount, recentContext) {
        const { userInput, errorDetails } = context;
        
        let message;
        let suggestedActions = [];
        
        if (retryCount === 0) {
            message = `ðŸ” I couldn't find "${userInput}" in our catalog.\n\n`;
            
            // Check if we have similar products
            if (errorDetails?.similarProducts && errorDetails.similarProducts.length > 0) {
                message += `Did you mean one of these?\n`;
                errorDetails.similarProducts.slice(0, 3).forEach((p, i) => {
                    message += `${i + 1}. ${p.name} - â‚¹${p.price}\n`;
                });
                message += `\nReply with the number or product name.`;
                suggestedActions = errorDetails.similarProducts.map(p => ({
                    action: 'select_product',
                    productId: p.id,
                    label: p.name
                }));
            } else {
                message += `Try:\n` +
                          `â€¢ Checking the spelling\n` +
                          `â€¢ Using a shorter name (e.g., "Paper Cup" instead of "Disposable Paper Cup 200ml")\n` +
                          `â€¢ Browsing our catalog by replying "show products"`;
                suggestedActions = [
                    { action: 'show_catalog', label: 'Browse all products' },
                    { action: 'search_by_category', label: 'Search by category' }
                ];
            }
        } else {
            message = `I'm still having trouble finding that product.\n\n` +
                     `Let me help you browse:\n` +
                     `â€¢ Reply "catalog" to see all products\n` +
                     `â€¢ Reply "categories" to browse by category\n` +
                     `â€¢ Or tell me what you're looking for and I'll search differently`;
            
            suggestedActions = [
                { action: 'show_catalog', label: 'Show catalog' },
                { action: 'show_categories', label: 'Show categories' }
            ];
        }
        
        return {
            success: true,
            message,
            suggestedActions,
            nextState: 'AWAITING_PRODUCT_SELECTION',
            retryCount: retryCount + 1
        };
    }
    
    /**
     * Handle checkout errors
     */
    async recoverFromCheckoutError(context, retryCount, recentContext) {
        const { errorDetails } = context;
        
        let message = `âŒ Checkout Issue\n\n`;
        
        if (errorDetails?.missingInfo) {
            message += `I need a few more details to complete your order:\n`;
            const missing = errorDetails.missingInfo;
            if (missing.includes('gst')) message += `â€¢ GST details (or reply "No GST")\n`;
            if (missing.includes('address')) message += `â€¢ Delivery address\n`;
            if (missing.includes('contact')) message += `â€¢ Contact information\n`;
            message += `\nLet's complete these one by one. `;
            
            if (missing.includes('gst')) {
                message += `First, do you need GST billing? Reply "Yes" or "No".`;
            } else if (missing.includes('address')) {
                message += `Please share your delivery address.`;
            }
        } else if (errorDetails?.emptyCart) {
            message += `Your cart is empty. Would you like to:\n` +
                      `1. Browse our products\n` +
                      `2. Search for something specific\n` +
                      `3. See your previous orders`;
        } else {
            message += `${errorDetails?.reason || 'Something went wrong during checkout.'}\n\n` +
                      `Don't worry - your cart is saved. Would you like to:\n` +
                      `1. Try again\n` +
                      `2. Review your cart\n` +
                      `3. Continue shopping`;
        }
        
        return {
            success: true,
            message,
            suggestedActions: [
                { action: 'retry_checkout', label: 'Try checkout again' },
                { action: 'view_cart', label: 'Review cart' }
            ],
            nextState: 'AWAITING_CHECKOUT_RECOVERY',
            retryCount: retryCount + 1
        };
    }
    
    /**
     * Handle cart update errors
     */
    async recoverFromCartError(context, retryCount, recentContext) {
        const { userInput, errorDetails } = context;
        
        let message = `I had trouble updating your cart.\n\n`;
        
        if (errorDetails?.invalidQuantity) {
            message += `The quantity "${errorDetails.quantity}" doesn't look right.\n` +
                      `Please specify a number like "5" or "10 boxes".`;
        } else if (errorDetails?.stockIssue) {
            message += `We only have ${errorDetails.availableStock} units available.\n` +
                      `Would you like to add ${errorDetails.availableStock} instead?`;
        } else {
            message += `Let me try to help:\n` +
                      `â€¢ Reply "cart" to see what's in your cart\n` +
                      `â€¢ Tell me what you'd like to add or change\n` +
                      `â€¢ Or say "clear cart" to start fresh`;
        }
        
        return {
            success: true,
            message,
            suggestedActions: [
                { action: 'view_cart', label: 'View cart' },
                { action: 'retry_update', label: 'Try again' }
            ],
            nextState: 'AWAITING_CART_ACTION',
            retryCount: retryCount + 1
        };
    }
    
    /**
     * Handle API/system failures
     */
    async recoverFromAPIError(context, retryCount, recentContext) {
        const { errorDetails } = context;
        
        let message;
        
        if (retryCount === 0) {
            message = `â³ One moment please...\n\n` +
                     `I'm experiencing a brief technical delay. ` +
                     `Let me try that again for you.`;
        } else if (retryCount === 1) {
            message = `I'm still having trouble connecting to our system.\n\n` +
                     `Your data is safe. This usually resolves quickly.\n\n` +
                     `Would you like to:\n` +
                     `1. Try again in a moment\n` +
                     `2. Continue with something else\n` +
                     `3. Save your progress and return later`;
        } else {
            message = `ðŸ”§ System Issue\n\n` +
                     `Our system is experiencing issues right now. ` +
                     `Your cart and data are saved.\n\n` +
                     `You can:\n` +
                     `â€¢ Try again in 5-10 minutes\n` +
                     `â€¢ Contact our support team directly\n` +
                     `â€¢ I'll notify you when systems are back\n\n` +
                     `We apologize for the inconvenience!`;
        }
        
        return {
            success: true,
            message,
            suggestedActions: [
                { action: 'retry', label: 'Try again' },
                { action: 'contact_support', label: 'Contact support' }
            ],
            nextState: 'AWAITING_RETRY',
            retryCount: retryCount + 1,
            autoRetry: retryCount < 2
        };
    }
    
    /**
     * Handle generic errors
     */
    async recoverFromGenericError(context, retryCount, recentContext) {
        const { errorDetails } = context;
        
        const messages = [
            `Hmm, something didn't work as expected. Let me help you continue.`,
            `I ran into a small issue. Don't worry, let's figure this out together.`,
            `That didn't go quite right. Let me try a different approach.`
        ];
        
        const message = messages[Math.min(retryCount, messages.length - 1)] + `\n\n` +
                       `What were you trying to do? I'll help you complete it.`;
        
        return {
            success: true,
            message,
            suggestedActions: [
                { action: 'explain', label: 'Explain what happened' },
                { action: 'start_over', label: 'Start fresh' }
            ],
            nextState: 'AWAITING_CLARIFICATION',
            retryCount: retryCount + 1
        };
    }
    
    /**
     * Get retry count for specific error type in this conversation
     */
    async getRetryCount(conversationId, errorType) {
        try {
            const { data, error } = await dbClient
                .from('error_recovery_log')
                .select('retry_count')
                .eq('conversation_id', conversationId)
                .eq('error_type', errorType)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();
            
            if (error || !data) return 0;
            return data.retry_count || 0;
        } catch (err) {
            console.error('[ErrorRecovery] Failed to get retry count:', err);
            return 0;
        }
    }
    
    /**
     * Save recovery attempt for analytics
     */
    async saveRecoveryAttempt(conversationId, errorType, recovery) {
        try {
            await dbClient
                .from('error_recovery_log')
                .insert({
                    conversation_id: conversationId,
                    error_type: errorType,
                    retry_count: recovery.retryCount,
                    recovery_message: recovery.message,
                    suggested_actions: recovery.suggestedActions,
                    created_at: new Date().toISOString()
                });
        } catch (err) {
            // Don't fail if logging fails
            console.error('[ErrorRecovery] Failed to log recovery:', err);
        }
    }
}

module.exports = new ErrorRecoveryService();

