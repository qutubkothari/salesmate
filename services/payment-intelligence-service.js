/**
 * Payment Intelligence Service
 * Tracks payment behavior, credit scoring, late payment analysis
 * Part of Phase 1: Account Intelligence
 */

const { db } = require('./config');
const crypto = require('crypto');

class PaymentIntelligenceService {
  
  // ===== PAYMENT TRACKING =====
  
  /**
   * Record a payment
   */
  static recordPayment(tenantId, paymentData) {
    const {
      customerId,
      orderId,
      invoiceId,
      paymentDate,
      paymentAmount,
      paymentMethod,
      transactionRef,
      chequeNumber,
      bankName,
      invoiceDueDate,
      invoiceDate,
      processedBy,
      paymentNotes
    } = paymentData;
    
    const id = crypto.randomBytes(16).toString('hex');
    
    // Calculate timing metrics
    const paymentDateObj = new Date(paymentDate);
    const invoiceDateObj = invoiceDate ? new Date(invoiceDate) : null;
    const dueDateObj = invoiceDueDate ? new Date(invoiceDueDate) : null;
    
    const daysToPayment = invoiceDateObj 
      ? Math.floor((paymentDateObj - invoiceDateObj) / (1000 * 60 * 60 * 24))
      : null;
      
    const daysOverdue = dueDateObj
      ? Math.floor((paymentDateObj - dueDateObj) / (1000 * 60 * 60 * 24))
      : null;
    
    const isLatePayment = daysOverdue > 0;
    
    db.prepare(`
      INSERT INTO payment_history (
        id, tenant_id, customer_id, order_id, invoice_id,
        payment_date, payment_amount, payment_method, payment_status,
        transaction_ref, cheque_number, bank_name,
        invoice_due_date, days_to_payment, days_overdue, is_late_payment,
        payment_notes, processed_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, tenantId, customerId || null, orderId || null, invoiceId || null,
      paymentDate, paymentAmount, paymentMethod, 'cleared',
      transactionRef || null, chequeNumber || null, bankName || null,
      invoiceDueDate || null, daysToPayment, daysOverdue, isLatePayment ? 1 : 0,
      paymentNotes || null, processedBy || null
    );
    
    // Update payment terms credit utilization
    if (customerId) {
      this.updateCreditUtilization(tenantId, customerId);
      
      // Recalculate credit score
      this.calculateCreditScore(tenantId, customerId);
      
      // Update payment patterns
      this.updatePaymentPatterns(tenantId, customerId);
    }
    
    return { paymentId: id, daysOverdue, isLatePayment };
  }
  
  /**
   * Mark payment as bounced
   */
  static markPaymentBounced(paymentId, reason) {
    db.prepare(`
      UPDATE payment_history 
      SET payment_status = 'bounced', is_bounced = 1, payment_notes = ?
      WHERE id = ?
    `).run(reason, paymentId);
    
    const payment = db.prepare('SELECT customer_id, tenant_id FROM payment_history WHERE id = ?').get(paymentId);
    
    if (payment && payment.customer_id) {
      // Recalculate credit score (bounced payments heavily impact score)
      this.calculateCreditScore(payment.tenant_id, payment.customer_id);
    }
  }
  
  // ===== CREDIT SCORING =====
  
  /**
   * Calculate comprehensive credit score for customer
   */
  static calculateCreditScore(tenantId, customerId) {
    const payments = db.prepare(`
      SELECT * FROM payment_history 
      WHERE tenant_id = ? AND customer_id = ? AND payment_status != 'cancelled'
      ORDER BY payment_date DESC
    `).all(tenantId, customerId);
    
    if (payments.length === 0) {
      return this._createDefaultCreditScore(tenantId, customerId);
    }
    
    // Calculate individual component scores
    const timelinessScore = this._calculateTimelinessScore(payments);
    const consistencyScore = this._calculateConsistencyScore(payments);
    const amountScore = this._calculateAmountScore(payments);
    const bounceRateScore = this._calculateBounceRateScore(payments);
    const utilizationScore = this._calculateUtilizationScore(tenantId, customerId);
    
    // Weighted composite score
    const overallScore = Math.round(
      timelinessScore * 0.35 +
      consistencyScore * 0.20 +
      amountScore * 0.15 +
      bounceRateScore * 0.20 +
      utilizationScore * 0.10
    );
    
    // Determine risk tier
    let riskTier = 'medium';
    if (overallScore >= 85) riskTier = 'very_low';
    else if (overallScore >= 70) riskTier = 'low';
    else if (overallScore >= 50) riskTier = 'medium';
    else if (overallScore >= 30) riskTier = 'high';
    else riskTier = 'very_high';
    
    // Identify risk factors
    const riskFactors = [];
    if (timelinessScore < 60) riskFactors.push('frequent_late_payments');
    if (bounceRateScore < 80) riskFactors.push('bounced_payments');
    if (consistencyScore < 50) riskFactors.push('irregular_payment_pattern');
    if (utilizationScore < 50) riskFactors.push('high_credit_utilization');
    
    // Calculate statistics
    const latePayments = payments.filter(p => p.is_late_payment).length;
    const bouncedPayments = payments.filter(p => p.is_bounced).length;
    const avgDaysToPayArr = payments.filter(p => p.days_to_payment !== null).map(p => p.days_to_payment);
    const avgDaysToPay = avgDaysToPayArr.length > 0 
      ? avgDaysToPayArr.reduce((sum, d) => sum + d, 0) / avgDaysToPayArr.length 
      : null;
    const longestDelay = Math.max(...payments.map(p => p.days_overdue || 0));
    
    // Upsert credit score
    const existing = db.prepare('SELECT id FROM customer_credit_scores WHERE tenant_id = ? AND customer_id = ?')
      .get(tenantId, customerId);
    
    if (existing) {
      db.prepare(`
        UPDATE customer_credit_scores SET
          payment_timeliness_score = ?,
          payment_consistency_score = ?,
          payment_amount_score = ?,
          bounce_rate_score = ?,
          credit_utilization_score = ?,
          overall_credit_score = ?,
          risk_tier = ?,
          risk_factors = ?,
          total_payments = ?,
          late_payments_count = ?,
          bounced_payments_count = ?,
          average_days_to_pay = ?,
          longest_delay_days = ?,
          score_calculated_at = CURRENT_TIMESTAMP,
          score_expires_at = datetime('now', '+30 days'),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        timelinessScore, consistencyScore, amountScore, bounceRateScore, utilizationScore,
        overallScore, riskTier, JSON.stringify(riskFactors),
        payments.length, latePayments, bouncedPayments,
        avgDaysToPay, longestDelay, existing.id
      );
    } else {
      const id = crypto.randomBytes(16).toString('hex');
      db.prepare(`
        INSERT INTO customer_credit_scores (
          id, tenant_id, customer_id,
          payment_timeliness_score, payment_consistency_score, payment_amount_score,
          bounce_rate_score, credit_utilization_score, overall_credit_score,
          risk_tier, risk_factors, total_payments, late_payments_count,
          bounced_payments_count, average_days_to_pay, longest_delay_days,
          score_calculated_at, score_expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, datetime('now', '+30 days'))
      `).run(
        id, tenantId, customerId,
        timelinessScore, consistencyScore, amountScore, bounceRateScore, utilizationScore,
        overallScore, riskTier, JSON.stringify(riskFactors),
        payments.length, latePayments, bouncedPayments,
        avgDaysToPay, longestDelay
      );
    }
    
    return {
      overallScore,
      riskTier,
      components: { timelinessScore, consistencyScore, amountScore, bounceRateScore, utilizationScore },
      riskFactors
    };
  }
  
  /**
   * Calculate timeliness score (35% weight)
   */
  static _calculateTimelinessScore(payments) {
    const recentPayments = payments.slice(0, 20); // Last 20 payments
    
    const onTimePayments = recentPayments.filter(p => !p.is_late_payment).length;
    const earlyPayments = recentPayments.filter(p => p.days_overdue < -5).length;
    const moderatelyLate = recentPayments.filter(p => p.days_overdue > 0 && p.days_overdue <= 15).length;
    const veryLate = recentPayments.filter(p => p.days_overdue > 15).length;
    
    let score = 50; // Base score
    
    // Reward on-time payments
    score += (onTimePayments / recentPayments.length) * 30;
    
    // Reward early payments
    score += (earlyPayments / recentPayments.length) * 20;
    
    // Penalize late payments
    score -= (moderatelyLate / recentPayments.length) * 20;
    score -= (veryLate / recentPayments.length) * 40;
    
    return Math.max(0, Math.min(100, score));
  }
  
  /**
   * Calculate consistency score (20% weight)
   */
  static _calculateConsistencyScore(payments) {
    if (payments.length < 3) return 50; // Not enough data
    
    const daysToPayment = payments.filter(p => p.days_to_payment !== null).map(p => p.days_to_payment);
    
    if (daysToPayment.length === 0) return 50;
    
    // Calculate standard deviation
    const mean = daysToPayment.reduce((sum, d) => sum + d, 0) / daysToPayment.length;
    const variance = daysToPayment.reduce((sum, d) => sum + Math.pow(d - mean, 2), 0) / daysToPayment.length;
    const stdDev = Math.sqrt(variance);
    
    // Lower std deviation = higher score (more consistent)
    let score = 100 - (stdDev * 2);
    
    return Math.max(0, Math.min(100, score));
  }
  
  /**
   * Calculate amount score (15% weight)
   */
  static _calculateAmountScore(payments) {
    const partialPayments = payments.filter(p => p.is_partial_payment).length;
    const fullPayments = payments.length - partialPayments;
    
    let score = (fullPayments / payments.length) * 100;
    
    return Math.max(0, Math.min(100, score));
  }
  
  /**
   * Calculate bounce rate score (20% weight)
   */
  static _calculateBounceRateScore(payments) {
    const bouncedPayments = payments.filter(p => p.is_bounced).length;
    
    // Each bounced payment reduces score significantly
    let score = 100 - (bouncedPayments * 20);
    
    return Math.max(0, Math.min(100, score));
  }
  
  /**
   * Calculate credit utilization score (10% weight)
   */
  static _calculateUtilizationScore(tenantId, customerId) {
    const terms = db.prepare('SELECT credit_limit, credit_utilized FROM payment_terms WHERE tenant_id = ? AND customer_id = ?')
      .get(tenantId, customerId);
    
    if (!terms || !terms.credit_limit) return 75; // Default if no credit limit
    
    const utilizationRate = (terms.credit_utilized / terms.credit_limit) * 100;
    
    // Lower utilization = higher score
    let score = 100;
    if (utilizationRate > 90) score = 20;
    else if (utilizationRate > 75) score = 40;
    else if (utilizationRate > 50) score = 60;
    else if (utilizationRate > 30) score = 80;
    
    return score;
  }
  
  /**
   * Create default credit score for new customer
   */
  static _createDefaultCreditScore(tenantId, customerId) {
    const id = crypto.randomBytes(16).toString('hex');
    
    db.prepare(`
      INSERT INTO customer_credit_scores (
        id, tenant_id, customer_id,
        payment_timeliness_score, payment_consistency_score, payment_amount_score,
        bounce_rate_score, credit_utilization_score, overall_credit_score,
        risk_tier, risk_factors,
        score_calculated_at, score_expires_at
      ) VALUES (?, ?, ?, 50, 50, 50, 100, 75, 65, 'medium', '[]', CURRENT_TIMESTAMP, datetime('now', '+30 days'))
    `).run(id, tenantId, customerId);
    
    return { overallScore: 65, riskTier: 'medium' };
  }
  
  // ===== PAYMENT PATTERNS =====
  
  /**
   * Analyze and update payment patterns for a customer
   */
  static updatePaymentPatterns(tenantId, customerId) {
    const payments = db.prepare(`
      SELECT * FROM payment_history 
      WHERE tenant_id = ? AND customer_id = ? AND payment_status = 'cleared'
      ORDER BY payment_date ASC
    `).all(tenantId, customerId);
    
    if (payments.length < 3) return; // Not enough data for pattern analysis
    
    // Find most common payment day of month
    const paymentDays = payments.map(p => new Date(p.payment_date).getDate());
    const dayFrequency = {};
    paymentDays.forEach(day => {
      dayFrequency[day] = (dayFrequency[day] || 0) + 1;
    });
    const mostCommonDay = Object.keys(dayFrequency).reduce((a, b) => dayFrequency[a] > dayFrequency[b] ? a : b);
    
    // Detect frequency
    const avgDaysBetween = this._calculateAverageDaysBetween(payments.map(p => p.payment_date));
    let frequency = 'irregular';
    if (avgDaysBetween <= 10) frequency = 'weekly';
    else if (avgDaysBetween <= 20) frequency = 'biweekly';
    else if (avgDaysBetween <= 40) frequency = 'monthly';
    else if (avgDaysBetween <= 120) frequency = 'quarterly';
    
    // Find preferred payment method
    const methodFreq = {};
    payments.forEach(p => {
      methodFreq[p.payment_method] = (methodFreq[p.payment_method] || 0) + 1;
    });
    const preferredMethod = Object.keys(methodFreq).reduce((a, b) => methodFreq[a] > methodFreq[b] ? a : b, null);
    
    // Calculate behavioral metrics
    const avgCycleDays = payments.filter(p => p.days_to_payment).reduce((sum, p) => sum + p.days_to_payment, 0) / payments.length;
    const onTimeCount = payments.filter(p => !p.is_late_payment).length;
    const earlyCount = payments.filter(p => p.days_overdue < 0).length;
    const lateCount = payments.filter(p => p.is_late_payment).length;
    
    const onTimeRate = (onTimeCount / payments.length) * 100;
    const earlyRate = (earlyCount / payments.length) * 100;
    const lateRate = (lateCount / payments.length) * 100;
    
    // Seasonal patterns (by month)
    const monthlyPayments = {};
    payments.forEach(p => {
      const month = new Date(p.payment_date).getMonth() + 1;
      monthlyPayments[month] = (monthlyPayments[month] || 0) + 1;
    });
    
    const sortedMonths = Object.entries(monthlyPayments).sort((a, b) => b[1] - a[1]);
    const bestMonths = sortedMonths.slice(0, 3).map(([month]) => parseInt(month));
    const worstMonths = sortedMonths.slice(-3).map(([month]) => parseInt(month));
    
    // Predict next payment
    const lastPayment = new Date(payments[payments.length - 1].payment_date);
    const nextExpectedDate = new Date(lastPayment);
    nextExpectedDate.setDate(nextExpectedDate.getDate() + avgDaysBetween);
    
    // Upsert pattern
    const existing = db.prepare('SELECT id FROM payment_patterns WHERE tenant_id = ? AND customer_id = ?')
      .get(tenantId, customerId);
    
    if (existing) {
      db.prepare(`
        UPDATE payment_patterns SET
          payment_day_of_month = ?,
          payment_frequency = ?,
          preferred_payment_method = ?,
          average_payment_cycle_days = ?,
          early_payment_rate = ?,
          on_time_payment_rate = ?,
          late_payment_rate = ?,
          seasonal_patterns = ?,
          best_payment_months = ?,
          worst_payment_months = ?,
          next_expected_payment_date = ?,
          sample_size = ?,
          last_analyzed_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        mostCommonDay, frequency, preferredMethod, avgCycleDays,
        earlyRate, onTimeRate, lateRate,
        JSON.stringify(monthlyPayments),
        JSON.stringify(bestMonths),
        JSON.stringify(worstMonths),
        nextExpectedDate.toISOString().split('T')[0],
        payments.length, existing.id
      );
    } else {
      const id = crypto.randomBytes(16).toString('hex');
      db.prepare(`
        INSERT INTO payment_patterns (
          id, tenant_id, customer_id,
          payment_day_of_month, payment_frequency, preferred_payment_method,
          average_payment_cycle_days, early_payment_rate, on_time_payment_rate, late_payment_rate,
          seasonal_patterns, best_payment_months, worst_payment_months,
          next_expected_payment_date, sample_size, last_analyzed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).run(
        id, tenantId, customerId,
        mostCommonDay, frequency, preferredMethod,
        avgCycleDays, earlyRate, onTimeRate, lateRate,
        JSON.stringify(monthlyPayments),
        JSON.stringify(bestMonths),
        JSON.stringify(worstMonths),
        nextExpectedDate.toISOString().split('T')[0],
        payments.length
      );
    }
  }
  
  static _calculateAverageDaysBetween(dates) {
    if (dates.length < 2) return 0;
    
    const sortedDates = dates.map(d => new Date(d)).sort((a, b) => a - b);
    let totalDays = 0;
    
    for (let i = 1; i < sortedDates.length; i++) {
      const daysDiff = (sortedDates[i] - sortedDates[i - 1]) / (1000 * 60 * 60 * 24);
      totalDays += daysDiff;
    }
    
    return totalDays / (sortedDates.length - 1);
  }
  
  // ===== CREDIT MANAGEMENT =====
  
  /**
   * Set payment terms for customer
   */
  static setPaymentTerms(tenantId, customerId, termsData) {
    const {
      paymentTermDays,
      creditLimit,
      earlyPaymentDiscountPercent,
      earlyPaymentDays,
      latePaymentPenaltyPercent,
      approvedBy,
      validUntil
    } = termsData;
    
    const existing = db.prepare('SELECT id FROM payment_terms WHERE tenant_id = ? AND customer_id = ?')
      .get(tenantId, customerId);
    
    if (existing) {
      db.prepare(`
        UPDATE payment_terms SET
          payment_term_days = ?,
          credit_limit = ?,
          early_payment_discount_percent = ?,
          early_payment_days = ?,
          late_payment_penalty_percent = ?,
          approved_by = ?,
          approved_at = CURRENT_TIMESTAMP,
          effective_from = CURRENT_TIMESTAMP,
          valid_until = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        paymentTermDays, creditLimit, earlyPaymentDiscountPercent || 0,
        earlyPaymentDays || 7, latePaymentPenaltyPercent || 0,
        approvedBy, validUntil || null, existing.id
      );
      
      return existing.id;
    } else {
      const id = crypto.randomBytes(16).toString('hex');
      db.prepare(`
        INSERT INTO payment_terms (
          id, tenant_id, customer_id, payment_term_days, credit_limit,
          early_payment_discount_percent, early_payment_days,
          late_payment_penalty_percent, approved_by, approved_at,
          effective_from, valid_until
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?)
      `).run(
        id, tenantId, customerId, paymentTermDays, creditLimit,
        earlyPaymentDiscountPercent || 0, earlyPaymentDays || 7,
        latePaymentPenaltyPercent || 0, approvedBy, validUntil || null
      );
      
      return id;
    }
  }
  
  /**
   * Update credit utilization
   */
  static updateCreditUtilization(tenantId, customerId) {
    const outstandingOrders = db.prepare(`
      SELECT SUM(total_amount) as total
      FROM orders
      WHERE tenant_id = ? AND customer_id = ? AND payment_status IN ('pending', 'partial')
    `).get(tenantId, customerId);
    
    const utilized = outstandingOrders?.total || 0;
    
    db.prepare(`
      UPDATE payment_terms SET credit_utilized = ?, updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ? AND customer_id = ?
    `).run(utilized, tenantId, customerId);
  }
  
  /**
   * Suspend credit for customer
   */
  static suspendCredit(tenantId, customerId, reason, suspendedBy) {
    db.prepare(`
      UPDATE payment_terms 
      SET credit_status = 'suspended', credit_reason = ?, updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ? AND customer_id = ?
    `).run(reason, tenantId, customerId);
  }
  
  // ===== ANALYTICS & REPORTS =====
  
  /**
   * Get aging report for tenant
   */
  static getAgingReport(tenantId, asOfDate = null) {
    const targetDate = asOfDate ? new Date(asOfDate) : new Date();
    
    const customers = db.prepare(`
      SELECT DISTINCT customer_id 
      FROM orders 
      WHERE tenant_id = ? AND payment_status IN ('pending', 'partial')
    `).all(tenantId);
    
    const report = customers.map(c => {
      const orders = db.prepare(`
        SELECT * FROM orders 
        WHERE tenant_id = ? AND customer_id = ? AND payment_status IN ('pending', 'partial')
      `).all(tenantId, c.customer_id);
      
      let current = 0, days30 = 0, days60 = 0, days90 = 0;
      let currentCount = 0, days30Count = 0, days60Count = 0, days90Count = 0;
      
      orders.forEach(order => {
        const orderDate = new Date(order.order_date || order.created_at);
        const daysPast = Math.floor((targetDate - orderDate) / (1000 * 60 * 60 * 24));
        const amount = order.total_amount || 0;
        
        if (daysPast <= 30) { current += amount; currentCount++; }
        else if (daysPast <= 60) { days30 += amount; days30Count++; }
        else if (daysPast <= 90) { days60 += amount; days60Count++; }
        else { days90 += amount; days90Count++; }
      });
      
      const customer = db.prepare('SELECT business_name FROM customer_profiles_new WHERE id = ?').get(c.customer_id);
      
      return {
        customerId: c.customer_id,
        customerName: customer?.business_name || 'Unknown',
        current, days30, days60, days90,
        total: current + days30 + days60 + days90,
        currentCount, days30Count, days60Count, days90Count
      };
    });
    
    return report.filter(r => r.total > 0);
  }
  
  /**
   * Create aging snapshot
   */
  static createAgingSnapshot(tenantId, snapshotType = 'weekly') {
    const report = this.getAgingReport(tenantId);
    
    report.forEach(r => {
      const id = crypto.randomBytes(16).toString('hex');
      db.prepare(`
        INSERT INTO aging_report_snapshots (
          id, tenant_id, customer_id, snapshot_date, snapshot_type,
          current_amount, days_30_amount, days_60_amount, days_90_amount, total_outstanding,
          current_invoices, days_30_invoices, days_60_invoices, days_90_invoices
        ) VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, tenantId, r.customerId, snapshotType,
        r.current, r.days30, r.days60, r.days90, r.total,
        r.currentCount, r.days30Count, r.days60Count, r.days90Count
      );
    });
    
    // Create tenant-level summary
    const id = crypto.randomBytes(16).toString('hex');
    const totals = report.reduce((acc, r) => ({
      current: acc.current + r.current,
      days30: acc.days30 + r.days30,
      days60: acc.days60 + r.days60,
      days90: acc.days90 + r.days90,
      total: acc.total + r.total,
      currentCount: acc.currentCount + r.currentCount,
      days30Count: acc.days30Count + r.days30Count,
      days60Count: acc.days60Count + r.days60Count,
      days90Count: acc.days90Count + r.days90Count
    }), { current: 0, days30: 0, days60: 0, days90: 0, total: 0, currentCount: 0, days30Count: 0, days60Count: 0, days90Count: 0 });
    
    db.prepare(`
      INSERT INTO aging_report_snapshots (
        id, tenant_id, customer_id, snapshot_date, snapshot_type,
        current_amount, days_30_amount, days_60_amount, days_90_amount, total_outstanding,
        current_invoices, days_30_invoices, days_60_invoices, days_90_invoices
      ) VALUES (?, ?, NULL, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, tenantId, snapshotType,
      totals.current, totals.days30, totals.days60, totals.days90, totals.total,
      totals.currentCount, totals.days30Count, totals.days60Count, totals.days90Count
    );
  }
  
  /**
   * Get payment insights for customer
   */
  static getCustomerPaymentInsights(tenantId, customerId) {
    const score = db.prepare('SELECT * FROM customer_credit_scores WHERE tenant_id = ? AND customer_id = ?')
      .get(tenantId, customerId);
    
    const pattern = db.prepare('SELECT * FROM payment_patterns WHERE tenant_id = ? AND customer_id = ?')
      .get(tenantId, customerId);
    
    const terms = db.prepare('SELECT * FROM payment_terms WHERE tenant_id = ? AND customer_id = ?')
      .get(tenantId, customerId);
    
    const recentPayments = db.prepare(`
      SELECT * FROM payment_history 
      WHERE tenant_id = ? AND customer_id = ?
      ORDER BY payment_date DESC LIMIT 10
    `).all(tenantId, customerId);
    
    return {
      creditScore: score,
      paymentPattern: pattern,
      paymentTerms: terms,
      recentPayments,
      recommendations: this._generateRecommendations(score, pattern, terms)
    };
  }
  
  /**
   * Generate recommendations based on payment behavior
   */
  static _generateRecommendations(score, pattern, terms) {
    const recommendations = [];
    
    if (!score) return ['Insufficient payment history'];
    
    if (score.overall_credit_score < 50) {
      recommendations.push('⚠️ HIGH RISK: Consider cash-only or advance payment');
    }
    
    if (score.late_payments_count > 5) {
      recommendations.push('Frequent late payments - reduce credit limit or shorten payment terms');
    }
    
    if (score.bounced_payments_count > 0) {
      recommendations.push('Payment bounced history - require bank guarantee');
    }
    
    if (pattern && pattern.on_time_payment_rate > 90) {
      recommendations.push('✅ Excellent payment history - eligible for credit limit increase');
    }
    
    if (pattern && pattern.early_payment_rate > 50) {
      recommendations.push('Frequently pays early - offer early payment discount');
    }
    
    if (terms && terms.credit_utilized / terms.credit_limit > 0.9) {
      recommendations.push('Near credit limit - monitor closely or increase limit');
    }
    
    return recommendations.length > 0 ? recommendations : ['No specific recommendations'];
  }
}

module.exports = PaymentIntelligenceService;
