// routes/api/zohoAuth.js - Tenant-Based Zoho Authorization Routes
const express = require('express');
const router = express.Router();
const zohoTenantAuth = require('../../services/zohoTenantAuthService');
const zohoIntegration = require('../../services/zohoIntegrationService');
const { dbClient } = require('../../services/config');

/**
 * Initialize Zoho authorization for a tenant
 * POST /api/zoho-auth/initialize
 */
router.post('/initialize', async (req, res) => {
    try {
        const { tenantId, redirectUri } = req.body;
        
        if (!tenantId) {
            return res.status(400).json({
                success: false,
                error: 'Tenant ID is required'
            });
        }
        
        // Verify tenant exists
        const { data: tenant, error } = await dbClient
            .from('tenants')
            .select('id, business_name')
            .eq('id', tenantId)
            .single();
            
        if (error || !tenant) {
            return res.status(404).json({
                success: false,
                error: 'Tenant not found'
            });
        }
        
        // Generate authorization URL
        const defaultRedirectUri = redirectUri || `${req.protocol}://${req.get('host')}/api/zoho-auth/callback`;
        const authResult = zohoTenantAuth.generateAuthorizationURL(tenantId, defaultRedirectUri);
        
        console.log('[ZOHO_AUTH_API] Generated auth URL for tenant:', tenantId);
        
        res.json({
            success: true,
            authUrl: authResult.authUrl,
            state: authResult.state,
            tenantId: tenantId,
            tenantName: tenant.business_name,
            message: 'Authorization URL generated. Please visit the URL to authorize Zoho access.'
        });
        
    } catch (error) {
        console.error('[ZOHO_AUTH_API] Initialize error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to initialize authorization'
        });
    }
});

/**
 * Handle Zoho OAuth callback
 * GET /api/zoho-auth/callback
 */
router.get('/callback', async (req, res) => {
    try {
        const { code, state, error: oauthError } = req.query;
        
        if (oauthError) {
            console.error('[ZOHO_AUTH_CALLBACK] OAuth error:', oauthError);
            return res.status(400).send(`
                <html>
                    <body>
                        <h1>Authorization Failed</h1>
                        <p>Error: ${oauthError}</p>
                        <p>Please try again or contact support.</p>
                    </body>
                </html>
            `);
        }
        
        if (!code || !state) {
            return res.status(400).send(`
                <html>
                    <body>
                        <h1>Authorization Failed</h1>
                        <p>Missing authorization code or state parameter.</p>
                    </body>
                </html>
            `);
        }
        
        // Extract tenant ID from state
        const stateMatch = state.match(/^tenant_(\d+)_/);
        if (!stateMatch) {
            return res.status(400).send(`
                <html>
                    <body>
                        <h1>Authorization Failed</h1>
                        <p>Invalid state parameter.</p>
                    </body>
                </html>
            `);
        }
        
        const tenantId = stateMatch[1];
        const redirectUri = `${req.protocol}://${req.get('host')}/api/zoho-auth/callback`;
        
        console.log('[ZOHO_AUTH_CALLBACK] Processing for tenant:', tenantId);
        
        // Exchange code for tokens
        const result = await zohoTenantAuth.exchangeCodeForTokens(tenantId, code, redirectUri);
        
        if (result.success) {
            res.send(`
                <html>
                    <head>
                        <title>Zoho Authorization Successful</title>
                        <style>
                            body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
                            .success { color: #4CAF50; }
                            .info { background: #f0f8ff; padding: 15px; border-radius: 5px; margin: 20px 0; }
                        </style>
                    </head>
                    <body>
                        <h1 class="success">âœ… Zoho Authorization Successful!</h1>
                        <div class="info">
                            <h3>Authorization Details:</h3>
                            <p><strong>Organization:</strong> ${result.organizationName}</p>
                            <p><strong>Organization ID:</strong> ${result.organizationId}</p>
                            <p><strong>Scopes:</strong> ${result.scopes}</p>
                            <p><strong>Tenant ID:</strong> ${tenantId}</p>
                        </div>
                        <p>Your Zoho Books integration is now active. You can close this window and return to your application.</p>
                        
                        <h3>Next Steps:</h3>
                        <ul>
                            <li>Test the connection using the admin dashboard</li>
                            <li>Sync your products with Zoho</li>
                            <li>Start processing orders and invoices</li>
                        </ul>
                    </body>
                </html>
            `);
        } else {
            res.status(400).send(`
                <html>
                    <body>
                        <h1>Authorization Failed</h1>
                        <p>Error: ${result.error}</p>
                        <p>Please try again or contact support.</p>
                    </body>
                </html>
            `);
        }
        
    } catch (error) {
        console.error('[ZOHO_AUTH_CALLBACK] Error:', error);
        res.status(500).send(`
            <html>
                <body>
                    <h1>Authorization Error</h1>
                    <p>An unexpected error occurred: ${error.message}</p>
                    <p>Please try again or contact support.</p>
                </body>
            </html>
        `);
    }
});

/**
 * Get authorization status for a tenant
 * GET /api/zoho-auth/status/:tenantId
 */
router.get('/status/:tenantId', async (req, res) => {
    try {
        const { tenantId } = req.params;
        
        const status = await zohoTenantAuth.getAuthorizationStatus(tenantId);
        
        res.json({
            success: true,
            ...status
        });
        
    } catch (error) {
        console.error('[ZOHO_AUTH_STATUS] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to get authorization status'
        });
    }
});

/**
 * Test Zoho connection for a tenant
 * POST /api/zoho-auth/test/:tenantId
 */
router.post('/test/:tenantId', async (req, res) => {
    try {
        const { tenantId } = req.params;
        
        const testResult = await zohoTenantAuth.testConnection(tenantId);
        
        res.json({
            success: testResult.success,
            ...testResult,
            tenantId
        });
        
    } catch (error) {
        console.error('[ZOHO_AUTH_TEST] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to test connection',
            tenantId: req.params.tenantId
        });
    }
});

/**
 * Revoke Zoho authorization for a tenant
 * DELETE /api/zoho-auth/revoke/:tenantId
 */
router.delete('/revoke/:tenantId', async (req, res) => {
    try {
        const { tenantId } = req.params;
        
        const result = await zohoTenantAuth.revokeAuthorization(tenantId);
        
        res.json({
            success: result.success,
            message: result.message,
            error: result.error,
            tenantId
        });
        
    } catch (error) {
        console.error('[ZOHO_AUTH_REVOKE] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to revoke authorization',
            tenantId: req.params.tenantId
        });
    }
});

/**
 * Sync products with Zoho for a tenant
 * POST /api/zoho-auth/sync-products/:tenantId
 */
router.post('/sync-products/:tenantId', async (req, res) => {
    try {
        const { tenantId } = req.params;
        
        // Check authorization first
        const status = await zohoTenantAuth.getAuthorizationStatus(tenantId);
        if (!status.authorized) {
            return res.status(401).json({
                success: false,
                error: 'Tenant not authorized with Zoho',
                authorizationRequired: true,
                tenantId
            });
        }
        
        const syncResult = await zohoIntegration.syncProductPrices(tenantId);
        
        res.json({
            success: syncResult.success,
            ...syncResult
        });
        
    } catch (error) {
        console.error('[ZOHO_SYNC_PRODUCTS] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to sync products',
            tenantId: req.params.tenantId
        });
    }
});

/**
 * Get Zoho items for a tenant
 * GET /api/zoho-auth/items/:tenantId
 */
router.get('/items/:tenantId', async (req, res) => {
    try {
        const { tenantId } = req.params;
        
        const itemsResult = await zohoIntegration.getItems(tenantId);
        
        res.json({
            success: itemsResult.success,
            items: itemsResult.data?.items || [],
            error: itemsResult.error,
            tenantId
        });
        
    } catch (error) {
        console.error('[ZOHO_ITEMS] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to get items',
            tenantId: req.params.tenantId
        });
    }
});

/**
 * Generate WhatsApp command for tenant admin to authorize Zoho
 * GET /api/zoho-auth/whatsapp-command/:tenantId
 */
router.get('/whatsapp-command/:tenantId', async (req, res) => {
    try {
        const { tenantId } = req.params;
        
        // Verify tenant exists
        const { data: tenant, error } = await dbClient
            .from('tenants')
            .select('id, business_name, admin_phone')
            .eq('id', tenantId)
            .single();
            
        if (error || !tenant) {
            return res.status(404).json({
                success: false,
                error: 'Tenant not found'
            });
        }
        
        const redirectUri = `${req.protocol}://${req.get('host')}/api/zoho-auth/callback`;
        const authResult = zohoTenantAuth.generateAuthorizationURL(tenantId, redirectUri);
        
        const whatsappMessage = `ðŸ” *Zoho Books Authorization Required*

Hi ${tenant.business_name}! To enable invoice generation and sales order management, please authorize your Zoho Books account.

*Click this link to authorize:*
${authResult.authUrl}

*What this enables:*
âœ… Automatic invoice generation
âœ… Sales order creation
âœ… Customer sync with Zoho Books
âœ… Product price synchronization
âœ… PDF delivery to customers

*Security Note:*
- This link is secure and specific to your account
- It only grants necessary permissions for order processing
- You can revoke access anytime from your Zoho account

After authorization, your WhatsApp sales bot will be fully integrated with Zoho Books!`;

        res.json({
            success: true,
            message: whatsappMessage,
            authUrl: authResult.authUrl,
            tenantId: tenantId,
            adminPhone: tenant.admin_phone
        });
        
    } catch (error) {
        console.error('[ZOHO_WHATSAPP_CMD] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to generate WhatsApp command'
        });
    }
});

module.exports = router;
