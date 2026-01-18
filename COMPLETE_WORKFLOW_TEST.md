# 🎯 SALESMATE COMPLETE END-TO-END TEST

**Mission:** Test the full workflow from login → WhatsApp → Lead → Assignment  
**Status:** ✅ Database cleaned - 24 real users, 303 visits, 0 test data  
**Production:** https://salesmate.saksolution.com

---

## 🧪 COMPLETE WORKFLOW TEST

I'll guide you through testing your app **exactly as a real user would use it**.

---

## STEP 1: Login & Authentication ✅
**What we're testing:** User can login and get authenticated

### Action 1.1: View Real Users
```powershell
ssh -i ~/.ssh/hostinger_ed25519 qutubk@72.62.192.228 "cd /var/www/salesmate-ai && sqlite3 -header -column local-database.db 'SELECT id, name, phone, role FROM users WHERE role = \"super_admin\" LIMIT 5;'"
```

**Expected:** See real super_admin users (like Mufaddal, Murtaza R)

### Action 1.2: Check If User Has Password
```powershell
ssh -i ~/.ssh/hostinger_ed25519 qutubk@72.62.192.228 "cd /var/www/salesmate-ai && sqlite3 -header -column local-database.db 'SELECT id, name, phone, LENGTH(password_hash) as has_password FROM users WHERE phone = \"1289993815\" LIMIT 1;'"
```

**Note:** Replace `1289993815` with any real user phone from Step 1.1

**Expected:** If has_password > 0, user can login. If 0, we need to create password.

---

### Action 1.3: Set Password for User (if needed)
If user doesn't have password, let's create one:

```powershell
# Create a script to set password
ssh -i ~/.ssh/hostinger_ed25519 qutubk@72.62.192.228 "cd /var/www/salesmate-ai && cat > set-password.js << 'EOF'
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const db = new Database('./local-database.db');

const phone = process.argv[2];
const password = process.argv[3];

if (!phone || !password) {
  console.log('Usage: node set-password.js PHONE PASSWORD');
  process.exit(1);
}

const hash = bcrypt.hashSync(password, 10);

const result = db.prepare('UPDATE users SET password_hash = ? WHERE phone = ?').run(hash, phone);

if (result.changes > 0) {
  console.log('✅ Password set successfully for phone:', phone);
  const user = db.prepare('SELECT id, name, phone, role FROM users WHERE phone = ?').get(phone);
  console.log('User:', user);
} else {
  console.log('❌ User not found');
}

db.close();
EOF
"

# Set password for Mufaddal (super_admin)
ssh -i ~/.ssh/hostinger_ed25519 qutubk@72.62.192.228 "cd /var/www/salesmate-ai && node set-password.js 1289993815 Admin@123"
```

---

### Action 1.4: Test Login API
```powershell
$body = @{
    phone = "1289993815"  # Mufaddal's phone
    password = "Admin@123"
} | ConvertTo-Json

$response = Invoke-RestMethod -Uri 'https://salesmate.saksolution.com/api/auth/login' -Method POST -Body $body -ContentType 'application/json'

$response | ConvertTo-Json -Depth 5

# Save the token for later use
$global:authToken = $response.token
Write-Host "`n✅ Logged in! Token saved to `$authToken`n" -ForegroundColor Green
```

**Expected:** Get JWT token and user details

---

## 👉 **STOP HERE**

Tell me:
1. Did you see the real users?
2. Did the user have a password?
3. Did login work and give you a token?

Once confirmed, I'll give you **STEP 2: WhatsApp Messages & Leads** 🚀

---

## STEP 2: WhatsApp Messages (Coming Next)

### Preview:
- View real WhatsApp messages in database
- Send test message via API
- Check message processing
- See lead creation from WhatsApp

**Wait for my signal to proceed...**

---

## STEP 3: Lead Assignment (Coming Next)

### Preview:
- View existing leads/visits
- Assign salesman to lead
- Track assignment in database

---

## STEP 4: Sales Pipeline (Coming Next)

### Preview:
- Create deal from lead
- Move through pipeline stages
- Track deal value

---

## STEP 5: Complete Workflow Test (Coming Next)

### Preview:
Full simulation:
1. Customer sends WhatsApp: "I need 50 bags of cement"
2. AI detects intent → creates lead
3. Lead assigned to salesman
4. Salesman creates visit
5. Visit generates quote
6. Quote sent via WhatsApp
7. Deal created in pipeline
8. Track until close

---

## 🆘 Quick Commands

**Check Production Logs:**
```powershell
ssh -i ~/.ssh/hostinger_ed25519 qutubk@72.62.192.228 "pm2 logs salesmate-ai --lines 50"
```

**Restart Production:**
```powershell
ssh -i ~/.ssh/hostinger_ed25519 qutubk@72.62.192.228 "pm2 restart salesmate-ai"
```

**Check Database:**
```powershell
ssh -i ~/.ssh/hostinger_ed25519 qutubk@72.62.192.228 "cd /var/www/salesmate-ai && sqlite3 -header -column local-database.db 'YOUR_QUERY;'"
```

---

**Ready? Start with STEP 1 and show me the results!** 🎯
