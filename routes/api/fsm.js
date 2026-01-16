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
    const { salesman_id, start_date, end_date, visit_type, limit = 100 } = req.query;
    
    let query = 'SELECT * FROM visits WHERE 1=1';
    const params = [];
    
    if (salesman_id) {
      query += ' AND salesman_id = ?';
      params.push(salesman_id);
    }
    
    if (start_date) {
      query += ' AND visit_date >= ?';
      params.push(start_date);
    }
    
    if (end_date) {
      query += ' AND visit_date <= ?';
      params.push(end_date);
    }
    
    if (visit_type) {
      query += ' AND visit_type = ?';
      params.push(visit_type);
    }
    
    query += ' ORDER BY visit_date DESC, created_at DESC LIMIT ?';
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
    const { start_date, end_date } = req.query;
    
    let query = 'SELECT COUNT(*) as total FROM visits WHERE 1=1';
    const params = [];
    
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
    const todayResult = db.prepare('SELECT COUNT(*) as count FROM visits WHERE visit_date = ?').get(today);
    const today_visits = todayResult?.count || 0;
    
    // Get unique salesmen active today
    const activeTodayResult = db.prepare(
      'SELECT COUNT(DISTINCT salesman_id) as count FROM visits WHERE visit_date = ?'
    ).get(today);
    const active_today = activeTodayResult?.count || 0;
    
    // Average visits per day (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const avgResult = db.prepare(
      'SELECT COUNT(*) as count FROM visits WHERE visit_date >= ?'
    ).get(thirtyDaysAgo.toISOString().split('T')[0]);
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
    const { is_active, limit = 100 } = req.query;
    
    let query = 'SELECT * FROM salesmen WHERE 1=1';
    const params = [];
    
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

// Get salesman statistics
router.get('/salesmen/stats', async (req, res) => {
  try {
    const totalResult = db.prepare('SELECT COUNT(*) as count FROM salesmen').get();
    const total = totalResult?.count || 0;
    
    const activeResult = db.prepare('SELECT COUNT(*) as count FROM salesmen WHERE is_active = 1').get();
    const active = activeResult?.count || 0;
    
    // Get active today (visited today)
    const today = new Date().toISOString().split('T')[0];
    const activeTodayResult = db.prepare(
      'SELECT COUNT(DISTINCT salesman_id) as count FROM visits WHERE visit_date = ?'
    ).get(today);
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
    const { salesman_id, period, limit = 100 } = req.query;
    
    let query = 'SELECT * FROM salesman_targets WHERE 1=1';
    const params = [];
    
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

// Get target statistics
router.get('/targets/stats', async (req, res) => {
  try {
    const totalResult = db.prepare('SELECT COUNT(*) as count FROM salesman_targets').get();
    const total = totalResult?.count || 0;
    
    // Get current month's targets
    const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
    const currentMonthResult = db.prepare(
      'SELECT COUNT(*) as count FROM salesman_targets WHERE period = ?'
    ).get(currentMonth);
    const current_month = currentMonthResult?.count || 0;
    
    // Get achieved count (achieved_visits >= target_visits)
    const achievedResult = db.prepare(
      'SELECT COUNT(*) as count FROM salesman_targets WHERE achieved_visits >= target_visits'
    ).get();
    const achieved = achievedResult?.count || 0;
    
    // Calculate average achievement percentage
    const avgResult = db.prepare(`
      SELECT AVG(CAST(achieved_visits AS FLOAT) / NULLIF(target_visits, 0) * 100) as avg_pct
      FROM salesman_targets
      WHERE target_visits > 0
    `).get();
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
    
    const visit = db.prepare('SELECT * FROM visits WHERE id = ?').get(id);
    
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

module.exports = router;
