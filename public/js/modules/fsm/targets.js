/**
 * Targets Management Module
 * Handles monthly target tracking
 * @module modules/fsm/targets
 */

import { fsmAPI } from '../../utils/api.js';
import state from '../../utils/state.js';
import { 
    escapeHtml, 
    showNotification,
    createEmptyState,
    calculatePercentage,
    getProgressColor,
    formatCurrency
} from '../../utils/helpers.js';

class TargetsManager {
    constructor() {
        this.initialized = false;
    }

    /**
     * Initialize the targets module
     */
    async init() {
        if (this.initialized) return;
        
        this.setupMonthFilter();
        await this.loadTargets();
        this.setupEventListeners();
        this.initialized = true;
    }

    /**
     * Setup month filter with current month
     */
    setupMonthFilter() {
        const monthFilter = document.getElementById('targetMonthFilter');
        if (monthFilter && !monthFilter.value) {
            const now = new Date();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            monthFilter.value = `${now.getFullYear()}-${month}`;
        }
    }

    /**
     * Load targets from API
     */
    async loadTargets() {
        try {
            const targets = await fsmAPI.getTargets();
            state.set('data.targets', targets);
            
            this.updateStats(targets);
            this.renderTable(targets);
        } catch (error) {
            console.error('Error loading targets:', error);
            showNotification('Failed to load targets', 'error');
        }
    }

    /**
     * Update target statistics
     */
    updateStats(targets) {
        const achieved = targets.filter(t => {
            const visitProgress = calculatePercentage(t.achieved_visits, t.target_visits);
            const orderProgress = calculatePercentage(t.achieved_orders, t.target_orders);
            return visitProgress >= 100 && orderProgress >= 100;
        }).length;

        const inProgress = targets.filter(t => {
            const visitProgress = calculatePercentage(t.achieved_visits, t.target_visits);
            const orderProgress = calculatePercentage(t.achieved_orders, t.target_orders);
            return (visitProgress > 0 && visitProgress < 100) || 
                   (orderProgress > 0 && orderProgress < 100);
        }).length;

        const avgProgress = targets.length > 0 
            ? Math.round(targets.reduce((sum, t) => {
                return sum + calculatePercentage(t.achieved_visits, t.target_visits);
            }, 0) / targets.length)
            : 0;

        // Update DOM
        document.getElementById('totalTargetsCount').textContent = targets.length;
        document.getElementById('achievedTargetsCount').textContent = achieved;
        document.getElementById('inProgressTargetsCount').textContent = inProgress;
        document.getElementById('avgAchievementPercent').textContent = avgProgress + '%';
    }

    /**
     * Render targets table
     */
    renderTable(targets) {
        const tbody = document.getElementById('targetsTableBody');
        
        if (!targets || targets.length === 0) {
            tbody.innerHTML = '';
            tbody.appendChild(createEmptyState('fa-bullseye', 'No targets found'));
            return;
        }

        tbody.innerHTML = targets.map(target => this.createTargetRow(target)).join('');
    }

    /**
     * Create table row for target
     */
    createTargetRow(target) {
        const visitProgress = calculatePercentage(target.achieved_visits, target.target_visits);
        const orderProgress = calculatePercentage(target.achieved_orders, target.target_orders);
        const revenueProgress = calculatePercentage(target.achieved_revenue, target.target_revenue);
        
        const overallProgress = Math.round((visitProgress + orderProgress + revenueProgress) / 3);
        const progressColor = getProgressColor(overallProgress);

        return `
            <tr class="text-white border-b border-white/10 hover:bg-white/5">
                <td class="py-3 px-4">${escapeHtml(target.salesman_name || 'N/A')}</td>
                <td class="py-3 px-4">${escapeHtml(target.target_month || 'N/A')}</td>
                <td class="py-3 px-4">${target.target_visits || 0}</td>
                <td class="py-3 px-4">${target.achieved_visits || 0}</td>
                <td class="py-3 px-4">${target.target_orders || 0}</td>
                <td class="py-3 px-4">${target.achieved_orders || 0}</td>
                <td class="py-3 px-4">${formatCurrency(target.target_revenue || 0)}</td>
                <td class="py-3 px-4">${formatCurrency(target.achieved_revenue || 0)}</td>
                <td class="py-3 px-4">
                    <div class="w-full bg-white/10 rounded-full h-2">
                        <div class="${progressColor} h-2 rounded-full" 
                             style="width: ${Math.min(overallProgress, 100)}%"></div>
                    </div>
                    <span class="text-xs text-white/60">${overallProgress}%</span>
                </td>
            </tr>
        `;
    }

    /**
     * Setup event listeners
     */
    setupEventListeners() {
        const monthFilter = document.getElementById('targetMonthFilter');
        if (monthFilter) {
            monthFilter.addEventListener('change', () => this.loadTargets());
        }
    }

    /**
     * Show set target modal
     */
    showSetModal() {
        showNotification('Set target feature coming soon', 'info');
    }

    /**
     * Cleanup when leaving tab
     */
    destroy() {
        // Cleanup if needed
    }
}

// Create singleton instance
const targetsManager = new TargetsManager();

// Make available globally for onclick handlers
window.targetsManager = targetsManager;

export default targetsManager;
