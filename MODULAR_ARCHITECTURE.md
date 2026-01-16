# Salesmate Dashboard - Modular Architecture 2026

## 🎯 Overview

The dashboard has been refactored into a modern, modular architecture following industry-standard 2026 coding practices. This makes the codebase:
- **Maintainable**: Easy to update and debug
- **Scalable**: Simple to add new features
- **Professional**: Clean separation of concerns
- **Performant**: Lazy loading and optimized imports

## 📁 Project Structure

```
public/
├── css/
│   └── dashboard.css                 # Extracted styles
├── js/
│   ├── app.js                       # Main entry point
│   ├── utils/
│   │   ├── api.js                   # API client & endpoints
│   │   ├── state.js                 # State management
│   │   ├── router.js                # Tab routing system
│   │   └── helpers.js               # Common utilities
│   ├── modules/
│   │   ├── fsm/
│   │   │   ├── visits.js            # Visits module
│   │   │   ├── salesmen.js          # Salesmen module
│   │   │   ├── targets.js           # Targets module
│   │   │   └── branches.js          # Branches module
│   │   └── [other modules]          # Future: orders, products, etc.
│   └── components/
│       ├── visits-tab.html          # Visits UI template
│       ├── salesmen-tab.html        # Salesmen UI template
│       ├── targets-tab.html         # Targets UI template
│       └── branches-tab.html        # Branches UI template
├── dashboard-modular.html           # New modular dashboard
└── dashboard.html                   # Legacy (kept for compatibility)
```

## 🏗️ Architecture

### 1. **Utilities Layer** (`/js/utils/`)

#### `api.js` - Centralized API Communication
```javascript
import { fsmAPI, salesAPI } from './utils/api.js';

// FSM APIs
const visits = await fsmAPI.getVisits({ dateFrom: '2026-01-01' });
const salesmen = await fsmAPI.getSalesmen();
const targets = await fsmAPI.getTargets();

// Sales APIs
const orders = await salesAPI.getOrders();
const customers = await salesAPI.getCustomers();
```

**Features:**
- Generic HTTP client with error handling
- Retry logic
- Type-safe endpoints
- Automatic JSON parsing

#### `state.js` - Reactive State Management
```javascript
import state from './utils/state.js';

// Get state
const visits = state.get('data.visits');

// Set state (triggers listeners)
state.set('data.visits', newVisits);

// Subscribe to changes
state.subscribe('data.visits', (visits) => {
    console.log('Visits updated:', visits);
});

// Batch updates
state.batchUpdate({
    'data.visits': visits,
    'data.salesmen': salesmen
});
```

**Features:**
- Centralized state
- Reactive updates
- localStorage persistence
- Dot-notation access

#### `router.js` - Tab Navigation
```javascript
import router from './utils/router.js';

// Register module
router.register('visits', visitsManager);

// Switch tabs
router.switchTab('visits');

// Set auto-refresh
router.setInterval('visits', () => loadVisits(), 30000);
```

**Features:**
- Module registration
- Lazy loading
- Auto-cleanup on tab switch
- Mobile-responsive

#### `helpers.js` - Common Utilities
```javascript
import { 
    formatDate, 
    formatCurrency, 
    showNotification,
    exportToCSV 
} from './utils/helpers.js';

// Format data
const date = formatDate(new Date());
const price = formatCurrency(1000);

// Show toast
showNotification('Success!', 'success');

// Export data
exportToCSV(visits, 'visits.csv');
```

**Features:**
- Date/time formatting
- Currency formatting
- Toast notifications
- CSV export
- Validation helpers

### 2. **Modules Layer** (`/js/modules/`)

Each feature is a self-contained module with:
- Init/destroy lifecycle
- State management
- API integration
- UI rendering

#### Example: Visits Module
```javascript
// js/modules/fsm/visits.js
class VisitsManager {
    async init() {
        await this.loadVisits();
        await this.populateFilters();
        this.setupEventListeners();
    }

    async loadVisits() {
        const visits = await fsmAPI.getVisits();
        state.set('data.visits', visits);
        this.updateStats(visits);
        this.renderTable(visits);
    }

    destroy() {
        // Cleanup
    }
}
```

### 3. **Components Layer** (`/js/components/`)

HTML templates for tab content:
- Separated from JavaScript
- Easy to modify UI
- Can be loaded dynamically

## 🚀 Usage

### For Developers

#### Adding a New Tab

1. **Create Module** (`js/modules/my-feature.js`):
```javascript
import { salesAPI } from '../utils/api.js';
import state from '../utils/state.js';
import { showNotification } from '../utils/helpers.js';

class MyFeatureManager {
    async init() {
        await this.loadData();
    }

    async loadData() {
        const data = await salesAPI.getMyFeature();
        state.set('data.myFeature', data);
        this.renderTable(data);
    }

    renderTable(data) {
        // Render UI
    }

    destroy() {
        // Cleanup
    }
}

const myFeatureManager = new MyFeatureManager();
window.myFeatureManager = myFeatureManager;
export default myFeatureManager;
```

2. **Create Component** (`js/components/my-feature-tab.html`):
```html
<div id="myFeatureTab" class="hidden">
    <div class="max-w-7xl mx-auto">
        <h2 class="text-white text-2xl font-bold mb-6">My Feature</h2>
        <div id="myFeatureContent"></div>
    </div>
</div>
```

3. **Register in App** (`js/app.js`):
```javascript
import myFeatureManager from './modules/my-feature.js';

// In init()
router.register('my-feature', myFeatureManager);
```

4. **Add to Sidebar** (dashboard-modular.html):
```html
<div class="sidebar-item" onclick="switchTab('my-feature')" data-tab="my-feature">
    <i class="fas fa-star"></i>
    <span>My Feature</span>
</div>
```

#### Calling APIs

```javascript
// GET request
const data = await api.get('/endpoint', { param: 'value' });

// POST request
const result = await api.post('/endpoint', { data: 'value' });

// PUT request
await api.put('/endpoint/123', { updated: 'value' });

// DELETE request
await api.delete('/endpoint/123');
```

#### Managing State

```javascript
// Read
const currentTab = state.get('currentTab');
const visits = state.get('data.visits');

// Write
state.set('currentTab', 'visits');
state.set('data.visits', newVisits);

// Subscribe
const unsubscribe = state.subscribe('data.visits', (visits) => {
    console.log('Visits changed:', visits);
});

// Unsubscribe
unsubscribe();
```

### For Clients

The modular structure provides:
- **Fast loading** - Only loads what you use
- **Easy debugging** - Clear error messages
- **Maintainability** - Each feature is independent
- **Scalability** - Add features without breaking existing code

## 🔄 Migration Path

We're gradually migrating from the legacy `dashboard.html` to the modular version:

**Phase 1** (✅ Complete):
- ✅ Utils extracted (API, state, router, helpers)
- ✅ FSM modules extracted (visits, salesmen, targets, branches)
- ✅ CSS extracted to separate file
- ✅ Modular architecture established

**Phase 2** (Next):
- ⏳ Extract core modules (orders, products, customers)
- ⏳ Extract communication modules (email, broadcast, WhatsApp)
- ⏳ Extract system modules (analytics, reports, settings)

**Phase 3** (Future):
- ⏳ Complete migration to dashboard-modular.html
- ⏳ Deprecate legacy dashboard.html
- ⏳ Add unit tests
- ⏳ Add TypeScript definitions

## 🎨 Styling

Styles are now in `/css/dashboard.css`:
- Organized by component
- BEM naming convention
- Mobile-first responsive
- Dark theme optimized
- Print-friendly

## 📦 Dependencies

**External:**
- Tailwind CSS (utility classes)
- Chart.js (analytics charts)
- XLSX.js (Excel export)
- Font Awesome (icons)

**Internal:**
- No jQuery (vanilla JavaScript)
- ES6 modules (no bundler required)
- Modern browser APIs

## 🔧 Development

### Running Locally

```bash
# Start server
node index.js

# Dashboard available at
http://localhost:3000/dashboard-modular.html

# Legacy dashboard (for compatibility)
http://localhost:3000/dashboard.html
```

### File Watching

For development, use a simple file watcher:
```bash
# Install nodemon (if not already)
npm install -g nodemon

# Run with auto-restart
nodemon index.js
```

### Debugging

1. **Check Browser Console** - All modules log to console
2. **Check Network Tab** - API calls are visible
3. **Check State** - Run `window.state.state` in console
4. **Check Router** - Run `window.router` in console

## 📝 Best Practices

### Code Style

```javascript
// ✅ Good: ES6 modules
import { fsmAPI } from './utils/api.js';

// ❌ Bad: Global variables
window.myFunction = () => {};

// ✅ Good: Async/await
const data = await fsmAPI.getVisits();

// ❌ Bad: Callbacks
fsmAPI.getVisits((data) => { ... });

// ✅ Good: Template literals
const html = `<div>${escapeHtml(name)}</div>`;

// ❌ Bad: String concatenation
const html = '<div>' + name + '</div>';
```

### Error Handling

```javascript
// ✅ Good: Try-catch with user feedback
try {
    const data = await fsmAPI.getVisits();
    state.set('data.visits', data);
} catch (error) {
    console.error('Error loading visits:', error);
    showNotification('Failed to load visits', 'error');
}

// ❌ Bad: Silent failures
const data = await fsmAPI.getVisits();
```

### Performance

```javascript
// ✅ Good: Debounced search
const search = debounce((query) => {
    loadVisits({ search: query });
}, 300);

// ❌ Bad: Search on every keystroke
input.addEventListener('keyup', (e) => {
    loadVisits({ search: e.target.value });
});
```

## 🐛 Common Issues

### Module not found
- Check file path in import statement
- Ensure file exists
- Check case sensitivity

### State not updating
- Use `state.set()` instead of direct assignment
- Subscribe to state changes
- Check console for errors

### API not working
- Check network tab for request
- Verify endpoint exists in backend
- Check for CORS issues

## 📚 Further Reading

- [ES6 Modules](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules)
- [Fetch API](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API)
- [Async/Await](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/async_function)
- [State Management](https://kentcdodds.com/blog/application-state-management-with-react)

## 📞 Support

For questions or issues:
1. Check this README
2. Check console for errors
3. Review module code
4. Contact development team

---

**Version**: 2.0.0 (Modular)  
**Last Updated**: January 16, 2026  
**Maintained by**: Salesmate Development Team
