// Import handlePriceQueriesFixed and handleMultiProductPriceInquiry from smartResponseRouter.js
const { handlePriceQueriesFixed, handleMultiProductPriceInquiry } = require('./smartResponseRouter');
/**
 * Safely parse context_data (handles both string and object)
 */
function safeParseContextData(contextData) {
    if (!contextData) return {};
    
    // Already an object
    if (typeof contextData === 'object' && contextData !== null) {
        return contextData;
    }
    
    // String - needs parsing
    if (typeof contextData === 'string') {
        try {
            return JSON.parse(contextData);
        } catch (e) {
            console.error('[CONTEXT_PARSE] Invalid JSON:', e.message);
            return {};
        }
    }
    
    // Unknown type
    return {};
}
/**
 * Detect if a query is a price inquiry (NOT an order)
 * Returns true if the query is only asking for price, not placing an order
 */
const isPriceInquiryOnly = (userQuery) => {
    const cleanQuery = userQuery.toLowerCase().trim();
    // === CRITICAL: Detect combined price + quantity queries ===
    const hasPriceKeyword = /price|prices|rate|cost|kitna/i.test(cleanQuery);
    const hasQuantity = /(\d+)\s*(?:ctns?|cartons?|pcs|pieces)/i.test(cleanQuery);
    if (hasPriceKeyword && hasQuantity) {
        // If both price and quantity, treat as order, not price inquiry
        return false;
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
    for (const pattern of orderPatterns) {
        if (pattern.test(cleanQuery)) {
            return false;
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
        /^(?:price|cost|rate).*(?:of|for)\s*(\d+[x*]\d+)(?:\s+(?:chahiye|batao|hai))?$/i,
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
            // If it matches a price pattern and not an order, it's a price inquiry
            return true;
        }
    }
    // If no price patterns matched, not a price inquiry
    return false;
};
// services/smartOrderExtractionService.js - COMPLETE FIXED VERSION
const { dbClient } = require('./config');
const { getAIResponse } = require('./aiService');

// ...existing code...

/**
 * Handle general price inquiries when no specific product is mentioned
 */
const handleGeneralPriceInquiry = async (tenantId, query) => {
    try {
        // Get a few popular products to show pricing
        const { data: products } = await dbClient
            .from('products')
            .select('name, price, units_per_carton')
            .eq('tenant_id', tenantId)
            .eq('is_active', true)
            .gt('price', 0) // Only valid priced products
            .limit(5);
            
        if (!products || products.length === 0) {
            return "Please contact us for current pricing information.";
        }
        
        let response = "📋 **Current Pricing:**\n\n";
        products.forEach(product => {
            response += `**${product.name}**: ₹${product.price}/carton`;
            if (product.units_per_carton) {
                const perPiece = (product.price / product.units_per_carton).toFixed(2);
                response += ` (₹${perPiece}/piece)\n`;
            } else {
                response += '\n';
            }
        });
        
        response += "\nFor specific products, ask: 'price of [product name]'";
        return response;
        
    } catch (error) {
        console.error('[PRICE_HANDLER] Error in general price inquiry:', error.message);
        return "Please contact us for current pricing information.";
    }
};

/**
 * Format individual product price response
 */
const formatProductPrice = async (tenantId, endUserPhone, product) => {
    // Check for approved discount in conversation context
    let approvedDiscount = null;
    try {
        const { data: conversation } = await dbClient
            .from('conversations_new')
            .select('context_data')
            .eq('tenant_id', tenantId)
            .eq('end_user_phone', endUserPhone)
            .single();
        if (conversation && conversation.context_data) {
            const contextData = safeParseContextData(conversation.context_data);
            if (contextData.approvedDiscount && contextData.approvedDiscount > 0) {
                approvedDiscount = contextData.approvedDiscount;
            }
        }
    } catch (e) {}

    let priceToShow = product.price;
    let discountLine = '';
    if (approvedDiscount) {
        const discounted = (product.price * (1 - approvedDiscount / 100)).toFixed(2);
        discountLine = `Discounted Price: ₹${discounted}/carton (\u2193${approvedDiscount}% OFF)\n`;
        priceToShow = discounted;
    }

    let response = `💰 **${product.name} Pricing**\n\n`;
    response += `Price: ₹${product.price}/carton\n`;
    if (discountLine) response += discountLine;
    if (product.units_per_carton && product.units_per_carton > 1) {
        const perPiece = (priceToShow / product.units_per_carton).toFixed(2);
        response += `Carton contains: ${product.units_per_carton} pieces\n`;
        response += `Per piece: ₹${perPiece}\n`;
    }
    response += `\nReady to place an order? Just let me know the quantity!`;
    return response;
};

/**
 * CRITICAL FIX: Enhanced findProductByCode with strict matching to prevent duplicates
 */
const findProductByCodeStrict = async (tenantId, productCode) => {
    try {
        console.log('[PRODUCT_SEARCH_STRICT] Searching for:', productCode);
        
        if (!productCode || productCode === 'undefined') {
            return null;
        }
        
        const cleanIdentifier = String(productCode).trim().toLowerCase();
        
        // Get all active products with non-zero prices
        const { data: products, error } = await dbClient
            .from('products')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('is_active', true)
            .gt('price', 0) // CRITICAL: Only get products with price > 0
            .order('name');
            
        if (error || !products || products.length === 0) {
            console.log('[PRODUCT_SEARCH_STRICT] No valid products found for tenant');
            return null;
        }
        
        console.log(`[PRODUCT_SEARCH_STRICT] Found ${products.length} valid products to search through`);
        
        // STRICT MATCHING STRATEGIES (in order of preference)
        
        // 1. EXACT name match (highest priority)
        const exactMatch = products.find(p => 
            p.name.toLowerCase() === cleanIdentifier
        );
        if (exactMatch) {
            console.log('[PRODUCT_SEARCH_STRICT] Found EXACT match:', exactMatch.name);
            return exactMatch;
        }
        
        // 2. Product code pattern match (for codes like "8x80", "8*80", "8x100")
        // Normalize * to x for searching
        const normalizedIdentifier = cleanIdentifier.replace('*', 'x');
        if (/^\d+[x*]\d+$/i.test(cleanIdentifier)) {
            // First try: NFF + code pattern
            const nffMatch = products.find(p => {
                const name = p.name.toLowerCase();
                return name.includes('nff') && name.includes(normalizedIdentifier);
            });
            if (nffMatch) {
                console.log('[PRODUCT_SEARCH_STRICT] Found NFF pattern match:', nffMatch.name);
                return nffMatch;
            }
            
            // Second try: Any product containing the code (but prefer shortest name)
            const codeMatches = products.filter(p => 
                p.name.toLowerCase().includes(normalizedIdentifier)
            );
            
            if (codeMatches.length > 0) {
                // Sort by name length to prefer simpler names (NFF 8x80 over CTN-8x80-Pentagon)
                codeMatches.sort((a, b) => a.name.length - b.name.length);
                
                // Filter out products with unwanted terms
                const filtered = codeMatches.filter(p => {
                    const name = p.name.toLowerCase();
                    const unwantedTerms = ['pentagon', 'techfast', 'ctn-'];
                    return !unwantedTerms.some(term => name.includes(term));
                });
                
                const selectedProduct = filtered.length > 0 ? filtered[0] : codeMatches[0];
                console.log('[PRODUCT_SEARCH_STRICT] Found code match:', selectedProduct.name);
                return selectedProduct;
            }
        }
        
        // 3. Fallback: Contains match (with filtering)
        const containsMatches = products.filter(p => {
            const name = p.name.toLowerCase();
            return name.includes(cleanIdentifier) || cleanIdentifier.includes(name);
        });
        
        if (containsMatches.length > 0) {
            // Filter out products with unwanted terms and sort by preference
            const filtered = containsMatches
                .filter(p => {
                    const name = p.name.toLowerCase();
                    const unwantedTerms = ['pentagon', 'techfast', 'ctn-'];
                    return !unwantedTerms.some(term => name.includes(term));
                })
                .sort((a, b) => {
                    // Prefer products that start with "NFF"
                    const aStartsWithNFF = a.name.toLowerCase().startsWith('nff');
                    const bStartsWithNFF = b.name.toLowerCase().startsWith('nff');
                    
                    if (aStartsWithNFF && !bStartsWithNFF) return -1;
                    if (!aStartsWithNFF && bStartsWithNFF) return 1;
                    
                    // Then prefer shorter names
                    return a.name.length - b.name.length;
                });
            
            if (filtered.length > 0) {
                console.log('[PRODUCT_SEARCH_STRICT] Found filtered match:', filtered[0].name);
                return filtered[0];
            }
        }
        
        console.log('[PRODUCT_SEARCH_STRICT] No suitable product found for:', cleanIdentifier);
        return null;
        
    } catch (error) {
        console.error('[PRODUCT_SEARCH_STRICT] Error:', error.message);
        return null;
    }
};

/**
 * FIXED: Multi-product extraction with proper pieces detection
 */
const extractOrderDetailsFallback = (userQuery) => {
    console.log('[FALLBACK_EXTRACT] Processing query:', userQuery);
    
    // CRITICAL FIX: Don't process bot responses as user queries
    if (userQuery.includes('**Current Pricing:**') || 
        userQuery.includes('**Requested Product Prices:**') ||
        userQuery.includes('For specific products, ask:') ||
        userQuery.includes('🛒') || 
        userQuery.includes('₹') ||
        userQuery.includes('**Pricing:**') ||
        userQuery.includes('Ready to place an order?')) {
        console.log('[FALLBACK_EXTRACT] Bot response detected, skipping extraction');
        return null;
    }
    
    const cleanQuery = userQuery.toLowerCase().trim();
    console.log('[FALLBACK_EXTRACT] Clean query:', cleanQuery);
    
    // PRIORITY 1: Price inquiry detection (NOT an order)
    if (isPriceInquiryOnly(userQuery)) {
        console.log('[FALLBACK_EXTRACT] Price inquiry detected, not an order');
        return null; // Don't treat as order
    }
    
    // PRIORITY 2: Quantity-only patterns (context-based orders like "10ctns" or "1lac pcs")
    // This is for follow-up orders after product inquiry
    
    // First check for lac/lakh patterns (1 lac = 100,000)
    const lacPattern = /^(\d+)\s*(?:lac|lakh)\s*(?:ctns?|cartons?|pcs?|pieces?)$/i;
    const lacMatch = cleanQuery.match(lacPattern);
    if (lacMatch) {
        const lacQuantity = parseInt(lacMatch[1]) * 100000; // Convert lac to actual number
        console.log('[FALLBACK_EXTRACT] Lac/Lakh quantity pattern detected:', lacMatch[0], '=> Quantity:', lacQuantity);
        return {
            isContextOrder: true,
            quantity: lacQuantity,
            unit: determineUnitFixed(lacMatch[0]),
            originalText: cleanQuery,
            extractionMethod: 'context_based_lac_quantity'
        };
    }
    
    // Then check for regular quantity patterns
    const quantityOnlyPattern = /^(\d+)\s*(?:ctns?|cartons?|pcs?|pieces?)$/i;
    const quantityOnlyMatch = cleanQuery.match(quantityOnlyPattern);
    if (quantityOnlyMatch) {
        console.log('[FALLBACK_EXTRACT] Quantity-only pattern detected:', quantityOnlyMatch[0]);
        // Return a marker that this needs conversation context
        // The handler will need to get last_product_discussed from conversation
        return {
            isContextOrder: true,
            quantity: parseInt(quantityOnlyMatch[1]),
            unit: determineUnitFixed(quantityOnlyMatch[0]),
            originalText: cleanQuery,
            extractionMethod: 'context_based_quantity'
        };
    }
    
    // ENHANCED: Multi-product detection with strict parsing

    // === NEW: Remove regex for 'each' pattern, use string splitting and normalization ===
    // Handles: multi-line or comma/space separated products, each with its own quantity/unit
    // e.g. "8x80 10 ctns\n8x100 5ctns\n10x100 3ctns\n10*120-5000pcs"
    const lines = cleanQuery.split(/\n|,/).map(l => l.trim()).filter(Boolean);
    const products = [];
    for (let line of lines) {
        // Try to extract product code, quantity, and unit from each line
        // Match: code [dash/space] quantity [unit]
        // e.g. "10*120-5000pcs", "8x80 10 ctns", "8x100 5ctns"
        let match = line.match(/(\d+[x*]\d+)[ \-\:]*(?:([\d,]+)(ctns?|cartons?|pcs?|pieces?)?)?/i);
        
        // Try reverse order: "10 cartons 8x100" or "5ctns 8x100"
        if (!match || !match[2]) {
            match = line.match(/([\d,]+)\s*(ctns?|cartons?|pcs?|pieces?)\s+(\d+[x*]\d+)/i);
            if (match) {
                // Reorder to match expected format [productCode, quantity, unit]
                match = [match[0], match[3], match[1], match[2]];
            }
        }
        
        if (match) {
            let code = match[1].replace('*', 'x');
            let quantity = match[2] ? parseInt(match[2].replace(/,/g, '')) : 1;
            let unit = match[3] ? determineUnitFixed(match[3]) : 'cartons';
            products.push({
                productCode: code,
                productName: code,
                quantity,
                unit,
                isPieces: unit === 'pieces',
                originalText: line
            });
        } else {
            console.log('[EXTRACT_DEBUG] No match for line:', line);
        }
    }
    if (products.length > 1) {
        console.log('[FALLBACK_EXTRACT] [PER-LINE] Multi-product extracted:', products);
        return {
            isMultipleProducts: true,
            orders: products,
            originalText: cleanQuery,
            extractionMethod: 'per_line_multi'
        };
    } else if (products.length === 1) {
        // Fallback to single product extraction
        return {
            isMultipleProducts: false,
            ...products[0],
            originalText: cleanQuery,
            extractionMethod: 'per_line_single'
        };
    }
    
    // Try Pattern 2 & 3: Individual product-quantity pairs
    // const individualMatches = [...cleanQuery.matchAll(multiProductPatterns[2])];
    // 
    // if (individualMatches.length > 1) {
    //     console.log('[FALLBACK_EXTRACT] Individual pairs pattern detected:', individualMatches.length, 'products');
    //     
    //     const products = individualMatches.map(match => {
    //         const productCode = match[1].trim();
    //         const quantity = parseInt(match[2]);
    //         const unit = determineUnitFixed(match[0]);
    //         
    //         return {
    //             productCode,
    //             productName: productCode,
    //             quantity,
    //             unit,
    //             isPieces: unit === 'pieces',
    //             originalText: match[0]
    //         };
    //     });
    //     
    //     return {
    //         isMultipleProducts: true,
    //         orders: products,
    //         originalText: cleanQuery,
    //         extractionMethod: 'regex_multi_individual'
    //     };
    // }
    
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
            console.log('[FALLBACK_EXTRACT] ORDER PATTERN DETECTED - EXCLUDING FROM PRICE HANDLING');
            return null;
        }
    }
    
    // Single product patterns (existing logic)
    const singlePatterns = [
        // NEW: "I want 10 cartons 8x100" - quantity BEFORE product code
        {
            regex: /(?:i\s+want|add|need|give|send)\s+(\d+)\s*(ctns?|cartons?|pcs?|pieces?)\s+([a-zA-Z0-9x*]+)/i,
            extract: (match) => {
                const unit = determineUnitFixed(match[2]);
                return {
                    isMultipleProducts: false,
                    productCode: match[3].trim().replace('*', 'x'),
                    quantity: parseInt(match[1]),
                    unit,
                    isPieces: unit === 'pieces',
                    originalText: match[0]
                };
            }
        },
        {
            regex: /(?:i\s+want|add|need)\s+([a-zA-Z0-9x*]+)\s*[-–—]\s*(\d+)\s*(pcs?|pieces?|ctns?|cartons?)/i,
            extract: (match) => ({
                isMultipleProducts: false,
                productCode: match[1].trim(),
                quantity: parseInt(match[2]),
                unit: determineUnitFixed(match[0]),
                isPieces: /pcs?|pieces?/i.test(match[3]),
                originalText: match[0]
            })
        },
        {
            regex: /(\d+[x*]\d+)\s*[-–—]\s*(\d+)\s*(?:ctns?|cartons?|pieces?|pcs?)/i,
            extract: (match) => {
                const unit = determineUnitFixed(match[0]);
                return {
                    isMultipleProducts: false,
                    productCode: match[1].trim(),
                    quantity: parseInt(match[2]),
                    unit,
                    isPieces: unit === 'pieces',
                    originalText: match[0]
                };
            }
        },
        // "add another PRODUCT NUMBER pcs" - EXPLICIT PIECES
        {
            regex: /(?:add|dd)\s+(?:another\s+)?([a-zA-Z0-9x*\s]+?)\s+(\d+)\s*(?:pcs?|pieces?)/i,
            extract: (match) => ({
                isMultipleProducts: false,
                productCode: match[1].trim(),
                quantity: parseInt(match[2]),
                unit: 'pieces',
                isPieces: true,
                originalText: match[0]
            })
        },
        
        // "dd/add PRODUCT - NUMBER pcs" (PIECES with dash)
        {
            regex: /(?:dd|add|need)\s+([a-zA-Z0-9x*\s]+?)\s*[-–—]\s*(\d+)\s*(?:pcs?|pieces?)/i,
            extract: (match) => ({
                isMultipleProducts: false,
                productCode: match[1].trim(),
                quantity: parseInt(match[2]),
                unit: 'pieces',
                isPieces: true,
                originalText: match[0]
            })
        },
        
        // "dd/add PRODUCT - NUMBER ctns" (CARTONS with dash)
        {
            regex: /(?:dd|add|need)\s+([a-zA-Z0-9x*\s]+?)\s*[-–—]\s*(\d+)\s*(?:ctns?|cartons?)/i,
            extract: (match) => ({
                isMultipleProducts: false,
                productCode: match[1].trim(),
                quantity: parseInt(match[2]),
                unit: 'cartons',
                isPieces: false,
                originalText: match[0]
            })
        },
        
        // Generic dash pattern with FIXED unit detection
        {
            regex: /([a-zA-Z0-9x*\s]+?)\s*[-–—]\s*(\d+)\s*(?:ctns?|cartons?|pieces?|pcs?|units?)/i,
            extract: (match) => {
                const unit = determineUnitFixed(match[0]);
                return {
                    isMultipleProducts: false,
                    productCode: match[1].trim(),
                    quantity: parseInt(match[2]),
                    unit,
                    isPieces: unit === 'pieces',
                    originalText: match[0]
                };
            }
        }
    ];
    
    // Test patterns
    for (const pattern of singlePatterns) {
        const match = cleanQuery.match(pattern.regex);
        if (match) {
            console.log('[FALLBACK_EXTRACT] Single product pattern matched');
            const result = pattern.extract(match);
            
            // Validate product identifier
            if (result.productCode && result.productCode.length > 0 && 
                result.productCode !== 'to the order' && 
                result.productCode !== 'another') {
                
                console.log('[FALLBACK_EXTRACT] Valid product result:', result);
                return result;
            }
        }
    }
    
    console.log('[FALLBACK_EXTRACT] No pattern matched for query:', cleanQuery);
    return null;
};

/**
 * FIXED: More aggressive piece detection
 */
const determineUnitFixed = (matchedText) => {
    const text = matchedText.toLowerCase();
    
    // Explicit pieces detection - CHECK FIRST
    if (text.includes('piece') || text.includes('pcs') || text.includes('pc') || /\d+\s*pcs?\b/i.test(text)) {
        console.log('[UNIT_DETECT] Detected PIECES in:', text);
        return 'pieces';
    }
    
    // Explicit carton detection
    if (text.includes('carton') || text.includes('ctn') || /\d+\s*ctns?\b/i.test(text)) {
        console.log('[UNIT_DETECT] Detected CARTONS in:', text);
        return 'cartons';
    }
    
    // Default to cartons (safer for business)
    console.log('[UNIT_DETECT] Defaulting to CARTONS for:', text);
    return 'cartons';
};

/**
 * Enhanced AI extraction with better product matching
 */
const extractOrderDetailsAI = async (userQuery, tenantId) => {
    try {
        console.log('[SMART_EXTRACT] AI processing query:', userQuery);
        
        // Skip AI for price inquiries
        if (isPriceInquiryOnly(userQuery)) {
            console.log('[SMART_EXTRACT] Price inquiry, skipping AI extraction');
            return null;
        }
        
        // Get available products for this tenant
        const { data: products } = await dbClient
            .from('products')
            .select('name, id, description, price, units_per_carton')
            .eq('tenant_id', tenantId)
            .eq('is_active', true)
            .gt('price', 0) // Only valid priced products
            .limit(50);
        
        if (!products || products.length === 0) {
            console.log('[SMART_EXTRACT] No products found for tenant');
            return null;
        }
        
        // Create dynamic product context
        const productList = products.map(p => `"${p.name}" (₹${p.price})`).join(', ');
        
        // Enhanced AI prompt with explicit unit handling
        const extractionPrompt = `
You are an order processing AI for a business. Extract product orders from customer messages.

AVAILABLE PRODUCTS FOR THIS BUSINESS:
${productList}

Customer message: "${userQuery}"

CRITICAL RULES:
1. If the message is asking for prices only (like "prices chahiye"), respond with {"hasOrder": false}
2. Match customer input to exact product names available above - DO NOT modify product codes
3. For quantities: "pcs" or "pieces" = pieces unit, "ctns" or "cartons" = cartons unit
4. Extract multiple products if separated by commas, "and", or new lines
5. UNIT DETECTION IS CRITICAL: "10000pcs" = 10000 pieces, "10ctns" = 10 cartons
6. Only include products that exist in the available products list above
7. IMPORTANT: When quantity appears AFTER multiple products, apply it to ALL products
8. IMPORTANT: Extract product codes EXACTLY as written - do not change "8x100" to "10x100"

EXAMPLES:
- "8x80, 8x100, 8x120 5ctns each" → multiple products, 5 cartons each
- "8x80\n8x100\n10 carton" → 8x80 (10 cartons), 8x100 (10 cartons)
- "add another 8x100 10000pcs" → single product 8x100, 10000 pieces
- "prices chahiye" → {"hasOrder": false}

MULTI-LINE HANDLING:
When products are on separate lines followed by quantity, apply the quantity to ALL products:
Input: "8x80\n8x100\n10 carton"
Output: [{"productName":"NFF 8x80","quantity":10,"unit":"cartons"},{"productName":"NFF 8x100","quantity":10,"unit":"cartons"}]

Respond ONLY with valid JSON:
{
  "hasOrder": true/false,
  "isMultipleProducts": true/false,
  "orders": [
    {
      "productName": "exact product name from available list",
      "quantity": number,
      "unit": "cartons" or "pieces",
      "confidence": 0.0-1.0
    }
  ]
}

If asking for prices only or no order found, respond: {"hasOrder": false}
`;

        console.log('[SMART_EXTRACT] Sending enhanced prompt to AI');
        
        const aiResponse = await getAIResponse(tenantId, extractionPrompt);
        console.log('[SMART_EXTRACT] AI raw response:', aiResponse);
        
        // Parse AI response
        let extractedData;
        try {
            const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                console.log('[SMART_EXTRACT] No JSON found in AI response');
                return null;
            }
            
            extractedData = JSON.parse(jsonMatch[0]);
        } catch (parseError) {
            console.error('[SMART_EXTRACT] JSON parse error:', parseError.message);
            return null;
        }
        
        if (!extractedData.hasOrder) {
            console.log('[SMART_EXTRACT] AI detected no order or price inquiry');
            return null;
        }
        
        // Normalize units
        const normalizeUnit = (unitText) => {
            if (!unitText) return 'cartons';
            const u = String(unitText).toLowerCase();
            if (u.match(/\b(pcs|pieces|pc)\b/)) return 'pieces';
            if (u.match(/\b(ctn|ctns|carton|cartons)\b/)) return 'cartons';
            if (u.match(/\b(piece|p)\b/)) return 'pieces';
            return 'cartons';
        };

        // Validate and enhance the extracted data
        const validatedOrders = [];
        
        for (const order of extractedData.orders || []) {
            if (!order.productName) continue;
            
            // Find matching product
            const matchingProduct = products.find(p => 
                p.name.toLowerCase() === order.productName.toLowerCase() ||
                p.name.toLowerCase().includes(order.productName.toLowerCase()) ||
                order.productName.toLowerCase().includes(p.name.toLowerCase())
            );
            
            if (matchingProduct) {
                const normalizedUnit = normalizeUnit(order.unit);
                console.log('[SMART_EXTRACT] Unit normalization:', {
                    original: order.unit,
                    normalized: normalizedUnit,
                    isPieces: normalizedUnit === 'pieces'
                });
                
                validatedOrders.push({
                    productCode: extractProductCode(matchingProduct.name),
                    productName: matchingProduct.name,
                    productId: matchingProduct.id,
                    quantity: Number(order.quantity || 1),
                    unit: normalizedUnit,
                    isPieces: normalizedUnit === 'pieces',
                    confidence: order.confidence || 0.8,
                    originalText: userQuery
                });
            }
        }
        
        if (validatedOrders.length === 0) {
            return null;
        }
        
        return {
            isMultipleProducts: validatedOrders.length > 1,
            orders: validatedOrders,
            extractionMethod: 'ai',
            originalQuery: userQuery
        };
        
    } catch (error) {
        console.error('[SMART_EXTRACT] Error in AI extraction:', error.message);
        return null;
    }
};

/**
 * FIXED: Dynamic product search with better matching (unified function)
 */
const findProductByNameOrCode = async (tenantId, productIdentifier) => {
    // Use the strict version for consistency
    return await findProductByCodeStrict(tenantId, productIdentifier);
};

/**
 * Extract product code for backward compatibility
 */
const extractProductCode = (productName) => {
    if (!productName) return '';
    
    const patterns = [
        /(\d+[x*]\d+)/i,           // Format like 10x120
        /([A-Z]+\s*\d+[x*]\d+)/i, // Format like NFF 10x120
        /([A-Z]+\d+)/i,           // Format like ABC123
        /(\w+)/                   // First word as fallback
    ];
    
    for (const pattern of patterns) {
        const match = productName.match(pattern);
        if (match) {
            return match[1].replace('*', 'x');
        }
    }
    
    return productName.split(' ')[0];
};

/**
 * MAIN: Enhanced order extraction with price inquiry filtering
 */
const extractOrderDetails = async (userQuery, tenantId) => {
    try {
        console.log('[ORDER_EXTRACT] Starting extraction for:', userQuery);

        // Enhanced debugging: Add detailed logging
        console.log('[ORDER_EXTRACT] Query analysis:', {
            originalQuery: userQuery,
            cleanQuery: userQuery.toLowerCase().trim(),
            containsWant: /i\s+want/i.test(userQuery),
            containsPieces: /\d+\s*(?:pcs|pieces)/i.test(userQuery),
            containsProduct: /\d+[x*]\d+/i.test(userQuery)
        });

        // DISABLED: Flawed multi-line product parser that applies same quantity to all products
        // Problem: "8x80\n8x100\n10 carton" is ambiguous - could mean 10 total or 10 each
        // This pattern incorrectly assumes 10 cartons of EACH product
        // Solution: Let AI handle multi-product queries with proper clarification
        /*
        const multiLinePattern = /^((?:\d+[x*]\d+(?:\s*[,\n]\s*)?)+)\s*(\d+)\s*(?:ctn|carton|ctns|cartons)s?$/i;
        const multiLineMatch = userQuery.trim().match(multiLinePattern);

        if (multiLineMatch) {
            console.log('[ORDER_EXTRACT] Multi-line pattern detected:', multiLineMatch[0]);
            const productsStr = multiLineMatch[1];
            const quantity = parseInt(multiLineMatch[2]);

            // Extract all product codes
            const productCodes = productsStr.match(/\d+[x*]\d+/gi);

            if (productCodes && productCodes.length > 0 && quantity > 0) {
                console.log('[ORDER_EXTRACT] Extracted product codes:', productCodes, 'quantity:', quantity);

                // Get products from database
                const { data: products } = await dbClient
                    .from('products')
                    .select('id, name, price, units_per_carton')
                    .eq('tenant_id', tenantId)
                    .eq('is_active', true);

                const orders = [];
                for (const code of productCodes) {
                    const normalizedCode = code.replace('*', 'x').toLowerCase();
                    const product = products?.find(p =>
                        p.name.toLowerCase().includes(normalizedCode)
                    );

                    if (product) {
                        orders.push({
                            productCode: normalizedCode,
                            productName: product.name,
                            productId: product.id,
                            quantity: quantity,
                            unit: 'cartons',
                            isPieces: false,
                            originalText: userQuery
                        });
                    }
                }

                if (orders.length > 0) {
                    console.log('[ORDER_EXTRACT] Multi-line regex parse successful:', orders.length, 'products');
                    return {
                        isMultipleProducts: orders.length > 1,
                        orders: orders,
                        extractionMethod: 'regex_multiline',
                        originalQuery: userQuery
                    };
                }
            }
        }
        */

        // NEW: Improved multi-product parser - each product needs its own quantity
        // Handles: "8x80 2 cartons, 8x100 10 cartons" or "8x80 2ctns\n8x100 10ctns"
        // Format: productCode quantity unit [,\n] productCode quantity unit...
        const perProductPattern = /(\d+[x*]\d+)\s+(\d+)\s*(?:ctn|carton|ctns|cartons|pcs|pc|pieces?)/gi;
        const perProductMatches = [...userQuery.matchAll(perProductPattern)];

        if (perProductMatches && perProductMatches.length > 1) {
            console.log('[ORDER_EXTRACT] Per-product pattern detected:', perProductMatches.length, 'products');

            const orders = [];
            for (const match of perProductMatches) {
                const code = match[1].replace('*', 'x').toLowerCase();
                const quantity = parseInt(match[2]);
                const unitMatch = match[0].match(/(?:ctn|carton|ctns|cartons|pcs|pc|pieces?)/i);
                const unit = unitMatch ? (unitMatch[0].toLowerCase().startsWith('p') ? 'pieces' : 'cartons') : 'cartons';

                // FIXED: Use strict product search instead of simple includes()
                const product = await findProductByCodeStrict(tenantId, code);

                if (product) {
                    orders.push({
                        productCode: code,
                        productName: product.name,
                        productId: product.id,
                        quantity: quantity,
                        unit: unit,
                        isPieces: unit === 'pieces',
                        originalText: userQuery
                    });
                    console.log('[ORDER_EXTRACT] Added:', code, quantity, unit);
                }
            }

            if (orders.length > 1) {
                console.log('[ORDER_EXTRACT] Per-product parse successful:', orders.length, 'products');
                return {
                    isMultipleProducts: true,
                    orders: orders,
                    extractionMethod: 'regex_per_product',
                    originalQuery: userQuery
                };
            }
        }

        // SPECIAL CASE: "X each" or "X per product" pattern
        // Handles: "8x80, 8x100 10ctns each" or "8x80 8x100 5 cartons each"
        const productCodes = (userQuery.match(/\d+[x*]\d+/gi) || []);
        const eachPattern = /(\d+)\s*(?:ctn|carton|ctns|cartons|pcs|pc|pieces?)\s*(?:each|per\s*product|for\s*each)/i;
        const eachMatch = userQuery.match(eachPattern);

        if (productCodes.length > 1 && eachMatch) {
            console.log('[ORDER_EXTRACT] "EACH" pattern detected:', productCodes.length, 'products with', eachMatch[1], 'each');

            const quantity = parseInt(eachMatch[1]);
            const unitMatch = eachMatch[0].match(/(?:ctn|carton|ctns|cartons|pcs|pc|pieces?)/i);
            const unit = unitMatch ? (unitMatch[0].toLowerCase().startsWith('p') ? 'pieces' : 'cartons') : 'cartons';

            const orders = [];
            for (const code of productCodes) {
                const normalizedCode = code.replace('*', 'x').toLowerCase();
                // FIXED: Use strict product search instead of simple includes()
                const product = await findProductByCodeStrict(tenantId, normalizedCode);

                if (product) {
                    orders.push({
                        productCode: normalizedCode,
                        productName: product.name,
                        productId: product.id,
                        quantity: quantity,
                        unit: unit,
                        isPieces: unit === 'pieces',
                        originalText: userQuery
                    });
                    console.log('[ORDER_EXTRACT] Added (EACH):', normalizedCode, quantity, unit);
                }
            }

            if (orders.length > 1) {
                console.log('[ORDER_EXTRACT] "EACH" pattern parse successful:', orders.length, 'products');
                return {
                    isMultipleProducts: true,
                    orders: orders,
                    extractionMethod: 'regex_each_pattern',
                    originalQuery: userQuery
                };
            }
        }

        // CLARIFICATION NEEDED: If multiple product codes but only one quantity (and no "each")
        // This is ambiguous - ask user to clarify
        const quantityMatches = (userQuery.match(/\b(\d+)\s*(?:ctn|carton|ctns|cartons|pcs|pc|pieces?)\b/gi) || []);

        if (productCodes.length > 1 && quantityMatches.length === 1 && !eachMatch) {
            console.log('[ORDER_EXTRACT] AMBIGUOUS: Multiple products but single quantity (no "each" keyword)');
            console.log('[ORDER_EXTRACT] Products:', productCodes, 'Quantity:', quantityMatches[0]);
            // Return null to trigger clarification flow or AI handling
            return null;
        }


        // Guard: bail out early if customer clearly asks for a discount
        const explicitDiscountPatterns = [
            /give\s*(?:me|us)?\s*(?:some|a)?\s*discount/i,
            /can\s*(?:you|i)\s*get\s*(?:a|some)?\s*discount/i,
            /discount\s*(?:do|mile?ga|chahiye|please|for)/i,
            /best\s+price/i,
            /kam\s+kar/i,
            /thoda\s+(?:aur\s+)?kam/i
        ];
        const explicitDiscount = explicitDiscountPatterns.some(pattern => pattern.test(userQuery));
        console.log('[ORDER_EXTRACT] Explicit discount detected:', explicitDiscount, 'for:', userQuery);
        if (explicitDiscount) {
            console.log('[ORDER_EXTRACT] Skipping order extraction so discount negotiation can run');
            return null;
        }

        // CRITICAL: Check for price inquiry FIRST
        if (isPriceInquiryOnly(userQuery)) {
            console.log('[ORDER_EXTRACT] Price inquiry detected, returning null');
            return null;
        }
        
        // Try regex patterns first
        const regexResult = extractOrderDetailsFallback(userQuery);
        
        // **NEW: Unit validation and logging**
        if (regexResult) {
            console.log('[ORDER_EXTRACT] ========== UNIT VALIDATION ==========');
            console.log('[ORDER_EXTRACT] Original Query:', userQuery);
            console.log('[ORDER_EXTRACT] Extracted Unit:', regexResult.unit);
            console.log('[ORDER_EXTRACT] Is Pieces:', regexResult.isPieces);
            console.log('[ORDER_EXTRACT] Quantity:', regexResult.quantity);
            
            // Force re-validation of unit from original query
            const queryLower = userQuery.toLowerCase();
            if ((queryLower.includes('pcs') || queryLower.includes('piece')) && 
                regexResult.unit !== 'pieces') {
                console.log('[ORDER_EXTRACT] ⚠️  UNIT MISMATCH DETECTED - FORCING TO PIECES');
                regexResult.unit = 'pieces';
                regexResult.isPieces = true;
            }
            
            if ((queryLower.includes('ctn') || queryLower.includes('carton')) && 
                regexResult.unit !== 'cartons') {
                console.log('[ORDER_EXTRACT] ⚠️  UNIT MISMATCH DETECTED - FORCING TO CARTONS');
                regexResult.unit = 'cartons';
                regexResult.isPieces = false;
            }
            
            // **EMERGENCY FIX: Apply same validation to multi-product orders**
            if (regexResult.orders && Array.isArray(regexResult.orders)) {
                console.log('[ORDER_EXTRACT] Applying emergency unit validation to multi-product orders');
                regexResult.orders.forEach((order, idx) => {
                    if ((queryLower.includes('pcs') || queryLower.includes('piece')) && 
                        order.unit !== 'pieces') {
                        console.log(`[ORDER_EXTRACT] ⚠️  Order ${idx + 1} UNIT MISMATCH - FORCING TO PIECES`);
                        order.unit = 'pieces';
                        order.isPieces = true;
                    }
                    
                    if ((queryLower.includes('ctn') || queryLower.includes('carton')) && 
                        order.unit !== 'cartons') {
                        console.log(`[ORDER_EXTRACT] ⚠️  Order ${idx + 1} UNIT MISMATCH - FORCING TO CARTONS`);
                        order.unit = 'cartons';
                        order.isPieces = false;
                    }
                });
            }
            
            console.log('[ORDER_EXTRACT] ========== FINAL UNIT ==========');
            console.log('[ORDER_EXTRACT] Unit:', regexResult.unit);
            console.log('[ORDER_EXTRACT] isPieces:', regexResult.isPieces);
            console.log('[ORDER_EXTRACT] =====================================');
        }
        
        // Check if we got a valid result (including context-based orders)
        if (regexResult && (regexResult.productCode || regexResult.orders || regexResult.isContextOrder)) {
            console.log('[ORDER_EXTRACT] Regex extraction successful:', regexResult);
            
            // If it's a context-based order, return it immediately (no validation needed)
            if (regexResult.isContextOrder) {
                console.log('[ORDER_EXTRACT] Context-based order detected - returning for handler to resolve');
                return {
                    ...regexResult,
                    extractionMethod: 'regex',
                    originalQuery: userQuery
                };
            }
            
            // For multi-product, validate all products AND preserve units
            if (regexResult.isMultipleProducts && regexResult.orders) {
                const validatedProducts = [];
                
                for (const order of regexResult.orders) {
                    const product = await findProductByNameOrCode(tenantId, order.productCode);
                    if (product && product.price > 0) {
                        order.productId = product.id;
                        order.productName = product.name;
                        // **CRITICAL: Ensure unit is preserved**
                        order.unit = order.unit || 'cartons';
                        order.isPieces = order.unit === 'pieces';
                        validatedProducts.push(order);
                        console.log('[ORDER_EXTRACT] Validated multi-product:', product.name, 
                                  'Qty:', order.quantity, 'Unit:', order.unit);
                    } else {
                        console.log('[ORDER_EXTRACT] Multi-product validation failed:', order.productCode);
                    }
                }
                
                if (validatedProducts.length > 0) {
                    regexResult.orders = validatedProducts;
                    return {
                        ...regexResult,
                        extractionMethod: 'regex',
                        originalQuery: userQuery
                    };
                }
            } else if (regexResult.productCode) {
                // Single product validation WITH unit preservation
                const product = await findProductByNameOrCode(tenantId, regexResult.productCode);
                if (product && product.price > 0) {
                    console.log('[ORDER_EXTRACT] Single product validated:', product.name, 
                              'Qty:', regexResult.quantity, 'Unit:', regexResult.unit);
                    return {
                        ...regexResult,
                        productId: product.id,
                        productName: product.name,
                        // **CRITICAL: Explicitly set unit fields**
                        unit: regexResult.unit || 'cartons',
                        isPieces: regexResult.isPieces || regexResult.unit === 'pieces',
                        extractionMethod: 'regex',
                        originalQuery: userQuery
                    };
                } else {
                    console.log('[ORDER_EXTRACT] Single product validation failed:', regexResult.productCode);
                }
            }
        }
        
        // Fallback to AI extraction
        console.log('[ORDER_EXTRACT] Trying AI extraction');
        const aiResult = await extractOrderDetailsAI(userQuery, tenantId);
        
        if (aiResult) {
            console.log('[ORDER_EXTRACT] AI extraction successful');
            return aiResult;
        }
        
        console.log('[ORDER_EXTRACT] Both extraction methods failed');
        return null;
        
    } catch (error) {
        console.error('[ORDER_EXTRACT] Error in extraction:', error.message);
        return null;
    }
};

module.exports = {
    extractOrderDetails,
    extractOrderDetailsAI,
    extractOrderDetailsFallback,
    findProductByNameOrCode,
    findProductByCodeStrict,
    isPriceInquiryOnly,
    formatProductPrice: async (...args) => await formatProductPrice(...args),
    handleGeneralPriceInquiry
};

