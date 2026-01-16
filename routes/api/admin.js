// routes/api/admin.js
const express = require('express');
const router = express.Router();
const { dbClient } = require('../../services/config');
const isAdminGuard = require('../../middleware/isAdminGuard'); // adjust path if different
const logger = console;

// Try to load processing functions from likely places in your repo.
// We try multiple candidate modules and pick the first usable processing function.
const handlerModuleCandidates = [
  '../../handlers/customerHandler',
  '../../routes/handlers/customerHandler',
  '../../routes/handlers/completeAdminHandler',
  '../../handlers/orderHandler',
  '../../services/orderService',
  '../../services/customerService',
  '../../services/orderProcessingService',
  '../../routes/handlers/processingHandler'
];

let resolvedProcessFn = null;
for (const p of handlerModuleCandidates) {
  try {
    // dynamic require
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const mod = require(p);
    if (!mod) continue;

    // candidate export names to look for
    const names = [
      'processIncomingMessage',
      'handleMessage',
      'processMessage',
      'process',
      'reprocessMessage',
      'handleIncoming',
      'handleCompleteAdminCommands'
    ];
    for (const n of names) {
      if (typeof mod[n] === 'function') {
        resolvedProcessFn = { fn: mod[n].bind(mod), source: p + '#' + n };
        break;
      }
    }
    // if module itself is a function (default export)
    if (!resolvedProcessFn && typeof mod === 'function') {
      resolvedProcessFn = { fn: mod, source: p + '#default' };
    }
    if (resolvedProcessFn) {
      logger.info('[admin] using process fn from', resolvedProcessFn.source);
      break;
    }
  } catch (e) {
    // ignore missing modules
  }
}

// Helper: mark message processed/failure
async function markMessageProcessed(messageId, result) {
  await dbClient.from('messages').update({
    processed: true,
    processed_at: new Date().toISOString(),
    processing_attempts: dbClient.raw('processing_attempts + 1'),
    processing_result: result || { ok: true }
  }).eq('id', messageId);
}

async function markMessageFailure(message, err) {
  try {
    await dbClient.from('message_processing_failures').insert([{
      message_id: message.id,
      attempt: (message.processing_attempts || 0) + 1,
      error_text: String(err && (err.message || err)),
      error_json: err && err.stack ? { stack: err.stack } : null,
      created_at: new Date().toISOString()
    }]);
  } catch (e) {
    logger.error('[admin] failed to write failure audit', e);
  }
  await dbClient.from('messages').update({
    processing_attempts: (message.processing_attempts || 0) + 1,
    processing_result: { error: String(err && (err.message || err)) }
  }).eq('id', message.id);
}

/**
 * POST /api/admin/reprocess-message/:messageId
 * Protected - only admin (isAdminGuard)
 */
router.post('/reprocess-message/:messageId', isAdminGuard, async (req, res) => {
  const { messageId } = req.params;
  if (!messageId) return res.status(400).json({ success: false, error: 'messageId required' });

  try {
    const { data: message, error: msgErr } = await dbClient
      .from('messages')
      .select('*')
      .eq('id', messageId)
      .maybeSingle();

    if (msgErr) {
      logger.error('[admin.reprocess] db fetch error', msgErr);
      return res.status(500).json({ success: false, error: 'db_error', details: msgErr.message || msgErr });
    }
    if (!message) return res.status(404).json({ success: false, error: 'message_not_found' });

    if (message.processed) {
      return res.json({ success: true, info: 'message_already_processed', message });
    }

    if (!resolvedProcessFn || typeof resolvedProcessFn.fn !== 'function') {
      // No processing fn found — give operator actionable info
      logger.warn('[admin.reprocess] no processing function found. Searched candidates.');
      return res.status(500).json({
        success: false,
        error: 'no_handler',
        details: 'No processing handler found. Ensure customer/order handler exports a processing function.'
      });
    }

    // Call handler in two supported shapes:
    // - fn({ messageId, conversationId, text, phone, tenantId })
    // - fn(messageId, conversationId, text)
    try {
      let result = null;
      const fn = resolvedProcessFn.fn;
      if (fn.length === 1) {
        result = await fn({
          messageId: message.id,
          conversationId: message.conversation_id,
          text: message.message_body,
          phone: message.sender || null,
          tenantId: message.tenant_id || null
        });
      } else {
        result = await fn(message.id, message.conversation_id, message.message_body);
      }

      // mark processed (store result)
      await dbClient.from('messages').update({
        processed: true,
        processed_at: new Date().toISOString(),
        processed_result: result || { ok: true }
      }).eq('id', message.id);

      return res.json({ success: true, result });
    } catch (handlerErr) {
      logger.error('[admin.reprocess] handler error', handlerErr && (handlerErr.stack || handlerErr.message || handlerErr));
      await markMessageFailure(message, handlerErr);
      return res.status(500).json({ success: false, error: 'handler_failed', details: String(handlerErr.message || handlerErr) });
    }
  } catch (err) {
    logger.error('[admin.reprocess] unexpected', err && (err.stack || err));
    return res.status(500).json({ success: false, error: 'unexpected', details: String(err?.message || err) });
  }
});


// Get Zoho sync statistics
router.get('/zoho/sync-stats', async (req, res) => {
  try {
    const tenantId = req.query.tenant_id || process.env.TENANT_ID;
    const { dbClient } = require('../../services/config');
        
    const { count: pendingOrders } = await dbClient
      .from('orders_new')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('zoho_sync_status', 'pending');
            
    const { count: syncedOrders } = await dbClient
      .from('orders_new')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('zoho_sync_status', 'synced');
            
    const { count: failedOrders } = await dbClient
      .from('orders_new')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('zoho_sync_status', 'failed');

    res.json({
      success: true,
      stats: {
        pending: pendingOrders || 0,
        synced: syncedOrders || 0,
        failed: failedOrders || 0,
        total: (pendingOrders || 0) + (syncedOrders || 0) + (failedOrders || 0)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Retry failed Zoho syncs
router.post('/zoho/retry-failed-syncs', async (req, res) => {
  try {
    const tenantId = req.body.tenant_id || process.env.TENANT_ID;
    const { dbClient } = require('../../services/config');
    const { processOrderToZoho } = require('../../services/zohoSalesOrderService');
        
    const { data: failedOrders } = await dbClient
      .from('orders_new')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('zoho_sync_status', 'failed')
      .limit(10);
            
    let retryCount = 0;
        
    for (const order of failedOrders || []) {
      try {
        const result = await processOrderToZoho(tenantId, order.id);
        if (result.success) {
          retryCount++;
        }
      } catch (retryError) {
        console.error('Retry error for order', order.id, retryError);
      }
    }
        
    res.json({
      success: true,
      message: `Successfully retried ${retryCount} out of ${failedOrders?.length || 0} failed orders`
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;


