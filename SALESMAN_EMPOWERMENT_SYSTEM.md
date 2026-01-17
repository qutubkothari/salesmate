# Salesman Empowerment System
## Complete Architecture for Mobile App, Desktop App & Dashboard

---

## 🎯 **OVERVIEW**

A comprehensive system to empower salesmen with real-time data, offline capabilities, and intelligent insights across mobile, desktop, and web platforms.

---

## 📱 **MOBILE APP (React Native)**

### **Core Features**

#### 1. **Daily Dashboard**
- Today's schedule & targets
- Pending visits
- Route optimization
- Real-time sync indicator
- Quick actions (Check-in, Add Visit, Call Customer)

#### 2. **Visit Management**
- **Check-in/Check-out**: GPS-based with photo capture
- **Visit Form**: Customer details, visit type, duration tracking
- **Offline Mode**: Queue visits for sync when back online
- **Product Catalog**: Browse products, check inventory, show samples
- **Order Taking**: Create orders on-the-spot with signature capture
- **Payment Collection**: Record cash/cheque/online payments
- **Follow-ups**: Schedule next visit, set reminders

#### 3. **Customer Management**
- **Customer List**: Search, filter by location/potential
- **Customer Profile**: 
  - Contact info with click-to-call/WhatsApp
  - Order history
  - Payment status
  - Visit history
  - Credit limit & outstanding
- **Add New Customer**: Capture details, GPS location, photos
- **Customer Notes**: Voice notes, text notes, photos

#### 4. **Target Tracking**
- **Monthly Targets**: Visits, orders, revenue
- **Daily Progress**: Visual progress bars
- **Leaderboard**: Compare with team members
- **Achievements**: Badges & milestones

#### 5. **Route Planning**
- **Map View**: All customers on map
- **Route Optimization**: AI-suggested route for the day
- **Navigation**: Integrated Google Maps
- **Nearby Customers**: Discover customers near current location

#### 6. **Inventory & Products**
- **Product Catalog**: Search, filter, sort
- **Stock Availability**: Real-time stock levels
- **Price Lists**: Customer-specific pricing
- **Product Images**: High-quality product photos
- **Share Products**: WhatsApp share with customers

#### 7. **Reports & Analytics**
- **Daily Summary**: Visits, orders, revenue
- **Weekly Performance**: Charts & graphs
- **Customer Insights**: Top customers, pending orders
- **Expense Tracking**: Travel, meals, other expenses

#### 8. **Communication**
- **In-App Chat**: With manager & team
- **Announcements**: Company news, target updates
- **Notifications**: Task reminders, order status, target alerts

### **Technical Stack (Mobile App)**
```
Framework: React Native (iOS + Android)
State Management: Redux Toolkit
Offline Storage: React Native SQLite Storage
Maps: React Native Maps
Camera: React Native Camera
Location: React Native Geolocation
Push Notifications: Firebase Cloud Messaging
API: Axios with offline queue
Authentication: JWT with biometric support
```

### **Offline Capabilities**
- Store last 30 days of data locally
- Queue all creates/updates when offline
- Sync automatically when online
- Conflict resolution (server wins, log conflicts)
- Visual indicator of sync status

---

## 💻 **DESKTOP APP (Electron)**

### **Core Features**

#### 1. **Enhanced Dashboard**
- **Multi-monitor Support**: Drag widgets across screens
- **Real-time Updates**: WebSocket connections
- **Widget Library**:
  - Today's Schedule
  - Target Progress
  - Top Customers
  - Recent Orders
  - Team Performance
  - Map View
  - Activity Feed

#### 2. **Visit Planning & Management**
- **Calendar View**: Week/Month view of scheduled visits
- **Drag & Drop**: Reschedule visits easily
- **Bulk Actions**: Schedule multiple visits
- **Visit Templates**: Pre-fill common visit types
- **Print Visit Reports**: PDF generation

#### 3. **Advanced Analytics**
- **Custom Reports**: Build your own reports
- **Data Export**: Excel, PDF, CSV
- **Trend Analysis**: Historical performance
- **Forecasting**: AI-powered sales predictions
- **Territory Analysis**: Heat maps, coverage analysis

#### 4. **CRM Integration**
- **Customer 360 View**: Complete customer profile
- **Email Integration**: Send quotes, invoices
- **Document Management**: Upload/download documents
- **Activity Timeline**: All interactions in one view

#### 5. **Order Management**
- **Quick Order Entry**: Keyboard shortcuts
- **Price Calculator**: Real-time pricing with discounts
- **Inventory Check**: Before order confirmation
- **Order Tracking**: Status updates
- **Invoice Generation**: Print or email invoices

#### 6. **Offline Desktop Mode**
- **Local Database**: SQLite for offline work
- **Background Sync**: Automatic when online
- **Change Log**: Track all offline changes
- **Conflict Resolution UI**: Review and resolve conflicts

### **Technical Stack (Desktop App)**
```
Framework: Electron
Frontend: React + Tailwind CSS
State: Redux Toolkit + Redux Persist
Database: SQLite (embedded)
API: Axios with retry logic
Charts: Chart.js
PDF: jsPDF
Excel: ExcelJS
Auto-Update: electron-updater
```

---

## 🌐 **WEB DASHBOARD (Already Implemented)**

### **Enhanced Salesman View**
Add new sections to existing dashboard for salesman role:

#### 1. **My Performance Tab**
- Personal targets vs achievements
- Visit statistics
- Revenue generated
- Commission calculator
- Rank in team

#### 2. **My Customers Tab**
- Customer list with advanced filters
- Quick actions (Call, WhatsApp, Email, Schedule Visit)
- Customer analytics
- Payment reminders

#### 3. **My Schedule Tab**
- Calendar view of visits
- Today's agenda
- Route planning
- Time tracking

#### 4. **My Orders Tab**
- Order history
- Pending orders
- Order tracking
- Quick reorder

---

## 🔑 **KEY INFORMATION FOR SALESMEN**

### **What Salesmen Need to See:**

1. **Target Information**
   - Monthly visit target
   - Monthly revenue target
   - Current achievement %
   - Days remaining in month
   - Daily run rate needed

2. **Customer Information**
   - Customer name, business name
   - Phone, WhatsApp, email
   - Address with GPS coordinates
   - Last visit date & details
   - Last order date & amount
   - Outstanding payments
   - Credit limit & available credit
   - Customer potential (High/Medium/Low)
   - Preferred contact time
   - Birthday/anniversary

3. **Visit Information**
   - Scheduled vs completed visits
   - Visit duration tracking
   - Visit outcomes (Order, Follow-up, No Interest)
   - Products discussed
   - Customer feedback
   - Next action required
   - Photos taken during visit

4. **Product Information**
   - Product catalog with images
   - Current stock levels
   - Pricing (list price, dealer price, distributor price)
   - Customer-specific pricing
   - Product specifications
   - Competitor comparison
   - Demo availability

5. **Order Information**
   - Order history
   - Pending orders
   - Order status (Pending, Confirmed, Dispatched, Delivered)
   - Invoice details
   - Payment status
   - Delivery tracking

6. **Performance Metrics**
   - Daily/Weekly/Monthly visits
   - Conversion rate (visits to orders)
   - Average order value
   - Revenue generated
   - Customer retention rate
   - New customers acquired
   - Leaderboard ranking

7. **Route & Territory Info**
   - Assigned territory boundaries
   - Customers on map
   - Optimal route for the day
   - Travel time estimates
   - Nearby opportunities

8. **Commission & Earnings**
   - Commission structure
   - Earned commissions
   - Pending commissions
   - Payment schedule
   - Incentive schemes

---

## 🗄️ **DATABASE SCHEMA UPDATES**

### **New Tables Needed:**

```sql
-- Salesman App Sessions (for sync tracking)
CREATE TABLE salesman_sessions (
    id TEXT PRIMARY KEY,
    salesman_id TEXT NOT NULL,
    device_type TEXT NOT NULL, -- mobile, desktop, web
    device_id TEXT NOT NULL,
    last_sync_at TEXT,
    app_version TEXT,
    platform TEXT, -- ios, android, windows, mac, linux
    is_online INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (salesman_id) REFERENCES salesmen(id)
);

-- Offline Queue (for syncing offline changes)
CREATE TABLE offline_queue (
    id TEXT PRIMARY KEY,
    salesman_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    entity_type TEXT NOT NULL, -- visit, customer, order
    entity_id TEXT,
    action TEXT NOT NULL, -- create, update, delete
    data TEXT NOT NULL, -- JSON payload
    created_at TEXT DEFAULT (datetime('now')),
    synced INTEGER DEFAULT 0,
    synced_at TEXT,
    error TEXT,
    FOREIGN KEY (salesman_id) REFERENCES salesmen(id)
);

-- Customer Locations (for route planning)
CREATE TABLE customer_locations (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    address TEXT,
    is_verified INTEGER DEFAULT 0,
    verified_by TEXT, -- salesman_id who verified
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Visit Photos
CREATE TABLE visit_photos (
    id TEXT PRIMARY KEY,
    visit_id TEXT NOT NULL,
    photo_url TEXT NOT NULL,
    photo_type TEXT, -- checkin, checkout, product, other
    caption TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (visit_id) REFERENCES visits(id)
);

-- Salesman Expenses
CREATE TABLE salesman_expenses (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    salesman_id TEXT NOT NULL,
    expense_date TEXT NOT NULL,
    expense_type TEXT NOT NULL, -- travel, meals, accommodation, other
    amount REAL NOT NULL,
    description TEXT,
    receipt_url TEXT,
    visit_id TEXT, -- link to visit if applicable
    status TEXT DEFAULT 'pending', -- pending, approved, rejected
    approved_by TEXT,
    approved_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (salesman_id) REFERENCES salesmen(id),
    FOREIGN KEY (visit_id) REFERENCES visits(id)
);

-- Customer Notes
CREATE TABLE customer_notes (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    customer_id TEXT NOT NULL,
    salesman_id TEXT NOT NULL,
    note_type TEXT DEFAULT 'text', -- text, voice, photo
    note_text TEXT,
    file_url TEXT, -- for voice notes or photos
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (salesman_id) REFERENCES salesmen(id)
);

-- Route Plans
CREATE TABLE route_plans (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    salesman_id TEXT NOT NULL,
    plan_date TEXT NOT NULL,
    customer_sequence TEXT NOT NULL, -- JSON array of customer IDs in order
    total_distance REAL,
    estimated_duration INTEGER, -- minutes
    status TEXT DEFAULT 'planned', -- planned, in-progress, completed
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (salesman_id) REFERENCES salesmen(id)
);

-- Commission Structure
CREATE TABLE commission_structure (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    salesman_id TEXT,
    product_category TEXT,
    commission_type TEXT NOT NULL, -- percentage, fixed
    commission_value REAL NOT NULL,
    min_order_value REAL,
    effective_from TEXT NOT NULL,
    effective_to TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Salesman Commissions (calculated)
CREATE TABLE salesman_commissions (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    salesman_id TEXT NOT NULL,
    order_id TEXT NOT NULL,
    commission_amount REAL NOT NULL,
    status TEXT DEFAULT 'pending', -- pending, paid
    paid_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (salesman_id) REFERENCES salesmen(id)
);
```

---

## 🔌 **API ENDPOINTS NEEDED**

### **Mobile/Desktop Specific APIs:**

```javascript
// Sync APIs
GET  /api/fsm/salesman/:id/sync-data?last_sync_timestamp
POST /api/fsm/salesman/:id/sync-upload (bulk upload offline data)

// Route Planning
GET  /api/fsm/salesman/:id/route-plan?date
POST /api/fsm/salesman/:id/route-plan
GET  /api/fsm/salesman/:id/nearby-customers?lat&lng&radius

// Customer Management
GET  /api/fsm/salesman/:id/customers
GET  /api/fsm/customers/:id/full-profile
POST /api/fsm/customers/:id/notes
GET  /api/fsm/customers/:id/notes

// Visit Management
POST /api/fsm/visits/checkin
POST /api/fsm/visits/checkout
POST /api/fsm/visits/:id/photos
GET  /api/fsm/salesman/:id/today-visits

// Orders
POST /api/fsm/orders (create order from mobile/desktop)
GET  /api/fsm/salesman/:id/orders
GET  /api/fsm/orders/:id/invoice

// Expenses
GET  /api/fsm/salesman/:id/expenses
POST /api/fsm/expenses
PUT  /api/fsm/expenses/:id

// Commission
GET  /api/fsm/salesman/:id/commissions
GET  /api/fsm/salesman/:id/commission-summary

// Analytics
GET  /api/fsm/salesman/:id/dashboard-stats
GET  /api/fsm/salesman/:id/performance?start_date&end_date
GET  /api/fsm/salesman/:id/leaderboard
```

---

## 📋 **IMPLEMENTATION PHASES**

### **Phase 1: Foundation (Week 1-2)**
1. ✅ Database schema updates (run migrations)
2. ✅ Core API endpoints for salesman data
3. ✅ Authentication for salesman role
4. ✅ Sync mechanism design

### **Phase 2: Web Dashboard Enhancement (Week 2-3)**
1. Add "My Performance" tab
2. Add "My Customers" tab with enhanced view
3. Add "My Schedule" calendar view
4. Add commission calculator

### **Phase 3: Mobile App MVP (Week 3-6)**
1. React Native project setup
2. Login & authentication
3. Dashboard screen
4. Visit check-in/checkout
5. Customer list & profile
6. Offline mode basic implementation
7. Photo capture & upload

### **Phase 4: Desktop App MVP (Week 6-8)**
1. Electron setup with React
2. Dashboard with widgets
3. Visit planning calendar
4. Advanced reporting
5. Offline database sync

### **Phase 5: Advanced Features (Week 8-12)**
1. Route optimization AI
2. Product recommendations
3. Voice notes
4. Real-time notifications
5. Advanced analytics
6. Commission tracking

---

## 🚀 **IMMEDIATE NEXT STEPS**

1. **Run database migrations** to add new tables
2. **Create API endpoints** for salesman-specific data
3. **Enhance web dashboard** with salesman view
4. **Set up React Native project** for mobile app
5. **Set up Electron project** for desktop app

---

## 📊 **SUCCESS METRICS**

- **Adoption Rate**: 90% of salesmen using app daily within 3 months
- **Visit Completion**: 95% of scheduled visits completed
- **Order Conversion**: 30% increase in visit-to-order conversion
- **Data Accuracy**: 98% GPS-verified visits
- **Response Time**: < 2 sec for all app interactions
- **Offline Capability**: 100% functionality available offline
- **Sync Success**: 99% successful syncs within 5 minutes of coming online

---

## 🎨 **UI/UX PRINCIPLES**

1. **Mobile-First**: Design for thumbs, big touch targets
2. **Dark Mode**: Battery saving for field use
3. **Minimal Data Usage**: Compress images, cache aggressively
4. **Quick Actions**: Most common tasks within 2 taps
5. **Voice Input**: For notes while driving
6. **Offline-First**: Works perfectly without internet
7. **GPS Accuracy**: Use high-accuracy mode for check-ins

---

**Ready to start implementation?** Let me know which phase you'd like to begin with!
