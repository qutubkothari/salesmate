// services/pricingService.js - TARGETED FIX for GST rate inconsistency
const { calculateShippingCharges, calculateTotalCartons } = require('./shippingService');
const { calculateGST, determineIfInterstate } = require('./gstService');
const { dbClient } = require('./config');

/**
 * Round amount according to business rules
 * - Rounds up to nearest rupee (e.g., 2000.43 -> 2001)
 * @param {number} amount - Amount to round
 * @returns {number} Rounded amount
 */
const roundAmount = (amount) => {
    if (amount == null || isNaN(amount)) {
        return 0;
    }
    return Math.ceil(amount);
};

/**
 * Calculate comprehensive pricing for cart/order
 * FIXED: Ensure consistent GST rate handling between view and checkout
 * @param {string} tenantId - Tenant ID
 * @param {Array} cartItems - Array of cart items
 * @param {Object} options - Additional options
 * @returns {Object} Complete pricing breakdown
 */
const calculateComprehensivePricing = async (tenantId, cartItems, options = {}) => {
    try {
        console.log('[PRICING] Calculating comprehensive pricing for', cartItems?.length || 0, 'items');
        console.log('[PRICING] 🔍 DEBUG - Received options:', {
            ignorePriceOverride: options.ignorePriceOverride,
            discountAmount: options.discountAmount,
            customerId: options.customerId,
            customerPhone: options.customerPhone
        });

        if (!cartItems || cartItems.length === 0) {
            return {
                subtotal: 0,
                totalCartons: 0,
                shipping: {
                    charges: 0,
                    freeShippingApplied: false,
                    message: 'No items in cart'
                },
                gst: {
                    amount: 0,
                    rate: 18,
                    cgst: 0,
                    sgst: 0,
                    igst: 0,
                    isInterstate: false
                },
                grandTotal: 0,
                breakdown: []
            };
        }

        const {
            customerState = null,
            customerId = null,
            customerPhone = null,
            discountAmount = 0,
            roundTotals = true,
            isReturningCustomer = false
        } = options;

        // Fetch last purchase prices for returning customers
        let lastPurchasePrices = {};
        console.log('[PRICING] Checking for last purchase prices - customerId:', customerId, 'customerPhone:', customerPhone);
        if (customerId || customerPhone) {
            try {
                // Normalize phone number for database lookup
                let normalizedPhone = null;
                if (customerPhone) {
                    // Remove +91 prefix, spaces, and @c.us suffix
                    normalizedPhone = customerPhone.replace(/^\+91\s*/, '').replace(/\s+/g, '').replace(/@c\.us$/, '');
                    console.log('[PRICING] Normalized phone from', customerPhone, 'to', normalizedPhone);
                }

                let query = dbClient
                    .from('orders_new')
                    .select(`
                        order_items(
                            product_id,
                            price_at_time_of_purchase,
                            quantity
                        ),
                        conversations!inner(
                            end_user_phone
                        )
                    `)
                    .eq('tenant_id', tenantId)
                    .in('status', ['confirmed', 'completed', 'pending_payment']) // Include pending_payment orders
                    .order('created_at', { ascending: false })
                    .limit(10); // Get last 10 orders for better price averaging

                if (customerId) {
                    // First try by customer profile ID
                    query = query.eq('customer_profile_id', customerId);
                    console.log('[PRICING] Searching for orders by customer profile ID:', customerId);
                } else if (normalizedPhone) {
                    // Fallback: try by phone number (search for exact match first, then patterns)
                    query = query.eq('conversations.end_user_phone', customerPhone);
                    console.log('[PRICING] Searching for orders by exact phone match:', customerPhone);
                }

                const { data: lastOrders } = await query;

                if (lastOrders && lastOrders.length > 0) {
                    // Create a map of product_id to last purchase price
                    const priceMap = {};
                    lastOrders.forEach(order => {
                        order.order_items?.forEach(orderItem => {
                            if (orderItem.price_at_time_of_purchase && orderItem.quantity > 0) {
                                const pricePerCarton = parseFloat(orderItem.price_at_time_of_purchase);
                                if (!priceMap[orderItem.product_id] || priceMap[orderItem.product_id] < pricePerCarton) {
                                    // Use the highest price (most recent better pricing)
                                    priceMap[orderItem.product_id] = pricePerCarton;
                                }
                            }
                        });
                    });
                    lastPurchasePrices = priceMap;
                    console.log('[PRICING] Found last purchase prices for', Object.keys(priceMap).length, 'products:', priceMap);
                } else {
                    console.log('[PRICING] No previous orders found for customer:', customerId || customerPhone, '- checked', lastOrders?.length || 0, 'orders');
                }
            } catch (error) {
                console.warn('[PRICING] Error fetching last purchase prices:', error.message);
            }
        } else {
            console.log('[PRICING] No customerId or customerPhone provided for last purchase pricing');
        }

        // Calculate item subtotals
        let itemSubtotal = 0;
        let totalCartons = 0;
        const itemBreakdown = [];

        cartItems.forEach((item, index) => {
            const product = item.product;
            const quantity = item.quantity || 1;
            
            // ✅ CRITICAL FIX: Proper priority with discount detection
            let unitPrice = product.price;
            let priceSource = 'catalog';
            
            // First, establish the base price (catalog or last purchase)
            const catalogPrice = product.price;
            const lastPurchasePrice = lastPurchasePrices[product.id];
            
            console.log(`[PRICING] 🔍 DEBUG - Processing ${product.name}:`, {
                catalogPrice,
                lastPurchasePrice,
                carton_price_override: item.carton_price_override,
                ignorePriceOverride: options.ignorePriceOverride,
                isReturningCustomer: options.isReturningCustomer
            });
            
            // ✅ CRITICAL BUSINESS LOGIC:
            // - RETURNING customers: Always show last purchase prices (unless discount approved)
            // - NEW customers: Show catalog prices only
            if (options.ignorePriceOverride) {
                // NEW customer OR returning customer with approved discount
                unitPrice = catalogPrice;
                priceSource = 'catalog';
                console.log(`[PRICING] ⚠️ ignorePriceOverride=true (NEW customer), forcing catalog price: ₹${unitPrice}`);
            } else if (lastPurchasePrice && options.isReturningCustomer) {
                // RETURNING customer - show their loyal customer pricing
                unitPrice = lastPurchasePrice;
                priceSource = 'last_purchase';
                console.log(`[PRICING] ✅ RETURNING customer, using last purchase price: ₹${unitPrice}`);
            } else if (lastPurchasePrice) {
                // Has last purchase but not flagged as returning - use last purchase
                unitPrice = lastPurchasePrice;
                priceSource = 'last_purchase';
            }
            
            // ✅ CRITICAL: If carton_price_override exists AND is different from base price,
            // it means a discount was applied - USE IT (unless ignorePriceOverride option is set)
            if (!options.ignorePriceOverride &&
                item.carton_price_override &&
                item.carton_price_override > 0 &&
                item.carton_price_override !== catalogPrice &&
                item.carton_price_override !== lastPurchasePrice) {

                unitPrice = item.carton_price_override;
                priceSource = 'negotiated_discount';
                console.log(`[PRICING] ✅ Using negotiated/discounted price for ${product.name}: ₹${unitPrice} (was ₹${lastPurchasePrice || catalogPrice})`);
            } else if (!options.ignorePriceOverride &&
                       item.carton_price_override &&
                       item.carton_price_override === lastPurchasePrice) {
                // carton_price_override matches last purchase price - no additional discount
                unitPrice = lastPurchasePrice;
                priceSource = 'last_purchase';
                console.log(`[PRICING] Using last purchase price for ${product.name}: ₹${unitPrice} (was ₹${catalogPrice})`);
            } else if (options.ignorePriceOverride && item.carton_price_override) {
                // Explicitly ignoring price override - use catalog or last purchase price
                console.log(`[PRICING] ⚠️ Ignoring carton_price_override (₹${item.carton_price_override}) for ${product.name}, using ${priceSource} price: ₹${unitPrice}`);
            } else if (priceSource === 'last_purchase') {
                console.log(`[PRICING] Using last purchase price for ${product.name}: ₹${unitPrice} (was ₹${catalogPrice})`);
            } else {
                console.log(`[PRICING] Using catalog price for ${product.name}: ₹${unitPrice}`);
            }
            
            const itemTotal = unitPrice * quantity;
            
            // Apply rounding at item level if specified
            const roundedItemTotal = roundTotals ? roundAmount(itemTotal) : itemTotal;
            
            itemSubtotal += roundedItemTotal;
            totalCartons += quantity; // Assuming quantity is in cartons
            
            itemBreakdown.push({
                productId: product.id,
                productName: product.name,
                quantity,
                unitPrice: parseFloat(unitPrice.toFixed(2)),
                itemTotal: parseFloat(itemTotal.toFixed(2)),
                roundedItemTotal: parseFloat(roundedItemTotal.toFixed(2)),
                isRounded: roundTotals && (roundedItemTotal !== itemTotal)
            });
        });

        // Calculate volume-based discount ONLY if explicitly requested or for new customers
        // For existing customers with personalized pricing, volume discount is NOT applied
        let volumeDiscountAmount = 0;
        let volumeDiscount = null;
        
        // Automatically apply volume discount if quantity >= 11 cartons and not a personalized pricing customer
        if (!hasAnyPersonalizedPrice && totalCartons >= 11) {
            volumeDiscount = calculateDiscount(itemSubtotal, totalCartons, options.discountType || 'min', options.customDiscountPercent);
            volumeDiscountAmount = volumeDiscount.discountAmount;
            console.log('[PRICING] Volume discount applied automatically:', volumeDiscountAmount);
        } else if (options.applyVolumeDiscount === true) {
            // Manual override to apply discount
            volumeDiscount = calculateDiscount(itemSubtotal, totalCartons, options.discountType || 'min', options.customDiscountPercent);
            volumeDiscountAmount = volumeDiscount.discountAmount;
            console.log('[PRICING] Volume discount applied (manually requested):', volumeDiscountAmount);
        } else {
            console.log('[PRICING] Volume discount skipped (insufficient quantity or personalized pricing)');
            volumeDiscount = { discountPercent: 0, discountAmount: 0, slab: null };
        }
        
        // Apply cart-level manual discounts (if any) + volume discount
        const totalDiscount = discountAmount + volumeDiscountAmount;
        const discountedSubtotal = Math.max(0, itemSubtotal - totalDiscount);

        console.log('[PRICING] Subtotal calculated:', {
            itemSubtotal,
            manualDiscount: discountAmount,
            totalDiscount,
            discountedSubtotal,
            totalCartons
        });

        // Calculate shipping charges using your existing service
        const shippingCalc = await calculateShippingCharges(tenantId, totalCartons, discountedSubtotal);
        
        // Calculate GST on subtotal + shipping using your existing service
        const isInterstate = await determineIfInterstate(tenantId, customerState);
        const taxableAmount = discountedSubtotal + shippingCalc.shippingCharges;
        const gstCalc = await calculateGST(tenantId, taxableAmount, isInterstate);

        console.log('[PRICING] GST calculation result:', {
            taxableAmount,
            gstRate: gstCalc.gstRate,
            gstAmount: gstCalc.gstAmount,
            isInterstate: gstCalc.isInterstate
        });

        // Calculate grand total
        const grandTotalBeforeRounding = discountedSubtotal + shippingCalc.shippingCharges + gstCalc.gstAmount;
        const grandTotal = roundTotals ? roundAmount(grandTotalBeforeRounding) : grandTotalBeforeRounding;

        console.log('[PRICING] Final calculation:', {
            discountedSubtotal,
            shippingCharges: shippingCalc.shippingCharges,
            gstAmount: gstCalc.gstAmount,
            grandTotalBeforeRounding,
            grandTotal
        });

        return {
            // Item breakdown
            items: itemBreakdown,
            itemCount: cartItems.length,
            totalCartons,
            
            // Pricing components
            subtotal: parseFloat(discountedSubtotal.toFixed(2)),
            originalSubtotal: parseFloat(itemSubtotal.toFixed(2)),
            discountAmount: parseFloat(discountAmount.toFixed(2)), // FIXED: Only manual discount, no volume discount
            manualDiscountAmount: parseFloat(discountAmount.toFixed(2)),
            
            // REMOVED: Volume discount details (no longer applicable)
            // Old volume discount logic has been completely removed
            // Discounts now come ONLY from dashboard rules or explicit approval
            
            // Shipping details
            shipping: {
                charges: shippingCalc.shippingCharges,
                rateType: shippingCalc.rateType,
                ratePerCarton: shippingCalc.ratePerCarton,
                freeShippingApplied: shippingCalc.freeShippingApplied,
                threshold: shippingCalc.threshold,
                message: shippingCalc.message
            },
            
            // FIXED: GST details with consistent rate format
            gst: {
                rate: gstCalc.gstRate, // This should be a number like 18, not 0.18
                amount: gstCalc.gstAmount,
                cgstAmount: gstCalc.cgstAmount,
                sgstAmount: gstCalc.sgstAmount,
                igstAmount: gstCalc.igstAmount,
                isInterstate: gstCalc.isInterstate,
                taxableAmount: parseFloat(taxableAmount.toFixed(2))
            },
            
            // Totals
            taxableAmount: parseFloat(taxableAmount.toFixed(2)),
            grandTotal: parseFloat(grandTotal.toFixed(2)),
            grandTotalBeforeRounding: parseFloat(grandTotalBeforeRounding.toFixed(2)),
            roundingAdjustment: parseFloat((grandTotal - grandTotalBeforeRounding).toFixed(2)),
            isRounded: roundTotals && (grandTotal !== grandTotalBeforeRounding)
        };

    } catch (error) {
        console.error('[PRICING] Error calculating comprehensive pricing:', error.message);
        throw error;
    }
};

/**
 * Format comprehensive pricing for WhatsApp display
 * FIXED: Handle GST rate display consistently
 * @param {Object} pricing - Pricing calculation result
 * @param {Object} options - Display options
 * @returns {string} Formatted pricing display
 */
const formatPricingForWhatsApp = (pricing, options = {}) => {
    if (!pricing) {
        return 'Pricing calculation error';
    }

    const {
        showItemBreakdown = true,
        showGSTBreakdown = false,
        showRoundingInfo = true
    } = options;

    let display = '';

    // Item breakdown
    if (showItemBreakdown && pricing.items && pricing.items.length > 0) {
        display += '*Your Cart:*\n';
        pricing.items.forEach(item => {
            display += `*${item.productName}*\n`;
            display += `  - Qty: ${item.quantity} × ₹${item.unitPrice} = ₹${item.itemTotal}`;
            
            if (item.isRounded) {
                display += ` → ₹${item.roundedItemTotal} (rounded)`;
            }
            
            display += '\n';
        });
        display += '\n';
    }

    // Pricing breakdown
    display += '*Pricing Breakdown:*\n';
    display += `Original Subtotal: ₹${pricing.originalSubtotal.toLocaleString()}\n`;
    
    // REMOVED: Volume discount display (no longer applicable)
    // Old automatic volume discount logic has been removed
    
    // Show manual/approved discount if any
    if (pricing.discountAmount > 0) {
        display += `Discount: -₹${pricing.discountAmount.toLocaleString()}\n`;
    }
    
    display += `Subtotal After Discount: ₹${pricing.subtotal.toLocaleString()}\n`;
    
    // Shipping
    if (pricing.shipping.freeShippingApplied) {
        display += `Shipping: FREE ✓\n`;
    } else {
        display += `Shipping: ₹${pricing.shipping.charges.toLocaleString()} (${pricing.totalCartons} cartons × ₹${pricing.shipping.ratePerCarton})\n`;
    }
    
    // FIXED: GST display with proper rate formatting
    if (showGSTBreakdown && pricing.gst.isInterstate) {
        display += `IGST (${pricing.gst.rate}%): ₹${pricing.gst.igstAmount.toLocaleString()}\n`;
    } else if (showGSTBreakdown) {
        display += `CGST (${pricing.gst.rate/2}%): ₹${pricing.gst.cgstAmount.toLocaleString()}\n`;
        display += `SGST (${pricing.gst.rate/2}%): ₹${pricing.gst.sgstAmount.toLocaleString()}\n`;
    } else {
        display += `GST (${pricing.gst.rate}%): ₹${pricing.gst.amount.toLocaleString()}\n`;
    }
    
    // Grand total
    display += `*Final Total: ₹${pricing.grandTotal.toLocaleString()}*`;
    
    // Rounding info
    if (showRoundingInfo && pricing.isRounded && pricing.roundingAdjustment > 0) {
        display += ` (rounded from ₹${pricing.grandTotalBeforeRounding.toLocaleString()})`;
    }
    
    return display;
};

/**
 * Format pricing for dashboard/admin display
 * @param {Object} pricing - Pricing calculation result
 * @returns {Object} Structured pricing for dashboard
 */
const formatPricingForDashboard = (pricing) => {
    if (!pricing) {
        return null;
    }

    return {
        summary: {
            itemCount: pricing.itemCount,
            totalCartons: pricing.totalCartons,
            subtotal: pricing.subtotal,
            shippingCharges: pricing.shipping.charges,
            gstAmount: pricing.gst.amount,
            grandTotal: pricing.grandTotal
        },
        breakdown: {
            items: pricing.items,
            shipping: {
                ...pricing.shipping,
                freeShippingApplied: pricing.shipping.freeShippingApplied
            },
            gst: {
                ...pricing.gst,
                breakdown: pricing.gst.isInterstate 
                    ? { igst: pricing.gst.igstAmount }
                    : { cgst: pricing.gst.cgstAmount, sgst: pricing.gst.sgstAmount }
            },
            rounding: {
                isRounded: pricing.isRounded,
                adjustment: pricing.roundingAdjustment,
                originalTotal: pricing.grandTotalBeforeRounding
            }
        }
    };
};

/**
 * Calculate pricing for a single product (for quotes)
 * @param {string} tenantId - Tenant ID
 * @param {Object} product - Product details
 * @param {number} quantity - Quantity in cartons
 * @param {Object} options - Options
 * @returns {Object} Single product pricing
 */
const calculateSingleProductPricing = async (tenantId, product, quantity, options = {}) => {
    try {
        const {
            customerState = null,
            roundTotals = true,
            includeShipping = true,
            includeGST = true
        } = options;

        // Create cart item structure
        const cartItem = {
            product: {
                id: product.id,
                name: product.name,
                price: product.price
            },
            quantity: quantity,
            carton_price_override: null
        };

        // Use comprehensive pricing calculation
        const pricing = await calculateComprehensivePricing(
            tenantId, 
            [cartItem], 
            { 
                customerState, 
                roundTotals,
                discountAmount: 0
            }
        );

        return {
            productName: product.name,
            quantity: quantity,
            unitPrice: product.price,
            subtotal: pricing.subtotal,
            shipping: includeShipping ? pricing.shipping : null,
            gst: includeGST ? pricing.gst : null,
            total: pricing.grandTotal,
            isRounded: pricing.isRounded,
            roundingAdjustment: pricing.roundingAdjustment
        };

    } catch (error) {
        console.error('[PRICING] Error calculating single product pricing:', error.message);
        throw error;
    }
};

/**
 * Validate pricing calculation
 * ENHANCED: Better validation with detailed checks
 * @param {Object} pricing - Pricing to validate
 * @returns {Object} Validation result
 */
const validatePricing = (pricing) => {
    const errors = [];
    const warnings = [];

    if (!pricing) {
        errors.push('Pricing object is null or undefined');
        return { valid: false, errors, warnings };
    }

    // Check for negative values
    if (pricing.subtotal < 0) errors.push('Subtotal cannot be negative');
    if (pricing.shipping?.charges < 0) errors.push('Shipping charges cannot be negative');
    if (pricing.gst?.amount < 0) errors.push('GST amount cannot be negative');
    if (pricing.grandTotal < 0) errors.push('Grand total cannot be negative');

    // Check for reasonable values
    if (pricing.grandTotal > 10000000) warnings.push('Grand total exceeds 1 crore');
    if (pricing.gst?.rate > 30) warnings.push('GST rate seems unusually high');
    if (pricing.shipping?.charges > pricing.subtotal) warnings.push('Shipping charges exceed subtotal');

    // ENHANCED: Check calculations more thoroughly
    const expectedTaxableAmount = pricing.subtotal + (pricing.shipping?.charges || 0);
    const expectedGSTAmount = (expectedTaxableAmount * (pricing.gst?.rate || 18)) / 100;
    const expectedTotal = expectedTaxableAmount + expectedGSTAmount;
    
    // Allow for small rounding differences
    const totalDifference = Math.abs(expectedTotal - pricing.grandTotalBeforeRounding);
    const gstDifference = Math.abs(expectedGSTAmount - (pricing.gst?.amount || 0));
    
    if (totalDifference > 0.1) {
        errors.push(`Total calculation mismatch: expected ${expectedTotal.toFixed(2)}, got ${pricing.grandTotalBeforeRounding}`);
    }
    
    if (gstDifference > 0.1) {
        warnings.push(`GST calculation variance: expected ${expectedGSTAmount.toFixed(2)}, got ${pricing.gst?.amount || 0}`);
    }

    // Check for missing required fields
    if (!pricing.gst || typeof pricing.gst.rate === 'undefined') {
        errors.push('GST rate is missing');
    }
    
    if (!pricing.shipping) {
        errors.push('Shipping information is missing');
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings
    };
};

module.exports = {
    roundAmount,
    calculateComprehensivePricing,
    formatPricingForWhatsApp,
    formatPricingForDashboard,
    calculateSingleProductPricing,
    validatePricing
};

