const express = require('express');
const { supabase } = require('../services/config');
const router = express.Router();
const { validate, z, zTrimmedString } = require('../middleware/validate');

const verifyTokenBodySchema = z.object({ token: zTrimmedString(1, 256) }).strict();

// Mount dashboard sub-routes
const dashboardRouter = require('./api/dashboard');
router.use('/dashboard', dashboardRouter);

// Mount AI learning dashboard
const aiLearningRouter = require('./api/aiLearning');
router.use('/ai-learning', aiLearningRouter);

// Mount follow-ups API
const followupsRouter = require('./api/followups');
router.use('/followups', followupsRouter);

// Authentication endpoints

// Backup compatibility endpoint (alias for verify-token)
router.post('/verify-magic-token', validate({ body: verifyTokenBodySchema }), async (req, res) => {
    // Redirect to the main verify-token endpoint
    return router.post('/verify-token')(req, res);
});

// ... keep your other API routes here
router.post('/verify-token', validate({ body: verifyTokenBodySchema }), async (req, res) => {
    const { token } = req.body;

    if (!token) {
        return res.status(400).json({ 
            success: false, 
            error: 'Token is required.' 
        });
    }

    try {
        // TEMP: Allow demo access with special token "demo"
        if (token === 'demo' || token === 'demo-token') {
            console.log('[API] Demo access attempt...');
            
            // Try to find any active tenant (preferably the first one)
            const { data: tenants } = await supabase
                .from('tenants')
                .select('id, business_name, admin_phones')
                .limit(1);
            
            if (tenants && tenants.length > 0) {
                const tenant = tenants[0];
                console.log('[API] Demo access granted for tenant:', tenant.business_name);
                return res.status(200).json({
                    success: true,
                    message: 'Demo login successful!',
                    session: {
                        tenantId: tenant.id,
                        businessName: tenant.business_name || 'Demo Dashboard',
                        token: token // Pass token for API calls
                    }
                });
            } else {
                console.log('[API] No tenants found for demo access');
                return res.status(404).json({
                    success: false,
                    error: 'No tenant available for demo access'
                });
            }
        }

        const now = new Date();

        // Find a tenant with a matching, non-expired token
        const { data: tenant, error } = await supabase
            .from('tenants')
            .select('id, business_name, web_auth_token_expires_at')
            .eq('web_auth_token', token)
            .gt('web_auth_token_expires_at', now.toISOString())
            .single();

        if (error || !tenant) {
            console.log('Token verification failed:', error?.message || 'No tenant found');
            return res.status(401).json({ 
                success: false, 
                error: 'Invalid or expired login link.' 
            });
        }

        // TEMP: Don't invalidate token for demo purposes
        // await supabase
        //     .from('tenants')
        //     .update({ web_auth_token: null, web_auth_token_expires_at: null })
        //     .eq('id', tenant.id);

        console.log('Token verified successfully for tenant:', tenant.business_name);

        // Return success response with session data (matching frontend expectations)
        res.status(200).json({
            success: true,
            message: 'Login successful!',
            session: {
                tenantId: tenant.id,
                businessName: tenant.business_name || 'Your Dashboard',
                token: token // Include token for subsequent API calls
            }
        });

    } catch (error) {
        console.error('Error verifying token:', error.message);
        res.status(500).json({ 
            success: false, 
            error: 'Internal server error.' 
        });
    }
});

// Keep the original magic token endpoint for backward compatibility
router.post('/verify-magic-token', validate({ body: verifyTokenBodySchema }), async (req, res) => {
    const { token } = req.body;

    if (!token) {
        return res.status(400).json({ error: 'Token is required.' });
    }

    try {
        const now = new Date();

        const { data: tenant, error } = await supabase
            .from('tenants')
            .select('id, business_name, web_auth_token_expires_at')
            .eq('web_auth_token', token)
            .gt('web_auth_token_expires_at', now.toISOString())
            .single();

        if (error || !tenant) {
            return res.status(401).json({ error: 'Invalid or expired login link.' });
        }

        await supabase
            .from('tenants')
            .update({ web_auth_token: null, web_auth_token_expires_at: null })
            .eq('id', tenant.id);

        res.status(200).json({
            message: 'Login successful!',
            session: {
                tenantId: tenant.id,
                businessName: tenant.business_name || 'Your Dashboard',
            }
        });

    } catch (error) {
        console.error('Error verifying magic token:', error.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// Test endpoint to verify API is working
router.get('/test', (req, res) => {
    res.json({ 
        success: true, 
        message: 'API is working', 
        timestamp: new Date().toISOString(),
        endpoints: [
            'POST /api/verify-token',
            'POST /api/verify-magic-token', 
            'GET /api/dashboard/stats/:tenantId',
            'GET /api/dashboard/orders/:tenantId',
            'GET /api/dashboard/conversations/:tenantId'
        ]
    });
});

module.exports = router;
