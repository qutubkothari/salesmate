// services/debug.js  (ADD NEW FILE)
const on = k => process.env[k] === '1';
const mask = v => (v ? (String(v).slice(0,6) + '…' + String(v).slice(-4)) : '');

function envSummary() {
  if (!on('DEBUG_CONFIG')) return;
  try {
    console.log('[ENV] OPENAI_PROJECT =', process.env.OPENAI_PROJECT || '(unset)');
    console.log('[ENV] OPENAI_API_KEY =', mask(process.env.OPENAI_API_KEY || ''));
    console.log('[ENV] AI_MODEL_FAST  =', process.env.AI_MODEL_FAST || '(unset)');
    console.log('[ENV] AI_MODEL_SMART =', process.env.AI_MODEL_SMART || '(unset)');
    console.log('[ENV] GCS_BUCKET     =', process.env.GCS_BUCKET_NAME || process.env.GCS_BUCKET || process.env.GOOGLE_CLOUD_STORAGE_BUCKET || '(unset)');
  } catch (e) { console.error('[ENV] summary error', e?.message || e); }
}

function rid() { return (Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7)).toUpperCase(); }
function traceStart(id, label, meta) { if (on('DEBUG_WEBHOOK')) console.log(`[T][${id}] ${label} START`, meta || ''); }
function traceEnd(id, label, meta)   { if (on('DEBUG_WEBHOOK')) console.log(`[T][${id}] ${label} END`, meta || ''); }
function trace(id, label, meta)       { if (on('DEBUG_WEBHOOK')) console.log(`[T][${id}] ${label}`, meta || ''); }
function traceErr(id, label, err)     { console.error(`[T][${id}] ${label} ERROR`, err?.response?.data || err?.message || err); }

function log(message, data = null) {
    if (on('DEBUG_WEBHOOK')) {
        const timestamp = new Date().toISOString();
        const logEntry = `[DEBUG ${timestamp}] ${message}`;
        
        if (data) {
            console.log(logEntry, data);
        } else {
            console.log(logEntry);
        }
    }
}

module.exports = { on, mask, envSummary, rid, traceStart, traceEnd, trace, traceErr, log };
