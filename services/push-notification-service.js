/**
 * Push Notification Service
 * Firebase Cloud Messaging for mobile notifications
 */

const admin = require('firebase-admin');
const { db } = require('./config');

class PushNotificationService {
  constructor() {
    this.initialized = false;
  }

  /**
   * Initialize Firebase Admin SDK
   */
  initialize() {
    if (this.initialized) return;

    try {
      if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount)
        });
        this.initialized = true;
        console.log('✅ Push notifications initialized');
      } else {
        console.warn('[PUSH] Firebase credentials not configured');
      }
    } catch (error) {
      console.error('[PUSH] Initialization failed:', error.message);
    }
  }

  /**
   * Send push notification
   */
  async send(token, notification, data = {}) {
    if (!this.initialized) return null;

    try {
      const message = {
        token,
        notification: {
          title: notification.title,
          body: notification.body,
          imageUrl: notification.image
        },
        data,
        android: {
          priority: 'high',
          notification: {
            sound: 'default',
            clickAction: 'FLUTTER_NOTIFICATION_CLICK'
          }
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: 1
            }
          }
        }
      };

      const response = await admin.messaging().send(message);
      console.log('[PUSH] Sent successfully:', response);
      return response;
    } catch (error) {
      console.error('[PUSH] Send failed:', error.message);
      return null;
    }
  }

  /**
   * Send to multiple devices
   */
  async sendMulti(tokens, notification, data = {}) {
    if (!this.initialized || !tokens.length) return;

    try {
      const message = {
        notification: {
          title: notification.title,
          body: notification.body
        },
        data,
        tokens
      };

      const response = await admin.messaging().sendMulticast(message);
      console.log(`[PUSH] Sent to ${response.successCount}/${tokens.length} devices`);
      return response;
    } catch (error) {
      console.error('[PUSH] Multi-send failed:', error.message);
      return null;
    }
  }

  /**
   * Send order notification
   */
  async sendOrderNotification(salesmanId, order) {
    const tokens = this.getSalesmanTokens(salesmanId);
    if (!tokens.length) return;

    await this.sendMulti(tokens, {
      title: '📦 New Order',
      body: `Order #${order.id} - ₹${order.total_amount}`
    }, {
      type: 'order',
      orderId: order.id,
      action: 'view_order'
    });
  }

  /**
   * Send visit reminder
   */
  async sendVisitReminder(salesmanId, visit) {
    const tokens = this.getSalesmanTokens(salesmanId);
    if (!tokens.length) return;

    await this.sendMulti(tokens, {
      title: '📅 Visit Reminder',
      body: `Meeting with ${visit.customer_name} today`
    }, {
      type: 'visit_reminder',
      visitId: visit.id,
      action: 'view_visit'
    });
  }

  /**
   * Send target alert
   */
  async sendTargetAlert(salesmanId, target) {
    const tokens = this.getSalesmanTokens(salesmanId);
    if (!tokens.length) return;

    await this.sendMulti(tokens, {
      title: '🎯 Target Update',
      body: `You've achieved ${target.achievement}% of your monthly target!`
    }, {
      type: 'target_alert',
      targetId: target.id,
      action: 'view_targets'
    });
  }

  /**
   * Get device tokens for salesman
   */
  getSalesmanTokens(salesmanId) {
    try {
      const devices = db.prepare(`
        SELECT fcm_token FROM mobile_devices 
        WHERE salesman_id = ? AND fcm_token IS NOT NULL AND is_active = 1
      `).all(salesmanId);

      return devices.map(d => d.fcm_token).filter(t => t);
    } catch (error) {
      console.error('[PUSH] Get tokens error:', error.message);
      return [];
    }
  }

  /**
   * Register device token
   */
  registerToken(salesmanId, token, deviceInfo = {}) {
    try {
      db.prepare(`
        INSERT OR REPLACE INTO mobile_devices 
        (salesman_id, fcm_token, device_type, device_os, app_version, is_active, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, datetime('now'))
      `).run(
        salesmanId,
        token,
        deviceInfo.type || 'unknown',
        deviceInfo.os || 'unknown',
        deviceInfo.version || '1.0.0'
      );

      console.log('[PUSH] Token registered for salesman:', salesmanId);
    } catch (error) {
      console.error('[PUSH] Register token error:', error.message);
    }
  }

  /**
   * Unregister device token
   */
  unregisterToken(token) {
    try {
      db.prepare(`
        UPDATE mobile_devices SET is_active = 0 WHERE fcm_token = ?
      `).run(token);
    } catch (error) {
      console.error('[PUSH] Unregister token error:', error.message);
    }
  }
}

module.exports = new PushNotificationService();
