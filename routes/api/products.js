const express = require('express');
const router = express.Router();
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const xlsx = require('xlsx');
const { dbClient } = require('../../services/config');

// Configure multer for file upload (memory storage)
const upload = multer({ storage: multer.memoryStorage() });

// POST /api/products/bulk-upload - bulk add products via CSV/Excel upload
router.post('/bulk-upload', upload.single('file'), async (req, res) => {
    try {
        const useLocalDb = process.env.USE_LOCAL_DB === 'true';
        const tenantId = req.body.tenantId || req.headers['x-tenant-id'];
        if (!tenantId) {
            return res.json({ success: false, error: 'Missing tenantId' });
        }

        if (!req.file) {
            return res.json({ success: false, error: 'No file uploaded' });
        }

        const ext = req.file.originalname.split('.').pop().toLowerCase();
        let products = [];

        // Parse CSV file
        if (ext === 'csv') {
            try {
                const fileContent = req.file.buffer.toString('utf-8');
                products = parse(fileContent, {
                    columns: true,
                    skip_empty_lines: true,
                    trim: true
                });
            } catch (parseError) {
                console.error('CSV parse error:', parseError);
                return res.json({ success: false, error: 'Failed to parse CSV file: ' + parseError.message });
            }
        } else if (ext === 'xlsx' || ext === 'xls') {
            try {
                const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
                const sheetName = workbook.SheetNames && workbook.SheetNames[0];
                if (!sheetName) {
                    return res.json({ success: false, error: 'Excel file has no sheets' });
                }

                const worksheet = workbook.Sheets[sheetName];
                const rows = xlsx.utils.sheet_to_json(worksheet, { defval: '', raw: false });
                // Normalize keys to lowercase for consistency with CSV
                products = rows.map(row => {
                    const normalized = {};
                    for (const [k, v] of Object.entries(row || {})) {
                        normalized[String(k || '').trim().toLowerCase()] = v;
                    }
                    return normalized;
                });
            } catch (parseError) {
                console.error('Excel parse error:', parseError);
                return res.json({ success: false, error: 'Failed to parse Excel file: ' + parseError.message });
            }
        } else {
            return res.json({ success: false, error: 'Unsupported file format. Please upload CSV.' });
        }

        if (products.length === 0) {
            return res.json({ success: false, error: 'No products found in file' });
        }

        // Fetch all categories for this tenant to map category names to IDs
        const { data: categories, error: catError } = await dbClient
            .from('categories')
            .select('id, name')
            .eq('tenant_id', tenantId);

        if (catError) {
            console.error('Error fetching categories:', catError);
        }

        const categoryMap = {};
        if (categories) {
            categories.forEach(cat => {
                categoryMap[cat.name.toLowerCase().trim()] = cat.id;
            });
        }

        // Prepare product inserts
        const productsToInsert = products.map(p => {
            const categoryName = (p.category || p.category_name || '').toLowerCase().trim();
            const categoryId = categoryMap[categoryName] || null;

            const nameVal = (p.name || p.product_name || p.product || p.title || '').toString().trim();
            const skuVal = (p.sku || p['sku-id'] || p.sku_id || p.skuid || p.item_code || p.itemcode || '').toString().trim();
            const descVal = (p.description || p.desc || p.product_description || p.details || '').toString().trim();

            const priceVal = p.price ?? p.carton_price ?? p.unit_price ?? p.price_retail ?? '';
            const stockVal = p.stock ?? p.stock_quantity ?? p.quantity ?? '';

            return {
                tenant_id: tenantId,
                name: nameVal,
                sku: skuVal,
                description: descVal || null,
                price: parseFloat(priceVal) || 0,
                stock_quantity: parseInt(stockVal) || 0,
                brand: p.brand || '',
                // Store the selected category id in the `products.category` column (what the dashboard reads).
                // In local SQLite, `products.category_id` can point to `product_categories` (not `categories`) and will FK-fail.
                category: categoryId,
                category_id: useLocalDb ? null : categoryId,
                packaging_unit: p.packaging_unit || '',
                units_per_carton: parseInt(p.units_per_carton) || 0,
                image_url: p.image_url || ''
            };
        });

        // Insert products in batches (dbClient handles this well)
        const { data: insertedProducts, error: insertError } = await dbClient
            .from('products')
            .insert(productsToInsert)
            .select();

        if (insertError) {
            console.error('Error inserting products:', insertError);
            return res.json({ success: false, error: 'Failed to insert products: ' + insertError.message });
        }

        res.json({ 
            success: true, 
            message: `Successfully uploaded ${insertedProducts.length} products`,
            count: insertedProducts.length 
        });

    } catch (err) {
        console.error('Bulk upload error:', err);
        res.json({ success: false, error: err.message });
    }
});

module.exports = router;

