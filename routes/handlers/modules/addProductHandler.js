// routes/handlers/modules/addProductHandler.js
// Handles ADD_PRODUCT intent - adds products directly to cart
// Extracted from customerHandler.BACKUP to restore broken functionality

const { extractOrderDetails } = require('../../../services/smartOrderExtractionService');
const { processOrderRequestEnhanced } = require('../../../services/orderProcessingService');
const { viewCartWithDiscounts } = require('../../../services/cartService');
const { sendMessage } = require('../../../services/whatsappService');
const { dbClient } = require('../../../services/config');

async function handleAddProduct(req, res, tenant, from, userQuery, intentResult, conversation) {
    console.log('[ADD_PRODUCT_HANDLER] Checking for ADD_PRODUCT or PRICE_INQUIRY intent');

    // Check if this is an ADD_PRODUCT or PRICE_INQUIRY intent with product code and quantity
    // Examples: "i need to place order for 8x80 10000pcs", "add 8x80 5 cartons", "8x80 10 ctns"
    const isAddingProduct = intentResult?.intent === 'ADD_PRODUCT';
    const isPriceInquiryWithQuantity = intentResult?.intent === 'PRICE_INQUIRY' &&
                                       /\d+[x*]\d+/i.test(userQuery) && // has product code
                                       /\d+\s*(?:ctns?|cartons?|pcs?|pieces?)/i.test(userQuery); // has quantity

    if (!isAddingProduct && !isPriceInquiryWithQuantity) {
        console.log('[ADD_PRODUCT_HANDLER] Not an ADD_PRODUCT or PRICE_INQUIRY with quantity intent');
        return null;
    }

    console.log('[ADD_PRODUCT_HANDLER] ADD_PRODUCT or PRICE_INQUIRY intent detected - extracting order details...');

    try {
        // Use AI to extract order details (handles typos, natural language, Hindi)
        const extractionResult = await extractOrderDetails(userQuery, tenant.id);

        console.log('[ADD_PRODUCT_HANDLER] Extraction result:', extractionResult ? JSON.stringify(extractionResult) : 'null');

        // extractOrderDetails returns: { productCode, productName, quantity, unit, ... }
        // OR for multi-product: { isMultipleProducts: true, orders: [...] }
        if (!extractionResult || (!extractionResult.productCode && (!extractionResult.orders || extractionResult.orders.length === 0))) {
            console.log('[ADD_PRODUCT_HANDLER] AI extraction failed or no products found');
            return null;
        }

        // Handle multi-product orders: Generate price quote instead of adding to cart
        if (extractionResult.isMultipleProducts && extractionResult.orders && extractionResult.orders.length > 1) {
            console.log('[ADD_PRODUCT_HANDLER] Multi-product order detected:', extractionResult.orders.length, 'products');
            console.log('[ADD_PRODUCT_HANDLER] Generating price quote for all products...');

            const { handleMultiProductPriceInquiry } = require('../../../services/smartResponseRouter');
            
            // Build query string for price inquiry handler
            const queryParts = extractionResult.orders.map(order => 
                `${order.productCode} ${order.quantity} ${order.unit}`
            ).join(', ');
            console.log('[ADD_PRODUCT_HANDLER] Query for price inquiry:', queryParts);
            
            // Generate quote for all products
            const quoteResult = await handleMultiProductPriceInquiry(queryParts, tenant.id, from);
            
            if (quoteResult && quoteResult.response) {
                // Store quoted products in conversation for later confirmation
                await dbClient
                    .from('conversations')
                    .update({
                        state: 'awaiting_order_confirmation',
                        last_quoted_products: JSON.stringify(quoteResult.quotedProducts || extractionResult.orders),
                        last_product_discussed: extractionResult.orders.map(o => o.productCode).join(', ')
                    })
                    .eq('tenant_id', tenant.id)
                    .eq('end_user_phone', from);

                console.log('[ADD_PRODUCT_HANDLER] Price quote generated, awaiting confirmation');

                return {
                    response: quoteResult.response,
                    source: 'multi_product_quote',
                    quotedProducts: quoteResult.quotedProducts
                };
            } else {
                console.error('[ADD_PRODUCT_HANDLER] Failed to generate price quote');
                return {
                    response: 'Sorry, I had trouble generating a price quote. Please try again.',
                    source: 'quote_error'
                };
            }
        }

        // Handle single product or first product from multi-product extraction
        const newProduct = extractionResult.productCode ? extractionResult : extractionResult.orders[0];
        const productCode = newProduct.productCode;
        const quantity = newProduct.quantity;
        const unit = newProduct.unit;

        console.log('[ADD_PRODUCT_HANDLER] AI extracted:', { productCode, quantity, unit });

        // FIRST: If there are quoted products in conversation, add them to cart
        let quotedProducts = [];
        if (conversation && conversation.last_quoted_products) {
            try {
                quotedProducts = typeof conversation.last_quoted_products === 'string'
                    ? JSON.parse(conversation.last_quoted_products)
                    : conversation.last_quoted_products;
                console.log('[ADD_PRODUCT_HANDLER] Found quoted products:', quotedProducts.length);
            } catch (e) {
                console.error('[ADD_PRODUCT_HANDLER] Failed to parse quoted products:', e.message);
            }
        }

        if (quotedProducts && quotedProducts.length > 0) {
            console.log('[ADD_PRODUCT_HANDLER] Adding quoted products to cart first');
            for (const quotedProduct of quotedProducts) {
                const quotedOrderDetails = {
                    productCode: quotedProduct.productCode,
                    productName: quotedProduct.productName,
                    quantity: parseInt(quotedProduct.quantity) || 1,
                    unit: quotedProduct.unit || 'cartons',
                    isPieces: false,
                    isAdditionalProduct: true, // Don't clear cart
                    originalText: `quoted: ${quotedProduct.productCode} ${quotedProduct.quantity}`
                };
                await processOrderRequestEnhanced(tenant.id, from, quotedOrderDetails);
                console.log('[ADD_PRODUCT_HANDLER] Added quoted product to cart:', quotedProduct.productCode);
            }

            // Clear quoted products after adding to cart
            await dbClient
                .from('conversations')
                .update({ last_quoted_products: null })
                .eq('id', conversation.id);
        }

        // THEN: Add the new product
        const newOrderDetails = {
            productCode: productCode,
            productName: newProduct.productName || productCode,
            quantity: parseInt(quantity) || 1,
            unit: unit,
            isPieces: unit && unit.toLowerCase().includes('piece'),
            isAdditionalProduct: true, // KEY FLAG: Don't clear cart
            originalText: userQuery
        };

        // Process new product (DON'T clear cart)
        const result = await processOrderRequestEnhanced(tenant.id, from, newOrderDetails);

        if (result.success) {
            console.log('[ADD_PRODUCT_HANDLER] Product added successfully');

            // Update conversation to track multiple products if applicable
            if (conversation) {
                const allProducts = [conversation.last_product_discussed, productCode].filter(Boolean).join(', ');
                await dbClient
                    .from('conversations')
                    .update({
                        state: 'multi_product_order_discussion',
                        last_product_discussed: allProducts
                    })
                    .eq('id', conversation.id);
            }

            // Show updated cart with all products
            const cartView = await viewCartWithDiscounts(tenant.id, from);
            const confirmMsg = cartView + '\n\n' +
                'Ready to place order? Reply "yes" to checkout.';

            return {
                response: confirmMsg,
                source: 'add_product_success'
            };
        } else {
            console.error('[ADD_PRODUCT_HANDLER] Failed to add product:', result.message);
            return {
                response: result.message || 'Sorry, I had trouble adding that product to your cart. Please try again.',
                source: 'add_product_error'
            };
        }

    } catch (error) {
        console.error('[ADD_PRODUCT_HANDLER] Error in add product handler:', error);
        console.error('[ADD_PRODUCT_HANDLER] Stack:', error.stack);
        return {
            response: 'Sorry, I encountered an error while adding the product. Please try again.',
            source: 'add_product_exception'
        };
    }
}

module.exports = {
    handleAddProduct
};

