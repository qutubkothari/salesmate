/**
 * Multi-Language Translation Service
 * Support for 20+ languages in AI responses
 * Note: Requires Google Cloud Translation API credentials
 */

const { db } = require('./config');

class TranslationService {
  constructor() {
    this.enabled = process.env.GOOGLE_CLOUD_TRANSLATE_ENABLED === 'true';
    this.translateClient = null;
    
    // Supported languages
    this.languages = {
      en: 'English',
      es: 'Spanish',
      fr: 'French',
      de: 'German',
      it: 'Italian',
      pt: 'Portuguese',
      ru: 'Russian',
      zh: 'Chinese',
      ja: 'Japanese',
      ko: 'Korean',
      ar: 'Arabic',
      hi: 'Hindi',
      tr: 'Turkish',
      nl: 'Dutch',
      pl: 'Polish',
      sv: 'Swedish',
      no: 'Norwegian',
      da: 'Danish',
      fi: 'Finnish',
      cs: 'Czech',
      hu: 'Hungarian',
      ro: 'Romanian',
      th: 'Thai',
      vi: 'Vietnamese',
      id: 'Indonesian'
    };
    
    if (this.enabled) {
      this.initialize();
    }
  }

  /**
   * Initialize Google Cloud Translation
   */
  async initialize() {
    try {
      const { Translate } = require('@google-cloud/translate').v2;
      
      this.translateClient = new Translate({
        keyFilename: process.env.GOOGLE_CLOUD_KEYFILE
      });
      
      console.log('Translation service initialized with', Object.keys(this.languages).length, 'languages');
    } catch (error) {
      console.warn('Translation service not available:', error.message);
      this.enabled = false;
    }
  }

  /**
   * Translate text to target language
   */
  async translate(text, targetLanguage, sourceLanguage = 'auto') {
    if (!this.enabled) {
      return this.fallbackTranslation(text, targetLanguage);
    }

    try {
      // Check cache first
      const cached = await this.getCachedTranslation(text, targetLanguage);
      if (cached) {
        return cached;
      }

      // Translate with Google Cloud
      const options = {
        to: targetLanguage
      };
      
      if (sourceLanguage !== 'auto') {
        options.from = sourceLanguage;
      }

      const [translation] = await this.translateClient.translate(text, options);
      
      // Detect source language if auto
      let detectedLanguage = sourceLanguage;
      if (sourceLanguage === 'auto') {
        const [detection] = await this.translateClient.detect(text);
        detectedLanguage = detection.language;
      }

      const result = {
        success: true,
        originalText: text,
        translatedText: translation,
        sourceLanguage: detectedLanguage,
        targetLanguage,
        provider: 'google_cloud'
      };

      // Cache translation
      await this.cacheTranslation(text, targetLanguage, translation, detectedLanguage);

      return result;
    } catch (error) {
      console.error('Translation error:', error.message);
      return {
        success: false,
        error: error.message,
        fallback: this.fallbackTranslation(text, targetLanguage)
      };
    }
  }

  /**
   * Translate AI response before sending
   */
  async translateAIResponse(response, userLanguage) {
    if (userLanguage === 'en' || !this.enabled) {
      return response;
    }

    try {
      const translated = await this.translate(response, userLanguage, 'en');
      return translated.success ? translated.translatedText : response;
    } catch (error) {
      console.error('AI response translation error:', error.message);
      return response; // Return original if translation fails
    }
  }

  /**
   * Detect language of text
   */
  async detectLanguage(text) {
    if (!this.enabled) {
      return { language: 'en', confidence: 0 };
    }

    try {
      const [detection] = await this.translateClient.detect(text);
      
      return {
        success: true,
        language: detection.language,
        confidence: detection.confidence,
        languageName: this.languages[detection.language] || detection.language
      };
    } catch (error) {
      console.error('Language detection error:', error.message);
      return {
        success: false,
        error: error.message,
        language: 'en',
        confidence: 0
      };
    }
  }

  /**
   * Translate batch of texts
   */
  async translateBatch(texts, targetLanguage, sourceLanguage = 'auto') {
    if (!this.enabled) {
      return texts.map(text => ({
        originalText: text,
        translatedText: text,
        targetLanguage
      }));
    }

    try {
      const options = {
        to: targetLanguage
      };
      
      if (sourceLanguage !== 'auto') {
        options.from = sourceLanguage;
      }

      const [translations] = await this.translateClient.translate(texts, options);
      
      return texts.map((text, index) => ({
        success: true,
        originalText: text,
        translatedText: translations[index],
        targetLanguage,
        sourceLanguage
      }));
    } catch (error) {
      console.error('Batch translation error:', error.message);
      return texts.map(text => ({
        success: false,
        error: error.message,
        originalText: text,
        translatedText: text
      }));
    }
  }

  /**
   * Cache translation to avoid repeated API calls
   */
  async cacheTranslation(originalText, targetLanguage, translatedText, sourceLanguage) {
    try {
      await db.run(`
        CREATE TABLE IF NOT EXISTS translation_cache (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          original_text TEXT NOT NULL,
          source_language TEXT,
          target_language TEXT NOT NULL,
          translated_text TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now')),
          UNIQUE(original_text, target_language)
        )
      `);

      await db.run(`
        INSERT OR REPLACE INTO translation_cache 
        (original_text, source_language, target_language, translated_text)
        VALUES (?, ?, ?, ?)
      `, [originalText, sourceLanguage, targetLanguage, translatedText]);
    } catch (error) {
      console.error('Translation cache error:', error.message);
    }
  }

  /**
   * Get cached translation
   */
  async getCachedTranslation(text, targetLanguage) {
    try {
      const cached = await db.get(`
        SELECT * FROM translation_cache
        WHERE original_text = ? AND target_language = ?
        AND created_at >= date('now', '-30 days')
      `, [text, targetLanguage]);

      if (cached) {
        return {
          success: true,
          originalText: cached.original_text,
          translatedText: cached.translated_text,
          sourceLanguage: cached.source_language,
          targetLanguage: cached.target_language,
          provider: 'cache'
        };
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get supported languages
   */
  getSupportedLanguages() {
    return Object.entries(this.languages).map(([code, name]) => ({
      code,
      name
    }));
  }

  /**
   * Clear translation cache
   */
  async clearCache(olderThanDays = 30) {
    try {
      const result = await db.run(`
        DELETE FROM translation_cache
        WHERE created_at < date('now', '-' || ? || ' days')
      `, [olderThanDays]);

      return {
        success: true,
        deletedRows: result.changes
      };
    } catch (error) {
      console.error('Cache clear error:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get translation statistics
   */
  async getStats() {
    try {
      const stats = await db.get(`
        SELECT 
          COUNT(*) as total_translations,
          COUNT(DISTINCT target_language) as languages_used,
          COUNT(DISTINCT source_language) as source_languages
        FROM translation_cache
        WHERE created_at >= date('now', '-30 days')
      `);

      const topLanguages = await db.all(`
        SELECT 
          target_language,
          COUNT(*) as translation_count
        FROM translation_cache
        WHERE created_at >= date('now', '-30 days')
        GROUP BY target_language
        ORDER BY translation_count DESC
        LIMIT 10
      `);

      return {
        success: true,
        ...stats,
        topLanguages,
        period: '30 days'
      };
    } catch (error) {
      console.error('Stats error:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Fallback when translation service is disabled
   */
  fallbackTranslation(text, targetLanguage) {
    return {
      success: false,
      message: 'Translation service not enabled',
      originalText: text,
      translatedText: text,
      targetLanguage,
      provider: 'none'
    };
  }

  /**
   * Get service status
   */
  getStatus() {
    return {
      enabled: this.enabled,
      provider: this.enabled ? 'google_cloud_translate' : 'none',
      supportedLanguages: Object.keys(this.languages).length,
      languages: this.getSupportedLanguages()
    };
  }
}

module.exports = new TranslationService();
