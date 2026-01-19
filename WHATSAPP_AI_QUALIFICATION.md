# WhatsApp AI Lead Qualification - Complete Guide

## 🎯 Overview

Your WhatsApp integration now uses **AI-powered lead qualification** to automatically analyze message content and assign appropriate heat levels (COLD, WARM, HOT, ON_FIRE) and scores (0-100).

## ✅ What's Integrated

### 1. AI Message Analysis
Every WhatsApp message is analyzed in real-time using natural language processing to detect:

- **Purchase Intent** - Keywords like "buy", "order", "purchase", "price"
- **Urgency Signals** - Keywords like "urgent", "asap", "today", "now"
- **Premium Indicators** - Keywords like "bulk", "wholesale", "business", "corporate"
- **Research Intent** - Keywords like "details", "information", "available"
- **Engagement Level** - Question marks, message length, word count

### 2. Smart Heat Classification

Leads are automatically classified into 4 heat levels:

| Heat Level | Score Range | Description | Examples |
|------------|-------------|-------------|----------|
| **ON_FIRE** 🔥 | 80-100 | Urgent purchase intent | "Need urgent bulk order asap", "Want to buy now, send price" |
| **HOT** 🌶️ | 60-79 | Strong interest | "Interested in your product, what's the cost?", "Please send quote" |
| **WARM** ☀️ | 40-59 | General inquiry | "Looking for information", "Is this available?" |
| **COLD** ❄️ | 0-39 | Minimal engagement | "Hi", "ok", one-word responses |

### 3. Heat Escalation Logic

**Smart Behavior:**
- ✅ Leads can get **hotter** with each message (COLD → WARM → HOT → ON_FIRE)
- ❌ Leads **never cool down** automatically (protects hot leads)
- 📊 Score uses weighted blending (70% existing, 30% new analysis)
- 🎯 Prevents wild swings while allowing upward trends

**Example:**
```
Customer sends: "Hi" → COLD (score: 25)
Customer sends: "I want to buy in bulk" → HOT (score: 70) ⬆️
Customer sends: "Need urgent delivery today" → ON_FIRE (score: 85) ⬆️
```

## 📊 AI Scoring Factors

### High Intent Keywords (+40 points for 2+ matches)
```
buy, purchase, order, price, cost, quote, quotation
invoice, payment, pay, book, reserve, confirm
interested, want, need, require, urgent, asap
immediately, today, now, ready
```

### Warm Intent Keywords (+20 points for 2+ matches)
```
details, information, info, tell me, looking for
available, availability, stock, delivery, shipping
specifications, features, options, variants
```

### Urgency Indicators (+15 points)
```
urgent, asap, immediately, today, now, emergency
right now, as soon as possible, quick, fast
```

### Premium/High-Value Indicators (+20 points)
```
bulk, wholesale, business, company, corporate
large order, multiple, quantity, dealer, distributor
```

### Engagement Factors
- **Multiple Questions** (+5 points) - Shows active interest
- **Detailed Message** (+10 points for 20+ words) - Serious inquiry
- **Very Short** (-10 points for <5 words) - Low engagement

## 🔍 How It Works

### Message Processing Flow

```
1. WhatsApp Message Received
   ↓
2. AI Analysis Engine
   - Scan for high-intent keywords
   - Check urgency indicators
   - Detect premium signals
   - Analyze message length & questions
   ↓
3. Score Calculation (0-100)
   - Base score: 30
   - Add/subtract based on factors
   - Cap at 100, floor at 0
   ↓
4. Heat Classification
   - 80-100 → ON_FIRE
   - 60-79  → HOT
   - 40-59  → WARM
   - 0-39   → COLD
   ↓
5. Lead Creation/Update
   - New lead → Set heat & score
   - Existing lead → Escalate if hotter
   ↓
6. Auto-Assignment
   - Salesman WhatsApp → Assign to salesman
   - Central bot → Manual/auto-triage
```

### Example Analysis

**Message:** "Need urgent quote for bulk order. Want to purchase 500 units asap."

**AI Analysis:**
```json
{
  "heat": "ON_FIRE",
  "score": 95,
  "intent": "purchase",
  "urgency": "critical",
  "analysis": {
    "highIntentMatches": 4,    // quote, bulk, order, purchase
    "urgentMatches": 2,         // urgent, asap
    "premiumMatches": 1,        // bulk
    "questionCount": 0,
    "wordCount": 12
  }
}
```

**Calculation:**
- Base: 30
- High intent (4 matches): +40
- Urgency (2 matches): +15
- Premium (1 match): +20
- Message length (12 words): 0
- **Total: 95 → ON_FIRE** 🔥

## 📈 Lead Lifecycle Example

### Scenario: Customer Journey

**Day 1 - Initial Contact**
```
Customer: "Hi, I need some information"
AI Analysis: WARM (score: 45)
- warmIntentMatches: 2 (need, information)
- Low urgency
```

**Day 2 - Shows Interest**
```
Customer: "What's the price for bulk order?"
AI Re-analysis: HOT (score: 65)
- highIntentMatches: 2 (price, order)
- premiumMatches: 1 (bulk)
- Heat escalated: WARM → HOT ⬆️
```

**Day 3 - Ready to Buy**
```
Customer: "I want to purchase now. Send invoice asap"
AI Re-analysis: ON_FIRE (score: 85)
- highIntentMatches: 3 (purchase, invoice, now)
- urgentMatches: 1 (asap)
- Heat escalated: HOT → ON_FIRE ⬆️
```

## 🎛️ Integration Points

### 1. Lead Auto-Creation Service
**File:** `services/leadAutoCreateService.js`

**Function:** `analyzeLeadQuality(messageBody)`
```javascript
// Returns:
{
  heat: 'ON_FIRE' | 'HOT' | 'WARM' | 'COLD',
  score: 0-100,
  intent: 'purchase' | 'inquiry' | 'unknown',
  urgency: 'critical' | 'high' | 'low',
  analysis: {
    highIntentMatches: number,
    warmIntentMatches: number,
    urgentMatches: number,
    premiumMatches: number,
    questionCount: number,
    wordCount: number
  }
}
```

### 2. Webhook Integration
**File:** `routes/webhook.js`

WhatsApp messages automatically trigger AI analysis:
```javascript
const leadResult = await createLeadFromWhatsApp({
  tenantId,
  phone,
  messageBody,  // ← Analyzed by AI
  salesmanId,
  sessionName
});
```

### 3. Event Logging
All AI decisions are logged to `crm_lead_events`:
```javascript
{
  event_type: 'LEAD_CREATED',
  event_payload: {
    source: 'whatsapp_auto',
    ai_qualification: {
      heat: 'HOT',
      score: 70,
      intent: 'purchase',
      urgency: 'high',
      analysis: { ... }
    },
    initial_message: "I want to buy..."
  }
}
```

## 🔧 Customization

### Add Custom Keywords

Edit `services/leadAutoCreateService.js`:

```javascript
// Add your industry-specific keywords
const highIntentKeywords = [
    'buy', 'purchase', 'order',
    // Add your keywords:
    'contract', 'agreement', 'sign up'
];

const premiumKeywords = [
    'bulk', 'wholesale', 'business',
    // Add your keywords:
    'enterprise', 'subscription', 'annual'
];
```

### Adjust Score Weights

```javascript
// Current weights (you can modify):
if (highIntentCount >= 2) {
    score += 40;  // ← Adjust this
}

if (urgentCount > 0) {
    score += 15;  // ← Adjust this
}
```

### Change Heat Thresholds

```javascript
// Current thresholds:
if (score >= 80) heat = 'ON_FIRE';      // ← 80-100
else if (score >= 60) heat = 'HOT';     // ← 60-79
else if (score >= 40) heat = 'WARM';    // ← 40-59
else heat = 'COLD';                      // ← 0-39
```

## 📊 Monitoring & Analytics

### View AI Decisions in Database

**Check Lead Scores:**
```sql
SELECT id, phone, name, heat, score, channel, created_at
FROM crm_leads
WHERE channel = 'WHATSAPP'
ORDER BY score DESC;
```

**View AI Analysis History:**
```sql
SELECT 
  l.phone,
  l.heat,
  l.score,
  e.event_type,
  e.event_payload->>'ai_qualification' as ai_analysis,
  e.created_at
FROM crm_leads l
JOIN crm_lead_events e ON e.lead_id = l.id
WHERE l.channel = 'WHATSAPP'
  AND e.event_type IN ('LEAD_CREATED', 'HEAT_CHANGED')
ORDER BY e.created_at DESC;
```

**Heat Distribution:**
```sql
SELECT 
  heat,
  COUNT(*) as count,
  AVG(score) as avg_score
FROM crm_leads
WHERE channel = 'WHATSAPP'
GROUP BY heat
ORDER BY avg_score DESC;
```

## 🎯 Best Practices

### For Sales Teams

1. **Prioritize by Heat**
   - ON_FIRE leads → Respond within 5 minutes
   - HOT leads → Respond within 30 minutes
   - WARM leads → Respond within 2 hours
   - COLD leads → Respond within 24 hours

2. **Monitor Heat Changes**
   - Watch for leads escalating to HOT/ON_FIRE
   - Set alerts for heat level changes
   - Celebrate when COLD → HOT!

3. **Use AI Insights**
   - Check `ai_qualification` in lead events
   - Understand WHY a lead is hot
   - Tailor your response to their intent

### For Admins

1. **Review Accuracy Weekly**
   - Check if AI classifications match reality
   - Adjust keywords/weights if needed
   - Collect feedback from sales team

2. **Monitor Score Distribution**
   - Most leads should be WARM (40-59)
   - Too many HOT? Keywords too broad
   - Too many COLD? Keywords too strict

3. **A/B Testing**
   - Try different keyword sets
   - Compare conversion rates by heat
   - Optimize for your industry

## 🚀 Next Steps

### Enhanced AI Features (Available)

Your system also has advanced AI intelligence:

1. **AI Lead Scoring Service** (`services/ai-intelligence-service.js`)
   - Multi-dimensional scoring
   - Deal value analysis
   - Stage progress tracking
   - Activity recency scoring

2. **Churn Prediction**
   - Identify at-risk customers
   - Generate prevention strategies

3. **Next-Best-Action Recommendations**
   - AI suggests optimal follow-up actions
   - Success probability estimates

**To Integrate:** Call AI Intelligence API after lead creation for even deeper analysis.

### Future Enhancements

1. **Machine Learning**
   - Train model on conversion data
   - Learn from successful patterns
   - Auto-adjust weights

2. **Sentiment Analysis**
   - Detect customer emotion
   - Flag frustrated customers
   - Celebrate excited prospects

3. **Conversation Context**
   - Multi-message analysis
   - Track conversation flow
   - Detect buying signals over time

## 📞 Support

**AI Not Working?**
1. Check PM2 logs: `pm2 logs salesmate-ai | grep LEAD_AUTO_CREATE`
2. Verify webhook receives `messageBody`
3. Test with sample message:
   ```javascript
   analyzeLeadQuality("I want to buy bulk order urgently")
   // Should return: { heat: 'ON_FIRE', score: 85+ }
   ```

**Need Help?**
- Review event logs in `crm_lead_events`
- Check webhook processing in PM2 logs
- Test AI function directly in Node.js console

---

## ✅ Summary

✅ **AI-Powered:** Every WhatsApp message analyzed by AI  
✅ **Smart Classification:** Automatic heat assignment (COLD/WARM/HOT/ON_FIRE)  
✅ **Dynamic Scoring:** 0-100 score based on multiple factors  
✅ **Heat Escalation:** Leads get hotter with engagement  
✅ **Event Logging:** Full audit trail of AI decisions  
✅ **Production Ready:** Deployed and active on salesmate.saksolution.com  

**Your leads are now intelligently qualified! 🎉**
