/**
 * Advanced Features API Routes
 * ML, Voice AI, Video Calls, Blockchain, Translation
 */

const express = require('express');
const router = express.Router();
const mlService = require('../../services/ml-service');
const voiceService = require('../../services/voice-ai-service');
const videoService = require('../../services/video-call-service');
const blockchainService = require('../../services/blockchain-service');
const translationService = require('../../services/translation-service');

// ========== MACHINE LEARNING ENDPOINTS ==========

// Train sales forecasting model
router.post('/ml/train-forecast', async (req, res) => {
  try {
    const { tenantId } = req.body;
    const result = await mlService.trainSalesForecasting(tenantId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get sales forecast
router.get('/ml/forecast/:tenantId', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { days = 7 } = req.query;
    const result = await mlService.forecastSales(tenantId, parseInt(days));
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Predict customer churn
router.get('/ml/churn/:customerId', async (req, res) => {
  try {
    const { customerId } = req.params;
    const result = await mlService.predictChurn(customerId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get product recommendations
router.get('/ml/recommendations/:customerId', async (req, res) => {
  try {
    const { customerId } = req.params;
    const { limit = 5 } = req.query;
    const result = await mlService.recommendProducts(customerId, parseInt(limit));
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ML model status
router.get('/ml/status', async (req, res) => {
  res.json(mlService.getStatus());
});

// ========== VOICE AI ENDPOINTS ==========

// Process voice message
router.post('/voice/transcribe', async (req, res) => {
  try {
    const { audioBase64, from, tenantId, language } = req.body;
    const audioBuffer = Buffer.from(audioBase64, 'base64');
    
    const result = await voiceService.processVoiceMessage({
      audioBuffer,
      from,
      tenantId,
      language
    });
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get voice message history
router.get('/voice/history/:tenantId', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { limit = 50 } = req.query;
    const result = await voiceService.getVoiceHistory(tenantId, parseInt(limit));
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Voice pattern analysis
router.get('/voice/analytics/:tenantId', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { days = 30 } = req.query;
    const result = await voiceService.analyzeVoicePatterns(tenantId, parseInt(days));
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Voice AI status
router.get('/voice/status', async (req, res) => {
  res.json(voiceService.getStatus());
});

// Supported languages
router.get('/voice/languages', async (req, res) => {
  res.json(voiceService.getSupportedLanguages());
});

// ========== VIDEO CALL ENDPOINTS ==========

// Create video room
router.post('/video/create-room', async (req, res) => {
  try {
    const { hostUserId, participants, metadata } = req.body;
    const result = await videoService.createRoom(hostUserId, participants, metadata);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Join video room
router.post('/video/join-room', async (req, res) => {
  try {
    const { roomId, userId, joinToken } = req.body;
    const result = await videoService.joinRoom(roomId, userId, joinToken);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Leave video room
router.post('/video/leave-room', async (req, res) => {
  try {
    const { roomId, userId } = req.body;
    const result = await videoService.leaveRoom(roomId, userId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// End video room
router.post('/video/end-room', async (req, res) => {
  try {
    const { roomId } = req.body;
    const result = await videoService.endRoom(roomId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get room status
router.get('/video/room/:roomId', async (req, res) => {
  try {
    const { roomId } = req.params;
    const result = await videoService.getRoomStatus(roomId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get call history
router.get('/video/history/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 20 } = req.query;
    const result = await videoService.getCallHistory(userId, parseInt(limit));
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Video service status
router.get('/video/status', async (req, res) => {
  res.json(videoService.getStatus());
});

// ========== BLOCKCHAIN ENDPOINTS ==========

// Log order to blockchain
router.post('/blockchain/log-order', async (req, res) => {
  try {
    const { order } = req.body;
    const result = await blockchainService.logOrder(order);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Log payment to blockchain
router.post('/blockchain/log-payment', async (req, res) => {
  try {
    const { payment } = req.body;
    const result = await blockchainService.logPayment(payment);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Verify blockchain integrity
router.post('/blockchain/verify', async (req, res) => {
  try {
    const { dataHash, blockchainTxHash } = req.body;
    const result = await blockchainService.verifyIntegrity(dataHash, blockchainTxHash);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get audit trail
router.get('/blockchain/audit/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    const result = await blockchainService.getAuditTrail(orderId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get smart contract code
router.get('/blockchain/contract-code', async (req, res) => {
  res.json({
    success: true,
    contractCode: blockchainService.getContractCode()
  });
});

// Blockchain status
router.get('/blockchain/status', async (req, res) => {
  res.json(blockchainService.getStatus());
});

// ========== TRANSLATION ENDPOINTS ==========

// Translate text
router.post('/translate', async (req, res) => {
  try {
    const { text, targetLanguage, sourceLanguage = 'auto' } = req.body;
    const result = await translationService.translate(text, targetLanguage, sourceLanguage);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Detect language
router.post('/translate/detect', async (req, res) => {
  try {
    const { text } = req.body;
    const result = await translationService.detectLanguage(text);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Batch translate
router.post('/translate/batch', async (req, res) => {
  try {
    const { texts, targetLanguage, sourceLanguage = 'auto' } = req.body;
    const result = await translationService.translateBatch(texts, targetLanguage, sourceLanguage);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get supported languages
router.get('/translate/languages', async (req, res) => {
  res.json(translationService.getSupportedLanguages());
});

// Translation statistics
router.get('/translate/stats', async (req, res) => {
  try {
    const result = await translationService.getStats();
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Clear translation cache
router.post('/translate/clear-cache', async (req, res) => {
  try {
    const { olderThanDays = 30 } = req.body;
    const result = await translationService.clearCache(olderThanDays);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Translation status
router.get('/translate/status', async (req, res) => {
  res.json(translationService.getStatus());
});

// ========== COMBINED STATUS ENDPOINT ==========

router.get('/advanced-features/status', async (req, res) => {
  res.json({
    success: true,
    features: {
      machineLearning: mlService.getStatus(),
      voiceAI: voiceService.getStatus(),
      videoCalls: videoService.getStatus(),
      blockchain: blockchainService.getStatus(),
      translation: translationService.getStatus()
    }
  });
});

module.exports = router;
