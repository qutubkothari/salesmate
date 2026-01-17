// FSM Targets Module
// Handles all target-related functionality

async function loadTargets() {
    try {
        const monthFilter = document.getElementById('targetMonthFilter');
        if (monthFilter && !monthFilter.value) {
            const now = new Date();
            monthFilter.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        }
        
        const response = await fetch(`/api/fsm/targets?tenant_id=${encodeURIComponent(state.session?.tenantId || '')}`);
        const result = await response.json();
        const targets = result.data || [];
        
        // Update stats (with null checks)
        const totalTargetsEl = document.getElementById('totalTargetsCount');
        if (totalTargetsEl) totalTargetsEl.textContent = targets.length;
        
        const achieved = targets.filter(t => {
            const visitProgress = t.target_visits > 0 ? (t.achieved_visits / t.target_visits * 100) : 0;
            const orderProgress = t.target_orders > 0 ? (t.achieved_orders / t.target_orders * 100) : 0;
            return visitProgress >= 100 && orderProgress >= 100;
        }).length;
        const achievedEl = document.getElementById('achievedTargetsCount');
        if (achievedEl) achievedEl.textContent = achieved;
        
        const inProgress = targets.filter(t => {
            const visitProgress = t.target_visits > 0 ? (t.achieved_visits / t.target_visits * 100) : 0;
            const orderProgress = t.target_orders > 0 ? (t.achieved_orders / t.target_orders * 100) : 0;
            return (visitProgress > 0 && visitProgress < 100) || (orderProgress > 0 && orderProgress < 100);
        }).length;
        const inProgressEl = document.getElementById('inProgressTargetsCount');
        if (inProgressEl) inProgressEl.textContent = inProgress;
        
        const avgProgress = targets.length > 0 
            ? Math.round(targets.reduce((sum, t) => {
                const visitProgress = t.target_visits > 0 ? (t.achieved_visits / t.target_visits * 100) : 0;
                return sum + visitProgress;
            }, 0) / targets.length)
            : 0;
        const avgProgressEl = document.getElementById('avgAchievementPercent');
        if (avgProgressEl) avgProgressEl.textContent = avgProgress + '%';
        
        // Populate table
        const tbody = document.getElementById('targetsTableBody');
        if (targets.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" class="text-center py-8 text-white/60">No targets found</td></tr>';
            return;
        }
        
        tbody.innerHTML = targets.map(target => {
            const visitProgress = target.target_visits > 0 
                ? Math.round(target.achieved_visits / target.target_visits * 100)
                : 0;
            const orderProgress = target.target_orders > 0 
                ? Math.round(target.achieved_orders / target.target_orders * 100)
                : 0;
            const revenueProgress = target.target_revenue > 0 
                ? Math.round(target.achieved_revenue / target.target_revenue * 100)
                : 0;
            
            const overallProgress = Math.round((visitProgress + orderProgress + revenueProgress) / 3);
            const progressColor = overallProgress >= 100 ? 'bg-green-500' : 
                overallProgress >= 80 ? 'bg-blue-500' : 
                overallProgress >= 50 ? 'bg-yellow-500' : 'bg-red-500';
            
            return `
                <tr class="text-white border-b border-white/10 hover:bg-white/5">
                    <td class="py-3 px-4">${escapeHtml(target.salesman_name || 'N/A')}</td>
                    <td class="py-3 px-4">${target.target_month || 'N/A'}</td>
                    <td class="py-3 px-4">${target.target_visits || 0}</td>
                    <td class="py-3 px-4">${target.achieved_visits || 0}</td>
                    <td class="py-3 px-4">${target.target_orders || 0}</td>
                    <td class="py-3 px-4">${target.achieved_orders || 0}</td>
                    <td class="py-3 px-4">₹${target.target_revenue || 0}</td>
                    <td class="py-3 px-4">₹${target.achieved_revenue || 0}</td>
                    <td class="py-3 px-4">
                        <div class="w-full bg-white/10 rounded-full h-2">
                            <div class="${progressColor} h-2 rounded-full" style="width: ${Math.min(overallProgress, 100)}%"></div>
                        </div>
                        <span class="text-xs text-white/60">${overallProgress}%</span>
                    </td>
                    <td class="py-3 px-4">
                        <div class="flex gap-2">
                            <button onclick="editTarget('${target.id}')" class="text-yellow-400 hover:text-yellow-300" title="Edit">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button onclick="deleteTarget('${target.id}', '${escapeHtml(target.salesman_name || 'this target')}')" class="text-red-400 hover:text-red-300" title="Delete">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
        
    } catch (error) {
        console.error('Error loading targets:', error);
        showNotification('Error loading targets', 'error');
    }
}

async function showAddTargetModal() {
    document.getElementById('targetFormId').value = '';
    document.getElementById('targetFormPeriod').value = '';
    document.getElementById('targetFormVisits').value = '';
    document.getElementById('targetFormOrders').value = '';
    document.getElementById('targetFormRevenue').value = '';
    document.getElementById('targetFormNewCustomers').value = '';
    
    document.getElementById('targetFormTitle').textContent = 'Add Sales Target';
    document.getElementById('targetFormIcon').className = 'fas fa-bullseye text-2xl';
    
    await loadSalesmenDropdown();
    document.getElementById('addEditTargetModal').classList.remove('hidden');
}

async function editTarget(targetId) {
    try {
        const response = await fetch(`/api/fsm/targets?tenant_id=${encodeURIComponent(state.session?.tenantId || '')}`);
        const result = await response.json();
        const target = (result.data || []).find(t => t.id === targetId);
        
        if (!target) {
            showNotification('Target not found', 'error');
            return;
        }
        
        document.getElementById('targetFormId').value = target.id;
        document.getElementById('targetFormPeriod').value = target.period || '';
        document.getElementById('targetFormVisits').value = target.target_visits || 0;
        document.getElementById('targetFormOrders').value = target.target_orders || 0;
        document.getElementById('targetFormRevenue').value = target.target_revenue || 0;
        document.getElementById('targetFormNewCustomers').value = target.target_new_customers || 0;
        
        document.getElementById('targetFormTitle').textContent = 'Edit Sales Target';
        document.getElementById('targetFormIcon').className = 'fas fa-edit text-2xl';
        
        await loadSalesmenDropdown(target.salesman_id);
        document.getElementById('addEditTargetModal').classList.remove('hidden');
        
    } catch (error) {
        console.error('Error loading target:', error);
        showNotification('Error loading target data', 'error');
    }
}

async function loadSalesmenDropdown(selectedId = null) {
    try {
        const response = await fetch(`/api/fsm/salesmen?tenant_id=${encodeURIComponent(state.session?.tenantId || '')}&is_active=true`);
        const result = await response.json();
        const salesmen = result.data || [];
        
        const select = document.getElementById('targetFormSalesman');
        select.innerHTML = '<option value="" class="bg-blue-800">Select Salesman</option>' + 
            salesmen.map(s => `<option value="${s.id}" class="bg-blue-800" ${s.id === selectedId ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('');
    } catch (error) {
        console.error('Error loading salesmen:', error);
    }
}

function closeTargetForm() {
    document.getElementById('addEditTargetModal').classList.add('hidden');
}

async function deleteTarget(targetId, targetName) {
    if (!confirm(`Are you sure you want to delete target for ${targetName}?`)) {
        return;
    }
    
    try {
        const response = await fetch(`/api/fsm/targets/${targetId}`, {
            method: 'DELETE'
        });
        
        const result = await response.json();
        
        if (result.success) {
            showNotification('Target deleted successfully', 'success');
            loadTargets();
        } else {
            showNotification(result.error || 'Failed to delete target', 'error');
        }
    } catch (error) {
        console.error('Error deleting target:', error);
        showNotification('Error deleting target', 'error');
    }
}
