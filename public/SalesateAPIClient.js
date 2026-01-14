/**
 * Salesmate API Client
 * Reusable for both React web dashboard and React Native FSM app
 * Handles authentication, requests, and error handling
 */

class SalesateAPIClient {
  constructor(baseURL = 'https://salesmate.saksolution.com', authToken = null) {
    this.baseURL = baseURL;
    this.authToken = authToken;
    this.headers = {
      'Content-Type': 'application/json'
    };
    
    if (authToken) {
      this.headers['Authorization'] = `Bearer ${authToken}`;
    }
  }

  /**
   * Set authentication token
   */
  setAuthToken(token) {
    this.authToken = token;
    this.headers['Authorization'] = `Bearer ${token}`;
  }

  /**
   * Make HTTP request
   */
  async request(method, endpoint, body = null, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    const config = {
      method,
      headers: this.headers,
      ...options
    };

    if (body) {
      config.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(url, config);
      const data = await response.json();

      if (!response.ok) {
        throw {
          status: response.status,
          message: data.error || 'API Error',
          data
        };
      }

      return data;
    } catch (error) {
      console.error(`[SALESMATE_API] ${method} ${endpoint}:`, error);
      throw error;
    }
  }

  // ========== AUTHENTICATION ==========

  /**
   * Login with email and password
   */
  async login(email, password) {
    return this.request('POST', '/api/auth/login', { email, password });
  }

  /**
   * Logout
   */
  async logout() {
    return this.request('POST', '/api/auth/logout', {});
  }

  /**
   * Get current user
   */
  async getCurrentUser() {
    return this.request('GET', '/api/auth/me');
  }

  // ========== VISITS (Salesman) ==========

  /**
   * Create new visit
   */
  async createVisit(visitData) {
    return this.request('POST', '/api/visits', visitData);
  }

  /**
   * Get visit details
   */
  async getVisit(visitId) {
    return this.request('GET', `/api/visits/detail/${visitId}`);
  }

  /**
   * Get salesman's visits
   */
  async getSalesmanVisits(salesmanId, filters = {}) {
    const query = new URLSearchParams(filters).toString();
    return this.request('GET', `/api/visits/${salesmanId}${query ? '?' + query : ''}`);
  }

  /**
   * Get today's visits
   */
  async getTodayVisits() {
    return this.request('GET', '/api/visits/today');
  }

  /**
   * Update visit location (GPS)
   */
  async updateVisitLocation(visitId, latitude, longitude, accuracy = null) {
    return this.request('POST', `/api/visits/${visitId}/location`, {
      latitude,
      longitude,
      accuracy
    });
  }

  /**
   * Complete visit
   */
  async completeVisit(visitId, completionData) {
    return this.request('PUT', `/api/visits/${visitId}/complete`, completionData);
  }

  /**
   * Add images to visit
   */
  async addVisitImages(visitId, images) {
    return this.request('POST', `/api/visits/${visitId}/images`, { images });
  }

  // ========== ORDERS (Salesman/Manager) ==========

  /**
   * Create order
   */
  async createOrder(orderData) {
    return this.request('POST', '/api/orders', orderData);
  }

  /**
   * Get orders for customer
   */
  async getCustomerOrders(customerId) {
    return this.request('GET', `/api/orders/${customerId}`);
  }

  /**
   * Get order details
   */
  async getOrderDetails(orderId) {
    return this.request('GET', `/api/orders/detail/${orderId}`);
  }

  /**
   * Confirm draft order
   */
  async confirmOrder(orderId) {
    return this.request('PUT', `/api/orders/${orderId}/confirm`, {});
  }

  /**
   * Update order
   */
  async updateOrder(orderId, orderData) {
    return this.request('PUT', `/api/orders/${orderId}`, orderData);
  }

  // ========== TARGETS (Manager/Salesman) ==========

  /**
   * Get salesman targets
   */
  async getSalesmanTargets(salesmanId, period = null) {
    const query = period ? `?period=${period}` : '';
    return this.request('GET', `/api/targets/${salesmanId}${query}`);
  }

  /**
   * Get all targets for period
   */
  async getTenantTargets(period = null) {
    const query = period ? `?period=${period}` : '';
    return this.request('GET', `/api/targets/summary${query}`);
  }

  /**
   * Get performance summary
   */
  async getPerformanceSummary() {
    return this.request('GET', '/api/targets/performance');
  }

  /**
   * Record visit achievement
   */
  async recordVisitAchievement(salesmanId, visitId) {
    return this.request('POST', `/api/targets/${salesmanId}/achievement`, { visitId });
  }

  /**
   * Record order achievement
   */
  async recordOrderAchievement(salesmanId, orderId, amount) {
    return this.request('POST', `/api/targets/${salesmanId}/order`, { orderId, amount });
  }

  // ========== MANAGER DASHBOARD ==========

  /**
   * Get team overview
   */
  async getTeamOverview() {
    return this.request('GET', '/api/dashboard/manager/overview');
  }

  /**
   * Get performance analytics
   */
  async getAnalytics(days = 7) {
    return this.request('GET', `/api/dashboard/manager/analytics?days=${days}`);
  }

  /**
   * Get salesman detail
   */
  async getSalesmanDetail(salesmanId) {
    return this.request('GET', `/api/dashboard/manager/salesman/${salesmanId}`);
  }

  /**
   * Get real-time alerts
   */
  async getAlerts() {
    return this.request('GET', '/api/dashboard/manager/alerts');
  }

  /**
   * Get comprehensive report
   */
  async getReport() {
    return this.request('GET', '/api/dashboard/manager/report');
  }

  // ========== CUSTOMERS ==========

  /**
   * Get customer profile
   */
  async getCustomer(customerId) {
    return this.request('GET', `/api/customers/${customerId}`);
  }

  /**
   * Search customers
   */
  async searchCustomers(query, filters = {}) {
    const params = new URLSearchParams({ q: query, ...filters }).toString();
    return this.request('GET', `/api/customers/search?${params}`);
  }

  /**
   * Create customer
   */
  async createCustomer(customerData) {
    return this.request('POST', '/api/customers', customerData);
  }

  /**
   * Update customer
   */
  async updateCustomer(customerId, customerData) {
    return this.request('PUT', `/api/customers/${customerId}`, customerData);
  }

  // ========== ERROR HANDLING ==========

  /**
   * Handle API errors
   */
  static handleError(error) {
    if (error.status === 401) {
      return { error: 'Unauthorized. Please login again.' };
    }
    if (error.status === 403) {
      return { error: 'Access denied. Insufficient permissions.' };
    }
    if (error.status === 404) {
      return { error: 'Resource not found.' };
    }
    if (error.status >= 500) {
      return { error: 'Server error. Please try again later.' };
    }
    return { error: error.message || 'An error occurred.' };
  }
}

// Export for both Node.js and browsers
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SalesateAPIClient;
}
