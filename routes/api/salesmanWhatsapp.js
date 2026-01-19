/**
 * Salesman WhatsApp Connection API
 * Allows individual salesmen to connect their personal WhatsApp numbers
 */

const express = require('express');
const router = express.Router();
const { dbClient } = require('../../services/config');
const {
    initializeClient,
    getQRCode,
    getClientStatus,
    disconnectClient
} = require('../../services/whatsappWebService');

/**
 * POST /api/salesman-whatsapp/connect
 * Salesman connects their personal WhatsApp
 */
router.post('/connect', async (req, res) => {
    try {
        const { salesmanId, tenantId } = req.body;

        if (!salesmanId || !tenantId) {
            return res.status(400).json({
                success: false,
                error: 'Salesman ID and Tenant ID are required'
            });
        }

        // Verify salesman exists
        const { data: salesman, error: salesmanErr } = await dbClient
            .from('salesmen')
            .select('*')
            .eq('id', salesmanId)
            .eq('tenant_id', tenantId)
            .single();

        if (salesmanErr || !salesman) {
            return res.status(404).json({
                success: false,
                error: 'Salesman not found'
            });
        }

        // Session name format: salesman_{salesmanId}
        const sessionName = `salesman_${salesmanId}`;

        console.log('[SALESMAN_WA] Initializing connection for salesman:', salesmanId);

        const result = await initializeClient(tenantId, sessionName, { 
            salesmanId,
            isSalesmanConnection: true
        });

        // Store connection info in database
        if (result.success) {
            const { error: upsertErr } = await dbClient
                .from('whatsapp_connections')
                .upsert({
                    tenant_id: tenantId,
                    session_name: sessionName,
                    salesman_id: salesmanId,
                    connection_type: 'SALESMAN',
                    status: 'connecting',
                    updated_at: new Date().toISOString()
                }, {
                    onConflict: 'tenant_id,session_name'
                });

            if (upsertErr) {
                console.error('[SALESMAN_WA] Database error:', upsertErr);
            }
        }

        return res.json({
            success: result.success,
            status: result.status,
            sessionName,
            error: result.error
        });

    } catch (error) {
        console.error('[SALESMAN_WA] Connection error:', error);
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/salesman-whatsapp/qr/:salesmanId
 * Get QR code for salesman's WhatsApp connection
 */
router.get('/qr/:salesmanId', async (req, res) => {
    try {
        const { salesmanId } = req.params;
        const { tenantId } = req.query;

        if (!tenantId) {
            return res.status(400).json({
                success: false,
                error: 'Tenant ID is required'
            });
        }

        const sessionName = `salesman_${salesmanId}`;
        const result = getQRCode(tenantId, sessionName);

        return res.json({
            success: true,
            qrCode: result.qrCode,
            status: result.status
        });

    } catch (error) {
        console.error('[SALESMAN_WA] QR code error:', error);
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/salesman-whatsapp/status/:salesmanId
 * Get connection status for salesman's WhatsApp
 */
router.get('/status/:salesmanId', async (req, res) => {
    try {
        const { salesmanId } = req.params;
        const { tenantId } = req.query;

        if (!tenantId) {
            return res.status(400).json({
                success: false,
                error: 'Tenant ID is required'
            });
        }

        const sessionName = `salesman_${salesmanId}`;
        const result = getClientStatus(tenantId, sessionName);

        // Get from database
        const { data: dbConnection } = await dbClient
            .from('whatsapp_connections')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('session_name', sessionName)
            .single();

        return res.json({
            success: true,
            status: result.status,
            hasClient: result.hasClient,
            connection: dbConnection || null
        });

    } catch (error) {
        console.error('[SALESMAN_WA] Status error:', error);
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/salesman-whatsapp/disconnect
 * Disconnect salesman's WhatsApp
 */
router.post('/disconnect', async (req, res) => {
    try {
        const { salesmanId, tenantId } = req.body;

        if (!salesmanId || !tenantId) {
            return res.status(400).json({
                success: false,
                error: 'Salesman ID and Tenant ID are required'
            });
        }

        const sessionName = `salesman_${salesmanId}`;
        console.log('[SALESMAN_WA] Disconnecting salesman:', salesmanId);

        const result = await disconnectClient(tenantId, sessionName);

        // Update database
        if (result.success) {
            await dbClient
                .from('whatsapp_connections')
                .update({
                    status: 'disconnected',
                    updated_at: new Date().toISOString()
                })
                .eq('tenant_id', tenantId)
                .eq('session_name', sessionName);
        }

        return res.json(result);

    } catch (error) {
        console.error('[SALESMAN_WA] Disconnect error:', error);
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/salesman-whatsapp/messages/:salesmanId
 * Get messages for salesman's WhatsApp leads
 */
router.get('/messages/:salesmanId', async (req, res) => {
    try {
        const { salesmanId } = req.params;
        const { tenantId } = req.query;

        if (!tenantId) {
            return res.status(400).json({
                success: false,
                error: 'Tenant ID is required'
            });
        }

        // Get leads assigned to this salesman that came from WhatsApp
        const { data: leads, error: leadsErr } = await dbClient
            .from('crm_leads')
            .select(`
                *,
                messages:crm_messages(*)
            `)
            .eq('tenant_id', tenantId)
            .eq('channel', 'WHATSAPP')
            .or(`created_by_user_id.eq.${salesmanId},assigned_user_id.eq.${salesmanId}`)
            .order('updated_at', { ascending: false })
            .limit(100);

        if (leadsErr) throw leadsErr;

        return res.json({
            success: true,
            leads: leads || []
        });

    } catch (error) {
        console.error('[SALESMAN_WA] Messages error:', error);
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
