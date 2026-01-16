/**
 * Visits Management Module
 * Handles all visit-related functionality
 * @module modules/fsm/visits
 */

import { fsmAPI } from '../../utils/api.js';
import state from '../../utils/state.js';
import { 
    escapeHtml, 
    formatDate, 
    showNotification,
    createLoadingSpinner,
    createEmptyState,
    exportToCSV
} from '../../utils/helpers.js';

class VisitsManager {
    constructor() {
        this.initialized = false;
    }

    /**
     * Initialize the visits module
     */
    async init() {
        if (this.initialized) return;
        
        await this.loadVisits();
        await this.populateFilters();
        this.setupEventListeners();
        this.initialized = true;
    }

    /**
     * Load visits from API
     */
    async loadVisits() {
        try {
            const filters = state.get('filters.visits') || {};
            const visits = await fsmAPI.getVisits(filters);
            
            state.set('data.visits', visits);
            this.updateStats(visits);
            this.renderTable(visits);
        } catch (error) {
            console.error('Error loading visits:', error);
            showNotification('Failed to load visits', 'error');
        }
    }

    /**
     * Update visit statistics
     */
    updateStats(visits) {
        const today = new Date().toISOString().split('T')[0];
        const todayVisits = visits.filter(v => 
            v.visit_date && v.visit_date.startsWith(today)
        );
        
        const uniqueSalesmen = new Set(visits.map(v => v.salesman_id)).size;
        
        const completedVisits = visits.filter(v => v.time_out && v.duration_minutes);
        const avgDuration = completedVisits.length > 0 
            ? Math.round(completedVisits.reduce((sum, v) => sum + (v.duration_minutes || 0), 0) / completedVisits.length)
            : 0;

        // Update DOM
        document.getElementById('totalVisitsCount').textContent = visits.length;
        document.getElementById('todayVisitsCount').textContent = todayVisits.length;
        document.getElementById('activeSalesmenCount').textContent = uniqueSalesmen;
        document.getElementById('avgVisitDuration').textContent = avgDuration;
    }

    /**
     * Render visits table
     */
    renderTable(visits) {
        const tbody = document.getElementById('visitsTableBody');
        
        if (!visits || visits.length === 0) {
            tbody.innerHTML = '';
            tbody.appendChild(createEmptyState('fa-map-marker-alt', 'No visits found'));
            return;
        }

        tbody.innerHTML = visits.map(visit => this.createVisitRow(visit)).join('');
    }

    /**
     * Create table row for visit
     */
    createVisitRow(visit) {
        const visitDate = formatDate(visit.visit_date);
        const status = visit.time_out 
            ? '<span class="text-green-400"><i class="fas fa-check-circle"></i> Complete</span>'
            : '<span class="text-yellow-400"><i class="fas fa-clock"></i> In Progress</span>';
        
        const potentialClass = {
            'High': 'bg-green-500/20 text-green-300',
            'Medium': 'bg-yellow-500/20 text-yellow-300',
            'Low': 'bg-gray-500/20 text-gray-300'
        }[visit.potential] || 'bg-gray-500/20 text-gray-300';

        return `
            <tr class="text-white border-b border-white/10 hover:bg-white/5">
                <td class="py-3 px-4">${visitDate}</td>
                <td class="py-3 px-4">${escapeHtml(visit.customer_name || 'N/A')}</td>
                <td class="py-3 px-4">${escapeHtml(visit.salesman_name || 'N/A')}</td>
                <td class="py-3 px-4">${escapeHtml(visit.plant_name || '-')}</td>
                <td class="py-3 px-4">
                    <span class="px-2 py-1 rounded text-xs bg-blue-500/20 text-blue-300">
                        ${escapeHtml(visit.visit_type || 'Regular')}
                    </span>
                </td>
                <td class="py-3 px-4">${visit.duration_minutes || 0} min</td>
                <td class="py-3 px-4">
                    <span class="px-2 py-1 rounded text-xs ${potentialClass}">
                        ${escapeHtml(visit.potential || 'Low')}
                    </span>
                </td>
                <td class="py-3 px-4">${status}</td>
                <td class="py-3 px-4">
                    <button onclick="window.visitsManager.viewDetails('${visit.id}')" 
                            class="text-blue-400 hover:text-blue-300" 
                            title="View Details">
                        <i class="fas fa-eye"></i>
                    </button>
                </td>
            </tr>
        `;
    }

    /**
     * Populate filter dropdowns
     */
    async populateFilters() {
        try {
            const salesmen = await fsmAPI.getSalesmen();
            const salesmanFilter = document.getElementById('visitSalesmanFilter');
            
            if (salesmanFilter) {
                salesmanFilter.innerHTML = '<option value="">All Salesmen</option>' + 
                    salesmen.map(s => 
                        `<option value="${s.id}">${escapeHtml(s.name)}</option>`
                    ).join('');
            }

            const branchFilter = document.getElementById('visitBranchFilter');
            if (branchFilter) {
                branchFilter.innerHTML = '<option value="">All Branches</option>';
            }
        } catch (error) {
            console.error('Error populating filters:', error);
        }
    }

    /**
     * Setup event listeners
     */
    setupEventListeners() {
        const filterElements = [
            'visitBranchFilter',
            'visitSalesmanFilter', 
            'visitDateFrom',
            'visitDateTo'
        ];

        filterElements.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.addEventListener('change', () => this.applyFilters());
            }
        });
    }

    /**
     * Apply filters and reload visits
     */
    applyFilters() {
        const filters = {
            branch: document.getElementById('visitBranchFilter')?.value || '',
            salesman: document.getElementById('visitSalesmanFilter')?.value || '',
            dateFrom: document.getElementById('visitDateFrom')?.value || '',
            dateTo: document.getElementById('visitDateTo')?.value || ''
        };

        state.set('filters.visits', filters);
        this.loadVisits();
    }

    /**
     * View visit details
     */
    viewDetails(visitId) {
        // TODO: Implement visit details modal
        showNotification('Visit details feature coming soon', 'info');
    }

    /**
     * Export visits to Excel
     */
    exportToExcel() {
        const visits = state.get('data.visits');
        if (!visits || visits.length === 0) {
            showNotification('No visits to export', 'warning');
            return;
        }

        const exportData = visits.map(v => ({
            'Date': formatDate(v.visit_date),
            'Customer': v.customer_name,
            'Salesman': v.salesman_name,
            'Branch': v.plant_name || '-',
            'Type': v.visit_type || 'Regular',
            'Duration (min)': v.duration_minutes || 0,
            'Potential': v.potential || 'Low',
            'Status': v.time_out ? 'Complete' : 'In Progress',
            'Products Discussed': v.products_discussed || '-',
            'Notes': v.notes || '-'
        }));

        exportToCSV(exportData, `visits_${new Date().toISOString().split('T')[0]}.csv`);
        showNotification('Visits exported successfully', 'success');
    }

    /**
     * Cleanup when leaving tab
     */
    destroy() {
        // Cleanup if needed
    }
}

// Create singleton instance
const visitsManager = new VisitsManager();

// Make available globally for onclick handlers
window.visitsManager = visitsManager;

export default visitsManager;
