// services/intelligence/anomalyDetector.js - SMART VERSION
const { dbClient } = require('../config');

class AnomalyDetector {
    
    /**
     * Calculate smart threshold based on pattern quality
     */
    calculateSmartThreshold(pattern) {
        let baseThreshold = 2; // Default
        
        // Adjust based on pattern strength
        if (pattern.pattern_strength === 'strong') {
            baseThreshold = 1.5; // Remind sooner for reliable patterns
        } else if (pattern.pattern_strength === 'moderate') {
            baseThreshold = 3; // Wait a bit longer
        } else if (pattern.pattern_strength === 'weak') {
            baseThreshold = 5; // Much more patient
        }
        
        // Adjust based on confidence score
        const confidenceMultiplier = pattern.confidence_score || 0.5;
        baseThreshold = baseThreshold / confidenceMultiplier;
        
        // Consider average interval (longer intervals = more tolerance)
        const avgDays = pattern.avg_days_between_orders || 14;
        if (avgDays > 30) {
            baseThreshold *= 1.5; // Monthly customers get more grace
        } else if (avgDays < 7) {
            baseThreshold *= 0.8; // Weekly customers are more time-sensitive
        }
        
        return Math.max(1, Math.round(baseThreshold));
    }
    
    /**
     * Detect if customer is in declining trend
     */
    async detectDecreasingFrequency(customerProfileId) {
        try {
            // Get customer's phone
            const { data: profile } = await dbClient
                .from('customer_profiles')
                .select('phone, tenant_id')
                .eq('id', customerProfileId)
                .single();

            if (!profile) return { declining: false };

            // Get conversations
            const { data: conversations } = await dbClient
                .from('conversations')
                .select('id')
                .eq('tenant_id', profile.tenant_id)
                .eq('end_user_phone', profile.phone);

            if (!conversations || conversations.length === 0) {
                return { declining: false };
            }

            const conversationIds = conversations.map(c => c.id);

            // Get last 6 orders
            const { data: orders } = await dbClient
                .from('orders')
                .select('created_at')
                .in('conversation_id', conversationIds)
                .in('status', ['completed', 'confirmed', 'delivered', 'pending_payment'])
                .order('created_at', { ascending: false })
                .limit(6);
            
            if (!orders || orders.length < 4) {
                return { declining: false };
            }
            
            // Calculate intervals for first 3 vs last 3 orders
            const recentOrders = orders.slice(0, 3);
            const olderOrders = orders.slice(3, 6);
            
            const recentIntervals = [];
            for (let i = 1; i < recentOrders.length; i++) {
                const days = (new Date(recentOrders[i-1].created_at) - new Date(recentOrders[i].created_at)) / (1000 * 60 * 60 * 24);
                recentIntervals.push(days);
            }
            
            const olderIntervals = [];
            for (let i = 1; i < olderOrders.length; i++) {
                const days = (new Date(olderOrders[i-1].created_at) - new Date(olderOrders[i].created_at)) / (1000 * 60 * 60 * 24);
                olderIntervals.push(days);
            }
            
            const recentAvg = recentIntervals.reduce((a,b) => a+b, 0) / recentIntervals.length;
            const olderAvg = olderIntervals.reduce((a,b) => a+b, 0) / olderIntervals.length;
            
            // If recent intervals are 30%+ longer, they're declining
            const declining = recentAvg > olderAvg * 1.3;
            
            return {
                declining,
                recentAvg: Math.round(recentAvg),
                olderAvg: Math.round(olderAvg),
                trend: declining ? 'slowing_down' : 'stable'
            };
            
        } catch (error) {
            console.error('[ANOMALY] Error detecting trend:', error);
            return { declining: false };
        }
    }
    
    /**
     * Calculate customer lifetime value tier
     */
    async calculateCustomerTier(customerProfileId) {
        try {
            const { data: profile } = await dbClient
                .from('customer_profiles')
                .select('phone, tenant_id')
                .eq('id', customerProfileId)
                .single();

            if (!profile) return { tier: 'new', priority: 3 };

            const { data: conversations } = await dbClient
                .from('conversations')
                .select('id')
                .eq('tenant_id', profile.tenant_id)
                .eq('end_user_phone', profile.phone);

            if (!conversations || conversations.length === 0) {
                return { tier: 'new', priority: 3 };
            }

            const conversationIds = conversations.map(c => c.id);

            const { data: orders } = await dbClient
                .from('orders')
                .select('total_amount')
                .in('conversation_id', conversationIds)
                .in('status', ['completed', 'confirmed', 'delivered', 'pending_payment']);
            
            if (!orders || orders.length === 0) {
                return { tier: 'new', priority: 3 };
            }
            
            const totalValue = orders.reduce((sum, o) => sum + (o.total_amount || 0), 0);
            const avgValue = totalValue / orders.length;
            const orderCount = orders.length;
            
            // Tier logic
            let tier, priority;
            
            if (totalValue > 100000 || (orderCount > 10 && avgValue > 5000)) {
                tier = 'vip';
                priority = 1; // Highest priority
            } else if (totalValue > 50000 || orderCount > 5) {
                tier = 'high_value';
                priority = 2;
            } else if (orderCount >= 3) {
                tier = 'established';
                priority = 3;
            } else {
                tier = 'new';
                priority = 4; // Lowest priority
            }
            
            return {
                tier,
                priority,
                totalValue,
                avgValue,
                orderCount
            };
            
        } catch (error) {
            console.error('[ANOMALY] Error calculating tier:', error);
            return { tier: 'new', priority: 3 };
        }
    }
    
    /**
     * Check if customer recently inquired (don't spam them)
     */
    async hasRecentInquiry(customerProfileId, hoursSince = 48) {
        try {
            const { data: profile } = await dbClient
                .from('customer_profiles')
                .select('phone, tenant_id')
                .eq('id', customerProfileId)
                .single();

            if (!profile) return false;

            const { data: conversations } = await dbClient
                .from('conversations')
                .select('id, updated_at')
                .eq('tenant_id', profile.tenant_id)
                .eq('end_user_phone', profile.phone)
                .gte('updated_at', new Date(Date.now() - hoursSince * 60 * 60 * 1000).toISOString())
                .limit(1);
            
            return conversations && conversations.length > 0;
            
        } catch (error) {
            console.error('[ANOMALY] Error checking inquiry:', error);
            return false;
        }
    }
    
    /**
     * SMART overdue detection with all factors
     */
    async detectOverdueCustomers(tenantId, options = {}) {
        try {
            console.log('[ANOMALY] Running smart overdue detection');
            
            const { data: patterns, error } = await dbClient
                .from('customer_purchase_patterns')
                .select(`
                    *,
                    customer_profile:customer_profiles(
                        id,
                        phone,
                        company,
                        first_name,
                        last_name
                    )
                `)
                .eq('tenant_id', tenantId)
                .eq('is_overdue', true)
                .order('churn_risk_score', { ascending: false });
            
            if (error) throw error;
            if (!patterns || patterns.length === 0) {
                return { success: true, anomalies: [] };
            }
            
            const smartAnomalies = [];
            
            for (const pattern of patterns) {
                // Calculate smart threshold
                const threshold = this.calculateSmartThreshold(pattern);
                
                // Skip if not past threshold
                if (pattern.days_overdue < threshold) {
                    console.log(`[ANOMALY] ${pattern.customer_profile.company || pattern.customer_profile.first_name}: Only ${pattern.days_overdue} days overdue, threshold is ${threshold}`);
                    continue;
                }
                
                // Check if recently active (don't spam)
                const hasRecentActivity = await this.hasRecentInquiry(pattern.customer_profile_id, 48);
                if (hasRecentActivity) {
                    console.log(`[ANOMALY] ${pattern.customer_profile.company || pattern.customer_profile.first_name}: Has recent activity, skipping`);
                    continue;
                }
                
                // Get customer tier
                const tierInfo = await this.calculateCustomerTier(pattern.customer_profile_id);
                
                // Get trend
                const trendInfo = await this.detectDecreasingFrequency(pattern.customer_profile_id);
                
                // Calculate composite priority score (0-100)
                let priorityScore = 50;
                
                // Churn risk weight (30 points)
                priorityScore += pattern.churn_risk_score * 30;
                
                // Tier weight (20 points)
                priorityScore += (5 - tierInfo.priority) * 5;
                
                // Trend weight (20 points)
                if (trendInfo.declining) {
                    priorityScore += 20;
                }
                
                // Days overdue weight (15 points)
                priorityScore += Math.min((pattern.days_overdue / pattern.avg_days_between_orders) * 15, 15);
                
                // Pattern strength weight (15 points)
                if (pattern.pattern_strength === 'strong') priorityScore += 15;
                else if (pattern.pattern_strength === 'moderate') priorityScore += 10;
                else priorityScore += 5;
                
                smartAnomalies.push({
                    type: 'overdue_order',
                    severity: priorityScore > 75 ? 'critical' : priorityScore > 60 ? 'high' : priorityScore > 45 ? 'medium' : 'low',
                    priorityScore: Math.round(priorityScore),
                    customerProfileId: pattern.customer_profile_id,
                    customerName: pattern.customer_profile.company || 
                        `${pattern.customer_profile.first_name} ${pattern.customer_profile.last_name}`.trim(),
                    customerPhone: pattern.customer_profile.phone,
                    tier: tierInfo.tier,
                    details: {
                        daysOverdue: pattern.days_overdue,
                        threshold,
                        expectedDate: pattern.expected_next_order_date,
                        avgInterval: pattern.avg_days_between_orders,
                        churnRisk: pattern.churn_risk_score,
                        lastOrderDate: pattern.last_order_date,
                        patternStrength: pattern.pattern_strength,
                        totalValue: tierInfo.totalValue,
                        orderCount: tierInfo.orderCount,
                        trend: trendInfo.trend,
                        trendDetails: trendInfo
                    }
                });
            }
            
            // Sort by priority score
            smartAnomalies.sort((a, b) => b.priorityScore - a.priorityScore);
            
            console.log(`[ANOMALY] Found ${smartAnomalies.length} smart anomalies`);
            
            return {
                success: true,
                anomalies: smartAnomalies
            };
            
        } catch (error) {
            console.error('[ANOMALY] Error in smart detection:', error);
            return { success: false, error: error.message, anomalies: [] };
        }
    }
    
    /**
     * Check missing products (existing code - unchanged)
     */
    async detectMissingProducts(customerProfileId, currentOrderItems) {
        try {
            const { data: regularProducts, error } = await dbClient
                .from('customer_product_affinity')
                .select(`
                    *,
                    product:products(id, name, product_code, price)
                `)
                .eq('customer_profile_id', customerProfileId)
                .eq('is_regular_product', true)
                .gte('regularity_score', 0.7);
            
            if (error) throw error;
            
            if (!regularProducts || regularProducts.length === 0) {
                return { success: true, missingProducts: [] };
            }
            
            const currentProductIds = new Set(currentOrderItems.map(item => item.productId));
            const missing = [];
            
            for (const regular of regularProducts) {
                if (!currentProductIds.has(regular.product_id)) {
                    if (regular.days_since_last_purchase >= regular.avg_days_between_purchases * 0.8) {
                        missing.push({
                            type: 'missing_regular_product',
                            severity: regular.regularity_score > 0.85 ? 'high' : 'medium',
                            productId: regular.product_id,
                            productName: regular.product.name,
                            productCode: regular.product.product_code,
                            details: {
                                lastPurchased: regular.last_purchase_date,
                                daysSince: regular.days_since_last_purchase,
                                usualInterval: regular.avg_days_between_purchases,
                                avgQuantity: regular.avg_quantity_per_order,
                                frequency: regular.purchase_frequency
                            }
                        });
                    }
                }
            }
            
            return { success: true, missingProducts: missing };
            
        } catch (error) {
            console.error('[ANOMALY] Error detecting missing products:', error);
            return { success: false, error: error.message, missingProducts: [] };
        }
    }
    
    /**
     * Check low quantities (existing code - unchanged)
     */
    async detectLowQuantities(customerProfileId, currentOrderItems) {
        try {
            const anomalies = [];
            
            for (const item of currentOrderItems) {
                const { data: affinity } = await dbClient
                    .from('customer_product_affinity')
                    .select('avg_quantity_per_order, purchase_count')
                    .eq('customer_profile_id', customerProfileId)
                    .eq('product_id', item.productId)
                    .single();
                
                if (affinity && affinity.purchase_count >= 3) {
                    const expectedQty = affinity.avg_quantity_per_order;
                    const currentQty = item.quantity;
                    
                    if (currentQty < expectedQty * 0.6) {
                        anomalies.push({
                            type: 'low_quantity',
                            severity: 'medium',
                            productId: item.productId,
                            details: {
                                currentQuantity: currentQty,
                                usualQuantity: expectedQty,
                                reduction: Math.round((1 - currentQty / expectedQty) * 100)
                            }
                        });
                    }
                }
            }
            
            return { success: true, anomalies };
            
        } catch (error) {
            console.error('[ANOMALY] Error detecting low quantities:', error);
            return { success: false, error: error.message, anomalies: [] };
        }
    }
    
    /**
     * Comprehensive order check
     */
    async checkOrderAnomalies(tenantId, customerProfileId, currentOrderItems) {
        try {
            const results = {
                missingProducts: [],
                lowQuantities: [],
                hasAnomalies: false
            };
            
            const missingResult = await this.detectMissingProducts(customerProfileId, currentOrderItems);
            if (missingResult.success) {
                results.missingProducts = missingResult.missingProducts;
            }
            
            const quantityResult = await this.detectLowQuantities(customerProfileId, currentOrderItems);
            if (quantityResult.success) {
                results.lowQuantities = quantityResult.anomalies;
            }
            
            results.hasAnomalies = results.missingProducts.length > 0 || results.lowQuantities.length > 0;
            
            return { success: true, ...results };
            
        } catch (error) {
            console.error('[ANOMALY] Error in comprehensive check:', error);
            return { success: false, error: error.message };
        }
    }
}

module.exports = new AnomalyDetector();
