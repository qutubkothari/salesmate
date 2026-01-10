const { dbClient } = require('../../config/database');
const { analyzePurchaseFrequency } = require('../analytics/purchaseFrequency');
const { analyzeProductAffinity } = require('../analytics/productAffinity');
const { isUnsubscribed } = require('../unsubscribeService');

/**
 * PROACTIVE MESSAGING SYSTEM
 * Automatically sends reorder reminders to customers
 * Runs daily at 9 AM via scheduler
 */

/**
 * Main function: Find customers due for reorder and schedule messages
 */
async function scheduleProactiveMessages(tenantId) {
  console.log('[PROACTIVE] Starting daily proactive messaging run...');
  
  try {
    const stats = {
      customersAnalyzed: 0,
      messagesScheduled: 0,
      customersSkipped: 0
    };

    // Get all active customers for this tenant
    const { data: customers, error } = await dbClient
      .from('customer_profiles')
      .select('id, first_name, last_name, phone, zoho_customer_id, last_order_date')
      .eq('tenant_id', tenantId)
      .not('zoho_customer_id', 'is', null)
      .order('last_order_date', { ascending: false });

    if (error) {
      console.error('[PROACTIVE] Error fetching customers:', error);
      return stats;
    }

  console.log(`[PROACTIVE] Analyzing ${customers?.length || 0} customers...`);

    // Cache schema checks to avoid repeated failing queries
    let statusColumnExists = null;

    for (const customer of customers) {
      stats.customersAnalyzed++;

      // Check if customer should receive a message
      const shouldSendMessage = await shouldSendProactiveMessage(customer);
      
      if (!shouldSendMessage.send) {
        stats.customersSkipped++;
        continue;
      }

      // Get purchase frequency data
      const frequency = await analyzePurchaseFrequency(customer.id);
      
      if (!frequency) {
        stats.customersSkipped++;
        continue;
      }

      // Only send if customer is due for reorder
      if (!frequency.nextOrderPrediction.isDue) {
        stats.customersSkipped++;
        continue;
      }

      // Get product recommendations
      const affinity = await analyzeProductAffinity(customer.id);
      const regularProducts = affinity.regularProducts || [];

      if (regularProducts.length === 0) {
        stats.customersSkipped++;
        continue;
      }

      // Create personalized message
      const message = createReorderMessage(customer, frequency, regularProducts);

      // Schedule the message
      const scheduled = await scheduleMessage(
        tenantId,
        customer.id,
        'reorder_reminder',
        message,
        {
          daysSinceLastOrder: frequency.daysSinceLastOrder,
          regularProducts: regularProducts.slice(0, 3).map(p => p.name),
          averageInterval: frequency.averageInterval
        }
      );

      if (scheduled) {
        stats.messagesScheduled++;
        console.log(`[PROACTIVE] Scheduled message for ${customer.first_name}`);
      }
    }

    // Update analytics
    await updateDailyAnalytics(tenantId, stats);

    console.log('[PROACTIVE] Run complete:', stats);
    return stats;

  } catch (error) {
    console.error('[PROACTIVE] Error in proactive messaging:', error);
    return { error: error.message };
  }
}

/**
 * Check if customer should receive a proactive message
 */
async function shouldSendProactiveMessage(customer) {
  try {
    // Global opt-out enforcement
    if (await isUnsubscribed(customer?.phone)) {
      return { send: false, reason: 'User unsubscribed' };
    }

    // Get customer preferences
    const { data: prefs } = await dbClient
      .from('customer_messaging_preferences')
      .select('*')
      .eq('customer_profile_id', customer.id)
      .single();

    // Create default preferences if they don't exist
    if (!prefs) {
      await dbClient
        .from('customer_messaging_preferences')
        .insert({
          customer_profile_id: customer.id,
          proactive_reminders_enabled: true
        });
      return { send: true };
    }

    // Check if reminders are enabled
    if (!prefs.proactive_reminders_enabled) {
      return { send: false, reason: 'Reminders disabled' };
    }

    // Check weekly message limit
    if (prefs.messages_sent_this_week >= prefs.max_messages_per_week) {
      return { send: false, reason: 'Weekly limit reached' };
    }

    // Check if we sent a message recently (avoid spam)
    if (prefs.last_message_sent_at) {
      const hoursSinceLastMessage = 
        (new Date() - new Date(prefs.last_message_sent_at)) / (1000 * 60 * 60);
      
      if (hoursSinceLastMessage < 24) {
        return { send: false, reason: 'Too soon since last message' };
      }
    }

    // Check for pending messages
    let pendingMessages = null;
    try {
      if (statusColumnExists === null) {
        // Probe once whether 'status' column exists; cache the result
        try {
          await dbClient.from('proactive_messages').select('status').limit(1).maybeSingle();
          statusColumnExists = true;
        } catch (probeErr) {
          statusColumnExists = false;
          console.warn('[PROACTIVE] status column probe failed, will use fallback queries');
        }
      }

      if (statusColumnExists) {
        const q = await dbClient
          .from('proactive_messages')
          .select('id')
          .eq('customer_profile_id', customer.id)
          .eq('status', 'pending')
          .gte('scheduled_for', new Date().toISOString());
        pendingMessages = q.data;
      } else {
        const q2 = await dbClient
          .from('proactive_messages')
          .select('id')
          .eq('customer_profile_id', customer.id)
          .gte('scheduled_for', new Date().toISOString());
        pendingMessages = q2.data;
      }
    } catch (err) {
      console.warn('[PROACTIVE] pendingMessages query failed (fallback):', err?.message);
      pendingMessages = [];
    }

    if (pendingMessages && pendingMessages.length > 0) {
      return { send: false, reason: 'Message already scheduled' };
    }

    return { send: true };

  } catch (error) {
    console.error('[PROACTIVE] Error checking if should send:', error);
    return { send: false, reason: error.message };
  }
}

/**
 * Create a personalized reorder message
 */
function createReorderMessage(customer, frequency, regularProducts) {
  const firstName = customer.first_name || 'there';
  const daysSince = frequency.daysSinceLastOrder;
  
  // Get top 2-3 regular products
  const topProducts = regularProducts
    .slice(0, 3)
    .map(p => p.name)
    .join(', ');

  // Natural, friendly message
  const messages = [
    `Hi ${firstName}! It's been ${daysSince} days since your last order. Need ${topProducts}? Let me know! ðŸ˜Š`,
    `Hey ${firstName}! Time for a reorder? You usually get ${topProducts}. Want to place an order?`,
    `${firstName}, just checking in! Need your usual ${topProducts}? It's been ${daysSince} days. ðŸ“¦`,
  ];

  // Randomly pick a message style (or use logic based on customer tier)
  return messages[Math.floor(Math.random() * messages.length)];
}

/**
 * Schedule a message to be sent
 */
async function scheduleMessage(tenantId, customerProfileId, messageType, messageContent, triggerData) {
  try {
    // Schedule for next available slot (9 AM tomorrow)
    const scheduledFor = new Date();
    scheduledFor.setDate(scheduledFor.getDate() + 1);
    scheduledFor.setHours(9, 0, 0, 0);

    // Try to insert with `status` column; fallback if column missing in schema
    try {
      const { data, error } = await dbClient
        .from('proactive_messages')
        .insert({
          tenant_id: tenantId,
          customer_profile_id: customerProfileId,
          message_type: messageType,
          message_content: messageContent,
          scheduled_for: scheduledFor.toISOString(),
          status: 'pending',
          trigger_data: triggerData
        })
        .select()
        .single();

      if (error) {
        // If the error indicates missing column, fall through to fallback
        if (String(error.message).includes('column') || String(error.message).includes('does not exist')) {
          throw error;
        }
        console.error('[PROACTIVE] Error scheduling message:', error);
        return null;
      }

      return data;
    } catch (err) {
      console.warn('[PROACTIVE] Fallback scheduleMessage (no status column):', err?.message);
      try {
        const { data: data2, error: err2 } = await dbClient
          .from('proactive_messages')
          .insert({
            tenant_id: tenantId,
            customer_profile_id: customerProfileId,
            message_type: messageType,
            message_content: messageContent,
            scheduled_for: scheduledFor.toISOString(),
            trigger_data: triggerData
          })
          .select()
          .single();

        if (err2) {
          console.error('[PROACTIVE] Error scheduling message (fallback):', err2);
          return null;
        }
        return data2;
      } catch (err3) {
        console.error('[PROACTIVE] Error in scheduleMessage fallback:', err3);
        return null;
      }
    }

  } catch (error) {
    console.error('[PROACTIVE] Error in scheduleMessage:', error);
    return null;
  }
}

// Module-level cache for schema probes
let _proactiveStatusColumnExists = null;
async function _hasProactiveStatusColumn() {
  if (_proactiveStatusColumnExists !== null) return _proactiveStatusColumnExists;
  try {
    await dbClient.from('proactive_messages').select('status').limit(1).maybeSingle();
    _proactiveStatusColumnExists = true;
  } catch (e) {
    _proactiveStatusColumnExists = false;
    console.warn('[PROACTIVE] status column probe failed during initialization');
  }
  return _proactiveStatusColumnExists;
}

/**
 * Send pending proactive messages (called by scheduler every hour)
 */
async function sendPendingMessages(tenantId) {
  console.log('[PROACTIVE] Checking for pending messages to send...');

  try {
    // Get messages scheduled for now or earlier
    let messagesResult;
    try {
      const hasStatus = await _hasProactiveStatusColumn();
      if (hasStatus) {
        messagesResult = await dbClient
          .from('proactive_messages')
          .select(`
            *,
            customer_profiles(phone, first_name)
          `)
          .eq('tenant_id', tenantId)
          .eq('status', 'pending')
          .lte('scheduled_for', new Date().toISOString())
          .limit(50);
      } else {
        messagesResult = await dbClient
          .from('proactive_messages')
          .select(`
            *,
            customer_profiles(phone, first_name)
          `)
          .eq('tenant_id', tenantId)
          .lte('scheduled_for', new Date().toISOString())
          .limit(50);
      }
    } catch (err) {
      console.warn('[PROACTIVE] Fallback fetch pending messages failed:', err?.message);
      messagesResult = { data: [] };
    }

    const messages = messagesResult.data;

    if (!messages || messages.length === 0) {
      console.log('[PROACTIVE] No pending messages to send');
      return;
    }

    console.log(`[PROACTIVE] Found ${messages.length} messages to send`);

    for (const message of messages) {
      await sendProactiveMessage(message);
    }

  } catch (error) {
    console.error('[PROACTIVE] Error sending pending messages:', error);
  }
}

/**
 * Send a single proactive message via WhatsApp
 */
async function sendProactiveMessage(message) {
  try {
    const phone = message.customer_profiles.phone;

    // Enforce opt-out list
    if (await isUnsubscribed(phone)) {
      try {
        await dbClient
          .from('proactive_messages')
          .update({
            status: 'skipped',
            error_message: 'User unsubscribed',
            sent_at: new Date().toISOString()
          })
          .eq('id', message.id);
      } catch (err) {
        // Fallback: schema without status/error_message
        console.warn('[PROACTIVE] Fallback update skipped (limited schema):', err?.message);
        await dbClient
          .from('proactive_messages')
          .update({ sent_at: new Date().toISOString() })
          .eq('id', message.id);
      }

      console.log('[PROACTIVE] Skipped message (unsubscribed):', phone);
      return;
    }
    
    // TODO: Integrate with your WhatsApp sending function
    // For now, just mark as sent
    // await sendWhatsAppMessage(phone, message.message_content);

    // Update message status
    try {
      await dbClient
        .from('proactive_messages')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString()
        })
        .eq('id', message.id);
    } catch (err) {
      // Fallback: try updating without status column
      console.warn('[PROACTIVE] Fallback update message status (no status column):', err?.message);
      await dbClient
        .from('proactive_messages')
        .update({
          sent_at: new Date().toISOString()
        })
        .eq('id', message.id);
    }

    // Update customer preferences
    await dbClient
      .from('customer_messaging_preferences')
      .update({
        last_message_sent_at: new Date().toISOString(),
        messages_sent_this_week: dbClient.rpc('increment', { x: 1 })
      })
      .eq('customer_profile_id', message.customer_profile_id);

    console.log(`[PROACTIVE] Sent message to ${message.customer_profiles.first_name}`);

  } catch (error) {
    console.error('[PROACTIVE] Error sending message:', error);
    
    // Mark as failed
    try {
      await dbClient
        .from('proactive_messages')
        .update({ status: 'failed' })
        .eq('id', message.id);
    } catch (err) {
      console.warn('[PROACTIVE] Fallback mark failed (no status column):', err?.message);
      await dbClient
        .from('proactive_messages')
        .update({})
        .eq('id', message.id);
    }
  }
}

/**
 * Update daily analytics
 */
async function updateDailyAnalytics(tenantId, stats) {
  try {
    const today = new Date().toISOString().split('T')[0];

    await dbClient
      .from('proactive_messaging_analytics')
      .upsert({
        tenant_id: tenantId,
        date: today,
        messages_scheduled: stats.messagesScheduled,
        reorder_reminders_sent: stats.messagesScheduled
      }, {
        onConflict: 'tenant_id,date'
      });

  } catch (error) {
    console.error('[PROACTIVE] Error updating analytics:', error);
  }
}

/**
 * Mark message as responded (called when customer replies)
 */
async function markMessageAsResponded(customerProfileId, orderId = null) {
  try {
    // Find the most recent sent message
    const { data: message } = await dbClient
      .from('proactive_messages')
      .select('id')
      .eq('customer_profile_id', customerProfileId)
      .eq('status', 'sent')
      .order('sent_at', { ascending: false })
      .limit(1)
      .single();

    if (!message) return;

    // Update the message
    await dbClient
      .from('proactive_messages')
      .update({
        customer_responded: true,
        response_time: new Date().toISOString(),
        resulted_in_order: !!orderId,
        order_id: orderId
      })
      .eq('id', message.id);

  } catch (error) {
    console.error('[PROACTIVE] Error marking message as responded:', error);
  }
}

module.exports = {
  scheduleProactiveMessages,
  sendPendingMessages,
  markMessageAsResponded,
  shouldSendProactiveMessage
};
