/**
 * Branches Management Module
 * Handles multi-branch/plant management
 * @module modules/fsm/branches
 */

import { fsmAPI } from '../../utils/api.js';
import state from '../../utils/state.js';
import { showNotification } from '../../utils/helpers.js';

class BranchesManager {
    constructor() {
        this.initialized = false;
    }

    /**
     * Initialize the branches module
     */
    async init() {
        if (this.initialized) return;
        
        this.renderPlaceholder();
        this.initialized = true;
    }

    /**
     * Render placeholder UI (feature coming soon)
     */
    renderPlaceholder() {
        const tbody = document.getElementById('branchesTableBody');
        if (tbody) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" class="text-center py-12 text-white/60">
                        <i class="fas fa-building text-5xl mb-4 block"></i>
                        <p class="text-lg mb-2">Multi-Branch Feature</p>
                        <p class="text-sm">Branch management will be available in the next update</p>
                        <button onclick="window.branchesManager.showAddModal()" 
                                class="mt-4 px-4 py-2 bg-blue-500 hover:bg-blue-600 rounded-lg text-white">
                            <i class="fas fa-plus mr-2"></i>Request Feature
                        </button>
                    </td>
                </tr>
            `;
        }
    }

    /**
     * Show add branch modal
     */
    showAddModal() {
        showNotification('Branch management feature coming in next update', 'info');
    }

    /**
     * Cleanup when leaving tab
     */
    destroy() {
        // Cleanup if needed
    }
}

// Create singleton instance
const branchesManager = new BranchesManager();

// Make available globally for onclick handlers
window.branchesManager = branchesManager;

export default branchesManager;
