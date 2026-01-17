// FSM Targets Module
// Handles all target-related functionality with filtering, sorting, and pagination

// State management
let targetsState = {
    allTargets: [],
    filteredTargets: [],
    currentPage: 1,
    pageSize: 10,
    sortColumn: 'target_month',
    sortDirection: 'desc'
};

async function loadTargets() {
    try {
        console.log('📊 Loading targets...');
        const monthFilter = document.getElementById('targetMonthFilter');
        if (monthFilter && !monthFilter.value) {
            const now = new Date();
            monthFilter.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        }
        
        const response = await fetch(`/api/fsm/targets?tenant_id=${encodeURIComponent(state.session?.tenantId || '')}`);
        const result = await response.json();
        console.log('📊 Targets API response:', result);
        targetsState.allTargets = result.data || [];
        console.log('📊 Loaded targets count:', targetsState.allTargets.length);
        
        // Load salesman filter options
        await loadSalesmanFilter();
        
        // Apply filters
        applyTargetFilters();
        console.log('📊 Filtered targets count:', targetsState.filteredTargets.length);
        
        // Update stats
        updateTargetStats();
        
        // Render table
        renderTargetsTable();
        
    } catch (error) {
        console.error('Error loading targets:', error);
        showNotification('Error loading targets', 'error');
    }
}

async function loadSalesmanFilter() {
    try {
        const select = document.getElementById('targetSalesmanFilter');
        if (!select) return;
        
        const response = await fetch(`/api/fsm/salesmen?tenant_id=${encodeURIComponent(state.session?.tenantId || '')}`);
        const result = await response.json();
        const salesmen = result.data || [];
        
        select.innerHTML = '<option value="">All Salesmen</option>' + 
            salesmen.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
    } catch (error) {
        console.error('Error loading salesman filter:', error);
    }
}

function applyTargetFilters() {
    const salesmanFilter = document.getElementById('targetSalesmanFilter')?.value;
    const monthFilter = document.getElementById('targetMonthFilter')?.value;
    
    console.log('🔍 Applying filters - Salesman:', salesmanFilter, 'Month:', monthFilter);
    
    targetsState.filteredTargets = targetsState.allTargets.filter(target => {
        // Check salesman filter
        if (salesmanFilter && target.salesman_id !== salesmanFilter) return false;
        
        // Check month filter - handle both period and target_month fields
        if (monthFilter) {
            const targetMonth = target.target_month || target.period || '';
            if (targetMonth !== monthFilter) return false;
        }
        
        return true;
    });
    
    console.log('✅ Filtered results:', targetsState.filteredTargets.length, 'targets');
    targetsState.currentPage = 1; // Reset to first page
}

function updateTargetStats() {
    const targets = targetsState.allTargets;
    
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
}

function sortTargetsTable(column) {
    if (targetsState.sortColumn === column) {
        // Toggle direction if same column
        targetsState.sortDirection = targetsState.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        targetsState.sortColumn = column;
        targetsState.sortDirection = 'desc';
    }
    renderTargetsTable();
}

function renderTargetsTable() {
    const tbody = document.getElementById('targetsTableBody');
    if (!tbody) return;
    
    const pageSize = parseInt(document.getElementById('targetsPageSize')?.value || 10);
    targetsState.pageSize = pageSize;
    
    // Sort filtered targets
    const sorted = [...targetsState.filteredTargets].sort((a, b) => {
        let aVal = a[targetsState.sortColumn];
        let bVal = b[targetsState.sortColumn];
        
        // Handle progress column specially
        if (targetsState.sortColumn === 'progress') {
            aVal = calculateTargetProgress(a);
            bVal = calculateTargetProgress(b);
        }
        
        // Handle numeric columns
        if (typeof aVal === 'number' && typeof bVal === 'number') {
            return targetsState.sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
        }
        
        // String comparison
        aVal = String(aVal || '');
        bVal = String(bVal || '');
        return targetsState.sortDirection === 'asc' 
            ? aVal.localeCompare(bVal)
            : bVal.localeCompare(aVal);
    });
    
    // Paginate
    const startIdx = (targetsState.currentPage - 1) * pageSize;
    const endIdx = startIdx + pageSize;
    const page = sorted.slice(startIdx, endIdx);
    
    // Populate table
    if (page.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" class="text-center py-8 text-white/60">No targets found</td></tr>';
        updateTargetsPagination(sorted.length);
        return;
    }
    
    tbody.innerHTML = page.map(target => {
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
        
        // Format month to show as "Jan 2026" instead of "2026-01"
        const formattedMonth = target.target_month || target.period || 'N/A';
        let displayMonth = formattedMonth;
        if (formattedMonth.match(/^\d{4}-\d{2}$/)) {
            const [year, month] = formattedMonth.split('-');
            const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            displayMonth = `${monthNames[parseInt(month) - 1]} ${year}`;
        }
        
        return `
            <tr class="text-white border-b border-white/10 hover:bg-white/5">
                <td class="py-3 px-4">${escapeHtml(target.salesman_name || 'N/A')}</td>
                <td class="py-3 px-4">${displayMonth}</td>
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
    
    updateTargetsPagination(sorted.length);
}

function calculateTargetProgress(target) {
    const visitProgress = target.target_visits > 0 ? (target.achieved_visits / target.target_visits * 100) : 0;
    const orderProgress = target.target_orders > 0 ? (target.achieved_orders / target.target_orders * 100) : 0;
    const revenueProgress = target.target_revenue > 0 ? (target.achieved_revenue / target.target_revenue * 100) : 0;
    return Math.round((visitProgress + orderProgress + revenueProgress) / 3);
}

function updateTargetsPagination(totalCount) {
    const totalPages = Math.ceil(totalCount / targetsState.pageSize);
    const start = totalCount > 0 ? (targetsState.currentPage - 1) * targetsState.pageSize + 1 : 0;
    const end = Math.min(targetsState.currentPage * targetsState.pageSize, totalCount);
    
    const pageInfo = document.getElementById('targetsPageInfo');
    if (pageInfo) pageInfo.textContent = `Showing ${start}-${end} of ${totalCount}`;
    
    const prevBtn = document.getElementById('targetsPrevPage');
    const nextBtn = document.getElementById('targetsNextPage');
    const currentPageSpan = document.getElementById('targetsCurrentPage');
    
    if (prevBtn) prevBtn.disabled = targetsState.currentPage === 1;
    if (nextBtn) nextBtn.disabled = targetsState.currentPage >= totalPages;
    if (currentPageSpan) currentPageSpan.textContent = `Page ${targetsState.currentPage} of ${totalPages || 1}`;
}

function changeTargetsPage(direction) {
    const totalPages = Math.ceil(targetsState.filteredTargets.length / targetsState.pageSize);
    const newPage = targetsState.currentPage + direction;
    
    if (newPage >= 1 && newPage <= totalPages) {
        targetsState.currentPage = newPage;
        renderTargetsTable();
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
    
    // Change modal colors to yellow theme
    const modalHeader = document.querySelector('#addEditTargetModal .modal-header');
    if (modalHeader) {
        modalHeader.className = 'modal-header p-6 bg-gradient-to-r from-yellow-600 to-yellow-700';
    }
    
    await loadSalesmenDropdown();
    document.getElementById('addEditTargetModal').classList.remove('hidden');
}

async function editTarget(targetId) {
    try {
        const target = targetsState.allTargets.find(t => t.id === targetId);
        
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
        
        // Change modal colors to yellow theme for edit
        const modalHeader = document.querySelector('#addEditTargetModal .modal-header');
        if (modalHeader) {
            modalHeader.className = 'modal-header p-6 bg-gradient-to-r from-yellow-600 to-yellow-700';
        }
        
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
        select.innerHTML = '<option value="" class="bg-yellow-800">Select Salesman</option>' + 
            salesmen.map(s => `<option value="${s.id}" class="bg-yellow-800" ${s.id === selectedId ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('');
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

// Event listener for form submission
document.addEventListener('DOMContentLoaded', function() {
    const targetForm = document.getElementById('targetForm');
    if (targetForm) {
        targetForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const formId = document.getElementById('targetFormId').value;
            const salesmanId = document.getElementById('targetFormSalesman').value;
            const period = document.getElementById('targetFormPeriod').value;
            const targetVisits = parseInt(document.getElementById('targetFormVisits').value) || 0;
            const targetOrders = parseInt(document.getElementById('targetFormOrders').value) || 0;
            const targetRevenue = parseFloat(document.getElementById('targetFormRevenue').value) || 0;
            const targetNewCustomers = parseInt(document.getElementById('targetFormNewCustomers').value) || 0;
            
            if (!salesmanId) {
                showNotification('Please select a salesman', 'error');
                return;
            }
            
            if (!period) {
                showNotification('Please select a target month', 'error');
                return;
            }
            
            try {
                const url = formId ? `/api/fsm/targets/${formId}` : '/api/fsm/targets';
                const method = formId ? 'PUT' : 'POST';
                
                const response = await fetch(url, {
                    method: method,
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        salesman_id: salesmanId,
                        period: period,
                        target_visits: targetVisits,
                        target_orders: targetOrders,
                        target_revenue: targetRevenue,
                        target_new_customers: targetNewCustomers,
                        tenant_id: state.session?.tenantId || ''
                    })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    showNotification(formId ? 'Target updated successfully' : 'Target created successfully', 'success');
                    closeTargetForm();
                    loadTargets();
                } else {
                    showNotification(result.error || 'Failed to save target', 'error');
                }
            } catch (error) {
                console.error('Error saving target:', error);
                showNotification('Error saving target', 'error');
            }
        });
    }
});
