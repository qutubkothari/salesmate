// services/orderIntegrationService.js - Complete Order Integration
const enhancedOrderProcessor = require('./enhancedOrderProcessingWithZoho');
const { extractOrderDetails } = require('./orderProcessingService');

class OrderIntegrationService {
    
    /**
     * Complete order processing with Zoho integration
     */
    async processCompleteOrder(tenantId, phoneNumber, userQuery, conversation) {
        try {
            console.log('[ORDER_INTEGRATION] Starting complete order process');
            
            // Step 1: Extract order details
            const orderDetails = await extractOrderDetails(userQuery, tenantId);
            
            // **DEBUG: Unit detection validation**
            if (orderDetails) {
                console.log('[UNIT_DEBUG] Original query:', userQuery);
                console.log('[UNIT_DEBUG] Detected unit:', orderDetails.unit || 'undefined');
                console.log('[UNIT_DEBUG] Is pieces:', orderDetails.isPieces || false);
                if (orderDetails.orders) {
                    orderDetails.orders.forEach((order, idx) => {
                        console.log(`[UNIT_DEBUG] Order ${idx + 1}:`, order.productCode, 'Qty:', order.quantity, 'Unit:', order.unit, 'IsPieces:', order.isPieces);
                    });
                }
            }
            
            if (!orderDetails) {
                return { success: false, message: 'Could not extract order details' };
            }

            // Step 2: Process with Zoho integration
            const result = await enhancedOrderProcessor.processOrderWithZohoSync(
                tenantId, 
                phoneNumber, 
                orderDetails
            );

            if (result.success) {
                // Step 3: Update conversation state
                if (conversation) {
                    await this.updateConversationState(conversation, orderDetails, result);
                }

                // Step 4: Send confirmation
                await this.sendOrderConfirmation(phoneNumber, result, tenantId);

                return {
                    success: true,
                    orderId: result.orderId,
                    zohoOrderId: result.zohoOrderId,
                    message: result.message,
                    type: 'order_processed_with_zoho'
                };
            } else {
                return {
                    success: false,
                    message: result.message || 'Order processing failed',
                    type: 'order_processing_error'
                };
            }

        } catch (error) {
            console.error('[ORDER_INTEGRATION] Error:', error);
            return {
                success: false,
                message: 'An error occurred while processing your order. Please try again.',
                type: 'order_integration_error'
            };
        }
    }

    async updateConversationState(conversation, orderDetails, result) {
        const { dbClient } = require('./config');
        
        let lastProductDiscussed;
        if (result.isMultipleProducts) {
            lastProductDiscussed = `${result.products.length} products: ${result.products.map(p => p.name).join(', ')}`;
        } else if (orderDetails.items && orderDetails.items.length > 0) {
            lastProductDiscussed = orderDetails.items[0].name;
        }

        await dbClient
            .from('conversations_new')
            .update({ 
                state: result.isMultipleProducts ? 'multi_product_order_discussion' : 'order_discussion',
                last_product_discussed: lastProductDiscussed,
                last_order_id: result.orderId,
                zoho_order_id: result.zohoOrderId
            })
            .eq('id', conversation.id);
    }

    async sendOrderConfirmation(phoneNumber, result, tenantId) {
        const { sendMessage, logMessage } = require('./whatsappService');
        const { logMessage: historyLog } = require('./historyService');

        try {
            await sendMessage(phoneNumber, result.message);
            await historyLog(tenantId, phoneNumber, 'bot', result.message, 'order_confirmation');

            // Send cart view
            const { viewCartWithDiscounts } = require('./cartService');
            const cartView = await viewCartWithDiscounts(tenantId, phoneNumber);
            await sendMessage(phoneNumber, cartView);
            await historyLog(tenantId, phoneNumber, 'bot', cartView, 'cart_confirmation');
        } catch (error) {
            console.error('[ORDER_INTEGRATION] Error sending confirmation:', error);
        }
    }
}

module.exports = new OrderIntegrationService();


