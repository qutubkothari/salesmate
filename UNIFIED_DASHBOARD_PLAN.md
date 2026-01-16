# Unified Dashboard Implementation Plan

## Goal
Create a single admin dashboard combining FSM + Salesmate features with unified lead management.

## Changes to Implement

### 1. Add FSM Navigation Items (After line 198 in dashboard.html)

```html
<!-- FSM Section Divider -->
<div class="px-4 py-2 mt-4">
    <p class="text-white/40 text-xs font-semibold uppercase tracking-wider">Field Sales</p>
</div>

<!-- Visits Management -->
<div class="sidebar-item" onclick="switchTab('visits')" data-tab="visits">
    <i class="fas fa-map-marker-alt"></i>
    <span>Visits</span>
</div>

<!-- Salesmen/Team -->
<div class="sidebar-item" onclick="switchTab('salesmen')" data-tab="salesmen">
    <i class="fas fa-user-tie"></i>
    <span>Sales Team</span>
</div>

<!-- Targets & Performance -->
<div class="sidebar-item" onclick="switchTab('targets')" data-tab="targets">
    <i class="fas fa-bullseye"></i>
    <span>Targets</span>
</div>

<!-- Branches/Plants -->
<div class="sidebar-item" onclick="switchTab('branches')" data-tab="branches">
    <i class="fas fa-building"></i>
    <span>Branches</span>
</div>
```

### 2. Modify Leads Tab to Show All Sources

Update the existing "Leads" tab to show unified view:
- WhatsApp leads
- Visit-based leads
- Phone leads
- Indiamart leads
- Manual entries

Add source filter/badge to each lead.

### 3. Add FSM Tab Content Sections

After existing tab content areas, add:

```html
<!-- Visits Tab -->
<div id="visitsTab" class="tab-content hidden">
    <div class="max-w-7xl mx-auto">
        <!-- Header with filters -->
        <div class="flex justify-between items-center mb-6">
            <h2 class="text-white text-2xl font-bold">Field Visits</h2>
            <div class="flex space-x-3">
                <select id="visitBranchFilter" class="px-4 py-2 rounded-lg bg-white/10 text-white border border-white/20">
                    <option value="">All Branches</option>
                </select>
                <select id="visitSalesmanFilter" class="px-4 py-2 rounded-lg bg-white/10 text-white border border-white/20">
                    <option value="">All Salesmen</option>
                </select>
                <input type="date" id="visitDateFrom" class="px-4 py-2 rounded-lg bg-white/10 text-white border border-white/20" />
                <input type="date" id="visitDateTo" class="px-4 py-2 rounded-lg bg-white/10 text-white border border-white/20" />
                <button onclick="exportVisitsExcel()" class="px-4 py-2 bg-green-500 hover:bg-green-600 rounded-lg text-white">
                    <i class="fas fa-download mr-2"></i>Export Excel
                </button>
            </div>
        </div>

        <!-- Stats Cards -->
        <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div class="stat-card p-4 rounded-xl">
                <div class="flex items-center justify-between">
                    <div>
                        <p class="text-white/60 text-sm">Total Visits</p>
                        <p class="text-white text-2xl font-bold" id="totalVisitsCount">0</p>
                    </div>
                    <i class="fas fa-map-marker-alt text-blue-400 text-3xl"></i>
                </div>
            </div>
            <div class="stat-card p-4 rounded-xl">
                <div class="flex items-center justify-between">
                    <div>
                        <p class="text-white/60 text-sm">Completed Today</p>
                        <p class="text-white text-2xl font-bold" id="todayVisitsCount">0</p>
                    </div>
                    <i class="fas fa-check-circle text-green-400 text-3xl"></i>
                </div>
            </div>
            <div class="stat-card p-4 rounded-xl">
                <div class="flex items-center justify-between">
                    <div>
                        <p class="text-white/60 text-sm">Active Salesmen</p>
                        <p class="text-white text-2xl font-bold" id="activeSalesmenCount">0</p>
                    </div>
                    <i class="fas fa-user-tie text-purple-400 text-3xl"></i>
                </div>
            </div>
            <div class="stat-card p-4 rounded-xl">
                <div class="flex items-center justify-between">
                    <div>
                        <p class="text-white/60 text-sm">Avg. Visit Duration</p>
                        <p class="text-white text-2xl font-bold" id="avgVisitDuration">0</p>
                        <p class="text-white/60 text-xs">minutes</p>
                    </div>
                    <i class="fas fa-clock text-yellow-400 text-3xl"></i>
                </div>
            </div>
        </div>

        <!-- Visits Table -->
        <div class="glass-effect rounded-xl p-6">
            <table class="w-full" id="visitsTable">
                <thead>
                    <tr class="text-white/60 text-sm border-b border-white/10">
                        <th class="text-left py-3 px-4">Date</th>
                        <th class="text-left py-3 px-4">Customer</th>
                        <th class="text-left py-3 px-4">Salesman</th>
                        <th class="text-left py-3 px-4">Branch</th>
                        <th class="text-left py-3 px-4">Type</th>
                        <th class="text-left py-3 px-4">Duration</th>
                        <th class="text-left py-3 px-4">Potential</th>
                        <th class="text-left py-3 px-4">Status</th>
                        <th class="text-left py-3 px-4">Actions</th>
                    </tr>
                </thead>
                <tbody id="visitsTableBody">
                    <!-- Populated by JS -->
                </tbody>
            </table>
        </div>
    </div>
</div>

<!-- Salesmen Tab -->
<div id="salesmenTab" class="tab-content hidden">
    <!-- Sales team management -->
</div>

<!-- Targets Tab -->
<div id="targetsTab" class="tab-content hidden">
    <!-- Target tracking -->
</div>

<!-- Branches Tab -->
<div id="branchesTab" class="tab-content hidden">
    <!-- Branch/plant management -->
</div>
```

### 4. Add JavaScript Functions

```javascript
// FSM API Functions
async function loadVisits(filters = {}) {
    try {
        const params = new URLSearchParams(filters);
        const response = await fetch(`/api/visits?${params}`);
        const visits = await response.json();
        
        // Update stats
        document.getElementById('totalVisitsCount').textContent = visits.length;
        
        // Populate table
        const tbody = document.getElementById('visitsTableBody');
        tbody.innerHTML = visits.map(visit => `
            <tr class="text-white border-b border-white/10 hover:bg-white/5">
                <td class="py-3 px-4">${formatDate(visit.visit_date)}</td>
                <td class="py-3 px-4">${visit.customer_name}</td>
                <td class="py-3 px-4">${visit.salesman_name || 'N/A'}</td>
                <td class="py-3 px-4">${visit.plant_name || '-'}</td>
                <td class="py-3 px-4">
                    <span class="px-2 py-1 rounded text-xs bg-blue-500/20 text-blue-300">${visit.visit_type || 'Regular'}</span>
                </td>
                <td class="py-3 px-4">${visit.duration_minutes || 0} min</td>
                <td class="py-3 px-4">
                    <span class="px-2 py-1 rounded text-xs ${
                        visit.potential === 'High' ? 'bg-green-500/20 text-green-300' :
                        visit.potential === 'Medium' ? 'bg-yellow-500/20 text-yellow-300' :
                        'bg-gray-500/20 text-gray-300'
                    }">${visit.potential || 'Low'}</span>
                </td>
                <td class="py-3 px-4">
                    ${visit.time_out ? '<span class="text-green-400"><i class="fas fa-check-circle"></i> Complete</span>' : 
                      '<span class="text-yellow-400"><i class="fas fa-clock"></i> In Progress</span>'}
                </td>
                <td class="py-3 px-4">
                    <button onclick="viewVisit('${visit.id}')" class="text-blue-400 hover:text-blue-300">
                        <i class="fas fa-eye"></i>
                    </button>
                </td>
            </tr>
        `).join('');
        
    } catch (error) {
        console.error('Error loading visits:', error);
    }
}

async function loadSalesmen() {
    const response = await fetch('/api/salesmen');
    const salesmen = await response.json();
    // Populate salesmen tab and filters
}

async function loadTargets() {
    const response = await fetch('/api/targets');
    const targets = await response.json();
    // Populate targets tab
}

// Unified Leads Function
async function loadUnifiedLeads() {
    const [whatsappLeads, visitLeads, phoneLeads] = await Promise.all([
        fetch('/api/leads?source=whatsapp').then(r => r.json()),
        fetch('/api/visits?converted=false').then(r => r.json()),
        fetch('/api/leads?source=phone').then(r => r.json())
    ]);
    
    // Merge and display with source badges
    const allLeads = [
        ...whatsappLeads.map(l => ({...l, source: 'whatsapp'})),
        ...visitLeads.map(v => ({...v, source: 'visit', lead_name: v.customer_name})),
        ...phoneLeads.map(l => ({...l, source: 'phone'}))
    ];
    
    // Render unified leads table
}
```

### 5. Update switchTab Function

Add cases for new FSM tabs:

```javascript
function switchTab(tabName) {
    // Hide all tabs
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.add('hidden'));
    
    // Remove active class from all sidebar items
    document.querySelectorAll('.sidebar-item').forEach(item => item.classList.remove('active'));
    
    // Activate selected tab
    const activeTab = document.querySelector(`[data-tab="${tabName}"]`);
    if (activeTab) activeTab.classList.add('active');
    
    // Show selected content
    switch(tabName) {
        case 'visits':
            document.getElementById('visitsTab').classList.remove('hidden');
            loadVisits();
            break;
        case 'salesmen':
            document.getElementById('salesmenTab').classList.remove('hidden');
            loadSalesmen();
            break;
        case 'targets':
            document.getElementById('targetsTab').classList.remove('hidden');
            loadTargets();
            break;
        case 'branches':
            document.getElementById('branchesTab').classList.remove('hidden');
            loadBranches();
            break;
        case 'leads':
            document.getElementById('leadsTab').classList.remove('hidden');
            loadUnifiedLeads(); // Updated to show all sources
            break;
        // ... existing cases
    }
}
```

## Implementation Steps

1. ✅ Create this plan document
2. Add FSM sidebar navigation items
3. Create FSM tab content sections (visits, salesmen, targets, branches)
4. Add JavaScript API integration functions
5. Update leads tab for unified view
6. Add branch/plant selector to header
7. Test all FSM features
8. Deploy

## Files to Modify

- `public/dashboard.html` - Main dashboard file
- `routes/api/visits.js` - May need minor updates
- `routes/api/salesmen.js` - May need minor updates
- `routes/api/targets.js` - May need minor updates

Ready to proceed with implementation?
