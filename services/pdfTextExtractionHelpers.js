/**
 * Robust GST certificate parser
 * Input: text (string) extracted from PDF (with line breaks)
 * Output: object { gst_number, legal_name, trade_name, business_address, registration_date, business_state, proprietor_name }
 */
function parseGSTCertificateText(text) {
  if (!text || typeof text !== 'string') return {};

  const clean = (s) => s ? s.replace(/\s+/g,' ').replace(/\s*[:\-]\s*/g,': ').trim() : s;

  // Normalize line breaks for easier regex (preserve some boundaries)
  const norm = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Common GSTIN pattern
  const gstRegex = /([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1})/i;
  let gst_number = null;
  const gstMatch = norm.match(gstRegex);
  if (gstMatch) gst_number = gstMatch[1].toUpperCase();

  // Legal name: look for label "Legal Name" or "Name" before some text
  let legal_name = null;
  const legalPatterns = [
    /Legal Name[:\s\-]*([^\n]{3,120})/i,
    /Name[:\s\-]*([^\n]{3,120})/i,
  ];
  for (const p of legalPatterns) {
    const m = norm.match(p);
    if (m && m[1]) { legal_name = clean(m[1]); break; }
  }
  // Fallback: sometimes "Legal Name" is on one line and actual name next line
  if (!legal_name) {
    const lines = norm.split('\n').map(l => l.trim()).filter(Boolean);
    for (let i = 0; i < lines.length - 1; i++) {
      if (/legal name/i.test(lines[i]) && lines[i+1].length > 3) {
        legal_name = clean(lines[i+1]); break;
      }
      if (/legal name/i.test(lines[i]) && /[:\-]\s*$/i.test(lines[i])) {
        legal_name = clean(lines[i].split(/[:\-]/).slice(1).join(' ').trim() || lines[i+1]); break;
      }
    }
  }

  // Trade name
  let trade_name = null;
  const tradePatterns = [
    /Trade Name[,]?\s*(?:if any)?[:\s\-]*([^\n]{2,120})/i,
    /Trade Name[:\s\-]*([^\n]{2,120})/i
  ];
  for (const p of tradePatterns) {
    const m = norm.match(p);
    if (m && m[1]) { trade_name = clean(m[1]); break; }
  }
  // Fallback similar to legal name
  if (!trade_name) {
    const lines = norm.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (/trade name/i.test(lines[i]) && lines[i+1] && lines[i+1].trim().length > 2) {
        trade_name = clean(lines[i+1]); break;
      }
    }
  }

  // Registration / issue date
  let registration_date = null;
  // Cover variety of date labels: Date of issue, Date of Registration, Date of Validity From, Date of registration
  const datePatterns = [
    /Date of issue of Certificate[:\s\-]*([0-9]{1,2}[\/\-\s][0-9]{1,2}[\/\-\s][0-9]{4})/i,
    /Date of Registration[:\s\-]*([0-9]{1,2}[\/\-\s][0-9]{1,2}[\/\-\s][0-9]{4})/i,
    /Date of Validity From[:\s\-]*([0-9]{1,2}[\/\-\s][0-9]{1,2}[\/\-\s][0-9]{4})/i,
    /Issued on[:\s\-]*([0-9]{1,2}[\/\-\s][0-9]{1,2}[\/\-\s][0-9]{4})/i
  ];
  for (const p of datePatterns) {
    const m = norm.match(p);
    if (m && m[1]) { registration_date = m[1].trim(); break; }
  }
  // fallback: any date-like token near "Date" label
  if (!registration_date) {
    const m = norm.match(/(Date[:\s\-]{0,10})([0-9]{1,2}[\/\-\s][0-9]{1,2}[\/\-\s][0-9]{4})/i);
    if (m && m[2]) registration_date = m[2].trim();
  }

  // Principal place of business / Address: try to capture block after "Address of Principal Place of Business" or "Address"
  let business_address = null;
  const addrLabels = [
    /Address of Principal Place of Business[:\s\-]*([\s\S]{5,400}?)(?=\n\s*\d+\.|\n\n|$)/i,
    /Principal Place of Business[:\s\-]*([\s\S]{5,400}?)(?=\n\s*\d+\.|\n\n|$)/i,
    /Address[:\s\-]*([\s\S]{5,400}?)(?=\n\s*\d+\.|\n\n|$)/i
  ];
  for (const p of addrLabels) {
    const m = norm.match(p);
    if (m && m[1]) {
      business_address = m[1].trim();
      // collapse multiple spaces/newlines
      business_address = business_address.replace(/\n+/g, ', ').replace(/\s+/g, ' ').replace(/,\s*,/g, ',').trim();
      // Remove common prefixes that are field labels, not actual address
      business_address = business_address.replace(/^of\s+Principal\s+Place\s+of,?\s*Business,?\s*/i, '');
      business_address = business_address.replace(/^Principal\s+Place\s+of\s+Business,?\s*/i, '');
      business_address = business_address.replace(/^Address\s+of\s+Principal\s+Place\s+of\s+Business,?\s*/i, '');
      business_address = business_address.trim();
      break;
    }
  }
  // fallback: find line(s) following "Address" or "Principal Place"
  if (!business_address) {
    const lines = norm.split('\n').map(l => l.trim()).filter(Boolean);
    for (let i = 0; i < lines.length; i++) {
      if (/address of principal place/i.test(lines[i]) || /principal place of business/i.test(lines[i]) || /^address\b/i.test(lines[i])) {
        // grab next 2-3 lines concatenated
        const chunk = [lines[i+1]||'', lines[i+2]||'', lines[i+3]||''].join(' ').trim();
        if (chunk.length>10) {
          business_address = chunk.replace(/\s+/g,' ');
          break;
        }
      }
    }
  }

  // State extraction: try to pick last word before pin or the word "Maharashtra" etc.
  let business_state = null;
  if (business_address) {
    const stateMatch = business_address.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b\s*,?\s*\d{6}$/);
    if (stateMatch) business_state = stateMatch[1];
    // fallback search for known state keywords (simple)
    const knownStates = ['Maharashtra','Gujarat','Karnataka','Delhi','Tamil Nadu','West Bengal','Uttar Pradesh','Rajasthan','Bihar'];
    for (const s of knownStates) if (business_address.includes(s)) { business_state = s; break; }
  }

  // Proprietor name: look in Annexure B or "Proprietor" label lines
  let proprietor_name = null;
  const propPattern = /Proprietor[:\s\-]*([^\n]{3,80})/i;
  const mprop = norm.match(propPattern);
  if (mprop && mprop[1]) proprietor_name = clean(mprop[1]);
  // fallback: in Annexure B lines look for "Name                                         JUMMANA HUSAINI  JOGPUR"
  if (!proprietor_name) {
    const annB = norm.split('\n').find(l => /Annexure B/i.test(l));
    if (annB) {
      // Locate lines near Annexure B for a "Name" label
      const idx = norm.indexOf(annB);
      const near = norm.substring(idx, idx + 800);
      const m2 = near.match(/Name\s*[:\s]*([A-Z \.]{3,120})/i);
      if (m2 && m2[1]) proprietor_name = clean(m2[1]);
    }
  }

  return {
    gst_number,
    legal_name: legal_name || null,
    trade_name: trade_name || null,
    business_address: business_address || null,
    registration_date: registration_date || null,
    business_state: business_state || null,
    proprietor_name: proprietor_name || null
  };
}

module.exports = { parseGSTCertificateText };

