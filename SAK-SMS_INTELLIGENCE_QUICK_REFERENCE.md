# SAK-SMS Intelligence - Quick Reference Card

## 🚀 Quick Start

### 1. Add Your First Salesman
```
Dashboard → Team tab → Add Salesman
Required: Name
Optional: Email, Phone, Max Leads, Skills
```

### 2. Enable Auto-Assignment
```
Default: Already enabled (ROUND_ROBIN strategy)
Config location: assignment_config table
API: GET /api/assignment/:tenantId/config
```

### 3. Test Heat Scoring
```
Send WhatsApp message: "URGENT! Need 50 units TODAY"
Check: Dashboard → Conversations → Should show 🔥 ON_FIRE badge
```

---

## 🎨 Heat Levels

| Level | Emoji | Triggers | Action |
|-------|-------|----------|--------|
| **COLD** | 🔵 | "just looking", "not ready" | Normal priority |
| **WARM** | 🟡 | General inquiries | Standard response |
| **HOT** | 🟠 | "interested", "pricing" | Priority follow-up |
| **VERY_HOT** | 🔴 | "budget approved", "ready" | Immediate attention |
| **ON_FIRE** | 🔥 | "URGENT", "TODAY", "ASAP" | Auto-escalate to triage |

---

## 🎯 Assignment Strategies

| Strategy | How It Works | Best For |
|----------|--------------|----------|
| **ROUND_ROBIN** | Equal distribution, rotates through team | Balanced workload |
| **LEAST_ACTIVE** | Assigns to salesman with fewest active leads | Load balancing |
| **SKILLS_BASED** | Matches product/language skills | Expert routing |
| **GEOGRAPHIC** | Routes by customer location/zone | Territory management |

---

## 📊 Dashboard Tabs

### **Team Tab**
- View all salesmen
- Check workload (active leads)
- Add/Edit/Remove team members
- Set capacity limits & skills

### **Tasks Tab**
- Create follow-up tasks
- View overdue/upcoming/completed
- Set priorities (Low/Medium/High/Urgent)
- Quick complete with ✓ button

### **Calls Tab**
- Log inbound/outbound calls
- Track duration & outcomes
- View complete call history
- Stats: Total calls, total duration

### **Conversations Tab** (Enhanced)
- Heat badges on every conversation
- Filter by heat level
- See assigned salesman
- Auto-updated from messages

---

## 🔧 API Endpoints

### Team Management
```bash
GET    /api/salesmen/:tenantId              # List all salesmen
POST   /api/salesmen/:tenantId              # Add salesman
PUT    /api/salesmen/:tenantId/:id          # Update salesman
DELETE /api/salesmen/:tenantId/:id          # Remove salesman
GET    /api/salesmen/:tenantId/:id/workload # Get workload details
```

### Tasks
```bash
GET    /api/tasks/:tenantId                 # List all tasks
POST   /api/tasks/:tenantId                 # Create task
PUT    /api/tasks/:tenantId/:id             # Update task
POST   /api/tasks/:tenantId/:id/complete    # Complete task
DELETE /api/tasks/:tenantId/:id             # Delete task
```

### Calls
```bash
GET    /api/calls/:tenantId                 # List all calls
POST   /api/calls/:tenantId                 # Log new call
GET    /api/calls/:tenantId/by-lead/:id     # Call history for lead
GET    /api/calls/:tenantId/scheduled-callbacks # Upcoming callbacks
```

### Assignment & Heat
```bash
GET  /api/assignment/:tenantId/config              # Get assignment config
PUT  /api/assignment/:tenantId/config              # Update strategy
POST /api/assignment/:tenantId/assign/:convId      # Manual assign
POST /api/assignment/:tenantId/reassign/:convId    # Reassign
GET  /api/assignment/:tenantId/heat/distribution   # Heat analytics
GET  /api/assignment/:tenantId/heat/:level         # Filter by heat
POST /api/assignment/:tenantId/heat/:convId/analyze # Manual heat analysis
```

---

## 🔍 Database Quick Queries

### Check Heat Distribution
```sql
SELECT heat, COUNT(*) as count 
FROM conversations 
GROUP BY heat;
```

### View Active Salesmen
```sql
SELECT id, name, email, max_leads_per_month 
FROM salesman 
WHERE active = 1;
```

### Find Overdue Tasks
```sql
SELECT title, due_date, priority 
FROM tasks 
WHERE status = 'PENDING' 
  AND due_date < datetime('now')
ORDER BY due_date ASC;
```

### Assignment Performance
```sql
SELECT 
  s.name,
  COUNT(c.id) as active_leads,
  s.max_leads_per_month,
  COUNT(c.id) * 100.0 / s.max_leads_per_month as capacity_used
FROM salesman s
LEFT JOIN conversations c ON c.assigned_to = s.id AND c.state != 'closed'
WHERE s.active = 1
GROUP BY s.id;
```

---

## ⚡ Server Logs to Monitor

### Heat Scoring
```
[HEAT_SCORING] Updated heat: VERY_HOT (confidence: 0.85)
```

### Assignment
```
[AUTO_ASSIGNMENT] ✅ Assigned to: John Doe (ROUND_ROBIN)
```

### Triage Escalation
```
[HEAT_SCORING] Escalated to triage: conversation_id (heat: ON_FIRE)
```

---

## 🐛 Common Issues & Fixes

| Issue | Cause | Solution |
|-------|-------|----------|
| Heat badges not showing | Cache/DB not updated | Clear cache, check `conversations.heat` column |
| Auto-assignment not working | No active salesmen | Add salesman in Team tab |
| Tasks not appearing | Tenant ID mismatch | Verify `state.session.tenantId` |
| API 500 errors | Database schema missing | Run `migrate-add-sak-sms-features.js` |

---

## 📱 How It All Works Together

```
1. Customer sends WhatsApp message
   ↓
2. Message handler saves to database
   ↓
3. Heat scoring analyzes urgency (AI/Keywords)
   ↓
4. If VERY_HOT/ON_FIRE → Add to triage queue
   ↓
5. If new conversation → Auto-assign to salesman
   ↓
6. Dashboard updates with heat badge & assignment
   ↓
7. Salesman sees task/lead in their queue
   ↓
8. Team responds based on priority
```

---

## 🎯 Best Practices

### For Salesmen
- Check "Overdue Tasks" daily
- Log all customer calls immediately
- Update task status after completion
- Monitor assigned leads in dashboard

### For Managers
- Review heat distribution weekly
- Balance workload using LEAST_ACTIVE strategy
- Set realistic capacity limits
- Monitor SLA compliance (future feature)

### For System Admin
- Monitor server logs for errors
- Backup database daily
- Keep AI API keys valid
- Update salesman skills regularly

---

## 🔐 Environment Variables

```bash
# Required for AI Heat Scoring
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=...

# Database (SQLite - auto-configured)
DATABASE_PATH=./salesmate.db

# Assignment Defaults (optional)
DEFAULT_ASSIGNMENT_STRATEGY=ROUND_ROBIN
AUTO_ASSIGN_ENABLED=true
```

---

## 📞 Support & Docs

- **Migration Plan**: `SAK-SMS_TO_SALESMATE_MIGRATION.md`
- **Testing Guide**: `SAK-SMS_INTELLIGENCE_TESTING_GUIDE.md`
- **Feature Analysis**: `SAK-SMS_MISSING_FEATURES_ANALYSIS.md`

---

## ✅ Pre-Deployment Checklist

- [ ] Database migrated (`migrate-add-sak-sms-features.js` executed)
- [ ] At least 1 salesman added
- [ ] Assignment config verified
- [ ] AI API keys configured
- [ ] Heat scoring tested with sample messages
- [ ] Dashboard loads without errors
- [ ] All 3 new tabs accessible
- [ ] Server logs showing [HEAT_SCORING] and [AUTO_ASSIGNMENT]

---

**Version**: 1.0  
**Last Updated**: January 2026  
**Status**: ✅ Production Ready
