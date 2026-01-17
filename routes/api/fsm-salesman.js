const express = require('express');
const router = express.Router();
const db = require('../../services/database');

// ============================================
// SALESMAN EMPOWERMENT API ROUTES
// Mobile App & Desktop App Support
// ============================================

// -------------------- DASHBOARD --------------------

// Get salesman dashboard stats (for mobile/desktop home screen)
router.get('/salesman/:id/dashboard', async (req, res) => {
    try {
        const { id } = req.params;
        const { date } = req.query; // optional specific date, defaults to today
        const targetDate = date || new Date().toISOString().split('T')[0];
        const tenantId = req.query.tenant_id;

        // Get today's stats
        const todayVisits = await db.getAllAsync(
            `SELECT * FROM visits 
             WHERE salesman_id = ? AND tenant_id = ? 
             AND DATE(visit_date) = ?`,
            [id, tenantId, targetDate]
        );

        // Get month stats
        const monthStart = targetDate.substring(0, 7) + '-01';
        const monthVisits = await db.getAllAsync(
            `SELECT * FROM visits 
             WHERE salesman_id = ? AND tenant_id = ? 
             AND strftime('%Y-%m', visit_date) = strftime('%Y-%m', ?)`,
            [id, tenantId, monthStart]
        );

        // Get targets
        const target = await db.getAsync(
            `SELECT * FROM salesman_targets 
             WHERE salesman_id = ? AND tenant_id = ? 
             AND period = strftime('%Y-%m', ?)`,
            [id, tenantId, targetDate]
        );

        // Get pending visits
        const pendingVisits = await db.getAllAsync(
            `SELECT v.*, c.name as customer_name, c.phone, c.address 
             FROM visits v
             LEFT JOIN customers c ON v.customer_id = c.id
             WHERE v.salesman_id = ? AND v.tenant_id = ? 
             AND v.status = 'scheduled' 
             AND DATE(v.visit_date) >= ?
             ORDER BY v.visit_date ASC
             LIMIT 10`,
            [id, tenantId, targetDate]
        );

        // Get recent commissions
        const commissions = await db.getAllAsync(
            `SELECT SUM(commission_amount) as total_pending
             FROM salesman_commissions 
             WHERE salesman_id = ? AND tenant_id = ? 
             AND status = 'pending'`,
            [id, tenantId]
        );

        res.json({
            success: true,
            data: {
                today: {
                    date: targetDate,
                    visits_completed: todayVisits.filter(v => v.status === 'completed').length,
                    visits_scheduled: todayVisits.filter(v => v.status === 'scheduled').length,
                    orders_taken: todayVisits.filter(v => v.outcome === 'Order').length
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
router.get('/salesman/:id/sync-data', async (req, res) => {
    try {
        const { id } = req.params;
        const { last_sync_timestamp } = req.query;
        const tenantId = req.query.tenant_id;

        // Get salesman profile
        const salesman = await db.getAsync(
            'SELECT * FROM salesmen WHERE id = ? AND tenant_id = ?',
            [id, tenantId]
        );

        if (!salesman) {
            return res.status(404).json({ success: false, error: 'Salesman not found' });
        }

        // Get customers assigned to this salesman
        const customers = await db.getAllAsync(
            `SELECT c.*, cl.latitude, cl.longitude, cl.address as gps_address
             FROM customers c
             LEFT JOIN customer_locations cl ON c.id = cl.customer_id
             WHERE c.tenant_id = ? 
             ${last_sync_timestamp ? 'AND c.updated_at > ?' : ''}
             ORDER BY c.name`,
            last_sync_timestamp ? [tenantId, last_sync_timestamp] : [tenantId]
        );

        // Get visits (last 30 days + future scheduled)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const visits = await db.getAllAsync(
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
        const target = await db.getAsync(
            'SELECT * FROM salesman_targets WHERE salesman_id = ? AND tenant_id = ? AND period = ?',
            [id, tenantId, currentMonth]
        );

        // Get products (limited fields for mobile)
        const products = await db.getAllAsync(
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

// Upload offline changes (bulk sync from mobile/desktop)
router.post('/salesman/:id/sync-upload', async (req, res) => {
    try {
        const { id } = req.params;
        const { device_id, changes } = req.body;
        const tenantId = req.body.tenant_id;

        const results = {
            success: 0,
            failed: 0,
            errors: []
        };

        // Process each change
        for (const change of changes) {
            try {
                const { entity_type, action, data, client_id } = change;

                let result;
                switch (entity_type) {
                    case 'visit':
                        result = await processVisitChange(action, data, tenantId, id);
                        break;
                    case 'customer':
                        result = await processCustomerChange(action, data, tenantId);
                        break;
                    case 'note':
                        result = await processNoteChange(action, data, tenantId, id);
                        break;
                    case 'expense':
                        result = await processExpenseChange(action, data, tenantId, id);
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
        await db.runAsync(
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

// -------------------- ROUTE PLANNING --------------------

// Get optimal route plan for the day
router.get('/salesman/:id/route-plan', async (req, res) => {
    try {
        const { id } = req.params;
        const { date } = req.query;
        const tenantId = req.query.tenant_id;
        const targetDate = date || new Date().toISOString().split('T')[0];

        // Get scheduled visits for the day
        const visits = await db.getAllAsync(
            `SELECT v.*, c.name as customer_name, 
                    cl.latitude, cl.longitude, cl.address
             FROM visits v
             LEFT JOIN customers c ON v.customer_id = c.id
             LEFT JOIN customer_locations cl ON c.id = cl.customer_id
             WHERE v.salesman_id = ? AND v.tenant_id = ? 
             AND DATE(v.visit_date) = ?
             ORDER BY v.visit_date`,
            [id, tenantId, targetDate]
        );

        // Get or create route plan
        let routePlan = await db.getAsync(
            'SELECT * FROM route_plans WHERE salesman_id = ? AND plan_date = ?',
            [id, targetDate]
        );

        if (!routePlan && visits.length > 0) {
            // Create optimized route (simple nearest-neighbor algorithm)
            const optimizedSequence = optimizeRoute(visits);
            
            const planId = generateId();
            await db.runAsync(
                `INSERT INTO route_plans 
                 (id, tenant_id, salesman_id, plan_date, customer_sequence, status) 
                 VALUES (?, ?, ?, ?, ?, 'planned')`,
                [planId, tenantId, id, targetDate, JSON.stringify(optimizedSequence)]
            );

            routePlan = await db.getAsync('SELECT * FROM route_plans WHERE id = ?', [planId]);
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

// Get nearby customers (for opportunistic visits)
router.get('/salesman/:id/nearby-customers', async (req, res) => {
    try {
        const { id } = req.params;
        const { lat, lng, radius } = req.query; // radius in km
        const tenantId = req.query.tenant_id;

        const searchRadius = parseFloat(radius) || 5; // default 5km

        // Simple distance calculation using Haversine formula
        const customers = await db.getAllAsync(
            `SELECT c.*, cl.latitude, cl.longitude,
                    (6371 * acos(cos(radians(?)) * cos(radians(cl.latitude)) * 
                     cos(radians(cl.longitude) - radians(?)) + 
                     sin(radians(?)) * sin(radians(cl.latitude)))) AS distance
             FROM customers c
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

async function processVisitChange(action, data, tenantId, salesmanId) {
    const id = data.id || generateId();
    
    if (action === 'create') {
        await db.runAsync(
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
             data.outcome, data.order_value, data.device_id]
        );
    } else if (action === 'update') {
        await db.runAsync(
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

async function processCustomerChange(action, data, tenantId) {
    const id = data.id || generateId();
    
    if (action === 'create') {
        await db.runAsync(
            `INSERT INTO customers 
             (id, tenant_id, name, phone, email, address, city, state, pincode, customer_type) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, tenantId, data.name, data.phone, data.email, data.address, 
             data.city, data.state, data.pincode, data.customer_type]
        );
        
        // Add location if provided
        if (data.latitude && data.longitude) {
            await db.runAsync(
                `INSERT INTO customer_locations 
                 (id, tenant_id, customer_id, latitude, longitude, address) 
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [generateId(), tenantId, id, data.latitude, data.longitude, data.address]
            );
        }
    }
    
    return { id };
}

async function processNoteChange(action, data, tenantId, salesmanId) {
    const id = data.id || generateId();
    
    if (action === 'create') {
        await db.runAsync(
            `INSERT INTO customer_notes 
             (id, tenant_id, customer_id, salesman_id, note_type, note_text, file_url, visit_id) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, tenantId, data.customer_id, salesmanId, data.note_type, 
             data.note_text, data.file_url, data.visit_id]
        );
    }
    
    return { id };
}

async function processExpenseChange(action, data, tenantId, salesmanId) {
    const id = data.id || generateId();
    
    if (action === 'create') {
        await db.runAsync(
            `INSERT INTO salesman_expenses 
             (id, tenant_id, salesman_id, expense_date, expense_type, amount, description, receipt_url, visit_id) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, tenantId, salesmanId, data.expense_date, data.expense_type, 
             data.amount, data.description, data.receipt_url, data.visit_id]
        );
    }
    
    return { id };
}

module.exports = router;
