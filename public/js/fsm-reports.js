// FSM Reports Module
// Handles all reporting and analytics functionality with proper charts

// Store chart instances to destroy them before recreation
let visitTrendChartInstance = null;
let visitTypeChartInstance = null;

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
        
        // Generate charts with Chart.js
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
    // Destroy previous chart instance
    if (visitTrendChartInstance) {
        visitTrendChartInstance.destroy();
    }
    
    // Group visits by date
    const visitsByDate = {};
    visits.forEach(v => {
        const date = v.visit_date;
        visitsByDate[date] = (visitsByDate[date] || 0) + 1;
    });
    
    // Generate date range and counts
    const labels = [];
    const data = [];
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split('T')[0];
        const dateObj = new Date(dateStr);
        const label = `${dateObj.getDate()} ${dateObj.toLocaleDateString('en', { month: 'short' })}`;
        labels.push(label);
        data.push(visitsByDate[dateStr] || 0);
    }
    
    const canvas = document.getElementById('visitTrendChart');
    const ctx = canvas.getContext('2d');
    
    visitTrendChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Daily Visits',
                data: data,
                borderColor: 'rgb(59, 130, 246)',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                borderWidth: 2,
                fill: true,
                tension: 0.4,
                pointBackgroundColor: 'rgb(59, 130, 246)',
                pointBorderColor: '#fff',
                pointBorderWidth: 2,
                pointRadius: 4,
                pointHoverRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    labels: {
                        color: '#fff',
                        font: {
                            size: 12
                        }
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    titleColor: '#fff',
                    bodyColor: '#fff',
                    borderColor: 'rgba(59, 130, 246, 0.5)',
                    borderWidth: 1
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        color: '#fff',
                        stepSize: 1
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    }
                },
                x: {
                    ticks: {
                        color: '#fff',
                        maxRotation: 45,
                        minRotation: 45
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    }
                }
            }
        }
    });
}

function generateVisitTypeChart(visits) {
    // Destroy previous chart instance
    if (visitTypeChartInstance) {
        visitTypeChartInstance.destroy();
    }
    
    // Group visits by type
    const types = {};
    visits.forEach(v => {
        const type = v.visit_type || 'Unknown';
        types[type] = (types[type] || 0) + 1;
    });
    
    const labels = Object.keys(types);
    const data = Object.values(types);
    
    // Generate colors for each type
    const colors = [
        'rgba(59, 130, 246, 0.8)',   // Blue
        'rgba(16, 185, 129, 0.8)',   // Green
        'rgba(245, 158, 11, 0.8)',   // Yellow
        'rgba(239, 68, 68, 0.8)',    // Red
        'rgba(139, 92, 246, 0.8)',   // Purple
        'rgba(236, 72, 153, 0.8)',   // Pink
        'rgba(20, 184, 166, 0.8)',   // Teal
        'rgba(251, 146, 60, 0.8)'    // Orange
    ];
    
    const canvas = document.getElementById('visitTypeChart');
    const ctx = canvas.getContext('2d');
    
    visitTypeChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: colors,
                borderColor: '#1e293b',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        color: '#fff',
                        padding: 15,
                        font: {
                            size: 12
                        }
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    titleColor: '#fff',
                    bodyColor: '#fff',
                    borderColor: 'rgba(255, 255, 255, 0.2)',
                    borderWidth: 1,
                    callbacks: {
                        label: function(context) {
                            const label = context.label || '';
                            const value = context.parsed || 0;
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percentage = ((value / total) * 100).toFixed(1);
                            return `${label}: ${value} (${percentage}%)`;
                        }
                    }
                }
            }
        }
    });
}

function generateSalesmanPerformanceTable(salesmen, visits, targets) {
    const tbody = document.getElementById('salesmanPerformanceBody');
    
    // Calculate performance metrics for each salesman
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
        
        // Performance score calculation (weighted):
        // - Visit count: 40% weight
        // - Achievement %: 30% weight
        // - High potential visits: 20% weight (2 points each)
        // - Average duration: 10% weight (bonus if > 30 min)
        const visitScore = visitCount * 10;
        const achievementScore = achievement * 3;
        const highPotScore = highPotential * 20;
        const durationBonus = avgDuration >= 30 ? 50 : avgDuration >= 20 ? 25 : 0;
        
        const score = visitScore + achievementScore + highPotScore + durationBonus;
        
        return {
            id: salesman.id,
            name: salesman.name,
            visitCount,
            targetVisits,
            achievement,
            avgDuration,
            highPotential,
            score
        };
    });
    
    // Sort by performance score (highest first)
    performance.sort((a, b) => {
        // Primary: Score
        if (b.score !== a.score) return b.score - a.score;
        // Tie-breaker 1: Visit count
        if (b.visitCount !== a.visitCount) return b.visitCount - a.visitCount;
        // Tie-breaker 2: Achievement percentage
        if (b.achievement !== a.achievement) return b.achievement - a.achievement;
        // Tie-breaker 3: High potential visits
        return b.highPotential - a.highPotential;
    });
    
    if (performance.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center py-8 text-white/60">No performance data available</td></tr>';
        return;
    }
    
    tbody.innerHTML = performance.map((p, idx) => {
        const rank = idx + 1;
        
        // Medal/rank display
        let rankDisplay;
        if (rank === 1) rankDisplay = '<span class="text-4xl">🥇</span>';
        else if (rank === 2) rankDisplay = '<span class="text-4xl">🥈</span>';
        else if (rank === 3) rankDisplay = '<span class="text-4xl">🥉</span>';
        else rankDisplay = `<span class="text-xl font-bold text-white/80">${rank}</span>`;
        
        // Color coding based on achievement
        const performanceColor = p.achievement >= 100 ? 'text-green-400' : 
            p.achievement >= 80 ? 'text-blue-400' : 
            p.achievement >= 50 ? 'text-yellow-400' : 'text-red-400';
        
        const progressColor = p.achievement >= 100 ? 'bg-green-500' : 
            p.achievement >= 80 ? 'bg-blue-500' : 
            p.achievement >= 50 ? 'bg-yellow-500' : 'bg-red-500';
        
        return `
            <tr class="text-white border-b border-white/10 hover:bg-white/5 ${rank <= 3 ? 'bg-white/5' : ''}">
                <td class="py-3 px-4 text-center">${rankDisplay}</td>
                <td class="py-3 px-4">
                    <div class="font-semibold">${escapeHtml(p.name)}</div>
                    ${rank <= 3 ? '<div class="text-xs text-yellow-400">⭐ Top Performer</div>' : ''}
                </td>
                <td class="py-3 px-4">
                    <span class="font-bold text-blue-400">${p.visitCount}</span>
                </td>
                <td class="py-3 px-4">${p.targetVisits}</td>
                <td class="py-3 px-4">
                    <div class="flex items-center gap-2">
                        <div class="w-24 bg-white/10 rounded-full h-2">
                            <div class="${progressColor} h-2 rounded-full transition-all" style="width: ${Math.min(p.achievement, 100)}%"></div>
                        </div>
                        <span class="${performanceColor} font-bold">${p.achievement}%</span>
                    </div>
                </td>
                <td class="py-3 px-4">
                    <span class="${p.avgDuration >= 30 ? 'text-green-400' : 'text-white'}">${p.avgDuration} min</span>
                </td>
                <td class="py-3 px-4">
                    <span class="px-2 py-1 rounded text-xs ${p.highPotential > 0 ? 'bg-orange-500/20 text-orange-300' : 'bg-gray-500/20 text-gray-400'}">
                        ${p.highPotential} ${p.highPotential === 1 ? 'visit' : 'visits'}
                    </span>
                </td>
                <td class="py-3 px-4">
                    <div class="flex flex-col items-start">
                        <span class="px-3 py-1 rounded-full text-sm font-bold ${performanceColor} bg-white/10">
                            ${p.score} pts
                        </span>
                        ${rank === 1 ? '<div class="text-xs text-yellow-400 mt-1">🏆 Champion</div>' : ''}
                    </div>
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
        
        // Branch score: weighted combination of metrics
        const score = (avgVisits * 10) + (highPotentialPct * 2) + (totalVisits * 0.5);
        
        return {
            name: plant.plant_name || plant.name || 'Unknown',
            salesmenCount: branchSalesmen.length,
            totalVisits,
            avgVisits,
            highPotentialPct,
            score: Math.round(score)
        };
    });
    
    // Sort by score (highest first)
    branchPerformance.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (b.totalVisits !== a.totalVisits) return b.totalVisits - a.totalVisits;
        return b.avgVisits - a.avgVisits;
    });
    
    if (branchPerformance.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center py-8 text-white/60">No branch data available</td></tr>';
        return;
    }
    
    tbody.innerHTML = branchPerformance.map((b, idx) => {
        const rank = idx + 1;
        const scoreColor = b.score >= 100 ? 'text-green-400' : 
            b.score >= 50 ? 'text-blue-400' : 'text-yellow-400';
        
        return `
            <tr class="text-white border-b border-white/10 hover:bg-white/5 ${rank === 1 ? 'bg-white/5' : ''}">
                <td class="py-3 px-4">
                    <div class="font-semibold">${escapeHtml(b.name)}</div>
                    ${rank === 1 ? '<div class="text-xs text-green-400">🏆 Top Branch</div>' : ''}
                </td>
                <td class="py-3 px-4">${b.salesmenCount}</td>
                <td class="py-3 px-4">
                    <span class="font-bold text-blue-400">${b.totalVisits}</span>
                </td>
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
