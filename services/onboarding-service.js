/**
 * Onboarding Service
 * Guided setup for new users
 */

const { db } = require('./config');
const crypto = require('crypto');

class OnboardingService {
  /**
   * Get onboarding progress
   */
  getProgress(userId) {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) return null;

    const steps = [
      { id: 'profile', name: 'Complete Profile', completed: !!(user.name && user.email) },
      { id: 'team', name: 'Add Team Members', completed: this.hasTeamMembers(user.tenant_id) },
      { id: 'products', name: 'Add Products', completed: this.hasProducts(user.tenant_id) },
      { id: 'customers', name: 'Add Customers', completed: this.hasCustomers(user.tenant_id) },
      { id: 'visit', name: 'Create First Visit', completed: this.hasVisits(user.tenant_id) }
    ];

    const completed = steps.filter(s => s.completed).length;
    const total = steps.length;

    return {
      steps,
      completed,
      total,
      percentage: Math.round((completed / total) * 100)
    };
  }

  hasTeamMembers(tenantId) {
    const count = db.prepare('SELECT COUNT(*) as count FROM salesmen WHERE tenant_id = ?').get(tenantId);
    return count.count > 0;
  }

  hasProducts(tenantId) {
    const count = db.prepare('SELECT COUNT(*) as count FROM products WHERE tenant_id = ?').get(tenantId);
    return count.count > 0;
  }

  hasCustomers(tenantId) {
    const count = db.prepare('SELECT COUNT(*) as count FROM customers WHERE tenant_id = ?').get(tenantId);
    return count.count > 0;
  }

  hasVisits(tenantId) {
    const count = db.prepare('SELECT COUNT(*) as count FROM visits WHERE tenant_id = ?').get(tenantId);
    return count.count > 0;
  }

  /**
   * Create sample data for demo
   */
  createSampleData(tenantId) {
    const sampleProducts = [
      { name: 'Steel Bolt M12', sku: 'SB-M12', price: 25.00, category: 'Fasteners' },
      { name: 'Steel Nut M12', sku: 'SN-M12', price: 15.00, category: 'Fasteners' },
      { name: 'Washer 12mm', sku: 'WS-12', price: 5.00, category: 'Washers' }
    ];

    sampleProducts.forEach(p => {
      const id = crypto.randomBytes(16).toString('hex');
      db.prepare(`
        INSERT INTO products (id, tenant_id, name, sku, price, category, is_active, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'))
      `).run(id, tenantId, p.name, p.sku, p.price, p.category);
    });

    return { created: sampleProducts.length };
  }
}

module.exports = new OnboardingService();
