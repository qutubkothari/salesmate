// routes/api/orders.js
const express = require('express');
const router = express.Router();
const { dbClient } = require('../../services/config');

/**
 * GET /api/orders/:orderId
 * Returns a single order with enriched items + product details.
 */
router.get('/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    if (!orderId) return res.status(400).json({ error: 'orderId required' });

    const { data: order, error: orderErr } = await dbClient
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .maybeSingle();

    if (orderErr) {
      console.error('Order fetch error', orderErr);
      return res.status(500).json({ error: 'Failed to fetch order', details: orderErr.message || orderErr });
    }
    if (!order) return res.status(404).json({ error: 'Order not found' });

    // fetch order_items and products (safe and tolerant)
    let items = [];
    try {
      const { data: orderItems, error: itemsErr } = await dbClient
        .from('order_items')
        .select('*, products ( id, name, sku, model_number )')
        .eq('order_id', orderId);

      if (!itemsErr && orderItems) {
        items = (orderItems || []).map(it => ({
          id: it.id,
          product_id: it.product_id,
          quantity: Number(it.quantity || 0),
          price_at_time_of_purchase: Number(it.price_at_time_of_purchase || 0),
          productName: it.products?.name || 'Unknown Product',
          sku: it.products?.code || 'N/A', // Use 'code' as SKU
          unitPrice: Number(it.price_at_time_of_purchase || 0),
          lineTotal: Number(it.price_at_time_of_purchase || 0) * Number(it.quantity || 0)
        }));
      }
    } catch (e) {
      console.warn('Order items fetch failed', e && e.message ? e.message : e);
    }

    const payload = {
      ...order,
      items
    };

    res.json({ success: true, order: payload });
  } catch (err) {
    console.error('GET /api/orders/:orderId error', err);
    res.status(500).json({ error: 'Failed to fetch order', details: String(err?.message || err) });
  }
});

/**
 * PATCH /api/orders/:orderId/status
 * Update order status safely (also updates order_status).
 */
router.patch('/:orderId/status', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status } = req.body;
    if (!orderId || typeof status !== 'string') {
      return res.status(400).json({ success: false, error: 'orderId and status required' });
    }

    const allowed = ['new','pending_payment','pending','confirmed','shipped','delivered','cancelled','refunded'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid status' });
    }

    const { data, error } = await dbClient
      .from('orders')
      .update({ status, order_status: status })
      .eq('id', orderId)
      .select('id, status, order_status')
      .single();

    if (error) {
      console.error('Failed to update order status:', error);
      return res.status(500).json({ success: false, error: error.message || String(error) });
    }

    res.json({ success: true, order: data });
  } catch (err) {
    console.error('Error in PATCH /api/orders/:orderId/status', err);
    res.status(500).json({ success: false, error: String(err?.message || err) });
  }
});

module.exports = router;

