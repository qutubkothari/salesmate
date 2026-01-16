const express = require('express');
const router = express.Router();
const { fetchGSTINInfo } = require('../../services/gstScraperService');

router.get('/gst/verify/:gstin', async (req, res) => {
  const { gstin } = req.params;
  try {
    const data = await fetchGSTINInfo(gstin);
    res.json(data);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;

