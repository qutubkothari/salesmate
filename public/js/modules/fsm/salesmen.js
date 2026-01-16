/**
 * Salesmen Management Module
 * Handles sales team management
 * @module modules/fsm/salesmen
 */

import { fsmAPI } from '../../utils/api.js';
import state from '../../utils/state.js';
import { 
    escapeHtml, 
    showNotification,
    createEmptyState,
    calculatePercentage
} from '../../utils/helpers.js';

class SalesmenManager {
    constructor() {
        this.initialized = false;
    }

    /**
     * Initialize the salesmen module
     */
    async init() {
        if (this.initialized) return;
        
        await this.loadSalesmen();
        this.initialized = true;
    }

    /**
     * Load salesmen from API
     */
    async loadSalesmen() {
        try {
            const salesmen = await fsmAPI.getSalesmen();
            state.set('data.salesmen', salesmen);
            
            await this.updateStats(salesmen);
            await this.renderTable(salesmen);
        } catch (error) {
            console.error('Error loading salesmen:', error);
            showNotification('Failed to load salesmen', 'error');
        }
    }

    /**
     * Update salesmen statistics
     */
    async updateStats(salesmen) {
        try {
            const today = new Date().toISOString().split('T')[0];
            
            // Get today's visits to find active salesmen
            const todayVisits = await fsmAPI.getVisits({ 
                dateFrom: today, 
                dateTo: today 
            });
            const activeTodaySet = new Set(todayVisits.map(v => v.salesman_id));
            
            // Get targets to calculate on-target count
            const targets = await fsmAPI.getTargets();
            const onTarget = targets.filter(t => {
                const progress = calculatePercentage(t.achieved_visits, t.target_visits);
                return progress >= 80;
            }).length;

            // Update DOM
            document.getElementById('totalSalesmenCount').textContent = salesmen.length;
            document.getElementById('activeTodayCount').textContent = activeTodaySet.size;
            document.getElementById('onTargetCount').textContent = onTarget;
        } catch (error) {
            console.error('Error updating stats:', error);
        }
    }

    /**
     * Render salesmen table
     */
    async renderTable(salesmen) {
        const tbody = document.getElementById('salesmenTableBody');
        
        if (!salesmen || salesmen.length === 0) {
            tbody.innerHTML = '';
            tbody.appendChild(createEmptyState('fa-user-tie', 'No salesmen found'));
            return;
        }

        try {
            const [allVisits, targets] = await Promise.all([
                fsmAPI.getVisits(),
                fsmAPI.getTargets()
            ]);

            tbody.innerHTML = salesmen.map(salesman => 
                this.createSalesmanRow(salesman, allVisits, targets)
            ).join('');
        } catch (error) {
            console.error('Error rendering table:', error);
            showNotification('Error displaying salesmen', 'error');
        }
    }

    /**
     * Create table row for salesman
     */
    createSalesmanRow(salesman, allVisits, targets) {
        // Calculate this month's visits
        const salesmanVisits = allVisits.filter(v => v.salesman_id === salesman.id);
        const now = new Date();
        const thisMonthVisits = salesmanVisits.filter(v => {
            const vDate = new Date(v.visit_date);
            return vDate.getMonth() === now.getMonth() && 
                   vDate.getFullYear() === now.getFullYear();
        }).length;

        // Get target progress
        const target = targets.find(t => t.salesman_id === salesman.id);
        const targetProgress = target && target.target_visits > 0 
            ? calculatePercentage(target.achieved_visits, target.target_visits)
            : 0;

        const statusBadge = salesman.status === 'active' 
            ? '<span class="px-2 py-1 rounded text-xs bg-green-500/20 text-green-300">Active</span>'
            : '<span class="px-2 py-1 rounded text-xs bg-gray-500/20 text-gray-300">Inactive</span>';

        return `
            <tr class="text-white border-b border-white/10 hover:bg-white/5">
                <td class="py-3 px-4">${escapeHtml(salesman.name || 'N/A')}</td>
                <td class="py-3 px-4">${escapeHtml(salesman.phone || '-')}</td>
                <td class="py-3 px-4">${escapeHtml(salesman.territory || '-')}</td>
                <td class="py-3 px-4">${thisMonthVisits}</td>
                <td class="py-3 px-4">
                    <div class="w-full bg-white/10 rounded-full h-2">
                        <div class="bg-blue-500 h-2 rounded-full" 
                             style="width: ${Math.min(targetProgress, 100)}%"></div>
                    </div>
                    <span class="text-xs text-white/60">${targetProgress}%</span>
                </td>
                <td class="py-3 px-4">${statusBadge}</td>
                <td class="py-3 px-4">
                    <button onclick="window.salesmenManager.viewDetails('${salesman.id}')" 
                            class="text-blue-400 hover:text-blue-300" 
                            title="View Details">
                        <i class="fas fa-eye"></i>
                    </button>
                </td>
            </tr>
        `;
    }

    /**
     * Show add salesman modal
     */
    showAddModal() {
        showNotification('Add salesman feature coming soon', 'info');
    }

    /**
     * View salesman details
     */
    viewDetails(salesmanId) {
        showNotification('Salesman details feature coming soon', 'info');
    }

    /**
     * Cleanup when leaving tab
     */
    destroy() {
        // Cleanup if needed
    }
}

// Create singleton instance
const salesmenManager = new SalesmenManager();

// Make available globally for onclick handlers
window.salesmenManager = salesmenManager;

export default salesmenManager;
