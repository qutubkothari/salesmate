/**
 * Calculate pricing breakdown with GST
 * @param {number} priceBeforeTax - Unit price BEFORE tax (as stored in products table)
 * @param {number} quantity - Quantity ordered
 * @returns {object} Pricing breakdown
 */
function calculatePricingBreakdown(priceBeforeTax, quantity) {
    const gstRate = 18; // 18% GST
    const unitPriceBeforeTax = parseFloat(priceBeforeTax);
    // Calculate price with tax per unit
    const priceWithTax = unitPriceBeforeTax * (1 + gstRate / 100);
    // Calculate GST amount for total quantity
    const gstAmount = unitPriceBeforeTax * (gstRate / 100) * quantity;
    // Total price for all units including GST
    const totalPriceWithTax = priceWithTax * quantity;
    
    return {
        price_at_time_of_purchase: totalPriceWithTax.toFixed(2),
        unit_price_before_tax: unitPriceBeforeTax.toFixed(2),
        gst_rate: gstRate,
        gst_amount: gstAmount.toFixed(2)
    };
}

/**
 * Create order_items with pricing breakdown
 */
async function createOrderItemsWithPricing(orderId, cartItems, dbClient) {
    const orderItemsData = cartItems.map(item => {
        const pricing = calculatePricingBreakdown(
            item.product.price,
            item.quantity
        );
        return {
            order_id: orderId,
            product_id: item.product_id,
            quantity: item.quantity,
            ...pricing,
            zoho_item_id: null // Will be filled by Zoho sync later
        };
    });
    const { data, error } = await dbClient
        .from('order_items')
        .insert(orderItemsData)
        .select();
    if (error) {
        console.error('[ORDER_PROCESSING] Error creating order items:', error);
        throw error;
    }
    return data;
}
// services/orderProcessingService.js - FIXED VERSION with Working Multi-Product Support
const { dbClient } = require('./config');
const { findProductByNameOrCode } = require('./enhancedProductService');

// Utility: Strip greeting/polite prefixes so regex matches cleanly
const preclean = (q) => {
  if (!q) return '';
  return q
    .trim()
    .replace(/^(hello|hey|hi|dear)\b[^\w]*/i, '')
    .replace(/^(i\s+need|i\s+want|pls|please|mujhe)\b[^\w]*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
};

/**
 * Extract order details from user message
 * Handles patterns like "8x80 - 36 ctns" or "NFF 8x80 - 36 cartons"
 */
const extractOrderDetails = async (userQuery, tenantId) => {
    try {
        const q = preclean(userQuery);
        console.log('[ORDER_EXTRACT] Processing query:', q);
        
        // Primary pattern: "8x80 -36ctns" or "8x80 - 36 ctns"
        const primaryPattern = /(\d+x\d+)\s*-\s*(\d+)\s*c(?:artons?|tns?)|\s*-\s*(\d+)c(?:artons?|tns?)/i;
        let primaryMatch = q.match(primaryPattern);
        if (!primaryMatch) {
            // Try matching with no space between dash and number
            primaryMatch = q.match(/(\d+x\d+)\s*-(\d+)c(?:artons?|tns?)/i);
        }
        if (primaryMatch) {
            const productCode = primaryMatch[1];
            // Support both match groups
            const quantity = parseInt(primaryMatch[2] || primaryMatch[3]);
            
            console.log('[ORDER_EXTRACT] Primary pattern matched:', productCode, quantity, 'cartons');
            
            return {
                productName: `NFF ${productCode}`,
                productCode: productCode,
                quantity: quantity,
                unit: 'carton',
                originalText: primaryMatch[0]
            };
        }
        
        // Secondary pattern: "NFF 8x80 -36ctns" or "NFF 8x80 - 36 ctns"
        const nffPattern = /nff\s*(\d+x\d+)\s*-\s*(\d+)\s*c(?:artons?|tns?)|nff\s*(\d+x\d+)\s*-(\d+)c(?:artons?|tns?)/i;
        let nffMatch = q.match(nffPattern);
        if (!nffMatch) {
            nffMatch = q.match(/nff\s*(\d+x\d+)\s*-(\d+)c(?:artons?|tns?)/i);
        }
        if (nffMatch) {
            const productCode = nffMatch[1] || nffMatch[3];
            const quantity = parseInt(nffMatch[2] || nffMatch[4]);
            
            console.log('[ORDER_EXTRACT] NFF pattern matched:', productCode, quantity, 'cartons');
            
            return {
                productName: `NFF ${productCode}`,
                productCode: productCode,
                quantity: quantity,
                unit: 'carton',
                originalText: nffMatch[0]
            };
        }
        
        // Tertiary pattern: "36 ctns of 8x80"
        const reversePattern = /(\d+)\s*c(?:artons?|tns?)\s*(?:of\s*)?(\d+x\d+)/i;
        const reverseMatch = q.match(reversePattern);
        
        if (reverseMatch) {
            const quantity = parseInt(reverseMatch[1]);
            const productCode = reverseMatch[2];
            
            console.log('[ORDER_EXTRACT] Reverse pattern matched:', productCode, quantity, 'cartons');
            
            return {
                productName: `NFF ${productCode}`,
                productCode: productCode,
                quantity: quantity,
                unit: 'carton',
                originalText: reverseMatch[0]
            };
        }
        
        console.log('[ORDER_EXTRACT] No order pattern found in query');
        return null;
        
    } catch (error) {
        console.error('[ORDER_EXTRACT] Error:', error);
        return null;
    }
};

/**
 * Extract multiple products from a single message
 * Handles "8x80 - 36 ctns and 8x100 - 4 ctns"
 */
const extractMultipleOrderDetails = async (userQuery, tenantId) => {
  try {
    const q = preclean(userQuery);
    console.log('[MULTI_ORDER] Processing query:', q);

    // Normalize separators to a single delimiter for easier scanning
    const normalized = q.replace(/\s*(?:and|&|\/|\+)\s*/gi, ', ');

    // Global matcher for (code, qty) regardless of whether a dash/colon/space is used
    // Captures: 8x80 - 36 ctns | 8x80: 36 cartons | 8x80 36 ctns
    const pairRe = /(\d+\s*[x*]\s*\d+)\s*(?:-|:)?\s*(\d+)\s*(?:c(?:artons?|tns?)\b)/gi;

    const seen = new Set();
    const products = [];

    let m;
    while ((m = pairRe.exec(normalized)) !== null) {
      const rawCode = m[1].replace(/\s*/g, '').replace('*', 'x'); // "8x80"
      const qty = parseInt(m[2], 10);
      if (!rawCode || !qty || qty <= 0) continue;
      if (seen.has(rawCode)) continue;

      // Validate against catalog before accepting
      const prod = await findProductByNameOrCode(tenantId, rawCode);
      if (!prod) {
        console.log('[MULTI_ORDER] Skipping unknown code:', rawCode);
        continue;
      }

      products.push({
        productName: prod.name || `NFF ${rawCode}`,
        productCode: rawCode,
        quantity: qty,
        unit: 'carton'
      });
      seen.add(rawCode);
    }

    if (products.length > 1) {
      console.log('[MULTI_ORDER] Found multiple products:', products);
      return { success: true, products, isMultipleProducts: true };
    }

    // Fallback: reuse single extractor if only one pair present
    const singleOrder = await extractOrderDetails(q, tenantId);
    
    // **DEBUG: Unit detection validation**
    if (singleOrder) {
        console.log('[UNIT_DEBUG] Original query:', q);
        console.log('[UNIT_DEBUG] Detected unit:', singleOrder.unit || 'undefined');
        console.log('[UNIT_DEBUG] Is pieces:', singleOrder.isPieces || false);
        if (singleOrder.orders) {
            singleOrder.orders.forEach((order, idx) => {
                console.log(`[UNIT_DEBUG] Order ${idx + 1}:`, order.productCode, 'Qty:', order.quantity, 'Unit:', order.unit, 'IsPieces:', order.isPieces);
            });
        }
    }
    
    if (singleOrder) {
      return { success: true, products: [singleOrder], isMultipleProducts: false };
    }

    console.log('[MULTI_ORDER] No order pattern found in query');
    return null;

  } catch (error) {
    console.error('[MULTI_ORDER] Error:', error);
    return null;
  }
};

/**
 * FIXED: Process a single order request
 */
const processOrderRequestEnhanced = async (tenantId, from, orderDetails) => {
    try {
        console.log('[ORDER_PROCESS] Processing single order:', orderDetails);
        
        if (!orderDetails || !orderDetails.productCode) {
            return {
                success: false,
                message: "Invalid order details provided."
            };
        }
        
        // CRITICAL FIX: Check if this is an ADDITIONAL product (don't clear cart)
        const isAdditionalProduct = orderDetails.isAdditionalProduct === true;
        
        if (!isAdditionalProduct) {
            // Only clear cart for NEW orders (not additional products)
            console.log('[ORDER_PROCESS] Clearing existing cart before adding new order...');
            const { getConversationId } = require('./historyService');
            const conversationId = await getConversationId(tenantId, from);
            
            if (conversationId) {
                const { data: existingCart } = await dbClient
                    .from('carts')
                    .select('id')
                    .eq('conversation_id', conversationId)
                    .single();
                
                if (existingCart) {
                    // Delete all existing cart items
                    const { error: deleteError } = await dbClient
                        .from('cart_items')
                        .delete()
                        .eq('cart_id', existingCart.id);
                    
                    if (deleteError) {
                        console.warn('[ORDER_PROCESS] Error clearing cart:', deleteError.message);
                    } else {
                        console.log('[ORDER_PROCESS] Successfully cleared existing cart items');
                    }
                }
            }
        } else {
            console.log('[ORDER_PROCESS] Additional product - keeping existing cart items');
        }
        
        // Use the carton-aware cart function
        const { addCartonProductToCart } = require('./cartonPricingService');
        
        const result = await addCartonProductToCart(
            tenantId, 
            from, 
            orderDetails.productName,  // Use full product name for robust lookup
            orderDetails.quantity,     // 36
            orderDetails.unit || 'carton' // Pass unit for correct conversion
        );
        
        console.log('[ORDER_PROCESS] Carton cart result:', result);
        
        const isSuccess = result && !result.includes('not found') && !result.includes('error');
        
        return {
            success: isSuccess,
            message: result || "Order processing completed",
            product: {
                name: orderDetails.productName,
                code: orderDetails.productCode,
                quantity: orderDetails.quantity
            }
        };
        
    } catch (error) {
        console.error('[ORDER_PROCESS] Error:', error);
        return {
            success: false,
            message: "Sorry, there was an error processing your order. Please try again."
        };
    }
};

/**
 * FIXED: Process multiple products using atomic cart operations (from working backup)
 */
const processMultipleOrderRequest = async (tenantId, from, orderDetails) => {
    try {
        console.log('[MULTI_PROCESS_FIXED] Processing multiple orders:', orderDetails.products?.length || 0);
        
        if (!orderDetails.products || orderDetails.products.length === 0) {
            return {
                success: false,
                message: "No products found in your order request."
            };
        }

        // Get conversation ID
        const { getConversationId } = require('./historyService');
        const conversationId = await getConversationId(tenantId, from);
        if (!conversationId) {
            return {
                success: false,
                message: "Could not identify your conversation."
            };
        }

        // CRITICAL FIX: Clear cart before adding new order to prevent accumulation
        console.log('[MULTI_PROCESS_FIXED] Clearing existing cart before adding new order...');
        const { data: existingCart } = await dbClient
            .from('carts')
            .select('id')
            .eq('conversation_id', conversationId)
            .single();
        
        if (existingCart) {
            // Delete all existing cart items
            const { error: deleteError } = await dbClient
                .from('cart_items')
                .delete()
                .eq('cart_id', existingCart.id);
            
            if (deleteError) {
                console.warn('[MULTI_PROCESS_FIXED] Error clearing cart:', deleteError.message);
            } else {
                console.log('[MULTI_PROCESS_FIXED] Successfully cleared existing cart items');
            }
        }

        // Get or create cart
        // Use addCartonProductToCart for each product, passing quantity and unit
        const { addCartonProductToCart } = require('./cartonPricingService');
        let allResults = [];
        let productCount = 0;
        let responseMessage = 'âœ… **Added to Cart** (multi-product)\n\n';

        for (let i = 0; i < orderDetails.products.length; i++) {
            const order = orderDetails.products[i];
            console.log('[MULTI_PROCESS_FIXED] Processing product', i + 1, ':', order.productCode, order.quantity, order.unit);
            const resultMsg = await addCartonProductToCart(tenantId, from, order.productCode, order.quantity, order.unit);
            if (resultMsg && !resultMsg.startsWith('Sorry') && !resultMsg.startsWith('An error')) {
                productCount++;
                allResults.push({
                    product: order.productCode,
                    quantity: order.quantity,
                    unit: order.unit,
                    message: resultMsg
                });
            }
        }

        if (productCount === 0) {
            return {
                success: false,
                message: 'Could not add any products to cart. Please check product names and try again.'
            };
        }

        // Update cart timestamp once
        await dbClient
            .from('carts')
            .update({ updated_at: new Date().toISOString() })
            .eq('conversation_id', conversationId);

        // Build response message
        allResults.forEach((result, index) => {
            responseMessage += `${index + 1}. ${result.message}\n\n`;
        });
        responseMessage += `Ready to checkout? Reply "yes go ahead" or type /checkout`;

        return {
            success: true,
            message: responseMessage,
        };
        
    } catch (error) {
        console.error('[MULTI_PROCESS_FIXED] Error:', error);
        return {
            success: false,
            message: "Sorry, there was an error processing your multiple product order. Please try again."
        };
    }
};

/**
 * FIXED: Add or update cart item atomically (from working backup)
 */
const addOrUpdateCartItem = async (cartId, productId, quantity) => {
    try {
        console.log('[CART_ITEM] Adding/updating cart item:', { cartId, productId, quantity });
        
        // Try to find existing item
        const { data: existing, error: findError } = await dbClient
            .from('cart_items')
            .select('id, quantity')
            .eq('cart_id', cartId)
            .eq('product_id', productId)
            .single();

        if (findError && findError.code !== 'PGRST116') {
            console.warn('[CART_ITEM] Find error:', findError);
        }

        if (existing && existing.id) {
            // Update existing item
            const newQty = Number(existing.quantity) + Number(quantity);
            const { error: updateError } = await dbClient
                .from('cart_items')
                .update({ quantity: newQty })
                .eq('id', existing.id);

            if (updateError) {
                console.error('[CART_ITEM] Update error:', updateError);
                return { success: false, error: updateError.message };
            }
            
            console.log('[CART_ITEM] Updated existing item to quantity:', newQty);
            return { success: true, itemId: existing.id, quantity: newQty };
        } else {
            // Insert new item
            const { data: inserted, error: insertError } = await dbClient
                .from('cart_items')
                .insert({ 
                    cart_id: cartId, 
                    product_id: productId, 
                    quantity: quantity 
                });
            if (insertError) {
                console.error('[CART_ITEM] Insert error:', insertError);
                return { success: false, error: insertError.message };
            }
            console.log('[CART_ITEM] Inserted new item:', inserted && inserted[0]);
            return { success: true, itemId: inserted && inserted[0]?.id, quantity };
        }
    } catch (error) {
        console.error('[CART_ITEM] Error:', error);
        return { success: false, error: error.message };
    }
};

// Export all functions
module.exports = {
    extractOrderDetails,
    extractMultipleOrderDetails,
    processOrderRequestEnhanced,
    processMultipleOrderRequest,
    addOrUpdateCartItem,
    calculatePricingBreakdown,
    createOrderItemsWithPricing
};
