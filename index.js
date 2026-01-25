// ...existing code...
// --- Outbound send guard: digits-only, payload normalize, provider logging ---
try {
  const { initOutbound } = require('./services/outboundGuard');
  initOutbound(); // digits-only, payload normalize, provider logging
} catch (e) {
  console.warn('[OUTBOUND] init failed', e?.message || e);
}
/**
 * @title Main Server File (index.js)
 * @description The main entry point for the WhatsApp AI Sales Assistant application.
 * It initializes the Express server, sets up middleware, and connects the API routes.
 */

// Import necessary libraries
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path'); // For serving static files
const cron = require('node-cron');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const app = express();

// --- Domain-based Landing Page Middleware ---
app.use((req, res, next) => {
  const host = req.get('host') || '';
  // Serve UAE/GCC specific landing page
  if (host.includes('sak-ai.saksolution.ae')) {
      if (req.path === '/' || req.path === '/index.html') {
          return res.sendFile(path.join(__dirname, 'public', 'index-ae.html'));
      }
  }
  next();
});


// --- Serve Static Files for Web Dashboard ---
app.use(express.static(path.join(__dirname, 'public')));

// Explicitly serve ai-dashboard.html for dashboard routes
app.get('/ai-dashboard.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'ai-dashboard.html'));
});

// --- API Routes ---
const aiAdminRoutes = require('./routes/api/aiAdmin');
app.use('/api/ai-admin', aiAdminRoutes);
app.use('/api/admin/ai-stats', aiAdminRoutes); // For dashboard compatibility

// ADD: /api_new/customer route for direct customer message simulation/testing
const customerHandler = require('./routes/handlers/customerHandler');
console.log('[DEBUG] customerHandler exports:', Object.keys(customerHandler));
app.post('/api_new/customer', async (req, res) => {
  // Proxy to main customer handler
  try {
    await customerHandler.handleCustomerTextMessage(req, res);
  } catch (err) {
    console.error('[API_NEW_CUSTOMER] Error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --- New: prefer built-in JSON as a fallback (keeps body-parser too)
const useExpressJson = true;


// Import routers
const webhookRouter = require('./routes/webhook');
const dashboardRouter = require('./routes/api/dashboard');
let statusWebhookRouter, apiRouter;

// Import broadcast queue processor
const { processBroadcastQueue } = require('./services/broadcastService');

// Import scheduler for automated tasks
const { runScheduledTasks } = require('./scheduler');

// Import monitoring dependencies
const { dbClient } = require('./services/config');

try {
  statusWebhookRouter = require('./routes/statusWebhook');
} catch (err) {
  console.error('[BOOT] Failed to load ./routes/statusWebhook.js:', err && err.message ? err.message : err);
  statusWebhookRouter = express.Router().post('/update', (req, res) => res.status(200).json({ ok: true, note: 'fallback status webhook' }));
}
try {
  apiRouter = require('./routes/api');
} catch (err) {
  console.error('[BOOT] Failed to load ./routes/api.js:', err && err.message ? err.message : err);
  apiRouter = express.Router().post('/verify-magic-token', (req, res) => res.status(500).json({ error: 'API router failed to load' }));
}

const ordersRouter = require('./routes/api/orders');
const gstRoutes = require('./routes/api/gst');
const zohoRoutes = require('./routes/api/zoho');
const customerRouter = require('./routes/api/customer');
const websiteContentRouter = require('./routes/api/websiteContent');


// --- Configuration ---
// IMPORTANT: Use the PORT environment variable. Default 8057 for Hostinger.
const PORT = Number(process.env.PORT) || 8057;

// --- Server Initialization ---



// Ensure realtime testing service is loaded globally (for status route)
try {
  if (!global.realtimeTestingService) {
    const svc = require('./services/realtimeTestingService');
    // If your module exposes an init(), call it; otherwise this is a no-op.
    if (typeof svc.init === 'function') svc.init();
    global.realtimeTestingService = svc;
    console.log('[REALTIME] testing service loaded');
  }
} catch (e) {
  console.warn('[REALTIME] load failed:', e?.message || e);
}

// Middleware setup
app.use(express.json({ limit: '2mb' }));
if (useExpressJson) {
  app.use(bodyParser.json());
}
app.use(cookieParser());
app.use(cors()); // Allow all origins for development
// Or for production, be specific:
// app.use(cors({ origin: 'http://localhost:8080' }));

// ADDITIVE DEBUG WIRING
try {
  const dbg = require('./services/debug');
  dbg.envSummary(); // prints masked envs when DEBUG_CONFIG=1

  app.use((req, res, next) => {
    req._rid = req._rid || dbg.rid();
    if (process.env.DEBUG_WEBHOOK === '1') {
      console.log(`[REQ][${req._rid}] ${req.method} ${req.originalUrl}`);
      if (req.body) { try { console.log(`[REQ][${req._rid}] body`, JSON.stringify(req.body).slice(0, 2000)); } catch(_){} }
      res.on('finish', () => console.log(`[RES][${req._rid}] ${res.statusCode}`));
    }
    next();
  });
} catch (e) {
  console.error('[BOOT] debug wiring failed', e?.message || e);
}

// Lightweight request logger
app.use((req, _res, next) => {
  try {
    console.log(`[REQ] ${req.method} ${req.url}`);
  } catch (_) {}
  next();
});

// --- Serve Static Files for Web Dashboard ---
app.use(express.static(path.join(__dirname, 'public')));

// Explicitly serve dashboard.html for dashboard routes with no-cache headers
app.get('/dashboard', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/dashboard.html', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Enhanced dashboard
app.get('/dashboard-enhanced.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard-enhanced.html'));
});

// --- API Routes ---
// Serve landing page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Favicon
app.get('/favicon.ico', (req, res) => {
    res.status(204).end(); // No content
});

// App Engine health probe path
app.get('/_ah/health', (_req, res) => {
  res.status(200).send('ok');
});

// Public tracked-link redirect (click tracking)
// NOTE: No auth required; recipients will hit this from WhatsApp.
app.get('/t/:code', async (req, res) => {
  try {
    const code = String(req.params.code || '').trim();
    if (!code) return res.status(404).send('Not found');

    const { data: link, error } = await dbClient
      .from('tracked_links')
      .select('original_url, click_count')
      .eq('short_code', code)
      .limit(1)
      .single();

    if (error || !link || !link.original_url) return res.status(404).send('Not found');

    const originalUrl = String(link.original_url);
    if (!/^https?:\/\//i.test(originalUrl)) return res.status(400).send('Invalid link');

    // Best-effort increment
    try {
      const now = new Date().toISOString();
      const currentCount = Number(link.click_count || 0);
      await dbClient
        .from('tracked_links')
        .update({
          click_count: currentCount + 1,
          last_clicked_at: now
        })
        .eq('short_code', code);
    } catch (_) {}

    return res.redirect(302, originalUrl);
  } catch (e) {
    console.error('[TRACKED_LINK] redirect error:', e?.message || e);
    return res.status(500).send('Server error');
  }
});

// Desktop Agent Endpoints (MUST be before app.use('/api', apiRouter))
app.post('/api/desktop-agent/register', async (req, res) => {
  try {
    const { tenantId, phoneNumber, deviceName, status } = req.body;
    
    if (!tenantId || !phoneNumber) {
      return res.status(400).json({ error: 'Missing tenantId or phoneNumber' });
    }

    console.log(`[DESKTOP_AGENT] Agent connected: ${tenantId} | Phone: ${phoneNumber} | Device: ${deviceName}`);

    // Update tenant WhatsApp connection status
    const { data, error } = await dbClient
      .from('tenants')
      .update({
        whatsapp_phone: phoneNumber,
        status: status || 'connected'
      })
      .eq('id', tenantId);

    if (error) {
      console.error('[DESKTOP_AGENT] dbClient error:', error);
      // Don't fail if database update fails - agent can still work
      console.warn('[DESKTOP_AGENT] Continuing despite database error...');
    }

    res.json({ 
      ok: true, 
      message: 'Desktop agent registered successfully',
      tenantId,
      phoneNumber
    });

  } catch (error) {
    console.error('[DESKTOP_AGENT] Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/desktop-agent/process-message', async (req, res) => {
  try {
    const { tenantId, from, message, timestamp, messageId } = req.body;
    
    if (!tenantId || !from || !message) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    console.log(`[DESKTOP_AGENT] Message from ${from} (${tenantId}): ${message.substring(0, 50)}...`);

    // Fetch tenant
    const { data: tenant, error: tenantError } = await dbClient
      .from('tenants')
      .select('*')
      .eq('id', tenantId)
      .single();

    if (tenantError || !tenant) {
      console.error('[DESKTOP_AGENT] Tenant not found:', tenantId);
      return res.status(404).json({ 
        ok: false, 
        error: 'Tenant not found',
        reply: 'Sorry, your account configuration was not found. Please contact support.'
      });
    }

    // Set a global flag to capture messages instead of sending via Maytapi
    global.desktopAgentMode = true;
    global.capturedMessage = null;

    try {
      // Format the request to match the customerHandler.handleCustomer format
      const formattedReq = {
        message: {
          from: from,
          text: {
            body: message
          }
        },
        tenant: tenant
      };

      // Create a minimal response object
      const formattedRes = {
        status: (code) => ({ json: (data) => data }),
        json: (data) => data
      };

      // Process with timeout protection (45 seconds)
      const timeoutPromise = new Promise((resolve) => {
        setTimeout(() => {
          console.log('[DESKTOP_AGENT] Processing timeout - using fallback response');
          resolve(null);
        }, 45000);
      });

      // Race between processing and timeout
      await Promise.race([
        customerHandler.handleCustomer(formattedReq, formattedRes),
        timeoutPromise
      ]);

    } finally {
      // Disable desktop agent mode
      global.desktopAgentMode = false;
    }

    const capturedReply = global.capturedMessage;

    // Return AI response to desktop agent
    res.json({
      ok: true,
      reply: capturedReply || 'Thank you for your message. We are processing it.',
      messageId,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[DESKTOP_AGENT] Message processing error:', error);
    res.status(500).json({ 
      ok: false,
      error: 'Failed to process message',
      reply: 'Sorry, I encountered an error processing your message. Please try again.'
    });
  }
});

app.post('/api/desktop-agent/message-sent', async (req, res) => {
  try {
    const { tenantId, messageId, status } = req.body;
    console.log(`[DESKTOP_AGENT] Message sent confirmation: ${messageId} | Status: ${status}`);
    res.json({ ok: true });
  } catch (error) {
    console.error('[DESKTOP_AGENT] Message sent error:', error);
    res.status(500).json({ error: 'Failed to track message' });
  }
});

// Waha Installation Endpoint
app.post('/api/admin/install-waha', async (req, res) => {
  try {
    const { exec } = require('child_process');
    const fs = require('fs');
    
    console.log('[WAHA] Starting installation...');
    
    // Check if install script exists
    const scriptPath = path.join(__dirname, 'install-waha.sh');
    if (!fs.existsSync(scriptPath)) {
      return res.status(404).json({ error: 'Installation script not found' });
    }
    
    // Make script executable and run it
    exec(`chmod +x ${scriptPath} && sudo bash ${scriptPath}`, (error, stdout, stderr) => {
      if (error) {
        console.error('[WAHA] Installation error:', error);
        return res.status(500).json({ 
          error: 'Installation failed', 
          details: error.message,
          stderr: stderr 
        });
      }
      
      console.log('[WAHA] Installation output:', stdout);
      res.json({ 
        ok: true, 
        message: 'Waha installed successfully',
        output: stdout 
      });
    });
    
  } catch (error) {
    console.error('[WAHA] Installation endpoint error:', error);
    res.status(500).json({ error: 'Failed to start installation' });
  }
});

// Restart Waha with API key
app.post('/api/admin/restart-waha', async (req, res) => {
  try {
    const { exec } = require('child_process');
    
    console.log('[WAHA] Restarting Waha with authentication...');
    
    const command = `
      sudo docker stop waha 2>/dev/null || true
      sudo docker rm waha 2>/dev/null || true
      sudo docker run -d \
        --name waha \
        --restart unless-stopped \
        -p 3000:3000 \
        -v ~/waha-data:/app/.sessions \
        -e WHATSAPP_HOOK_URL=http://localhost:8080/api/waha/webhook \
        -e WHATSAPP_API_KEY=your-secret-key \
        -e WHATSAPP_API_KEY_IN=header \
        devlikeapro/waha:latest
    `;
    
    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error('[WAHA] Restart error:', error);
        return res.status(500).json({ 
          error: 'Restart failed', 
          details: error.message 
        });
      }
      
      console.log('[WAHA] Restart output:', stdout);
      res.json({ 
        ok: true, 
        message: 'Waha restarted successfully',
        output: stdout 
      });
    });
    
  } catch (error) {
    console.error('[WAHA] Restart endpoint error:', error);
    res.status(500).json({ error: 'Failed to restart Waha' });
  }
});

// Clear Tenant Data (preserve products)
app.post('/api/admin/clear-tenant-data', async (req, res) => {
  try {
    const { dbClient } = require('./config/database');
    
    console.log('[ADMIN] Starting tenant data cleanup (preserving products)...');
    
    // Delete tenant-related data in order (respecting foreign keys)
    const tables = [
      'conversations',
      'order_items',
      'orders',
      'cart_items',
      'carts',
      'proactive_messaging_analytics',
      'response_analytics',
      'shipping_config',
      'clients',
      'tenants'
    ];
    
    const results = {};
    
    for (const table of tables) {
      const { data: countBefore, error: countError } = await dbClient
        .from(table)
        .select('*', { count: 'exact', head: true });
      
      const beforeCount = countError ? 0 : (countBefore?.length || 0);
      
      const { error: deleteError, count } = await dbClient
        .from(table)
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all
      
      if (deleteError) {
        console.error(`[ADMIN] Error clearing ${table}:`, deleteError);
        results[table] = { error: deleteError.message };
      } else {
        console.log(`[ADMIN] Cleared ${table} (${beforeCount} rows)`);
        results[table] = { deleted: beforeCount };
      }
    }
    
    // Check products are preserved
    const { count: productCount, error: prodError } = await dbClient
      .from('products')
      .select('*', { count: 'exact', head: true });
    
    console.log('[ADMIN] Cleanup complete. Products preserved:', productCount);
    
    res.json({
      ok: true,
      message: 'Tenant data cleared successfully',
      results: results,
      productsPreserved: productCount || 0
    });
    
  } catch (error) {
    console.error('[ADMIN] Clear tenant data error:', error);
    res.status(500).json({ error: 'Failed to clear tenant data', details: error.message });
  }
});

// Waha WhatsApp Bot Endpoints (24/7 Bot Support)
const axios = require('axios');
const WAHA_URL = process.env.WAHA_URL || 'http://localhost:3000';
const WAHA_API_KEY = process.env.WAHA_API_KEY || 'your-secret-key';
const { toWhatsAppFormat, normalizePhone } = require('./services/phoneUtils');

// Helper function to make Waha API calls with auth
async function wahaRequest(method, url, data = null, responseType = 'json') {
  const config = {
    method,
    url: `${WAHA_URL}${url}`,
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': WAHA_API_KEY  // Waha expects uppercase X-API-KEY
    },
    responseType: responseType  // Support different response types
  };
  
  if (data) {
    config.data = data;
  }
  
  return axios(config);
}

// Start a new WhatsApp session for a tenant
app.post('/api/waha/session/start', async (req, res) => {
  try {
    const { tenantId, sessionName } = req.body;
    
    if (!tenantId) {
      return res.status(400).json({ error: 'Missing tenantId' });
    }

    // Free version only supports 'default' session
    const session = 'default';
    
    console.log(`[WAHA] Starting session: ${session} for tenant: ${tenantId}`);
    
    // Check if session already exists
    try {
      const statusResponse = await wahaRequest('GET', `/api/sessions/${session}`);
      const status = statusResponse.data.status;
      
      console.log(`[WAHA] Session already exists with status: ${status}`);
      
      // If session exists and is working or scanning, return success
      if (status === 'WORKING' || status === 'SCAN_QR_CODE' || status === 'STARTING') {
        return res.json({
          ok: true,
          session: session,
          message: 'Session already running',
          status: status,
          data: statusResponse.data
        });
      }
      
      // If session exists but failed/stopped, restart it
      if (status === 'FAILED' || status === 'STOPPED') {
        console.log(`[WAHA] Restarting ${status} session`);
        await wahaRequest('POST', `/api/sessions/${session}/restart`);
        
        return res.json({
          ok: true,
          session: session,
          message: 'Session restarted',
          status: 'STARTING'
        });
      }
      
    } catch (statusError) {
      // Session doesn't exist, create it
      if (statusError.response?.status === 404) {
        console.log(`[WAHA] Session not found, creating new one`);
        
        const response = await wahaRequest('POST', '/api/sessions/start', {
          name: session,
          config: {
            proxy: null,
            noweb: {
              store: {
                enabled: true,
                fullSync: false
              }
            }
          }
        });

        return res.json({
          ok: true,
          session: session,
          message: 'Session created',
          data: response.data
        });
      }
      
      // Other status check errors
      throw statusError;
    }

  } catch (error) {
    console.error('[WAHA] Session start error:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Failed to start session',
      details: error.response?.data || error.message
    });
  }
});

// Get QR code for scanning
app.get('/api/waha/session/:sessionName/qr', async (req, res) => {
  try {
    const { sessionName } = req.params;
    
    console.log(`[WAHA] Getting QR code for: ${sessionName}`);
    
    // Waha API endpoint for QR code (returns PNG image)
    const response = await wahaRequest('GET', `/api/${sessionName}/auth/qr`, null, 'arraybuffer');

    // Convert PNG binary to base64
    const base64Image = Buffer.from(response.data, 'binary').toString('base64');

    res.json({
      ok: true,
      qr: base64Image
    });

  } catch (error) {
    console.error('[WAHA] QR code error:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Failed to get QR code',
      details: error.response?.data || error.message
    });
  }
});

// Check session status
app.get('/api/waha/session/:sessionName/status', async (req, res) => {
  try {
    const { sessionName } = req.params;
    
    // Correct Waha endpoint: /api/sessions/{session}
    const response = await wahaRequest('GET', `/api/sessions/${sessionName}`);

    res.json({
      ok: true,
      status: response.data
    });

  } catch (error) {
    console.error('[WAHA] Status check error:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Failed to get status',
      details: error.response?.data || error.message
    });
  }
});

// Send message via Waha
app.post('/api/waha/send-message', async (req, res) => {
  try {
    const { sessionName, phone, message } = req.body;
    
    if (!sessionName || !phone || !message) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const { toWhatsAppFormat, normalizePhone } = require('./services/phoneUtils');
    const normalizedPhone = normalizePhone(phone);
    const chatId = toWhatsAppFormat(phone);
    if (!chatId) {
      return res.status(400).json({ error: 'Invalid phone number' });
    }

    // Global opt-out enforcement
    try {
      const { isUnsubscribed, toDigits } = require('./services/unsubscribeService');
      const { isBypassNumber } = require('./services/outboundPolicy');
      const digits = toDigits(phone);
      if (digits) {
        const bypass = await isBypassNumber(digits);
        if (!bypass && (await isUnsubscribed(digits))) {
          return res.status(400).json({ ok: false, skipped: true, reason: 'unsubscribed' });
        }
      }
    } catch (e) {
      // Fail-open if policy lookup fails
    }

    console.log(`[WAHA] Sending message via ${sessionName} to ${phone}`);
    
    try {
      const response = await wahaRequest('POST', '/api/sendText', {
        session: sessionName,
        chatId,
        text: message
      });

      return res.json({
        ok: true,
        messageId: response.data.id
      });
    } catch (error) {
      const errorDetails = error.response?.data || error.message;
      console.error('[WAHA] Send message error:', errorDetails);

      const status = error?.response?.status;
      const shouldFallback = !error?.response || [404, 502, 503].includes(status);
      if (shouldFallback) {
        try {
          const { sendWebMessage, getClientStatus } = require('./services/whatsappWebService');
          const { dbClient } = require('./services/config');

          let tenantId = null;
          if (typeof sessionName === 'string' && sessionName.startsWith('tenant_')) {
            tenantId = sessionName.replace('tenant_', '');
          } else {
            const { data: conn } = await dbClient
              .from('whatsapp_connections')
              .select('tenant_id')
              .eq('session_name', String(sessionName))
              .single();
            if (conn?.tenant_id) tenantId = conn.tenant_id;
          }

          if (!tenantId) {
            throw new Error('Fallback failed: tenantId unresolved');
          }

          const statusInfo = getClientStatus(String(tenantId), sessionName);
          if (statusInfo.status !== 'ready') {
            throw new Error(`Fallback failed: WhatsApp Web status=${statusInfo.status}`);
          }

          const result = await sendWebMessage(String(tenantId), normalizedPhone || phone, message, sessionName);
          return res.json({
            ok: true,
            messageId: result?.messageId || result?.message_id || ('waweb_' + Date.now()),
            method: 'whatsapp_web_fallback'
          });
        } catch (fallbackError) {
          console.error('[WAHA] Fallback send error:', fallbackError?.message || fallbackError);
        }
      }

      return res.status(500).json({
        error: 'Failed to send message',
        details: errorDetails
      });
    }

  } catch (error) {
    console.error('[WAHA] Send message error:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Failed to send message',
      details: error.response?.data || error.message
    });
  }
});

// Message deduplication cache (prevent processing same message multiple times)
const processedMessageIds = new Set();
const MESSAGE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
setInterval(() => {
  if (processedMessageIds.size > 1000) processedMessageIds.clear();
}, MESSAGE_CACHE_TTL);

// Webhook endpoint to receive messages from Waha
app.post('/api/waha/webhook', async (req, res) => {
  try {
    const body = req.body;
    const event = body.event;
    const session = body.session;
    
    // WAHA sends payload nested in different ways depending on version
    // Log full body for debugging
    console.log(`[WAHA] Webhook received: ${event}`, JSON.stringify(body).substring(0, 500));

    // CRITICAL: Skip ALL outgoing messages to prevent infinite loops
    // Check multiple fields that indicate outgoing message
    const isFromMe = body.payload?.fromMe || body.payload?._data?.id?.fromMe || body.me?.id === body.payload?.from;
    
    if (isFromMe) {
      console.log('[WAHA] Skipping outgoing message (fromMe=true)');
      return res.json({ ok: true, skipped: true, reason: 'fromMe' });
    }

    // Handle incoming message
    if (event === 'message') {
      // WAHA payload structure: payload.from, payload.body OR payload._data.body
      const payload = body.payload || {};
      
      // CRITICAL: Message deduplication to prevent infinite loops
      const messageId = payload.id || payload._data?.id?.id || `${payload.from}_${payload.timestamp}`;
      if (processedMessageIds.has(messageId)) {
        console.log('[WAHA] Skipping duplicate message:', messageId);
        return res.json({ ok: true, skipped: true, reason: 'duplicate' });
      }
      processedMessageIds.add(messageId);
      
      const from = String(payload.from || payload.chatId || '').replace('@c.us', '');
      const message = String(payload.body || payload._data?.body || payload.text || '');
      
      // Skip if no message body or from self
      if (!from || !message) {
        console.log('[WAHA] Skipping: no from or message');
        return res.json({ ok: true, skipped: true, reason: 'no_content' });
      }
      
      console.log(`[WAHA] Processing incoming message from ${from}: ${message.substring(0, 50)}...`);

      // Global opt-out enforcement for replies
      try {
        const { isUnsubscribed, toDigits } = require('./services/unsubscribeService');
        const { isBypassNumber } = require('./services/outboundPolicy');
        const digits = toDigits(from);
        if (digits) {
          const bypass = await isBypassNumber(digits);
          if (!bypass && (await isUnsubscribed(digits))) {
            console.warn('[WAHA] Skipped reply (unsubscribed):', digits);
            return res.json({ ok: true, skipped: true, reason: 'unsubscribed' });
          }
        }
      } catch (e) {
        // Fail-open if policy lookup fails
      }

      // Resolve tenantId
      let tenantId = null;
      if (typeof session === 'string' && session.startsWith('tenant_')) {
        tenantId = session.replace('tenant_', '');
      } else {
        // Fallback: map session_name -> tenant_id (common in local/dev)
        try {
          const { dbClient } = require('./services/config');
          const { data: conn } = await dbClient
            .from('whatsapp_connections')
            .select('tenant_id')
            .eq('session_name', String(session))
            .single();
          if (conn?.tenant_id) tenantId = conn.tenant_id;
        } catch (e) {
          console.warn('[WAHA] Could not resolve tenant from session_name:', e?.message || e);
        }
      }

      console.log(`[WAHA] Processing message from ${from} for tenant ${tenantId || 'UNKNOWN'}: ${message.substring(0, 50)}...`);
      if (!tenantId) {
        console.warn('[WAHA] Skipping message: tenantId unresolved for session', session);
        return res.json({ ok: true, skipped: true, reason: 'tenant_unresolved' });
      }

      // Format request to match existing customer handler
      const formattedReq = {
        body: {
          customer_phone: from,
          customer_message: message,
          tenant_id: tenantId
        }
      };

      const formattedRes = {
        status: () => ({ json: () => null }),
        json: () => null
      };

      // Capture outbound messages (main handler normally uses Maytapi). We want to reply via WAHA.
      const prevDesktop = !!global.desktopAgentMode;
      const prevCaptured = global.capturedMessage;
      const prevCapturedMessages = global.capturedMessages;
      global.desktopAgentMode = true;
      global.capturedMessage = null;
      global.capturedMessages = [];

      try {
        await customerHandler.handleCustomerTextMessage(formattedReq, formattedRes);
      } finally {
        const outgoing = Array.isArray(global.capturedMessages) && global.capturedMessages.length
          ? global.capturedMessages
          : (global.capturedMessage ? [global.capturedMessage] : []);

        global.desktopAgentMode = prevDesktop;
        global.capturedMessage = prevCaptured;
        global.capturedMessages = prevCapturedMessages;

        for (const text of outgoing) {
          if (typeof text !== 'string' || !text.trim()) continue;
          await wahaRequest('POST', '/api/sendText', {
            session: session,
            chatId: payload.from,
            text
          });
        }
        if (outgoing.length) {
          console.log(`[WAHA] Sent ${outgoing.length} captured reply message(s) to ${from}`);
        }
      }
    }

    res.json({ ok: true });

  } catch (error) {
    console.error('[WAHA] Webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Stop a session
app.post('/api/waha/session/:sessionName/stop', async (req, res) => {
  try {
    const { sessionName } = req.params;
    
    console.log(`[WAHA] Stopping session: ${sessionName}`);
    
    const response = await wahaRequest('POST', '/api/sessions/stop', {
      name: sessionName
    });

    res.json({
      ok: true,
      data: response.data
    });

  } catch (error) {
    console.error('[WAHA] Stop session error:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Failed to stop session',
      details: error.response?.data || error.message
    });
  }
});

// Restart session (stop and start to get fresh QR)
app.post('/api/waha/session/:sessionName/restart', async (req, res) => {
  try {
    const { sessionName } = req.params;
    
    console.log(`[WAHA] Restarting session: ${sessionName}`);
    
    // Stop the session first
    try {
      await wahaRequest('POST', '/api/sessions/stop', { name: sessionName });
      console.log(`[WAHA] Session stopped, waiting 2 seconds...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (stopError) {
      console.log(`[WAHA] Stop error (might already be stopped): ${stopError.message}`);
    }
    
    // Start the session again
    const response = await wahaRequest('POST', '/api/sessions/start', {
      name: sessionName,
      config: {
        proxy: null,
        noweb: {
          store: {
            enabled: true,
            fullSync: false
          }
        }
      }
    });

    res.json({
      ok: true,
      message: 'Session restarted successfully',
      data: response.data
    });

  } catch (error) {
    console.error('[WAHA] Restart session error:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Failed to restart session',
      details: error.response?.data || error.message
    });
  }
});

// Export for use in broadcast.js (kept for backward compatibility)
try {
  const { sendBroadcastViaWaha } = require('./services/wahaService');
  module.exports.sendBroadcastViaWaha = sendBroadcastViaWaha;
} catch (_) {
  // Fail-closed: server can run without WAHA helper
}

// Agent Login API (MUST be before app.use('/api', apiRouter))
app.post('/api/agent-login', async (req, res) => {
  try {
    let { phone, password } = req.body;
    
    if (!phone || !password) {
      return res.status(400).json({ error: 'Missing phone or password' });
    }

    // Sanitize phone: remove +, spaces, dashes
    phone = phone.replace(/[^0-9]/g, '');

    // Query tenant by owner_whatsapp_number (unified field for all systems)
    const { data: tenant, error } = await dbClient
      .from('tenants')
      .select('*')
      .eq('owner_whatsapp_number', phone)
      .single();

    if (error || !tenant) {
      console.log('[AGENT_LOGIN] Tenant not found:', phone);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Verify password (simple comparison - use bcrypt in production)
    if (tenant.password !== password) {
      console.log('[AGENT_LOGIN] Invalid password for:', phone);
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    console.log(`[AGENT_LOGIN] Login successful: ${phone} | Tenant: ${tenant.id}`);
    
    res.json({
      ok: true,
      tenantId: tenant.id,
      phone: phone,
      businessName: tenant.business_name
    });

  } catch (error) {
    console.error('[AGENT_LOGIN] Error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Agent Register API (MUST be before app.use('/api', apiRouter))
app.post('/api/agent-register', async (req, res) => {
  try {
    let { phone, email, businessName, password } = req.body;
    
    if (!phone || !businessName || !password) {
      return res.status(400).json({ error: 'Missing required fields (phone, businessName, password)' });
    }

    // Sanitize phone: remove +, spaces, dashes
    phone = phone.replace(/[^0-9]/g, '');
    
    if (phone.length < 10) {
      return res.status(400).json({ error: 'Invalid phone number format' });
    }

    // Check if phone already exists
    const { data: existingTenant } = await dbClient
      .from('tenants')
      .select('id')
      .eq('owner_whatsapp_number', phone)
      .single();

    if (existingTenant) {
      return res.status(400).json({ error: 'Phone number already registered' });
    }

    // Prepare insert data (let dbClient generate UUID, email is optional)
    const insertData = {
      owner_whatsapp_number: phone,  // Unified phone field for all systems
      business_name: businessName,
      password: password,  // Store password (use bcrypt in production)
      subscription_status: 'trial',
      subscription_tier: 'free',
      status: 'active',
      is_active: true,
      bot_phone_number: phone,  // Default to owner's number
      admin_phones: [phone]    // Owner is admin
    };
    
    // Note: Email column doesn't exist in tenants table - storing phone only

    // Create tenant with password
    const { data, error } = await dbClient
      .from('tenants')
      .insert(insertData)
      .select()
      .single();

    if (error) {
      console.error('[AGENT_REGISTER] dbClient error:', error);
      return res.status(500).json({ error: 'Registration failed: ' + error.message });
    }

    const tenantId = data.id; // Get the auto-generated UUID
    console.log(`[AGENT_REGISTER] New tenant: ${tenantId} | ${phone} | ${businessName}`);
    
    res.json({
      ok: true,
      tenantId: tenantId,
      phone: phone,
      businessName: businessName
    });

  } catch (error) {
    console.error('[AGENT_REGISTER] Error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Get tenant ID by phone number (for desktop agent)
app.post('/api/agent-get-tenant', async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    
    if (!phoneNumber) {
      return res.status(400).json({ error: 'Phone number required' });
    }

    // Sanitize phone number
    const cleanPhone = phoneNumber.replace(/[^0-9]/g, '');
    
    console.log(`[AGENT_GET_TENANT] Looking up phone: ${cleanPhone}`);

    // Query tenant by owner_whatsapp_number
    const { data: tenant, error } = await dbClient
      .from('tenants')
      .select('id, business_name, owner_whatsapp_number')
      .eq('owner_whatsapp_number', cleanPhone)
      .single();

    if (error || !tenant) {
      console.error('[AGENT_GET_TENANT] Not found:', error);
      return res.status(404).json({ error: 'Phone number not registered' });
    }

    console.log(`[AGENT_GET_TENANT] Found tenant: ${tenant.id}`);

    res.json({
      ok: true,
      tenantId: tenant.id,
      businessName: tenant.business_name,
      phone: tenant.owner_whatsapp_number
    });

  } catch (error) {
    console.error('[AGENT_GET_TENANT] Error:', error);
    res.status(500).json({ error: 'Failed to fetch tenant' });
  }
});

// Check if desktop agent is online for a tenant
app.get('/api/desktop-agent/status/:tenantId', async (req, res) => {
  try {
    const { tenantId } = req.params;
    
    console.log(`[DESKTOP_AGENT_STATUS] Checking agent for tenant: ${tenantId}`);

    // Get tenant's desktop agent URL (default to localhost:3001)
    const { data: tenant } = await dbClient
      .from('tenants')
      .select('desktop_agent_url')
      .eq('id', tenantId)
      .single();

    const agentUrl = tenant?.desktop_agent_url || 'http://localhost:3001';

    // Try to reach the desktop agent
    const axios = require('axios');
    try {
      const response = await axios.get(`${agentUrl}/health`, {
        timeout: 3000
      });

      if (response.data && response.data.status === 'running') {
        console.log(`[DESKTOP_AGENT_STATUS] ✅ Agent online for tenant ${tenantId}`);
        return res.json({
          online: true,
          status: 'running',
          tenantId: response.data.tenantId,
          agentUrl: agentUrl
        });
      }
    } catch (agentError) {
      console.log(`[DESKTOP_AGENT_STATUS] ⚠️  Agent offline for tenant ${tenantId}`);
    }

    // Agent not reachable
    res.json({
      online: false,
      status: 'offline',
      agentUrl: agentUrl
    });

  } catch (error) {
    console.error('[DESKTOP_AGENT_STATUS] Error:', error);
    res.status(500).json({ error: 'Failed to check agent status' });
  }
});

// Use the routers for their respective paths
app.use('/webhook', webhookRouter);
app.use('/status', statusWebhookRouter);
app.use('/api', apiRouter);
app.use('/api/dashboard', dashboardRouter);

// Leads API (mounted directly for robustness)
try {
  const leadsRouter = require('./routes/api/leads');
  app.use('/api/leads', leadsRouter);
} catch (e) {
  console.warn('[BOOT] Leads API failed to load:', e?.message || e);
}

app.use('/api/orders', ordersRouter);
app.use('/api', gstRoutes);
app.use('/api/zoho', zohoRoutes);
app.use('/api/customers', customerRouter);
app.use('/api/dashboard', websiteContentRouter);

// Authentication API
const authRouter = require('./routes/api/auth');
app.use('/api/auth', authRouter);

// Tenant Management API
const tenantsRouter = require('./routes/api/tenants');
app.use('/api/tenants', tenantsRouter);

// Tenant Features API (for controlling enabled features per tenant)
const tenantFeaturesRouter = require('./routes/api/tenantFeatures');
app.use('/api/tenants', tenantFeaturesRouter);

// Discount Management API
const discountsRouter = require('./routes/api/discounts');
app.use('/api/discounts', discountsRouter);

// Category Management API
const categoriesRouter = require('./routes/api/categories');
app.use('/api/categories', categoriesRouter);

// Products Management API
const productsRouter = require('./routes/api/products');
app.use('/api/products', productsRouter);

// Broadcast API
const broadcastRouter = require('./routes/api/broadcast');
app.use('/api/broadcast', broadcastRouter);

// Admin Management API (Products, Orders, Customers CRUD)
const adminRouter = require('./routes/api/admin');
app.use('/api/admin', adminRouter);

// Pricing Engine API (Enterprise pricing, tiers, discounts, promotions)
const pricingRouter = require('./routes/api/pricing');
app.use('/api/pricing', pricingRouter);

// RBAC API (Role-Based Access Control)
const rbacRouter = require('./routes/api/rbac');
app.use('/api/rbac', rbacRouter);

// Pipeline Management API (Sales pipeline, deals, forecasting)
const pipelineRouter = require('./routes/api/pipeline');
app.use('/api/pipeline', pipelineRouter);

// AI Intelligence API (Predictive scoring, churn detection, recommendations)
const aiIntelligenceRouter = require('./routes/api/ai-intelligence');
app.use('/api/ai-intelligence', aiIntelligenceRouter);

// Analytics & Reporting API (Dashboards, KPIs, reports, insights)
const analyticsRouter = require('./routes/api/analytics');
app.use('/api/analytics', analyticsRouter);

// ERP Integrations API (Zoho, Tally, QuickBooks, SAP)
const erpRouter = require('./routes/api/erp');
app.use('/api/erp', erpRouter);

// Document Generation API (Invoices, Quotations, Purchase Orders, Reports)
const documentsRouter = require('./routes/api/documents');
app.use('/api/documents', documentsRouter);

// WhatsApp AI Enhancements API (Smart Replies, Broadcast, Conversation AI)
const whatsappAIRouter = require('./routes/api/whatsapp-ai');
app.use('/api/whatsapp-ai', whatsappAIRouter);

// Mobile App Features API (Offline Sync, Push Notifications, Device Management)
const mobileAppRouter = require('./routes/api/mobile-app');
app.use('/api/mobile-app', mobileAppRouter);

// Performance & Scale API (Caching, Query Optimization, Rate Limiting, Health Checks)
const performanceRouter = require('./routes/api/performance');
app.use('/api/performance', performanceRouter);

// WebSocket API (Real-time Communication, Statistics, Connection Management)
const websocketRouter = require('./routes/api/websocket');
app.use('/api/websocket', websocketRouter);

// Onboarding API (User guidance, sample data)
const onboardingRouter = require('./routes/api/onboarding');
app.use('/api/onboarding', onboardingRouter);

// Advanced Features (Phase 3): ML, Voice AI, Video Calls, Blockchain, Translation
const advancedFeaturesRouter = require('./routes/api/advanced-features');
app.use('/api/advanced', advancedFeaturesRouter);

// FSM (Field Sales Management) API
const fsmRouter = require('./routes/api/fsm');
app.use('/api/fsm', fsmRouter);

// FSM Salesman API (Mobile/Desktop App Support)
const fsmSalesmanRouter = require('./routes/api/fsm-salesman');
app.use('/api/fsm', fsmSalesmanRouter);

// CRM API (feature-flagged by tier + tenant overrides)
const crmRouter = require('./routes/api/crm');
app.use('/api/crm', crmRouter);

// External Integrations (IndiaMart, GEM, etc.)
const indiamartRouter = require('./routes/api/integrations/indiamart');
app.use('/api/integrations/indiamart', indiamartRouter);

// WhatsApp Web Standalone API (separate from existing Maytapi system)
const whatsappWebRouter = require('./routes/api/whatsappWeb');
app.use('/api/whatsapp-web', whatsappWebRouter);

// Salesman WhatsApp Connection API
const salesmanWhatsappRouter = require('./routes/api/salesmanWhatsapp');
app.use('/api/salesman-whatsapp', salesmanWhatsappRouter);

// Salesmate Intelligence Features
const salesmenRouter = require('./routes/api/salesmen');
app.use('/api/salesmen', salesmenRouter);

const tasksRouter = require('./routes/api/tasks');
app.use('/api/tasks', tasksRouter);

const callsRouter = require('./routes/api/calls');
app.use('/api/calls', callsRouter);

const assignmentRouter = require('./routes/api/assignment');
app.use('/api/assignment', assignmentRouter);

// User Management API (Multi-User Authentication System)
const usersRouter = require('./routes/api/users');
app.use('/api/users', usersRouter);

// FSM Integration - Phase 1: Field Service Management Routes
const visitsRouter = require('./routes/api/visits');
const targetsRouter = require('./routes/api/targets');
const unifiedUsersRouter = require('./routes/api/unified-users');
app.use('/api/visits', visitsRouter);
app.use('/api/targets', targetsRouter);
app.use('/api/users/salesmen', unifiedUsersRouter);

// Cron endpoint for processing broadcast queue
app.get('/cron/process-broadcasts', async (req, res) => {
  try {
    await processBroadcastQueue();
    res.status(200).send('Queue processed');
  } catch (error) {
    console.error('Cron error:', error);
    res.status(500).send('Error processing queue');
  }
});

// Health check endpoint with comprehensive system status
app.get('/health', async (req, res) => {
  const startTime = Date.now();
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    memory: process.memoryUsage(),
    environment: process.env.NODE_ENV || 'development',
    version: process.env.npm_package_version || '1.0.0',
    services: {},
    metrics: {}
  };

  try {
    // Database health check
    const dbStart = Date.now();
    const { data, error } = await dbClient
      .from('tenants')
      .select('id', { count: 'exact', head: true })
      .limit(1);
    
    health.services.database = {
      status: error ? 'unhealthy' : 'healthy',
      responseTime: Date.now() - dbStart,
      error: error?.message || null
    };

    // AI Service health check
    const aiStart = Date.now();
    try {
      const OpenAI = require('openai');
      const client = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        project: process.env.OPENAI_PROJECT || undefined,
      });
      
      // Quick model list check (doesn't count against quota)
      await client.models.list();
      
      health.services.ai = {
        status: 'healthy',
        responseTime: Date.now() - aiStart,
        model: process.env.AI_MODEL_FAST || 'gpt-4o-mini'
      };
    } catch (aiError) {
      health.services.ai = {
        status: 'unhealthy',
        responseTime: Date.now() - aiStart,
        error: aiError.message
      };
    }

    // WhatsApp service health check
    health.services.whatsapp = {
      status: process.env.MAYTAPI_API_KEY ? 'configured' : 'not_configured',
      provider: 'maytapi'
    };

    // Broadcast queue metrics
    try {
      const { data: queueStats } = await dbClient
        .from('bulk_schedules')
        .select('status')
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

      const statusCounts = {};
      queueStats?.forEach(item => {
        statusCounts[item.status] = (statusCounts[item.status] || 0) + 1;
      });

      health.metrics.broadcastQueue = statusCounts;
    } catch (error) {
      health.metrics.broadcastQueue = { error: error.message };
    }

    // Overall health determination
    const unhealthyServices = Object.values(health.services)
      .filter(service => service.status === 'unhealthy');
    
    if (unhealthyServices.length > 0) {
      health.status = 'degraded';
    }

    health.responseTime = Date.now() - startTime;
    
    const statusCode = health.status === 'healthy' ? 200 : 503;
    res.status(statusCode).json(health);
    
  } catch (error) {
    health.status = 'unhealthy';
    health.error = error.message;
    health.responseTime = Date.now() - startTime;
    
    console.error('[HEALTH_CHECK] Critical error:', error);
    res.status(503).json(health);
  }
});

// Detailed metrics endpoint for monitoring systems
app.get('/metrics', async (req, res) => {
  try {
    const adminToken = process.env.ADMIN_TOKEN || '';
    if (adminToken && req.get('x-admin-token') !== adminToken) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const metrics = {
      timestamp: new Date().toISOString(),
      system: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        cpuUsage: process.cpuUsage(),
        nodeVersion: process.version,
        platform: process.platform
      },
      application: {
        environment: process.env.NODE_ENV,
        broadcastBatchSize: process.env.BROADCAST_BATCH_SIZE || 5,
        rateLimit: process.env.BROADCAST_RATE_LIMIT_MS || 12000
      }
    };

    // Database metrics
    try {
      const [tenants, conversations, broadcasts, products] = await Promise.all([
        dbClient.from('tenants').select('count(*)'),
        dbClient.from('conversations_new').select('count(*)').gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
        dbClient.from('bulk_schedules').select('status, count(*)').gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
        dbClient.from('products').select('count(*)')
      ]);

      metrics.database = {
        totalTenants: tenants.data?.[0]?.count || 0,
        conversationsLast24h: conversations.data?.[0]?.count || 0,
        broadcastsLast24h: broadcasts.data?.reduce((acc, item) => acc + (item.count || 0), 0) || 0,
        totalProducts: products.data?.[0]?.count || 0
      };
    } catch (error) {
      metrics.database = { error: error.message };
    }

    res.json(metrics);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Broadcast queue status endpoint
app.get('/api/broadcast/status', async (req, res) => {
  try {
    const adminToken = process.env.ADMIN_TOKEN || '';
    if (adminToken && req.get('x-admin-token') !== adminToken) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const { data: queueData, error } = await dbClient
      .from('bulk_schedules')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) throw error;

    const stats = {
      total: queueData.length,
      pending: queueData.filter(item => item.status === 'pending').length,
      processing: queueData.filter(item => item.status === 'processing').length,
      sent: queueData.filter(item => item.status === 'sent').length,
      failed: queueData.filter(item => item.status === 'failed').length,
      skipped: queueData.filter(item => item.status === 'skipped').length
    };

    const recentCampaigns = queueData
      .reduce((acc, item) => {
        if (!acc[item.campaign_name]) {
          acc[item.campaign_name] = {
            name: item.campaign_name,
            created: item.created_at,
            total: 0,
            sent: 0,
            pending: 0,
            failed: 0
          };
        }
        acc[item.campaign_name].total++;
        acc[item.campaign_name][item.status]++;
        return acc;
      }, {});

    res.json({
      stats,
      recentCampaigns: Object.values(recentCampaigns).slice(0, 10),
      recentMessages: queueData.slice(0, 20).map(item => ({
        id: item.id,
        campaign: item.campaign_name,
        phone: item.to_phone_number?.slice(-4) || 'xxxx', // Only show last 4 digits
        status: item.status,
        created: item.created_at,
        scheduled: item.scheduled_at,
        retries: item.retry_count || 0
      }))
    });

  } catch (error) {
    console.error('[BROADCAST_STATUS] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// --- Additive: provider sanity endpoint (secured via ADMIN_TOKEN) ---
app.get('/api/debug/providers', async (req, res) => {
  try {
    const adminToken = process.env.ADMIN_TOKEN || '';
    if (adminToken && req.get('x-admin-token') !== adminToken) {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }
    const out = { ok: true };

    // OpenAI check (models list)
    try {
      const fetch = (await import('node-fetch')).default;
      const r = await fetch('https://api.openai.com/v1/models', {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY || ''}`,
          'OpenAI-Project': process.env.OPENAI_PROJECT || ''
        }
      });
      out.openai = { status: r.status, ok: r.ok };
      out.body = (await r.text()).slice(0, 400); // truncate
    } catch (e) {
      out.openai = { ok: false, error: String(e) };
    }

    res.json(out);
  } catch (e) {
    res.status(200).json({ ok: false, error: 'internal', hint: String(e) });
  }
});

// --- ADD: Maytapi provider sanity ---
app.get('/api/debug/maytapi', async (req, res) => {
  try {
    const adminToken = process.env.ADMIN_TOKEN || '';
    if (adminToken && req.get('x-admin-token') !== adminToken) {
      return res.status(403).json({ ok:false, error:'forbidden' });
    }

    const fetch = (await import('node-fetch')).default;
    const PROD = process.env.MAYTAPI_PRODUCT_ID || '';
    const PHONE = process.env.MAYTAPI_PHONE_ID || '';
    const KEY   = process.env.MAYTAPI_API_KEY || '';

    const base = `https://api.maytapi.com/api/${PROD}/${PHONE}`;

    // Global opt-out enforcement for the sanity ping number
    try {
      const { isUnsubscribed, toDigits } = require('./services/unsubscribeService');
      const { isBypassNumber } = require('./services/outboundPolicy');
      const digits = toDigits('918484830021');
      if (digits) {
        const bypass = await isBypassNumber(digits);
        if (!bypass && (await isUnsubscribed(digits))) {
          return res.json({ ok: false, skipped: true, reason: 'unsubscribed', number: digits });
        }
      }
    } catch (e) {
      // Fail-open if policy lookup fails
    }

    // 1) Header style (per docs)
    const r1 = await fetch(`${base}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'x-maytapi-key': KEY },
      body: JSON.stringify({ to_number: '918484830021', type:'status', message:'ping' })
    });
    const t1 = await r1.text();

    // 2) Query-param style (some endpoints accept ?token=)
    const r2 = await fetch(`${base}/checkNumberStatus?token=${encodeURIComponent(KEY)}&number=918484830021@c.us`);
    const t2 = await r2.text();

    res.json({
      ok: true,
      env: {
        product_id_set: !!PROD,
        phone_id_set: !!PHONE,
        api_key_set: !!KEY
      },
      header_call: { status: r1.status, ok: r1.ok, body: t1.slice(0,400) },
      token_call:  { status: r2.status, ok: r2.ok, body: t2.slice(0,400) }
    });
  } catch (e) {
    res.status(200).json({ ok:false, error: String(e) });
  }
});

// --- ADD: OpenAI env peek (safe, masked)
app.get('/api/debug/env/openai', (req, res) => {
  const admin = process.env.ADMIN_TOKEN || '';
  if (admin && req.get('x-admin-token') !== admin) {
    return res.status(403).json({ ok:false, error:'forbidden' });
  }
  const key = process.env.OPENAI_API_KEY || '';
  const proj = process.env.OPENAI_PROJECT || '';
  const fast = process.env.AI_MODEL_FAST || '';
  const smart = process.env.AI_MODEL_SMART || '';
  res.json({
    ok: true,
    project_set: !!proj,
    model_fast: fast,
    model_smart: smart,
    key_mask: key ? `${key.slice(0,6)}…${key.slice(-4)}` : null
  });
});

// --- ADD: OpenAI live ping (uses your existing ai service)
app.get('/api/debug/ai', async (req, res) => {
  const admin = process.env.ADMIN_TOKEN || '';
  if (admin && req.get('x-admin-token') !== admin) {
    return res.status(403).json({ ok:false, error:'forbidden' });
  }
  try {
    const { getAIResponse } = require('./services/aiService'); // keep your current export
    const prompt = req.query.prompt || 'ping';
    const reply = await getAIResponse({
      system: 'You are a health probe. Reply with "pong".',
      user: prompt
    });
    res.json({ ok: true, reply });
  } catch (e) {
    // expose structured error so we can see the real cause
    const status = e.status || e.code || null;
    const body   = e.response?.data || e.error || e.message || String(e);
    res.status(200).json({ ok:false, status, error: body });
  }
});

// --- ADD: Raw OpenAI probe (admin-only)
app.get('/api/debug/ai/raw', async (req, res) => {
  const admin = process.env.ADMIN_TOKEN || '';
  if (admin && req.get('x-admin-token') !== admin) {
    return res.status(403).json({ ok:false, error:'forbidden' });
  }
  try {
    const OpenAI = require('openai');
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      project: process.env.OPENAI_PROJECT || undefined, // safe if set
    });
    const model = process.env.AI_MODEL_FAST || 'gpt-4o-mini';
    const prompt = req.query.prompt || 'ping';

    // Use chat.completions (stable)
    const r = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: 'Reply with "pong" if you can see this.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.2,
    });

    const text = r.choices?.[0]?.message?.content ?? null;
    res.json({ ok: true, model, text, usage: r.usage || null, raw_id: r.id || null });
  } catch (e) {
    // Return precise error details
    const status = e?.status || e?.code || null;
    const data = e?.response?.data || e?.message || String(e);
    res.json({ ok:false, status, error: data });
  }
});

// ---- ADD: keyword module introspection (admin only)
app.get('/api/debug/keywords', (req, res) => {
  const admin = process.env.ADMIN_TOKEN || '';
  if (admin && req.get('x-admin-token') !== admin) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }
  let svc = null, names = [];
  try {
    svc = require('./services/keywordService');
    names = Object.keys(svc || {});
  } catch (e) {
    return res.json({ ok: true, loaded: false, error: e?.message || String(e) });
  }
  res.json({
    ok: true,
    loaded: true,
    keys: names,
    has_findKeywordResponse: typeof svc?.findKeywordResponse === 'function',
    has_default_findKeywordResponse: typeof svc?.default?.findKeywordResponse === 'function'
  });
});

// --- ADD/REPLACE: safer AI debug route that never touches V2/DB
app.get('/api/debug/ai2', async (req, res) => {
  const adminToken = process.env.ADMIN_TOKEN || '';
  if (adminToken && req.get('x-admin-token') !== adminToken) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }

  const prompt = typeof req.query.prompt === 'string' ? req.query.prompt : 'ping';

  try {
    // 1) Try your new singleton that uses Chat Completions
    try {
      const { getAIResponseDirect, getAIResponse } = require('./services/aiService');
      const fn = getAIResponseDirect || getAIResponse; // prefer direct, else wrapper
      if (fn) {
        const reply = await fn({ system: 'Health check', user: prompt, mode: 'fast' });
        return res.json({ ok: true, reply });
      }
    } catch (_) {
      // no-op: fall through to raw call
    }

    // 2) Fallback: call OpenAI chat directly (never DB)
    const OpenAI = require('openai');
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      project: process.env.OPENAI_PROJECT || undefined,
    });
    const model = process.env.AI_MODEL_FAST || 'gpt-4o-mini';

    const r = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: 'Reply with "pong" if you can see this.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
    });

    const text = r.choices?.[0]?.message?.content ?? null;
    if (!text) return res.json({ ok: false, error: 'empty-openai-reply' });

    return res.json({ ok: true, reply: text });
  } catch (e) {
    return res.json({
      ok: false,
      status: e?.status || e?.code || null,
      error: e?.response?.data || e?.message || String(e),
    });
  }
});

// --- ADD: Extended health check (admin-only)
app.get('/api/debug/health', async (req, res) => {
  try {
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      environment: process.env.NODE_ENV || 'development',
      env: {
        project: process.env.GOOGLE_CLOUD_PROJECT || null,
        ai_path: process.env.AI_PATH || '(default)',
        fast: process.env.AI_MODEL_FAST || 'gpt-4o-mini',
        smart: process.env.AI_MODEL_SMART || 'gpt-4o',
        embed: process.env.EMBEDDING_MODEL || process.env.AI_EMBEDDING_MODEL || 'text-embedding-3-small',
        maytapi: !!process.env.MAYTAPI_API_KEY,
      }
    };
    res.json(health);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Real-time conversation monitoring
app.get('/api/test/conversations', (req, res) => {
  const adminToken = process.env.ADMIN_TOKEN || '';
  if (adminToken && req.get('x-admin-token') !== adminToken) {
    return res.status(403).json({ error: 'forbidden' });
  }
  
  const { getAllActiveChats } = require('./services/realtimeTestingService');
  const activeChats = getAllActiveChats();
  
  res.json({
    timestamp: new Date().toISOString(),
    activeConversations: activeChats.length,
    conversations: activeChats
  });
});

// Get specific conversation status
app.get('/api/test/conversation/:phone', (req, res) => {
  const adminToken = process.env.ADMIN_TOKEN || '';
  if (adminToken && req.get('x-admin-token') !== adminToken) {
    return res.status(403).json({ error: 'forbidden' });
  }
  
  const { getTestingStatus } = require('./services/realtimeTestingService');
  const tenantId = req.query.tenant_id || 'default';
  const phone = req.params.phone;
  
  const status = getTestingStatus(tenantId, phone);
  res.json({
    phone,
    tenantId,
    ...status
  });
});

// Manually trigger analysis (for testing)
app.post('/api/test/trigger-analysis', async (req, res) => {
  const adminToken = process.env.ADMIN_TOKEN || '';
  if (adminToken && req.get('x-admin-token') !== adminToken) {
    return res.status(403).json({ error: 'forbidden' });
  }
  
  const { triggerTestAnalysis } = require('./services/realtimeTestingService');
  const { tenant_id, phone } = req.body;
  
  if (!tenant_id || !phone) {
    return res.status(400).json({ error: 'tenant_id and phone required' });
  }
  
  const result = await triggerTestAnalysis(tenant_id, phone);
  res.json({
    success: result,
    message: result ? 'Analysis triggered' : 'No active conversation found'
  });
});

// Lead scoring test endpoint
app.get('/api/test/lead-score/:phone', async (req, res) => {
  const adminToken = process.env.ADMIN_TOKEN || '';
  if (adminToken && req.get('x-admin-token') !== adminToken) {
    return res.status(403).json({ error: 'forbidden' });
  }
  
  const phone = req.params.phone;
  const tenantId = req.query.tenant_id || 'default';
  
  try {
    const { data: conversation } = await dbClient
      .from('conversations_new')
      .select('lead_score, context_analysis, follow_up_at, follow_up_count')
      .eq('tenant_id', tenantId)
      .eq('end_user_phone', phone)
      .single();
    
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    
    let context = null;
    try {
      context = conversation.context_analysis ? JSON.parse(conversation.context_analysis) : null;
    } catch (e) {
      context = null;
    }
    
    res.json({
      phone,
      leadScore: conversation.lead_score,
      context,
      followUpScheduled: conversation.follow_up_at,
      followUpCount: conversation.follow_up_count
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 1. Check if realtime service is loaded and working
app.get('/api/test/realtime-status', (req, res) => {
  // Fallback: try to require the module if global is missing
  let svc = global.realtimeTestingService;
  if (!svc) {
    try { svc = require('./services/realtimeTestingService'); } catch {}
  }

  const isLoaded = !!svc;
  const activeTimers =
    (svc && svc.activeTimers && typeof svc.activeTimers.size === 'number')
      ? svc.activeTimers.size : 0;
  const conversationStates =
    (svc && svc.conversationStates && typeof svc.conversationStates.size === 'number')
      ? svc.conversationStates.size : 0;

  res.json({
    realtimeServiceLoaded: isLoaded,
    activeTimers,
    conversationStates,
    status: isLoaded ? 'Ready for testing' : 'Service not loaded'
  });
});

// 2. Simulate a customer message (starts timer)
app.post('/api/test/simulate-customer-message', (req, res) => {
  const { tenantId, tenant_id, phone, message } = req.body || {};
  const resolvedTenantId = String(tenantId || tenant_id || '1');
  
  if (!phone) {
    return res.status(400).json({ error: 'Phone number required' });
  }

  try {
    const { trackCustomerMessage } = require('./services/realtimeTestingService');
    trackCustomerMessage(resolvedTenantId, String(phone), String(message || 'Test message'))
      .then(() => {
        res.json({
          success: true,
          tenantId: resolvedTenantId,
          phone: String(phone),
          message: 'Customer message tracked',
          timerStarted: true,
          timeoutIn: '5 minutes'
        });
      })
      .catch((e) => {
        res.status(500).json({ error: e?.message || String(e) });
      });
  } catch (e) {
    res.status(500).json({ error: 'Realtime service not available' });
  }
});

// 3. Simulate a bot response (resets timer)
app.post('/api/test/simulate-bot-response', (req, res) => {
  const { tenantId, tenant_id, phone, response } = req.body || {};
  const resolvedTenantId = String(tenantId || tenant_id || '1');
  
  if (!phone) {
    return res.status(400).json({ error: 'Phone number required' });
  }

  try {
    const { trackBotMessage } = require('./services/realtimeTestingService');
    trackBotMessage(resolvedTenantId, String(phone), String(response || 'Test bot response'))
      .then(() => {
        res.json({
          success: true,
          tenantId: resolvedTenantId,
          phone: String(phone),
          message: 'Bot response tracked',
          timerReset: true,
          newTimeoutIn: '5 minutes'
        });
      })
      .catch((e) => {
        res.status(500).json({ error: e?.message || String(e) });
      });
  } catch (e) {
    res.status(500).json({ error: 'Realtime service not available' });
  }
});

// 4. Preview smart response (no WhatsApp send)
app.post('/api/test/preview-smart-response', async (req, res) => {
  try {
    const { tenantId, phone, message } = req.body || {};
    if (!tenantId || !message) {
      return res.status(400).json({ success: false, error: 'tenantId and message are required' });
    }

    const { getSmartResponse } = require('./services/smartResponseRouter');
    const result = await getSmartResponse(String(message), String(tenantId), phone ? String(phone) : null);
    return res.json({ success: true, result: result || null });
  } catch (error) {
    console.error('[TEST] preview-smart-response error:', error);
    return res.status(500).json({ success: false, error: 'Failed to preview smart response' });
  }
});

// 4.5 Preview full customer handler reply (runs the real handler pipeline, no WhatsApp send)
app.post('/api/test/preview-customer-handler', async (req, res) => {
  try {
    const { tenantId, phone, message } = req.body || {};
    if (!tenantId || !message) {
      return res.status(400).json({ success: false, error: 'tenantId and message are required' });
    }

    const customerHandler = require('./routes/handlers/customerHandler');

    const formattedReq = {
      body: {
        tenant_id: String(tenantId),
        customer_phone: phone ? String(phone) : '919000000000',
        customer_message: String(message)
      }
    };

    const handlerMeta = { status: null, json: null };
    const formattedRes = {
      status: (code) => ({
        json: (data) => {
          handlerMeta.status = code;
          handlerMeta.json = data;
          return data;
        }
      }),
      json: (data) => {
        handlerMeta.status = handlerMeta.status || 200;
        handlerMeta.json = data;
        return data;
      }
    };

    // Capture outbound messages (main handler normally sends via Maytapi)
    const prevDesktop = !!global.desktopAgentMode;
    const prevCaptured = global.capturedMessage;
    const prevCapturedMessages = global.capturedMessages;
    global.desktopAgentMode = true;
    global.capturedMessage = null;
    global.capturedMessages = [];

    try {
      await customerHandler.handleCustomerTextMessage(formattedReq, formattedRes);
    } finally {
      // Restore globals after handler finishes
      const outgoing = Array.isArray(global.capturedMessages) && global.capturedMessages.length
        ? global.capturedMessages
        : (global.capturedMessage ? [global.capturedMessage] : []);

      global.desktopAgentMode = prevDesktop;
      global.capturedMessage = prevCaptured;
      global.capturedMessages = prevCapturedMessages;

      return res.json({
        success: true,
        outgoing,
        handler: handlerMeta
      });
    }
  } catch (error) {
    console.error('[TEST] preview-customer-handler error:', error);
    return res.status(500).json({ success: false, error: 'Failed to preview customer handler reply' });
  }
});

// 5. Preview full response (smart router + AI fallback, no WhatsApp send)
app.post('/api/test/preview-full-response', async (req, res) => {
  try {
    const { tenantId, phone, message } = req.body || {};
    if (!tenantId || !message) {
      return res.status(400).json({ success: false, error: 'tenantId and message are required' });
    }

    const { getSmartResponse } = require('./services/smartResponseRouter');
    const smart = await getSmartResponse(String(message), String(tenantId), phone ? String(phone) : null);
    if (smart && smart.response) {
      return res.json({ success: true, source: smart.source || 'smart_router', result: smart });
    }

    // AI fallback (best effort). If OpenAI is unavailable/quota-limited, fall back to local text search.
    try {
      const { openai } = require('./services/config');
      const ai = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a helpful sales assistant. If you do not have enough info, ask a short clarifying question.' },
          { role: 'user', content: String(message) }
        ],
        temperature: 0.2,
        max_tokens: 500
      });

      const responseText = ai?.choices?.[0]?.message?.content?.trim() || '';
      return res.json({ success: true, source: 'ai_fallback', result: { response: responseText } });
    } catch (aiErr) {
      console.warn('[TEST] AI fallback unavailable, using local search:', aiErr?.message || aiErr);
      const { dbClient } = require('./services/config');
      const needle = String(message || '').trim().slice(0, 120);

      // Local SQLite wrapper doesn't reliably support PostgREST-style `.or()` and `.ilike()`.
      // Fetch a small candidate set and filter in JS for portability.
      const needleLower = needle.toLowerCase();
      const safeIncludes = (haystack) => String(haystack || '').toLowerCase().includes(needleLower);

      const [docsRes, productsRes, websiteRes] = await Promise.all([
        dbClient
          .from('tenant_documents')
          .select('original_name, filename, extracted_text')
          .eq('tenant_id', String(tenantId))
          .limit(50),
        dbClient
          .from('products')
          .select('name, description, price')
          .eq('tenant_id', String(tenantId))
          .limit(200),
        dbClient
          .from('website_embeddings')
          .select('content, chunk_text, source_url, url, page_title')
          .eq('tenant_id', String(tenantId))
          .limit(200)
      ]);

      const docs = (docsRes?.data || []).filter((d) =>
        safeIncludes(d.original_name) || safeIncludes(d.filename) || safeIncludes(d.extracted_text)
      ).slice(0, 2);

      const products = (productsRes?.data || []).filter((p) =>
        safeIncludes(p.name) || safeIncludes(p.description)
      ).slice(0, 3);

      const pages = (websiteRes?.data || []).filter((p) =>
        safeIncludes(p.page_title) || safeIncludes(p.url) || safeIncludes(p.source_url) || safeIncludes(p.chunk_text) || safeIncludes(p.content)
      ).slice(0, 2);

      let response = '';
      if (products.length) {
        response += 'Products I found:\n';
        for (const p of products) {
          response += `- ${p.name}${p.price ? ` (₹${p.price})` : ''}${p.description ? `: ${String(p.description).slice(0, 120)}` : ''}\n`;
        }
        response += '\n';
      }
      if (docs.length) {
        response += 'From uploaded documents:\n';
        docs.forEach((d, i) => {
          const name = d.original_name || d.filename || `document ${i + 1}`;
          const snippet = String(d.extracted_text || '').trim().slice(0, 300);
          response += `- ${name}: ${snippet}${snippet ? '…' : ''}\n`;
        });
        response += '\n';
      }
      if (pages.length) {
        response += 'From website indexing:\n';
        pages.forEach((p, i) => {
          const snippet = String(p.content || '').trim().slice(0, 300);
          response += `- Source ${i + 1}: ${snippet}${snippet ? '…' : ''}${p.source_url ? `\n  ${p.source_url}` : ''}\n`;
        });
        response += '\n';
      }

      if (!response) {
        response = 'No matching information found locally. (AI is currently unavailable.)';
      }

      return res.json({
        success: true,
        source: 'local_fallback',
        result: { response }
      });
    }
  } catch (error) {
    console.error('[TEST] preview-full-response error:', error);
    return res.status(500).json({ success: false, error: 'Failed to preview full response' });
  }
});

// 4. Force trigger timeout (for immediate testing)
app.post('/api/test/force-timeout', (req, res) => {
  const { tenantId, tenant_id, phone } = req.body || {};
  const resolvedTenantId = String(tenantId || tenant_id || '1');
  
  if (!phone) {
    return res.status(400).json({ error: 'Phone number required' });
  }

  try {
    const { triggerTestAnalysis } = require('./services/realtimeTestingService');
    triggerTestAnalysis(resolvedTenantId, String(phone))
      .then((ok) => {
        res.json({
          success: !!ok,
          tenantId: resolvedTenantId,
          phone: String(phone),
          message: ok ? 'Timeout/analysis triggered' : 'No active conversation found'
        });
      })
      .catch((e) => res.status(500).json({ error: e?.message || String(e) }));
  } catch (e) {
    res.status(500).json({ error: 'Realtime service not available' });
  }
});

// 4.1 Force lead scoring (and auto-triage for HOT) - best for local smoke testing
app.post('/api/test/score-lead', async (req, res) => {
  const adminToken = process.env.ADMIN_TOKEN || '';
  if (adminToken && req.get('x-admin-token') !== adminToken) {
    return res.status(403).json({ error: 'forbidden' });
  }

  const { tenantId, tenant_id, phone } = req.body || {};
  const resolvedTenantId = String(tenantId || tenant_id || '1');
  if (!phone) return res.status(400).json({ error: 'phone required' });

  try {
    const { scoreLead } = require('./services/leadScoringService');
    await scoreLead(resolvedTenantId, String(phone));

    const { data: conversation } = await dbClient
      .from('conversations_new')
      .select('id, lead_score')
      .eq('tenant_id', resolvedTenantId)
      .eq('end_user_phone', String(phone))
      .single();

    const convId = conversation?.id || null;
    let triage = [];
    if (convId) {
      const triageRes = await dbClient
        .from('triage_queue')
        .select('id, status, type, created_at')
        .eq('tenant_id', resolvedTenantId)
        .eq('conversation_id', convId)
        .order('created_at', { ascending: false })
        .limit(5);
      triage = triageRes?.data || [];
    }

    return res.json({
      success: true,
      tenantId: resolvedTenantId,
      phone: String(phone),
      conversationId: convId,
      leadScore: conversation?.lead_score || null,
      triage
    });
  } catch (error) {
    console.error('[TEST] score-lead error:', error);
    return res.status(500).json({ error: error?.message || 'Failed to score lead' });
  }
});

// 5. View all active timers and conversation states
app.get('/api/test/conversation-debug', (req, res) => {
  try {
    const svc = global.realtimeTestingService || {};

    // Try the most likely places your code might store timers
    const timersAny =
      svc.activeTimers ??
      svc.timers ??
      svc.timerMap ??
      svc.timerIds ??
      null;

    // Normalize to array of { id, ...meta }
    let timersArr = [];
    let size = 0;

    if (timersAny && typeof timersAny.size === 'number' && typeof timersAny.keys === 'function') {
      // Map-like
      size = timersAny.size;
      timersArr = Array.from(timersAny.entries()).map(([id, rec]) => ({
        id,
        ...(rec || {})
      }));
    } else if (Array.isArray(timersAny)) {
      // Array
      size = timersAny.length;
      timersArr = timersAny;
    } else if (timersAny && typeof timersAny === 'object') {
      // Plain object
      const keys = Object.keys(timersAny);
      size = keys.length;
      timersArr = keys.map((id) => ({ id, ...(timersAny[id] || {}) }));
    } else {
      // Nothing present
      size = 0;
      timersArr = [];
    }

    // Add a tiny heartbeat if you expose one; fallback to 0
    const conversationStates =
      (svc.conversationStates && typeof svc.conversationStates.size === 'number')
        ? svc.conversationStates.size
        : (typeof svc.tick === 'number' ? svc.tick : 0);

    return res.status(200).json({
      ok: true,
      realtimeServiceLoaded: !!svc,
      activeTimers: size,
      timers: timersArr,
      conversationStates
    });
  } catch (e) {
    console.error('[conversation-debug]', e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// 6. Quick test sequence - complete flow in 30 seconds
app.post('/api/test/quick-flow-test', (req, res) => {
  const { phone } = req.body;
  
  if (!phone) {
    return res.status(400).json({ error: 'Phone number required' });
  }

  if (!global.realtimeTestingService) {
    return res.status(500).json({ error: 'Realtime service not available' });
  }

  const service = global.realtimeTestingService;
  
  // Step 1: Customer message
  service.trackCustomerMessage(phone, {
    type: 'text',
    content: 'Quick test message',
    timestamp: new Date()
  });

  setTimeout(() => {
    // Step 2: Bot response (after 5 seconds)
    service.trackBotResponse(phone, {
      type: 'text',
      content: 'Quick test bot response',
      timestamp: new Date()
    });

    setTimeout(() => {
      // Step 3: Force timeout (after another 10 seconds, total 15 seconds)
      service.handleConversationTimeout(phone);
    }, 10000);

  }, 5000);

  res.json({
    success: true,
    message: `Quick flow test started for ${phone}`,
    timeline: {
      step1: 'Customer message - NOW',
      step2: 'Bot response - in 5 seconds',
      step3: 'Timeout trigger - in 15 seconds'
    },
    note: 'Monitor logs for the complete flow'
  });
});

// 7. Clear all timers and states (reset for testing)
app.post('/api/test/reset-all', (req, res) => {
  if (!global.realtimeTestingService) {
    return res.status(500).json({ error: 'Realtime service not available' });
  }

  const service = global.realtimeTestingService;
  
  // Clear all timers
  service.activeTimers.forEach(timerId => clearTimeout(timerId));
  service.activeTimers.clear();
  service.conversationStates.clear();

  res.json({
    success: true,
    message: 'All timers and conversation states cleared',
    note: 'Ready for fresh testing'
  });
});

// Make sure your 404 handler only catches API routes, not static files
// Replace your current 404 handler with this more specific one:
app.use('/api/*', (req, res) => {
    res.status(404).json({ error: 'API route not found' });
});

// Or comment out the 404 handler entirely for now:
// app.use('*', (req, res) => {
//   res.status(404).json({ error: 'Route not found' });
// });

// Harden process against crashes
process.on('unhandledRejection', (err) => {
  console.error('[UNHANDLED_REJECTION]', err);
});

// ============================================
// Customer Portal API Endpoints
// ============================================

// Agent Login Page
app.get('/agent-login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'agent-login.html'));
});

// Note: /api/agent-login and /api/agent-register are defined above (before apiRouter)

// Register new tenant
app.post('/api/register-tenant', async (req, res) => {
  try {
    const { tenantId, email } = req.body;
    
    if (!tenantId || !email) {
      return res.status(400).json({ error: 'Missing tenantId or email' });
    }

    // Save tenant to database
    const { data, error } = await dbClient
      .from('tenants')
      .upsert({
        id: tenantId,
        email: email,
        created_at: new Date().toISOString(),
        status: 'active',
        plan: 'free'
      }, {
        onConflict: 'id'
      });

    if (error) {
      console.error('[REGISTER_TENANT] dbClient error:', error);
      return res.status(500).json({ error: 'Failed to register tenant' });
    }

    console.log(`[REGISTER_TENANT] New tenant registered: ${tenantId} (${email})`);
    res.json({ 
      ok: true, 
      tenantId, 
      message: 'Tenant registered successfully' 
    });

  } catch (error) {
    console.error('[REGISTER_TENANT] Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get tenant status and stats
app.get('/api/status', async (req, res) => {
  try {
    const tenantId = req.query.tenant_id;
    
    if (!tenantId) {
      return res.status(400).json({ error: 'Missing tenant_id' });
    }

    // Check if desktop agent is connected (you'll implement this based on your architecture)
    const agentConnected = false; // TODO: Check actual connection status
    const whatsappConnected = false; // TODO: Check WhatsApp connection status

    // Get message count for today
    const today = new Date().toISOString().split('T')[0];
    const { data: messages, error: msgError } = await dbClient
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .gte('created_at', today);

    // Get order count
    const { data: orders, error: orderError } = await dbClient
      .from('orders_new')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId);

    // Get unique customer count
    const { data: customers, error: custError } = await dbClient
      .from('customers')
      .select('phone', { count: 'exact', head: true })
      .eq('tenant_id', tenantId);

    res.json({
      agentConnected,
      whatsappConnected,
      botReady: true,
      messagesCount: messages || 0,
      ordersCount: orders || 0,
      customersCount: customers || 0
    });

  } catch (error) {
    console.error('[STATUS] Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Serve customer portal pages
app.get('/customer-portal', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'customer-portal.html'));
});

app.get('/customer-dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'customer-dashboard.html'));
});

process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT_EXCEPTION]', err);
});

// Error tracking and logging middleware
app.use((err, req, res, next) => {
  const errorId = require('crypto').randomUUID().slice(0, 8);
  
  console.error(`[ERROR][${errorId}]`, {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('user-agent'),
    timestamp: new Date().toISOString()
  });

  // Send error to external monitoring service (if configured)
  if (process.env.SENTRY_DSN) {
    // Sentry integration would go here
  }

  res.status(err.status || 500).json({
    error: 'Internal Server Error',
    errorId,
    message: process.env.NODE_ENV === 'production' ? 'An error occurred' : err.message
  });
});

// --- Start Server ---
const server = app.listen(PORT, async () => {
    console.log(`Server listening on port ${PORT}`);
    
    // Initialize WebSocket service
    try {
        const websocketService = require('./services/websocket-service');
        console.log('[STARTUP] Initializing WebSocket service...');
        websocketService.initialize(server);
        console.log('[STARTUP] WebSocket service initialization complete');
    } catch (error) {
        console.error('[STARTUP] WebSocket service initialization failed:', error.message);
    }
    
    // Initialize Redis cache
    try {
        const PerformanceService = require('./services/performance-service');
        console.log('[STARTUP] Initializing Redis cache...');
        await PerformanceService.initializeCache();
        console.log('[STARTUP] Redis cache initialization complete');
    } catch (error) {
        console.error('[STARTUP] Redis cache initialization failed:', error.message);
    }
    
    // Auto-initialize WhatsApp Web clients for connected tenants
    try {
        const { autoInitializeConnectedClients } = require('./services/whatsappWebService');
        console.log('[STARTUP] Auto-initializing WhatsApp Web clients...');
        await autoInitializeConnectedClients();
        console.log('[STARTUP] WhatsApp Web auto-initialization complete');
    } catch (error) {
        console.error('[STARTUP] Failed to auto-initialize WhatsApp Web clients:', error.message);
    }
});

console.log('🧪 Test endpoints loaded:');
console.log('  GET  /api/test/realtime-status');
console.log('  POST /api/test/simulate-customer-message');
console.log('  POST /api/test/simulate-bot-response'); 
console.log('  POST /api/test/force-timeout');
console.log('  GET  /api/test/conversation-debug');
console.log('  POST /api/test/quick-flow-test');
console.log('  POST /api/test/reset-all');

console.log('[DEBUG] About to initialize shipment tracking cron...');

// Start shipment tracking cron job
try {
  const shipmentTrackingCron = require('./schedulers/shipmentTrackingCron');
  console.log('[SHIPMENT_TRACKING] Initializing cron job...');
  shipmentTrackingCron.start();
  console.log('[SHIPMENT_TRACKING] ✅ Cron job started - checking daily at 9 AM');
} catch (error) {
  console.error('[SHIPMENT_TRACKING] ❌ Failed to start cron:', error.message);
  console.error('[SHIPMENT_TRACKING] Stack:', error.stack);
}

// Start cron job - every minute for broadcasts, every 15 minutes for follow-ups
cron.schedule('* * * * *', async () => {
  console.log('[CRON] Starting broadcast queue processing...');
  try {
    await processBroadcastQueue();
  } catch (error) {
    console.error('[CRON] Error:', error);
  }
});

// Run every 15 minutes for follow-ups and urgent tasks
cron.schedule('*/15 * * * *', runScheduledTasks);

console.log('[CRON] Broadcast queue processor started');

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
    process.exit(0);
  });
});

// Memory monitoring
setInterval(() => {
  const memUsage = process.memoryUsage();
  const memUsageMB = {
    rss: Math.round(memUsage.rss / 1024 / 1024),
    heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
    heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
    external: Math.round(memUsage.external / 1024 / 1024)
  };

  // Log memory usage if it's high (configurable threshold)
  const heapThreshold = parseInt(process.env.MEMORY_THRESHOLD_MB) || 512;
  if (memUsageMB.heapUsed > heapThreshold) {
    console.warn('[MEMORY_WARNING] High memory usage detected:', memUsageMB);
  }

  // Force garbage collection if available and memory is very high
  if (global.gc && memUsageMB.heapUsed > heapThreshold * 1.5) {
    console.log('[MEMORY] Forcing garbage collection');
    global.gc();
  }
}, 60000); // Check every minute

// Export for future tests
module.exports = {
  app,
  // Export monitoring functions for use in other modules
  getSystemMetrics: () => ({
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    cpuUsage: process.cpuUsage()
  }),
  
  logError: (error, context = {}) => {
    const errorId = require('crypto').randomUUID().slice(0, 8);
    console.error(`[ERROR][${errorId}]`, {
      message: error.message,
      stack: error.stack,
      ...context,
      timestamp: new Date().toISOString()
    });
    return errorId;
  }
};

// Initialize intelligence scheduler
try {
  require('./schedulers/intelligenceRunner');
  console.log('[INIT] Intelligence scheduler initialized');
} catch (e) {
  console.warn('[INIT] Intelligence scheduler failed to load:', e?.message || e);
}

// Initialize follow-up schedulers
try {
  const { initializeFollowUpScheduler } = require('./schedulers/followUpCron');
  const { initializeIntelligentFollowUpScheduler } = require('./schedulers/intelligentFollowUpCron');
  
  // Start follow-up schedulers
  initializeFollowUpScheduler();  // Manual "remind me" follow-ups (every 5 minutes)
  initializeIntelligentFollowUpScheduler();  // Intelligent behavioral follow-ups (daily at 9 AM)
  
  console.log('[INIT] Follow-up schedulers initialized');
} catch (e) {
  console.warn('[INIT] Follow-up schedulers failed to load:', e?.message || e);
}



