// FSM Branches Module
// Handles all branch/plant-related functionality

async function loadBranches() {
    try {
        const response = await fetch(`/api/fsm/plants?tenant_id=${encodeURIComponent(state.session?.tenantId || '')}`);
        const result = await response.json();
        const branches = result.data || [];
        
        const tbody = document.getElementById('branchesTableBody');
        
        if (branches.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center py-8 text-white/60">No branches found. Add your first branch!</td></tr>';
            return;
        }
        
        // Get salesman count for each branch
        const salesmenResp = await fetch(`/api/fsm/salesmen?tenant_id=${encodeURIComponent(state.session?.tenantId || '')}`);
        const salesmenResult = await salesmenResp.json();
        const salesmen = salesmenResult.data || [];
        
        tbody.innerHTML = branches.map(branch => {
            const branchId = branch.plant_id || branch.id;
            const branchSalesmen = salesmen.filter(s => s.plant_id === branchId);
            
            return `
                <tr class="text-white border-b border-white/10 hover:bg-white/5">
                    <td class="py-3 px-4">${escapeHtml(branch.plant_name || branch.name || 'N/A')}</td>
                    <td class="py-3 px-4">${escapeHtml(branch.location || '-')}</td>
                    <td class="py-3 px-4">${escapeHtml([branch.city, branch.state].filter(Boolean).join(', ') || '-')}</td>
                    <td class="py-3 px-4">
                        <span class="px-2 py-1 rounded text-xs bg-blue-500/20 text-blue-300">
                            ${branchSalesmen.length} ${branchSalesmen.length === 1 ? 'Salesman' : 'Salesmen'}
                        </span>
                    </td>
                    <td class="py-3 px-4">
                        <span class="px-2 py-1 rounded text-xs bg-green-500/20 text-green-300">Active</span>
                    </td>
                    <td class="py-3 px-4">
                        <div class="flex gap-2">
                            <button onclick="editBranch('${branchId}')" class="text-yellow-400 hover:text-yellow-300" title="Edit">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button onclick="deleteBranch('${branchId}', '${escapeHtml(branch.plant_name || branch.name || 'this branch')}')" class="text-red-400 hover:text-red-300" title="Delete">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
        
    } catch (error) {
        console.error('Error loading branches:', error);
        showNotification('Error loading branches', 'error');
    }
}

async function showAddBranchModal() {
    document.getElementById('branchFormId').value = '';
    document.getElementById('branchFormName').value = '';
    document.getElementById('branchFormLocation').value = '';
    document.getElementById('branchFormCity').value = '';
    document.getElementById('branchFormState').value = '';
    document.getElementById('branchFormCountry').value = 'India';
    
    document.getElementById('branchFormTitle').textContent = 'Add Branch';
    document.getElementById('branchFormIcon').className = 'fas fa-building text-2xl';
    
    document.getElementById('addEditBranchModal').classList.remove('hidden');
}

async function editBranch(branchId) {
    try {
        const response = await fetch(`/api/fsm/plants?tenant_id=${encodeURIComponent(state.session?.tenantId || '')}`);
        const result = await response.json();
        const branch = (result.data || []).find(b => (b.plant_id || b.id) === branchId);
        
        if (!branch) {
            showNotification('Branch not found', 'error');
            return;
        }
        
        document.getElementById('branchFormId').value = branch.plant_id || branch.id;
        document.getElementById('branchFormName').value = branch.plant_name || branch.name || '';
        document.getElementById('branchFormLocation').value = branch.location || '';
        document.getElementById('branchFormCity').value = branch.city || '';
        document.getElementById('branchFormState').value = branch.state || '';
        document.getElementById('branchFormCountry').value = branch.country || 'India';
        
        document.getElementById('branchFormTitle').textContent = 'Edit Branch';
        document.getElementById('branchFormIcon').className = 'fas fa-edit text-2xl';
        
        document.getElementById('addEditBranchModal').classList.remove('hidden');
        
    } catch (error) {
        console.error('Error loading branch:', error);
        showNotification('Error loading branch data', 'error');
    }
}

function closeBranchForm() {
    document.getElementById('addEditBranchModal').classList.add('hidden');
}

async function deleteBranch(branchId, branchName) {
    if (!confirm(`Are you sure you want to delete ${branchName}?\n\nThis will affect salesmen assigned to this branch.`)) {
        return;
    }
    
    try {
        const response = await fetch(`/api/fsm/plants/${branchId}`, {
            method: 'DELETE'
        });
        
        const result = await response.json();
        
        if (result.success) {
            showNotification('Branch deleted successfully', 'success');
            loadBranches();
        } else {
            showNotification(result.error || 'Failed to delete branch', 'error');
        }
    } catch (error) {
        console.error('Error deleting branch:', error);
        showNotification('Error deleting branch', 'error');
    }
}
