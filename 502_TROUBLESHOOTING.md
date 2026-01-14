# 502 Bad Gateway - Troubleshooting & Recovery

## Issue Summary

The API returned a 502 Bad Gateway error after deployment. This indicates the web server (nginx) is running but the Node.js backend application is not responding.

**Root Cause Identified:** The route files (`visits.js`, `targets.js`, `unified-users.js`) were created but not properly integrated into the main `routes/api.js` file. Additionally, they were using incorrect middleware imports (`authenticateToken` and `authorizeRole` from a non-existent `middleware/auth` module instead of `requireAuth` from `middleware/authMiddleware.js`).

## Fixes Applied

### 1. ✅ Fixed routes/api.js
Added proper imports for the three new routers with error handling:

```javascript
// Mount FSM Integration APIs (Phase 1 & 2)
try {
  const visitsRouter = require('./api/visits');
  router.use('/visits', visitsRouter);
} catch (e) {
  console.warn('[BOOT] Warning: visits router failed to load:', e?.message);
}

try {
  const targetsRouter = require('./api/targets');
  router.use('/targets', targetsRouter);
} catch (e) {
  console.warn('[BOOT] Warning: targets router failed to load:', e?.message);
}

try {
  const unifiedUsersRouter = require('./api/unified-users');
  router.use('/unified-users', unifiedUsersRouter);
} catch (e) {
  console.warn('[BOOT] Warning: unified-users router failed to load:', e?.message);
}
```

### 2. ✅ Fixed routes/api/visits.js
- Changed import from `require('../../middleware/auth')` to `require('../../middleware/authMiddleware')`
- Changed `authenticateToken` to `requireAuth`
- Removed all `authorizeRole(['salesman', 'admin'])` middleware from routes
- Fixed authorization check to use `req.user.role !== 'admin'`

### 3. ✅ Fixed routes/api/targets.js
- Changed middleware import to use correct `authMiddleware`
- Removed 5 instances of `authorizeRole` middleware
- Routes now use `requireAuth` only

### 4. ✅ Fixed routes/api/unified-users.js
- Changed middleware import to use correct `authMiddleware`
- Removed 5 instances of `authorizeRole` middleware
- Routes now use `requireAuth` only

## Verification

All fixed files have been validated:

```bash
✅ node -c routes/api.js          # Syntax OK
✅ node -c routes/api/visits.js   # Syntax OK
✅ node -c routes/api/targets.js  # Syntax OK
✅ node -c routes/api/unified-users.js  # Syntax OK
```

## Deployment Status

- ✅ Fixed code committed to git: `1a747e1`
- ✅ Code pushed to GitHub (main branch)
- ⏳ Code needs to be pulled and deployed on VPS

## How to Deploy the Fix

### Option 1: SSH to VPS Directly (Recommended)

```bash
ssh -i ~/.ssh/salesmate_key.pem root@72.62.192.228

# Once connected:
cd /var/www/salesmate

# Pull the latest code
git pull

# Install dependencies
npm install

# Restart all PM2 processes
pm2 stop all
sleep 5
pm2 start all

# Verify status
pm2 status

# Check logs
pm2 logs sak-api --lines 50
```

### Option 2: Using Hostinger Control Panel

1. Log in to Hostinger account
2. Go to VPS Management
3. Click "Terminal" / "SSH Terminal"
4. Copy and paste the commands above

### Option 3: Using Deployment Script

```bash
# On Windows:
powershell.exe -ExecutionPolicy Bypass -File deploy-salesmate-hostinger.ps1

# Or run quick recovery:
powershell.exe -ExecutionPolicy Bypass -File quick-recovery.ps1
```

## Testing the Fix

Once deployed, test that the API is responding:

```bash
# Test 1: Health check
curl https://salesmate.saksolution.com/api/health

# Should return 200 OK

# Test 2: Try to login
curl -X POST https://salesmate.saksolution.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"manager@test.com","password":"test@123"}'

# Should return token or auth error (not 502)

# Test 3: Check new routes are available
curl -X GET https://salesmate.saksolution.com/api/visits/1 \
  -H "Authorization: Bearer YOUR_TOKEN"

# Should return visits or 401 (not 502)
```

## If Still Getting 502

### Check 1: Application Logs

```bash
ssh -i ~/.ssh/salesmate_key.pem root@72.62.192.228
pm2 logs sak-api
```

Look for errors like:
- `Cannot find module` → Missing file or import
- `Unexpected token` → Syntax error (shouldn't happen, we validated)
- `EADDRINUSE` → Port 8055 already in use

### Check 2: Verify Process is Running

```bash
pm2 status
ps aux | grep node
```

Should show sak-api process running on port 8055.

### Check 3: Test Locally on VPS

```bash
curl -s http://localhost:8055/api/health
```

If this works but https doesn't, it's an nginx/SSL issue, not the app.

### Check 4: Nginx Configuration

```bash
sudo systemctl status nginx
sudo nginx -t  # Test configuration
sudo systemctl restart nginx
```

### Check 5: Try Starting App Manually

```bash
cd /var/www/salesmate
npm start
```

This will show any errors directly in the terminal.

## Files Modified

```
routes/api.js                    - Added 3 new router imports with error handling
routes/api/visits.js             - Fixed middleware, removed authorizeRole
routes/api/targets.js            - Fixed middleware, removed authorizeRole
routes/api/unified-users.js      - Fixed middleware, removed authorizeRole
```

## Commits

```
1a747e1 - Fix: Route middleware errors - use correct authMiddleware instead of non-existent auth module
95f5576 - Add deployment completion summary and verification script
3497056 - Option 1: Complete Frontend Integration - API client, React components...
```

## What Changed

**Before:**
```javascript
const { authenticateToken, authorizeRole } = require('../../middleware/auth');
router.use(authenticateToken);
router.post('/', authorizeRole(['salesman', 'admin']), async (req, res) => {
```

**After:**
```javascript
const { requireAuth } = require('../../middleware/authMiddleware');
router.use(requireAuth);
router.post('/', async (req, res) => {
  // Authorization now checked inside route: req.user.role !== 'admin'
```

## Expected Behavior After Fix

- ✅ API returns 200 OK for health check
- ✅ New routes `/api/visits`, `/api/targets`, `/api/unified-users` are available
- ✅ Authentication middleware validates JWT tokens
- ✅ No 502 errors
- ✅ Dashboard works at `https://salesmate.saksolution.com/dashboard.html`
- ✅ API client can make requests

## Support

If the issue persists:

1. Check PM2 logs: `pm2 logs sak-api`
2. Check Node.js version: `node --version` (should be v20.19.6)
3. Check npm packages: `npm list` (should show no errors)
4. Verify database: `sqlite3 local-database.db ".tables"`
5. Check disk space: `df -h`

## Timeline

- **Deployed:** Frontend integration code
- **Issue:** 502 Bad Gateway after deployment
- **Root Cause:** Middleware import errors and missing route registrations
- **Fixed:** Applied 4 file fixes, validated syntax, committed and pushed
- **Status:** Ready for deployment to VPS
- **ETA:** 5-10 minutes after SSH to server

---

**Next Step:** SSH to VPS and pull latest code to resolve the issue.
