// services/segments.js
// Tiny, additive matcher used by webhook flow to tag conversations/leads.

function matchesRule(convoOrLead = {}, rule = {}) {
  // lead_score rules
  if (rule.lead_score) {
    const v = Number(convoOrLead.lead_score ?? 0);
    if (rule.lead_score.gte != null && v < Number(rule.lead_score.gte)) return false;
    if (rule.lead_score.lte != null && v > Number(rule.lead_score.lte)) return false;
  }

  // follow-up due rule (lte: "now")
  if (rule.next_followup_due && rule.next_followup_due.lte === 'now') {
    const dueAt = new Date(convoOrLead.next_followup_at || 0).getTime();
    if (!dueAt || dueAt > Date.now()) return false;
  }

  return true;
}

// Optional helper: return array of matched segment names
function matchSegments(convoOrLead = {}, segments = []) {
  const matched = [];
  for (const seg of segments) {
    if (matchesRule(convoOrLead, seg.rule || {})) matched.push(seg.name || seg.id);
  }
  return matched;
}

module.exports = { matchesRule, matchSegments };

