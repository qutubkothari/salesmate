// middleware/requireTenant.js
const { dbClient } = require('../services/config');
const whatsappService = require('../services/whatsappService');
const { ensureTenantByBot } = require('../services/tenantService');
const { activateSubscription } = require('../services/subscriptionService');

module.exports = async function requireTenant(req, res, next) {
  const msg = req.message || req.body || {};
  const from = msg.from;
  const toDigits = String(msg.to || '').replace(/\D+/g, '');
  const rawText = (msg.text?.body || '').trim();
  const txt = rawText.toLowerCase();

  // 1) try existing tenant by bot number
  let tenant = null;
  try {
    const { data, error } = await dbClient
      .from('tenants')
      .select('*')
      .eq('bot_phone_number', toDigits)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    tenant = data || null;
  } catch (e) {
    console.error('[requireTenant.select]', e);
  }

  // 2) bootstrap path (/register or /activate) if not found
  if (!tenant && (txt.startsWith('/register') || txt.startsWith('/activate'))) {
    try {
      // ensure row by bot; this can throw on duplicate owner unique constraint
      let ensured;
      try {
        ensured = await ensureTenantByBot(toDigits); // must return { id }
      } catch (e) {
        // duplicate owner? reuse that tenant and attach the current bot
        if (e && (e.code === '23505' || /duplicate key value/i.test(String(e)))) {
          const { data: existing, error: selErr } = await dbClient
            .from('tenants')
            .select('id,business_name,admin_phones')
            .eq('owner_whatsapp_number', from)
            .limit(1)
            .maybeSingle();
          if (selErr || !existing) throw selErr || new Error('owner-dup-select-failed');

          const admins = Array.isArray(existing.admin_phones) ? existing.admin_phones.slice(0, 50) : [];
          if (!admins.includes(from)) admins.push(from);

          const { error: updErr } = await dbClient
            .from('tenants')
            .update({
              bot_phone_number: toDigits,
              maytapi_phone_id: msg.phone_id ?? null,
              admin_phones: admins
            })
            .eq('id', existing.id);
          if (updErr) throw updErr;

          tenant = existing;
        } else {
          throw e;
        }
      }

      if (!tenant && ensured?.id) {
        // set basics if came from /register
        if (txt.startsWith('/register')) {
          const name = rawText.split(/\s+/).slice(1).join(' ').trim() || 'My Business';
          await dbClient.from('tenants')
            .update({
              business_name: name,
              owner_whatsapp_number: from,
              admin_phones: [from],
              bot_phone_number: toDigits,
              maytapi_phone_id: msg.phone_id ?? null
            })
            .eq('id', ensured.id);
          await whatsappService.sendText(from, `âœ… Registered *${name}*. You can now use /status, /login, /products, /broadcast here.`);
        }
        tenant = { id: ensured.id };
      }

      // if it was /activate, run activation now
      if (tenant && txt.startsWith('/activate')) {
        const key = rawText.split(/\s+/).slice(1).join('').trim();
        if (!key) {
          await whatsappService.sendText(from, 'Please send: /activate YOUR-KEY');
          return res.status(200).json({ ok: true, bootstrap: 'activate-missing-key' });
        }
        const result = await activateSubscription(tenant.id, key);
        await whatsappService.sendText(from, result.message || 'Activated.');
        return res.status(200).json({ ok: true, bootstrap: 'activated', success: !!result.success });
      }
    } catch (e) {
      console.error('[requireTenant.bootstrap]', e);
      await whatsappService.sendText(from, 'Something went wrong during registration. Please try again.');
      return res.status(200).json({ ok: false, error: 'register-exception' });
    }
  }

  if (!tenant) {
    // not a bootstrap command; keep response 200 to avoid retries
    return res.status(200).json({ ok: false, error: 'bot-not-configured' });
  }

  // attach for downstream handlers
  req.tenant = tenant;
  return next();
};

