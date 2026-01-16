const express = require('express');
const router = express.Router();
const { dbClient } = require('../../services/config');
const {
    initializeClient,
    getQRCode,
    getClientStatus,
    disconnectClient,
    getAllConnections
} = require('../../services/whatsappWebService');

function setNoCacheJson(res) {
    // Prevent 304 Not Modified responses (dashboard expects a JSON body).
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('Surrogate-Control', 'no-store');
    // Force a unique ETag so If-None-Match never matches.
    res.set('ETag', String(Date.now()));
}

/**
 * POST /api/whatsapp-web/connect
 * Initialize WhatsApp Web connection for tenant
 */
router.post('/connect', async (req, res) => {
    try {
        const { tenantId, sessionName, salesmanId } = req.body;

        if (!tenantId) {
            return res.status(400).json({
                success: false,
                error: 'Tenant ID is required'
            });
        }

        const sn = String(sessionName || 'default');
        console.log('[WA_WEB_API] Initializing connection for tenant:', tenantId, 'session:', sn, 'salesmanId:', salesmanId || null);

        const result = await initializeClient(tenantId, sn, { salesmanId: salesmanId || null });

        return res.json({
            success: result.success,
            status: result.status,
            error: result.error
        });

    } catch (error) {
        console.error('[WA_WEB_API] Connection error:', error);
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/whatsapp-web/qr/:tenantId
 * Get QR code for scanning
 */
router.get('/qr/:tenantId', async (req, res) => {
    try {
        setNoCacheJson(res);
        const { tenantId } = req.params;
        const sessionName = req.query.sessionName || 'default';

        const result = getQRCode(tenantId, sessionName);

        return res.json({
            success: true,
            qrCode: result.qrCode,
            status: result.status
        });

    } catch (error) {
        console.error('[WA_WEB_API] QR code error:', error);
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/whatsapp-web/status/:tenantId
 * Get connection status
 */
router.get('/status/:tenantId', async (req, res) => {
    try {
        setNoCacheJson(res);
        const { tenantId } = req.params;
        const sessionName = req.query.sessionName || 'default';

        // Set response timeout to prevent hanging
        req.setTimeout(5000); // 5 second timeout

        const result = getClientStatus(tenantId, sessionName);

        // Also get from database with timeout
        const { data: dbConnection, error: dbError } = await Promise.race([
            dbClient
                .from('whatsapp_connections')
                .select('*')
                .eq('tenant_id', tenantId)
                .eq('session_name', String(sessionName || 'default').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_') || 'default')
                .single(),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Database query timeout')), 3000)
            )
        ]);

        if (dbError && dbError.message !== 'Database query timeout') {
            console.warn('[WA_WEB_API] Database error (non-critical):', dbError);
        }

        return res.json({
            success: true,
            status: result.status,
            hasClient: result.hasClient,
            connection: dbConnection || null
        });

    } catch (error) {
        console.error('[WA_WEB_API] Status error:', error);
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/whatsapp-web/disconnect
 * Disconnect WhatsApp Web session
 */
router.post('/disconnect', async (req, res) => {
    try {
        const { tenantId, sessionName } = req.body;

        if (!tenantId) {
            return res.status(400).json({
                success: false,
                error: 'Tenant ID is required'
            });
        }

        const sn = String(sessionName || 'default');
        console.log('[WA_WEB_API] Disconnecting tenant:', tenantId, 'session:', sn);

        const result = await disconnectClient(tenantId, sn);

        return res.json(result);

    } catch (error) {
        console.error('[WA_WEB_API] Disconnect error:', error);
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/whatsapp-web/connections
 * Get all active connections (admin only)
 */
router.get('/connections', async (req, res) => {
    try {
        const connections = getAllConnections();

        // Get database connections
        const { data: dbConnections } = await dbClient
            .from('whatsapp_connections')
            .select('*')
            .order('updated_at', { ascending: false });

        return res.json({
            success: true,
            activeConnections: connections,
            allConnections: dbConnections
        });

    } catch (error) {
        console.error('[WA_WEB_API] Connections list error:', error);
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;


