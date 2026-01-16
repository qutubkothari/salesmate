const express = require('express');
const router = express.Router();
const { dbClient } = require('../../services/config');

/**
 * GET /api/discounts/:tenantId
 * Get all discount rules for a tenant
 */
router.get('/:tenantId', async (req, res) => {
    try {
        const { tenantId } = req.params;
        const { active, type } = req.query;

        let query = dbClient
            .from('discount_rules')
            .select('*')
            .eq('tenant_id', tenantId)
            .order('priority', { ascending: false })
            .order('created_at', { ascending: false });

        // Filter by active status if specified
        if (active !== undefined) {
            query = query.eq('is_active', active === 'true');
        }

        // Filter by discount type if specified
        if (type) {
            query = query.eq('discount_type', type);
        }

        const { data, error } = await query;

        if (error) throw error;

        res.json({
            success: true,
            discounts: data,
            count: data.length
        });
    } catch (error) {
        console.error('[DISCOUNT_API] Error fetching discounts:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/discounts/:tenantId/:discountId
 * Get a specific discount rule
 */
router.get('/:tenantId/:discountId', async (req, res) => {
    try {
        const { tenantId, discountId } = req.params;

        const { data, error } = await dbClient
            .from('discount_rules')
            .select('*')
            .eq('id', discountId)
            .eq('tenant_id', tenantId)
            .single();

        if (error) throw error;

        if (!data) {
            return res.status(404).json({
                success: false,
                error: 'Discount rule not found'
            });
        }

        res.json({
            success: true,
            discount: data
        });
    } catch (error) {
        console.error('[DISCOUNT_API] Error fetching discount:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/discounts/:tenantId
 * Create a new discount rule
 */
router.post('/:tenantId', async (req, res) => {
    try {
        const { tenantId } = req.params;
        const discountData = req.body;

        console.log('[DISCOUNT_API] Creating discount with data:', JSON.stringify(discountData, null, 2));

        // Validate required fields
        if (!discountData.name || !discountData.discount_type || !discountData.discount_value_type || discountData.discount_value === undefined) {
            console.log('[DISCOUNT_API] Validation failed - missing required fields:', {
                hasName: !!discountData.name,
                hasType: !!discountData.discount_type,
                hasValueType: !!discountData.discount_value_type,
                hasValue: discountData.discount_value !== undefined
            });
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: name, discount_type, discount_value_type, discount_value'
            });
        }

        // Validate discount value
        if (discountData.discount_value < 0) {
            return res.status(400).json({
                success: false,
                error: 'Discount value must be positive'
            });
        }

        // Validate percentage discount
        if (discountData.discount_value_type === 'percentage' && discountData.discount_value > 100) {
            return res.status(400).json({
                success: false,
                error: 'Percentage discount cannot exceed 100%'
            });
        }

        // Check for duplicate coupon code
        if (discountData.coupon_code) {
            const { data: existing } = await dbClient
                .from('discount_rules')
                .select('id')
                .eq('tenant_id', tenantId)
                .eq('coupon_code', discountData.coupon_code)
                .single();

            if (existing) {
                return res.status(400).json({
                    success: false,
                    error: 'Coupon code already exists'
                });
            }
        }

        const { data, error } = await dbClient
            .from('discount_rules')
            .insert({
                tenant_id: tenantId,
                ...discountData,
                created_by: req.body.created_by || 'admin'
            })
            .select()
            .single();

        if (error) throw error;

        console.log('[DISCOUNT_API] Created discount rule:', data.id);

        res.status(201).json({
            success: true,
            discount: data,
            message: 'Discount rule created successfully'
        });
    } catch (error) {
        console.error('[DISCOUNT_API] Error creating discount:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * PUT /api/discounts/:tenantId/:discountId
 * Update an existing discount rule
 */
router.put('/:tenantId/:discountId', async (req, res) => {
    try {
        const { tenantId, discountId } = req.params;
        const updates = req.body;

        // Remove fields that shouldn't be updated
        delete updates.id;
        delete updates.tenant_id;
        delete updates.created_at;
        delete updates.times_applied;
        delete updates.total_discount_given;

        // Check for duplicate coupon code if updating
        if (updates.coupon_code) {
            const { data: existing } = await dbClient
                .from('discount_rules')
                .select('id')
                .eq('tenant_id', tenantId)
                .eq('coupon_code', updates.coupon_code)
                .neq('id', discountId)
                .single();

            if (existing) {
                return res.status(400).json({
                    success: false,
                    error: 'Coupon code already exists'
                });
            }
        }

        const { data, error } = await dbClient
            .from('discount_rules')
            .update(updates)
            .eq('id', discountId)
            .eq('tenant_id', tenantId)
            .select()
            .single();

        if (error) throw error;

        if (!data) {
            return res.status(404).json({
                success: false,
                error: 'Discount rule not found'
            });
        }

        console.log('[DISCOUNT_API] Updated discount rule:', discountId);

        res.json({
            success: true,
            discount: data,
            message: 'Discount rule updated successfully'
        });
    } catch (error) {
        console.error('[DISCOUNT_API] Error updating discount:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * DELETE /api/discounts/:tenantId/:discountId
 * Delete a discount rule
 */
router.delete('/:tenantId/:discountId', async (req, res) => {
    try {
        const { tenantId, discountId } = req.params;

        const { data, error } = await dbClient
            .from('discount_rules')
            .delete()
            .eq('id', discountId)
            .eq('tenant_id', tenantId)
            .select()
            .single();

        if (error) throw error;

        if (!data) {
            return res.status(404).json({
                success: false,
                error: 'Discount rule not found'
            });
        }

        console.log('[DISCOUNT_API] Deleted discount rule:', discountId);

        res.json({
            success: true,
            message: 'Discount rule deleted successfully'
        });
    } catch (error) {
        console.error('[DISCOUNT_API] Error deleting discount:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/discounts/:tenantId/:discountId/toggle
 * Toggle active status of a discount rule
 */
router.post('/:tenantId/:discountId/toggle', async (req, res) => {
    try {
        const { tenantId, discountId } = req.params;

        // Get current status
        const { data: current } = await dbClient
            .from('discount_rules')
            .select('is_active')
            .eq('id', discountId)
            .eq('tenant_id', tenantId)
            .single();

        if (!current) {
            return res.status(404).json({
                success: false,
                error: 'Discount rule not found'
            });
        }

        // Toggle status
        const { data, error } = await dbClient
            .from('discount_rules')
            .update({ is_active: !current.is_active })
            .eq('id', discountId)
            .eq('tenant_id', tenantId)
            .select()
            .single();

        if (error) throw error;

        console.log('[DISCOUNT_API] Toggled discount rule:', discountId, 'to', data.is_active);

        res.json({
            success: true,
            discount: data,
            message: `Discount rule ${data.is_active ? 'activated' : 'deactivated'} successfully`
        });
    } catch (error) {
        console.error('[DISCOUNT_API] Error toggling discount:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/discounts/:tenantId/applications
 * Get discount application history (audit log)
 */
router.get('/:tenantId/applications/history', async (req, res) => {
    try {
        const { tenantId } = req.params;
        const { limit = 50, offset = 0 } = req.query;

        const { data, error, count } = await dbClient
            .from('discount_applications')
            .select('*', { count: 'exact' })
            .eq('tenant_id', tenantId)
            .order('applied_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) throw error;

        res.json({
            success: true,
            applications: data,
            count: count,
            limit: parseInt(limit),
            offset: parseInt(offset)
        });
    } catch (error) {
        console.error('[DISCOUNT_API] Error fetching applications:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/discounts/:tenantId/stats
 * Get discount statistics for a tenant
 */
router.get('/:tenantId/stats/summary', async (req, res) => {
    try {
        const { tenantId } = req.params;

        // Get total discount rules
        const { count: totalRules } = await dbClient
            .from('discount_rules')
            .select('*', { count: 'exact', head: true })
            .eq('tenant_id', tenantId);

        // Get active discount rules
        const { count: activeRules } = await dbClient
            .from('discount_rules')
            .select('*', { count: 'exact', head: true })
            .eq('tenant_id', tenantId)
            .eq('is_active', true);

        // Get total discount applications
        const { count: totalApplications } = await dbClient
            .from('discount_applications')
            .select('*', { count: 'exact', head: true })
            .eq('tenant_id', tenantId);

        // Get total discount amount given
        const { data: discountSum } = await dbClient
            .from('discount_applications')
            .select('discount_amount')
            .eq('tenant_id', tenantId);

        const totalDiscountGiven = discountSum?.reduce((sum, app) => sum + parseFloat(app.discount_amount || 0), 0) || 0;

        // Get top 5 most used discounts
        const { data: topDiscounts } = await dbClient
            .from('discount_rules')
            .select('id, name, times_applied, total_discount_given')
            .eq('tenant_id', tenantId)
            .order('times_applied', { ascending: false })
            .limit(5);

        res.json({
            success: true,
            stats: {
                totalRules,
                activeRules,
                inactiveRules: totalRules - activeRules,
                totalApplications,
                totalDiscountGiven: totalDiscountGiven.toFixed(2),
                topDiscounts
            }
        });
    } catch (error) {
        console.error('[DISCOUNT_API] Error fetching stats:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/discounts/:tenantId/validate-coupon
 * Validate a coupon code
 */
router.post('/:tenantId/validate-coupon', async (req, res) => {
    try {
        const { tenantId } = req.params;
        const { coupon_code, order_value } = req.body;

        if (!coupon_code) {
            return res.status(400).json({
                success: false,
                error: 'Coupon code is required'
            });
        }

        const { data, error } = await dbClient
            .from('discount_rules')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('coupon_code', coupon_code)
            .eq('is_active', true)
            .single();

        if (error || !data) {
            return res.json({
                success: false,
                valid: false,
                message: 'Invalid or expired coupon code'
            });
        }

        // Check validity dates
        const now = new Date();
        if (data.valid_from && new Date(data.valid_from) > now) {
            return res.json({
                success: false,
                valid: false,
                message: 'Coupon not yet active'
            });
        }
        if (data.valid_to && new Date(data.valid_to) < now) {
            return res.json({
                success: false,
                valid: false,
                message: 'Coupon has expired'
            });
        }

        // Check usage limit
        if (data.coupon_usage_limit && data.coupon_used_count >= data.coupon_usage_limit) {
            return res.json({
                success: false,
                valid: false,
                message: 'Coupon usage limit reached'
            });
        }

        // Check minimum order value
        if (data.min_order_value && order_value < data.min_order_value) {
            return res.json({
                success: false,
                valid: false,
                message: `Minimum order value of ₹${data.min_order_value} required`
            });
        }

        res.json({
            success: true,
            valid: true,
            discount: data,
            message: 'Coupon is valid'
        });
    } catch (error) {
        console.error('[DISCOUNT_API] Error validating coupon:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;


