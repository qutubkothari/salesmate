// FSM Reports Module
// Handles all reporting and analytics functionality

async function loadFSMReports() {
    console.log('📈 loadFSMReports() started');
    try {
        const monthInput = document.getElementById('reportMonth');
        if (!monthInput.value) {
            const now = new Date();
            monthInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        }
        
        const period = monthInput.value;
        console.log('📅 Report period:', period);
        const [year, month] = period.split('-');
        const startDate = `${year}-${month}-01`;
        const endDate = new Date(parseInt(year), parseInt(month), 0).toISOString().split('T')[0];
        console.log('📅 Date range:', startDate, 'to', endDate);
        
        // Fetch all required data in parallel
        console.log('🌐 Fetching FSM data from API...');
        const [visitsResp, salesmenResp, targetsResp, plantsResp] = await Promise.all([
            fetch(`/api/fsm/visits?start_date=${startDate}&end_date=${endDate}&tenant_id=${encodeURIComponent(state.session?.tenantId || '')}`),
            fetch(`/api/fsm/salesmen?tenant_id=${encodeURIComponent(state.session?.tenantId || '')}`),
            fetch(`/api/fsm/targets?period=${period}&tenant_id=${encodeURIComponent(state.session?.tenantId || '')}`),
            fetch(`/api/fsm/plants?tenant_id=${encodeURIComponent(state.session?.tenantId || '')}`)
        ]);
        
        const visitsData = await visitsResp.json();
        const salesmenData = await salesmenResp.json();
        const targetsData = await targetsResp.json();
        const plantsData = await plantsResp.json();
        
        const visits = visitsData.data || [];
        const salesmen = salesmenData.data || [];
        const targets = targetsData.data || [];
        const plants = plantsData.data || [];
        console.log('📊 Data loaded - Visits:', visits.length, 'Salesmen:', salesmen.length, 'Targets:', targets.length, 'Plants:', plants.length);
        
        // Calculate summary stats
        const totalVisits = visits.length;
        const avgDuration = visits.length > 0 
            ? Math.round(visits.reduce((sum, v) => sum + (v.duration_minutes || 0), 0) / visits.length)
            : 0;
        
        const highPotentialVisits = visits.filter(v => v.potential === 'High').length;
        const hitRatio = totalVisits > 0 ? Math.round((highPotentialVisits / totalVisits) * 100) : 0;
        
        const totalTargetVisits = targets.reduce((sum, t) => sum + (t.target_visits || 0), 0);
        const totalAchievedVisits = targets.reduce((sum, t) => sum + (t.achieved_visits || 0), 0);
        const targetAchievement = totalTargetVisits > 0 
            ? Math.round((totalAchievedVisits / totalTargetVisits) * 100)
            : 0;
        
        // Update summary cards
        console.log('📊 Stats - Total:', totalVisits, 'Avg Duration:', avgDuration, 'Hit Ratio:', hitRatio + '%', 'Achievement:', targetAchievement + '%');
        document.getElementById('reportTotalVisits').textContent = totalVisits;
        document.getElementById('reportAvgDuration').textContent = avgDuration;
        document.getElementById('reportHitRatio').textContent = hitRatio + '%';
        document.getElementById('reportTargetAchievement').textContent = targetAchievement + '%';
        
        // Generate charts
        console.log('📈 Generating charts...');
        generateVisitTrendChart(visits, startDate, endDate);
        generateVisitTypeChart(visits);
        
        // Generate salesman performance table
        console.log('👥 Generating salesman performance table...');
        generateSalesmanPerformanceTable(salesmen, visits, targets);
        
        // Generate branch performance table
        console.log('🏢 Generating branch performance table...');
        generateBranchPerformanceTable(plants, salesmen, visits);
        console.log('✅ FSM Reports loaded successfully');
        
    } catch (error) {
        console.error('❌ Error loading FSM reports:', error);
        console.error('Stack trace:', error.stack);
        showNotification('Error loading reports', 'error');
    }
}

function generateVisitTrendChart(visits, startDate, endDate) {
    const visitsByDate = {};
    visits.forEach(v => {
        const date = v.visit_date;
        visitsByDate[date] = (visitsByDate[date] || 0) + 1;
    });
    
    const dates = [];
    const counts = [];
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split('T')[0];
        dates.push(dateStr);
        counts.push(visitsByDate[dateStr] || 0);
    }
    
    const canvas = document.getElementById('visitTrendChart');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.font = '14px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(`Visit Trend: ${counts.reduce((a,b) => a+b, 0)} total visits`, canvas.width/2, canvas.height/2);
}

function generateVisitTypeChart(visits) {
    const types = {};
    visits.forEach(v => {
        const type = v.visit_type || 'Unknown';
        types[type] = (types[type] || 0) + 1;
    });
    
    const canvas = document.getElementById('visitTypeChart');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.font = '14px Arial';
    ctx.textAlign = 'center';
    
    const typeEntries = Object.entries(types);
    typeEntries.forEach(([type, count], idx) => {
        ctx.fillText(`${type}: ${count}`, canvas.width/2, 50 + (idx * 30));
    });
}

function generateSalesmanPerformanceTable(salesmen, visits, targets) {
    const tbody = document.getElementById('salesmanPerformanceBody');
    
    const performance = salesmen.map(salesman => {
        const salesmanVisits = visits.filter(v => v.salesman_id === salesman.id);
        const target = targets.find(t => t.salesman_id === salesman.id);
        
        const visitCount = salesmanVisits.length;
        const targetVisits = target?.target_visits || 0;
        const achievement = targetVisits > 0 ? Math.round((visitCount / targetVisits) * 100) : 0;
        
        const avgDuration = visitCount > 0
            ? Math.round(salesmanVisits.reduce((sum, v) => sum + (v.duration_minutes || 0), 0) / visitCount)
            : 0;
        
        const highPotential = salesmanVisits.filter(v => v.potential === 'High').length;
        
        return {
            name: salesman.name,
            visitCount,
            targetVisits,
            achievement,
            avgDuration,
            highPotential,
            score: achievement + (highPotential * 2)
        };
    });
    
    performance.sort((a, b) => b.score - a.score);
    
    if (performance.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center py-8 text-white/60">No performance data available</td></tr>';
        return;
    }
    
    tbody.innerHTML = performance.map((p, idx) => {
        const rank = idx + 1;
        const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank;
        const performanceColor = p.achievement >= 100 ? 'text-green-400' : 
            p.achievement >= 80 ? 'text-blue-400' : 
            p.achievement >= 50 ? 'text-yellow-400' : 'text-red-400';
        
        return `
            <tr class="text-white border-b border-white/10 hover:bg-white/5">
                <td class="py-3 px-4 text-2xl">${medal}</td>
                <td class="py-3 px-4 font-semibold">${escapeHtml(p.name)}</td>
                <td class="py-3 px-4">${p.visitCount}</td>
                <td class="py-3 px-4">${p.targetVisits}</td>
                <td class="py-3 px-4">
                    <div class="flex items-center gap-2">
                        <div class="w-24 bg-white/10 rounded-full h-2">
                            <div class="bg-blue-500 h-2 rounded-full" style="width: ${Math.min(p.achievement, 100)}%"></div>
                        </div>
                        <span class="${performanceColor} font-bold">${p.achievement}%</span>
                    </div>
                </td>
                <td class="py-3 px-4">${p.avgDuration} min</td>
                <td class="py-3 px-4">
                    <span class="px-2 py-1 rounded text-xs bg-orange-500/20 text-orange-300">
                        ${p.highPotential} visits
                    </span>
                </td>
                <td class="py-3 px-4">
                    <span class="px-3 py-1 rounded-full text-sm font-bold ${performanceColor}">
                        ${p.score} pts
                    </span>
                </td>
            </tr>
        `;
    }).join('');
}

function generateBranchPerformanceTable(plants, salesmen, visits) {
    const tbody = document.getElementById('branchPerformanceBody');
    
    const branchPerformance = plants.map(plant => {
        const plantId = plant.plant_id || plant.id;
        const branchSalesmen = salesmen.filter(s => s.plant_id === plantId);
        const branchVisits = visits.filter(v => v.plant_id === plantId);
        
        const totalVisits = branchVisits.length;
        const avgVisits = branchSalesmen.length > 0 ? Math.round(totalVisits / branchSalesmen.length) : 0;
        const highPotential = branchVisits.filter(v => v.potential === 'High').length;
        const highPotentialPct = totalVisits > 0 ? Math.round((highPotential / totalVisits) * 100) : 0;
        
        return {
            name: plant.plant_name || plant.name || 'Unknown',
            salesmenCount: branchSalesmen.length,
            totalVisits,
            avgVisits,
            highPotentialPct,
            score: avgVisits + highPotentialPct
        };
    });
    
    branchPerformance.sort((a, b) => b.score - a.score);
    
    if (branchPerformance.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center py-8 text-white/60">No branch data available</td></tr>';
        return;
    }
    
    tbody.innerHTML = branchPerformance.map(b => {
        const scoreColor = b.score >= 100 ? 'text-green-400' : 
            b.score >= 50 ? 'text-blue-400' : 'text-yellow-400';
        
        return `
            <tr class="text-white border-b border-white/10 hover:bg-white/5">
                <td class="py-3 px-4 font-semibold">${escapeHtml(b.name)}</td>
                <td class="py-3 px-4">${b.salesmenCount}</td>
                <td class="py-3 px-4">${b.totalVisits}</td>
                <td class="py-3 px-4">${b.avgVisits}</td>
                <td class="py-3 px-4">
                    <span class="px-2 py-1 rounded text-xs ${b.highPotentialPct >= 30 ? 'bg-green-500/20 text-green-300' : 'bg-yellow-500/20 text-yellow-300'}">
                        ${b.highPotentialPct}%
                    </span>
                </td>
                <td class="py-3 px-4">
                    <span class="text-lg font-bold ${scoreColor}">${b.score}</span>
                </td>
            </tr>
        `;
    }).join('');
}

function exportFSMReport() {
    showNotification('PDF export feature coming soon! Use browser print for now.', 'info');
    window.print();
}
