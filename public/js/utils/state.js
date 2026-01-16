/**
 * State Management Module
 * Centralized application state with reactive updates
 * @module utils/state
 */

class StateManager {
    constructor() {
        this.state = {
            session: null,
            currentTab: 'overview',
            user: null,
            data: {
                stats: {},
                visits: [],
                salesmen: [],
                targets: [],
                conversations: [],
                orders: [],
                products: [],
                customers: []
            },
            filters: {
                visits: {},
                orders: {},
                conversations: {}
            },
            ui: {
                sidebarCollapsed: false,
                loading: false
            }
        };
        
        this.listeners = new Map();
    }

    /**
     * Get state value by path
     * @param {string} path - Dot notation path (e.g., 'data.visits')
     * @returns {any} - State value
     */
    get(path) {
        return path.split('.').reduce((obj, key) => obj?.[key], this.state);
    }

    /**
     * Set state value by path and notify listeners
     * @param {string} path - Dot notation path
     * @param {any} value - New value
     */
    set(path, value) {
        const keys = path.split('.');
        const lastKey = keys.pop();
        const target = keys.reduce((obj, key) => {
            if (!obj[key]) obj[key] = {};
            return obj[key];
        }, this.state);
        
        target[lastKey] = value;
        this.notify(path, value);
    }

    /**
     * Subscribe to state changes
     * @param {string} path - State path to watch
     * @param {Function} callback - Callback function
     * @returns {Function} - Unsubscribe function
     */
    subscribe(path, callback) {
        if (!this.listeners.has(path)) {
            this.listeners.set(path, new Set());
        }
        this.listeners.get(path).add(callback);
        
        return () => this.listeners.get(path).delete(callback);
    }

    /**
     * Notify listeners of state changes
     * @param {string} path - Changed path
     * @param {any} value - New value
     */
    notify(path, value) {
        this.listeners.get(path)?.forEach(callback => callback(value));
        
        // Notify wildcard listeners
        this.listeners.get('*')?.forEach(callback => callback({ path, value }));
    }

    /**
     * Update multiple state values
     * @param {Object} updates - Object with path: value pairs
     */
    batchUpdate(updates) {
        Object.entries(updates).forEach(([path, value]) => {
            this.set(path, value);
        });
    }

    /**
     * Reset state to initial values
     */
    reset() {
        this.state = {
            session: null,
            currentTab: 'overview',
            user: null,
            data: {
                stats: {},
                visits: [],
                salesmen: [],
                targets: [],
                conversations: [],
                orders: [],
                products: [],
                customers: []
            },
            filters: {
                visits: {},
                orders: {},
                conversations: {}
            },
            ui: {
                sidebarCollapsed: false,
                loading: false
            }
        };
        this.notify('*', this.state);
    }

    /**
     * Load state from localStorage
     */
    loadFromStorage(key = 'salesmate_state') {
        try {
            const stored = localStorage.getItem(key);
            if (stored) {
                const parsed = JSON.parse(stored);
                this.state = { ...this.state, ...parsed };
            }
        } catch (error) {
            console.error('Failed to load state from storage:', error);
        }
    }

    /**
     * Save state to localStorage
     */
    saveToStorage(key = 'salesmate_state') {
        try {
            // Don't save sensitive data
            const { session, ...safeState } = this.state;
            localStorage.setItem(key, JSON.stringify(safeState));
        } catch (error) {
            console.error('Failed to save state to storage:', error);
        }
    }
}

// Create singleton instance
const state = new StateManager();

export default state;
