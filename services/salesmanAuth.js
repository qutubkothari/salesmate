const { dbClient } = require('./config');

/**
 * Middleware to authenticate salesman for mobile API
 * Expects Authorization: Bearer <token> or X-Salesman-Phone header
 */
async function requireSalesmanAuth(req, res, next) {
  try {
    // Get credentials from headers
    const authHeader = req.headers.authorization;
    const salesmanPhone = req.headers['x-salesman-phone'];
    const salesmanPassword = req.headers['x-salesman-password'];
    const tenantId = req.headers['x-tenant-id'] || req.query.tenantId;

    if (!tenantId) {
      return res.status(401).json({ success: false, error: 'Missing tenant ID' });
    }

    let salesman = null;

    // Method 1: Bearer token (user ID)
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const userId = authHeader.substring(7);
      
      const { data, error } = await dbClient
        .from('salesmen')
        .select('id, user_id, tenant_id, name, phone, email, is_active')
        .eq('tenant_id', tenantId)
        .eq('user_id', userId)
        .eq('is_active', true)
        .maybeSingle();

      if (error) throw error;
      salesman = data;
    }

    // Method 2: Phone + Password
    if (!salesman && salesmanPhone && salesmanPassword) {
      // Get user with matching phone
      const { data: user, error: userError } = await dbClient
        .from('users')
        .select('id, tenant_id, phone, password_hash, role, is_active')
        .eq('tenant_id', tenantId)
        .eq('phone', salesmanPhone)
        .eq('role', 'salesman')
        .eq('is_active', true)
        .maybeSingle();

      if (userError) throw userError;

      if (user) {
        // Verify password (simplified - in production use bcrypt)
        const bcrypt = require('bcrypt');
        const passwordMatch = await bcrypt.compare(salesmanPassword, user.password_hash);

        if (passwordMatch) {
          const { data: salesmanData, error: salesmanError } = await dbClient
            .from('salesmen')
            .select('id, user_id, tenant_id, name, phone, email, is_active')
            .eq('tenant_id', tenantId)
            .eq('user_id', user.id)
            .eq('is_active', true)
            .maybeSingle();

          if (salesmanError) throw salesmanError;
          salesman = salesmanData;
        }
      }
    }

    if (!salesman) {
      return res.status(401).json({ 
        success: false, 
        error: 'Unauthorized - Invalid credentials' 
      });
    }

    // Attach salesman info to request
    req.salesmanAuth = {
      tenantId: salesman.tenant_id,
      salesmanId: salesman.id,
      userId: salesman.user_id,
      name: salesman.name,
      phone: salesman.phone,
      email: salesman.email
    };

    next();
  } catch (error) {
    console.error('[SALESMAN_AUTH] Error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Authentication failed' 
    });
  }
}

module.exports = {
  requireSalesmanAuth
};
