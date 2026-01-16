/**
 * FSM (Field Sales Management) API Routes
 * Handles visits, salesmen, targets, and branches data
 */

const express = require('express');
const router = express.Router();
const Database = require('better-sqlite3');
const path = require('path');

// Direct SQLite connection for FSM data
const db = new Database(path.join(__dirname, '../../local-database.db'));
db.pragma('journal_mode = WAL');

// Get all visits with optional filtering
router.get('/visits', async (req, res) => {
  try {
    const DEFAULT_TENANT_ID = process.env.FSM_DEFAULT_TENANT_ID || '112f12b8-55e9-4de8-9fda-d58e37c75796';
    const tenant_id = req.query.tenant_id || DEFAULT_TENANT_ID;
    const { salesman_id, plant_id, start_date, end_date, visit_type, limit = 300, role, user_plant_id } = req.query;
    
    let query = `
      SELECT 
        v.*,
        s.name as salesman_name,
        s.phone as salesman_phone,
        COALESCE(p.name, v.plant_id) as plant_name
      FROM visits v
      LEFT JOIN salesmen s ON s.id = v.salesman_id
      LEFT JOIN plants p ON p.id = v.plant_id
      WHERE 1=1
    `;
    const params = [];
    
    // Tenant filtering
    query += ' AND v.tenant_id = ?';
    params.push(tenant_id);

    // Role-based filtering
    // - 'super_admin' or 'admin': See all data
    // - 'plant_admin': See only their plant
    // - 'salesman': See only their own visits
    if (role === 'salesman' && salesman_id) {
      query += ' AND v.salesman_id = ?';
      params.push(salesman_id);
    } else if (role === 'plant_admin' && user_plant_id) {
      query += ' AND v.plant_id = ?';
      params.push(user_plant_id);
    }
    // super_admin and admin see all - no additional filter
    
    // Additional filters
    if (salesman_id && role !== 'salesman') {
      query += ' AND v.salesman_id = ?';
      params.push(salesman_id);
    }
    
    if (plant_id) {
      query += ' AND v.plant_id = ?';
      params.push(plant_id);
    }
    
    if (start_date) {
      query += ' AND v.visit_date >= ?';
      params.push(start_date);
    }
    
    if (end_date) {
      query += ' AND v.visit_date <= ?';
      params.push(end_date);
    }
    
    if (visit_type) {
      query += ' AND v.visit_type = ?';
      params.push(visit_type);
    }
    
    query += ' ORDER BY v.visit_date DESC, v.created_at DESC LIMIT ?';
    params.push(parseInt(limit));
    
    const visits = db.prepare(query).all(...params);
    
    res.json({
      success: true,
      data: visits,
      count: visits.length
    });
  } catch (error) {
    console.error('[FSM_API] Error fetching visits:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get visit statistics
router.get('/visits/stats', async (req, res) => {
  try {
    const DEFAULT_TENANT_ID = process.env.FSM_DEFAULT_TENANT_ID || '112f12b8-55e9-4de8-9fda-d58e37c75796';
    const tenant_id = req.query.tenant_id || DEFAULT_TENANT_ID;
    const { start_date, end_date } = req.query;
    
    let query = 'SELECT COUNT(*) as total FROM visits WHERE 1=1';
    const params = [];

    if (tenant_id) {
      query += ' AND tenant_id = ?';
      params.push(tenant_id);
    }
    
    if (start_date) {
      query += ' AND visit_date >= ?';
      params.push(start_date);
    }
    
    if (end_date) {
      query += ' AND visit_date <= ?';
      params.push(end_date);
    }
    
    const totalResult = db.prepare(query).get(...params);
    const total = totalResult?.total || 0;
    
    // Get today's visits
    const today = new Date().toISOString().split('T')[0];
    const todayResult = db.prepare(
      'SELECT COUNT(*) as count FROM visits WHERE visit_date = ?' + (tenant_id ? ' AND tenant_id = ?' : '')
    ).get(...(tenant_id ? [today, tenant_id] : [today]));
    const today_visits = todayResult?.count || 0;
    
    // Get unique salesmen active today
    const activeTodayResult = db.prepare(
      'SELECT COUNT(DISTINCT salesman_id) as count FROM visits WHERE visit_date = ?' + (tenant_id ? ' AND tenant_id = ?' : '')
    ).get(...(tenant_id ? [today, tenant_id] : [today]));
    const active_today = activeTodayResult?.count || 0;
    
    // Average visits per day (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const avgResult = db.prepare(
      'SELECT COUNT(*) as count FROM visits WHERE visit_date >= ?' + (tenant_id ? ' AND tenant_id = ?' : '')
    ).get(...(tenant_id ? [thirtyDaysAgo.toISOString().split('T')[0], tenant_id] : [thirtyDaysAgo.toISOString().split('T')[0]]));
    const avg_per_day = Math.round((avgResult?.count || 0) / 30);
    
    res.json({
      success: true,
      stats: {
        total,
        today_visits,
        active_today,
        avg_per_day
      }
    });
  } catch (error) {
    console.error('[FSM_API] Error fetching visit stats:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get all salesmen
router.get('/salesmen', async (req, res) => {
  try {
    const DEFAULT_TENANT_ID = process.env.FSM_DEFAULT_TENANT_ID || '112f12b8-55e9-4de8-9fda-d58e37c75796';
    const tenant_id = req.query.tenant_id || DEFAULT_TENANT_ID;
    const { is_active, limit = 100 } = req.query;
    
    let query = 'SELECT * FROM salesmen WHERE 1=1';
    const params = [];

    if (tenant_id) {
      query += ' AND tenant_id = ?';
      params.push(tenant_id);
    }
    
    if (is_active !== undefined) {
      query += ' AND is_active = ?';
      params.push(is_active === 'true' || is_active === '1' ? 1 : 0);
    }
    
    query += ' ORDER BY name LIMIT ?';
    params.push(parseInt(limit));
    
    const salesmen = db.prepare(query).all(...params);
    
    res.json({
      success: true,
      data: salesmen,
      count: salesmen.length
    });
  } catch (error) {
    console.error('[FSM_API] Error fetching salesmen:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Create new salesman
router.post('/salesmen', async (req, res) => {
  try {
    const DEFAULT_TENANT_ID = process.env.FSM_DEFAULT_TENANT_ID || '112f12b8-55e9-4de8-9fda-d58e37c75796';
    const { name, phone, email, plant_id, is_active, tenant_id } = req.body;
    
    if (!name || !phone) {
      return res.status(400).json({
        success: false,
        error: 'Name and phone are required'
      });
    }
    
    // Generate UUID for new salesman
    const id = require('crypto').randomUUID();
    const finalTenantId = tenant_id || DEFAULT_TENANT_ID;
    
    const insertQuery = `
      INSERT INTO salesmen (id, tenant_id, name, phone, email, plant_id, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `;
    
    db.prepare(insertQuery).run(
      id,
      finalTenantId,
      name,
      phone,
      email || null,
      plant_id || null,
      is_active ? 1 : 0
    );
    
    // Fetch the created salesman
    const salesman = db.prepare('SELECT * FROM salesmen WHERE id = ?').get(id);
    
    res.json({
      success: true,
      data: salesman,
      message: 'Salesman created successfully'
    });
  } catch (error) {
    console.error('[FSM_API] Error creating salesman:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Update salesman
router.put('/salesmen/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, phone, email, plant_id, is_active } = req.body;
    
    // Check if salesman exists
    const existing = db.prepare('SELECT * FROM salesmen WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Salesman not found'
      });
    }
    
    const updateQuery = `
      UPDATE salesmen 
      SET name = ?, phone = ?, email = ?, plant_id = ?, is_active = ?, updated_at = datetime('now')
      WHERE id = ?
    `;
    
    db.prepare(updateQuery).run(
      name || existing.name,
      phone || existing.phone,
      email !== undefined ? email : existing.email,
      plant_id !== undefined ? plant_id : existing.plant_id,
      is_active !== undefined ? (is_active ? 1 : 0) : existing.is_active,
      id
    );
    
    // Fetch updated salesman
    const salesman = db.prepare('SELECT * FROM salesmen WHERE id = ?').get(id);
    
    res.json({
      success: true,
      data: salesman,
      message: 'Salesman updated successfully'
    });
  } catch (error) {
    console.error('[FSM_API] Error updating salesman:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Delete salesman
router.delete('/salesmen/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if salesman exists
    const existing = db.prepare('SELECT * FROM salesmen WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Salesman not found'
      });
    }
    
    // Delete associated data first (visits, targets)
    db.prepare('DELETE FROM visits WHERE salesman_id = ?').run(id);
    db.prepare('DELETE FROM salesman_targets WHERE salesman_id = ?').run(id);
    
    // Delete salesman
    db.prepare('DELETE FROM salesmen WHERE id = ?').run(id);
    
    res.json({
      success: true,
      message: 'Salesman and associated records deleted successfully'
    });
  } catch (error) {
    console.error('[FSM_API] Error deleting salesman:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get salesman statistics
router.get('/salesmen/stats', async (req, res) => {
  try {
    const DEFAULT_TENANT_ID = process.env.FSM_DEFAULT_TENANT_ID || '112f12b8-55e9-4de8-9fda-d58e37c75796';
    const tenant_id = req.query.tenant_id || DEFAULT_TENANT_ID;
    const totalResult = db.prepare(
      'SELECT COUNT(*) as count FROM salesmen' + (tenant_id ? ' WHERE tenant_id = ?' : '')
    ).get(...(tenant_id ? [tenant_id] : []));
    const total = totalResult?.count || 0;
    
    const activeResult = db.prepare(
      'SELECT COUNT(*) as count FROM salesmen WHERE is_active = 1' + (tenant_id ? ' AND tenant_id = ?' : '')
    ).get(...(tenant_id ? [tenant_id] : []));
    const active = activeResult?.count || 0;
    
    // Get active today (visited today)
    const today = new Date().toISOString().split('T')[0];
    const activeTodayResult = db.prepare(
      'SELECT COUNT(DISTINCT salesman_id) as count FROM visits WHERE visit_date = ?' + (tenant_id ? ' AND tenant_id = ?' : '')
    ).get(...(tenant_id ? [today, tenant_id] : [today]));
    const active_today = activeTodayResult?.count || 0;
    
    res.json({
      success: true,
      stats: {
        total,
        active,
        active_today,
        inactive: total - active
      }
    });
  } catch (error) {
    console.error('[FSM_API] Error fetching salesman stats:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get all targets
router.get('/targets', async (req, res) => {
  try {
    const DEFAULT_TENANT_ID = process.env.FSM_DEFAULT_TENANT_ID || '112f12b8-55e9-4de8-9fda-d58e37c75796';
    const tenant_id = req.query.tenant_id || DEFAULT_TENANT_ID;
    const { salesman_id, period, limit = 100 } = req.query;
    
    let query = 'SELECT * FROM salesman_targets WHERE 1=1';
    const params = [];

    if (tenant_id) {
      query += ' AND tenant_id = ?';
      params.push(tenant_id);
    }
    
    if (salesman_id) {
      query += ' AND salesman_id = ?';
      params.push(salesman_id);
    }
    
    if (period) {
      query += ' AND period = ?';
      params.push(period);
    }
    
    query += ' ORDER BY period DESC, created_at DESC LIMIT ?';
    params.push(parseInt(limit));
    
    const targets = db.prepare(query).all(...params);
    
    res.json({
      success: true,
      data: targets,
      count: targets.length
    });
  } catch (error) {
    console.error('[FSM_API] Error fetching targets:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Create new target
router.post('/targets', async (req, res) => {
  try {
    const DEFAULT_TENANT_ID = process.env.FSM_DEFAULT_TENANT_ID || '112f12b8-55e9-4de8-9fda-d58e37c75796';
    const { salesman_id, period, target_visits, target_orders, target_revenue, target_new_customers, plant_id, tenant_id } = req.body;
    
    if (!salesman_id || !period) {
      return res.status(400).json({
        success: false,
        error: 'Salesman ID and period are required'
      });
    }
    
    const id = require('crypto').randomUUID();
    const finalTenantId = tenant_id || DEFAULT_TENANT_ID;
    
    const insertQuery = `
      INSERT INTO salesman_targets (
        id, tenant_id, salesman_id, plant_id, period,
        target_visits, target_orders, target_revenue, target_new_customers,
        achieved_visits, achieved_orders, achieved_revenue, achieved_new_customers,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0.0, 0, datetime('now'), datetime('now'))
    `;
    
    db.prepare(insertQuery).run(
      id,
      finalTenantId,
      salesman_id,
      plant_id || null,
      period,
      target_visits || 0,
      target_orders || 0,
      target_revenue || 0.0,
      target_new_customers || 0
    );
    
    const target = db.prepare('SELECT * FROM salesman_targets WHERE id = ?').get(id);
    
    res.json({
      success: true,
      data: target,
      message: 'Target created successfully'
    });
  } catch (error) {
    console.error('[FSM_API] Error creating target:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Update target
router.put('/targets/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { salesman_id, period, target_visits, target_orders, target_revenue, target_new_customers, plant_id } = req.body;
    
    const existing = db.prepare('SELECT * FROM salesman_targets WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Target not found'
      });
    }
    
    const updateQuery = `
      UPDATE salesman_targets 
      SET salesman_id = ?, period = ?, plant_id = ?,
          target_visits = ?, target_orders = ?, target_revenue = ?, target_new_customers = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `;
    
    db.prepare(updateQuery).run(
      salesman_id || existing.salesman_id,
      period || existing.period,
      plant_id !== undefined ? plant_id : existing.plant_id,
      target_visits !== undefined ? target_visits : existing.target_visits,
      target_orders !== undefined ? target_orders : existing.target_orders,
      target_revenue !== undefined ? target_revenue : existing.target_revenue,
      target_new_customers !== undefined ? target_new_customers : existing.target_new_customers,
      id
    );
    
    const target = db.prepare('SELECT * FROM salesman_targets WHERE id = ?').get(id);
    
    res.json({
      success: true,
      data: target,
      message: 'Target updated successfully'
    });
  } catch (error) {
    console.error('[FSM_API] Error updating target:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Delete target
router.delete('/targets/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const existing = db.prepare('SELECT * FROM salesman_targets WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Target not found'
      });
    }
    
    db.prepare('DELETE FROM salesman_targets WHERE id = ?').run(id);
    
    res.json({
      success: true,
      message: 'Target deleted successfully'
    });
  } catch (error) {
    console.error('[FSM_API] Error deleting target:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get target statistics
router.get('/targets/stats', async (req, res) => {
  try {
    const DEFAULT_TENANT_ID = process.env.FSM_DEFAULT_TENANT_ID || '112f12b8-55e9-4de8-9fda-d58e37c75796';
    const tenant_id = req.query.tenant_id || DEFAULT_TENANT_ID;
    const totalResult = db.prepare(
      'SELECT COUNT(*) as count FROM salesman_targets' + (tenant_id ? ' WHERE tenant_id = ?' : '')
    ).get(...(tenant_id ? [tenant_id] : []));
    const total = totalResult?.count || 0;
    
    // Get current month's targets
    const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
    const currentMonthResult = db.prepare(
      'SELECT COUNT(*) as count FROM salesman_targets WHERE period = ?' + (tenant_id ? ' AND tenant_id = ?' : '')
    ).get(...(tenant_id ? [currentMonth, tenant_id] : [currentMonth]));
    const current_month = currentMonthResult?.count || 0;
    
    // Get achieved count (achieved_visits >= target_visits)
    const achievedResult = db.prepare(
      'SELECT COUNT(*) as count FROM salesman_targets WHERE achieved_visits >= target_visits' + (tenant_id ? ' AND tenant_id = ?' : '')
    ).get(...(tenant_id ? [tenant_id] : []));
    const achieved = achievedResult?.count || 0;
    
    // Calculate average achievement percentage
    const avgResult = db.prepare(`
      SELECT AVG(CAST(achieved_visits AS FLOAT) / NULLIF(target_visits, 0) * 100) as avg_pct
      FROM salesman_targets
      WHERE target_visits > 0
      ${tenant_id ? 'AND tenant_id = ?' : ''}
    `).get(...(tenant_id ? [tenant_id] : []));
    const avg_achievement = Math.round(avgResult?.avg_pct || 0);
    
    res.json({
      success: true,
      stats: {
        total,
        current_month,
        achieved,
        avg_achievement
      }
    });
  } catch (error) {
    console.error('[FSM_API] Error fetching target stats:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get branches (placeholder)
router.get('/branches', async (req, res) => {
  try {
    // Check if branches table exists
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='branches'"
    ).all();
    
    if (tables.length === 0) {
      return res.json({
        success: true,
        data: [],
        count: 0,
        message: 'Branches table not yet created'
      });
    }
    
    const branches = db.prepare('SELECT * FROM branches ORDER BY name').all();
    
    res.json({
      success: true,
      data: branches,
      count: branches.length
    });
  } catch (error) {
    console.error('[FSM_API] Error fetching branches:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get visit details by ID
router.get('/visits/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const visit = db.prepare(`
      SELECT 
        v.*,
        s.name as salesman_name,
        s.phone as salesman_phone,
        COALESCE(p.name, v.plant_id) as plant_name
      FROM visits v
      LEFT JOIN salesmen s ON s.id = v.salesman_id
      LEFT JOIN plants p ON p.id = v.plant_id
      WHERE v.id = ?
    `).get(id);
    
    if (!visit) {
      return res.status(404).json({
        success: false,
        error: 'Visit not found'
      });
    }
    
    // Get associated images if they exist
    const images = db.prepare('SELECT * FROM visit_images WHERE visit_id = ?').all(id);
    
    res.json({
      success: true,
      data: {
        ...visit,
        images
      }
    });
  } catch (error) {
    console.error('[FSM_API] Error fetching visit details:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get salesman performance with visit counts and target progress
router.get('/salesmen/:id/performance', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get salesman details
    const salesman = db.prepare('SELECT * FROM salesmen WHERE id = ?').get(id);
    
    if (!salesman) {
      return res.status(404).json({
        success: false,
        error: 'Salesman not found'
      });
    }
    
    // Get visit counts
    const today = new Date().toISOString().split('T')[0];
    const todayVisits = db.prepare(
      'SELECT COUNT(*) as count FROM visits WHERE salesman_id = ? AND visit_date = ?'
    ).get(id, today);
    
    const monthStart = new Date().toISOString().slice(0, 8) + '01';
    const monthVisits = db.prepare(
      'SELECT COUNT(*) as count FROM visits WHERE salesman_id = ? AND visit_date >= ?'
    ).get(id, monthStart);
    
    // Get current month target
    const currentMonth = new Date().toISOString().slice(0, 7);
    const target = db.prepare(
      'SELECT * FROM salesman_targets WHERE salesman_id = ? AND period = ?'
    ).get(id, currentMonth);
    
    res.json({
      success: true,
      data: {
        salesman,
        performance: {
          today_visits: todayVisits?.count || 0,
          month_visits: monthVisits?.count || 0,
          target: target || null
        }
      }
    });
  } catch (error) {
    console.error('[FSM_API] Error fetching salesman performance:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get all plants/branches
router.get('/plants', async (req, res) => {
  try {
    const DEFAULT_TENANT_ID = process.env.FSM_DEFAULT_TENANT_ID || '112f12b8-55e9-4de8-9fda-d58e37c75796';
    const tenant_id = req.query.tenant_id || DEFAULT_TENANT_ID;
    
    let query = 'SELECT * FROM plants WHERE 1=1';
    const params = [];
    
    if (tenant_id) {
      query += ' AND tenant_id = ?';
      params.push(tenant_id);
    }
    
    query += ' ORDER BY name';
    
    const plants = db.prepare(query).all(...params);
    
    // Map to ensure consistent field names (plant_id, plant_name)
    const mappedPlants = plants.map(p => ({
      ...p,
      plant_id: p.id,
      plant_name: p.name
    }));
    
    res.json({
      success: true,
      data: mappedPlants,
      count: mappedPlants.length
    });
  } catch (error) {
    console.error('[FSM_API] Error fetching plants:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Create new plant/branch
router.post('/plants', async (req, res) => {
  try {
    const DEFAULT_TENANT_ID = process.env.FSM_DEFAULT_TENANT_ID || '112f12b8-55e9-4de8-9fda-d58e37c75796';
    const { name, location, city, state, country, timezone, tenant_id } = req.body;
    
    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'Plant name is required'
      });
    }
    
    const id = require('crypto').randomUUID();
    const finalTenantId = tenant_id || DEFAULT_TENANT_ID;
    
    const insertQuery = `
      INSERT INTO plants (id, tenant_id, name, location, city, state, country, timezone, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `;
    
    db.prepare(insertQuery).run(
      id,
      finalTenantId,
      name,
      location || null,
      city || null,
      state || null,
      country || 'India',
      timezone || 'UTC'
    );
    
    const plant = db.prepare('SELECT * FROM plants WHERE id = ?').get(id);
    
    res.json({
      success: true,
      data: plant,
      message: 'Branch created successfully'
    });
  } catch (error) {
    console.error('[FSM_API] Error creating plant:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Update plant/branch
router.put('/plants/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, location, city, state, country, timezone } = req.body;
    
    const existing = db.prepare('SELECT * FROM plants WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Branch not found'
      });
    }
    
    const updateQuery = `
      UPDATE plants 
      SET name = ?, location = ?, city = ?, state = ?, country = ?, timezone = ?, updated_at = datetime('now')
      WHERE id = ?
    `;
    
    db.prepare(updateQuery).run(
      name || existing.name,
      location !== undefined ? location : existing.location,
      city !== undefined ? city : existing.city,
      state !== undefined ? state : existing.state,
      country || existing.country,
      timezone || existing.timezone,
      id
    );
    
    const plant = db.prepare('SELECT * FROM plants WHERE id = ?').get(id);
    
    res.json({
      success: true,
      data: plant,
      message: 'Branch updated successfully'
    });
  } catch (error) {
    console.error('[FSM_API] Error updating plant:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Delete plant/branch
router.delete('/plants/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const existing = db.prepare('SELECT * FROM plants WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Branch not found'
      });
    }
    
    // Check if any salesmen are assigned to this plant
    const assignedSalesmen = db.prepare('SELECT COUNT(*) as count FROM salesmen WHERE plant_id = ?').get(id);
    if (assignedSalesmen.count > 0) {
      return res.status(400).json({
        success: false,
        error: `Cannot delete branch. ${assignedSalesmen.count} salesman(salesmen) are assigned to this branch.`
      });
    }
    
    db.prepare('DELETE FROM plants WHERE id = ?').run(id);
    
    res.json({
      success: true,
      message: 'Branch deleted successfully'
    });
  } catch (error) {
    console.error('[FSM_API] Error deleting plant:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get user role and access level (for role-based filtering)
router.get('/user/profile', async (req, res) => {
  try {
    const { user_id, phone } = req.query;
    
    // For now, implement simple role detection:
    // - If no user_id/phone provided: super_admin (full access)
    // - Check if user is a salesman in FSM
    let role = 'super_admin';
    let plant_id = null;
    let salesman_id = null;
    let assigned_plants = [];

    const normalizePhoneDigits = (value) => {
      if (!value) return '';
      const withoutSuffix = String(value).replace(/@c\.us$/i, '');
      return withoutSuffix.replace(/\D/g, '');
    };

    const parseAssignedPlants = (value) => {
      if (!value) return [];
      if (Array.isArray(value)) return value.filter(Boolean);
      const str = String(value).trim();
      if (!str) return [];
      try {
        const parsed = JSON.parse(str);
        return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
      } catch {
        return [];
      }
    };

    let user = null;

    if (user_id) {
      try {
        user = db.prepare('SELECT * FROM users WHERE id = ?').get(user_id);
      } catch (e) {
        console.warn('[FSM_API] Users table lookup failed:', e?.message || e);
      }
    }

    if (!user && phone) {
      try {
        const inputDigits = normalizePhoneDigits(phone);
        const allUsers = db.prepare('SELECT * FROM users').all();
        const matches = allUsers.filter((u) => {
          const digits = normalizePhoneDigits(u.phone);
          return digits && (digits === inputDigits || digits.endsWith(inputDigits));
        });
        if (matches.length === 1) {
          user = matches[0];
        } else if (matches.length > 1) {
          user = matches.find((u) => normalizePhoneDigits(u.phone) === inputDigits) || null;
        }
      } catch (e) {
        console.warn('[FSM_API] Users phone lookup failed:', e?.message || e);
      }
    }

    if (user) {
      assigned_plants = parseAssignedPlants(user.assigned_plants);
      const rawRole = String(user.role || '').toLowerCase();

      if (rawRole === 'salesman') {
        role = 'salesman';
      } else if (rawRole === 'super_admin') {
        role = 'super_admin';
      } else if (rawRole === 'admin') {
        role = assigned_plants.length > 0 ? 'plant_admin' : 'super_admin';
      }

      if (role === 'salesman') {
        const salesmanByUser = user.id ? db.prepare('SELECT * FROM salesmen WHERE user_id = ?').get(user.id) : null;
        const salesmanByPhone = !salesmanByUser && user.phone ? db.prepare('SELECT * FROM salesmen WHERE phone = ?').get(user.phone) : null;
        const salesman = salesmanByUser || salesmanByPhone || null;
        if (salesman) {
          salesman_id = salesman.id;
          plant_id = salesman.plant_id;
        }
      } else if (role === 'plant_admin' && assigned_plants.length > 0) {
        plant_id = assigned_plants[0];
      }
    }
    
    if (phone) {
      // Check if this phone belongs to a salesman
      if (!user) {
        const salesman = db.prepare('SELECT * FROM salesmen WHERE phone = ?').get(phone);
        if (salesman) {
          role = 'salesman';
          salesman_id = salesman.id;
          plant_id = salesman.plant_id;
        }
      }
    }
    
    res.json({
      success: true,
      data: {
        role,
        plant_id,
        salesman_id,
        assigned_plants,
        access_level: role === 'super_admin' ? 'all' : role === 'plant_admin' ? 'plant' : 'self'
      }
    });
  } catch (error) {
    console.error('[FSM_API] Error fetching user profile:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;

