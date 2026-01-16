const crypto = require('crypto');
const { dbClient } = require('./config');

function extractUrls(message) {
  if (!message || typeof message !== 'string') return [];
  // Basic URL matcher (http/https). Avoid trailing punctuation.
  const regex = /https?:\/\/[\w\-._~:/?#[\]@!$&'()*+,;=%]+/gi;
  const found = message.match(regex) || [];
  const cleaned = found
    .map((u) => String(u).replace(/[)\].,!?;:]+$/g, ''))
    .filter(Boolean);
  return [...new Set(cleaned)];
}

function generateCode() {
  // 10 chars url-safe
  return crypto.randomBytes(8).toString('base64url');
}

async function createTrackedLinksAndRewriteMessage({ tenantId, campaignId, message, baseUrl }) {
  if (!tenantId || !campaignId || !message || !baseUrl) {
    return { message: message || '', linksCreated: 0 };
  }

  const urls = extractUrls(message);
  if (!urls.length) return { message, linksCreated: 0 };

  const urlToCode = new Map();

  // Create one tracked link per unique URL in this message/campaign.
  for (const url of urls) {
    let code = generateCode();

    // Best-effort handle rare collisions
    for (let attempt = 0; attempt < 3; attempt++) {
      const { error } = await dbClient
        .from('tracked_links')
        .insert({
          tenant_id: tenantId,
          campaign_id: campaignId,
          original_url: url,
          short_code: code,
          click_count: 0,
          created_at: new Date().toISOString()
        });

      if (!error) {
        urlToCode.set(url, code);
        break;
      }

      code = generateCode();
    }

    if (!urlToCode.has(url)) {
      // If we couldn't insert, leave URL as-is.
      urlToCode.set(url, null);
    }
  }

  let rewritten = message;
  for (const url of urls) {
    const code = urlToCode.get(url);
    if (!code) continue;
    const tracked = `${String(baseUrl).replace(/\/$/g, '')}/t/${code}`;
    // Replace all occurrences of the exact URL string.
    rewritten = rewritten.split(url).join(tracked);
  }

  const linksCreated = Array.from(urlToCode.values()).filter(Boolean).length;
  return { message: rewritten, linksCreated };
}

module.exports = {
  extractUrls,
  createTrackedLinksAndRewriteMessage
};

