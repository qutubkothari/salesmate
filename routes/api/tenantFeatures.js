/**
 * Tenant Features API Routes
 * Manage feature flags for tenants
 */

const express = require('express');
const router = express.Router();
const { dbClient } = require('../../services/config');

// Get tenant features
router.get('/:phone/features', async (req, res) => {
  try {
    const { phone } = req.params;
    
    const { data: tenant, error } = await dbClient
      .from('tenants')
      .select('*')
      .eq('phone_number', phone)
      .single();
    
    if (error || !tenant) {
      return res.json({ success: false, error: 'Tenant not found' });
    }
    
    // Default features if not set
    const features = tenant.enabled_features || {
      broadcast_enabled: true,
      sales_assistant_enabled: true,
      products_enabled: true,
      orders_enabled: true,
      analytics_enabled: true
    };
    
    res.json({
      success: true,
      tenant: {
        phone_number: tenant.phone_number,
        business_name: tenant.business_name,
        status: tenant.status
      },
      features
    });
    
  } catch (error) {
    console.error('[FEATURES] Error:', error);
    res.json({ success: false, error: error.message });
  }
});

// Update tenant features
router.put('/:phone/features', async (req, res) => {
  try {
    const { phone } = req.params;
    const { features } = req.body;
    
    if (!features) {
      return res.json({ success: false, error: 'Features object required' });
    }
    
    const { data, error } = await dbClient
      .from('tenants')
      .update({
        enabled_features: features,
        updated_at: new Date().toISOString()
      })
      .eq('phone_number', phone)
      .select();
    
    if (error) {
      return res.json({ success: false, error: error.message });
    }
    
    console.log(`[FEATURES] Updated for ${phone}:`, features);
    
    res.json({
      success: true,
      message: 'Features updated successfully',
      features
    });
    
  } catch (error) {
    console.error('[FEATURES] Error:', error);
    res.json({ success: false, error: error.message });
  }
});

// Check if a specific feature is enabled for a tenant
router.get('/:phone/check/:feature', async (req, res) => {
  try {
    const { phone, feature } = req.params;
    
    const { data: tenant, error } = await dbClient
      .from('tenants')
      .select('enabled_features')
      .eq('phone_number', phone)
      .single();
    
    if (error || !tenant) {
      return res.json({ success: false, error: 'Tenant not found' });
    }
    
    const features = tenant.enabled_features || {};
    const isEnabled = features[feature] !== false; // Default to true if not set
    
    res.json({
      success: true,
      feature,
      enabled: isEnabled
    });
    
  } catch (error) {
    console.error('[FEATURES] Error:', error);
    res.json({ success: false, error: error.message });
  }
});

module.exports = router;


