// routes/middleware/tenantResolver.js
const { dbClient } = require('../../services/config');
const { findOrCreateTenant } = require('../../services/tenantService');
const debug = require('../../services/debug');

/**
 * Middleware to resolve the tenant based on the bot phone number
 * Handles auto-provisioning of new tenants and special registration flow
 */
const tenantResolver = async (req, res, next) => {
  const rid = req._rid;
  const { message } = req;
  
  if (!message) {
    return next();
  }

  const from = message.from;
  const to = message.to;

  try {
    debug.trace(rid, 'tenant.lookup.start', { bot: to });

    let { data: botOwner, error } = await dbClient
      .from('tenants')
      .select('*')
      .eq('bot_phone_number', to)
      .single();

    debug.trace(rid, 'tenant.lookup.done', { 
      found: !!botOwner, 
      tenantId: botOwner?.id, 
      bot: botOwner?.bot_phone_number 
    });

    // Handle tenant not found (new registration)
    if (error && error.code === 'PGRST116') {
      console.log(`No tenant found for bot number ${to}. Attempting to register new tenant from ${from}.`);
      
      // Try auto-provisioning first
      try {
        const { ensureTenantByBot } = require('../../services/tenantService');
        const created = await ensureTenantByBot(to);
        
        if (created?.id) {
          console.log('[TENANT] Auto-provisioned', created.id, 'for', to);
          
          // Re-query to get the full tenant object
          const recheck = await dbClient
            .from('tenants')
            .select('*')
            .eq('bot_phone_number', to)
            .single();
            
          if (recheck?.data) {
            botOwner = recheck.data;
          }
        }
      } catch (e) {
        console.error('[TENANT] Auto-provision failed', e?.message || e);
      }

      // If auto-provision failed, try the legacy registration method
      if (!botOwner) {
        try {
          botOwner = await findOrCreateTenant(from, to);
          console.log('[TENANT] Legacy registration completed for', botOwner?.id);
          
          // For new tenant registration, handle their first message as a tenant message
          if (botOwner && message.type === 'text') {
            // Store tenant in request
            req.tenant = botOwner;
            req.isAdmin = true; // New registrant is automatically admin
            
            const { handleTenant } = require('../handlers/adminHandler');
            await handleTenant(req, res);
            return; // Exit early after handling registration message
          }
          
        } catch (registrationError) {
          console.error('[TENANT] Registration failed:', registrationError);
          return res.status(404).json({ 
            ok: false, 
            error: 'Bot not configured and registration failed' 
          });
        }
      }
    } else if (error) {
      // Handle other unexpected database errors
      console.error('[TENANT] Database error:', error);
      return res.status(500).json({ 
        ok: false, 
        error: 'Database error during tenant lookup' 
      });
    }

    if (!botOwner) {
      return res.status(404).json({ 
        ok: false, 
        error: 'Bot not configured' 
      });
    }

    // Store tenant in request for downstream handlers
    req.tenant = botOwner;
    
    debug.trace(rid, 'tenant.resolved', { 
      tenantId: botOwner.id,
      businessName: botOwner.business_name || 'Unknown',
      ownerPhone: botOwner.owner_whatsapp_number
    });

    next();

  } catch (error) {
    debug.traceErr(rid, 'tenant.resolver', error);
    console.error('[TENANT_RESOLVER] Unexpected error:', error);
    return res.status(500).json({ 
      ok: false, 
      error: 'Internal error during tenant resolution',
      details: error.message 
    });
  }
};

module.exports = tenantResolver;
