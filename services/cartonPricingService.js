/**
 * @title Carton-Level Pricing Service for NFF Products
 * @description Handles quantity breaks, bulk pricing, and carton-based discounts
 */
const { dbClient } = require('./config');
const { getConversationId } = require('./historyService');
const { getOrCreateCart } = require('./cartService');

/**
 * Calculate carton-based pricing with quantity breaks
 * @param {string} productId The product ID to calculate pricing for
 * @param {number} requestedQuantity The quantity requested (in cartons or pieces)
 * @returns {Promise<Object>} Detailed pricing breakdown
 */
const calculateCartonPricing = async (productId, requestedQuantity, requestedUnit = 'carton') => {
    try {
        // Get product with carton info and quantity breaks
        const { data: product } = await dbClient
            .from('products')
            .select(`
                *,
                product_quantity_breaks (*)
            `)
            .eq('id', productId)
            .single();

        if (!product) {
            throw new Error('Product not found');
        }


        // Always use requestedUnit to determine carton/piece quantity
        const unitsPerCarton = product.units_per_carton || 1;
        let cartonQuantity, pieceQuantity;
        if (requestedUnit === 'carton' || requestedUnit === 'cartons' || requestedUnit === 'ctn' || requestedUnit === 'ctns') {
            cartonQuantity = requestedQuantity;
            pieceQuantity = requestedQuantity * unitsPerCarton;
        } else if (requestedUnit === 'piece' || requestedUnit === 'pieces' || requestedUnit === 'pcs') {
            pieceQuantity = requestedQuantity;
            cartonQuantity = Math.ceil(requestedQuantity / unitsPerCarton);
        } else {
            // fallback: treat as pieces
            pieceQuantity = requestedQuantity;
            cartonQuantity = Math.ceil(requestedQuantity / unitsPerCarton);
        }

        // Find applicable quantity break
        const applicableBreak = findQuantityBreak(
            product.product_quantity_breaks, 
            cartonQuantity
        );

        // Calculate pricing
        let unitPrice = product.price;
        let totalPrice = unitPrice * cartonQuantity;
        let discountAmount = 0;
        let discountPercentage = 0;

        if (applicableBreak) {
            if (applicableBreak.unit_price) {
                unitPrice = applicableBreak.unit_price;
                totalPrice = unitPrice * cartonQuantity;
                discountAmount = (product.price - unitPrice) * cartonQuantity;
                discountPercentage = ((product.price - unitPrice) / product.price) * 100;
            } else if (applicableBreak.discount_percentage) {
                discountPercentage = applicableBreak.discount_percentage;
                discountAmount = (totalPrice * discountPercentage) / 100;
                unitPrice = product.price * (1 - discountPercentage / 100);
                totalPrice = totalPrice - discountAmount;
            }
        }

        return {
            product,
            requestedQuantity,
            cartonQuantity,
            pieceQuantity,
            unitsPerCarton,
            baseUnitPrice: product.price,
            finalUnitPrice: unitPrice,
            totalPrice,
            discountAmount,
            discountPercentage,
            applicableBreak,
            breakdown: {
                subtotal: product.price * cartonQuantity,
                discount: discountAmount,
                total: totalPrice
            }
        };

    } catch (error) {
        console.error('Error calculating carton pricing:', error.message);
        throw error;
    }
};

/**
 * Find the best quantity break for given quantity
 * @param {Array} quantityBreaks Array of quantity break objects
 * @param {number} quantity The quantity to check against
 * @returns {Object|null} The applicable quantity break or null
 */
const findQuantityBreak = (quantityBreaks, quantity) => {
    if (!quantityBreaks || quantityBreaks.length === 0) {
        return null;
    }

    // Sort breaks by min_quantity descending to find the highest applicable break
    const sortedBreaks = quantityBreaks.sort((a, b) => b.min_quantity - a.min_quantity);

    for (const qBreak of sortedBreaks) {
        const meetsMin = quantity >= qBreak.min_quantity;
        const meetsMax = !qBreak.max_quantity || quantity <= qBreak.max_quantity;
        
        if (meetsMin && meetsMax) {
            return qBreak;
        }
    }

    return null;
};

/**
 * Enhanced add to cart with carton pricing
 * @param {string} tenantId The tenant ID
 * @param {string} endUserPhone Customer's phone number
 * @param {string} productName Name or partial name of the product
 * @param {number} quantity Quantity to add (default: 1)
 * @returns {Promise<string>} Success or error message
 */
const { findProductByNameOrCode } = require('./smartOrderExtractionService');

const addCartonProductToCart = async (tenantId, endUserPhone, productName, quantity = 1, requestedUnit = 'carton') => {
    try {
        const conversationId = await getConversationId(tenantId, endUserPhone);
        if (!conversationId) return "Could not identify your conversation.";

        // Use robust product lookup (matches '8x80' to 'NFF 8x80', etc)
        const product = await findProductByNameOrCode(tenantId, productName);
        if (!product) {
            return `Sorry, I couldn't find a product named "${productName}".`;
        }

    // Debug: Log product and requested quantity
    console.log('[CARTON_DEBUG] Product:', JSON.stringify(product));
    console.log('[CARTON_DEBUG] Requested quantity:', quantity);

    // Calculate carton pricing using requestedUnit
    const pricing = await calculateCartonPricing(product.id, quantity, requestedUnit);
    console.log('[CARTON_DEBUG] Calculated cartonQuantity:', pricing.cartonQuantity, 'pieceQuantity:', pricing.pieceQuantity);
        
        // Get or create cart
        const cart = await getOrCreateCart(conversationId);

        // Check existing item
        const { data: existingItem } = await dbClient
            .from('cart_items')
            .select('id, quantity, carton_price_override')
            .eq('cart_id', cart.id)
            .eq('product_id', product.id)
            .single();

        if (existingItem) {
            // FIXED: INCREMENT quantity instead of replacing
            const newQuantity = parseInt(existingItem.quantity) + pricing.cartonQuantity;
            console.log('[CART_INCREMENT] Existing:', existingItem.quantity, '+ New:', pricing.cartonQuantity, '= Total:', newQuantity);
            const newPricing = await calculateCartonPricing(product.id, newQuantity, requestedUnit);
            await dbClient
                .from('cart_items')
                .update({
                    quantity: newQuantity,
                    carton_price_override: newPricing.finalUnitPrice,
                    carton_discount_amount: newPricing.discountAmount
                })
                .eq('id', existingItem.id);
        } else {
            // Add new item with carton pricing
            await dbClient
                .from('cart_items')
                .insert({
                    cart_id: cart.id,
                    product_id: product.id,
                    quantity: pricing.cartonQuantity,
                    carton_price_override: pricing.finalUnitPrice,
                    carton_discount_amount: pricing.discountAmount
                });
        }

        // Update cart timestamp
        await dbClient
            .from('carts')
            .update({ updated_at: new Date().toISOString() })
            .eq('id', cart.id);


        // Create response message with packet/piece breakdown if available
        let message = `Added ${pricing.cartonQuantity} carton(s) of "${product.name}" to cart.\n\n`;
        if (product.packets_per_carton && product.pieces_per_packet) {
            message += `Each carton: ${product.packets_per_carton} packets x ${product.pieces_per_packet} pieces = ${product.units_per_carton} pieces\n`;
        } else {
            message += `Each carton: ${product.units_per_carton} pieces\n`;
        }
        if (pricing.discountAmount > 0) {
            message += `Quantity break applied!\n`;
            message += `Base price: â‚¹${pricing.baseUnitPrice}/carton\n`;
            message += `Your price: â‚¹${pricing.finalUnitPrice.toFixed(2)}/carton\n`;
            message += `You save: â‚¹${pricing.discountAmount.toFixed(2)} (${pricing.discountPercentage.toFixed(1)}%)\n`;
        }
        message += `Total for this item: â‚¹${pricing.totalPrice.toFixed(2)}`;

        return message;

    } catch (error) {
        console.error('Error adding carton product to cart:', error.message);
        return 'An error occurred while adding the item to your cart.';
    }
};

/**
 * View cart with carton-level pricing breakdown
 * @param {string} tenantId The tenant ID
 * @param {string} endUserPhone Customer's phone number
 * @returns {Promise<string>} Formatted cart display with carton pricing
 */
const viewCartonCart = async (tenantId, endUserPhone) => {
    try {
        const conversationId = await getConversationId(tenantId, endUserPhone);
        if (!conversationId) return "Could not identify your conversation.";

        const { data: cart } = await dbClient
            .from('carts')
            .select(`
                *,
                cart_items (
                    quantity,
                    carton_price_override,
                    carton_discount_amount,
                    product:products (*)
                )
            `)
            .eq('conversation_id', conversationId)
            .single();

        if (!cart || !cart.cart_items || cart.cart_items.length === 0) {
            return "Your shopping cart is empty.";
        }

        let cartMessage = "ðŸ“¦ **Your Carton Cart**\n\n";
        let totalAmount = 0;
        let totalSavings = 0;

        for (const item of cart.cart_items) {
            const product = item.product;
            const quantity = item.quantity;
            const unitPrice = item.carton_price_override || product.price;
            const itemTotal = unitPrice * quantity;
            const itemDiscount = item.carton_discount_amount || 0;
            
            cartMessage += `**${product.name}**\n`;
            
            if (product.packaging_unit === 'carton') {
                const totalPieces = quantity * (product.units_per_carton || 1);
                cartMessage += `  - ${quantity} carton(s) (${totalPieces} pieces)\n`;
            } else {
                cartMessage += `  - Qty: ${quantity}\n`;
            }
            
            if (itemDiscount > 0) {
                cartMessage += `  - Base: â‚¹${product.price}/unit x ${quantity} = â‚¹${(product.price * quantity).toFixed(2)}\n`;
                cartMessage += `  - Discount: -â‚¹${itemDiscount.toFixed(2)}\n`;
                cartMessage += `  - Final: â‚¹${itemTotal.toFixed(2)}\n`;
                totalSavings += itemDiscount;
            } else {
                cartMessage += `  - Price: â‚¹${unitPrice} x ${quantity} = â‚¹${itemTotal.toFixed(2)}\n`;
            }
            
            cartMessage += '\n';
            totalAmount += itemTotal;
        }

        cartMessage += `**Cart Summary:**\n`;
        if (totalSavings > 0) {
            cartMessage += `Subtotal: â‚¹${(totalAmount + totalSavings).toFixed(2)}\n`;
            cartMessage += `Bulk Savings: -â‚¹${totalSavings.toFixed(2)}\n`;
        }
        cartMessage += `**Total: â‚¹${totalAmount.toFixed(2)}**\n\n`;
        cartMessage += `To checkout: /checkout`;

        return cartMessage;

    } catch (error) {
        console.error('Error viewing carton cart:', error.message);
        return 'An error occurred while fetching your cart.';
    }
};

/**
 * Admin command to set up carton pricing for products
 * @param {string} tenantId The tenant ID
 * @param {string} productName Name or partial name of the product
 * @param {Object} cartonConfig Carton configuration object
 * @returns {Promise<string>} Success or error message
 */
const setupCartonPricing = async (tenantId, productName, cartonConfig) => {
    try {
        const {
            unitsPerCarton,
            cartonPrice,
            minCartonQty = 1,
            quantityBreaks = []
        } = cartonConfig;

        // Find product
        const { data: product } = await dbClient
            .from('products')
            .select('id, name')
            .eq('tenant_id', tenantId)
            .ilike('name', `%${productName}%`)
            .single();

        if (!product) {
            return `Product "${productName}" not found.`;
        }

        // Update product with carton info
        await dbClient
            .from('products')
            .update({
                packaging_unit: 'carton',
                units_per_carton: unitsPerCarton,
                carton_price: cartonPrice,
                min_carton_qty: minCartonQty
            })
            .eq('id', product.id);

                    // Add quantity breaks if provided
        if (quantityBreaks.length > 0) {
            // Delete existing breaks first
            await dbClient
                .from('product_quantity_breaks')
                .delete()
                .eq('product_id', product.id);

            const breaksToInsert = quantityBreaks.map(qb => ({
                product_id: product.id,
                min_quantity: qb.minQuantity,
                max_quantity: qb.maxQuantity || null,
                unit_price: qb.unitPrice,
                discount_percentage: qb.discountPercentage || 0,
                break_type: 'carton'
            }));

            await dbClient
                .from('product_quantity_breaks')
                .insert(breaksToInsert);
        }

        return `âœ… Carton pricing setup for "${product.name}"\n` +
               `Units per carton: ${unitsPerCarton}\n` +
               `Carton price: â‚¹${cartonPrice}\n` +
               `Quantity breaks: ${quantityBreaks.length} configured`;

    } catch (error) {
        console.error('Error setting up carton pricing:', error.message);
        return 'Failed to setup carton pricing.';
    }
};

/**
 * Get carton pricing information for a product
 * @param {string} tenantId The tenant ID
 * @param {string} productName Name or partial name of the product
 * @returns {Promise<string>} Formatted pricing information
 */
const getCartonPricingInfo = async (tenantId, productName) => {
    try {
        const { data: product } = await dbClient
            .from('products')
            .select(`
                *,
                product_quantity_breaks (*)
            `)
            .eq('tenant_id', tenantId)
            .ilike('name', `%${productName}%`)
            .single();

        if (!product) {
            return `Product "${productName}" not found.`;
        }

        let message = `ðŸ“¦ **Carton Pricing Info: ${product.name}**\n\n`;
        message += `Base price: â‚¹${product.price}/carton\n`;
        message += `Units per carton: ${product.units_per_carton || 'Not set'}\n`;
        message += `Packaging: ${product.packaging_unit || 'piece'}\n`;
        message += `Min carton qty: ${product.min_carton_qty || 1}\n\n`;

        if (product.product_quantity_breaks && product.product_quantity_breaks.length > 0) {
            message += `**Quantity Breaks:**\n`;
            product.product_quantity_breaks
                .sort((a, b) => a.min_quantity - b.min_quantity)
                .forEach(qb => {
                    const savings = product.price - qb.unit_price;
                    const savingsPercent = ((savings / product.price) * 100).toFixed(1);
                    message += `${qb.min_quantity}+ cartons: â‚¹${qb.unit_price}/carton (${savingsPercent}% off)\n`;
                });
        } else {
            message += `No quantity breaks configured.`;
        }

        return message;

    } catch (error) {
        console.error('Error getting carton pricing info:', error.message);
        return 'Failed to retrieve carton pricing information.';
    }
};

/**
 * Bulk setup carton pricing for NFF products with standard structure
 * @param {string} tenantId The tenant ID
 * @param {Array} standardBreaks Optional custom breaks (default: standard NFF breaks)
 * @returns {Promise<string>} Setup result message
 */
const bulkSetupNFFCartonPricing = async (tenantId, standardBreaks = null) => {
    try {
        // Default NFF quantity breaks
        const defaultBreaks = standardBreaks || [
            { minQuantity: 5, discountPercentage: 5 },
            { minQuantity: 10, discountPercentage: 8 },
            { minQuantity: 20, discountPercentage: 12 },
            { minQuantity: 50, discountPercentage: 15 }
        ];

        // Get all NFF products
        const { data: nffProducts } = await dbClient
            .from('products')
            .select('*')
            .eq('tenant_id', tenantId)
            .ilike('name', 'NFF%');

        if (!nffProducts || nffProducts.length === 0) {
            return 'No NFF products found.';
        }

        let setupCount = 0;
        let errorCount = 0;

        for (const product of nffProducts) {
            try {
                // Extract units per carton from description (format: "70 pcs x 10 Pkts")
                const unitsMatch = product.description?.match(/(\d+)\s*pcs\s*x\s*(\d+)\s*Pkts/i);
                
                if (unitsMatch) {
                    const unitsPerCarton = parseInt(unitsMatch[1]);
                    
                    // Update product with carton info
                    await dbClient
                        .from('products')
                        .update({
                            packaging_unit: 'carton',
                            units_per_carton: unitsPerCarton,
                            min_carton_qty: 1
                        })
                        .eq('id', product.id);

                    // Delete existing breaks
                    await dbClient
                        .from('product_quantity_breaks')
                        .delete()
                        .eq('product_id', product.id);

                    // Add quantity breaks
                    const breaksToInsert = defaultBreaks.map(qb => {
                        const discountedPrice = product.price * (1 - qb.discountPercentage / 100);
                        return {
                            product_id: product.id,
                            min_quantity: qb.minQuantity,
                            unit_price: Math.round(discountedPrice * 100) / 100,
                            discount_percentage: qb.discountPercentage,
                            break_type: 'carton'
                        };
                    });

                    await dbClient
                        .from('product_quantity_breaks')
                        .insert(breaksToInsert);

                    setupCount++;
                } else {
                    console.warn(`Could not parse carton info for product: ${product.name}`);
                    errorCount++;
                }
            } catch (productError) {
                console.error(`Error setting up ${product.name}:`, productError.message);
                errorCount++;
            }
        }

        let message = `ðŸš€ **Bulk NFF Setup Complete!**\n\n`;
        message += `âœ… Successfully configured: ${setupCount} products\n`;
        if (errorCount > 0) {
            message += `âš ï¸ Errors: ${errorCount} products\n`;
        }
        message += `\n**Standard quantity breaks applied:**\n`;
        defaultBreaks.forEach(qb => {
            message += `${qb.minQuantity}+ cartons: ${qb.discountPercentage}% off\n`;
        });

        return message;

    } catch (error) {
        console.error('Error in bulk NFF setup:', error.message);
        return 'Failed to setup bulk NFF pricing.';
    }
};

/**
 * Test carton pricing calculation for a product
 * @param {string} tenantId The tenant ID
 * @param {string} productName Name of the product to test
 * @param {number} quantity Quantity to test
 * @returns {Promise<string>} Test results
 */
const testCartonPricing = async (tenantId, productName, quantity = 1) => {
    try {
        // Find product
        const { data: product } = await dbClient
            .from('products')
            .select('id, name')
            .eq('tenant_id', tenantId)
            .ilike('name', `%${productName}%`)
            .single();

        if (!product) {
            return `Product "${productName}" not found.`;
        }

        // Calculate pricing
        const pricing = await calculateCartonPricing(product.id, quantity);
        
        let message = `ðŸ§ª **Carton Pricing Test**\n\n`;
        message += `Product: ${pricing.product.name}\n`;
        message += `Requested: ${quantity} cartons\n`;
        message += `Total pieces: ${pricing.pieceQuantity}\n`;
        message += `Base price: â‚¹${pricing.baseUnitPrice}/carton\n`;
        message += `Final price: â‚¹${pricing.finalUnitPrice}/carton\n`;
        message += `Total: â‚¹${pricing.totalPrice.toFixed(2)}\n`;
        
        if (pricing.discountAmount > 0) {
            message += `\nðŸ’° **Savings Applied:**\n`;
            message += `Discount: â‚¹${pricing.discountAmount.toFixed(2)} (${pricing.discountPercentage.toFixed(1)}%)\n`;
            message += `Break applied: ${pricing.applicableBreak.min_quantity}+ cartons\n`;
        } else {
            message += `\nNo quantity breaks applied.`;
        }
        
        return message;

    } catch (error) {
        console.error('Error testing carton pricing:', error.message);
        return `Error: ${error.message}`;
    }
};

/**
 * Add quantity breaks to an existing carton product
 * @param {string} tenantId The tenant ID
 * @param {string} productName Name of the product
 * @param {Array} breaks Array of quantity break objects
 * @returns {Promise<string>} Success or error message
 */
const addQuantityBreaks = async (tenantId, productName, breaks) => {
    try {
        // Find product
        const { data: product } = await dbClient
            .from('products')
            .select('id, name, price')
            .eq('tenant_id', tenantId)
            .ilike('name', `%${productName}%`)
            .single();

        if (!product) {
            return `Product "${productName}" not found.`;
        }

        // Delete existing breaks
        await dbClient
            .from('product_quantity_breaks')
            .delete()
            .eq('product_id', product.id);

        // Insert new breaks
        const breaksToInsert = breaks.map(qb => ({
            product_id: product.id,
            min_quantity: qb.minQuantity,
            max_quantity: qb.maxQuantity || null,
            unit_price: qb.unitPrice,
            discount_percentage: qb.discountPercentage || 0,
            break_type: 'carton'
        }));

        await dbClient
            .from('product_quantity_breaks')
            .insert(breaksToInsert);

        let message = `âœ… **Quantity breaks updated for "${product.name}":**\n\n`;
        breaks.forEach(qb => {
            const savings = product.price - qb.unitPrice;
            const savingsPercent = ((savings / product.price) * 100).toFixed(1);
            message += `${qb.minQuantity}+ cartons: â‚¹${qb.unitPrice}/carton (Save â‚¹${savings.toFixed(2)} or ${savingsPercent}%)\n`;
        });

        return message;

    } catch (error) {
        console.error('Error adding quantity breaks:', error.message);
        return 'Failed to add quantity breaks.';
    }
};

module.exports = {
    calculateCartonPricing,
    findQuantityBreak,
    addCartonProductToCart,
    viewCartonCart,
    setupCartonPricing,
    getCartonPricingInfo,
    bulkSetupNFFCartonPricing,
    testCartonPricing,
    addQuantityBreaks
};
