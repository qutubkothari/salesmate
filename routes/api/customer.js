// routes/api/customer.js
// Modular API routes for customer profile and notes management

const express = require('express');
const router = express.Router();
const customerProfileService = require('../../services/customerProfileService');
const { validate, z, zTrimmedString, zOptionalTrimmedString } = require('../../middleware/validate');

const tenantIdParamsSchema = z.object({ tenantId: zTrimmedString(1, 128) }).strict();
const upsertCustomerBodySchema = z
  .object({
    phone: zTrimmedString(3, 40),
  })
  // Allow additional profile fields, but do not allow prototype pollution keys.
  // Keeping this non-strict avoids breaking existing dashboards that send extra fields.
  .passthrough();

// GET /api/customers/list/:tenantId - List all customers for a tenant
router.get('/list/:tenantId', async (req, res) => {
  const { tenantId } = req.params;
  // Accept filters from query params
  const { phone, name, minSpent, maxSpent, minOrderDate, maxOrderDate } = req.query;
  try {
    const { customers, error } = await customerProfileService.searchCustomers({ tenantId, phone, name, minSpent, maxSpent, minOrderDate, maxOrderDate });
    if (error) return res.status(500).json({ success: false, error: error.message || error, customers: [] });
    // Normalize payload for dashboard.html (expects `name` and `phone`)
    const normalized = (customers || []).map(c => ({
      ...c,
      phone: c.phone || c.phone_number || c.phoneNumber || null,
      name: c.name || c.business_name || c.first_name || c.customer_name || null
    }));
    res.json({ success: true, customers: normalized });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message, customers: [] });
  }
});

// GET /api/customers/lookup/:tenantId?phone=... - Find a customer by phone (normalized)
router.get('/lookup/:tenantId', async (req, res) => {
  const { tenantId } = req.params;
  const { phone } = req.query;
  try {
    const { customer, error } = await customerProfileService.getCustomerByPhone(tenantId, phone);
    if (error) return res.status(500).json({ success: false, error: error.message || String(error) });
    return res.json({ success: true, customer });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || String(err) });
  }
});

// POST /api/customers/upsert/:tenantId - Create or update a customer profile by phone
router.post('/upsert/:tenantId', validate({ params: tenantIdParamsSchema, body: upsertCustomerBodySchema }), async (req, res) => {
  const { tenantId } = req.params;
  const { phone, ...profileData } = req.body || {};

  try {
    if (!phone) return res.status(400).json({ success: false, error: 'phone is required' });
    const customer = await customerProfileService.upsertCustomerByPhone(tenantId, phone, profileData);
    return res.json({ success: true, customer });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || String(err) });
  }
});
const customerNotesService = require('../../services/customerNotesService');

// --- Customer Profile Endpoints ---
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const { data, error } = await customerProfileService.getCustomerById(id);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.get('/', async (req, res) => {
  const { phone, name, minSpent, maxSpent, minOrderDate, maxOrderDate, tenantId } = req.query;
  const { data, error } = await customerProfileService.searchCustomers({ phone, name, minSpent, maxSpent, minOrderDate, maxOrderDate, tenantId });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.post('/', async (req, res) => {
  const { data, error } = await customerProfileService.createCustomer(req.body);
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { data, error } = await customerProfileService.updateCustomer(id, req.body);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const { error } = await customerProfileService.deleteCustomer(id);
  if (error) return res.status(500).json({ error: error.message });
  res.status(204).send();
});

// --- Customer Notes Endpoints ---
router.get('/:id/notes', async (req, res) => {
  const { id } = req.params;
  const { data, error } = await customerNotesService.getNotesByClientId(id);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.post('/:id/notes', async (req, res) => {
  const { id } = req.params;
  const noteData = { ...req.body, client_id: id };
  const { data, error } = await customerNotesService.createNote(noteData);
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

router.put('/notes/:noteId', async (req, res) => {
  const { noteId } = req.params;
  const { data, error } = await customerNotesService.updateNote(noteId, req.body);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.delete('/notes/:noteId', async (req, res) => {
  const { noteId } = req.params;
  const { error } = await customerNotesService.deleteNote(noteId);
  if (error) return res.status(500).json({ error: error.message });
  res.status(204).send();
});

module.exports = router;
