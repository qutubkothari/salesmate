/**
 * Autonomous Follow-up Service
 * 
 * Automated email/WhatsApp sequences with:
 * - Multi-step drip campaigns
 * - Trigger-based enrollment
 * - A/B testing
 * - Engagement tracking
 * - Smart scheduling
 */

const Database = require('better-sqlite3');

class AutonomousFollowupService {
  /**
   * Create a new follow-up sequence
   */
  static createSequence(tenantId, sequenceData, createdBy) {
    const db = new Database(process.env.DB_PATH || 'local-database.db');

    try {
      const result = db.prepare(`
        INSERT INTO followup_sequences (
          tenant_id, sequence_name, sequence_type, description,
          target_customer_type, target_deal_stage, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        tenantId,
        sequenceData.name,
        sequenceData.type || 'nurture',
        sequenceData.description || null,
        sequenceData.targetCustomerType || null,
        sequenceData.targetDealStage || null,
        createdBy
      );

      return { sequenceId: result.lastInsertRowid };

    } finally {
      db.close();
    }
  }

  /**
   * Add step to sequence
   */
  static addStep(tenantId, sequenceId, stepData) {
    const db = new Database(process.env.DB_PATH || 'local-database.db');

    try {
      const result = db.prepare(`
        INSERT INTO sequence_steps (
          sequence_id, tenant_id, step_number, step_name,
          delay_days, delay_hours, send_time, skip_weekends,
          channel, subject_line, message_body,
          cta_text, cta_url
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        sequenceId,
        tenantId,
        stepData.stepNumber,
        stepData.name,
        stepData.delayDays || 0,
        stepData.delayHours || 0,
        stepData.sendTime || null,
        stepData.skipWeekends ? 1 : 0,
        stepData.channel,
        stepData.subjectLine || null,
        stepData.messageBody,
        stepData.ctaText || null,
        stepData.ctaUrl || null
      );

      return { stepId: result.lastInsertRowid };

    } finally {
      db.close();
    }
  }

  /**
   * List all sequences for tenant
   */
  static listSequences(tenantId) {
    const db = new Database(process.env.DB_PATH || 'local-database.db');

    try {
      const sequences = db.prepare(`
        SELECT * FROM followup_sequences
        WHERE tenant_id = ?
        ORDER BY created_at DESC
      `).all(tenantId);

      return sequences.map(seq => ({
        id: seq.id,
        name: seq.sequence_name,
        type: seq.sequence_type,
        description: seq.description,
        isActive: seq.is_active === 1,
        enrollments: seq.current_enrollments,
        totalSent: seq.total_sent,
        conversionRate: seq.conversion_rate,
        createdAt: seq.created_at
      }));

    } finally {
      db.close();
    }
  }

  /**
   * Enroll contact in sequence
   */
  static enrollContact(tenantId, sequenceId, enrollmentData, enrolledBy) {
    const db = new Database(process.env.DB_PATH || 'local-database.db');

    try {
      // Check if already enrolled
      const existing = db.prepare(`
        SELECT id FROM sequence_enrollments
        WHERE sequence_id = ?
          AND customer_id = ?
          AND enrollment_status IN ('active', 'paused')
      `).get(sequenceId, enrollmentData.customerId);

      if (existing) {
        throw new Error('Contact already enrolled in this sequence');
      }

      // Check unsubscribe status
      const unsubscribed = this._checkUnsubscribe(db, tenantId, enrollmentData.customerId, sequenceId);
      if (unsubscribed) {
        throw new Error('Contact has unsubscribed from this sequence');
      }

      // Calculate first send time
      const firstStep = db.prepare(`
        SELECT * FROM sequence_steps
        WHERE sequence_id = ?
        ORDER BY step_number ASC
        LIMIT 1
      `).get(sequenceId);

      if (!firstStep) {
        throw new Error('Sequence has no steps');
      }

      const nextSendAt = this._calculateNextSendTime(firstStep);

      const result = db.prepare(`
        INSERT INTO sequence_enrollments (
          sequence_id, tenant_id, customer_id, contact_id, deal_id,
          enrolled_by, enrollment_source, current_step, next_send_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        sequenceId,
        tenantId,
        enrollmentData.customerId,
        enrollmentData.contactId || null,
        enrollmentData.dealId || null,
        enrolledBy,
        enrollmentData.source || 'manual',
        0,
        nextSendAt
      );

      // Update sequence enrollment count
      db.prepare(`
        UPDATE followup_sequences
        SET current_enrollments = current_enrollments + 1
        WHERE id = ?
      `).run(sequenceId);

      return { enrollmentId: result.lastInsertRowid };

    } finally {
      db.close();
    }
  }

  /**
   * Process sequences - send pending messages (cron job)
   */
  static async processSequences() {
    const db = new Database(process.env.DB_PATH || 'local-database.db');

    try {
      const now = new Date().toISOString();

      // Get enrollments ready to send
      const readyEnrollments = db.prepare(`
        SELECT * FROM sequence_enrollments
        WHERE enrollment_status = 'active'
          AND next_send_at IS NOT NULL
          AND next_send_at <= ?
        LIMIT 100
      `).all(now);

      const results = {
        processed: 0,
        sent: 0,
        failed: 0,
        completed: 0
      };

      for (const enrollment of readyEnrollments) {
        results.processed++;

        try {
          // Get next step
          const nextStepNumber = enrollment.current_step + 1;
          const step = db.prepare(`
            SELECT * FROM sequence_steps
            WHERE sequence_id = ?
              AND step_number = ?
          `).get(enrollment.sequence_id, nextStepNumber);

          if (!step) {
            // Sequence completed
            db.prepare(`
              UPDATE sequence_enrollments
              SET enrollment_status = 'completed',
                  completed_at = CURRENT_TIMESTAMP
              WHERE id = ?
            `).run(enrollment.id);
            results.completed++;
            continue;
          }

          // Get customer details
          const customer = db.prepare(`
            SELECT * FROM customers
            WHERE id = ?
          `).get(enrollment.customer_id);

          if (!customer) {
            results.failed++;
            continue;
          }

          // Personalize message
          const personalizedMessage = this._personalizeMessage(
            step.message_body,
            customer,
            enrollment
          );

          const personalizedSubject = step.subject_line 
            ? this._personalizeMessage(step.subject_line, customer, enrollment)
            : null;

          // Determine recipient
          const recipient = step.channel === 'email' ? customer.email : customer.phone;

          if (!recipient) {
            results.failed++;
            continue;
          }

          // Create message record
          const messageId = db.prepare(`
            INSERT INTO sequence_messages (
              enrollment_id, step_id, tenant_id,
              channel, recipient_contact, subject_line, message_body,
              scheduled_send_at, actual_sent_at, delivery_status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 'sent')
          `).run(
            enrollment.id,
            step.id,
            enrollment.tenant_id,
            step.channel,
            recipient,
            personalizedSubject,
            personalizedMessage,
            now
          ).lastInsertRowid;

          // Send message via WhatsApp service
          const sendResult = await this._sendMessage(
            step.channel, 
            recipient, 
            personalizedSubject, 
            personalizedMessage,
            enrollment.tenant_id
          );

          // Update enrollment
          const nextStep = db.prepare(`
            SELECT * FROM sequence_steps
            WHERE sequence_id = ?
              AND step_number = ?
          `).get(enrollment.sequence_id, nextStepNumber + 1);

          const nextSendAt = nextStep ? this._calculateNextSendTime(nextStep, now) : null;

          db.prepare(`
            UPDATE sequence_enrollments
            SET current_step = ?,
                next_send_at = ?,
                total_messages_sent = total_messages_sent + 1
            WHERE id = ?
          `).run(nextStepNumber, nextSendAt, enrollment.id);

          // Update step stats
          db.prepare(`
            UPDATE sequence_steps
            SET sent_count = sent_count + 1
            WHERE id = ?
          `).run(step.id);

          // Update sequence stats
          db.prepare(`
            UPDATE followup_sequences
            SET total_sent = total_sent + 1
            WHERE id = ?
          `).run(enrollment.sequence_id);

          results.sent++;

        } catch (err) {
          console.error(`Error processing enrollment ${enrollment.id}:`, err);
          results.failed++;
        }
      }

      return results;

    } finally {
      db.close();
    }
  }

  /**
   * Pause sequence
   */
  static pauseSequence(tenantId, sequenceId) {
    const db = new Database(process.env.DB_PATH || 'local-database.db');

    try {
      db.prepare(`
        UPDATE followup_sequences
        SET is_active = 0
        WHERE id = ? AND tenant_id = ?
      `).run(sequenceId, tenantId);

      // Pause all active enrollments
      db.prepare(`
        UPDATE sequence_enrollments
        SET enrollment_status = 'paused'
        WHERE sequence_id = ?
          AND enrollment_status = 'active'
      `).run(sequenceId);

    } finally {
      db.close();
    }
  }

  /**
   * Activate sequence
   */
  static activateSequence(tenantId, sequenceId) {
    const db = new Database(process.env.DB_PATH || 'local-database.db');

    try {
      db.prepare(`
        UPDATE followup_sequences
        SET is_active = 1
        WHERE id = ? AND tenant_id = ?
      `).run(sequenceId, tenantId);

      // Resume paused enrollments
      db.prepare(`
        UPDATE sequence_enrollments
        SET enrollment_status = 'active'
        WHERE sequence_id = ?
          AND enrollment_status = 'paused'
      `).run(sequenceId);

    } finally {
      db.close();
    }
  }

  /**
   * Track message opened
   */
  static trackOpen(messageId) {
    const db = new Database(process.env.DB_PATH || 'local-database.db');

    try {
      const message = db.prepare('SELECT * FROM sequence_messages WHERE id = ?').get(messageId);
      if (!message) return;

      const isFirstOpen = !message.opened_at;

      db.prepare(`
        UPDATE sequence_messages
        SET opened_at = COALESCE(opened_at, CURRENT_TIMESTAMP),
            open_count = open_count + 1
        WHERE id = ?
      `).run(messageId);

      if (isFirstOpen) {
        // Update enrollment
        db.prepare(`
          UPDATE sequence_enrollments
          SET total_opened = total_opened + 1
          WHERE id = ?
        `).run(message.enrollment_id);

        // Update step stats
        db.prepare(`
          UPDATE sequence_steps
          SET opened_count = opened_count + 1
          WHERE id = ?
        `).run(message.step_id);

        // Update sequence stats
        const enrollment = db.prepare('SELECT * FROM sequence_enrollments WHERE id = ?').get(message.enrollment_id);
        db.prepare(`
          UPDATE followup_sequences
          SET total_opened = total_opened + 1,
              open_rate = CAST(total_opened AS REAL) / CAST(total_sent AS REAL)
          WHERE id = ?
        `).run(enrollment.sequence_id);
      }

    } finally {
      db.close();
    }
  }

  /**
   * Track link clicked
   */
  static trackClick(messageId) {
    const db = new Database(process.env.DB_PATH || 'local-database.db');

    try {
      const message = db.prepare('SELECT * FROM sequence_messages WHERE id = ?').get(messageId);
      if (!message) return;

      const isFirstClick = !message.first_clicked_at;

      db.prepare(`
        UPDATE sequence_messages
        SET first_clicked_at = COALESCE(first_clicked_at, CURRENT_TIMESTAMP),
            click_count = click_count + 1
        WHERE id = ?
      `).run(messageId);

      if (isFirstClick) {
        db.prepare(`
          UPDATE sequence_enrollments
          SET total_clicked = total_clicked + 1
          WHERE id = ?
        `).run(message.enrollment_id);

        db.prepare(`
          UPDATE sequence_steps
          SET clicked_count = clicked_count + 1
          WHERE id = ?
        `).run(message.step_id);

        const enrollment = db.prepare('SELECT * FROM sequence_enrollments WHERE id = ?').get(message.enrollment_id);
        db.prepare(`
          UPDATE followup_sequences
          SET total_clicked = total_clicked + 1,
              click_rate = CAST(total_clicked AS REAL) / CAST(total_sent AS REAL)
          WHERE id = ?
        `).run(enrollment.sequence_id);
      }

    } finally {
      db.close();
    }
  }

  /**
   * Track reply
   */
  static trackReply(messageId, replyText) {
    const db = new Database(process.env.DB_PATH || 'local-database.db');

    try {
      db.prepare(`
        UPDATE sequence_messages
        SET replied_at = CURRENT_TIMESTAMP,
            reply_text = ?
        WHERE id = ?
      `).run(replyText, messageId);

      const message = db.prepare('SELECT * FROM sequence_messages WHERE id = ?').get(messageId);

      db.prepare(`
        UPDATE sequence_enrollments
        SET total_replied = total_replied + 1
        WHERE id = ?
      `).run(message.enrollment_id);

      db.prepare(`
        UPDATE sequence_steps
        SET replied_count = replied_count + 1
        WHERE id = ?
      `).run(message.step_id);

      const enrollment = db.prepare('SELECT * FROM sequence_enrollments WHERE id = ?').get(message.enrollment_id);
      db.prepare(`
        UPDATE followup_sequences
        SET total_replied = total_replied + 1,
            reply_rate = CAST(total_replied AS REAL) / CAST(total_sent AS REAL)
        WHERE id = ?
      `).run(enrollment.sequence_id);

    } finally {
      db.close();
    }
  }

  /**
   * Mark enrollment as converted
   */
  static markConverted(enrollmentId, conversionValue = 0) {
    const db = new Database(process.env.DB_PATH || 'local-database.db');

    try {
      db.prepare(`
        UPDATE sequence_enrollments
        SET converted = 1,
            converted_at = CURRENT_TIMESTAMP,
            conversion_value = ?,
            enrollment_status = 'completed'
        WHERE id = ?
      `).run(conversionValue, enrollmentId);

      const enrollment = db.prepare('SELECT * FROM sequence_enrollments WHERE id = ?').get(enrollmentId);
      
      db.prepare(`
        UPDATE followup_sequences
        SET total_converted = total_converted + 1,
            conversion_rate = CAST(total_converted AS REAL) / CAST(current_enrollments AS REAL)
        WHERE id = ?
      `).run(enrollment.sequence_id);

    } finally {
      db.close();
    }
  }

  /**
   * Get sequence performance
   */
  static getSequencePerformance(sequenceId) {
    const db = new Database(process.env.DB_PATH || 'local-database.db');

    try {
      const sequence = db.prepare('SELECT * FROM followup_sequences WHERE id = ?').get(sequenceId);
      if (!sequence) throw new Error('Sequence not found');

      const steps = db.prepare(`
        SELECT * FROM sequence_steps
        WHERE sequence_id = ?
        ORDER BY step_number ASC
      `).all(sequenceId);

      const enrollmentStats = db.prepare(`
        SELECT 
          enrollment_status,
          COUNT(*) as count
        FROM sequence_enrollments
        WHERE sequence_id = ?
        GROUP BY enrollment_status
      `).all(sequenceId);

      return {
        sequence: {
          id: sequence.id,
          name: sequence.sequence_name,
          type: sequence.sequence_type,
          isActive: sequence.is_active === 1
        },
        performance: {
          totalEnrollments: sequence.current_enrollments,
          totalSent: sequence.total_sent,
          totalOpened: sequence.total_opened,
          totalClicked: sequence.total_clicked,
          totalReplied: sequence.total_replied,
          totalConverted: sequence.total_converted,
          openRate: sequence.open_rate,
          clickRate: sequence.click_rate,
          replyRate: sequence.reply_rate,
          conversionRate: sequence.conversion_rate
        },
        steps: steps.map(step => ({
          stepNumber: step.step_number,
          name: step.step_name,
          channel: step.channel,
          sent: step.sent_count,
          opened: step.opened_count,
          clicked: step.clicked_count,
          replied: step.replied_count,
          openRate: step.sent_count > 0 ? (step.opened_count / step.sent_count) * 100 : 0
        })),
        enrollmentBreakdown: enrollmentStats.reduce((acc, row) => {
          acc[row.enrollment_status] = row.count;
          return acc;
        }, {})
      };

    } finally {
      db.close();
    }
  }

  // Helper methods
  static _calculateNextSendTime(step, fromTime = null) {
    const baseTime = fromTime ? new Date(fromTime) : new Date();
    
    // Add delay
    baseTime.setDate(baseTime.getDate() + step.delay_days);
    baseTime.setHours(baseTime.getHours() + step.delay_hours);

    // Apply preferred send time if set
    if (step.send_time) {
      const [hours, minutes] = step.send_time.split(':').map(Number);
      baseTime.setHours(hours, minutes, 0, 0);
    }

    // Skip weekends if configured
    if (step.skip_weekends) {
      const dayOfWeek = baseTime.getDay();
      if (dayOfWeek === 0) { // Sunday
        baseTime.setDate(baseTime.getDate() + 1);
      } else if (dayOfWeek === 6) { // Saturday
        baseTime.setDate(baseTime.getDate() + 2);
      }
    }

    return baseTime.toISOString();
  }

  static _personalizeMessage(template, customer, enrollment) {
    let personalized = template;

    // Replace placeholders
    personalized = personalized.replace(/\{\{customer_name\}\}/g, customer.customer_name || 'there');
    personalized = personalized.replace(/\{\{company_name\}\}/g, customer.company_name || customer.customer_name || '');
    personalized = personalized.replace(/\{\{contact_person\}\}/g, customer.contact_person || '');

    return personalized;
  }

  static _checkUnsubscribe(db, tenantId, customerId, sequenceId) {
    const unsubscribe = db.prepare(`
      SELECT * FROM sequence_unsubscribes
      WHERE tenant_id = ?
        AND customer_id = ?
        AND (unsubscribe_type = 'all_sequences' OR sequence_id = ?)
    `).get(tenantId, customerId, sequenceId);

    return !!unsubscribe;
  }

  /**
   * Send message via WhatsApp or Email
   * @private
   */
  static async _sendMessage(channel, recipient, subject, messageBody, tenantId) {
    try {
      if (channel === 'whatsapp') {
        // Send via WhatsApp
        const { sendMessage } = require('./whatsappService');
        await sendMessage(tenantId, recipient, messageBody);
        
        console.log(`[FOLLOWUP] WhatsApp sent to ${recipient}`);
        return { success: true, channel: 'whatsapp' };
        
      } else if (channel === 'email') {
        // Send via Email (if email service is configured)
        const emailService = require('./emailService');
        await emailService.sendEmail({
          to: recipient,
          subject: subject,
          body: messageBody,
          tenantId: tenantId
        });
        
        console.log(`[FOLLOWUP] Email sent to ${recipient}`);
        return { success: true, channel: 'email' };
        
      } else {
        throw new Error(`Unsupported channel: ${channel}`);
      }
      
    } catch (error) {
      console.error(`[FOLLOWUP] Failed to send ${channel} to ${recipient}:`, error.message);
      throw error;
    }
  }
}

module.exports = AutonomousFollowupService;
