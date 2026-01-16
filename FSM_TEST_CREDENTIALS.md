# FSM Role-Based Access Test Credentials

## How the System Works

The system determines user role based on the login phone number:
- If the phone matches a **salesman** in the FSM database → **Salesman Role** (sees only own visits)
- If the phone is a **tenant owner** (not in salesmen table) → **Super Admin Role** (sees all data)
- Future: Plant Admin role for users assigned to specific plants

## Test Credentials

### 1. SUPER ADMIN (Full Access - All Plants)
**Login:** Dashboard at https://salesmate.saksolution.com/login.html
- **Phone:** `918484862949` (or `8484862949`)
- **Password:** `5253`
- **Access Level:** Sees ALL visits from ALL 9 plants/branches
- **Role Indicator:** "Access Level: Super Admin - All Plants Access"

### 2. SALESMAN (Personal Visits Only)
**Login:** Dashboard at https://salesmate.saksolution.com/login.html
- **Phone:** `919730965552` (or `9730965552`)
- **Password:** Need to add - currently no password set
- **Name:** Abbas Rangoonwala
- **Plant:** Hylite Galvanisers Pimpri - HGP
- **Access Level:** Sees ONLY his own visits
- **Role Indicator:** "Access Level: Salesman - Personal Visits Only"

**Alternative Salesman:**
- **Phone:** `919766748786`
- **Name:** Mudar Sanchawala
- **Plant:** 423fb7c8-51d0-47f5-8bc5-2fdc0e4f8695

### 3. PLANT ADMIN (Future Implementation)
Currently not implemented. Would require:
- Adding `role` column to users/salesmen table
- Setting role = 'plant_admin' for specific users
- User would see all visits from their assigned plant only

## Current Salesmen in Database (24 total across 9 plants)

### Plant: 091d5b41-529a-429f-9e78-a21e423ca4a1 (4 salesmen)
- Murtaza R - 1110558254
- Remon Nagy - 1287417417
- Amira - 1100598936
- Mohammad Yahya - 1099880582

### Plant: daf4f8ab-bd64-40e4-8a60-5d9e9fdf56b4 (4 salesmen)
- Ahmed Sabr - 1062419870
- Ahmed Hassan - 1032833937
- Murtaza Rangwala - 1222538476
- Abu Mansour - 1227670286

### Plant: 2e177bea-cc42-463a-a9ed-dcf1b6ebd50b (3 salesmen)
- Fatema Bawaji - 9766194752
- Burhanuddin Rangwala - 9890777102
- Sarrah Sanchawala - 8888450842

### Plant: 423fb7c8-51d0-47f5-8bc5-2fdc0e4f8695 (2 salesmen)
- Mudar Sanchawala - 9766748786
- ADMIN - 1234567890

### Plant: 5d3b1922-ea5d-48f0-a15a-896cc1a97670 (2 salesmen)
- Alok - 8600259300
- Yusuf Bootwala - 9769395452

### Plant: 9a95512f-9c72-4de1-864e-0219c44b8ea3 (2 salesmen)
- Hamza Bootwala - 9819370256
- Kiran Kamble - 9137783276

### Plant: Hylite Galvanisers Pimpri - HGP (1 salesman)
- Abbas Rangoonwala - 9730965552

### Plant: f2e18b86-6960-45b9-9a2a-dae18350de4c (1 salesman)
- Murtaza Bootwala - 9359338856

### Plant: 6921c457-066b-4cd7-a8ea-fa41199eb33a (1 salesman)
- Abdel Ghany - 1025544999

### Unassigned (no plant) (3 salesmen)
- hussain - 7737835253
- abbas sales - 8530499971
- Demo Salesman - 8484830022
- Mufaddal - +201289993815

## Setting Up Password for Salesmen Login

To enable salesmen to login directly:

```sql
-- Add password to tenants for salesman phone numbers
-- Currently only the main tenant has a password
-- Need to either:
-- 1. Create separate tenant records for each salesman, OR
-- 2. Add a users table with salesman login credentials
```

## Testing Each Role

### Test Super Admin:
1. Login with phone: `918484862949`, password: `5253`
2. Go to Field Sales → Visits
3. Should see "Access Level: Super Admin - All Plants Access"
4. Should see all 307 visits
5. Can filter by any plant or salesman

### Test Salesman (when implemented):
1. Login with salesman's phone number
2. Go to Field Sales → Visits
3. Should see "Access Level: Salesman - Personal Visits Only"
4. Should see ONLY visits made by this salesman
5. Cannot filter by other salesmen (filter disabled)

### Test Plant Admin (future):
1. Assign role='plant_admin' and plant_id to a user
2. Login with that user
3. Should see "Access Level: Plant Admin - [Plant Name]"
4. Should see only visits from their assigned plant
5. Can filter salesmen within their plant

## Database Schema

### Current Tables:
- `tenants` - Main account (has password for dashboard login)
- `salesmen` - FSM salesmen (linked to plants, no password currently)
- `visits` - Visit records with salesman_id and plant_id

### Role Detection Logic:
```javascript
// In /api/fsm/user/profile endpoint:
if (phone matches salesman) → role = 'salesman'
else → role = 'super_admin' (default for tenant owner)
```

## Next Steps to Enable Full Role System

1. **Add Users Table** with columns:
   - id, phone, password_hash, role ('super_admin', 'plant_admin', 'salesman')
   - plant_id (for plant_admin)
   - salesman_id (link to salesmen table)

2. **Update Login Endpoint** to check users table first, then tenants

3. **Add Plant Admin Management UI** in Settings to assign users to plants

4. **Add Salesman Login Portal** separate from main dashboard
