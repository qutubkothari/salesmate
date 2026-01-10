// workers/processMessages.js
const { dbClient } = require('../services/config'); // adjust path
const logger = console;
const BATCH_SIZE = Number(process.env.MSG_BATCH_SIZE || 10);
const POLL_INTERVAL_MS = Number(process.env.MSG_POLL_INTERVAL_MS || 5000);

// Try to use existing handler if present
let customerHandler = null;
try {
  customerHandler = require('../handlers/customerHandler'); // adjust path
} catch (e) {
  logger.warn('customerHandler not found, worker will fallback to minimal processing');
}

// Minimal fallback processor (if you don't want to call existing handler)
async function fallbackProcessMessage(message) {
  // Basic idea: parse message.message_body for product patterns and call existing services
  // For production, delegate to your pricingService/cartService/orderService functions.
  logger.info('fallbackProcessMessage called for', message.id);
  // Example: if message contains "checkout" or "yes, go ahead", call cart->order flow.
  // Implement domain-specific parsing here or call your existing pipeline.
  return { ok: false, reason: 'no-op fallback' };
}

async function processMessageOnce(message) {
  // Protect with idempotency: check if an order already exists with message_id
  const { data: existingOrder } = await dbClient
    .from('orders')
    .select('id')
    .eq('message_id', message.id)
    .limit(1)
    .maybeSingle();

  if (existingOrder && existingOrder.id) {
    logger.info('message already processed into order', existingOrder.id);
    // mark message processed if not already
    await dbClient.from('messages').update({ processed: true, processed_at: new Date().toISOString(), processing_result: { note: 'order_already_exists', order_id: existingOrder.id } }).eq('id', message.id);
    return { ok: true, orderId: existingOrder.id };
  }

  // If you have a customerHandler.processIncomingMessage use it
  try {
    if (customerHandler && typeof customerHandler.processIncomingMessage === 'function') {
      const result = await customerHandler.processIncomingMessage({ messageId: message.id, conversationId: message.conversation_id, text: message.message_body, phone: null });
      // Expect result to indicate success and include created order id if any
      return result;
    } else {
      // fallback: minimal processing (customize)
      const fallbackResult = await fallbackProcessMessage(message);
      return fallbackResult;
    }
  } catch (err) {
    logger.error('processIncomingMessage failed', err);
    throw err;
  }
}

async function workerLoop() {
  while (true) {
    try {
      // fetch some unprocessed messages
      const { data: messages, error } = await dbClient
        .from('messages')
        .select('*')
        .eq('processed', false)
        .lt('processing_attempts', 5)
        .order('created_at', { ascending: true })
        .limit(BATCH_SIZE);

      if (error) {
        logger.error('fetch messages error', error);
        await sleep(POLL_INTERVAL_MS);
        continue;
      }
      if (!messages || messages.length === 0) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      for (const msg of messages) {
        try {
          // increment attempts (optimistic)
          await dbClient.from('messages').update({ processing_attempts: msg.processing_attempts + 1 }).eq('id', msg.id);

          // process
          const result = await processMessageOnce(msg);

          // on success: set processed true and store result
          await dbClient.from('messages').update({
            processed: true,
            processed_at: new Date().toISOString(),
            processing_result: result ? result : { ok: true }
          }).eq('id', msg.id);

          logger.info('processed message', msg.id);
        } catch (procErr) {
          logger.error('processing failed for message', msg.id, procErr);
          // record failure
          await dbClient.from('message_processing_failures').insert([{
            message_id: msg.id,
            attempt: msg.processing_attempts + 1,
            error_text: String(procErr.message || procErr),
            error_json: (procErr && procErr.stack) ? { stack: (procErr.stack || null) } : null,
            created_at: new Date().toISOString()
          }]);
          // leave processed=false so it can be retried up to limit
        }
      }
    } catch (outerErr) {
      logger.error('workerLoop top-level error', outerErr);
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

(async () => {
  logger.info('Message worker started');
  await workerLoop();
})();

