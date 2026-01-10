/**
 * @title Complete Fixed Web API Routes
 * @description All API endpoints for the web-based tenant dashboard
 */
const express = require('express');
const { dbClient } = require('../services/config');
const dashboardRoutes = require('./api/dashboard');

const router = express.Router();

// The endpoint that your frontend dashboard.html actually calls
router.post('/verify-token', async (req, res) => {
    const { token } = req.body;

    if (!token) {
        return res.status(400).json({ 
            success: false, 
            error: 'Token is required.' 
        });
    }

    try {
        const now = new Date();

        // Find a tenant with a matching, non-expired token
        const { data: tenant, error } = await dbClient
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

        // Invalidate the token so it cannot be used again
        await dbClient
            .from('tenants')
            .update({ web_auth_token: null, web_auth_token_expires_at: null })
            .eq('id', tenant.id);

        console.log('Token verified successfully for tenant:', tenant.business_name);

        // Return success response with session data (matching frontend expectations)
        res.status(200).json({
            success: true,
            message: 'Login successful!',
            session: {
                tenantId: tenant.id,
                businessName: tenant.business_name || 'Your Dashboard',
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
router.post('/verify-magic-token', async (req, res) => {
    const { token } = req.body;

    if (!token) {
        return res.status(400).json({ error: 'Token is required.' });
    }

    try {
        const now = new Date();

        const { data: tenant, error } = await dbClient
            .from('tenants')
            .select('id, business_name, web_auth_token_expires_at')
            .eq('web_auth_token', token)
            .gt('web_auth_token_expires_at', now.toISOString())
            .single();

        if (error || !tenant) {
            return res.status(401).json({ error: 'Invalid or expired login link.' });
        }

        await dbClient
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

// Dashboard routes
router.use('/dashboard', dashboardRoutes);

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

