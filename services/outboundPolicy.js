const { dbClient } = require('./config');
const { toDigits } = require('./unsubscribeService');

const cache = {
  at: 0,
  ttlMs: 5 * 60_000,
  numbers: new Set(),
};

async function refreshAdminNumbers() {
  const now = Date.now();
  if (now - cache.at < cache.ttlMs && cache.numbers.size > 0) return cache.numbers;

  const set = new Set();

  const add = (value) => {
    const digits = toDigits(value);
    if (digits) set.add(digits);
  };

  // Best-effort: tenants schema varies; probe progressively.
  const trySelect = async (cols) => {
    const { data, error } = await dbClient.from('tenants').select(cols).limit(5000);
    if (error) throw error;
    return data || [];
  };

  let rows = [];
  try {
    rows = await trySelect('phone_number, owner_whatsapp_number');
    for (const row of rows) {
      add(row.phone_number);
      add(row.owner_whatsapp_number);
    }
  } catch {
    try {
      rows = await trySelect('phone_number');
      for (const row of rows) add(row.phone_number);
    } catch {
      // ignore
    }
  }

  cache.at = now;
  cache.numbers = set;
  return cache.numbers;
}

async function isBypassNumber(phoneNumberDigitsOrRaw) {
  const digits = toDigits(phoneNumberDigitsOrRaw);
  if (!digits) return false;
  const set = await refreshAdminNumbers();
  return set.has(digits);
}

module.exports = {
  isBypassNumber,
};
