const express = require('express');
const router = express.Router();
const { dbClient } = require('../../services/config');

// GET /api/categories - fetch all categories for a tenant
router.get('/', async (req, res) => {
    try {
        const tenantId = req.query.tenantId || req.headers['x-tenant-id'];
        if (!tenantId) {
            return res.json({ success: false, error: 'Missing tenantId' });
        }

        const { data, error } = await dbClient
            .from('categories')
            .select('id, name, description')
            .eq('tenant_id', tenantId)
            .order('name', { ascending: true });

        if (error) {
            console.error('Error fetching categories:', error);
            return res.json({ success: false, error: error.message });
        }

        res.json({ success: true, categories: data || [] });
    } catch (err) {
        console.error('Categories fetch error:', err);
        res.json({ success: false, error: err.message });
    }
});

// POST /api/categories - create a new category
router.post('/', async (req, res) => {
    try {
        const { tenantId, name, description } = req.body;
        if (!tenantId || !name) {
            return res.json({ success: false, error: 'Missing required fields' });
        }

        const { data, error } = await dbClient
            .from('categories')
            .insert([{ tenant_id: tenantId, name, description }])
            .select();

        if (error) {
            console.error('Error creating category:', error);
            return res.json({ success: false, error: error.message });
        }

        res.json({ success: true, category: data[0] });
    } catch (err) {
        console.error('Category creation error:', err);
        res.json({ success: false, error: err.message });
    }
});

// DELETE /api/categories/:id - delete a category
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { tenantId } = req.body;
        
        if (!tenantId) {
            return res.json({ success: false, error: 'Missing tenantId' });
        }

        const { error } = await dbClient
            .from('categories')
            .delete()
            .eq('id', id)
            .eq('tenant_id', tenantId);

        if (error) {
            console.error('Error deleting category:', error);
            return res.json({ success: false, error: error.message });
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Category deletion error:', err);
        res.json({ success: false, error: err.message });
    }
});

module.exports = router;

