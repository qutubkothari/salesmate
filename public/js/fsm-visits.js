// FSM Visits Module
// Handles all visit-related functionality

async function loadVisits() {
    try {
        // Load FSM user profile if not already loaded
        if (!state.fsmUser) {
            const profileResp = await fetch(`/api/fsm/user/profile?phone=${state.session?.phoneNumber || ''}`);
            const profileData = await profileResp.json();
            if (profileData.success) {
                state.fsmUser = profileData.data;
                console.log('[FSM] User profile loaded:', state.fsmUser);
                
                // Update role indicator
                const roleIndicator = document.getElementById('fsmRoleIndicator');
                if (roleIndicator) {
                    const roleText = state.fsmUser.role === 'super_admin' ? 'Super Admin - All Plants Access' :
                                    state.fsmUser.role === 'plant_admin' ? `Plant Admin - ${state.fsmUser.plant_id}` :
                                    state.fsmUser.role === 'salesman' ? `Salesman - Personal Visits Only` : 'User';
                    roleIndicator.textContent = `Access Level: ${roleText}`;
                }
            }
        }
        
        const filters = {
            branch: document.getElementById('visitBranchFilter')?.value || '',
            salesman: document.getElementById('visitSalesmanFilter')?.value || '',
            dateFrom: document.getElementById('visitDateFrom')?.value || '',
            dateTo: document.getElementById('visitDateTo')?.value || ''
        };
        
        const params = new URLSearchParams();
        
        // Add role-based parameters
        if (state.fsmUser) {
            params.append('role', state.fsmUser.role);
            if (state.fsmUser.salesman_id) params.append('salesman_id', state.fsmUser.salesman_id);
            if (state.fsmUser.plant_id) params.append('user_plant_id', state.fsmUser.plant_id);
        }
        
        if (filters.branch) params.append('plant_id', filters.branch);
        if (filters.salesman && state.fsmUser?.role !== 'salesman') params.append('salesman_id', filters.salesman);
        if (filters.dateFrom) params.append('start_date', filters.dateFrom);
        if (filters.dateTo) params.append('end_date', filters.dateTo);
        
        if (state.session?.tenantId) params.append('tenant_id', state.session.tenantId);

        const response = await fetch(`/api/fsm/visits?${params}`);
        const result = await response.json();
        const visits = result.data || [];

        // Cache visits for client-side rendering
        state.fsmVisits.all = visits;
        if (state.fsmVisits.page < 1) state.fsmVisits.page = 1;
        
        // Update stats
        document.getElementById('totalVisitsCount').textContent = visits.length;
        
        const today = new Date().toISOString().split('T')[0];
        const todayVisits = visits.filter(v => v.visit_date && v.visit_date.startsWith(today));
        document.getElementById('todayVisitsCount').textContent = todayVisits.length;
        
        const uniqueSalesmen = new Set(visits.map(v => v.salesman_id)).size;
        document.getElementById('activeSalesmenCount').textContent = uniqueSalesmen;
        
        const completedVisits = visits.filter(v => v.time_out && v.duration_minutes);
        const avgDuration = completedVisits.length > 0 
            ? Math.round(completedVisits.reduce((sum, v) => sum + (v.duration_minutes || 0), 0) / completedVisits.length)
            : 0;
        document.getElementById('avgVisitDuration').textContent = avgDuration;
        
        // Populate filters
        await populateVisitFilters();

        // Render table with sorting/pagination
        renderVisitsTable();
        
    } catch (error) {
        console.error('Error loading visits:', error);
        showNotification('Error loading visits', 'error');
    }
}

async function populateVisitFilters() {
    try {
        // Load salesmen for filter
        const salesmenResp = await fetch(`/api/fsm/salesmen?tenant_id=${encodeURIComponent(state.session?.tenantId || '')}`);
        const salesmenData = await salesmenResp.json();
        const salesmen = salesmenData.data || [];
        const salesmanFilter = document.getElementById('visitSalesmanFilter');
        if (salesmanFilter) {
            salesmanFilter.innerHTML = '<option value="">All Salesmen</option>' + 
                salesmen.map(s => `<option value="${s.id}">${escapeHtml(s.name || s.phone || 'Salesman')}</option>`).join('');

            if (state.fsmUser?.role === 'salesman' && state.fsmUser.salesman_id) {
                salesmanFilter.value = state.fsmUser.salesman_id;
                salesmanFilter.disabled = true;
            } else {
                salesmanFilter.disabled = false;
            }
        }
        
        // Load plants/branches for filter
        const plantsResp = await fetch(`/api/fsm/plants?tenant_id=${encodeURIComponent(state.session?.tenantId || '')}`);
        const plantsData = await plantsResp.json();
        let plants = plantsData.data || [];

        // Fallback: derive plants from salesmen or visits if endpoint returns empty
        if (!plants.length && salesmen.length) {
            const plantMap = new Map();
            salesmen.forEach(s => {
                if (!s.plant_id) return;
                plantMap.set(s.plant_id, (plantMap.get(s.plant_id) || 0) + 1);
            });
            plants = Array.from(plantMap.entries()).map(([plant_id, salesman_count]) => ({ plant_id, salesman_count }));
        }
        if (!plants.length && state.fsmVisits.all.length) {
            const plantMap = new Map();
            state.fsmVisits.all.forEach(v => {
                if (!v.plant_id && !v.plant_name) return;
                const key = v.plant_id || v.plant_name;
                plantMap.set(key, (plantMap.get(key) || 0) + 1);
            });
            plants = Array.from(plantMap.entries()).map(([plant_id, salesman_count]) => ({ plant_id, salesman_count }));
        }

        const branchFilter = document.getElementById('visitBranchFilter');
        if (branchFilter) {
            state.fsmPlantsMap = {};
            plants.forEach(p => {
                if (p.plant_id) state.fsmPlantsMap[p.plant_id] = p.plant_name || p.name || p.plant_id;
            });
            branchFilter.innerHTML = '<option value="">All Plants/Branches</option>' + 
                plants.map(p => `<option value="${p.plant_id}">${escapeHtml(formatPlantLabel(p.plant_id))} (${p.salesman_count} salesmen)</option>`).join('');
        }
    } catch (error) {
        console.error('Error populating filters:', error);
    }
}

function renderVisitsTable() {
    const tbody = document.getElementById('visitsTableBody');
    if (!tbody) return;

    const { all, page, pageSize, sortKey, sortDir } = state.fsmVisits;
    if (!all.length) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center py-8 text-white/60">No visits found</td></tr>';
        updateVisitsPageInfo(0);
        return;
    }

    const sorted = [...all].sort((a, b) => {
        const aVal = (a[sortKey] ?? '').toString().toLowerCase();
        const bVal = (b[sortKey] ?? '').toString().toLowerCase();
        if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
        return 0;
    });

    const start = (page - 1) * pageSize;
    const paged = sorted.slice(start, start + pageSize);

    tbody.innerHTML = paged.map(visit => {
        const visitDate = visit.visit_date ? new Date(visit.visit_date).toLocaleDateString() : 'N/A';
        const status = visit.time_out 
            ? '<span class="text-green-400"><i class="fas fa-check-circle"></i> Complete</span>'
            : '<span class="text-yellow-400"><i class="fas fa-clock"></i> In Progress</span>';
        
        const potentialClass = visit.potential === 'High' ? 'bg-green-500/20 text-green-300' :
            visit.potential === 'Medium' ? 'bg-yellow-500/20 text-yellow-300' :
            'bg-gray-500/20 text-gray-300';
        
        return `
            <tr class="text-white border-b border-white/10 hover:bg-white/5">
                <td class="py-3 px-4" data-col="date">${visitDate}</td>
                <td class="py-3 px-4" data-col="customer">${escapeHtml(visit.customer_name || 'N/A')}</td>
                <td class="py-3 px-4" data-col="salesman">${escapeHtml(visit.salesman_name || 'N/A')}</td>
                <td class="py-3 px-4" data-col="branch">${escapeHtml(formatPlantLabel(visit.plant_name || visit.plant_id))}</td>
                <td class="py-3 px-4" data-col="type">
                    <span class="px-2 py-1 rounded text-xs bg-blue-500/20 text-blue-300">${visit.visit_type || 'Regular'}</span>
                </td>
                <td class="py-3 px-4" data-col="duration">${visit.duration_minutes || 0} min</td>
                <td class="py-3 px-4" data-col="potential">
                    <span class="px-2 py-1 rounded text-xs ${potentialClass}">${visit.potential || 'Low'}</span>
                </td>
                <td class="py-3 px-4" data-col="status">${status}</td>
                <td class="py-3 px-4" data-col="actions">
                    <button onclick="viewVisitDetails('${visit.id}')" class="text-blue-400 hover:text-blue-300" title="View Details">
                        <i class="fas fa-eye"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');

    updateVisitsPageInfo(all.length);
    applyVisitsColumnVisibility();
}

function updateVisitsPageInfo(total) {
    const info = document.getElementById('visitsPageInfo');
    if (!info) return;
    const { page, pageSize } = state.fsmVisits;
    const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
    const end = Math.min(page * pageSize, total);
    info.textContent = `${start}-${end} of ${total}`;
}

function applyVisitsColumnVisibility() {
    const columns = state.fsmVisits.columns;
    document.querySelectorAll('#visitsTable thead [data-col]').forEach(th => {
        const key = th.getAttribute('data-col');
        th.style.display = columns[key] ? '' : 'none';
    });
    document.querySelectorAll('#visitsTable tbody [data-col]').forEach(td => {
        const key = td.getAttribute('data-col');
        td.style.display = columns[key] ? '' : 'none';
    });
}

function initVisitsTableUI() {
    const pageSize = document.getElementById('visitsPageSize');
    const prevBtn = document.getElementById('visitsPrevPage');
    const nextBtn = document.getElementById('visitsNextPage');
    const colToggle = document.getElementById('visitsColumnToggle');
    const colMenu = document.getElementById('visitsColumnMenu');

    if (pageSize) {
        pageSize.value = String(state.fsmVisits.pageSize);
        pageSize.addEventListener('change', () => {
            state.fsmVisits.pageSize = parseInt(pageSize.value, 10) || 10;
            state.fsmVisits.page = 1;
            renderVisitsTable();
        });
    }

    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            if (state.fsmVisits.page > 1) {
                state.fsmVisits.page -= 1;
                renderVisitsTable();
            }
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            const totalPages = Math.ceil(state.fsmVisits.all.length / state.fsmVisits.pageSize) || 1;
            if (state.fsmVisits.page < totalPages) {
                state.fsmVisits.page += 1;
                renderVisitsTable();
            }
        });
    }

    document.querySelectorAll('#visitsTable thead [data-sort]').forEach(th => {
        th.addEventListener('click', () => {
            const key = th.getAttribute('data-sort');
            if (!key) return;
            if (state.fsmVisits.sortKey === key) {
                state.fsmVisits.sortDir = state.fsmVisits.sortDir === 'asc' ? 'desc' : 'asc';
            } else {
                state.fsmVisits.sortKey = key;
                state.fsmVisits.sortDir = 'asc';
            }
            renderVisitsTable();
        });
    });

    if (colToggle && colMenu) {
        colToggle.addEventListener('click', () => colMenu.classList.toggle('hidden'));
        colMenu.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            cb.addEventListener('change', () => {
                const key = cb.getAttribute('data-col');
                state.fsmVisits.columns[key] = cb.checked;
                applyVisitsColumnVisibility();
            });
        });
        document.addEventListener('click', (e) => {
            if (!colMenu.contains(e.target) && e.target !== colToggle) {
                colMenu.classList.add('hidden');
            }
        });
    }
}

async function viewVisitDetails(visitId) {
    try {
        // Show modal with loading state
        const modal = document.getElementById('visitModal');
        modal.classList.remove('hidden');
        
        // Fetch visit details
        const response = await fetch(`/api/fsm/visits/${visitId}`);
        const result = await response.json();
        
        if (!result.success) {
            showNotification('Failed to load visit details', 'error');
            modal.classList.add('hidden');
            return;
        }
        
        const visit = result.data;
        
        // Populate modal
        document.getElementById('visitModalMeta').textContent = `Visit ID: ${visit.id}`;
        document.getElementById('visitCustomer').textContent = visit.customer_name || '-';
        document.getElementById('visitSalesman').textContent = visit.salesman_name || visit.salesman_phone || '-';
        document.getElementById('visitBranch').textContent = visit.plant_name || '-';
        document.getElementById('visitType').textContent = visit.visit_type || '-';
        
        // Format date and time
        if (visit.visit_date) {
            const date = new Date(visit.visit_date);
            let timeStr = '';
            if (visit.time_in) {
                const timeIn = new Date(visit.time_in);
                timeStr = ` at ${timeIn.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
            }
            document.getElementById('visitDateTime').textContent = date.toLocaleDateString() + timeStr;
        } else {
            document.getElementById('visitDateTime').textContent = '-';
        }
        
        // Calculate duration
        let durationText = '-';
        if (visit.duration_minutes) {
            durationText = `${visit.duration_minutes} min`;
        } else if (visit.time_in && visit.time_out) {
            const timeIn = new Date(visit.time_in);
            const timeOut = new Date(visit.time_out);
            const mins = Math.floor((timeOut - timeIn) / 60000);
            durationText = `${mins} min`;
        }
        document.getElementById('visitDuration').textContent = durationText;
        
        // Status with color
        const statusEl = document.getElementById('visitStatus');
        if (visit.time_out) {
            statusEl.textContent = 'Completed';
            statusEl.className = 'text-green-400 font-semibold';
        } else {
            statusEl.textContent = 'In Progress';
            statusEl.className = 'text-yellow-400 font-semibold';
        }
        
        document.getElementById('visitPotential').textContent = visit.potential || '-';
        
        // Location
        const locationParts = [];
        if (visit.gps_latitude && visit.gps_longitude) {
            locationParts.push(`${visit.gps_latitude.toFixed(6)}, ${visit.gps_longitude.toFixed(6)}`);
        }
        if (visit.customer_address) {
            locationParts.push(visit.customer_address);
        }
        document.getElementById('visitLocation').textContent = locationParts.length > 0 ? locationParts.join(' • ') : '-';
        
        // Notes
        document.getElementById('visitNotes').textContent = visit.remarks || visit.notes || 'No notes';
        
        // Images
        const imagesSection = document.getElementById('visitImagesSection');
        const imagesContainer = document.getElementById('visitImages');
        if (visit.images && visit.images.length > 0) {
            imagesSection.classList.remove('hidden');
            imagesContainer.innerHTML = visit.images.map(img => `
                <a href="${img.image_url}" target="_blank" class="block">
                    <img src="${img.image_url}" alt="Visit image" class="w-full h-32 object-cover rounded-lg hover:opacity-80 transition-opacity">
                </a>
            `).join('');
        } else {
            imagesSection.classList.add('hidden');
            imagesContainer.innerHTML = '';
        }
        
    } catch (error) {
        console.error('Error loading visit details:', error);
        showNotification('Error loading visit details', 'error');
        document.getElementById('visitModal').classList.add('hidden');
    }
}

function exportVisitsExcel() {
    showNotification('Excel export feature coming soon', 'info');
}
