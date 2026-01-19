/**
 * Voice AI Service
 * WhatsApp voice note transcription and AI processing
 * Note: Requires Google Cloud Speech-to-Text API credentials
 */

const crypto = require('crypto');
const { db } = require('./config');
const aiService = require('./ai-service');

class VoiceAIService {
  constructor() {
    this.enabled = process.env.GOOGLE_CLOUD_SPEECH_ENABLED === 'true';
    this.speechClient = null;
    
    if (this.enabled) {
      this.initialize();
    }
  }

  /**
   * Initialize Google Cloud Speech-to-Text
   */
  async initialize() {
    try {
      // Only import if enabled to avoid errors when credentials aren't set
      const speech = require('@google-cloud/speech');
      
      // Initialize client with credentials
      this.speechClient = new speech.SpeechClient({
        keyFilename: process.env.GOOGLE_CLOUD_KEYFILE
      });
      
      console.log('Voice AI service initialized');
    } catch (error) {
      console.warn('Voice AI not available:', error.message);
      this.enabled = false;
    }
  }

  /**
   * Transcribe voice message
   */
  async transcribe(audioBuffer, languageCode = 'en-US') {
    if (!this.enabled) {
      return this.fallbackTranscription();
    }

    try {
      const audio = {
        content: audioBuffer.toString('base64')
      };

      const config = {
        encoding: 'OGG_OPUS', // WhatsApp uses OGG format
        sampleRateHertz: 16000,
        languageCode: languageCode,
        enableAutomaticPunctuation: true,
        enableWordTimeOffsets: true,
        model: 'default'
      };

      const request = {
        audio: audio,
        config: config
      };

      const [response] = await this.speechClient.recognize(request);
      const transcription = response.results
        .map(result => result.alternatives[0].transcript)
        .join('\n');

      return {
        success: true,
        transcription,
        confidence: response.results[0]?.alternatives[0]?.confidence || 0,
        languageCode,
        words: response.results[0]?.alternatives[0]?.words || []
      };
    } catch (error) {
      console.error('Transcription error:', error.message);
      return {
        success: false,
        error: error.message,
        fallback: this.fallbackTranscription()
      };
    }
  }

  /**
   * Process voice message from WhatsApp
   */
  async processVoiceMessage(voiceMessageData) {
    try {
      const { audioBuffer, from, tenantId, language = 'en-US' } = voiceMessageData;

      // Transcribe audio
      const transcription = await this.transcribe(audioBuffer, language);

      if (!transcription.success) {
        return {
          success: false,
          message: 'Could not transcribe audio',
          error: transcription.error
        };
      }

      // Log transcription
      await this.logVoiceMessage({
        tenantId,
        from,
        transcription: transcription.transcription,
        confidence: transcription.confidence,
        language
      });

      // Process with AI
      const aiResponse = await aiService.chat(transcription.transcription, {
        tenantId,
        context: 'voice_message',
        user: from
      });

      return {
        success: true,
        transcription: transcription.transcription,
        confidence: transcription.confidence,
        aiResponse: aiResponse.response,
        intent: this.detectIntent(transcription.transcription)
      };
    } catch (error) {
      console.error('Voice message processing error:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Detect intent from transcribed text
   */
  detectIntent(text) {
    const lowerText = text.toLowerCase();

    // Order-related intents
    if (lowerText.match(/order|purchase|buy|price|cost/)) {
      return 'order_inquiry';
    }

    // Product-related intents
    if (lowerText.match(/product|item|stock|available/)) {
      return 'product_inquiry';
    }

    // Delivery/visit intents
    if (lowerText.match(/deliver|visit|when|appointment|schedule/)) {
      return 'delivery_inquiry';
    }

    // Complaint/issue intents
    if (lowerText.match(/problem|issue|complaint|wrong|damaged/)) {
      return 'complaint';
    }

    // Thank you / acknowledgment
    if (lowerText.match(/thank|thanks|appreciate/)) {
      return 'acknowledgment';
    }

    return 'general_inquiry';
  }

  /**
   * Log voice message for analytics
   */
  async logVoiceMessage(data) {
    try {
      await db.run(`
        CREATE TABLE IF NOT EXISTS voice_messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id TEXT NOT NULL,
          from_number TEXT NOT NULL,
          transcription TEXT NOT NULL,
          confidence REAL,
          language TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        )
      `);

      await db.run(`
        INSERT INTO voice_messages 
        (tenant_id, from_number, transcription, confidence, language)
        VALUES (?, ?, ?, ?, ?)
      `, [
        data.tenantId,
        data.from,
        data.transcription,
        data.confidence,
        data.language
      ]);
    } catch (error) {
      console.error('Voice message logging error:', error.message);
    }
  }

  /**
   * Get voice message history
   */
  async getVoiceHistory(tenantId, limit = 50) {
    try {
      const messages = await db.all(`
        SELECT * FROM voice_messages
        WHERE tenant_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `, [tenantId, limit]);

      return {
        success: true,
        messages,
        count: messages.length
      };
    } catch (error) {
      console.error('Voice history error:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Analyze voice message patterns
   */
  async analyzeVoicePatterns(tenantId, days = 30) {
    try {
      const patterns = await db.all(`
        SELECT 
          DATE(created_at) as date,
          COUNT(*) as message_count,
          AVG(confidence) as avg_confidence,
          language
        FROM voice_messages
        WHERE tenant_id = ?
          AND created_at >= date('now', '-' || ? || ' days')
        GROUP BY DATE(created_at), language
        ORDER BY date DESC
      `, [tenantId, days]);

      const intentDistribution = await db.all(`
        SELECT 
          transcription,
          language,
          COUNT(*) as count
        FROM voice_messages
        WHERE tenant_id = ?
          AND created_at >= date('now', '-' || ? || ' days')
        GROUP BY language
        ORDER BY count DESC
      `, [tenantId, days]);

      return {
        success: true,
        patterns,
        intentDistribution,
        period: `${days} days`
      };
    } catch (error) {
      console.error('Voice pattern analysis error:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Fallback transcription when service is disabled
   */
  fallbackTranscription() {
    return {
      success: false,
      message: 'Voice transcription not enabled. Set GOOGLE_CLOUD_SPEECH_ENABLED=true and configure credentials.',
      transcription: '[Voice message - transcription not available]'
    };
  }

  /**
   * Get service status
   */
  getStatus() {
    return {
      enabled: this.enabled,
      provider: this.enabled ? 'google_cloud_speech' : 'none',
      capabilities: this.enabled ? [
        'transcription',
        'multi_language',
        'punctuation',
        'word_timestamps'
      ] : []
    };
  }

  /**
   * Get supported languages
   */
  getSupportedLanguages() {
    return [
      { code: 'en-US', name: 'English (US)' },
      { code: 'en-GB', name: 'English (UK)' },
      { code: 'es-ES', name: 'Spanish' },
      { code: 'fr-FR', name: 'French' },
      { code: 'de-DE', name: 'German' },
      { code: 'hi-IN', name: 'Hindi' },
      { code: 'ar-SA', name: 'Arabic' },
      { code: 'zh-CN', name: 'Chinese (Simplified)' },
      { code: 'ja-JP', name: 'Japanese' },
      { code: 'pt-BR', name: 'Portuguese (Brazil)' }
    ];
  }
}

module.exports = new VoiceAIService();
