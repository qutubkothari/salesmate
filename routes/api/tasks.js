/**
 * Tasks Management API Routes
 */

const express = require('express');
const router = express.Router();
const { db } = require('../../services/config');

/**
 * GET /api/tasks/:tenantId
 * Get all tasks for tenant
 */
router.get('/:tenantId', (req, res) => {
  try {
    const { tenantId } = req.params;
    const { status, assigned_to, priority } = req.query;
    
    
    let query = `
      SELECT t.*, 
              cp.name as lead_name, cp.phone_number as lead_phone,
             s.name as salesman_name
      FROM tasks t
      LEFT JOIN customer_profiles cp ON t.lead_id = cp.id
      LEFT JOIN salesman s ON t.assigned_to = CAST(s.id AS TEXT)
      WHERE t.tenant_id = ?
    `;
    
    const params = [tenantId];
    
    if (status) {
      query += ' AND t.status = ?';
      params.push(status);
    }
    
    if (assigned_to) {
      query += ' AND t.assigned_to = ?';
      params.push(assigned_to);
    }
    
    if (priority) {
      query += ' AND t.priority = ?';
      params.push(priority);
    }
    
    query += ' ORDER BY t.due_date ASC, t.priority DESC, t.created_at DESC';
    
    const tasks = db.prepare(query).all(...params);
    
    res.json({ success: true, tasks });
  } catch (error) {
    console.error('Error fetching tasks:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/tasks/:tenantId/my-tasks
 * Get tasks assigned to specific user
 */
router.get('/:tenantId/my-tasks', (req, res) => {
  try {
    const { tenantId } = req.params;
    const { user_id } = req.query;
    
    if (!user_id) {
      return res.status(400).json({ success: false, error: 'user_id required' });
    }
    
    
    const tasks = db.prepare(`
      SELECT t.*, 
             cp.name as lead_name, cp.phone_number as lead_phone
      FROM tasks t
      LEFT JOIN customer_profiles cp ON t.lead_id = cp.id
      WHERE t.tenant_id = ? AND t.assigned_to = ? AND t.status != 'COMPLETED'
      ORDER BY 
        CASE WHEN t.due_date < CURRENT_TIMESTAMP THEN 0 ELSE 1 END,
        t.due_date ASC,
        CASE t.priority 
          WHEN 'URGENT' THEN 1
          WHEN 'HIGH' THEN 2
          WHEN 'MEDIUM' THEN 3
          WHEN 'LOW' THEN 4
        END
    `).all(tenantId, user_id);
    
    const overdue = tasks.filter(t => t.due_date && new Date(t.due_date) < new Date());
    const upcoming = tasks.filter(t => !t.due_date || new Date(t.due_date) >= new Date());
    
    res.json({ 
      success: true, 
      tasks,
      summary: {
        total: tasks.length,
        overdue: overdue.length,
        upcoming: upcoming.length
      }
    });
  } catch (error) {
    console.error('Error fetching my tasks:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/tasks/:tenantId
 * Create new task
 */
router.post('/:tenantId', (req, res) => {
  try {
    const { tenantId } = req.params;
    const { title, description, lead_id, conversation_id, assigned_to, priority, due_date, reminder_at } = req.body;
    
    if (!title) {
      return res.status(400).json({ success: false, error: 'Title is required' });
    }
    
    
    const result = db.prepare(`
      INSERT INTO tasks (
        tenant_id, title, description, lead_id, conversation_id,
        assigned_to, assigned_by, priority, due_date, reminder_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      tenantId,
      title,
      description || null,
      lead_id || null,
      conversation_id || null,
      assigned_to || null,
      req.body.assigned_by || 'SYSTEM',
      priority || 'MEDIUM',
      due_date || null,
      reminder_at || null
    );
    
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(result.lastInsertRowid);
    
    res.json({ success: true, task });
  } catch (error) {
    console.error('Error creating task:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/tasks/:tenantId/:taskId
 * Update task
 */
router.put('/:tenantId/:taskId', (req, res) => {
  try {
    const { tenantId, taskId } = req.params;
    const { title, description, assigned_to, priority, status, due_date, reminder_at } = req.body;
    
    
    const updates = [];
    const values = [];
    
    if (title !== undefined) { updates.push('title = ?'); values.push(title); }
    if (description !== undefined) { updates.push('description = ?'); values.push(description); }
    if (assigned_to !== undefined) { updates.push('assigned_to = ?'); values.push(assigned_to); }
    if (priority !== undefined) { updates.push('priority = ?'); values.push(priority); }
    if (status !== undefined) { updates.push('status = ?'); values.push(status); }
    if (due_date !== undefined) { updates.push('due_date = ?'); values.push(due_date); }
    if (reminder_at !== undefined) { updates.push('reminder_at = ?'); values.push(reminder_at); }
    
    values.push(taskId, tenantId);
    
    db.prepare(`
      UPDATE tasks
      SET ${updates.join(', ')}
      WHERE id = ? AND tenant_id = ?
    `).run(...values);
    
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    
    res.json({ success: true, task });
  } catch (error) {
    console.error('Error updating task:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/tasks/:tenantId/:taskId/complete
 * Mark task as completed
 */
router.post('/:tenantId/:taskId/complete', (req, res) => {
  try {
    const { tenantId, taskId } = req.params;

    db.prepare(`
      UPDATE tasks
      SET status = 'COMPLETED', completed_at = CURRENT_TIMESTAMP
      WHERE id = ? AND tenant_id = ?
    `).run(taskId, tenantId);
    
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    
    res.json({ success: true, task });
  } catch (error) {
    console.error('Error completing task:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/tasks/:tenantId/:taskId
 * Delete task
 */
router.delete('/:tenantId/:taskId', (req, res) => {
  try {
    const { tenantId, taskId } = req.params;

    db.prepare('DELETE FROM tasks WHERE id = ? AND tenant_id = ?')
      .run(taskId, tenantId);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting task:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;

