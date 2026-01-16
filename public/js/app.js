/**
 * Salesmate Dashboard Application
 * Main entry point - orchestrates all modules
 * @module app
 */

import state from './utils/state.js';
import router from './utils/router.js';
import { showNotification } from './utils/helpers.js';

// Import FSM modules
import visitsManager from './modules/fsm/visits.js';
import salesmenManager from './modules/fsm/salesmen.js';
import targetsManager from './modules/fsm/targets.js';
import branchesManager from './modules/fsm/branches.js';

class SalesmateApp {
    constructor() {
        this.initialized = false;
    }

    /**
     * Initialize the application
     */
    async init() {
        if (this.initialized) return;

        try {
            console.log('🚀 Initializing Salesmate Dashboard...');

            // Load state from storage
            state.loadFromStorage();

            // Register FSM modules with router
            router.register('visits', visitsManager);
            router.register('salesmen', salesmenManager);
            router.register('targets', targetsManager);
            router.register('branches', branchesManager);

            // Setup sidebar
            this.setupSidebar();

            // Setup global event listeners
            this.setupEventListeners();

            // Load initial tab (or from URL/storage)
            const initialTab = this.getInitialTab();
            await router.switchTab(initialTab);

            // Setup periodic state save
            this.setupStatePersistence();

            this.initialized = true;
            console.log('✅ Dashboard initialized successfully');

        } catch (error) {
            console.error('❌ Failed to initialize dashboard:', error);
            showNotification('Failed to initialize dashboard', 'error');
        }
    }

    /**
     * Get initial tab from URL or storage
     */
    getInitialTab() {
        const params = new URLSearchParams(window.location.search);
        const urlTab = params.get('tab');
        
        if (urlTab) return urlTab;
        
        const lastTab = state.get('currentTab');
        return lastTab || 'overview';
    }

    /**
     * Setup sidebar functionality
     */
    setupSidebar() {
        const SIDEBAR_STORAGE_KEY = 'salesmate_sidebar_collapsed_v1';

        // Add tooltips to sidebar items
        document.querySelectorAll('.sidebar-item').forEach((item) => {
            if (!item.getAttribute('title')) {
                const label = item.querySelector('span')?.textContent?.trim();
                if (label) item.setAttribute('title', label);
            }
        });

        // Apply persisted collapse state
        try {
            const saved = localStorage.getItem(SIDEBAR_STORAGE_KEY);
            if (window.innerWidth > 768) {
                this.setSidebarCollapsed(saved === '1');
            }
        } catch (_) {
            this.setSidebarCollapsed(false);
        }

        // Setup toggle button
        const toggleBtn = document.getElementById('sidebarToggle');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => this.toggleSidebar());
        }
    }

    /**
     * Toggle sidebar collapsed/expanded
     */
    toggleSidebar() {
        const sidebar = document.getElementById('sidebar');
        if (!sidebar) return;

        const SIDEBAR_STORAGE_KEY = 'salesmate_sidebar_collapsed_v1';

        if (window.innerWidth <= 768) {
            // Mobile: toggle visibility
            sidebar.classList.toggle('mobile-open');
        } else {
            // Desktop: toggle collapse
            const nextCollapsed = !sidebar.classList.contains('collapsed');
            this.setSidebarCollapsed(nextCollapsed);
            
            try {
                localStorage.setItem(SIDEBAR_STORAGE_KEY, nextCollapsed ? '1' : '0');
            } catch (_) {}
        }
    }

    /**
     * Set sidebar collapsed state
     */
    setSidebarCollapsed(isCollapsed) {
        const sidebar = document.getElementById('sidebar');
        const mainContent = document.getElementById('mainContent');
        const toggleBtn = document.getElementById('sidebarToggle');
        const icon = document.getElementById('sidebarToggleIcon') || toggleBtn?.querySelector('i');

        if (!sidebar || !mainContent || !toggleBtn) return;

        sidebar.classList.toggle('collapsed', isCollapsed);
        mainContent.classList.toggle('expanded', isCollapsed);
        toggleBtn.classList.toggle('collapsed', isCollapsed);

        if (icon) {
            icon.classList.remove('fa-bars', 'fa-angles-left', 'fa-angles-right');
            icon.classList.add(isCollapsed ? 'fa-angles-right' : 'fa-angles-left');
        }
    }

    /**
     * Setup global event listeners
     */
    setupEventListeners() {
        // Handle window resize
        window.addEventListener('resize', () => {
            if (window.innerWidth > 768) {
                const sidebar = document.getElementById('sidebar');
                sidebar?.classList.remove('mobile-open');
            }
        });

        // Handle beforeunload (save state)
        window.addEventListener('beforeunload', () => {
            state.saveToStorage();
        });

        // Handle clicks outside sidebar (mobile)
        document.addEventListener('click', (e) => {
            if (window.innerWidth <= 768) {
                const sidebar = document.getElementById('sidebar');
                const sidebarToggle = document.getElementById('sidebarToggle');
                
                if (sidebar && 
                    !sidebar.contains(e.target) && 
                    !sidebarToggle?.contains(e.target) &&
                    sidebar.classList.contains('mobile-open')) {
                    sidebar.classList.remove('mobile-open');
                }
            }
        });
    }

    /**
     * Setup periodic state persistence
     */
    setupStatePersistence() {
        // Save state every 30 seconds
        setInterval(() => {
            state.saveToStorage();
        }, 30000);
    }

    /**
     * Cleanup and shutdown
     */
    destroy() {
        state.saveToStorage();
        console.log('👋 Dashboard shutdown');
    }
}

// Create and initialize app
const app = new SalesmateApp();

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => app.init());
} else {
    app.init();
}

// Make available globally
window.app = app;

export default app;
