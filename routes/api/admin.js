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

// ========== NEW ADMIN ENDPOINTS FOR MANAGEMENT ==========
const Database = require('better-sqlite3');
const path = require('path');

let db;
try {
  if (process.env.USE_SUPABASE !== 'true') {
    db = new Database(path.join(__dirname, '../../local-database.db'));
    db.pragma('journal_mode = WAL');
  }
} catch (err) {
  console.warn('[ADMIN] SQLite init skipped (using Supabase):', err.message);
}

function dbAll(sql, params = []) {
    if (!db) throw new Error('SQLite not available - using Supabase');
    return db.prepare(sql).all(...params);
}

function dbGet(sql, params = []) {
    if (!db) throw new Error('SQLite not available - using Supabase');
    return db.prepare(sql).get(...params);
}

function dbRun(sql, params = []) {
    if (!db) throw new Error('SQLite not available - using Supabase');
    return db.prepare(sql).run(...params);
}

function generateId() {
    return require('crypto').randomBytes(16).toString('hex');
}

// Get all salesmen
router.get('/salesmen', (req, res) => {
    try {
        const tenantId = req.query.tenant_id;
        if (!tenantId) {
            return res.status(400).json({ error: 'tenant_id required' });
        }

        const salesmen = dbAll(
            `SELECT s.*, 
                    COUNT(DISTINCT v.id) as visits_today
             FROM salesmen s
             LEFT JOIN visits v ON v.salesman_id = s.id AND DATE(v.visit_date) = DATE('now')
             WHERE s.tenant_id = ?
             GROUP BY s.id
             ORDER BY s.name`,
            [tenantId]
        );

        res.json({ success: true, salesmen });
    } catch (error) {
        console.error('Error fetching salesmen:', error);
        res.status(500).json({ error: error.message });
    }
});

// Create product
router.post('/products', (req, res) => {
    try {
        const { tenant_id, name, category, price, stock_quantity, description, is_active } = req.body;

        if (!tenant_id || !name || !price) {
            return res.status(400).json({ error: 'tenant_id, name, and price are required' });
        }

        const id = generateId();
        dbRun(
            `INSERT INTO products 
             (id, tenant_id, name, category, price, stock_quantity, description, is_active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
            [id, tenant_id, name, category || 'General', price, stock_quantity || 0, description || '', is_active !== undefined ? is_active : 1]
        );

        res.json({ success: true, product_id: id });
    } catch (error) {
        console.error('Error creating product:', error);
        res.status(500).json({ error: error.message });
    }
});

// Update product
router.put('/products/:id', (req, res) => {
    try {
        const { id } = req.params;
        const { name, category, price, stock_quantity, description, is_active } = req.body;

        const updates = [];
        const params = [];

        if (name !== undefined) { updates.push('name = ?'); params.push(name); }
        if (category !== undefined) { updates.push('category = ?'); params.push(category); }
        if (price !== undefined) { updates.push('price = ?'); params.push(price); }
        if (stock_quantity !== undefined) { updates.push('stock_quantity = ?'); params.push(stock_quantity); }
        if (description !== undefined) { updates.push('description = ?'); params.push(description); }
        if (is_active !== undefined) { updates.push('is_active = ?'); params.push(is_active); }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        updates.push('updated_at = datetime("now")');
        params.push(id);

        dbRun(
            `UPDATE products SET ${updates.join(', ')} WHERE id = ?`,
            params
        );

        res.json({ success: true });
    } catch (error) {
        console.error('Error updating product:', error);
        res.status(500).json({ error: error.message });
    }
});

// Delete product
router.delete('/products/:id', (req, res) => {
    try {
        const { id } = req.params;
        dbRun('DELETE FROM products WHERE id = ?', [id]);
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting product:', error);
        res.status(500).json({ error: error.message });
    }
});

// Create order
router.post('/orders', (req, res) => {
    try {
        const { tenant_id, customer_name, phone_number, total_amount, items } = req.body;

        if (!tenant_id || !customer_name || !phone_number) {
            return res.status(400).json({ error: 'tenant_id, customer_name, and phone_number are required' });
        }

        const orderId = generateId();
        const orderNumber = 'ORD-' + Date.now();

        dbRun(
            `INSERT INTO orders 
             (id, tenant_id, order_number, customer_name, phone_number, total_amount, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 'pending', datetime('now'), datetime('now'))`,
            [orderId, tenant_id, orderNumber, customer_name, phone_number, total_amount || 0]
        );

        // Insert order items if provided
        if (items && Array.isArray(items)) {
            for (const item of items) {
                const itemId = generateId();
                dbRun(
                    `INSERT INTO order_items 
                     (id, order_id, product_id, product_name, quantity, unit_price, total_price, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
                    [itemId, orderId, item.product_id, item.product_name, item.quantity, item.unit_price, item.total_price]
                );
            }
        }

        res.json({ success: true, order_id: orderId, order_number: orderNumber });
    } catch (error) {
        console.error('Error creating order:', error);
        res.status(500).json({ error: error.message });
    }
});

// Create customer
router.post('/customers', (req, res) => {
    try {
        const { tenant_id, business_name, phone, contact_person, email, city, state, customer_type } = req.body;

        if (!tenant_id || !business_name || !phone) {
            return res.status(400).json({ error: 'tenant_id, business_name, and phone are required' });
        }

        const id = generateId();
        dbRun(
            `INSERT INTO customer_profiles_new 
             (id, tenant_id, business_name, phone, contact_person, email, city, state, customer_type, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', datetime('now'), datetime('now'))`,
            [id, tenant_id, business_name, phone, contact_person || '', email || '', city || '', state || '', customer_type || 'retail']
        );

        res.json({ success: true, customer_id: id });
    } catch (error) {
        console.error('Error creating customer:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;


