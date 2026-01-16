const { dbClient } = require('./config');

function toDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function unique(arr) {
  return [...new Set(arr.filter(Boolean))];
}

/**
 * Build candidate keys for matching unsubscribes.
 * Handles common India normalization where 10-digit numbers may be stored without '91'.
 */
function unsubscribeCandidates(phoneNumber) {
  const digits = toDigits(phoneNumber);
  if (!digits) return [];

  const candidates = [digits];

  if (digits.length === 10) {
    candidates.push('91' + digits);
  }

  if (digits.length === 12 && digits.startsWith('91')) {
    candidates.push(digits.slice(2));
  }

  return unique(candidates);
}

async function getUnsubscribedSet(phoneNumbers, chunkSize = 500) {
  const allCandidates = unique(phoneNumbers.flatMap(unsubscribeCandidates));
  if (allCandidates.length === 0) return new Set();

  const found = new Set();

  for (let i = 0; i < allCandidates.length; i += chunkSize) {
    const batch = allCandidates.slice(i, i + chunkSize);
    const { data, error } = await dbClient
      .from('unsubscribed_users')
      .select('phone_number')
      .in('phone_number', batch);

    if (error) throw error;

    for (const row of data || []) {
      if (row?.phone_number) found.add(String(row.phone_number));
    }
  }

  return found;
}

async function isUnsubscribed(phoneNumber) {
  const candidates = unsubscribeCandidates(phoneNumber);
  if (candidates.length === 0) return false;

  const { data, error } = await dbClient
    .from('unsubscribed_users')
    .select('phone_number')
    .in('phone_number', candidates)
    .limit(1);

  // In local wrapper, errors return { data: null, error }.
  if (error) return false;

  return Array.isArray(data) && data.length > 0;
}

async function filterUnsubscribed(phoneNumbers) {
  const unsubscribed = await getUnsubscribedSet(phoneNumbers);

  const allowed = [];
  const skipped = [];

  for (const phone of phoneNumbers) {
    const candidates = unsubscribeCandidates(phone);
    const isOut = candidates.some((c) => unsubscribed.has(c));
    if (isOut) skipped.push(phone);
    else allowed.push(phone);
  }

  return { allowed, skipped, unsubscribedSet: unsubscribed };
}

/**
 * Canonical storage format for opt-out list: digits-only, defaulting 10-digit to India (91).
 */
function canonicalUnsubscribeKey(phoneNumber) {
  const digits = toDigits(phoneNumber);
  if (!digits) return null;
  if (digits.length === 10) return '91' + digits;
  return digits;
}

module.exports = {
  toDigits,
  unsubscribeCandidates,
  canonicalUnsubscribeKey,
  getUnsubscribedSet,
  isUnsubscribed,
  filterUnsubscribed,
};

