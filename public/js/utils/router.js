/**
 * Tab Router Module
 * Handles navigation and tab switching
 * @module utils/router
 */

import state from './state.js';
import { showNotification } from './helpers.js';

class Router {
    constructor() {
        this.currentTab = null;
        this.tabModules = new Map();
        this.intervals = new Map();
    }

    /**
     * Register a tab module
     * @param {string} tabName - Tab identifier
     * @param {Object} module - Module with init() method
     */
    register(tabName, module) {
        this.tabModules.set(tabName, module);
    }

    /**
     * Switch to a tab
     * @param {string} tabName - Tab to switch to
     */
    async switchTab(tabName) {
        try {
            state.set('currentTab', tabName);
            this.currentTab = tabName;

            // Update sidebar active state
            this.updateSidebarState(tabName);

            // Close mobile sidebar
            this.closeMobileSidebar();

            // Clear any auto-refresh intervals
            this.clearIntervals(tabName);

            // Hide all tab containers
            this.hideAllTabs();

            // Load tab content
            await this.loadTab(tabName);

        } catch (error) {
            console.error(`Error switching to tab ${tabName}:`, error);
            showNotification(`Failed to load ${tabName} tab`, 'error');
        }
    }

    /**
     * Update sidebar active state
     */
    updateSidebarState(tabName) {
        document.querySelectorAll('.sidebar-item').forEach(item => {
            if (item.dataset.tab === tabName) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });
    }

    /**
     * Close mobile sidebar
     */
    closeMobileSidebar() {
        if (window.innerWidth <= 768) {
            const sidebar = document.getElementById('sidebar');
            sidebar?.classList.remove('mobile-open');
        }
    }

    /**
     * Clear auto-refresh intervals
     */
    clearIntervals(exceptTab) {
        this.intervals.forEach((interval, key) => {
            if (key !== exceptTab) {
                clearInterval(interval);
                this.intervals.delete(key);
            }
        });
    }

    /**
     * Hide all tab containers
     */
    hideAllTabs() {
        // Main content container
        const mainContent = document.getElementById('tabContent');
        if (mainContent) mainContent.classList.add('hidden');

        // Individual tab containers
        const tabContainers = [
            'customersTab',
            'websiteTab',
            'visitsTab',
            'salesmenTab',
            'targetsTab',
            'branchesTab'
        ];

        tabContainers.forEach(id => {
            const element = document.getElementById(id);
            if (element) element.classList.add('hidden');
        });

        // Stats section (show only on overview)
        const statsSection = document.getElementById('statsSection');
        if (statsSection) {
            statsSection.classList.toggle('hidden', this.currentTab !== 'overview');
        }
    }

    /**
     * Load tab content
     */
    async loadTab(tabName) {
        const module = this.tabModules.get(tabName);

        if (module) {
            // Custom tab with dedicated container
            await this.loadCustomTab(tabName, module);
        } else {
            // Legacy tab (loaded into main tabContent)
            await this.loadLegacyTab(tabName);
        }
    }

    /**
     * Load custom modular tab
     */
    async loadCustomTab(tabName, module) {
        const tabElement = document.getElementById(`${tabName}Tab`);
        
        if (tabElement) {
            tabElement.classList.remove('hidden');
            
            if (typeof module.init === 'function') {
                await module.init();
            }
        } else {
            console.warn(`Tab element not found: ${tabName}Tab`);
        }
    }

    /**
     * Load legacy tab (existing dashboard functionality)
     */
    async loadLegacyTab(tabName) {
        const content = document.getElementById('tabContent');
        if (!content) return;

        content.classList.remove('hidden');
        content.innerHTML = '<div class="flex justify-center py-20"><div class="loading-spinner"></div></div>';

        // Call legacy load functions (will be migrated later)
        const legacyLoaders = {
            'overview': () => window.loadOverview?.(),
            'conversations': () => window.loadConversations?.(),
            'orders': () => window.loadOrders?.(),
            'products': () => window.loadProducts?.(),
            'settings': () => window.loadSettings?.(),
            'analytics': () => window.loadAnalytics?.(),
            'reports': () => window.loadReports?.(),
            'activity-feed': () => window.loadActivityFeed?.(),
            'audit-logs': () => window.loadAuditLogs?.(),
            'broadcast': () => window.loadBroadcast?.(),
            'templates': () => window.loadMessageTemplates?.(),
            'unsubscribed': () => window.loadUnsubscribed?.(),
            'whatsapp-web': () => window.loadWhatsAppWeb?.(),
            'followups': () => window.loadFollowUps?.(),
            'leads': () => window.loadLeads?.(),
            'email': () => window.loadEmailTab?.(),
            'interactive': () => window.loadInteractiveTab?.(),
            'triage': () => window.loadTriage?.(),
            'documents': () => window.loadDocuments?.(),
            'customers': () => this.loadCustomersTab(),
            'website': () => this.loadWebsiteTab()
        };

        const loader = legacyLoaders[tabName];
        if (loader) {
            try {
                await loader();
            } catch (error) {
                console.error(`Error loading ${tabName}:`, error);
                content.innerHTML = this.createErrorView(tabName, error);
            }
        } else {
            content.innerHTML = '<div class="p-8 text-white">Unknown tab</div>';
        }
    }

    /**
     * Load customers tab (special case - uses separate container)
     */
    async loadCustomersTab() {
        const content = document.getElementById('tabContent');
        const customersTab = document.getElementById('customersTab');
        
        if (customersTab) {
            content.classList.add('hidden');
            customersTab.classList.remove('hidden');
            await window.loadCustomers?.();
        } else {
            content.innerHTML = '<div class="p-8 text-red-500">Customers tab element not found.</div>';
        }
    }

    /**
     * Load website tab (special case - uses separate container)
     */
    async loadWebsiteTab() {
        const content = document.getElementById('tabContent');
        const websiteTab = document.getElementById('websiteTab');
        
        if (websiteTab) {
            content.classList.add('hidden');
            websiteTab.classList.remove('hidden');
            await window.loadWebsiteContent?.();
        } else {
            content.innerHTML = '<div class="p-8 text-red-500">Website tab element not found.</div>';
        }
    }

    /**
     * Create error view
     */
    createErrorView(tabName, error) {
        return `
            <div class="glass-effect p-8 rounded-2xl text-center max-w-md mx-auto mt-12">
                <i class="fas fa-exclamation-triangle text-red-400 text-5xl mb-4"></i>
                <h3 class="text-white text-xl font-semibold mb-2">Error Loading ${tabName}</h3>
                <p class="text-white/70 mb-4">${error.message || String(error)}</p>
                <button onclick="router.switchTab('${tabName}')" 
                        class="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl">
                    Try Again
                </button>
            </div>
        `;
    }

    /**
     * Set auto-refresh interval for a tab
     */
    setInterval(tabName, callback, delay) {
        this.clearInterval(tabName);
        const interval = setInterval(callback, delay);
        this.intervals.set(tabName, interval);
    }

    /**
     * Clear interval for a tab
     */
    clearInterval(tabName) {
        const interval = this.intervals.get(tabName);
        if (interval) {
            clearInterval(interval);
            this.intervals.delete(tabName);
        }
    }
}

// Create singleton instance
const router = new Router();

// Make available globally
window.router = router;
window.switchTab = (tabName) => router.switchTab(tabName);

export default router;
