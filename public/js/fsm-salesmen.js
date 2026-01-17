// FSM Salesmen Module
// Handles all salesman-related functionality

async function loadSalesmen() {
    try {
        const response = await fetch(`/api/fsm/salesmen?tenant_id=${encodeURIComponent(state.session?.tenantId || '')}`);
        const result = await response.json();
        const salesmen = result.data || [];
        
        // Update stats (if elements exist)
        const totalSalesmenEl = document.getElementById('totalSalesmenCount');
        if (totalSalesmenEl) totalSalesmenEl.textContent = salesmen.length;
        
        const today = new Date().toISOString().split('T')[0];
        // Get today's active salesmen (those with visits today)
        const visitsResp = await fetch(`/api/fsm/visits?start_date=${today}&end_date=${today}&tenant_id=${encodeURIComponent(state.session?.tenantId || '')}`);
        const visitsResult = await visitsResp.json();
        const todayVisits = visitsResult.data || [];
        const activeTodaySet = new Set(todayVisits.map(v => v.salesman_id));
        const activeTodayEl = document.getElementById('activeTodayCount');
        if (activeTodayEl) activeTodayEl.textContent = activeTodaySet.size;
        
        // Get targets to calculate "on target" count
        const targetsResp = await fetch(`/api/fsm/targets?tenant_id=${encodeURIComponent(state.session?.tenantId || '')}`);
        const targetsResult = await targetsResp.json();
        const targets = targetsResult.data || [];
        const onTarget = targets.filter(t => {
            const progress = t.target_visits > 0 ? (t.achieved_visits / t.target_visits * 100) : 0;
            return progress >= 80;
        }).length;
        const onTargetEl = document.getElementById('onTargetCount');
        if (onTargetEl) onTargetEl.textContent = onTarget;
        
        // Populate table
        const tbody = document.getElementById('salesmenTableBody');
        if (salesmen.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center py-8 text-white/60">No salesmen found</td></tr>';
            return;
        }
        
        // Get visit counts for each salesman
        const allVisitsResp = await fetch(`/api/fsm/visits?tenant_id=${encodeURIComponent(state.session?.tenantId || '')}`);
        const allVisitsResult = await allVisitsResp.json();
        const allVisits = allVisitsResult.data || [];
        
        // Get plants for branch names
        const plantsResp = await fetch(`/api/fsm/plants?tenant_id=${encodeURIComponent(state.session?.tenantId || '')}`);
        const plantsData = await plantsResp.json();
        const plants = plantsData.data || [];
        const plantMap = new Map(plants.map(p => [p.plant_id || p.id, p.plant_name || p.name]));
        
        tbody.innerHTML = salesmen.map(salesman => {
            const salesmanVisits = allVisits.filter(v => v.salesman_id === salesman.id);
            const thisMonthVisits = salesmanVisits.filter(v => {
                const vDate = new Date(v.visit_date);
                const now = new Date();
                return vDate.getMonth() === now.getMonth() && vDate.getFullYear() === now.getFullYear();
            }).length;
            
            const target = targets.find(t => t.salesman_id === salesman.id);
            const targetProgress = target && target.target_visits > 0 
                ? Math.round(target.achieved_visits / target.target_visits * 100)
                : 0;
            
            const statusBadge = salesman.is_active 
                ? '<span class="px-2 py-1 rounded text-xs bg-green-500/20 text-green-300">Active</span>'
                : '<span class="px-2 py-1 rounded text-xs bg-gray-500/20 text-gray-300">Inactive</span>';
            
            // Try multiple fields to get plant name
            let branchName = '-';
            if (salesman.plant_id) {
                branchName = plantMap.get(salesman.plant_id) || salesman.plant_id;
            } else if (salesman.plant_name) {
                branchName = salesman.plant_name;
            }
            
            return `
                <tr class="text-white border-b border-white/10 hover:bg-white/5">
                    <td class="py-3 px-4">${escapeHtml(salesman.name || 'N/A')}</td>
                    <td class="py-3 px-4">${escapeHtml(salesman.phone || '-')}</td>
                    <td class="py-3 px-4">${escapeHtml(branchName)}</td>
                    <td class="py-3 px-4">${thisMonthVisits}</td>
                    <td class="py-3 px-4">
                        <div class="w-full bg-white/10 rounded-full h-2">
                            <div class="bg-blue-500 h-2 rounded-full" style="width: ${Math.min(targetProgress, 100)}%"></div>
                        </div>
                        <span class="text-xs text-white/60">${targetProgress}%</span>
                    </td>
                    <td class="py-3 px-4">${statusBadge}</td>
                    <td class="py-3 px-4">
                        <div class="flex gap-2">
                            <button onclick="viewSalesmanDetails('${salesman.id}')" class="text-blue-400 hover:text-blue-300" title="View Details">
                                <i class="fas fa-eye"></i>
                            </button>
                            <button onclick="editSalesman('${salesman.id}')" class="text-green-400 hover:text-green-300" title="Edit">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button onclick="deleteSalesman('${salesman.id}', '${escapeHtml(salesman.name || 'this salesman')}')" class="text-red-400 hover:text-red-300" title="Delete">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
        
    } catch (error) {
        console.error('Error loading salesmen:', error);
        showNotification('Error loading salesmen', 'error');
    }
}

async function showAddSalesmanModal() {
    document.getElementById('salesmanFormId').value = '';
    document.getElementById('salesmanFormName').value = '';
    document.getElementById('salesmanFormPhone').value = '';
    document.getElementById('salesmanFormEmail').value = '';
    document.getElementById('salesmanFormStatus').value = '1';
    
    document.getElementById('salesmanFormTitle').textContent = 'Add Salesman';
    document.getElementById('salesmanFormIcon').className = 'fas fa-user-plus text-2xl';
    
    await loadPlantCheckboxes();
    document.getElementById('addEditSalesmanModal').classList.remove('hidden');
}

async function editSalesman(salesmanId) {
    try {
        const response = await fetch(`/api/fsm/salesmen?tenant_id=${encodeURIComponent(state.session?.tenantId || '')}`);
        const result = await response.json();
        const salesman = (result.data || []).find(s => s.id === salesmanId);
        
        if (!salesman) {
            showNotification('Salesman not found', 'error');
            return;
        }
        
        document.getElementById('salesmanFormId').value = salesman.id;
        document.getElementById('salesmanFormName').value = salesman.name || '';
        document.getElementById('salesmanFormPhone').value = salesman.phone || '';
        document.getElementById('salesmanFormEmail').value = salesman.email || '';
        document.getElementById('salesmanFormStatus').value = salesman.is_active ? '1' : '0';
        
        document.getElementById('salesmanFormTitle').textContent = 'Edit Salesman';
        document.getElementById('salesmanFormIcon').className = 'fas fa-user-edit text-2xl';
        
        await loadPlantCheckboxes(salesman.plant_id);
        document.getElementById('addEditSalesmanModal').classList.remove('hidden');
        
    } catch (error) {
        console.error('Error loading salesman:', error);
        showNotification('Error loading salesman data', 'error');
    }
}

async function loadPlantCheckboxes(selectedPlantId = null) {
    try {
        const response = await fetch(`/api/fsm/plants?tenant_id=${encodeURIComponent(state.session?.tenantId || '')}`);
        const result = await response.json();
        const plants = result.data || [];
        
        const container = document.getElementById('plantCheckboxes');
        
        if (plants.length === 0) {
            container.innerHTML = '<div class="text-white/60 text-sm">No branches available. Please add branches first.</div>';
            return;
        }
        
        const selectedPlants = selectedPlantId ? [selectedPlantId] : [];
        
        container.innerHTML = plants.map(plant => {
            const plantId = plant.plant_id || plant.id;
            const plantName = plant.plant_name || plant.name || 'Unnamed Branch';
            const isChecked = selectedPlants.includes(plantId);
            
            return `
                <label class="flex items-center space-x-3 p-2 hover:bg-white/5 rounded cursor-pointer">
                    <input type="checkbox" name="plantAssignment" value="${plantId}" 
                        ${isChecked ? 'checked' : ''}
                        class="w-4 h-4 text-purple-600 bg-white/10 border-white/30 rounded focus:ring-purple-500">
                    <span class="text-white text-sm flex-1">${escapeHtml(plantName)}</span>
                    ${plant.city ? `<span class="text-white/40 text-xs">${escapeHtml(plant.city)}</span>` : ''}
                </label>
            `;
        }).join('');
        
    } catch (error) {
        console.error('Error loading plants:', error);
        document.getElementById('plantCheckboxes').innerHTML = '<div class="text-red-400 text-sm">Error loading branches</div>';
    }
}

function closeSalesmanForm() {
    document.getElementById('addEditSalesmanModal').classList.add('hidden');
}

async function deleteSalesman(salesmanId, salesmanName) {
    if (!confirm(`Are you sure you want to delete ${salesmanName}?\n\nThis will permanently remove the salesman and all associated visit records.`)) {
        return;
    }
    
    try {
        const response = await fetch(`/api/fsm/salesmen/${salesmanId}`, {
            method: 'DELETE'
        });
        
        const result = await response.json();
        
        if (result.success) {
            showNotification('Salesman deleted successfully', 'success');
            loadSalesmen();
        } else {
            showNotification(result.error || 'Failed to delete salesman', 'error');
        }
    } catch (err) {
        console.error('Error deleting salesman:', err);
        showNotification('Error deleting salesman', 'error');
    }
}

async function viewSalesmanDetails(salesmanId) {
    try {
        const modal = document.getElementById('salesmanModal');
        modal.classList.remove('hidden');
        
        const salesmanResp = await fetch(`/api/fsm/salesmen?tenant_id=${encodeURIComponent(state.session?.tenantId || '')}`);
        const salesmanData = await salesmanResp.json();
        const salesman = (salesmanData.data || []).find(s => s.id === salesmanId);
        
        if (!salesman) {
            modal.classList.add('hidden');
            showNotification('Salesman not found', 'error');
            return;
        }
        
        const visitsResp = await fetch(`/api/fsm/visits?salesman_id=${salesmanId}&tenant_id=${encodeURIComponent(state.session?.tenantId || '')}`);
        const visitsData = await visitsResp.json();
        const visits = visitsData.data || [];
        
        let branchName = '-';
        if (salesman.plant_id) {
            const plantsResp = await fetch(`/api/fsm/plants?tenant_id=${encodeURIComponent(state.session?.tenantId || '')}`);
            const plantsData = await plantsResp.json();
            const plants = plantsData.data || [];
            const plant = plants.find(p => (p.plant_id || p.id) === salesman.plant_id);
            branchName = plant ? (plant.plant_name || plant.name) : salesman.plant_id;
        } else if (salesman.plant_name) {
            branchName = salesman.plant_name;
        }
        
        const today = new Date().toISOString().split('T')[0];
        const thisMonth = new Date();
        const monthVisits = visits.filter(v => {
            const vDate = new Date(v.visit_date);
            return vDate.getMonth() === thisMonth.getMonth() && vDate.getFullYear() === thisMonth.getFullYear();
        });
        const todayVisits = visits.filter(v => v.visit_date === today);
        
        document.getElementById('salesmanModalName').textContent = salesman.name || 'N/A';
        document.getElementById('salesmanModalPhone').textContent = salesman.phone || '-';
        document.getElementById('salesmanBranch').textContent = branchName;
        document.getElementById('salesmanStatus').innerHTML = salesman.is_active 
            ? '<span class="px-2 py-1 rounded text-xs bg-green-500/20 text-green-300">Active</span>'
            : '<span class="px-2 py-1 rounded text-xs bg-gray-500/20 text-gray-300">Inactive</span>';
        
        document.getElementById('salesmanTotalVisits').textContent = visits.length;
        document.getElementById('salesmanMonthVisits').textContent = monthVisits.length;
        document.getElementById('salesmanTodayVisits').textContent = todayVisits.length;
        
    } catch (error) {
        console.error('Error loading salesman details:', error);
        document.getElementById('salesmanModal').classList.add('hidden');
        showNotification('Error loading salesman details', 'error');
    }
}
