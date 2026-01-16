// =============================================
// FILE: services/discountNegotiationService_v2.js
// UPGRADED VERSION - Uses AI instead of regex
// =============================================

const { dbClient } = require('./config');
const { 
    detectDiscountIntent, 
    extractDiscountRequestDetails, 
    generateDiscountResponse 
} = require('./aiDiscountUnderstanding');

/**
 * UPGRADED: AI-powered discount negotiation handler
 * Replaces regex-based isDiscountNegotiation() with AI understanding
 */
async function handleDiscountNegotiationV2(tenantId, phoneNumber, message, conversationContext = null) {
    try {
    console.log('[DISCOUNT_V2] Starting AI-powered discount negotiation');
        
        // Step 1: Use AI to detect discount intent (replaces isDiscountNegotiation)
        const intentResult = await detectDiscountIntent(message, {
            hasQuotedProducts: conversationContext?.quotedProducts?.length > 0,
            inCartDiscussion: conversationContext?.state === 'in_cart',
            previousDiscountOffered: conversationContext?.lastDiscountOffered
        });
        
        // If not a discount request, return null (let other handlers process)
        if (!intentResult.isDiscountRequest || intentResult.confidence < 0.6) {
            return null;
        }

        // Step 2: Get cart information FIRST (needed for context-aware AI extraction)
        // CRITICAL FIX: Cart table only has conversation_id column, not tenant_id, status, or customer_phone
        // We must get conversation_id first from historyService
        const { getConversationId } = require('./historyService');
        const conversationId = conversationContext?.id || await getConversationId(tenantId, phoneNumber);
        
        let cart = null;
        let cartError = null;
        
        if (conversationId) {
            const cartResult = await dbClient
                .from('carts')
                .select(`
                    *,
                    cart_items (
                        *,
                        product:products (
                            id,
                            name,
                            price,
                            unit,
                            units_per_carton,
                            category
                        )
                    )
                `)
                .eq('conversation_id', conversationId)
                .maybeSingle();
            
            cart = cartResult.data;
            cartError = cartResult.error;
        } else {
            cartError = new Error('No conversation found');
        }

        // Step 3: Extract details using AI (with cart context)
        const cartItemsForContext = cart?.cart_items?.map(item => ({
            productCode: item.product?.name?.match(/\d+x\d+/)?.[0] || null,
            productName: item.product?.name || '',
            quantity: item.quantity,
            unit: 'carton'
        })) || [];

        const extractedDetails = await extractDiscountRequestDetails(
            message,
            conversationContext?.quotedProducts || [],
            cartItemsForContext
        );

        if (cartError || !cart) {
            // If AI extracted products, add them to cart and immediately calculate discount
            if (extractedDetails.products.length > 0) {
                // Calculate total value and quantity
                const totalValue = extractedDetails.products.reduce((sum, p) => {
                    return sum + ((parseFloat(p.price) || 0) * (parseInt(p.quantity) || 1));
                }, 0);
                const totalCartons = extractedDetails.products.reduce((sum, p) => sum + (parseInt(p.quantity) || 1), 0);
                
                // Get dashboard discount rules (ONLY source of discount now)
                let maxAllowedDiscount = 0;
                // Create a baseline orderData from AI-extracted details so preview always has values
                let orderData = {
                    items: extractedDetails.products.map(p => ({
                        product_id: p.productId || null,
                        productName: p.productName || p.productCode || null,
                        product_code: p.productCode || null,
                        category: p.category || null,
                        quantity: parseInt(p.quantity, 10) || 1,
                        price: parseFloat(p.price) || 0,
                        units_per_carton: p.unitsPerCarton || 1
                    })),
                    totalAmount: 0,
                    quantity: totalCartons,
                    customerProfile: null
                };
                orderData.totalAmount = orderData.items.reduce((sum, it) => sum + ((it.price || 0) * (it.quantity || 0)), 0);
                try {
                    // Enrich extracted products by looking up product records so we can populate
                    // product_id, category and price (dashboard rules match on category/product ids)
                    const productCodes = extractedDetails.products.map(p => p.productCode).filter(Boolean);
                    let productMap = {};
                    if (productCodes.length > 0) {
                        // Search by name pattern since product_code column doesn't exist
                        try {
                            const orExpr = productCodes.map(c => `name.ilike.%${c}%`).join(',');
                            const { data: productsByName, error: nameErr } = await dbClient
                                .from('products')
                                .select('id, name, category, price, units_per_carton')
                                .or(orExpr);
                            if (nameErr) {
                                console.warn('[DISCOUNT_V2] Error looking up products by name:', nameErr.message || nameErr);
                            } else if (productsByName && productsByName.length > 0) {
                                productMap = {};
                                productsByName.forEach(pr => {
                                    if (pr.name) productMap[pr.name] = pr;
                                    // Extract code like 8x80 from name and map it
                                    const codeMatch = String(pr.name || '').match(/\d+x\d+/);
                                    if (codeMatch) productMap[codeMatch[0]] = pr;
                                });
                            }
                        } catch (lookupErr) {
                            console.warn('[DISCOUNT_V2] Product lookup failed:', lookupErr.message || lookupErr);
                        }
                    }
                    // If productMap is empty, try per-code name lookups as a last resort
                    if ((!productMap || Object.keys(productMap).length === 0) && productCodes.length > 0) {
                        for (const code of productCodes) {
                            try {
                                const { data: rows, error: rErr } = await dbClient
                                    .from('products')
                                    .select('id, name, category, price, units_per_carton')
                                    .ilike('name', `%${code}%`)
                                    .limit(1);
                                if (rErr) {
                                    console.warn('[DISCOUNT_V2] per-code lookup error for', code, rErr.message || rErr);
                                    continue;
                                }
                                if (rows && rows.length > 0) {
                                    const pr = rows[0];
                                    const codeMatch = String(pr.name || '').match(/\d+x\d+/);
                                    if (codeMatch) productMap[codeMatch[0]] = pr;
                                    productMap[pr.name] = pr;
                                }
                            } catch (e) {
                                console.warn('[DISCOUNT_V2] per-code lookup exception for', code, e.message || e);
                            }
                        }
                        // finished per-code lookups
                    }

                    const discountCalculationService = require('./discountCalculationService');
                    orderData = {
                        items: extractedDetails.products.map(p => {
                            const prod = productMap[p.productCode] || {};
                            return {
                                product_id: prod.id || p.productId || null,
                                productName: prod.name || p.productName || p.productCode || null,
                                product_code: p.productCode || (prod && String(prod.name || '').match(/\d+x\d+/)?.[0]) || null,
                                category: prod.category || p.category || null,
                                quantity: parseInt(p.quantity, 10) || 1,
                                price: parseFloat(p.price) || prod.price || 0,
                                units_per_carton: prod.units_per_carton || p.unitsPerCarton || null
                            };
                        }),
                        totalAmount: 0, // will compute from enriched items below
                        quantity: totalCartons,
                        customerProfile: null
                    };

                    // Recompute totalAmount using enriched product prices (prod.price)
                    orderData.totalAmount = orderData.items.reduce((sum, it) => sum + ((it.price || 0) * (it.quantity || 0)), 0);

                    const applicableDiscounts = await discountCalculationService.findApplicableDiscounts(tenantId, orderData);
                    if (applicableDiscounts && applicableDiscounts.length > 0) {
                        maxAllowedDiscount = Math.max(...applicableDiscounts.map(rule => rule.discount_value));
                    } else {
                        // no applicable discounts
                    }
                } catch (error) {
                    console.warn('[DISCOUNT_V2] Error fetching discount rules:', error.message);
                }
                
                // Discount is ONLY what dashboard rules allow
                const offeredDiscount = maxAllowedDiscount;
                // Build WhatsApp preview for extracted products with explicit discount and price breakdown
                // Build preview string from enriched orderData items to ensure numeric prices
                const productsStr = orderData.items
                    .map(it => {
                        const qty = it.quantity || 1;
                        const unit = it.unit || 'carton';
                        const price = it.price || 0;
                        const discountedPrice = Math.round(price * (1 - offeredDiscount / 100));
                        const unitsPerCarton = it.units_per_carton || 1;
                        const perPiecePrice = unitsPerCarton > 1 ? (discountedPrice / unitsPerCarton).toFixed(2) : discountedPrice;
                        const label = it.productName || it.product_code || 'Product';
                        return `📦 ${label} × ${qty} ${unit}${qty !== 1 ? 's' : ''}\n✨ Your Special Price:\n🔹 ₹${perPiecePrice}/pc per piece\n📦 ₹${discountedPrice}.00/${unit}\n   (${unitsPerCarton} pcs/${unit})`;
                    })
                    .join('\n\n');
                // WhatsApp preview for discount offer
                const discountOffer = `I can offer you ${offeredDiscount}% discount:\n${productsStr}\n\nDoes that work for you?`;
                return {
                    response: discountOffer,
                    discountPercent: offeredDiscount,
                    offeredDiscount,
                    shouldAddToCart: true,
                    products: extractedDetails.products,
                    nextAction: 'add_to_cart_then_discount'
                };
            }
            // If no products extracted but we have quoted products from context, use those
            if (conversationContext?.quotedProducts?.length > 0) {
                // ...existing code...
            }
            return {
                response: "I'd love to help with a discount! Could you tell me which products and how many cartons you're looking to order? 😊",
                nextAction: 'await_product_details'
            };
        }
        
        // Step 4: Calculate total cartons and get dashboard discount rules
        const totalCartons = cart.cart_items.reduce((sum, item) => sum + item.quantity, 0);

        // Get maximum allowed discount from discount rules dashboard (ONLY source now)
        let maxAllowedDiscount = 0;
        try {
            const discountCalculationService = require('./discountCalculationService');
            const orderData = {
                items: cart.cart_items.map(item => ({
                    product_id: item.product.id,
                    category: item.product.category,
                    quantity: item.quantity,
                    price: item.product.price
                })),
                totalAmount: cart.cart_items.reduce((sum, item) => sum + (item.quantity * item.product.price), 0),
                quantity: totalCartons,
                customerProfile: null
            };

            const applicableDiscounts = await discountCalculationService.findApplicableDiscounts(tenantId, orderData);
            if (applicableDiscounts && applicableDiscounts.length > 0) {
                maxAllowedDiscount = Math.max(...applicableDiscounts.map(rule => rule.discount_value));
            }
        } catch (error) {
            console.warn('[DISCOUNT_V2] Error fetching discount rules:', error.message);
        }

        // cart summary computed

        // Step 5: Check if customer is returning customer (has previous orders)
        const { data: previousOrders } = await dbClient
            .from('orders_new')
            .select('id, created_at, discount_amount')
            .eq('tenant_id', tenantId)
            .eq('customer_phone', phoneNumber)
            .eq('status', 'completed')
            .order('created_at', { ascending: false })
            .limit(1);

        const isReturningCustomer = previousOrders && previousOrders.length > 0;

        // Step 6: Discount is ONLY what dashboard rules allow (no volume slab logic)
        const offeredDiscount = maxAllowedDiscount;
        let shouldEscalate = false;

        // Check if customer requested more than dashboard allows
        if (intentResult.discountType === 'counter_offer' && extractedDetails.discountRequest?.value) {
            const requestedValue = extractedDetails.discountRequest.value;
            if (requestedValue > maxAllowedDiscount) {
                shouldEscalate = true; // Customer wants more than dashboard allows
            }
        }
        
        // Step 7: Build WhatsApp preview for cart items with discounted price
        const cartProductsStr = cart.cart_items.map(item => {
            const qty = item.quantity || 1;
            const unit = item.product?.unit || 'carton';
            const price = item.unit_price || 0;
            const discountedPrice = Math.round(price * (1 - offeredDiscount / 100));
            return `${item.product?.name} (${qty} ${unit}${qty !== 1 ? 's' : ''}) - ₹${discountedPrice} per ${unit}`;
        }).join(', ');

        // Step 8: Use AI to generate natural response
        const responseContext = {
            customerMessage: message,
            isReturningCustomer,
            totalCartons,
            products: cart.cart_items.map(item => {
                const price = item.unit_price || item.product?.price || 0;
                const discountedPrice = Math.round(price * (1 - offeredDiscount / 100));
                const unitsPerCarton = item.product?.units_per_carton || 1500;
                const pricePerPiece = unitsPerCarton > 0 ? (discountedPrice / unitsPerCarton).toFixed(2) : '0.00';
                
                // product pricing computed for responseContext
                
                return {
                    productCode: item.product?.name?.match(/\d+x\d+/)?.[0] || item.product?.name || 'UNKNOWN',
                    productName: item.product?.name || 'Product',
                    quantity: item.quantity,
                    price: price,
                    discountedPrice: discountedPrice,
                    unitsPerCarton: unitsPerCarton,
                    pricePerPiece: pricePerPiece
                };
            }),
            offeredDiscount,
            maxDiscount: maxAllowedDiscount, // Use dashboard-configured max, not hardcoded slab
            requestedDiscount: extractedDetails.discountRequest.value,
            conversationHistory: conversationContext?.recentMessages || []
        };

        const aiResponse = await generateDiscountResponse(responseContext);

    // AI response generated

        // Step 9: Store discount in context (not in cart table - handled by discount management system)
        // The discount will be applied automatically when cart is viewed/checked out

        // Step 10: Save discount negotiation state
        await dbClient
            .from('discount_negotiations')
            .insert({
                tenant_id: tenantId,
                customer_phone: phoneNumber,
                cart_id: cart?.id || null,
                customer_message: message,
                ai_intent_result: intentResult,
                ai_extracted_details: extractedDetails,
                offered_discount: offeredDiscount,
                max_discount: maxAllowedDiscount,
                discount_type: intentResult.discountType,
                ai_response_tone: aiResponse?.tone || null,
                should_escalate: shouldEscalate || (aiResponse && aiResponse.shouldEscalate),
                created_at: new Date().toISOString()
            });

        return {
            response: aiResponse.message || aiResponse || `Great! I can offer you ${offeredDiscount}% discount on ${cartProductsStr}! This has been applied to your cart. 😊`,
            discountOffered: offeredDiscount,
            offeredDiscount,
            discountPercent: offeredDiscount,
            maxDiscount: maxAllowedDiscount,
            shouldEscalate: shouldEscalate || (aiResponse && aiResponse.shouldEscalate),
            intentType: intentResult.discountType,
            confidence: intentResult.confidence,
            nextAction: 'await_confirmation'
        };
        
    } catch (error) {
        console.error('[DISCOUNT_V2] Error:', error);
        return {
            response: "I'd love to help with a discount! Let me check what I can offer for your order. 😊",
            error: error.message,
            nextAction: 'retry'
        };
    }
}

/**
 * Legacy wrapper for backward compatibility
 * Gradually migrate to handleDiscountNegotiationV2
 */
async function isDiscountNegotiationV2(message, conversationContext = {}) {
    const result = await detectDiscountIntent(message, conversationContext);
    return result.isDiscountRequest && result.confidence >= 0.6;
}

function isDiscountNegotiationLegacy(message) {
    if (!message) return false;
    const normalized = String(message).toLowerCase();
    const explicitPatterns = [
        /give\s*(?:me|us)?\s*(?:some|a)?\s*discount/i,
        /can\s*(?:you|i)\s*get\s*(?:a|some)?\s*discount/i,
        /discount\s*(?:do|mile?ga|chahiye|please|for)/i,
        /best\s+price/i,
        /final\s+price/i,
        /last\s+price/i,
        /kam\s+karo/i,
        /reduce\s+(?:the\s+)?price/i,
        /lower\s+(?:the\s+)?price/i
    ];
    if (explicitPatterns.some(pattern => pattern.test(normalized))) {
        return true;
    }
    const hasProductCode = /\d+[x*]\d+/i.test(normalized);
    return !hasProductCode && /discount|best price|final price|last price|kam karo|rate/i.test(normalized);
}

function extractQuantityFromMessageLegacy(message) {
    if (!message) return null;
    const lower = String(message).toLowerCase();
    const cartonMatch = lower.match(/(\d+)\s*(?:cartons?|ctns?)/i);
    if (cartonMatch) {
        return parseInt(cartonMatch[1], 10);
    }
    const quantityMatch = lower.match(/(?:need|want|ordering|order)\s+(\d+)/i);
    if (quantityMatch) {
        return parseInt(quantityMatch[1], 10);
    }
    return null;
}

module.exports = {
    handleDiscountNegotiationV2,
    handleDiscountNegotiation: handleDiscountNegotiationV2,
    isDiscountNegotiationV2,
    isDiscountNegotiation: isDiscountNegotiationLegacy,
    extractQuantityFromMessage: extractQuantityFromMessageLegacy
};


