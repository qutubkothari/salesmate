const { dbClient } = require('./config');
const { formatPersonalizedPriceDisplay, createPriceMessage } = require('./pricingDisplayService');

/**
 * Calculate proper quote based on unit type
 */
const calculateQuoteAmount = (product, quantity, unit, isPieces) => {
    const unitsPerCarton = product.units_per_carton || 1;
    const pricePerCarton = product.price;
    
    if (isPieces || unit === 'pieces') {
        // Convert pieces to cartons for total
        const cartonsNeeded = quantity / unitsPerCarton;
        const totalAmount = cartonsNeeded * pricePerCarton;
        const pricePerPiece = pricePerCarton / unitsPerCarton;
        
        return {
            displayQuantity: quantity,
            displayUnit: 'pieces',
            cartonsEquivalent: cartonsNeeded.toFixed(2),
            pricePerUnit: pricePerPiece.toFixed(2),
            totalAmount: totalAmount.toFixed(2),
            calculation: `${quantity} pcs ÷ ${unitsPerCarton} × ₹${pricePerCarton} = ₹${totalAmount.toFixed(2)}`
        };
    } else {
        // Cartons - direct calculation
        const totalAmount = quantity * pricePerCarton;
        
        return {
            displayQuantity: quantity,
            displayUnit: 'cartons',
            piecesEquivalent: quantity * unitsPerCarton,
            pricePerUnit: pricePerCarton.toFixed(2),
            totalAmount: totalAmount.toFixed(2),
            calculation: `${quantity} cartons × ₹${pricePerCarton} = ₹${totalAmount.toFixed(2)}`
        };
    }
};

/**
 * Handle multi-product price inquiry with personalized pricing
 */
const handleMultiProductPriceInquiry = async (query, tenantId, phoneNumber = null, aiQuantities = null) => {
    try {
        console.log('[MULTI_PRODUCT] Processing multi-product price inquiry:', query);
        console.log('[MULTI_PRODUCT] Customer phone:', phoneNumber || 'Not provided');
        
        // Extract all product codes and their quantities from the query
        // Patterns: "8x80 10", "8x100 5 cartons", "8x120 2 ctns", etc.
        const productCodes = (query.match(/\d+[x*]\d+/gi) || []).map(code => code.replace('*', 'x'));
        
        console.log('[MULTI_PRODUCT] Found product codes:', productCodes);
        
        if (productCodes.length === 0) {
            return null;
        }
        
        // Build a map of product code to quantity and unit
        const codeToQuantityMap = {};
        const codeToUnitMap = {};
        
        // First, use AI-detected quantities if available
        if (aiQuantities && Array.isArray(aiQuantities)) {
            console.log('[MULTI_PRODUCT] Using AI-detected quantities:', aiQuantities);
            for (const qtyInfo of aiQuantities) {
                const code = qtyInfo.product.replace('*', 'x');
                codeToQuantityMap[code] = qtyInfo.quantity;
                codeToUnitMap[code] = qtyInfo.unit || 'carton';
                console.log('[MULTI_PRODUCT] AI quantity for', code, ':', qtyInfo.quantity, qtyInfo.unit);
            }
        }
        
        // Fallback: extract quantities from query string for any missing codes
        for (const code of productCodes) {
            if (codeToQuantityMap[code] === undefined) {
                // Look for quantity after this product code
                // Pattern: "8x80 10" or "8x80: 10" or "8x80 - 10 cartons"
                const codePattern = code.replace(/[x*]/g, '[x*]');
                const quantityRegex = new RegExp(codePattern + '\\s*[:-]?\\s*(\\d+)(?:\\s*(?:cartons?|ctns?|pcs?|pieces?))?', 'i');
                const match = query.match(quantityRegex);
                
                if (match && match[1]) {
                    codeToQuantityMap[code] = parseInt(match[1]);
                    codeToUnitMap[code] = 'carton'; // Default to carton for regex extraction
                    console.log('[MULTI_PRODUCT] Regex extracted quantity for', code, ':', match[1]);
                } else {
                    codeToQuantityMap[code] = 1; // Default to 1 if no quantity specified
                    codeToUnitMap[code] = 'carton'; // Default unit
                    console.log('[MULTI_PRODUCT] No quantity found for', code, '- defaulting to 1 carton');
                }
            }
        }
        
        const products = [];
        const quotedProducts = [];
        const foundProductIds = new Set();
        
        for (const code of productCodes) {
            console.log('[MULTI_PRODUCT] Looking up product:', code);
            const product = await findProductByCode(tenantId, code);
            
            if (product && !foundProductIds.has(product.id)) {
                console.log('[MULTI_PRODUCT] Found product:', product.name, 'for code:', code);
                foundProductIds.add(product.id);
                
                const quantity = codeToQuantityMap[code] || 1;
                const unit = codeToUnitMap[code] || 'carton';
                products.push({ ...product, requestedQuantity: quantity, requestedUnit: unit });
                
                quotedProducts.push({
                    productCode: code,
                    productName: product.name,
                    productId: product.id,
                    price: product.price,
                    quantity: quantity,
                    unit: unit,
                    unitsPerCarton: product.units_per_carton
                });
                
                console.log('[MULTI_PRODUCT] Added to quotedProducts with quantity:', quantity);
            } else if (product && foundProductIds.has(product.id)) {
                console.log('[MULTI_PRODUCT] Skipping duplicate product:', product.name);
            } else {
                console.log('[MULTI_PRODUCT] Product not found for code:', code);
            }
        }
        
        if (products.length === 0) {
            return "Sorry, I couldn't find any of those products in our catalog.";
        }
        
        // If single product, use beautiful personalized format
        if (products.length === 1 && phoneNumber) {
            console.log('[MULTI_PRODUCT] Single product - using personalized pricing');
            const priceDisplay = await formatPersonalizedPriceDisplay(tenantId, phoneNumber, products[0].id);
            if (priceDisplay) {
                const message = createPriceMessage(priceDisplay, true); // true = include personalization
                return {
                    response: message,
                    quotedProducts: quotedProducts
                };
            }
        }
        
        // Multiple products - show compact list with per-piece pricing and personalization
        let response = "💰 **Price Information:**\n\n";
        let hasAnyPersonalizedPrice = false;
        
        console.log('[MULTI_PRODUCT] Starting to process', products.length, 'products');
        console.log('[MULTI_PRODUCT] Phone number for personalization:', phoneNumber);
        
        for (const product of products) {
            const unitsPerCarton = parseInt(product.units_per_carton) || 1;
            const pricePerPiece = (product.price / unitsPerCarton).toFixed(2);
            const requestedQuantity = product.requestedQuantity || 1;
            const requestedUnit = product.requestedUnit || 'carton';
            
            console.log('[MULTI_PRODUCT] Processing product:', product.name, 'ID:', product.id, 'Quantity:', requestedQuantity);
            
            // Get personalized pricing if available
            let personalizedInfo = null;
            if (phoneNumber) {
                console.log('[MULTI_PRODUCT] Fetching personalized pricing for:', product.name);
                personalizedInfo = await formatPersonalizedPriceDisplay(tenantId, phoneNumber, product.id);
                console.log('[MULTI_PRODUCT] Personalized info result:', personalizedInfo ? 'Found' : 'Not found');
                if (personalizedInfo) {
                    console.log('[MULTI_PRODUCT] Last purchase price:', personalizedInfo.lastPurchasePrice);
                }
            } else {
                console.log('[MULTI_PRODUCT] No phone number - skipping personalization');
            }
            
            response += `📦 **${product.name}**\n`;
            
            // Show personalized price if customer has purchased before
            if (personalizedInfo && personalizedInfo.lastPurchasePrice) {
                hasAnyPersonalizedPrice = true;
                const lastPricePerPiece = (personalizedInfo.lastPurchasePrice / unitsPerCarton).toFixed(2);
                response += `✨ Your Special Price:\n`;
                response += `🔹 ₹${lastPricePerPiece}/pc per piece\n`;
                response += `📦 ₹${personalizedInfo.lastPurchasePrice.toFixed(2)}/carton\n`;
                response += `   (${unitsPerCarton} pcs/carton)\n`;
                
                if (personalizedInfo.savingsAmount > 0) {
                    response += `💰 Saves ₹${personalizedInfo.savingsAmount.toFixed(2)} vs catalog\n`;
                }
                
                // Show quote for requested quantity if specified
                if (requestedQuantity > 1) {
                    let totalAmount, calculationText;
                    if (requestedUnit === 'pieces') {
                        // Pieces calculation
                        const pricePerPiece = personalizedInfo.lastPurchasePrice / unitsPerCarton;
                        totalAmount = pricePerPiece * requestedQuantity;
                        calculationText = `   ${requestedQuantity} pcs × ₹${pricePerPiece.toFixed(2)} = ₹${totalAmount.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
                    } else {
                        // Cartons calculation
                        totalAmount = personalizedInfo.lastPurchasePrice * requestedQuantity;
                        calculationText = `   ${requestedQuantity} × ₹${personalizedInfo.lastPurchasePrice.toFixed(2)} = ₹${totalAmount.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
                    }
                    const unitText = requestedUnit === 'pieces' ? 'pieces' : 'cartons';
                    response += `\n📊 Quote for ${requestedQuantity} ${unitText}:\n`;
                    response += calculationText + '\n';
                }
            } else {
                // Show catalog price for new products
                response += `🔹 ₹${pricePerPiece}/pc per piece\n`;
                response += `📦 ₹${product.price}/carton\n`;
                response += `   (${unitsPerCarton} pcs/carton)\n`;
                
                // Show quote for requested quantity if specified
                if (requestedQuantity > 1) {
                    let totalAmount, calculationText;
                    if (requestedUnit === 'pieces') {
                        // Pieces calculation
                        const pricePerPiece = product.price / unitsPerCarton;
                        totalAmount = pricePerPiece * requestedQuantity;
                        calculationText = `   ${requestedQuantity} pcs × ₹${pricePerPiece.toFixed(2)} = ₹${totalAmount.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
                    } else {
                        // Cartons calculation
                        totalAmount = product.price * requestedQuantity;
                        calculationText = `   ${requestedQuantity} × ₹${product.price.toFixed(2)} = ₹${totalAmount.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
                    }
                    const unitText = requestedUnit === 'pieces' ? 'pieces' : 'cartons';
                    response += `\n📊 Quote for ${requestedQuantity} ${unitText}:\n`;
                    response += calculationText + '\n';
                }
            }
            
            response += `\n`;
        }
        
        // Calculate total if multiple products with quantities
        const totalCartons = products.reduce((sum, p) => sum + (p.requestedQuantity || 1), 0);
        const hasMultipleQuantities = products.some(p => (p.requestedQuantity || 1) > 1);
        
        if (hasMultipleQuantities && products.length > 1) {
            let grandTotal = 0;
            let totalUnits = 0;
            for (const product of products) {
                const qty = product.requestedQuantity || 1;
                const unit = product.requestedUnit || 'carton';
                if (unit === 'pieces') {
                    const pricePerPiece = product.price / (product.units_per_carton || 1);
                    grandTotal += pricePerPiece * qty;
                    totalUnits += qty / (product.units_per_carton || 1); // Convert to cartons for summary
                } else {
                    grandTotal += product.price * qty;
                    totalUnits += qty;
                }
            }
            
            response += `━━━━━━━━━━━━━━━━━━━━\n`;
            response += `📋 **Total Summary:**\n`;
            response += `   ${totalUnits.toFixed(1)} cartons total\n`;
            response += `   Grand Total: ₹${grandTotal.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}\n\n`;
        }
        
        // Only show volume discount info for new customers (no personalized pricing)
        if (!hasAnyPersonalizedPrice && totalCartons >= 11) {
            const discountPercent = totalCartons >= 100 ? '7-10%' : 
                                   totalCartons >= 51 ? '5-7%' :
                                   totalCartons >= 26 ? '3-5%' : '2-3%';
            response += `💡 **Volume Discount Eligible:** ${discountPercent} off for ${totalCartons} cartons!\n\n`;
        } else if (!hasAnyPersonalizedPrice) {
            response += "💡 **Volume Discounts Available:**\n";
            response += "• 11-25 cartons: 2-3% off\n";
            response += "• 26-50 cartons: 3-5% off\n";
            response += "• 51-100 cartons: 5-7% off\n";
            response += "• 100+ cartons: 7-10% off\n\n";
        }
        
        response += hasMultipleQuantities ? 
            "🛒 Ready to place this order? Just say 'yes' or 'add to cart'!" :
            "✅ To order any of these products, just let me know the quantities!";
        
        console.log('[MULTI_PRODUCT] Returning', products.length, 'products');
        console.log('[MULTI_PRODUCT] ⭐ Final return value:', {
            hasResponse: !!response,
            hasQuotedProducts: !!quotedProducts,
            quotedProductsCount: quotedProducts.length,
            quotedProductsPreview: JSON.stringify(quotedProducts).substring(0, 200)
        });
        
        return {
            response: response,
            quotedProducts: quotedProducts
        };
        
    } catch (error) {
        console.error('[MULTI_PRICE_HANDLER] Error:', error.message);
        return null;
    }
};

/**
 * FIXED: Handle price queries without triggering order processing
 */
const handlePriceQueriesFixed = async (query, tenantId, phoneNumber = null) => {
    // [LOG] Processing price handler query
    const cleanQuery = query.toLowerCase().trim();
    console.log('[PRICE_HANDLER] Customer phone:', phoneNumber || 'Not provided');
    // === CRITICAL: Detect ORDER intent (not just price inquiry with quantity) ===
    // Only treat as order if it has CLEAR order keywords like "need", "want", "order", "buy", "chahiye"
    const hasOrderIntent = /(?:need|want|order|buy|place|chahiye|mangao|bhejo|send me)\s+\d+/i.test(cleanQuery);
    const hasQuantity = /(\d+)\s*(?:ctns?|cartons?|pcs|pieces)/i.test(cleanQuery);
    const hasPriceKeyword = /price|prices|rate|cost|kitna|best\s+price|final\s+price/i.test(cleanQuery);
    
    // If has ORDER intent with quantity (e.g., "I want 10 ctns"), skip price handler
    if (hasOrderIntent && hasQuantity && !hasPriceKeyword) {
    // [LOG] Order intent detected, treating as order
        return null; // Let order processing handle it
    }
    // === CRITICAL FIX: Detect "i need price for" patterns FIRST ===
    const explicitPricePatterns = [
        /^how\s+much\s+for\s+(.+)$/i,                    // "how much for 10000 pieces of 10x100"
        /^i\s+need\s+prices?\s+for\s+(.+)$/i,            // "i need price(s) for 8x80, 8x100"
        /^need\s+prices?\s+for\s+(.+)$/i,                // "need price(s) for 8x80" (without "i")
        /^i\s+want\s+prices?\s+for\s+(.+)$/i,            // "i want price(s) for 8x80"  
        /^want\s+prices?\s+for\s+(.+)$/i,                // "want price(s) for 8x80" (without "i")
        /^prices?\s+for\s+(.+)$/i,                       // "price(s) for 8x80, 8x100"
        /^give\s+me\s+(?:final|best|your)?\s*prices?\s+for\s+(.+)$/i,  // "give me final price for 8x80"
        /^tell\s+me\s+prices?\s+for\s+(.+)$/i,           // "tell me price(s) for 8x80"
        /^what\s+is\s+prices?\s+for\s+(.+)$/i,           // "what is price(s) for 8x80"
        /^what\s+are\s+prices?\s+for\s+(.+)$/i,          // "what are prices for 8x80"
        /^best\s+prices?\s+for\s+(.+)$/i,                // "best price(s) for 8x80" or "best price for 10x100"
        /^final\s+prices?\s+for\s+(.+)$/i,               // "final price for 8x80 100 ctns"
        /^(.+)\s+ki\s+prices?\s+chahiye$/i,              // "8x80, 8x100 ki price(s) chahiye"
        /^(.+)\s+ka\s+rate\s+batao$/i,                   // "8x80 ka rate batao"
    ];
    // Check explicit price patterns first
    for (const pattern of explicitPricePatterns) {
        const match = cleanQuery.match(pattern);
        if (match && match[1]) {
            const productPart = match[1].trim();
            // [LOG] Explicit price pattern matched
            // Check if it contains multiple products (comma separated)
            if (productPart.includes(',')) {
                // [LOG] Multi-product price inquiry detected
                // --- PATCHED LOGIC FOR MULTI-PRODUCT PRICE/ORDER INTENT ---
                // Check if explicitly asking for prices (has price keywords)
                const hasPriceKeywords = /price|prices|rate|cost|kitna|batao/i.test(productPart);
                // Simulate quantity/order intent detection (for demo, use >1 product as proxy)
                const quantity = (productPart.match(/\d+/g) || []).length;
                const hasOrderIntent = /order|buy|need|chahiye|mangao|bhejo|send|supply|purchase|le lo|lo/i.test(productPart);

                // Only treat as order if NO price keywords present
                if (!hasPriceKeywords && quantity > 1 && hasOrderIntent) {
                    // [LOG] Order intent detected, not a price inquiry
                    return null;
                }

                // Continue with price response if price keywords present
                // [LOG] Price inquiry with quantity
                const multiResult = await handleMultiProductPriceInquiry(productPart, tenantId, phoneNumber);
                console.log('[SMART_ROUTER] Multi-product result:', {
                    hasResult: !!multiResult,
                    isObject: typeof multiResult === 'object',
                    hasResponse: !!(multiResult && multiResult.response),
                    hasQuotedProducts: !!(multiResult && multiResult.quotedProducts),
                    quotedProductsLength: multiResult?.quotedProducts?.length || 0
                });
                if (multiResult && typeof multiResult === 'object' && multiResult.response) {
                    console.log('[SMART_ROUTER] ✅ Returning structured response with quotedProducts');
                    return multiResult; // Return structured response with quotedProducts
                }
                return multiResult;
            }
            // Single product price inquiry
            const productCode = productPart.match(/(\d+[x*]\d+)/i);
            if (productCode) {
                const code = productCode[1].replace('*', 'x');
                const product = await findProductByCode(tenantId, code);
                if (product) {
                    const priceMessage = await formatProductPrice(product, tenantId, phoneNumber, cleanQuery);
                    
                    // Extract quantity from query if mentioned
                    const quantityMatch = cleanQuery.match(/(\d+)\s*(?:pcs?|pieces?|cartons?|ctns?)/i);
                    let quantity = 1;
                    let unit = 'carton';
                    
                    if (quantityMatch) {
                        const extractedQty = parseInt(quantityMatch[1]);
                        const extractedUnit = quantityMatch[0].match(/cartons?|ctns?/i) ? 'cartons' : 'pieces';
                        
                        // Convert pieces to cartons if needed
                        if (extractedUnit === 'pieces') {
                            const unitsPerCarton = parseInt(product.units_per_carton) || 1;
                            quantity = Math.ceil(extractedQty / unitsPerCarton);
                            unit = 'carton';
                            console.log(`[QUANTITY_CALC] Converted ${extractedQty} pieces to ${quantity} cartons (${unitsPerCarton} pcs/carton)`);
                        } else {
                            quantity = extractedQty;
                            unit = 'carton';
                        }
                    }
                    
                    console.log(`[QUOTED_PRODUCT_SAVE] Saving quotedProduct with quantity:`, quantity, 'type:', typeof quantity);
                    
                    // Quick Test
                    console.log('🔍 QUOTE DEBUG:', {
                        quantity: quantity,
                        unit: unit,
                        isPieces: unit === 'pieces',
                        calculation: unit === 'pieces' ? 
                            `${quantity} pieces` : 
                            `${quantity} cartons`
                    });
                    
                    // Return structured response with quotedProducts for context-based ordering
                    return {
                        response: priceMessage,
                        source: 'product_price',
                        quotedProducts: [{
                            productCode: code,
                            productName: product.name,
                            productId: product.id,
                            price: product.price,
                            quantity: quantity,
                            unit: unit,
                            unitsPerCarton: product.units_per_carton
                        }]
                    };
                } else {
                    return `Sorry, I couldn't find product "${code}" in our catalog. Please check the product code.`;
                }
            }
        }
    }
    // === ENHANCED MULTI-PRODUCT DETECTION ===
    // Detect patterns like "8x80, 8x100" with price keywords
    const productCodesInQuery = (cleanQuery.match(/\d+[x*]\d+/g) || []).map(code => code.replace('*', 'x'));
    const hasPriceKeywords = /price|rate|cost|kitna|batao|chahiye/.test(cleanQuery);
    const hasMultipleProducts = productCodesInQuery.length > 1;
    if (hasMultipleProducts && hasPriceKeywords) {
    // [LOG] Multi-product with price keywords detected
        const multiResult = await handleMultiProductPriceInquiry(cleanQuery, tenantId, phoneNumber);
        if (multiResult && typeof multiResult === 'object' && multiResult.response) {
            return multiResult;
        }
        return multiResult;
    }
    // === ORDER EXCLUSION PATTERNS (More Aggressive) ===
    const orderPatterns = [
        /i\s+need\s+\d+\s+(?:cartons|ctns|pieces|pcs)/i,  // "i need 5 cartons"
        /mujhe\s+\d+\s+(?:cartons|ctns)\s+chahiye/i,       // "mujhe 5 ctns chahiye"
        /\d+\s+ctns?\s+each/i,                              // "5 ctns each"
        /each\s+\d+\s+ctns?/i,                             // "each 5 ctns"
        /order\s+\d+/i,                                     // "order 10"
        /add\s+\d+/i,                                       // "add 5"
    ];
    // Test for order exclusions
    for (const pattern of orderPatterns) {
        if (pattern.test(cleanQuery)) {
            // [LOG] Order pattern detected, excluding from price handling
            return null;
        }
    }
    // Rest of existing logic for other price patterns...
    const priceOnlyPatterns = [
        /^(?:price|pricing|cost|rate|kitna|kya rate).*(?:chahiye|batao|bata|tell|give|hai)$/i,
        /^(?:chahiye|batao|bata|tell|give).*(?:price|pricing|cost|rate)$/i,
        /^.*(?:price|rate|cost).*(?:chahiye|batao|bata)(?:\s+(?:bhai|sir|ji))?$/i,
        /^(?:kya|kitna).*(?:price|rate|cost).*hai$/i,
        /^prices?\s+chahiye$/i,
        /^rate\s+(?:chahiye|batao)$/i,
        // Product-specific price queries
        /^(?:price|cost|rate|best\s+price).*(?:of|for)\s*(\d+[x*]\d+)(?:\s+(?:chahiye|batao|hai))?$/i,  // Added "best price"
        /^(\d+[x*]\d+).*(?:price|cost|rate)(?:\s+(?:chahiye|batao|hai))?$/i,
        /^(?:how much|kitna).*(\d+[x*]\d+)(?:\s+(?:chahiye|hai))?$/i,
        /^(\d+[x*]\d+).*(?:ka|ka price|kitna)(?:\s+(?:chahiye|hai))?$/i,
    ];
    let productCode = null;
    for (let i = 0; i < priceOnlyPatterns.length; i++) {
        const pattern = priceOnlyPatterns[i];
        const match = cleanQuery.match(pattern);
        if (match) {
            if (match[1]) {
                productCode = match[1].replace('*', 'x');
            }
            // [LOG] Price pattern matched for productCode
            break;
        }
    }
    if (!productCode && !priceOnlyPatterns.some(pattern => pattern.test(cleanQuery))) {
    // [LOG] No price patterns matched, returning null
        return null;
    }
    // Handle specific product or general pricing
    if (productCode) {
        const product = await findProductByCode(tenantId, productCode);
        if (product) {
            const priceMessage = await formatProductPrice(product, tenantId, phoneNumber, cleanQuery);
            
            // Extract quantity from query if mentioned
            const quantityMatch = cleanQuery.match(/(\d+)\s*(?:pcs?|pieces?|cartons?|ctns?)/i);
            let quantity = 1;
            let unit = 'carton';
            
            if (quantityMatch) {
                const extractedQty = parseInt(quantityMatch[1]);
                const extractedUnit = quantityMatch[0].match(/cartons?|ctns?/i) ? 'cartons' : 'pieces';
                
                // Convert pieces to cartons if needed
                if (extractedUnit === 'pieces') {
                    const unitsPerCarton = parseInt(product.units_per_carton) || 1;
                    quantity = Math.ceil(extractedQty / unitsPerCarton);
                    unit = 'carton';
                    console.log(`[QUANTITY_CALC_FALLBACK] Converted ${extractedQty} pieces to ${quantity} cartons (${unitsPerCarton} pcs/carton)`);
                } else {
                    quantity = extractedQty;
                    unit = 'carton';
                }
            }
            
            console.log(`[QUOTED_PRODUCT_SAVE_FALLBACK] Saving quotedProduct with quantity:`, quantity, 'type:', typeof quantity);
            
            // Return object with quotedProducts for context-based ordering
            return {
                response: priceMessage,
                source: 'product_price',
                quotedProducts: [{
                    productCode: productCode,
                    productName: product.name,
                    productId: product.id,
                    price: product.price,
                    quantity: quantity,
                    unit: unit,
                    unitsPerCarton: product.units_per_carton
                }]
            };
        } else {
            return `Sorry, I couldn't find product "${productCode}" in our catalog. Please check the product code.`;
        }
    }
    return await handleGeneralPriceInquiry(tenantId, query, phoneNumber);
};

/**
 * AI-POWERED: Intelligent query understanding (no regex, pure AI)
 */
const getSmartResponse = async (userQuery, tenantId, phoneNumber = null) => {
    console.log('[SMART_ROUTER] AI-powered processing for:', userQuery);
    console.log('[SMART_ROUTER] Customer phone:', phoneNumber || 'Not provided');
    
    // STEP 1: Use AI to understand what the customer wants
    const { openai } = require('./config');
    
    try {
        const understanding = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{
                role: 'system',
                content: `You are a product query analyzer. Analyze the customer's message and extract:
1. Intent: "price_inquiry", "availability_check", "specifications", "order_request", "discount_request", "brand_inquiry", or "general"
2. Product codes mentioned (e.g., "8x80", "10x140", "NFF 8x100")
3. Brand/Product lines mentioned (e.g., "NFF", "Nylon Anchors", "Nylon Frame")
4. Quantities if mentioned (e.g., "10 ctns", "1000 pieces")

IMPORTANT RULES:
- If message contains brand names like "NFF", "Nylon Anchors", "Nylon Frame" → intent should be "brand_inquiry"
- If the message contains multiple product codes (like "8x80 10 ctns, 8x100 5ctns"), prioritize "price_inquiry" even if discount terms are mentioned.
- Brand inquiries should return all products in that brand/line

Respond in JSON format:
{
  "intent": "price_inquiry" | "brand_inquiry" | "availability_check" | "specifications" | "order_request" | "discount_request" | "general",
  "products": ["8x80", "10x140"],
  "brands": ["NFF", "Nylon Anchors"],
  "quantities": [{"product": "8x80", "quantity": 10, "unit": "cartons"}],
  "confidence": 0.95
}`
            }, {
                role: 'user',
                content: userQuery
            }],
            response_format: { type: 'json_object' },
            temperature: 0.3
        });
        
        const parsed = JSON.parse(understanding.choices[0].message.content);
        console.log('[SMART_ROUTER] AI Understanding:', parsed);
        
        // STEP 2: Handle brand inquiries (e.g., "NFF", "Nylon Anchors")
        if (parsed.intent === 'brand_inquiry' && parsed.brands && parsed.brands.length > 0) {
            console.log('[SMART_ROUTER] Brand inquiry detected for:', parsed.brands);
            
            // Handle the first brand mentioned
            const brand = parsed.brands[0].toLowerCase();
            console.log('[SMART_ROUTER] Processing brand inquiry for:', brand);
            
            // Map common brand names to database search terms
            const brandMappings = {
                'nff': 'nff',
                'nylon': 'nylon',
                'nylon anchors': 'nylon',
                'nylon frame': 'nylon',
                'anchors': 'anchor',
                'frame': 'frame',
                'anchor': 'anchor'
            };
            
            const searchTerm = brandMappings[brand] || brand;
            console.log('[SMART_ROUTER] Searching for products with term:', searchTerm);
            
            // Fetch all products containing the brand term
            const { data: products } = await dbClient
                .from('products')
                .select('name, price, packaging_unit, units_per_carton')
                .eq('tenant_id', tenantId)
                .ilike('name', `%${searchTerm}%`)
                .order('name');
            
            if (products && products.length > 0) {
                let priceMsg = `Here are all ${parsed.brands[0]} products and their prices:\n\n`;
                for (const product of products) {
                    priceMsg += `*${product.name}*: ₹${product.price} per ${product.packaging_unit || 'carton'}`;
                    if (product.units_per_carton) priceMsg += ` (${product.units_per_carton} pcs/carton)`;
                    priceMsg += '\n';
                }
                priceMsg += '\nTo order, reply with the product code and quantity (e.g., "8x80 - 10 cartons").';
                
                return {
                    response: priceMsg,
                    source: 'brand_inquiry'
                };
            } else {
                return `No ${parsed.brands[0]} products found in our catalog.`;
            }
        }
        
        // STEP 3: Based on intent, fetch and display information
        if ((parsed.intent === 'price_inquiry' || (parsed.intent === 'discount_request' && parsed.products && parsed.products.length > 1)) && parsed.products && parsed.products.length > 0) {
            console.log('[SMART_ROUTER] Price inquiry detected for:', parsed.products);
            
            // DIRECTLY fetch pricing using AI-extracted product codes (NO pattern matching!)
            const productCodes = parsed.products.map(p => p.replace('*', 'x'));
            console.log('[SMART_ROUTER_AI] Fetching prices for AI-extracted products:', productCodes);
            
            if (productCodes.length === 1) {
                // Single product inquiry
                const code = productCodes[0];
                
                // 🆕 Check if this looks like a brand query (NFF, Nylon Anchors, Nylon Frame, etc.)
                const brandKeywords = ['nff', 'nylon', 'anchors', 'frame', 'anchor'];
                const isBrandQuery = brandKeywords.some(keyword => 
                    code.toLowerCase().includes(keyword) && 
                    !/\d/.test(code) // No numbers = likely a brand, not a product code
                );
                
                console.log('[SMART_ROUTER_AI] Brand detection for code:', code, 'isBrandQuery:', isBrandQuery);
                
                if (isBrandQuery) {
                    console.log('[SMART_ROUTER_AI] Detected brand query for:', code);
                    
                    // Fetch all products containing the brand term
                    const { data: products } = await dbClient
                        .from('products')
                        .select('name, price, packaging_unit, units_per_carton')
                        .eq('tenant_id', tenantId)
                        .ilike('name', `%${code}%`)
                        .order('name');
                    
                    if (products && products.length > 0) {
                        let priceMsg = `Here are all ${code.toUpperCase()} products and their prices:\n\n`;
                        for (const product of products) {
                            priceMsg += `*${product.name}*: ₹${product.price} per ${product.packaging_unit || 'carton'}`;
                            if (product.units_per_carton) priceMsg += ` (${product.units_per_carton} pcs/carton)`;
                            priceMsg += '\n';
                        }
                        priceMsg += '\nTo order, reply with the product code and quantity (e.g., "8x80 - 10 cartons").';
                        
                        return {
                            response: priceMsg,
                            source: 'ai_brand_inquiry'
                        };
                    } else {
                        return `No ${code.toUpperCase()} products found in our catalog.`;
                    }
                }
                
                // Regular product code search
                const product = await findProductByCode(tenantId, code);
                
                if (product) {
                    const priceMessage = await formatProductPrice(product, tenantId, phoneNumber, userQuery);
                    
                    // Extract quantity if mentioned
                    const quantityMatch = userQuery.match(/(\d+)\s*(?:pcs?|pieces?|cartons?|ctns?)/i);
                    let quantity = 1;
                    let unit = 'carton';
                    
                    if (quantityMatch) {
                        const extractedQty = parseInt(quantityMatch[1]);
                        const extractedUnit = quantityMatch[0].match(/cartons?|ctns?/i) ? 'cartons' : 'pieces';
                        
                        if (extractedUnit === 'pieces') {
                            const unitsPerCarton = parseInt(product.units_per_carton) || 1;
                            quantity = Math.ceil(extractedQty / unitsPerCarton);
                            console.log(`[AI_PRICE] Converted ${extractedQty} pieces to ${quantity} cartons`);
                        } else {
                            quantity = extractedQty;
                        }
                    }
                    
                    return {
                        response: priceMessage,
                        source: 'ai_direct_price',
                        quotedProducts: [{
                            productCode: code,
                            productName: product.name,
                            productId: product.id,
                            price: product.price,
                            quantity: quantity,
                            unit: unit,
                            unitsPerCarton: product.units_per_carton
                        }]
                    };
                } else {
                    return { 
                        response: `Sorry, I couldn't find product "${code}" in our catalog. Please check the product code.`,
                        source: 'ai_direct_price'
                    };
                }
            } else if (productCodes.length > 1) {
                // Multi-product inquiry
                console.log('[SMART_ROUTER_AI] Multi-product AI inquiry:', productCodes);
                console.log('[SMART_ROUTER_AI] AI extracted quantities:', parsed.quantities);
                
                // Pass the ORIGINAL QUERY and AI quantities to preserve quantity/unit information
                // The handleMultiProductPriceInquiry will use AI quantities when available
                const multiResult = await handleMultiProductPriceInquiry(userQuery, tenantId, phoneNumber, parsed.quantities);
                if (multiResult && typeof multiResult === 'object' && multiResult.response) {
                    return { ...multiResult, source: 'ai_direct_price' };
                }
                return multiResult;
            }
        }
        
        // STEP 3: If AI can't determine clear intent, use fallback handlers
        console.log('[SMART_ROUTER] No clear intent, trying specialized handlers...');
        
    } catch (aiError) {
        console.error('[SMART_ROUTER] AI understanding failed:', aiError.message);
        // Fall back to pattern-based handlers if AI fails
    }
    
    // FALLBACK: Pattern-based handlers (only if AI fails)
    const priceResponse = await handlePriceQueriesFixed(userQuery, tenantId, phoneNumber);
    if (priceResponse) {
        if (typeof priceResponse === 'object' && priceResponse.response) {
            return { 
                response: priceResponse.response, 
                source: 'database',
                quotedProducts: priceResponse.quotedProducts || []
            };
        } else if (typeof priceResponse === 'string') {
            return { response: priceResponse, source: 'database' };
        }
    }

    const availabilityResponse = await handleAvailabilityQueries(userQuery, tenantId);
    if (availabilityResponse) return { response: availabilityResponse, source: 'database' };

    const specsResponse = await handleSpecQueries(userQuery, tenantId);
    if (specsResponse) return { response: specsResponse, source: 'database' };

    const businessResponse = await handleBusinessQueries(userQuery, tenantId);
    if (businessResponse) return { response: businessResponse, source: 'cached' };

    console.log('[SMART_ROUTER_DEBUG] NO RESPONSE FOUND - returning null');
    console.log('[SMART_ROUTER_DEBUG] ==========================================');
    return null; // No smart response available, use AI
};

const handleGeneralPriceInquiry = async (tenantId, query, phoneNumber = null) => {
    try {
        // Get a few popular products to show pricing
        const { data: products } = await dbClient
            .from('products')
            .select('id, name, price, units_per_carton, packaging_unit')
            .eq('tenant_id', tenantId)
            .eq('is_active', true)
            .limit(5);
            
        if (!products || products.length === 0) {
            return "Please contact us for current pricing information.";
        }
        
        let response = "📋 **Current Pricing:**\n\n";
        products.forEach(product => {
            const unitsPerCarton = parseInt(product.units_per_carton) || 1;
            const pricePerPiece = (product.price / unitsPerCarton).toFixed(2);
            
            response += `📦 **${product.name}**\n`;
            response += `🔹 ₹${pricePerPiece}/pc per piece\n`;
            response += `📦 *₹${product.price}/${product.packaging_unit || 'carton'}*\n`;
            response += `   (${unitsPerCarton} pcs/${product.packaging_unit || 'carton'})\n\n`;
        });
        
        response += "💬 For specific products, ask: 'price of [product name]'";
        return response;
        
    } catch (error) {
        console.error('[PRICE_HANDLER] Error in general price inquiry:', error.message);
        return "Please contact us for current pricing information.";
    }
};
/**
 * Format individual product price response with personalized pricing
 */
const formatProductPrice = async (product, tenantId, phoneNumber = null, originalQuery = '') => {
    try {
        console.log('[FORMAT_PRICE] Product:', product.name, 'Phone:', phoneNumber || 'Not provided');
        
        // If phoneNumber is provided, use personalized pricing
        if (phoneNumber && product.id) {
            const priceDisplay = await formatPersonalizedPriceDisplay(tenantId, phoneNumber, product.id);
            if (priceDisplay) {
                console.log('[FORMAT_PRICE] Using personalized pricing for returning customer');
                return createPriceMessage(priceDisplay, true, originalQuery); // Pass originalQuery for quantity detection
            }
        }
        
        // Fallback to basic pricing if no phoneNumber or personalization unavailable
        console.log('[FORMAT_PRICE] Using basic pricing display');
        const unitsPerCarton = parseInt(product.units_per_carton) || 1;
        const pricePerPiece = (product.price / unitsPerCarton).toFixed(2);
        
        // Check if quantity was mentioned in the original query
        const quantityMatch = originalQuery.match(/(\d+)\s*(?:pcs?|pieces?|cartons?|ctns?)/i);
        let response = `📦 *${product.name}*\n\n`;
        response += `💵 *Price*\n`;
        response += `━━━━━━━━━━━━━━━━━\n`;
        response += `🔹 *₹${pricePerPiece}/pc* per piece\n`;
        response += `📦 *₹${product.price}/${product.packaging_unit || 'carton'}*\n\n`;
        
        if (quantityMatch) {
            const quantity = parseInt(quantityMatch[1]);
            const unit = quantityMatch[0].match(/cartons?|ctns?/i) ? 'cartons' : 'pieces';
            
            let finalQuantity, totalAmount;
            if (unit === 'pieces') {
                // Convert pieces to cartons - show exact then rounded
                const exactCartons = (quantity / unitsPerCarton).toFixed(2);
                const roundedCartons = Math.ceil(quantity / unitsPerCarton);
                finalQuantity = roundedCartons;
                totalAmount = (roundedCartons * product.price).toFixed(2);
                
                response += `📊 *Quote for ${quantity.toLocaleString('en-IN')} pieces:*\n`;
                response += `   ${quantity.toLocaleString('en-IN')} pcs ÷ ${unitsPerCarton} pcs/carton = ${exactCartons} cartons\n`;
                response += `   (Rounded to ${roundedCartons} carton${roundedCartons !== 1 ? 's' : ''})\n`;
                response += `   ${roundedCartons} carton${roundedCartons !== 1 ? 's' : ''} × ₹${product.price.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})} = *₹${parseFloat(totalAmount).toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}*\n\n`;
            } else {
                // Already in cartons
                finalQuantity = quantity;
                totalAmount = (quantity * product.price).toFixed(2);
                
                response += `📊 *Quote for ${quantity} carton${quantity !== 1 ? 's' : ''}:*\n`;
                response += `   ${quantity} carton${quantity !== 1 ? 's' : ''} × ₹${product.price.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})} = *₹${parseFloat(totalAmount).toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}*\n\n`;
            }
            
            response += `💡 *Volume Discounts:*\n`;
            response += `* 11-25 ctns: 2-3% • 26-50 ctns: 3-5%\n`;
            response += `* 51-100 ctns: 5-7% • 100+ ctns: 7-10%\n\n`;
            response += `🛒 Ready to add ${quantity.toLocaleString('en-IN')} ${unit} to your cart? Just say "yes"!`;
        } else {
            response += `📊 *Breakdown:*\n`;
            response += `   ₹${pricePerPiece}/pc × ${unitsPerCarton} pcs = ₹${product.price}/${product.packaging_unit || 'carton'}\n\n`;
            response += `💡 *Volume Discounts:*\n`;
            response += `* 11-25 ctns: 2-3% • 26-50 ctns: 3-5%\n`;
            response += `* 51-100 ctns: 5-7% • 100+ ctns: 7-10%\n\n`;
            response += `🛒 Ready to order? Let me know the quantity!`;
        }
        
        return response;
        
    } catch (error) {
        console.error('[FORMAT_PRICE] Error:', error.message);
        // Fallback to simple format
        let response = `💰 **${product.name} Pricing**\n\n`;
        response += `Price: ₹${product.price}/carton\n`;
        
        if (product.units_per_carton && product.units_per_carton > 1) {
            const perPiece = (product.price / product.units_per_carton).toFixed(2);
            response += `Carton contains: ${product.units_per_carton} pieces\n`;
            response += `Per piece: ₹${perPiece}\n`;
        }
        
        response += `\nReady to place an order? Just let me know the quantity!`;
        return response;
    }
};
/**
 * Handle availability queries
 */
const handleAvailabilityQueries = async (query, tenantId) => {
    const availabilityPatterns = [
        /(?:available|stock|have|hain|hai).*(\d+[x*]\d+)/i,
        /(\d+[x*]\d+).*(?:available|stock|milega|hain|hai)/i,
        /(?:aapke paas|do you have|paas).*(\d+[x*]\d+)/i,
        /(\d+[x*]\d+)\s+(?:hain|hai)/i  // Direct pattern like "8x80 hain"
    ];
    
    console.log('[AVAILABILITY] Checking query:', query);
    
    for (const pattern of availabilityPatterns) {
        const match = query.match(pattern);
        if (match) {
            const productCode = match[1].replace('*', 'x');
            console.log('[AVAILABILITY] Matched pattern, looking up:', productCode);
            const product = await findProductByCode(tenantId, productCode);
            
            if (product) {
                console.log('[AVAILABILITY] Product found:', product.name);
                return `✅ **Haan, ${product.name} available hai!**\n\nPrice: ₹${product.price}/carton\n${product.units_per_carton ? `(${product.units_per_carton} pcs/carton)\n` : ''}\nKitne cartons chahiye?`;
            } else {
                console.log('[AVAILABILITY] Product not found:', productCode);
                return `❌ Sorry, ${productCode} is not available in our current catalog. Please check other sizes.`;
            }
        }
    }
    console.log('[AVAILABILITY] No pattern matched');
    return null;
};

// Handle specification queries
const handleSpecQueries = async (query, tenantId) => {
    const specPatterns = [
        /(?:specs|specifications|details).*(\d+[x*]\d+)/i,
        /(\d+[x*]\d+).*(?:specs|details|information)/i,
        /(?:tell me about|kya hai).*(\d+[x*]\d+)/i
    ];
    
    for (const pattern of specPatterns) {
        const match = query.match(pattern);
        if (match) {
            const productCode = match[1].replace('*', 'x');
            const product = await findProductByCode(tenantId, productCode);
            
            if (product) {
                let response = `📋 **${product.name} Specifications**\n\n`;
                response += `• Price: ₹${product.price}/carton\n`;
                response += `• Carton size: ${product.units_per_carton || 1} pieces\n`;
                response += `• Per piece: ₹${(product.price / (product.units_per_carton || 1)).toFixed(2)}\n`;
                if (product.description) {
                    response += `\n${product.description}`;
                }
                return response;
            }
        }
    }
    return null;
}

// Handle business queries with cached responses
const handleBusinessQueries = async (query, tenantId) => {
    const businessPatterns = [
        { pattern: /(?:delivery|shipping|transport)/i, response: "🚛 We provide delivery across major cities. Delivery time: 2-3 business days. Free delivery on orders above ₹10,000." },
        { pattern: /(?:payment|pay|paisa)/i, response: "💳 We accept bank transfer, UPI, and cash on delivery. Payment details shared after order confirmation." },
        { pattern: /(?:minimum|min).*(?:order|quantity)/i, response: "📦 Minimum order: 1 carton per product. Bulk discounts available on larger quantities." },
        { pattern: /(?:company|business|about)/i, response: "🏢 We are a leading supplier with 10+ years experience. Quality guaranteed on all products." }
    ];
    
    for (const { pattern, response } of businessPatterns) {
        if (pattern.test(query)) {
            return response;
        }
    }
    return null;
};

/**
 * Find product by code (enhanced version)
 */
// =============================================================================
// FIX 1: Enhanced findProductByCode in smartResponseRouter.js
// =============================================================================

/**
 * Find product by code (enhanced version with exact pattern matching)
 */
const findProductByCode = async (tenantId, productCode) => {
    try {
        console.log('[PRODUCT_SEARCH] Looking for product code:', productCode);
        const code = productCode.trim().toLowerCase();
        
        // First, try exact matches with common patterns
        const exactPatterns = [
            `NFF ${productCode}`,
            `NFF-${productCode}`,
            `NFF ${productCode.toUpperCase()}`,
            `NFF ${productCode.toLowerCase()}`
        ];
        
        for (const pattern of exactPatterns) {
            const { data: exactMatch } = await dbClient
                .from('products')
                .select('*')
                .eq('tenant_id', tenantId)
                .eq('is_active', true)
                .eq('name', pattern)
                .single();
            
            if (exactMatch) {
                console.log('[PRODUCT_SEARCH] Found exact match:', exactMatch.name);
                return exactMatch;
            }
        }
        
        // If no exact match, try pattern matching but be more specific
        const { data: products } = await dbClient
            .from('products')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('is_active', true)
            .ilike('name', `%${code}%`)
            .neq('price', 0);

        if (!products || products.length === 0) {
            console.log('[PRODUCT_SEARCH] No products found for code:', productCode);
            return null;
        }

        // Filter to find the most specific match
        // Prioritize products where the code appears at word boundaries
        const exactCodeMatch = products.find(product => {
            const name = (product.name || '').toLowerCase();
            // Check if the exact code appears (not as part of another number)
            return name.includes(` ${code}`) || 
                   name.endsWith(code) || 
                   name.includes(`-${code}`);
        });

        if (exactCodeMatch) {
            console.log('[PRODUCT_SEARCH] Found specific match:', exactCodeMatch.name);
            return exactCodeMatch;
        }

        console.log('[PRODUCT_SEARCH] No suitable product found for:', productCode);
        return null;
    } catch (error) {
        console.error('[PRODUCT_SEARCH] Error finding product:', error.message);
        return null;
    }
};

// Ensure all exported functions are defined at the top level
// (No changes to function bodies, just a comment for clarity)
module.exports = {
    getSmartResponse,
    handlePriceQueriesFixed,
    handleAvailabilityQueries,
    handleBusinessQueries,
    findProductByCode
};


