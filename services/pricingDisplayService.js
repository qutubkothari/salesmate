const { dbClient } = require('../config/database');

/**
 * Calculate and format pricing display with per piece and per carton breakdown
 */
async function formatPriceDisplay(product, pricePerCarton = null) {
    try {
        // Use provided price or product's catalog price
        const cartonPrice = pricePerCarton || parseFloat(product.price);
        const unitsPerCarton = parseInt(product.units_per_carton) || 1;
        
        // CRITICAL: Calculate per piece price ONLY from units_per_carton, NEVER from order quantity
        // Per-piece price = carton price ÷ pieces per carton
        // Example: ₹2511 per carton ÷ 1500 pcs/carton = ₹1.67/pc
        const pricePerPiece = (cartonPrice / unitsPerCarton).toFixed(2);
        
        console.log('[PRICING_DISPLAY] Price calculation:', {
            product: product.name,
            cartonPrice: cartonPrice,
            unitsPerCarton: unitsPerCarton,
            calculatedPricePerPiece: pricePerPiece,
            formula: `${cartonPrice} ÷ ${unitsPerCarton} = ${pricePerPiece}`
        });
        
        const display = {
            productName: product.name,
            pricePerPiece: parseFloat(pricePerPiece),
            pricePerCarton: parseFloat(cartonPrice.toFixed(2)),
            unitsPerCarton: unitsPerCarton,
            packagingUnit: product.packaging_unit || 'carton',
            
            // Formatted strings for display
            formatted: {
                perPiece: `₹${pricePerPiece}/pc`,
                perCarton: `₹${cartonPrice.toFixed(2)}/${product.packaging_unit || 'carton'}`,
                breakdown: `₹${pricePerPiece}/pc × ${unitsPerCarton} pcs = ₹${cartonPrice.toFixed(2)}/${product.packaging_unit || 'carton'}`
            }
        };
        
        return display;
        
    } catch (error) {
        console.error('[PRICING_DISPLAY] Error:', error.message);
        return null;
    }
}

/**
 * Format personalized price display for returning customers
 */
async function formatPersonalizedPriceDisplay(tenantId, phoneNumber, productId) {
    try {
        console.log('[PRICING_DISPLAY] Fetching personalized pricing for:', { tenantId, phoneNumber, productId });
        
        // Get product details
        const { data: product, error: productError } = await dbClient
            .from('products')
            .select('*')
            .eq('id', productId)
            .eq('tenant_id', tenantId)
            .single();

        if (productError) {
            console.error('[PRICING_DISPLAY] Error fetching product:', productError.message);
            return null;
        }

        if (!product) {
            console.log('[PRICING_DISPLAY] Product not found');
            return null;
        }
        
        console.log('[PRICING_DISPLAY] Product found:', product.name);

        
        // Clean phone number (remove @c.us suffix if present)
        const cleanPhone = phoneNumber.replace('@c.us', '');
        console.log('[PRICING_DISPLAY] Looking up customer with phone:', cleanPhone);
        
        // Get customer's last purchase price
        const { data: customer, error: customerError } = await dbClient
            .from('customer_profiles_new')
            .select('id')
            .eq('tenant_id', tenantId)
            .eq('phone', cleanPhone)
            .single();
            
        if (customerError) {
            console.log('[PRICING_DISPLAY] Customer not found:', customerError.message);
        } else {
            console.log('[PRICING_DISPLAY] Customer found:', customer.id);
        }
        
        let lastPurchasePrice = null;
        let lastOrderDate = null;
        
        if (customer) {
            // Get orders through conversations (orders -> conversations -> customer_profile_id)
            // First get customer's conversations
            const { data: conversations } = await dbClient
                .from('conversations_new')
                .select('id')
                .eq('customer_profile_id', customer.id)
                .eq('tenant_id', tenantId);

            if (!conversations || conversations.length === 0) {
                console.log('[PRICING_DISPLAY] No conversations found for customer');
            } else {
                const conversationIds = conversations.map(c => c.id);
                console.log('[PRICING_DISPLAY] Found', conversationIds.length, 'conversations');

                // Now get order_items for orders in these conversations
                const { data: orderItems, error: orderError } = await dbClient
                    .from('order_items')
                    .select(`
                        unit_price_before_tax,
                        price_at_time_of_purchase,
                        quantity,
                        order_id,
                        orders!inner(created_at, status, conversation_id, tenant_id)
                    `)
                    .in('orders.conversation_id', conversationIds)
                    .eq('orders.tenant_id', tenantId)
                    .eq('product_id', productId);

                console.log('[PRICING_DISPLAY] Order items query:', {
                    found: orderItems?.length || 0,
                    error: orderError?.message,
                });

                // Filter by valid statuses and non-null price
                const validOrderItems = orderItems?.filter(item => 
                    ['pending', 'confirmed', 'completed', 'pending_payment'].includes(item.orders?.status) &&
                    (item.unit_price_before_tax != null || item.price_at_time_of_purchase != null)
                ) || [];

                console.log('[PRICING_DISPLAY] After filtering:', validOrderItems.length, 'valid items');

                // Sort by order date manually and get the most recent
                let lastOrder = null;
                if (validOrderItems.length > 0) {
                    lastOrder = validOrderItems.sort((a, b) => 
                        new Date(b.orders.created_at) - new Date(a.orders.created_at)
                    )[0];
                }

                console.log('[PRICING_DISPLAY] Last order query result:', { 
                    found: !!lastOrder,
                    price: lastOrder?.price_at_time_of_purchase,
                    quantity: lastOrder?.quantity
                });

                if (lastOrder) {
                    // CRITICAL: Use unit_price_before_tax which stores PER-CARTON price
                    // This is the actual price the customer paid per carton (after any discounts)
                    // Try price_at_time_of_purchase first (if it exists), otherwise use unit_price_before_tax
                    const priceValue = lastOrder.price_at_time_of_purchase || lastOrder.unit_price_before_tax;
                    lastPurchasePrice = parseFloat(priceValue);
                    lastOrderDate = lastOrder.orders.created_at;

                    console.log('[PRICING_DISPLAY] Last purchase details:', {
                        price_at_time_of_purchase: lastOrder.price_at_time_of_purchase,
                        unit_price_before_tax: lastOrder.unit_price_before_tax,
                        usedPrice: priceValue,
                        quantity: lastOrder.quantity,
                        perCartonPrice: lastPurchasePrice,
                        note: 'Using available price field',
                        date: lastOrderDate
                    });
                }
            }
        }
        
        const catalogPrice = parseFloat(product.price);
        const displayPrice = lastPurchasePrice || catalogPrice;
        const unitsPerCarton = parseInt(product.units_per_carton) || 1;
        
        // CRITICAL: Calculate per piece price ONLY from units_per_carton, NEVER from order quantity
        // Per-piece price = price per carton ÷ pieces per carton  
        // Example: ₹2511 per carton ÷ 1500 pcs/carton = ₹1.67/pc
        const pricePerPiece = (displayPrice / unitsPerCarton).toFixed(2);
        
        console.log('[PRICING_DISPLAY] Personalized price calculation:', {
            product: product.name,
            displayPrice: displayPrice,
            unitsPerCarton: unitsPerCarton,
            calculatedPricePerPiece: pricePerPiece,
            formula: `${displayPrice} ÷ ${unitsPerCarton} = ${pricePerPiece}`,
            isReturningCustomer: !!lastPurchasePrice
        });
        
        // Build display object
        const display = {
            productName: product.name,
            pricePerPiece: parseFloat(pricePerPiece),
            pricePerCarton: parseFloat(displayPrice.toFixed(2)),
            unitsPerCarton: unitsPerCarton,
            packagingUnit: product.packaging_unit || 'carton',
            
            // Customer context
            isReturningCustomer: !!lastPurchasePrice,
            lastPurchasePrice: lastPurchasePrice, // Add this for multi-product handler
            lastOrderDate: lastOrderDate,
            catalogPrice: catalogPrice,
            savingsAmount: lastPurchasePrice && catalogPrice > lastPurchasePrice 
                ? parseFloat((catalogPrice - lastPurchasePrice).toFixed(2))
                : 0,
            savings: lastPurchasePrice && catalogPrice > lastPurchasePrice 
                ? (catalogPrice - lastPurchasePrice).toFixed(2) 
                : 0,
            
            // Formatted strings
            formatted: {
                perPiece: `₹${pricePerPiece}/pc`,
                perCarton: `₹${displayPrice.toFixed(2)}/${product.packaging_unit || 'carton'}`,
                breakdown: `₹${pricePerPiece}/pc × ${unitsPerCarton} pcs = ₹${displayPrice.toFixed(2)}/${product.packaging_unit || 'carton'}`
            }
        };
        
        return display;
        
    } catch (error) {
        console.error('[PRICING_DISPLAY] Error:', error.message);
        return null;
    }
}

/**
 * Create formatted price message for WhatsApp
 */
function createPriceMessage(priceDisplay, includePersonalization = false, originalQuery = '') {
    if (!priceDisplay) return 'Price information not available.';
    
    let message = `📦 *${priceDisplay.productName}*\n\n`;
    
    // Check if quantity was mentioned in the original query (handles "25ctns" without space)
    const quantityMatch = originalQuery.match(/(\d+)\s*(pcs?|pieces?|cartons?|ctns?)/i);
    const quantityUnit = quantityMatch ? (quantityMatch[0].match(/cartons?|ctns?/i) ? 'cartons' : 'pieces') : null;
    
    // Show personalization if returning customer
    if (includePersonalization && priceDisplay.isReturningCustomer) {
        message += `✨ Your Special Price:\n`;
    } else {
        message += `💵 Price:\n`;
    }
    
    // Always show both prices with clear units
    message += `🔹 ${priceDisplay.formatted.perPiece} per piece\n`;
    message += `📦 ${priceDisplay.formatted.perCarton}\n`;
    message += `   (${priceDisplay.unitsPerCarton} pcs/carton)\n`;
    
    // Show savings if applicable
    if (includePersonalization && priceDisplay.savings > 0) {
        message += `💰 Saves ₹${priceDisplay.savings} vs catalog\n`;
    }
    
    message += `\n`;
    
    // Calculate quote if quantity was mentioned
    if (quantityMatch) {
        const quantity = parseInt(quantityMatch[1]);
        const unit = quantityUnit;
        const unitsPerCarton = priceDisplay.unitsPerCarton || 1;
        const cartonPrice = priceDisplay.pricePerCarton || priceDisplay.price;
        
        console.log('[PRICING_DISPLAY] Quote calculation:', {
            product: priceDisplay.productName,
            quantity: quantity,
            unit: unit,
            unitsPerCarton: unitsPerCarton,
            cartonPrice: cartonPrice,
            pricePerPiece: priceDisplay.pricePerPiece
        });
        
        let finalQuantity, totalAmount;
        if (unit === 'pieces') {
            // Convert pieces to cartons - show exact then rounded
            const exactCartons = (quantity / unitsPerCarton).toFixed(2);
            const roundedCartons = Math.ceil(quantity / unitsPerCarton);
            finalQuantity = roundedCartons;
            totalAmount = (roundedCartons * cartonPrice).toFixed(2);
            
            message += `📊 *Quote for ${quantity.toLocaleString('en-IN')} pieces:*\n`;
            message += `   ${quantity.toLocaleString('en-IN')} pcs ÷ ${unitsPerCarton} pcs/carton = ${exactCartons} cartons\n`;
            message += `   (Rounded to ${roundedCartons} carton${roundedCartons !== 1 ? 's' : ''})\n`;
            message += `   ${roundedCartons} carton${roundedCartons !== 1 ? 's' : ''} × ₹${cartonPrice.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})} = *₹${parseFloat(totalAmount).toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}*\n\n`;
        } else {
            // Already in cartons
            finalQuantity = quantity;
            totalAmount = (quantity * cartonPrice).toFixed(2);
            
            message += `📊 *Quote for ${quantity} carton${quantity !== 1 ? 's' : ''}:*\n`;
            message += `   ${quantity} carton${quantity !== 1 ? 's' : ''} × ₹${cartonPrice.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})} = *₹${parseFloat(totalAmount).toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}*\n\n`;
        }
    }
    
    // Show last order date if returning customer
    if (includePersonalization && priceDisplay.isReturningCustomer && priceDisplay.lastOrderDate) {
        const orderDate = new Date(priceDisplay.lastOrderDate).toLocaleDateString('en-IN');
        message += `📅 Last ordered: ${orderDate}\n`;
    }
    
    // Show appropriate CTA based on whether quantity was specified
    if (quantityMatch) {
        message += `\n🛒 Ready to add this to your cart? Just say "yes"!`;
    } else {
        message += `\n🛒 Ready to order? Let me know the quantity!`;
    }
    
    return message;
}

/**
 * Format price for multiple products (bulk display)
 */
async function formatMultipleProductPrices(tenantId, phoneNumber, productIds) {
    try {
        const displays = [];
        
        for (const productId of productIds) {
            const display = await formatPersonalizedPriceDisplay(tenantId, phoneNumber, productId);
            if (display) {
                displays.push(display);
            }
        }
        
        if (displays.length === 0) {
            return 'No products found.';
        }
        
        let message = '📋 *Price List*\n\n';
        
        displays.forEach((display, index) => {
            message += `${index + 1}. *${display.productName}*\n`;
            message += `   ${display.formatted.perPiece} | ${display.formatted.perCarton}\n`;
            message += `   ${display.unitsPerCarton} pcs per ${display.packagingUnit}\n`;
            
            if (display.isReturningCustomer) {
                message += `   ✨ Your special price\n`;
            }
            
            message += `\n`;
        });
        
        message += `\n💬 Reply with product name and quantity to order!`;
        
        return message;
        
    } catch (error) {
        console.error('[PRICING_DISPLAY] Error formatting multiple:', error.message);
        return 'Error fetching prices.';
    }
}

/**
 * Calculate price for a specific quantity
 */
function calculateQuantityPrice(priceDisplay, quantity, unit = 'carton') {
    try {
        let totalPrice = 0;
        let breakdown = '';
        
        if (unit === 'piece' || unit === 'pcs' || unit === 'pc') {
            // Calculate by pieces
            totalPrice = priceDisplay.pricePerPiece * quantity;
            const cartons = Math.ceil(quantity / priceDisplay.unitsPerCarton);
            
            breakdown = `${quantity} pcs @ ₹${priceDisplay.pricePerPiece}/pc = ₹${totalPrice.toFixed(2)}\n`;
            breakdown += `(≈ ${cartons} ${priceDisplay.packagingUnit}s)`;
            
        } else {
            // Calculate by cartons
            totalPrice = priceDisplay.pricePerCarton * quantity;
            const pieces = quantity * priceDisplay.unitsPerCarton;
            
            breakdown = `${quantity} ${priceDisplay.packagingUnit}s @ ₹${priceDisplay.pricePerCarton}/${priceDisplay.packagingUnit} = ₹${totalPrice.toFixed(2)}\n`;
            breakdown += `(${pieces} pieces total)`;
        }
        
        return {
            quantity,
            unit,
            totalPrice: parseFloat(totalPrice.toFixed(2)),
            breakdown,
            formatted: `₹${totalPrice.toFixed(2)}`
        };
        
    } catch (error) {
        console.error('[PRICING_DISPLAY] Error calculating quantity price:', error.message);
        return null;
    }
}

/**
 * Create order confirmation message with pricing breakdown
 */
function createOrderConfirmationMessage(priceDisplay, quantity, unit = 'carton') {
    const calculation = calculateQuantityPrice(priceDisplay, quantity, unit);
    
    if (!calculation) return 'Error calculating price.';
    
    let message = `📝 *Order Summary*\n\n`;
    message += `Product: ${priceDisplay.productName}\n\n`;
    message += `💰 *Pricing:*\n`;
    message += `${calculation.breakdown}\n\n`;
    message += `🏷️ *Total: ${calculation.formatted}*\n\n`;
    message += `Confirm order? Reply "yes go ahead" to proceed.`;
    
    return message;
}

module.exports = {
    formatPriceDisplay,
    formatPersonalizedPriceDisplay,
    createPriceMessage,
    formatMultipleProductPrices,
    calculateQuantityPrice,
    createOrderConfirmationMessage
};

