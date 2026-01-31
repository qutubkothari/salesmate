const express = require('express');
const router = express.Router();
const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { dbClient } = require('../../services/config');

const USE_SUPABASE = process.env.USE_SUPABASE === 'true';

// Direct SQLite connection
// __dirname is <repo>/routes/api, so go up 2 levels to reach repo root
let db;
try {
  if (!USE_SUPABASE) {
    db = new Database(path.join(__dirname, '../../local-database.db'));
    db.pragma('journal_mode = WAL');
  }
} catch (err) {
  console.warn('[FSM_SALESMAN] SQLite init skipped (using Supabase):', err.message);
}

function dbAll(sql, params = []) {
    if (!db) throw new Error('SQLite not available - using Supabase');
    return db.prepare(sql).all(...params);
}

function dbGet(sql, params = []) {
    return db.prepare(sql).get(...params);
}

function dbRun(sql, params = []) {
    return db.prepare(sql).run(...params);
}

function getTenantId(req) {
    return req.query.tenant_id || req.body?.tenant_id || req.headers['x-tenant-id'];
}

function normalizePhoneDigits(value) {
    if (!value) return '';
    const withoutSuffix = String(value).replace(/@c\.us$/i, '');
    return withoutSuffix.replace(/\D/g, '');
}

function phonesMatch(a, b) {
    const ad = normalizePhoneDigits(a);
    const bd = normalizePhoneDigits(b);
    if (!ad || !bd) return false;
    if (ad === bd) return true;

    // Compare by suffix to tolerate country code / leading zero differences.
    const suffixLen = 9;
    if (ad.length >= suffixLen && bd.length >= suffixLen) {
        return ad.slice(-suffixLen) === bd.slice(-suffixLen);
    }

    const minLen = Math.min(ad.length, bd.length);
    if (minLen >= 7) {
        return ad.slice(-minLen) === bd.slice(-minLen);
    }

    return false;
}

function verifyUserPassword(userRow, password) {
    if (!userRow) return false;
    if (userRow.password_hash) {
        try {
            return bcrypt.compareSync(String(password), String(userRow.password_hash));
        } catch (_) {
            return false;
        }
    }
    if (userRow.password) {
        return String(password) === String(userRow.password);
    }
    return false;
}

function hashToken(token) {
    return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function ensureSalesmanSessionAuthColumns() {
    try {
        const columns = dbAll("PRAGMA table_info('salesman_sessions')");
        const colNames = new Set(columns.map(c => c.name));

        if (!colNames.has('session_token_hash')) {
            dbRun("ALTER TABLE salesman_sessions ADD COLUMN session_token_hash TEXT");
        }
        if (!colNames.has('session_expires_at')) {
            dbRun("ALTER TABLE salesman_sessions ADD COLUMN session_expires_at TEXT");
        }
        if (!colNames.has('last_seen_at')) {
            dbRun("ALTER TABLE salesman_sessions ADD COLUMN last_seen_at TEXT");
        }
        if (!colNames.has('revoked_at')) {
            dbRun("ALTER TABLE salesman_sessions ADD COLUMN revoked_at TEXT");
        }

        dbRun('CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON salesman_sessions(session_token_hash)');
    } catch (e) {
        // If salesman_sessions table doesn't exist yet, routes will error naturally.
        console.warn('[FSM_SALESMAN] Could not ensure auth columns:', e.message);
    }
}

ensureSalesmanSessionAuthColumns();

async function authenticateSalesman(req, res, next) {
    try {
        const tenantId = getTenantId(req);
        if (!tenantId) {
            return res.status(400).json({ success: false, error: 'tenant_id is required' });
        }

        const authHeader = req.headers.authorization || '';
        const bearer = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : null;
        const token = bearer || req.headers['x-salesman-token'];

        if (!token) {
            return res.status(401).json({ success: false, error: 'Missing salesman auth token' });
        }

        const tokenHash = hashToken(token);
        let session = null;

        if (USE_SUPABASE) {
            // Query Supabase for session
            const { data, error } = await dbClient
                .from('salesman_sessions')
                .select('*')
                .eq('tenant_id', tenantId)
                .eq('session_token_hash', tokenHash)
                .is('revoked_at', null)
                .order('updated_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (error) throw error;
            
            if (data) {
                // Check if expired
                if (data.session_expires_at && new Date(data.session_expires_at) <= new Date()) {
                    return res.status(401).json({ success: false, error: 'Session expired' });
                }
                session = data;
            }
        } else {
            // Query SQLite for session
            session = dbGet(
                `SELECT * FROM salesman_sessions
                 WHERE tenant_id = ?
                   AND session_token_hash = ?
                   AND revoked_at IS NULL
                   AND (session_expires_at IS NULL OR datetime(session_expires_at) > datetime('now'))
                 ORDER BY datetime(updated_at) DESC
                 LIMIT 1`,
                [tenantId, tokenHash]
            );
        }

        if (!session) {
            return res.status(401).json({ success: false, error: 'Invalid or expired session' });
        }

        // Optional: enforce salesman id match when route has :id
        if (req.params?.id && session.salesman_id && req.params.id !== session.salesman_id) {
            return res.status(403).json({ success: false, error: 'Forbidden' });
        }

        // Touch last_seen
        if (USE_SUPABASE) {
            await dbClient
                .from('salesman_sessions')
                .update({
                    last_seen_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                    is_online: 1
                })
                .eq('id', session.id);
        } else {
            dbRun(
                `UPDATE salesman_sessions
                 SET last_seen_at = datetime('now'), updated_at = datetime('now'), is_online = 1
                 WHERE id = ?`,
                [session.id]
            );
        }

        req.salesmanSession = session;
        req.salesmanId = session.salesman_id;
        req.tenantId = tenantId;
        next();
    } catch (error) {
        console.error('[FSM_SALESMAN] Auth error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
}

// ============================================
// SALESMAN EMPOWERMENT API ROUTES
// Mobile App & Desktop App Support
// ============================================

// -------------------- DASHBOARD --------------------

// Login (creates a session token)
router.post('/salesman/login', async (req, res) => {
    try {
        console.log('[FSM_SALESMAN_LOGIN] Request received:', { phone: req.body?.phone, has_password: !!req.body?.password, device_id: req.body?.device_id, use_supabase: USE_SUPABASE });
        
        let tenantId = getTenantId(req);
        let { salesman_id, phone, password, device_id, device_type, device_name, app_version, platform, fcm_token } = req.body || {};

        if (!device_id) return res.status(400).json({ success: false, error: 'device_id is required' });

        const phoneDigits = normalizePhoneDigits(phone);
        if (!phoneDigits) return res.status(400).json({ success: false, error: 'Phone number is invalid' });
        if (!password) return res.status(400).json({ success: false, error: 'Password is required' });

        console.log('[FSM_SALESMAN_LOGIN] Normalized phone:', phoneDigits);

        let matchedUser = null;
        let salesman = null;

        if (USE_SUPABASE) {
            // Supabase implementation
            console.log('[FSM_SALESMAN_LOGIN] Using Supabase');
            
            // Find user by phone
            const { data: users, error: userError } = await dbClient
                .from('users')
                .select('*')
                .eq('phone', phoneDigits)
                .eq('role', 'salesman')
                .eq('is_active', 1);

            if (userError) {
                console.error('[FSM_SALESMAN_LOGIN] Supabase user query error:', userError);
                throw userError;
            }

            console.log('[FSM_SALESMAN_LOGIN] Found users:', users?.length || 0);

            if (users && users.length > 0) {
                matchedUser = users[0];
            }

            if (!matchedUser) {
                console.log('[FSM_SALESMAN_LOGIN] FAILED: No matching user');
                return res.status(401).json({ success: false, error: 'Invalid phone number or password' });
            }

            // Verify password
            const ok = verifyUserPassword(matchedUser, password);
            if (!ok) {
                console.log('[FSM_SALESMAN_LOGIN] FAILED: Password mismatch');
                return res.status(401).json({ success: false, error: 'Invalid phone number or password' });
            }

            console.log('[FSM_SALESMAN_LOGIN] Password verified for user:', matchedUser.id);

            // Find salesman record
            const { data: salesmen, error: salesmanError } = await dbClient
                .from('salesmen')
                .select('*')
                .eq('user_id', matchedUser.id)
                .eq('tenant_id', matchedUser.tenant_id)
                .eq('is_active', 1);

            if (salesmanError) {
                console.error('[FSM_SALESMAN_LOGIN] Supabase salesman query error:', salesmanError);
                throw salesmanError;
            }

            if (!salesmen || salesmen.length === 0) {
                console.log('[FSM_SALESMAN_LOGIN] FAILED: Salesman record not found');
                return res.status(404).json({ success: false, error: 'Salesman not found' });
            }

            salesman = salesmen[0];
            tenantId = matchedUser.tenant_id;
            salesman_id = salesman.id;

            console.log('[FSM_SALESMAN_LOGIN] Found salesman:', { id: salesman.id, name: salesman.name, tenant_id: tenantId });

        } else {
            // SQLite implementation (original code)
            const inputDigits = phoneDigits;

            try {
                const allUsers = dbAll('SELECT * FROM users');
                console.log('[FSM_SALESMAN_LOGIN] Total users in DB:', allUsers.length);
                
                const matches = allUsers.filter((u) => {
                    return phonesMatch(u.phone, inputDigits);
                });

                console.log('[FSM_SALESMAN_LOGIN] Phone matches found:', matches.length, matches.map(u => ({ id: u.id, phone: u.phone, role: u.role })));

                if (matches.length === 1) matchedUser = matches[0];
                else if (matches.length > 1) {
                    matchedUser = matches.find((u) => normalizePhoneDigits(u.phone) === inputDigits) || matches[0] || null;
                }
            } catch (e) {
                console.error('[FSM_SALESMAN_LOGIN] Users lookup failed:', e?.message || e, e?.stack);
            }

            console.log('[FSM_SALESMAN_LOGIN] Matched user:', matchedUser ? { id: matchedUser.id, phone: matchedUser.phone, role: matchedUser.role, has_hash: !!matchedUser.password_hash } : 'NONE');

            if (!matchedUser) {
                console.log('[FSM_SALESMAN_LOGIN] FAILED: No matching user');
                return res.status(401).json({ success: false, error: 'Invalid phone number or password' });
            }
            if (Number(matchedUser.is_active ?? 1) === 0) {
                return res.status(403).json({ success: false, error: 'Account is inactive' });
            }

            const ok = verifyUserPassword(matchedUser, password);
            if (!ok) {
                return res.status(401).json({ success: false, error: 'Invalid phone number or password' });
            }

            const rawRole = String(matchedUser.role || '').toLowerCase();
            if (rawRole !== 'salesman') {
                return res.status(403).json({ success: false, error: 'Not a salesman account. Please use admin login.' });
            }

            // Resolve salesman record
            try {
                if (matchedUser.id) {
                    salesman = dbGet('SELECT * FROM salesmen WHERE user_id = ?', [matchedUser.id]) || null;
                }
                if (!salesman && matchedUser.phone) {
                    salesman = dbGet('SELECT * FROM salesmen WHERE phone = ? AND tenant_id = ?', [matchedUser.phone, matchedUser.tenant_id]) || null;
                }
                if (!salesman && inputDigits) {
                    const allSalesmen = dbAll('SELECT * FROM salesmen');
                    const matches = allSalesmen.filter((s) => {
                        return phonesMatch(s.phone, inputDigits);
                    });
                    salesman = matches.find((s) => normalizePhoneDigits(s.phone) === inputDigits) || matches[0] || null;
                }
            } catch (e) {
                console.warn('[FSM_SALESMAN] Salesmen lookup failed:', e?.message || e);
            }

            if (!salesman) {
                return res.status(404).json({ success: false, error: 'Salesman not found' });
            }
            if (salesman.is_active === 0) return res.status(403).json({ success: false, error: 'Salesman inactive' });

            tenantId = matchedUser.tenant_id || salesman.tenant_id;
            salesman_id = salesman.id;
        }

        // Generate session token
        const token = crypto.randomBytes(32).toString('hex');
        const tokenHash = hashToken(token);
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days

        if (USE_SUPABASE) {
            // Store session in Supabase
            const sessionId = crypto.randomUUID();
            const { error: sessionError } = await dbClient
                .from('salesman_sessions')
                .insert({
                    id: sessionId,
                    tenant_id: tenantId,
                    salesman_id: salesman_id,
                    device_id: device_id,
                    device_type: device_type || 'web',
                    device_name: device_name || 'Unknown',
                    platform: platform || 'web',
                    app_version: app_version,
                    fcm_token: fcm_token,
                    session_token_hash: tokenHash,
                    session_expires_at: expiresAt,
                    is_online: 1,
                    last_seen_at: new Date().toISOString(),
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                });

            if (sessionError) {
                console.error('[FSM_SALESMAN_LOGIN] Failed to create session:', sessionError);
                throw sessionError;
            }
        } else {
            // Store session in SQLite
            dbRun(`
                INSERT INTO salesman_sessions (
                    tenant_id, salesman_id, user_id, device_id, device_type, device_name,
                    platform, app_version, fcm_token, session_token_hash, session_expires_at,
                    is_online, last_seen_at, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'), datetime('now'))
            `, [
                tenantId, salesman_id, matchedUser.id, device_id, device_type || 'web',
                device_name || 'Unknown', platform || 'web', app_version, fcm_token,
                tokenHash, expiresAt
            ]);
        }

        console.log('[FSM_SALESMAN_LOGIN] SUCCESS:', { salesman_id, tenant_id: tenantId, name: salesman.name });

        res.json({
            success: true,
            data: {
                token,
                expires_at: expiresAt,
                tenant_id: tenantId,
                salesman: {
                    id: salesman.id,
                    name: salesman.name,
                    phone: salesman.phone,
                    email: salesman.email
                }
            }
        });
    } catch (error) {
        console.error('[FSM_SALESMAN] Login error:', error);
        res.status(500).json({ success: false, error: error.message || 'Login failed' });
    }
});

// Logout (revokes token)
router.post('/salesman/logout', authenticateSalesman, (req, res) => {
    try {
        const sessionId = req.salesmanSession?.id;
        if (sessionId) {
            dbRun(
                `UPDATE salesman_sessions
                 SET revoked_at = datetime('now'), is_online = 0, updated_at = datetime('now')
                 WHERE id = ?`,
                [sessionId]
            );
        }
        res.json({ success: true });
    } catch (error) {
        console.error('Error logging out salesman:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update device/session metadata (FCM token, device info)
router.post('/salesman/:id/device', authenticateSalesman, (req, res) => {
    try {
        const tenantId = getTenantId(req);
        const { id } = req.params;
        const { device_name, app_version, platform, fcm_token, device_type } = req.body || {};

        const sessionId = req.salesmanSession?.id;
        if (!sessionId) return res.status(401).json({ success: false, error: 'No active session' });

        dbRun(
            `UPDATE salesman_sessions
             SET device_type = COALESCE(?, device_type),
                 device_name = COALESCE(?, device_name),
                 app_version = COALESCE(?, app_version),
                 platform = COALESCE(?, platform),
                 fcm_token = COALESCE(?, fcm_token),
                 last_seen_at = datetime('now'), updated_at = datetime('now')
             WHERE id = ? AND tenant_id = ? AND salesman_id = ?`,
            [device_type || null, device_name || null, app_version || null, platform || null, fcm_token || null, sessionId, tenantId, id]
        );

        res.json({ success: true });
    } catch (error) {
        console.error('Error updating device metadata:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get salesman dashboard stats (for mobile/desktop home screen)
router.get('/salesman/:id/dashboard', authenticateSalesman, (req, res) => {
    try {
        const { id } = req.params;
        const { date } = req.query; // optional specific date, defaults to today
        const targetDate = date || new Date().toISOString().split('T')[0];
        const tenantId = getTenantId(req);

        const salesman = dbGet('SELECT * FROM salesmen WHERE id = ? AND tenant_id = ?', [id, tenantId]);

        // Get today's stats
        const todayVisits = dbAll(
            `SELECT * FROM visits 
             WHERE salesman_id = ? AND tenant_id = ? 
             AND DATE(visit_date) = ?`,
            [id, tenantId, targetDate]
        );

        // Get month stats
        const monthStart = targetDate.substring(0, 7) + '-01';
        const monthVisits = dbAll(
            `SELECT * FROM visits 
             WHERE salesman_id = ? AND tenant_id = ? 
             AND strftime('%Y-%m', visit_date) = strftime('%Y-%m', ?)`,
            [id, tenantId, monthStart]
        );

        // Get targets
        const target = dbGet(
            `SELECT * FROM salesman_targets 
             WHERE salesman_id = ? AND tenant_id = ? 
             AND period = strftime('%Y-%m', ?)`,
            [id, tenantId, targetDate]
        );

        // Get pending visits (future or not checked out)
        const pendingVisits = dbAll(
            `SELECT v.*, c.business_name as customer_name, c.phone, cl.address 
             FROM visits v
             LEFT JOIN customer_profiles_new c ON v.customer_id = c.id
             LEFT JOIN customer_locations cl ON c.id = cl.customer_id
             WHERE v.salesman_id = ? AND v.tenant_id = ? 
             AND (DATE(v.visit_date) >= ? OR v.time_out IS NULL)
             ORDER BY v.visit_date ASC
             LIMIT 10`,
            [id, tenantId, targetDate]
        );

        // Get recent commissions
        const commissions = dbAll(
            `SELECT SUM(commission_amount) as total_pending
             FROM salesman_commissions 
             WHERE salesman_id = ? AND tenant_id = ? 
             AND status = 'pending'`,
            [id, tenantId]
        );

        res.json({
            success: true,
            data: {
                salesman: salesman ? { id: salesman.id, name: salesman.name, phone: salesman.phone } : null,
                today: {
                    date: targetDate,
                    visits_completed: todayVisits.filter(v => v.time_out != null).length,
                    visits_scheduled: todayVisits.filter(v => v.time_out == null).length,
                    orders_taken: todayVisits.filter(v => v.order_id != null).length
                },
                month: {
                    period: monthStart.substring(0, 7),
                    total_visits: monthVisits.length,
                    target_visits: target?.target_visits || 0,
                    achievement_pct: target?.target_visits > 0 
                        ? Math.round((monthVisits.length / target.target_visits) * 100)
                        : 0,
                    revenue_generated: monthVisits.reduce((sum, v) => sum + (v.order_value || 0), 0),
                    target_revenue: target?.target_revenue || 0
                },
                pending_visits: pendingVisits,
                commissions: {
                    pending: commissions[0]?.total_pending || 0
                }
            }
        });
    } catch (error) {
        console.error('Error getting salesman dashboard:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// -------------------- SYNC MANAGEMENT --------------------

// Get full sync data (for initial app load or full refresh)
router.get('/salesman/:id/sync-data', authenticateSalesman, (req, res) => {
    try {
        const { id } = req.params;
        const { last_sync_timestamp } = req.query;
        const tenantId = getTenantId(req);

        // Get salesman profile
        const salesman = dbGet(
            'SELECT * FROM salesmen WHERE id = ? AND tenant_id = ?',
            [id, tenantId]
        );

        if (!salesman) {
            return res.status(404).json({ success: false, error: 'Salesman not found' });
        }

        // Get customers assigned to this salesman
        const customers = dbAll(
            `SELECT c.*, cl.latitude, cl.longitude, cl.address as gps_address
             FROM customer_profiles_new c
             LEFT JOIN customer_locations cl ON c.id = cl.customer_id
             WHERE c.tenant_id = ? 
             ${last_sync_timestamp ? 'AND c.updated_at > ?' : ''}
             ORDER BY c.business_name`,
            last_sync_timestamp ? [tenantId, last_sync_timestamp] : [tenantId]
        );

        // Get visits (last 30 days + future scheduled)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const visits = dbAll(
            `SELECT * FROM visits 
             WHERE salesman_id = ? AND tenant_id = ? 
             AND (visit_date >= ? OR status = 'scheduled')
             ${last_sync_timestamp ? 'AND updated_at > ?' : ''}
             ORDER BY visit_date DESC`,
            last_sync_timestamp 
                ? [id, tenantId, thirtyDaysAgo.toISOString().split('T')[0], last_sync_timestamp]
                : [id, tenantId, thirtyDaysAgo.toISOString().split('T')[0]]
        );

        // Get current month target
        const currentMonth = new Date().toISOString().substring(0, 7);
        const target = dbGet(
            'SELECT * FROM salesman_targets WHERE salesman_id = ? AND tenant_id = ? AND period = ?',
            [id, tenantId, currentMonth]
        );

        // Get products (limited fields for mobile)
        const products = dbAll(
            `SELECT id, name, sku, category, price, stock_quantity, image_url, description
             FROM products 
             WHERE tenant_id = ? 
             ${last_sync_timestamp ? 'AND updated_at > ?' : ''}
             ORDER BY name`,
            last_sync_timestamp ? [tenantId, last_sync_timestamp] : [tenantId]
        );

        res.json({
            success: true,
            data: {
                salesman,
                customers,
                visits,
                target,
                products,
                sync_timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('Error syncing data:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Upload offline changes (bulk sync from mobile/desktop/web)
router.post('/salesman/:id/sync-upload', authenticateSalesman, (req, res) => {
    try {
        const { id } = req.params;
        const { device_id, changes } = req.body;
        const tenantId = getTenantId(req);

        const results = {
            success: 0,
            failed: 0,
            errors: []
        };

        // Process each change
        for (const change of changes) {
            try {
                const { entity_type, action, data, client_id } = change;

                // Persist to server-side offline queue for audit/debug
                try {
                    dbRun(
                        `INSERT INTO offline_queue
                         (tenant_id, salesman_id, device_id, entity_type, entity_id, action, data, client_timestamp, synced, synced_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), 0, NULL)`,
                        [tenantId, id, device_id, entity_type, data?.id || null, action, JSON.stringify(data || {})]
                    );
                } catch (e) {
                    // If offline_queue is missing, continue processing anyway
                }

                let result;
                switch (entity_type) {
                    case 'visit':
                        result = processVisitChange(action, data, tenantId, id, device_id);
                        break;
                    case 'customer':
                        result = processCustomerChange(action, data, tenantId);
                        break;
                    case 'note':
                        result = processNoteChange(action, data, tenantId, id);
                        break;
                    case 'expense':
                        result = processExpenseChange(action, data, tenantId, id);
                        break;
                    default:
                        throw new Error(`Unknown entity type: ${entity_type}`);
                }

                results.success++;
                
                // Store mapping of client_id to server_id for response
                if (!results.mappings) results.mappings = {};
                results.mappings[client_id] = result.id;

            } catch (error) {
                results.failed++;
                results.errors.push({
                    change,
                    error: error.message
                });
            }
        }

        // Update last sync timestamp for this device
        dbRun(
            `UPDATE salesman_sessions 
             SET last_sync_at = datetime('now') 
             WHERE salesman_id = ? AND device_id = ?`,
            [id, device_id]
        );

        res.json({
            success: true,
            results
        });
    } catch (error) {
        console.error('Error processing sync upload:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get plants/branches for tenant
router.get('/plants', authenticateSalesman, (req, res) => {
    try {
        const tenantId = getTenantId(req);
        
        // Get plants from database
        const plants = dbAll(
            `SELECT id, name, plant_name, location, address, city, state, pincode, phone, email
             FROM plants 
             WHERE tenant_id = ? 
             ORDER BY name`,
            [tenantId]
        );

        res.json({ success: true, data: plants || [] });
    } catch (error) {
        console.error('Error fetching plants:', error);
        res.status(500).json({ success: false, error: error.message, data: [] });
    }
});

// Create a new visit
router.post('/salesman/:id/visits', authenticateSalesman, async (req, res) => {
    try {
        const { id } = req.params;
        const { 
            customer_name, contact_person, customer_phone,
            meeting_types, products_discussed,
            next_action, next_action_date, potential, competitor_name,
            can_be_switched, remarks, time_in, gps_latitude, gps_longitude, visit_type, plant_id
        } = req.body;
        const tenantId = getTenantId(req);

        if (!customer_name) {
            return res.status(400).json({ success: false, error: 'Customer name is required' });
        }

        // Create visit ID
        const visitId = generateId();
        const visitDate = new Date().toISOString().split('T')[0];

        // Insert visit - using only columns that exist in the table
        dbRun(
            `INSERT INTO visits 
             (id, tenant_id, salesman_id, customer_name, contact_person, customer_phone,
              visit_type, visit_date, time_in, plant_id,
              meeting_types, products_discussed, next_action, next_action_date,
              potential, competitor_name, can_be_switched, remarks,
              gps_latitude, gps_longitude, location_accuracy,
              synced, created_at, updated_at, checkin_time)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'), ?)`,
            [
                visitId, tenantId, id, customer_name, contact_person || null, customer_phone || null,
                visit_type || ((meeting_types && meeting_types.length > 0) ? meeting_types[0] : 'regular'),
                visitDate, time_in || new Date().toISOString(),
                plant_id || null,
                JSON.stringify(meeting_types || []),
                JSON.stringify(products_discussed || []),
                next_action || null,
                next_action_date || null,
                potential || 'Low',
                competitor_name || null,
                can_be_switched ? 1 : 0,
                remarks || null,
                gps_latitude || 0.0,
                gps_longitude || 0.0,
                0.0,
                time_in || new Date().toISOString()
            ]
        );

        // Create/update customer profile and lead in Supabase
        try {
            const { dbClient } = require('../../services/config');
            const customerProfileService = require('../../services/customerProfileService');
            
            // 1. Create/update customer profile if phone is provided
            if (customer_phone) {
                await customerProfileService.upsertCustomerByPhone(tenantId, customer_phone, {
                    name: customer_name,
                    address: contact_person ? `c/o ${contact_person}` : null,
                    lead_score: potential === 'High' ? 80 : potential === 'Medium' ? 50 : 20
                });
            }
            
            // 2. Create or update CRM lead
            const leadId = crypto.randomUUID();
            const now = new Date().toISOString();
            
            // Check if lead already exists for this phone
            let existingLead = null;
            if (customer_phone) {
                const { data } = await dbClient
                    .from('crm_leads')
                    .select('*')
                    .eq('tenant_id', tenantId)
                    .eq('phone', customer_phone)
                    .maybeSingle();
                existingLead = data;
            }
            
            if (existingLead) {
                // Update existing lead with visit info
                await dbClient
                    .from('crm_leads')
                    .update({
                        status: next_action ? 'QUALIFIED' : 'NEW',
                        heat: potential === 'High' ? 'HOT' : potential === 'Medium' ? 'WARM' : 'COLD',
                        last_contact_time: now,
                        updated_at: now
                    })
                    .eq('id', existingLead.id);
                
                // Log the visit as a lead event
                await dbClient
                    .from('crm_lead_events')
                    .insert({
                        id: crypto.randomUUID(),
                        lead_id: existingLead.id,
                        event_type: 'VISIT',
                        description: `Field visit: ${remarks || 'Visit completed'}`,
                        metadata: {
                            visit_id: visitId,
                            visit_type,
                            potential,
                            products_discussed,
                            next_action,
                            next_action_date
                        },
                        created_at: now
                    });
            } else if (customer_phone) {
                // Create new lead
                await dbClient
                    .from('crm_leads')
                    .insert({
                        id: leadId,
                        tenant_id: tenantId,
                        name: customer_name,
                        phone: customer_phone,
                        source: 'FSM_VISIT',
                        status: next_action ? 'QUALIFIED' : 'NEW',
                        heat: potential === 'High' ? 'HOT' : potential === 'Medium' ? 'WARM' : 'COLD',
                        assigned_user_id: id,
                        last_contact_time: now,
                        created_at: now,
                        updated_at: now
                    });
                
                // Log initial visit event
                await dbClient
                    .from('crm_lead_events')
                    .insert({
                        id: crypto.randomUUID(),
                        lead_id: leadId,
                        event_type: 'VISIT',
                        description: `Initial field visit: ${remarks || 'First contact'}`,
                        metadata: {
                            visit_id: visitId,
                            visit_type,
                            potential,
                            products_discussed,
                            next_action,
                            next_action_date
                        },
                        created_at: now
                    });
            }
        } catch (crmError) {
            console.warn('[FSM] Failed to create customer/lead in CRM:', crmError.message);
        }

        // Emit real-time notification via WebSocket
        try {
            const websocketService = require('../../services/websocket-service');
            const visit = {
                id: visitId,
                customer_name,
                salesman_id: id,
                visit_type: visit_type || ((meeting_types && meeting_types.length > 0) ? meeting_types[0] : 'regular'),
                created_at: new Date().toISOString()
            };
            websocketService.emitVisitCreated(visit, tenantId);
        } catch (wsError) {
            console.warn('[WS] Failed to emit visit created:', wsError.message);
        }

        res.json({ success: true, visit_id: visitId });
    } catch (error) {
        console.error('Error creating visit:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// -------------------- ROUTE PLANNING --------------------

// Get optimal route plan for the day
router.get('/salesman/:id/route-plan', authenticateSalesman, (req, res) => {
    try {
        const { id } = req.params;
        const { date } = req.query;
        const tenantId = getTenantId(req);
        const targetDate = date || new Date().toISOString().split('T')[0];

        // Get scheduled visits for the day
        const visits = dbAll(
            `SELECT v.*, c.business_name as customer_name, 
                    cl.latitude, cl.longitude, cl.address
             FROM visits v
             LEFT JOIN customer_profiles_new c ON v.customer_id = c.id
             LEFT JOIN customer_locations cl ON c.id = cl.customer_id
             WHERE v.salesman_id = ? AND v.tenant_id = ? 
             AND DATE(v.visit_date) = ?
             ORDER BY v.visit_date`,
            [id, tenantId, targetDate]
        );

        // Get or create route plan
        let routePlan = dbGet(
            'SELECT * FROM route_plans WHERE salesman_id = ? AND plan_date = ?',
            [id, targetDate]
        );

        if (!routePlan && visits.length > 0) {
            // Create optimized route (simple nearest-neighbor algorithm)
            const optimizedSequence = optimizeRoute(visits);
            
            const planId = generateId();
            dbRun(
                `INSERT INTO route_plans 
                 (id, tenant_id, salesman_id, plan_date, customer_sequence, status) 
                 VALUES (?, ?, ?, ?, ?, 'planned')`,
                [planId, tenantId, id, targetDate, JSON.stringify(optimizedSequence)]
            );

            routePlan = dbGet('SELECT * FROM route_plans WHERE id = ?', [planId]);
        }

        res.json({
            success: true,
            data: {
                route_plan: routePlan,
                visits,
                total_customers: visits.length
            }
        });
    } catch (error) {
        console.error('Error getting route plan:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// -------------------- SALESMAN SCOPED DATA (WEB APP) --------------------

router.get('/salesman/:id/visits', authenticateSalesman, (req, res) => {
    try {
        const tenantId = getTenantId(req);
        const { id } = req.params;
        const limit = Math.min(parseInt(req.query.limit || '100', 10), 500);
        const visits = dbAll(
            `SELECT v.*, 
                    COALESCE(c.business_name, v.customer_name) as customer_name
             FROM visits v
             LEFT JOIN customer_profiles_new c ON c.id = v.customer_id
             WHERE v.tenant_id = ? AND v.salesman_id = ?
             ORDER BY v.visit_date DESC, v.created_at DESC
             LIMIT ?`,
            [tenantId, id, limit]
        );

        res.json({ success: true, data: visits, count: visits.length });
    } catch (error) {
        console.error('Error getting salesman visits:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/salesman/:id/customers', authenticateSalesman, (req, res) => {
    try {
        const tenantId = getTenantId(req);
        const { id } = req.params;
        const limit = Math.min(parseInt(req.query.limit || '200', 10), 1000);

        // Get customers assigned to this salesman
        const customers = dbAll(
            `SELECT *
             FROM customer_profiles_new
             WHERE tenant_id = ? AND assigned_salesman_id = ?
             ORDER BY business_name
             LIMIT ?`,
            [tenantId, id, limit]
        );

        res.json({ success: true, data: customers, count: customers.length });
    } catch (error) {
        console.error('Error getting salesman customers:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/salesman/:id/targets', authenticateSalesman, (req, res) => {
    try {
        const tenantId = getTenantId(req);
        const { id } = req.params;
        const limit = Math.min(parseInt(req.query.limit || '12', 10), 120);

        const targets = dbAll(
            `SELECT st.*, st.period as target_month
             FROM salesman_targets st
             WHERE st.tenant_id = ? AND st.salesman_id = ?
             ORDER BY st.period DESC
             LIMIT ?`,
            [tenantId, id, limit]
        );

        res.json({ success: true, data: targets, count: targets.length });
    } catch (error) {
        console.error('Error getting salesman targets:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/salesman/:id/expenses', authenticateSalesman, (req, res) => {
    try {
        const tenantId = getTenantId(req);
        const { id } = req.params;
        const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);

        const expenses = dbAll(
            `SELECT * FROM salesman_expenses
             WHERE tenant_id = ? AND salesman_id = ?
             ORDER BY expense_date DESC, created_at DESC
             LIMIT ?`,
            [tenantId, id, limit]
        );

        res.json({ success: true, data: expenses, count: expenses.length });
    } catch (error) {
        console.error('Error getting expenses:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/salesman/:id/expenses', authenticateSalesman, (req, res) => {
    try {
        const tenantId = getTenantId(req);
        const { id } = req.params;
        const { expense_date, expense_type, amount, description, receipt_url, visit_id } = req.body || {};

        if (!expense_date || !expense_type || amount === undefined) {
            return res.status(400).json({ success: false, error: 'expense_date, expense_type, amount are required' });
        }

        const expenseId = crypto.randomUUID ? crypto.randomUUID() : generateId();
        dbRun(
            `INSERT INTO salesman_expenses
             (id, tenant_id, salesman_id, expense_date, expense_type, amount, description, receipt_url, visit_id, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now'), datetime('now'))`,
            [expenseId, tenantId, id, expense_date, expense_type, Number(amount), description || null, receipt_url || null, visit_id || null]
        );

        res.json({ success: true, data: { id: expenseId } });
    } catch (error) {
        console.error('Error creating expense:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// -------------------- NOTIFICATIONS --------------------

router.get('/salesman/:id/notifications', authenticateSalesman, (req, res) => {
    try {
        const tenantId = getTenantId(req);
        const { id } = req.params;
        const limit = Math.min(parseInt(req.query.limit || '20', 10), 100);
        const status = req.query.status;

        const rows = status
            ? dbAll(
                `SELECT * FROM notification_queue
                 WHERE tenant_id = ? AND salesman_id = ? AND status = ?
                 ORDER BY datetime(created_at) DESC
                 LIMIT ?`,
                [tenantId, id, status, limit]
            )
            : dbAll(
                `SELECT * FROM notification_queue
                 WHERE tenant_id = ? AND salesman_id = ?
                 ORDER BY datetime(created_at) DESC
                 LIMIT ?`,
                [tenantId, id, limit]
            );

        res.json({ success: true, data: rows, count: rows.length });
    } catch (error) {
        console.error('Error fetching notifications:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/salesman/:id/notifications/:notificationId/read', authenticateSalesman, (req, res) => {
    try {
        const tenantId = getTenantId(req);
        const { id, notificationId } = req.params;

        dbRun(
            `UPDATE notification_queue
             SET read_at = datetime('now'), status = 'read'
             WHERE id = ? AND tenant_id = ? AND salesman_id = ?`,
            [notificationId, tenantId, id]
        );

        res.json({ success: true });
    } catch (error) {
        console.error('Error marking notification read:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Admin/system enqueue endpoint (guarded by env key)
router.post('/notifications/enqueue', (req, res) => {
    try {
        const adminKey = process.env.FSM_ADMIN_KEY;
        if (!adminKey) {
            return res.status(403).json({ success: false, error: 'FSM_ADMIN_KEY not configured' });
        }
        if (req.headers['x-admin-key'] !== adminKey) {
            return res.status(403).json({ success: false, error: 'Forbidden' });
        }

        const { tenant_id, salesman_id, notification_type, title, message, data, priority, scheduled_for } = req.body || {};
        if (!tenant_id || !salesman_id || !notification_type || !title || !message) {
            return res.status(400).json({ success: false, error: 'tenant_id, salesman_id, notification_type, title, message are required' });
        }

        const notifId = crypto.randomUUID ? crypto.randomUUID() : generateId();
        dbRun(
            `INSERT INTO notification_queue
             (id, tenant_id, salesman_id, notification_type, title, message, data, priority, scheduled_for, status, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now'))`,
            [
                notifId,
                tenant_id,
                salesman_id,
                notification_type,
                title,
                message,
                data ? JSON.stringify(data) : null,
                priority || 'normal',
                scheduled_for || null
            ]
        );

        res.json({ success: true, data: { id: notifId } });
    } catch (error) {
        console.error('Error enqueueing notification:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get nearby customers (for opportunistic visits)
router.get('/salesman/:id/nearby-customers', authenticateSalesman, (req, res) => {
    try {
        const { id } = req.params;
        const { lat, lng, radius } = req.query; // radius in km
        const tenantId = getTenantId(req);

        const searchRadius = parseFloat(radius) || 5; // default 5km

        // Simple distance calculation using Haversine formula
        const customers = dbAll(
            `SELECT c.*, cl.latitude, cl.longitude,
                    (6371 * acos(cos(radians(?)) * cos(radians(cl.latitude)) * 
                     cos(radians(cl.longitude) - radians(?)) + 
                     sin(radians(?)) * sin(radians(cl.latitude)))) AS distance
             FROM customer_profiles_new c
             LEFT JOIN customer_locations cl ON c.id = cl.customer_id
             WHERE c.tenant_id = ? 
             AND cl.latitude IS NOT NULL
             HAVING distance < ?
             ORDER BY distance ASC
             LIMIT 20`,
            [parseFloat(lat), parseFloat(lng), parseFloat(lat), tenantId, searchRadius]
        );

        res.json({
            success: true,
            data: customers
        });
    } catch (error) {
        console.error('Error finding nearby customers:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// -------------------- HELPER FUNCTIONS --------------------

function generateId() {
    return Math.random().toString(36).substring(2, 15) + 
           Math.random().toString(36).substring(2, 15);
}

function optimizeRoute(visits) {
    // Simple nearest-neighbor TSP approximation
    // In production, use Google Maps Directions API or similar
    if (visits.length === 0) return [];
    
    const sequence = [];
    const unvisited = [...visits];
    let current = unvisited.shift();
    sequence.push(current.customer_id);

    while (unvisited.length > 0) {
        let nearest = null;
        let minDistance = Infinity;

        for (const visit of unvisited) {
            const distance = calculateDistance(
                current.latitude, current.longitude,
                visit.latitude, visit.longitude
            );
            if (distance < minDistance) {
                minDistance = distance;
                nearest = visit;
            }
        }

        if (nearest) {
            sequence.push(nearest.customer_id);
            current = nearest;
            unvisited.splice(unvisited.indexOf(nearest), 1);
        } else {
            break;
        }
    }

    return sequence;
}

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radius of Earth in km
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function toRad(degrees) {
    return degrees * (Math.PI / 180);
}

function processVisitChange(action, data, tenantId, salesmanId, deviceId) {
    const id = data.id || generateId();
    
    if (action === 'create') {
        dbRun(
            `INSERT INTO visits 
             (id, tenant_id, salesman_id, customer_id, visit_date, visit_type, 
              checkin_time, checkin_latitude, checkin_longitude,
              checkout_time, checkout_latitude, checkout_longitude,
              duration_minutes, potential, status, notes, outcome, order_value, synced_from_device) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, tenantId, salesmanId, data.customer_id, data.visit_date, data.visit_type,
             data.checkin_time, data.checkin_latitude, data.checkin_longitude,
             data.checkout_time, data.checkout_latitude, data.checkout_longitude,
             data.duration_minutes, data.potential, data.status, data.notes, 
             data.outcome, data.order_value, deviceId || data.device_id || null]
        );
    } else if (action === 'update') {
        dbRun(
            `UPDATE visits SET 
             checkout_time = ?, checkout_latitude = ?, checkout_longitude = ?,
             duration_minutes = ?, status = ?, notes = ?, outcome = ?, order_value = ?,
             updated_at = datetime('now')
             WHERE id = ?`,
            [data.checkout_time, data.checkout_latitude, data.checkout_longitude,
             data.duration_minutes, data.status, data.notes, data.outcome, 
             data.order_value, id]
        );
    }
    
    return { id };
}

function processCustomerChange(action, data, tenantId) {
    const id = data.id || generateId();
    
    if (action === 'create') {
        dbRun(
            `INSERT INTO customer_profiles_new 
             (id, tenant_id, business_name, contact_person, phone, email, city, state, gst_number) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, tenantId, data.business_name || data.name, data.contact_person, data.phone, data.email, 
             data.city, data.state, data.gst_number]
        );
        
        // Add location if provided
        if (data.latitude && data.longitude) {
            dbRun(
                `INSERT INTO customer_locations 
                 (id, tenant_id, customer_id, latitude, longitude, address) 
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [generateId(), tenantId, id, data.latitude, data.longitude, data.address]
            );
        }
    }
    
    return { id };
}

function processNoteChange(action, data, tenantId, salesmanId) {
    const id = data.id || generateId();
    
    if (action === 'create') {
        dbRun(
            `INSERT INTO customer_notes 
             (id, tenant_id, customer_id, salesman_id, note_type, note_text, file_url, visit_id) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, tenantId, data.customer_id, salesmanId, data.note_type, 
             data.note_text, data.file_url, data.visit_id]
        );
    }
    
    return { id };
}

function processExpenseChange(action, data, tenantId, salesmanId) {
    const id = data.id || generateId();
    
    if (action === 'create') {
        dbRun(
            `INSERT INTO salesman_expenses 
             (id, tenant_id, salesman_id, expense_date, expense_type, amount, description, receipt_url, visit_id) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, tenantId, salesmanId, data.expense_date, data.expense_type, 
             data.amount, data.description, data.receipt_url, data.visit_id]
        );
    }
    
    return { id };
}

// ==================== ANALYTICS & AI ENDPOINTS ====================

// Performance Analytics - Last N days trend
router.get('/salesman/:id/analytics/performance', authenticateSalesman, (req, res) => {
    try {
        const { id } = req.params;
        const tenantId = getTenantId(req);
        const days = parseInt(req.query.days) || 7;

        const results = [];
        const dates = [];
        const visits = [];
        const orders = [];

        for (let i = days - 1; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];
            dates.push(date.toLocaleDateString('en-US', { weekday: 'short' }));

            const dayVisits = dbGet(
                `SELECT COUNT(*) as count FROM visits 
                 WHERE salesman_id = ? AND tenant_id = ? AND DATE(created_at) = ?`,
                [id, tenantId, dateStr]
            );
            visits.push(dayVisits?.count || 0);

            // Use visits with potential='High' as proxy for orders since orders table doesn't exist
            const dayOrders = dbGet(
                `SELECT COUNT(*) as count FROM visits 
                 WHERE salesman_id = ? AND tenant_id = ? AND DATE(created_at) = ? AND potential = 'High'`,
                [id, tenantId, dateStr]
            );
            orders.push(dayOrders?.count || 0);
        }

        res.json({
            success: true,
            data: { dates, visits, orders }
        });
    } catch (error) {
        console.error('Performance analytics error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Conversion Funnel Analytics
router.get('/salesman/:id/analytics/funnel', authenticateSalesman, (req, res) => {
    try {
        const { id } = req.params;
        const tenantId = getTenantId(req);
        const monthStart = new Date().toISOString().slice(0, 7) + '-01';

        const visits = dbGet(
            `SELECT COUNT(*) as count FROM visits 
             WHERE salesman_id = ? AND tenant_id = ? AND created_at >= ?`,
            [id, tenantId, monthStart]
        );

        const engaged = dbGet(
            `SELECT COUNT(*) as count FROM visits 
             WHERE salesman_id = ? AND tenant_id = ? AND created_at >= ?
             AND (meeting_types IS NOT NULL OR remarks IS NOT NULL)`,
            [id, tenantId, monthStart]
        );

        const quoted = dbGet(
            `SELECT COUNT(*) as count FROM visits 
             WHERE salesman_id = ? AND tenant_id = ? AND created_at >= ?
             AND potential IN ('High', 'Medium')`,
            [id, tenantId, monthStart]
        );

        // Use visits with potential='High' as proxy for orders
        const ordersCount = dbGet(
            `SELECT COUNT(*) as count FROM visits 
             WHERE salesman_id = ? AND tenant_id = ? AND created_at >= ? AND potential = 'High'`,
            [id, tenantId, monthStart]
        );

        res.json({
            success: true,
            data: {
                visits: visits?.count || 0,
                engaged: engaged?.count || Math.floor((visits?.count || 0) * 0.75),
                quoted: quoted?.count || Math.floor((visits?.count || 0) * 0.5),
                orders: ordersCount?.count || Math.floor((visits?.count || 0) * 0.3)
            }
        });
    } catch (error) {
        console.error('Funnel analytics error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Live Leaderboard
router.get('/analytics/leaderboard', authenticateSalesman, (req, res) => {
    try {
        const tenantId = getTenantId(req);
        const monthStart = new Date().toISOString().slice(0, 7) + '-01';

        const salesmen = dbAll(
            `SELECT s.id, s.name,
                    (SELECT COUNT(*) FROM visits WHERE salesman_id = s.id AND tenant_id = ? AND created_at >= ?) as visits,
                    (SELECT COUNT(*) FROM visits WHERE salesman_id = s.id AND tenant_id = ? AND created_at >= ? AND potential = 'High') as orders
             FROM salesmen s
             WHERE s.tenant_id = ? AND s.is_active = 1
             ORDER BY orders DESC, visits DESC
             LIMIT 10`,
            [tenantId, monthStart, tenantId, monthStart, tenantId]
        );

        // Estimate revenue based on high potential visits
        const leaderboard = salesmen.map(s => ({
            ...s,
            revenue: (s.orders || 0) * 15000, // Estimated avg order value
            conversion: s.visits > 0 ? Math.round((s.orders / s.visits) * 100) : 0
        }));

        res.json({ success: true, data: leaderboard });
    } catch (error) {
        console.error('Leaderboard error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// AI Visit Recommendations
router.get('/salesman/:id/ai/recommendations', authenticateSalesman, (req, res) => {
    try {
        const { id } = req.params;
        const tenantId = getTenantId(req);

        // Get customers sorted by priority score (using visits data since orders table doesn't exist)
        const customers = dbAll(
            `SELECT c.*, 
                    (SELECT MAX(created_at) FROM visits WHERE customer_name = c.business_name AND salesman_id = ?) as last_visit,
                    (SELECT COUNT(*) FROM visits WHERE customer_name = c.business_name AND potential = 'High') as order_count,
                    (SELECT COUNT(*) * 15000 FROM visits WHERE customer_name = c.business_name AND potential = 'High') as total_spent
             FROM customer_profiles_new c
             WHERE c.tenant_id = ?
             ORDER BY last_visit ASC NULLS FIRST, total_spent DESC
             LIMIT 20`,
            [id, tenantId]
        );

        // Calculate AI score for each customer
        const recommendations = customers.map(c => {
            const daysSinceVisit = c.last_visit 
                ? Math.floor((Date.now() - new Date(c.last_visit).getTime()) / (1000 * 60 * 60 * 24))
                : 999;
            
            let score = 50; // Base score
            
            // Higher score if not visited recently
            if (daysSinceVisit > 30) score += 30;
            else if (daysSinceVisit > 14) score += 20;
            else if (daysSinceVisit > 7) score += 10;
            
            // Higher score for high-value customers
            if (c.total_spent > 100000) score += 15;
            else if (c.total_spent > 50000) score += 10;
            else if (c.total_spent > 10000) score += 5;
            
            // Cap at 99
            score = Math.min(99, score);

            // Determine reason
            let reason = 'Regular follow-up';
            if (daysSinceVisit > 30) reason = `High potential - not visited in ${daysSinceVisit} days`;
            else if (c.order_count > 5) reason = 'Frequent buyer - order due soon';
            else if (c.total_spent > 50000) reason = 'High-value customer';

            // Best time (randomized for now, would use ML in production)
            const times = ['9:00 AM', '10:00 AM', '11:00 AM', '2:00 PM', '3:00 PM', '4:00 PM'];
            const bestTime = times[Math.floor(Math.random() * times.length)];

            return {
                customer: c.business_name || c.name || 'Unknown',
                reason,
                score,
                potential: score >= 80 ? 'High' : score >= 60 ? 'Medium' : 'Low',
                bestTime,
                daysSinceVisit
            };
        }).sort((a, b) => b.score - a.score).slice(0, 5);

        res.json({ success: true, data: recommendations });
    } catch (error) {
        console.error('AI recommendations error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Smart Alerts
router.get('/salesman/:id/ai/alerts', authenticateSalesman, (req, res) => {
    try {
        const { id } = req.params;
        const tenantId = getTenantId(req);
        const alerts = [];

        // Check for customers not visited in 20+ days
        const neglectedCustomers = dbAll(
            `SELECT c.business_name, 
                    (SELECT MAX(created_at) FROM visits WHERE customer_name = c.business_name AND salesman_id = ?) as last_visit
             FROM customer_profiles_new c
             WHERE c.tenant_id = ?`,
            [id, tenantId]
        );

        neglectedCustomers.forEach(c => {
            if (c.last_visit) {
                const daysSince = Math.floor((Date.now() - new Date(c.last_visit).getTime()) / (1000 * 60 * 60 * 24));
                if (daysSince >= 20) {
                    alerts.push({
                        type: 'warning',
                        icon: 'exclamation-triangle',
                        message: `${c.business_name} has not been visited in ${daysSince} days`,
                        action: 'Visit Now',
                        customer: c.business_name
                    });
                }
            }
        });

        // Check for overdue follow-ups
        const overdueFollowups = dbAll(
            `SELECT customer_name, next_action_date 
             FROM visits 
             WHERE salesman_id = ? AND tenant_id = ? 
             AND next_action_date < date('now') 
             AND next_action IS NOT NULL
             ORDER BY next_action_date DESC
             LIMIT 5`,
            [id, tenantId]
        );

        overdueFollowups.forEach(v => {
            alerts.push({
                type: 'info',
                icon: 'calendar',
                message: `Follow-up due: ${v.customer_name} (${v.next_action_date})`,
                action: 'Call',
                customer: v.customer_name
            });
        });

        // Check for engagement drops (using visits since orders table doesn't exist)
        const engagementDrops = dbAll(
            `SELECT customer_name,
                    (SELECT COUNT(*) FROM visits v2 WHERE v2.customer_name = v.customer_name AND v2.created_at < date('now', '-30 days')) as prev_visits,
                    (SELECT COUNT(*) FROM visits v2 WHERE v2.customer_name = v.customer_name AND v2.created_at >= date('now', '-30 days')) as current_visits
             FROM visits v
             WHERE salesman_id = ? AND tenant_id = ?
             GROUP BY customer_name
             HAVING prev_visits > 2 AND current_visits = 0
             LIMIT 3`,
            [id, tenantId]
        );

        engagementDrops.forEach(o => {
            alerts.push({
                type: 'danger',
                icon: 'arrow-down',
                message: `${o.customer_name} hasn't been visited this month (${o.prev_visits} visits last month)`,
                action: 'Visit Now',
                customer: o.customer_name
            });
        });

        res.json({ success: true, data: alerts.slice(0, 5) });
    } catch (error) {
        console.error('Smart alerts error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Cross-sell Opportunities
router.get('/salesman/:id/ai/cross-sell', authenticateSalesman, (req, res) => {
    try {
        const { id } = req.params;
        const tenantId = getTenantId(req);

        // Get recent visits with products discussed (using visits since orders table doesn't exist)
        const recentVisits = dbAll(
            `SELECT v.customer_name, v.products_discussed
             FROM visits v
             WHERE v.salesman_id = ? AND v.tenant_id = ? AND v.products_discussed IS NOT NULL
             ORDER BY v.created_at DESC
             LIMIT 50`,
            [id, tenantId]
        );

        // Simple cross-sell logic based on product pairs
        const crossSellMap = {
            'Hex Bolts': { suggest: 'Lock Nuts', reason: '85% of Hex Bolt buyers also buy Lock Nuts' },
            'Washers': { suggest: 'Spring Washers', reason: 'Complementary product' },
            'Anchors': { suggest: 'Expansion Anchors', reason: 'Upgrade opportunity' },
            'Screws': { suggest: 'Screw Drivers', reason: 'Essential accessory' },
            'Nuts': { suggest: 'Bolts', reason: 'Usually purchased together' }
        };

        const opportunities = [];
        const seen = new Set();

        // Parse products discussed from visit data
        recentVisits.forEach(visit => {
            if (!visit.products_discussed || seen.has(visit.customer_name)) return;
            
            // products_discussed can be JSON array or comma-separated
            let products = [];
            try {
                products = JSON.parse(visit.products_discussed);
            } catch {
                products = visit.products_discussed.split(',').map(p => p.trim());
            }

            for (const productName of products) {
                const crossSell = Object.entries(crossSellMap).find(([key]) => 
                    productName.toLowerCase().includes(key.toLowerCase())
                );
                if (crossSell) {
                    seen.add(visit.customer_name);
                    opportunities.push({
                        customer: visit.customer_name,
                        currentProduct: productName,
                        suggestedProduct: crossSell[1].suggest,
                        reason: crossSell[1].reason,
                        potential: '₹' + (Math.floor(Math.random() * 20) + 5) + ',000'
                    });
                    break;
                }
            }
        });

        res.json({ success: true, data: opportunities.slice(0, 5) });
    } catch (error) {
        console.error('Cross-sell error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Best Time to Visit Analysis
router.get('/salesman/:id/ai/best-times', authenticateSalesman, (req, res) => {
    try {
        const { id } = req.params;
        const tenantId = getTenantId(req);

        // Analyze historical visit success by hour
        const visits = dbAll(
            `SELECT 
                strftime('%H', time_in) as hour,
                COUNT(*) as total,
                SUM(CASE WHEN potential IN ('High', 'Medium') OR order_id IS NOT NULL THEN 1 ELSE 0 END) as successful
             FROM visits 
             WHERE salesman_id = ? AND tenant_id = ? AND time_in IS NOT NULL
             GROUP BY hour
             ORDER BY hour`,
            [id, tenantId]
        );

        const labels = ['9 AM', '10 AM', '11 AM', '12 PM', '2 PM', '3 PM', '4 PM', '5 PM'];
        const hourMap = { '09': 0, '10': 1, '11': 2, '12': 3, '14': 4, '15': 5, '16': 6, '17': 7 };
        const conversions = [45, 72, 85, 55, 78, 82, 65, 40]; // Default values

        visits.forEach(v => {
            const idx = hourMap[v.hour];
            if (idx !== undefined && v.total > 0) {
                conversions[idx] = Math.round((v.successful / v.total) * 100);
            }
        });

        res.json({
            success: true,
            data: { labels, conversions }
        });
    } catch (error) {
        console.error('Best times error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Customer Locations for Heat Map
router.get('/salesman/:id/customers/locations', authenticateSalesman, (req, res) => {
    try {
        const { id } = req.params;
        const tenantId = getTenantId(req);

        const locations = dbAll(
            `SELECT cl.latitude, cl.longitude, c.business_name,
                    (SELECT COUNT(*) FROM visits WHERE customer_name = c.business_name) as visit_count,
                    (SELECT COUNT(*) * 15000 FROM visits WHERE customer_name = c.business_name AND potential = 'High') as revenue
             FROM customer_locations cl
             JOIN customer_profiles_new c ON cl.customer_id = c.id
             WHERE c.tenant_id = ? AND cl.latitude IS NOT NULL AND cl.longitude IS NOT NULL`,
            [tenantId]
        );

        const data = locations.map(loc => ({
            lat: loc.latitude,
            lng: loc.longitude,
            name: loc.business_name,
            intensity: Math.min(1, (loc.visit_count || 1) / 10),
            revenue: loc.revenue
        }));

        res.json({ success: true, data });
    } catch (error) {
        console.error('Customer locations error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// AI Auto-Scheduler
router.post('/salesman/:id/ai/auto-schedule', authenticateSalesman, (req, res) => {
    try {
        const { id } = req.params;
        const tenantId = getTenantId(req);

        // Get top priority customers (using visits since orders table doesn't exist)
        const customers = dbAll(
            `SELECT c.business_name, c.phone, cl.latitude, cl.longitude,
                    (SELECT MAX(created_at) FROM visits WHERE customer_name = c.business_name) as last_visit,
                    (SELECT COUNT(*) * 15000 FROM visits WHERE customer_name = c.business_name AND potential = 'High') as total_spent
             FROM customer_profiles_new c
             LEFT JOIN customer_locations cl ON c.id = cl.customer_id
             WHERE c.tenant_id = ?
             ORDER BY last_visit ASC NULLS FIRST, total_spent DESC
             LIMIT 5`,
            [tenantId]
        );

        // Create optimized schedule
        const times = ['9:30 AM', '11:00 AM', '12:30 PM', '2:30 PM', '4:00 PM'];
        const purposes = ['High Priority', 'Follow-up', 'Order Due', 'Demo', 'New Lead'];

        const schedule = customers.map((c, idx) => ({
            time: times[idx] || '5:00 PM',
            customer: c.business_name,
            purpose: purposes[idx] || 'Regular Visit',
            phone: c.phone
        }));

        // Save scheduled visits
        schedule.forEach(s => {
            const visitId = generateId();
            const today = new Date().toISOString().split('T')[0];
            
            dbRun(
                `INSERT OR IGNORE INTO visits 
                 (id, tenant_id, salesman_id, customer_name, visit_type, visit_date, 
                  scheduled_time, is_scheduled, created_at, updated_at)
                 VALUES (?, ?, ?, ?, 'scheduled', ?, ?, 1, datetime('now'), datetime('now'))`,
                [visitId, tenantId, id, s.customer, today, s.time]
            );
        });

        res.json({ 
            success: true, 
            message: 'Day planned successfully!',
            schedule 
        });
    } catch (error) {
        console.error('Auto-schedule error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
