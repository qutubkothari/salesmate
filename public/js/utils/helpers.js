/**
 * Helper Utilities Module
 * Common helper functions used across the application
 * @module utils/helpers
 */

/**
 * Escape HTML to prevent XSS
 * @param {string} str - String to escape
 * @returns {string} - Escaped string
 */
export function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/**
 * Format date to localized string
 * @param {string|Date} date - Date to format
 * @param {Object} options - Intl.DateTimeFormat options
 * @returns {string} - Formatted date
 */
export function formatDate(date, options = {}) {
    if (!date) return 'N/A';
    const defaultOptions = { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
    };
    return new Date(date).toLocaleDateString('en-IN', { ...defaultOptions, ...options });
}

/**
 * Format time to localized string
 * @param {string|Date} date - Date/time to format
 * @returns {string} - Formatted time
 */
export function formatTime(date) {
    if (!date) return 'N/A';
    return new Date(date).toLocaleTimeString('en-IN', { 
        hour: '2-digit', 
        minute: '2-digit' 
    });
}

/**
 * Format currency (INR)
 * @param {number} amount - Amount to format
 * @returns {string} - Formatted currency
 */
export function formatCurrency(amount) {
    if (amount === null || amount === undefined) return '₹0';
    return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        minimumFractionDigits: 0
    }).format(amount);
}

/**
 * Format number with Indian numbering system
 * @param {number} num - Number to format
 * @returns {string} - Formatted number
 */
export function formatNumber(num) {
    if (num === null || num === undefined) return '0';
    return new Intl.NumberFormat('en-IN').format(num);
}

/**
 * Debounce function execution
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in ms
 * @returns {Function} - Debounced function
 */
export function debounce(func, wait = 300) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Throttle function execution
 * @param {Function} func - Function to throttle
 * @param {number} limit - Time limit in ms
 * @returns {Function} - Throttled function
 */
export function throttle(func, limit = 300) {
    let inThrottle;
    return function(...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

/**
 * Show notification toast
 * @param {string} message - Message to display
 * @param {string} type - Type: 'success' | 'error' | 'info' | 'warning'
 * @param {number} duration - Duration in ms
 */
export function showNotification(message, type = 'info', duration = 3000) {
    const notification = document.createElement('div');
    notification.className = `fixed top-4 right-4 px-6 py-3 rounded-lg shadow-lg z-50 transition-all transform translate-x-0 ${getNotificationClass(type)}`;
    notification.innerHTML = `
        <div class="flex items-center gap-3">
            <i class="fas ${getNotificationIcon(type)}"></i>
            <span>${escapeHtml(message)}</span>
        </div>
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.transform = 'translateX(400px)';
        notification.style.opacity = '0';
        setTimeout(() => notification.remove(), 300);
    }, duration);
}

function getNotificationClass(type) {
    const classes = {
        success: 'bg-green-500 text-white',
        error: 'bg-red-500 text-white',
        warning: 'bg-yellow-500 text-white',
        info: 'bg-blue-500 text-white'
    };
    return classes[type] || classes.info;
}

function getNotificationIcon(type) {
    const icons = {
        success: 'fa-check-circle',
        error: 'fa-exclamation-circle',
        warning: 'fa-exclamation-triangle',
        info: 'fa-info-circle'
    };
    return icons[type] || icons.info;
}

/**
 * Create loading spinner element
 * @returns {HTMLElement} - Spinner element
 */
export function createLoadingSpinner() {
    const spinner = document.createElement('div');
    spinner.className = 'flex justify-center items-center py-12';
    spinner.innerHTML = '<div class="loading-spinner"></div>';
    return spinner;
}

/**
 * Create empty state element
 * @param {string} icon - FontAwesome icon class
 * @param {string} message - Message to display
 * @returns {HTMLElement} - Empty state element
 */
export function createEmptyState(icon, message) {
    const empty = document.createElement('div');
    empty.className = 'flex flex-col items-center justify-center py-12 text-white/60';
    empty.innerHTML = `
        <i class="fas ${icon} text-5xl mb-4"></i>
        <p class="text-lg">${escapeHtml(message)}</p>
    `;
    return empty;
}

/**
 * Deep clone object
 * @param {Object} obj - Object to clone
 * @returns {Object} - Cloned object
 */
export function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

/**
 * Get URL query parameters
 * @returns {Object} - Query parameters object
 */
export function getQueryParams() {
    return Object.fromEntries(new URLSearchParams(window.location.search));
}

/**
 * Set URL query parameters without page reload
 * @param {Object} params - Parameters to set
 */
export function setQueryParams(params) {
    const url = new URL(window.location);
    Object.entries(params).forEach(([key, value]) => {
        if (value) {
            url.searchParams.set(key, value);
        } else {
            url.searchParams.delete(key);
        }
    });
    window.history.pushState({}, '', url);
}

/**
 * Calculate percentage
 * @param {number} value - Current value
 * @param {number} total - Total value
 * @returns {number} - Percentage
 */
export function calculatePercentage(value, total) {
    if (!total || total === 0) return 0;
    return Math.round((value / total) * 100);
}

/**
 * Get progress bar color based on percentage
 * @param {number} percentage - Progress percentage
 * @returns {string} - Tailwind color class
 */
export function getProgressColor(percentage) {
    if (percentage >= 100) return 'bg-green-500';
    if (percentage >= 80) return 'bg-blue-500';
    if (percentage >= 50) return 'bg-yellow-500';
    return 'bg-red-500';
}

/**
 * Export data to CSV
 * @param {Array} data - Array of objects
 * @param {string} filename - Output filename
 */
export function exportToCSV(data, filename = 'export.csv') {
    if (!data || data.length === 0) {
        showNotification('No data to export', 'warning');
        return;
    }

    const headers = Object.keys(data[0]);
    const csv = [
        headers.join(','),
        ...data.map(row => 
            headers.map(header => {
                const value = row[header];
                const escaped = String(value).replace(/"/g, '""');
                return `"${escaped}"`;
            }).join(',')
        )
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
}

/**
 * Generate unique ID
 * @returns {string} - Unique ID
 */
export function generateId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Validate email
 * @param {string} email - Email to validate
 * @returns {boolean} - Is valid
 */
export function isValidEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

/**
 * Validate phone number (Indian)
 * @param {string} phone - Phone to validate
 * @returns {boolean} - Is valid
 */
export function isValidPhone(phone) {
    const re = /^[6-9]\d{9}$/;
    return re.test(phone.replace(/\D/g, ''));
}
