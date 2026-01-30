# 🧪 FEATURE TESTING CHECKLIST

## ⚠️ PREREQUISITE: Run Database Migrations First!

**Go to Supabase SQL Editor**: https://supabase.com/dashboard/project/qqjqahrjthxokfshglpr/sql/new

**Copy and run** the entire contents of: `migrations/COMPLETE_MIGRATION.sql`

---

## ✅ Feature 1: Follow-up Analytics Dashboard

### Test URL
https://sak-ai.saksolution.ae/features/followup-analytics.html

### What to Test:
1. **Summary Cards** - Should show:
   - Total follow-ups count
   - Completion rate percentage
   - Overdue count
   - Today's follow-ups

2. **30-Day Trend Chart** - Line chart showing:
   - Scheduled follow-ups (blue line)
   - Completed follow-ups (green line)

3. **Priority Distribution** - Doughnut chart showing:
   - High priority (red)
   - Medium priority (yellow)
   - Low priority (green)

4. **Salesman Performance Table** - Shows:
   - Salesman name
   - Total assigned
   - Completed count
   - Completion rate %
   - Color-coded performance (green ≥80%, yellow ≥60%, red <60%)

### Expected Behavior:
- Dashboard loads without errors
- Charts render properly
- Data is fetched from `/api/followup-analytics/*`
- Tenant authentication works

---

## ✅ Feature 2: Mobile Follow-ups API

### Test Endpoints:

#### 2.1 Get Follow-ups (Categorized)
```bash
curl -X GET 'https://sak-ai.saksolution.ae/api/mobile/followups' \
  -H 'X-Tenant-Id: 112f12b8-55e9-4de8-9fda-d58e37c75796' \
  -H 'Authorization: Bearer <salesman_user_id>' \
  -H 'Content-Type: application/json'
```

**Expected Response:**
```json
{
  "success": true,
  "followups": {
    "overdue": [...],
    "today": [...],
    "upcoming": [...],
    "completed": [...]
  }
}
```

#### 2.2 Create Follow-up
```bash
curl -X POST 'https://sak-ai.saksolution.ae/api/mobile/followups' \
  -H 'X-Tenant-Id: 112f12b8-55e9-4de8-9fda-d58e37c75796' \
  -H 'Authorization: Bearer <salesman_user_id>' \
  -H 'Content-Type: application/json' \
  -d '{
    "customerId": "<customer_uuid>",
    "followUpAt": "2026-02-01T10:00:00Z",
    "followUpType": "call",
    "followUpPriority": "high",
    "followUpNote": "Follow up on quotation"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "conversationId": "...",
  "followUpId": "..."
}
```

#### 2.3 Complete Follow-up
```bash
curl -X PUT 'https://sak-ai.saksolution.ae/api/mobile/followups/<conversation_id>/complete' \
  -H 'X-Tenant-Id: 112f12b8-55e9-4de8-9fda-d58e37c75796' \
  -H 'Authorization: Bearer <salesman_user_id>'
```

---

## ✅ Feature 3: Push Notifications

### Test Endpoints:

#### 3.1 Register Device Token
```bash
curl -X POST 'https://sak-ai.saksolution.ae/api/push/register' \
  -H 'X-Tenant-Id: 112f12b8-55e9-4de8-9fda-d58e37c75796' \
  -H 'Authorization: Bearer <salesman_user_id>' \
  -H 'Content-Type: application/json' \
  -d '{
    "deviceToken": "test_fcm_token_12345",
    "platform": "android"
  }'
```

#### 3.2 Send Test Notification
```bash
curl -X POST 'https://sak-ai.saksolution.ae/api/push/test' \
  -H 'X-Tenant-Id: 112f12b8-55e9-4de8-9fda-d58e37c75796' \
  -H 'Authorization: Bearer <salesman_user_id>'
```

**Note:** Push notifications require Firebase Admin SDK setup (see PUSH_NOTIFICATIONS_SETUP.md)

---

## ✅ Feature 4: Location Tracking

### Test Endpoints:

#### 4.1 Record Location
```bash
curl -X POST 'https://sak-ai.saksolution.ae/api/location/record' \
  -H 'X-Tenant-Id: 112f12b8-55e9-4de8-9fda-d58e37c75796' \
  -H 'Authorization: Bearer <salesman_user_id>' \
  -H 'Content-Type: application/json' \
  -d '{
    "latitude": 25.2048,
    "longitude": 55.2708,
    "accuracy": 10.5
  }'
```

#### 4.2 Check-in at Customer
```bash
curl -X POST 'https://sak-ai.saksolution.ae/api/location/check-in' \
  -H 'X-Tenant-Id: 112f12b8-55e9-4de8-9fda-d58e37c75796' \
  -H 'Authorization: Bearer <salesman_user_id>' \
  -H 'Content-Type: application/json' \
  -d '{
    "customerId": "<customer_uuid>",
    "latitude": 25.2048,
    "longitude": 55.2708,
    "accuracy": 10.5,
    "visitType": "follow_up"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "visitId": "...",
  "checkInTime": "...",
  "distanceFromCustomer": 45.2,
  "geoFenceValid": true
}
```

#### 4.3 Check-out
```bash
curl -X POST 'https://sak-ai.saksolution.ae/api/location/check-out' \
  -H 'X-Tenant-Id: 112f12b8-55e9-4de8-9fda-d58e37c75796' \
  -H 'Authorization: Bearer <salesman_user_id>' \
  -H 'Content-Type: application/json' \
  -d '{
    "visitId": "<visit_uuid>",
    "latitude": 25.2048,
    "longitude": 55.2708,
    "notes": "Discussed new products",
    "outcome": "successful"
  }'
```

#### 4.4 Optimize Route
```bash
curl -X POST 'https://sak-ai.saksolution.ae/api/location/optimize-route' \
  -H 'X-Tenant-Id: 112f12b8-55e9-4de8-9fda-d58e37c75796' \
  -H 'Authorization: Bearer <salesman_user_id>' \
  -H 'Content-Type: application/json' \
  -d '{
    "customerIds": ["uuid1", "uuid2", "uuid3"],
    "startLatitude": 25.2048,
    "startLongitude": 55.2708,
    "routeDate": "2026-01-31"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "optimizedOrder": [...],
  "totalDistanceKm": 15.3,
  "estimatedDurationMinutes": 120,
  "algorithm": "nearest_neighbor"
}
```

---

## ✅ Feature 5: Commission Tracking

### Test Endpoints:

#### 5.1 Get Commission Summary
```bash
curl -X GET 'https://sak-ai.saksolution.ae/api/commission/summary?startDate=2026-01-01&endDate=2026-01-31' \
  -H 'X-Tenant-Id: 112f12b8-55e9-4de8-9fda-d58e37c75796' \
  -H 'Authorization: Bearer <salesman_user_id>'
```

**Expected Response:**
```json
{
  "success": true,
  "summary": {
    "transaction_count": "10",
    "total_sales": "50000.00",
    "total_commission": "2500.00",
    "avg_commission_rate": "5.00",
    "pending_commission": "1500.00",
    "paid_commission": "1000.00"
  }
}
```

#### 5.2 Get Transactions
```bash
curl -X GET 'https://sak-ai.saksolution.ae/api/commission/transactions?limit=50' \
  -H 'X-Tenant-Id: 112f12b8-55e9-4de8-9fda-d58e37c75796' \
  -H 'Authorization: Bearer <salesman_user_id>'
```

#### 5.3 Get Targets
```bash
curl -X GET 'https://sak-ai.saksolution.ae/api/commission/targets' \
  -H 'X-Tenant-Id: 112f12b8-55e9-4de8-9fda-d58e37c75796' \
  -H 'Authorization: Bearer <salesman_user_id>'
```

---

## 🔧 Testing Tools

### Option 1: Browser DevTools
- Open browser console (F12)
- Use `fetch()` API to test endpoints
- Check Network tab for API responses

### Option 2: Postman/Insomnia
- Import the curl commands
- Set environment variables for tenant_id and auth tokens

### Option 3: PowerShell (Windows)
```powershell
# Example test
$headers = @{
    'X-Tenant-Id' = '112f12b8-55e9-4de8-9fda-d58e37c75796'
    'Authorization' = 'Bearer <salesman_user_id>'
    'Content-Type' = 'application/json'
}

Invoke-RestMethod -Uri 'https://sak-ai.saksolution.ae/api/commission/summary' -Headers $headers
```

---

## 📋 Testing Order

1. ✅ Run database migrations first (REQUIRED)
2. ✅ Test Analytics Dashboard (browser)
3. ✅ Test Mobile Follow-ups API
4. ✅ Test Location Tracking API
5. ✅ Test Commission Tracking API
6. ⏭️ Test Push Notifications (requires Firebase setup)

---

## 🐛 Common Issues

### Issue: "Column does not exist"
**Solution:** Run the database migrations

### Issue: "Authentication failed"
**Solution:** Verify X-Tenant-Id and Authorization headers

### Issue: "No data showing"
**Solution:** Create test data first using POST endpoints

### Issue: Push notifications not working
**Solution:** Set FIREBASE_SERVICE_ACCOUNT_KEY environment variable

---

## ✅ Success Criteria

Each feature should:
- ✅ Return HTTP 200 status
- ✅ Return valid JSON responses
- ✅ Have proper authentication
- ✅ Handle errors gracefully
- ✅ Work with existing tenant data
