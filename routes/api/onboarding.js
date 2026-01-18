/**
 * Onboarding API Routes
 */

const express = require('express');
const router = express.Router();
const onboardingService = require('../../services/onboarding-service');

router.get('/progress/:userId', (req, res) => {
  try {
    const progress = onboardingService.getProgress(req.params.userId);
    res.json({ success: true, progress });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/sample-data', (req, res) => {
  try {
    const { tenant_id } = req.body;
    const result = onboardingService.createSampleData(tenant_id);
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
