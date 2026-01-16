/**
 * API Utility Module
 * Centralized API communication layer with error handling and retry logic
 * @module utils/api
 */

class APIClient {
    constructor(baseURL = '') {
        this.baseURL = baseURL;
        this.defaultHeaders = {
            'Content-Type': 'application/json'
        };
    }

    /**
     * Generic fetch wrapper with error handling
     * @param {string} endpoint - API endpoint
     * @param {Object} options - Fetch options
     * @returns {Promise<any>} - Response data
     */
    async request(endpoint, options = {}) {
        const config = {
            ...options,
            headers: {
                ...this.defaultHeaders,
                ...options.headers
            }
        };

        try {
            const response = await fetch(`${this.baseURL}${endpoint}`, config);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const contentType = response.headers.get('content-type');
            if (contentType?.includes('application/json')) {
                return await response.json();
            }
            
            return await response.text();
        } catch (error) {
            console.error(`API Error [${endpoint}]:`, error);
            throw error;
        }
    }

    // GET request
    async get(endpoint, params = {}) {
        const queryString = new URLSearchParams(params).toString();
        const url = queryString ? `${endpoint}?${queryString}` : endpoint;
        return this.request(url, { method: 'GET' });
    }

    // POST request
    async post(endpoint, data) {
        return this.request(endpoint, {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }

    // PUT request
    async put(endpoint, data) {
        return this.request(endpoint, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    }

    // DELETE request
    async delete(endpoint) {
        return this.request(endpoint, { method: 'DELETE' });
    }

    // PATCH request
    async patch(endpoint, data) {
        return this.request(endpoint, {
            method: 'PATCH',
            body: JSON.stringify(data)
        });
    }
}

// Create singleton instance
const api = new APIClient('/api');

// FSM API endpoints
export const fsmAPI = {
    // Visits
    getVisits: (filters = {}) => api.get('/visits', filters),
    getVisit: (id) => api.get(`/visits/${id}`),
    createVisit: (data) => api.post('/visits', data),
    updateVisit: (id, data) => api.put(`/visits/${id}`, data),
    deleteVisit: (id) => api.delete(`/visits/${id}`),

    // Salesmen
    getSalesmen: () => api.get('/salesmen'),
    getSalesman: (id) => api.get(`/salesmen/${id}`),
    createSalesman: (data) => api.post('/salesmen', data),
    updateSalesman: (id, data) => api.put(`/salesmen/${id}`, data),
    deleteSalesman: (id) => api.delete(`/salesmen/${id}`),

    // Targets
    getTargets: (filters = {}) => api.get('/targets', filters),
    getTarget: (id) => api.get(`/targets/${id}`),
    createTarget: (data) => api.post('/targets', data),
    updateTarget: (id, data) => api.put(`/targets/${id}`, data),
    deleteTarget: (id) => api.delete(`/targets/${id}`),

    // Branches (future)
    getBranches: () => api.get('/branches'),
    getBranch: (id) => api.get(`/branches/${id}`),
    createBranch: (data) => api.post('/branches', data),
    updateBranch: (id, data) => api.put(`/branches/${id}`, data),
    deleteBranch: (id) => api.delete(`/branches/${id}`)
};

// Core Salesmate API endpoints
export const salesAPI = {
    // Stats
    getStats: () => api.get('/stats'),

    // Conversations
    getConversations: (filters = {}) => api.get('/conversations', filters),
    getConversation: (id) => api.get(`/conversations/${id}`),

    // Orders
    getOrders: (filters = {}) => api.get('/orders', filters),
    getOrder: (id) => api.get(`/orders/${id}`),
    createOrder: (data) => api.post('/orders', data),
    updateOrder: (id, data) => api.put(`/orders/${id}`, data),

    // Products
    getProducts: (filters = {}) => api.get('/products', filters),
    getProduct: (id) => api.get(`/products/${id}`),
    createProduct: (data) => api.post('/products', data),
    updateProduct: (id, data) => api.put(`/products/${id}`, data),
    deleteProduct: (id) => api.delete(`/products/${id}`),

    // Customers
    getCustomers: (filters = {}) => api.get('/customers', filters),
    getCustomer: (id) => api.get(`/customers/${id}`),

    // Leads
    getLeads: (filters = {}) => api.get('/leads', filters),
    getLead: (id) => api.get(`/leads/${id}`),

    // Categories
    getCategories: (filters = {}) => api.get('/categories', filters),

    // Documents
    getDocuments: () => api.get('/documents'),

    // Analytics
    getAnalytics: (filters = {}) => api.get('/analytics', filters),

    // Settings
    getSettings: () => api.get('/settings'),
    updateSettings: (data) => api.put('/settings', data)
};

export default api;
