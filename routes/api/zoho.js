const express = require('express');
const router = express.Router();
const zohoTenantAuth = require('../../services/zohoTenantAuthService');
const zohoInvoiceSync = require('../../services/zohoInvoiceSyncService');

/**
 * Initialize Zoho authorization for a tenant
 * POST /api/zoho/auth/initialize
 */
router.post('/auth/initialize', async (req, res) => {
  try {
    const { tenantId, redirectUri } = req.body;
    if (!tenantId) {
      return res.status(400).json({ success: false, error: 'Tenant ID is required' });
    }
    // Verify tenant exists
    const { data: tenant, error } = await dbClient
      .from('tenants')
      .select('id, business_name')
      .eq('id', tenantId)
      .single();
    if (error || !tenant) {
      return res.status(404).json({ success: false, error: 'Tenant not found' });
    }
    // Generate authorization URL
    const defaultRedirectUri = redirectUri || `${req.protocol}://${req.get('host')}/api/zoho/auth/callback`;
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
    res.status(500).json({ success: false, error: error.message || 'Failed to initialize authorization' });
  }
});

/**
 * Handle Zoho OAuth callback
 * GET /api/zoho/auth/callback
 */
router.get('/auth/callback', async (req, res) => {
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
    const stateMatch = state.match(/^tenant_(\w+-\w+-\w+-\w+-\w+)_/);
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
    const redirectUri = `${req.protocol}://${req.get('host')}/api/zoho/auth/callback`;
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
 * GET /api/zoho/auth/status/:tenantId
 */
router.get('/auth/status/:tenantId', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const status = await zohoTenantAuth.getAuthorizationStatus(tenantId);
    res.json({ success: true, ...status });
  } catch (error) {
    console.error('[ZOHO_AUTH_STATUS] Error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to get authorization status' });
  }
});

/**
 * Test Zoho connection for a tenant
 * POST /api/zoho/auth/test/:tenantId
 */
router.post('/auth/test/:tenantId', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const testResult = await zohoTenantAuth.testConnection(tenantId);
    res.json({ success: testResult.success, ...testResult, tenantId });
  } catch (error) {
    console.error('[ZOHO_AUTH_TEST] Error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to test connection', tenantId: req.params.tenantId });
  }
});

/**
 * Generate WhatsApp command for tenant admin to authorize Zoho
 * GET /api/zoho/auth/whatsapp-command/:tenantId
 */
router.get('/auth/whatsapp-command/:tenantId', async (req, res) => {
  try {
    const { tenantId } = req.params;
    // Verify tenant exists
    const { data: tenant, error } = await dbClient
      .from('tenants')
      .select('id, business_name, admin_phone')
      .eq('id', tenantId)
      .single();
    if (error || !tenant) {
      return res.status(404).json({ success: false, error: 'Tenant not found' });
    }
    const redirectUri = `${req.protocol}://${req.get('host')}/api/zoho/auth/callback`;
    const authResult = zohoTenantAuth.generateAuthorizationURL(tenantId, redirectUri);
    const whatsappMessage = `ðŸ” *Zoho Books Authorization Required*\n\nHi ${tenant.business_name}! To enable invoice generation and sales order management, please authorize your Zoho Books account.\n\n*Click this link to authorize:*\n${authResult.authUrl}\n\n*What this enables:*\nâœ… Automatic invoice generation\nâœ… Sales order creation\nâœ… Customer sync with Zoho Books\nâœ… Product price synchronization\nâœ… PDF delivery to customers\n\n*Security Note:*\n- This link is secure and specific to your account\n- It only grants necessary permissions for order processing\n- You can revoke access anytime from your Zoho account\n\nAfter authorization, your WhatsApp sales bot will be fully integrated with Zoho Books!`;
    res.json({ success: true, message: whatsappMessage, authUrl: authResult.authUrl, tenantId: tenantId, adminPhone: tenant.admin_phone });
  } catch (error) {
    console.error('[ZOHO_WHATSAPP_CMD] Error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to generate WhatsApp command' });
  }
});
// routes/api/zoho.js
const zohoMatching = require('../../services/zohoCustomerMatchingService');
const zohoIntegration = require('../../services/zohoIntegrationService');
const { dbClient } = require('../../services/config');

/**
 * GET /api/admin/zoho/pending-syncs
 * Get all pending sync requests (customers without Zoho ID)
 */
router.get('/zoho/pending-syncs', async (req, res) => {
  try {
    const tenantId = req.query.tenant_id || process.env.TENANT_ID;
    
    if (!tenantId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Tenant ID is required' 
      });
    }

    // Get customers who have GST but no Zoho ID (need manual approval)
    const { data: pendingSyncs, error } = await dbClient
      .from('customer_profiles')
      .select('id, phone, company, first_name, last_name, gst_number, business_address, created_at')
      .eq('tenant_id', tenantId)
      .is('zoho_customer_id', null)
      .not('gst_number', 'is', null)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    // Format for dashboard
    const formattedSyncs = pendingSyncs.map(profile => ({
      id: profile.id,
      phone: profile.phone,
      company: profile.company,
      name: `${profile.first_name || ''} ${profile.last_name || ''}`.trim(),
      email: profile.email || '',
      sync_data: JSON.stringify({
        company: profile.company,
        name: `${profile.first_name || ''} ${profile.last_name || ''}`.trim(),
        phone: profile.phone,
        gst_number: profile.gst_number,
        address: profile.business_address || ''
      }),
      status: 'pending',
      created_at: profile.created_at
    }));

    res.json({
      success: true,
      count: formattedSyncs.length,
      syncs: formattedSyncs
    });

  } catch (error) {
    console.error('[Zoho API] Error fetching pending syncs:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * POST /api/admin/zoho/approve-sync/:syncId
 * Approve a pending sync and create customer in Zoho
 */
router.post('/zoho/approve-sync/:syncId', async (req, res) => {
  try {
    const { syncId } = req.params;
    const tenantId = req.body?.tenant_id || req.query?.tenant_id || process.env.TENANT_ID;

    // fetch profile
    const { data: profile, error: fetchError } = await dbClient
      .from('customer_profiles')
      .select('*')
      .eq('id', syncId)
      .single();

    if (fetchError || !profile) {
      console.error('[Zoho API] approve-sync: profile fetch error', fetchError);
      return res.status(404).json({ success: false, error: 'Customer profile not found' });
    }

    // build payload for Zoho
    const zohoCustomerData = {
      display_name: profile.company || `${profile.first_name || ''} ${profile.last_name || ''}`.trim(),
      company_name: profile.company,
      gst_no: profile.gst_number,
      phone: profile.phone,
      first_name: profile.first_name,
      last_name: profile.last_name,
      place_of_supply: profile.place_of_supply || 'MH',
      billing_address: profile.business_address ? {
        address: profile.business_address,
        city: '',
        state: '',
        zip: '',
        country: 'India'
      } : undefined
    };

    console.log('[Zoho API] Approve-sync payload preview', { id: syncId, tenantId, preview: { company: zohoCustomerData.company_name, gst: zohoCustomerData.gst_no, phone: zohoCustomerData.phone } });

    // call integration service
    const result = await zohoIntegration.syncCustomer(zohoCustomerData);

    if (!result.success) {
      // return rich debug info (non-sensitive)
      console.error('[Zoho API] zohoIntegration.syncCustomer failed:', {
        error: result.error,
        status: result.status,
        rawPreview: result.raw ? (typeof result.raw === 'string' ? result.raw.slice(0, 2000) : result.raw) : undefined,
        dataPreview: result.data ? (JSON.stringify(result.data).slice(0,2000)) : undefined
      });

      return res.status(500).json({
        success: false,
        error: result.error || 'Failed to create customer in Zoho',
        detail: {
          status: result.status || null,
          raw: result.raw ? (typeof result.raw === 'string' ? result.raw.slice(0,2000) : result.raw) : null,
          data: result.data || null
        }
      });
    }

    // update DB with zoho id (best-effort)
    if (result.customerId) {
      const { error: updateError } = await dbClient
        .from('customer_profiles')
        .update({ zoho_customer_id: result.customerId, updated_at: new Date().toISOString() })
        .eq('id', syncId);

      if (updateError) {
        console.error('[Zoho API] Failed to update profile with zoho id:', updateError);
      }
    } else {
      console.warn('[Zoho API] syncCustomer succeeded but no customerId returned', result);
    }

    return res.json({
      success: true,
      message: 'Customer synced to Zoho Books successfully',
      zoho_customer_id: result.customerId || null,
      customer_name: profile.company || `${profile.first_name || ''} ${profile.last_name || ''}`.trim()
    });

  } catch (err) {
    console.error('[Zoho API] Error approving sync:', err);
    return res.status(500).json({ success: false, error: err.message || String(err) });
  }
});
// Debug: attempt to create SAK SOLUTIONS customer and return raw result
router.get('/zoho/debug-create-sak', async (req, res) => {
  try {
    const sakPayload = {
      display_name: 'SAK SOLUTIONS',
      company_name: 'SAK SOLUTIONS',
      gst_no: '27ACQFS1175A1Z4',
      phone: '919106886259',
      first_name: 'AATIF',
      last_name: 'KOTHARI',
      place_of_supply: 'MH',
      billing_address: {
        address: 'of Principal Place of, Business, GROUND FLOOR, SHOP NO.8, MARUTI COMPLEX, DUDHBHATTI ROAD, GANESH PETH, PUNE, Pune,',
        city: 'Pune',
        state: 'Maharashtra',
        zip: '',
        country: 'India'
      }
    };

    const result = await zohoIntegration.syncCustomer(sakPayload);
    return res.json({ success: result.success, result });
  } catch (err) {
    console.error('[Zoho API] debug-create-sak error:', err);
    return res.status(500).json({ success: false, error: err.message || String(err) });
  }
});

/**
 * POST /api/admin/zoho/reject-sync/:syncId
 * Reject a pending sync request
 */
router.post('/zoho/reject-sync/:syncId', async (req, res) => {
  try {
    const { syncId } = req.params;
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({ 
        success: false, 
        error: 'Rejection reason is required' 
      });
    }

    // For now, just log the rejection (you can add a rejections table if needed)
    console.log(`[Zoho API] Sync ${syncId} rejected: ${reason}`);

    // Optionally: Delete the customer profile or mark it somehow
    // For now, we'll just log it

    res.json({
      success: true,
      message: 'Sync request rejected successfully'
    });

  } catch (error) {
    console.error('[Zoho API] Error rejecting sync:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * GET /api/admin/zoho/test-connection
 * Test Zoho API connection
 */
router.get('/zoho/test-connection', async (req, res) => {
  try {
    const token = await zohoIntegration.getAccessToken();
    
    res.json({
      success: true,
      message: 'Successfully connected to Zoho Books',
      token_preview: token.substring(0, 20) + '...'
    });

  } catch (error) {
    console.error('[Zoho API] Connection test failed:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * GET /api/admin/zoho/stats
 * Get Zoho sync statistics
 */
router.get('/zoho/stats', async (req, res) => {
  try {
    const tenantId = req.query.tenant_id || process.env.TENANT_ID;

    // Pending syncs (have GST but no Zoho ID)
    const { count: pendingCount } = await dbClient
      .from('customer_profiles')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .is('zoho_customer_id', null)
      .not('gst_number', 'is', null);

    // Auto-matched (have Zoho ID)
    const { count: matchedCount } = await dbClient
      .from('customer_profiles')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .not('zoho_customer_id', 'is', null);

    // Approved today (linked today)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const { count: approvedTodayCount } = await dbClient
      .from('customer_profiles')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .not('zoho_customer_id', 'is', null)
      .gte('updated_at', today.toISOString());

    res.json({
      success: true,
      stats: {
        pending: pendingCount || 0,
        approved_today: approvedTodayCount || 0,
        rejected_today: 0, // Not tracking rejections yet
        auto_matched: matchedCount || 0,
        total_approved: matchedCount || 0
      }
    });

  } catch (error) {
    console.error('[Zoho API] Error getting stats:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * GET /api/admin/zoho/customer-search
 * Search for customer in Zoho Books
 */
router.get('/zoho/customer-search', async (req, res) => {
  try {
    const { phone, company } = req.query;

    if (!phone && !company) {
      return res.status(400).json({ 
        success: false, 
        error: 'Phone or company name is required' 
      });
    }

    let result;

    if (phone) {
      result = await zohoMatching.searchZohoByPhone(phone);
    } else if (company) {
      result = await zohoMatching.searchZohoByCompanyName(company);
    }

    if (result.success && result.customer) {
      res.json({
        success: true,
        count: 1,
        customers: [result.customer]
      });
    } else {
      res.json({
        success: true,
        count: 0,
        customers: []
      });
    }

  } catch (error) {
    console.error('[Zoho API] Error searching customers:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});


// --- ADD: /zoho/sync-stats (rollup of order sync states)
router.get('/zoho/sync-stats', async (req, res) => {
  try {
    const tenantId = req.query.tenant_id || process.env.TENANT_ID;
    if (!tenantId) return res.status(400).json({ success: false, error: 'Tenant ID is required' });

    const { data, error } = await dbClient
      .from('orders')
      .select('zoho_sync_status, count:id', { count: 'exact', head: false })
      .eq('tenant_id', tenantId)
      .group('zoho_sync_status');

    if (error) throw error;

    const stats = (data || []).reduce((acc, row) => {
      const k = row.zoho_sync_status || 'unknown';
      acc[k] = (acc[k] || 0) + (row.count || 0);
      return acc;
    }, {});

    res.json({ success: true, stats });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// --- ADD: /zoho/retry-failed-syncs (retry all failed orders)
router.post('/zoho/retry-failed-syncs', async (req, res) => {
  try {
    const tenantId = req.body?.tenant_id || req.query?.tenant_id || process.env.TENANT_ID;
    if (!tenantId) return res.status(400).json({ success: false, error: 'Tenant ID is required' });

    const { data: failed, error } = await dbClient
      .from('orders')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('zoho_sync_status', 'failed')
      .limit(50);

    if (error) throw error;

    const { processOrderToZoho } = require('../../services/zohoSalesOrderService');
    const results = [];

    for (const row of failed || []) {
      try {
        const r = await processOrderToZoho(tenantId, row.id);
        results.push({ orderId: row.id, ok: !!r.success, err: r.error || null });
      } catch (e) {
        results.push({ orderId: row.id, ok: false, err: e.message });
      }
    }

    res.json({ success: true, retried: results.length, results });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// --- ADD: /zoho/order-status/:orderId
router.get('/zoho/order-status/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { data, error } = await dbClient
      .from('orders')
      .select('id, zoho_sales_order_id, zoho_sync_status, zoho_synced_at, zoho_sync_error')
      .eq('id', orderId)
      .single();
    if (error) throw error;
    res.json({ success: true, order: data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});
// Debug endpoint to check environment variables
router.get('/zoho/debug-env', async (req, res) => {
  res.json({
    client_id: process.env.ZOHO_CLIENT_ID ? 'present' : 'missing',
    client_secret: process.env.ZOHO_CLIENT_SECRET ? 'present' : 'missing', 
    refresh_token: process.env.ZOHO_REFRESH_TOKEN ? 'present' : 'missing',
    org_id: process.env.ZOHO_ORGANIZATION_ID ? 'present' : 'missing',
    refresh_token_preview: process.env.ZOHO_REFRESH_TOKEN?.substring(0, 20) + '...',
    org_id_value: process.env.ZOHO_ORGANIZATION_ID
  });
});

// Test the actual token with Books API
router.get('/zoho/test-token', async (req, res) => {
  try {
    const token = await zohoIntegration.getAccessToken();
    
    // Test Books API directly
    const fetch = require('node-fetch');
    const testResponse = await fetch(
      `https://www.zohoapis.in/books/v3/contacts?organization_id=${process.env.ZOHO_ORGANIZATION_ID}`,
      {
        headers: {
          'Authorization': `Zoho-oauthtoken ${token}`
        }
      }
    );
    
    const result = await testResponse.text();
    res.json({ 
      status: testResponse.status,
      success: testResponse.ok,
      response: result,
      url_used: `https://www.zohoapis.in/books/v3/contacts?organization_id=${process.env.ZOHO_ORGANIZATION_ID}`
    });
  } catch (error) {
    res.json({ error: error.message });
  }
});

/**
 * Sync a specific invoice from Zoho to database
 * POST /api/zoho/sync/invoice
 * Body: { tenantId, invoiceId }
 */
router.post('/sync/invoice', async (req, res) => {
  try {
    const { tenantId, invoiceId } = req.body;
    
    if (!tenantId || !invoiceId) {
      return res.status(400).json({
        success: false,
        error: 'tenantId and invoiceId are required'
      });
    }

    console.log(`[ZOHO_SYNC_API] Syncing invoice ${invoiceId} for tenant ${tenantId}`);
    
    const result = await zohoInvoiceSync.syncInvoiceFromZoho(tenantId, invoiceId);
    
    if (result.success) {
      return res.json({
        success: true,
        message: 'Invoice synced successfully',
        invoice: result.invoice
      });
    } else {
      return res.status(500).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    console.error('[ZOHO_SYNC_API] Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Sync all invoices from Zoho to database
 * POST /api/zoho/sync/invoices/all
 * Body: { tenantId, days } (days is optional, default 30)
 */
router.post('/sync/invoices/all', async (req, res) => {
  try {
    const { tenantId, days } = req.body;
    
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: 'tenantId is required'
      });
    }

    console.log(`[ZOHO_SYNC_API] Syncing all invoices for tenant ${tenantId}`);
    
    const result = await zohoInvoiceSync.syncAllInvoicesFromZoho(tenantId, days || 30);
    
    if (result.success) {
      return res.json({
        success: true,
        message: `Synced ${result.synced} of ${result.totalInvoices} invoices`,
        details: result
      });
    } else {
      return res.status(500).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    console.error('[ZOHO_SYNC_API] Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Webhook endpoint for Zoho to notify about invoice changes
 * POST /api/zoho/webhook/invoice
 */
router.post('/webhook/invoice', zohoInvoiceSync.handleZohoInvoiceWebhook);

module.exports = router;
