/**
 * @title Service Configuration
 * @description Initializes and exports clients for external services like Supabase, OpenAI, and Google Cloud Storage.
 * Compatible with local .env and GAE env vars. Additive, backward-compatible.
 * Supports both local SQLite and Supabase databases.
 */

require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');
const { Storage } = require('@google-cloud/storage');
const path = require('path');

const dbg = (...a) => { if (process.env.DEBUG_CONFIG === '1') console.log('[CONFIG]', ...a); };

// ---------- Database Configuration (Local SQLite or Supabase) ----------
const USE_LOCAL_DB = process.env.USE_LOCAL_DB === 'true';

let supabase;
let db;

if (USE_LOCAL_DB) {
  // Use local SQLite
  dbg('Database: using LOCAL SQLite');
  
  const Database = require('better-sqlite3');
  const dbPath = path.join(__dirname, '..', 'local-database.db');
  
  try {
    db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
    console.log('[CONFIG] Local SQLite configured:', dbPath);

    // Ensure required schema exists for local mode (non-destructive)
    try {
      ensureSqliteSchema(db);
    } catch (e) {
      console.warn('[CONFIG] SQLite schema ensure skipped/failed:', e?.message || e);
    }
    
    // Create a Supabase-compatible wrapper for the local DB
    supabase = createLocalDbWrapper(db);
  } catch (error) {
    console.error('[CONFIG] Failed to initialize SQLite:', error.message);
    console.error('[CONFIG] Please run: node setup-sqlite-db.js');
    throw error;
  }
  
} else {
  // Use Supabase
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase URL and Key must be provided in environment variables when USE_LOCAL_DB is false.');
  }
  dbg('Supabase: using', supabaseKey === process.env.SUPABASE_SERVICE_ROLE_KEY ? 'SERVICE_ROLE_KEY' : 'ANON_KEY');
  
  supabase = createClient(supabaseUrl, supabaseKey);
}

// Create a wrapper to make local SQLite work like Supabase client
function createLocalDbWrapper(dbInstance) {
  return {
    from: (table) => {
      const queryBuilder = {
        _table: table,
        _columns: '*',
        _wheres: [],
        _orFilters: null,
        _limit: null,
        _offset: null,
        _single: false,
        _maybeSingle: false,
        _insert: null,
        _update: null,
        _delete: false,
        
        select: function(columns = '*') {
          this._columns = columns;
          return this;
        },
        
        eq: function(column, value) {
          this._wheres.push({ column, operator: '=', value });
          return this;
        },
        
        neq: function(column, value) {
          this._wheres.push({ column, operator: '!=', value });
          return this;
        },
        
        gt: function(column, value) {
          this._wheres.push({ column, operator: '>', value });
          return this;
        },
        
        gte: function(column, value) {
          this._wheres.push({ column, operator: '>=', value });
          return this;
        },
        
        lt: function(column, value) {
          this._wheres.push({ column, operator: '<', value });
          return this;
        },
        
        lte: function(column, value) {
          this._wheres.push({ column, operator: '<=', value });
          return this;
        },
        
        like: function(column, value) {
          this._wheres.push({ column, operator: 'LIKE', value });
          return this;
        },
        
        ilike: function(column, value) {
          this._wheres.push({ column, operator: 'LIKE', value });
          return this;
        },
        
        is: function(column, value) {
          this._wheres.push({ column, operator: 'IS', value });
          return this;
        },
        
        in: function(column, values) {
          this._wheres.push({ column, operator: 'IN', value: values });
          return this;
        },
        
        not: function(column, operator, value) {
          const op = String(operator || '').trim().toUpperCase();
          // Supabase style: .not('col', 'is', null) => SQL: col IS NOT NULL
          if (op === 'IS') {
            this._wheres.push({ column, operator: 'IS NOT', value });
          } else if (op === 'IN') {
            this._wheres.push({ column, operator: 'NOT IN', value });
          } else if (op) {
            this._wheres.push({ column, operator: 'NOT ' + op, value });
          } else {
            this._wheres.push({ column, operator: 'IS NOT', value });
          }
          return this;
        },
        
        or: function(filters) {
          this._orFilters = filters;
          return this;
        },

        range: function(from, to) {
          const start = Math.max(0, parseInt(from ?? 0, 10) || 0);
          const end = Math.max(start, parseInt(to ?? start, 10) || start);
          this._offset = start;
          this._limit = (end - start + 1);
          return this;
        },
        
        limit: function(count) {
          this._limit = count;
          return this;
        },
        
        order: function(column, options = {}) {
          this._order = { column, ...options };
          return this;
        },
        
        single: function() {
          this._single = true;
          this._maybeSingle = false;
          this._limit = 1;
          return this;
        },

        maybeSingle: function() {
          this._single = true;
          this._maybeSingle = true;
          this._limit = 1;
          return this;
        },
        
        insert: function(data) {
          // Convert arrays and objects to JSON strings for SQLite
          const processedData = Array.isArray(data) ? data.map(row => this._processDataTypes(row)) : this._processDataTypes(data);
          this._insert = processedData;
          return this;
        },
        
        _processDataTypes: function(data) {
          if (!data || typeof data !== 'object') return data;
          const processed = {};
          for (const [key, value] of Object.entries(data)) {
            if (value === undefined) {
              processed[key] = null;
            } else if (value === null) {
              processed[key] = null;
            } else if (Array.isArray(value) || (typeof value === 'object' && !(value instanceof Date) && !(value instanceof Buffer))) {
              processed[key] = JSON.stringify(value);
            } else if (value instanceof Date) {
              processed[key] = value.toISOString();
            } else if (typeof value === 'boolean') {
              processed[key] = value ? 1 : 0;
            } else {
              processed[key] = value;
            }
          }
          return processed;
        },
        
        update: function(data) {
          this._update = this._processDataTypes(data);
          return this;
        },
        
        delete: function() {
          this._delete = true;
          return this;
        },
        
        then: async function(resolve, reject) {
          try {
            let result;
            
            if (this._insert) {
              // INSERT operation - data is already processed by insert() method
              // Support both single-row and multi-row inserts.
              const rowsToInsert = Array.isArray(this._insert) ? this._insert : [this._insert];
              if (rowsToInsert.length === 0) {
                result = { data: this._single ? null : [], error: null };
              } else {
                const keys = Object.keys(rowsToInsert[0] || {});
                const placeholders = keys.map(() => '?').join(', ');
                const query = `INSERT INTO ${this._table} (${keys.join(', ')}) VALUES (${placeholders})`;
                const stmt = dbInstance.prepare(query);
                const selectStmt = dbInstance.prepare(`SELECT * FROM ${this._table} WHERE rowid = ?`);

                const insertMany = dbInstance.transaction((rows) => {
                  const rowIds = [];
                  for (const row of rows) {
                    const values = keys.map((key) => (row && Object.prototype.hasOwnProperty.call(row, key)) ? row[key] : null);

                    // Debug: Check for invalid types
                    values.forEach((val, idx) => {
                      const validTypes = ['string', 'number', 'bigint'];
                      if (val !== null && !validTypes.includes(typeof val) && !(val instanceof Buffer)) {
                        console.error(`[SQLite] Invalid value type for key '${keys[idx]}':`, typeof val, val);
                      }
                    });

                    const info = stmt.run(...values);
                    rowIds.push(info.lastInsertRowid);
                  }
                  return rowIds;
                });

                const insertedRowIds = insertMany(rowsToInsert);
                const insertedRows = insertedRowIds
                  .map((rid) => selectStmt.get(rid))
                  .filter(Boolean);

                result = { data: this._single ? (insertedRows[0] || null) : insertedRows, error: null };
              }
              
            } else if (this._update) {
              // UPDATE operation - data is already processed by update() method
              const keys = Object.keys(this._update);
              const values = keys.map(key => this._update[key]); // Use mapped values to preserve order
              const setClause = keys.map(key => `${key} = ?`).join(', ');
              
              let whereClause = '';
              const whereValues = [];
              if (this._wheres.length > 0) {
                whereClause = ' WHERE ' + this._wheres.map(w => {
                  whereValues.push(w.value);
                  return `${w.column} ${w.operator} ?`;
                }).join(' AND ');
              }
              
              const query = `UPDATE ${this._table} SET ${setClause}${whereClause}`;
              const stmt = dbInstance.prepare(query);
              stmt.run(...values, ...whereValues);
              
              // Get updated rows
              const selectQuery = `SELECT * FROM ${this._table}${whereClause}`;
              const selectStmt = dbInstance.prepare(selectQuery);
              const rows = whereValues.length > 0 ? selectStmt.all(...whereValues) : selectStmt.all();
              result = { data: this._single ? (rows[0] || null) : rows, error: null };
              
            } else if (this._delete) {
              // DELETE operation
              let whereClause = '';
              const whereValues = [];
              if (this._wheres.length > 0) {
                whereClause = ' WHERE ' + this._wheres.map(w => {
                  whereValues.push(w.value);
                  return `${w.column} ${w.operator} ?`;
                }).join(' AND ');
              }
              
              const query = `DELETE FROM ${this._table}${whereClause}`;
              const stmt = dbInstance.prepare(query);
              stmt.run(...whereValues);
              result = { data: null, error: null };
              
            } else {
              // SELECT operation
              let query = `SELECT ${this._columns} FROM ${this._table}`;
              const values = [];

              const clauses = [];
              // AND clauses
              if (this._wheres.length > 0) {
                const andClause = this._wheres.map(w => {
                  if (w.operator === 'IN') {
                    const placeholders = (w.value || []).map(() => '?').join(', ');
                    values.push(...(w.value || []));
                    return `${w.column} IN (${placeholders})`;
                  }
                  values.push(w.value);
                  return `${w.column} ${w.operator} ?`;
                }).join(' AND ');
                clauses.push(`(${andClause})`);
              }

              // OR clauses (Supabase format: col.op.value,col.op.value,...)
              if (this._orFilters) {
                const orParts = String(this._orFilters)
                  .split(',')
                  .map(s => s.trim())
                  .filter(Boolean)
                  .map(cond => {
                    const firstDot = cond.indexOf('.');
                    const secondDot = firstDot >= 0 ? cond.indexOf('.', firstDot + 1) : -1;
                    if (firstDot < 0 || secondDot < 0) return null;

                    const col = cond.slice(0, firstDot);
                    const op = cond.slice(firstDot + 1, secondDot);
                    const rawVal = cond.slice(secondDot + 1);

                    // Supabase encodes % as literal %, keep as-is
                    if (op === 'ilike') {
                      values.push(rawVal);
                      return `LOWER(${col}) LIKE LOWER(?)`;
                    }
                    if (op === 'like') {
                      values.push(rawVal);
                      return `${col} LIKE ?`;
                    }
                    if (op === 'eq') {
                      values.push(rawVal);
                      return `${col} = ?`;
                    }
                    if (op === 'neq') {
                      values.push(rawVal);
                      return `${col} != ?`;
                    }
                    if (op === 'gt') {
                      values.push(rawVal);
                      return `${col} > ?`;
                    }
                    if (op === 'gte') {
                      values.push(rawVal);
                      return `${col} >= ?`;
                    }
                    if (op === 'lt') {
                      values.push(rawVal);
                      return `${col} < ?`;
                    }
                    if (op === 'lte') {
                      values.push(rawVal);
                      return `${col} <= ?`;
                    }
                    if (op === 'is') {
                      // special-case NULL
                      if (rawVal === 'null') return `${col} IS NULL`;
                      return `${col} IS ${rawVal}`;
                    }
                    // Unknown op: ignore
                    return null;
                  })
                  .filter(Boolean);

                if (orParts.length > 0) {
                  clauses.push(`(${orParts.join(' OR ')})`);
                }
              }

              if (clauses.length > 0) {
                query += ` WHERE ${clauses.join(' AND ')}`;
              }
              
              if (this._order) {
                const direction = this._order.ascending === false ? 'DESC' : 'ASC';
                query += ` ORDER BY ${this._order.column} ${direction}`;
              }
              
              if (this._limit) {
                query += ` LIMIT ${this._limit}`;
              }

              if (this._offset) {
                query += ` OFFSET ${this._offset}`;
              }
              
              const stmt = dbInstance.prepare(query);
              const rows = values.length > 0 ? stmt.all(...values) : stmt.all();
              
              if (this._single) {
                if (rows[0]) {
                  result = { data: rows[0], error: null };
                } else if (this._maybeSingle) {
                  result = { data: null, error: null };
                } else {
                  result = { data: null, error: { message: 'No rows found', code: 'PGRST116' } };
                }
              } else {
                result = { data: rows, error: null };
              }
            }
            
            resolve(result);
          } catch (error) {
            console.error('[SQLite] Query error:', error.message);
            // Supabase-js does not throw on query errors; it resolves with { data, error }.
            // Many call sites expect `const { error } = await ...` and handle it explicitly.
            if (typeof resolve === 'function') {
              resolve({ data: null, error });
            } else if (typeof reject === 'function') {
              reject({ data: null, error });
            }
          }
        }
      };
      
      return queryBuilder;
    },
    
    rpc: async (functionName, params) => {
      console.warn('[SQLite] RPC functions not supported in local mode:', functionName);
      return { data: null, error: { message: 'RPC not supported in SQLite mode' } };
    }
  };
}

function ensureSqliteSchema(dbInstance) {
  // Non-destructive schema creation/patches for local development.
  // Keeps this minimal: create missing tables and add missing columns used by dashboard/routes.
  const exec = (sql) => dbInstance.exec(sql);

  const tableInfoEarly = (tableName) => {
    try {
      return dbInstance.prepare(`PRAGMA table_info(${tableName})`).all();
    } catch {
      return [];
    }
  };

  const hasColumnEarly = (tableName, columnName) => {
    const info = tableInfoEarly(tableName);
    return info.some((c) => c && c.name === columnName);
  };

  const addColumnIfMissingEarly = (tableName, columnName, columnTypeSql) => {
    if (hasColumnEarly(tableName, columnName)) return;
    exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnTypeSql};`);
  };

  exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT DEFAULT (DATETIME('now')),
      updated_at TEXT DEFAULT (DATETIME('now')),
      UNIQUE(tenant_id, name)
    );
  `);

  exec(`
    CREATE TABLE IF NOT EXISTS crawl_jobs (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      tenant_id TEXT NOT NULL,
      url TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      error_message TEXT,
      pages_crawled INTEGER DEFAULT 0,
      chunks_created INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (DATETIME('now')),
      completed_at TEXT
    );
  `);

  // Website embeddings/content chunks (used by Website Indexing + bot retrieval)
  // Keep compatibility with the existing minimal table (content/source_url/metadata).
  exec(`
    CREATE TABLE IF NOT EXISTS website_embeddings (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      tenant_id TEXT NOT NULL,
      content TEXT NOT NULL,
      embedding TEXT,
      metadata TEXT DEFAULT '{}',
      source_url TEXT,
      created_at TEXT DEFAULT (DATETIME('now'))
    );
  `);

  // Add columns expected by website crawling/search code.
  addColumnIfMissingEarly('website_embeddings', 'url', 'TEXT');
  addColumnIfMissingEarly('website_embeddings', 'page_title', 'TEXT');
  addColumnIfMissingEarly('website_embeddings', 'content_type', "TEXT DEFAULT 'general'");
  addColumnIfMissingEarly('website_embeddings', 'original_content', 'TEXT');
  addColumnIfMissingEarly('website_embeddings', 'chunk_text', 'TEXT');
  addColumnIfMissingEarly('website_embeddings', 'chunk_index', 'INTEGER DEFAULT 0');
  addColumnIfMissingEarly('website_embeddings', 'product_codes', "TEXT DEFAULT '[]'");
  addColumnIfMissingEarly('website_embeddings', 'keywords', "TEXT DEFAULT '[]'");
  addColumnIfMissingEarly('website_embeddings', 'status', "TEXT DEFAULT 'active'");
  addColumnIfMissingEarly('website_embeddings', 'crawl_date', 'TEXT');
  addColumnIfMissingEarly('website_embeddings', 'last_updated', 'TEXT');

  // Best-effort backfill to make existing rows show up in lists/search.
  try {
    exec(`UPDATE website_embeddings SET url = COALESCE(url, source_url) WHERE url IS NULL OR url = '';`);
    exec(`UPDATE website_embeddings SET chunk_text = COALESCE(chunk_text, content) WHERE chunk_text IS NULL OR chunk_text = '';`);
    exec(`UPDATE website_embeddings SET status = COALESCE(status, 'active') WHERE status IS NULL OR status = '';`);
    exec(`UPDATE website_embeddings SET crawl_date = COALESCE(crawl_date, created_at) WHERE crawl_date IS NULL OR crawl_date = '';`);
    exec(`UPDATE website_embeddings SET last_updated = COALESCE(last_updated, created_at) WHERE last_updated IS NULL OR last_updated = '';`);
  } catch {
    // Non-critical; schema may be mid-migration.
  }

  exec(`
    CREATE TABLE IF NOT EXISTS tenant_documents (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      tenant_id TEXT NOT NULL,
      filename TEXT,
      original_name TEXT,
      mime_type TEXT,
      size_bytes INTEGER,
      extracted_text TEXT,
      created_at TEXT DEFAULT (DATETIME('now'))
    );
  `);

  // Semantic search index for uploaded tenant documents (chunked embeddings)
  exec(`
    CREATE TABLE IF NOT EXISTS tenant_document_embeddings (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      tenant_id TEXT NOT NULL,
      document_id TEXT NOT NULL,
      filename TEXT,
      chunk_text TEXT NOT NULL,
      chunk_index INTEGER DEFAULT 0,
      embedding TEXT,
      created_at TEXT DEFAULT (DATETIME('now'))
    );
  `);

  try {
    exec(`CREATE INDEX IF NOT EXISTS idx_tenant_doc_embed_tenant ON tenant_document_embeddings(tenant_id);`);
    exec(`CREATE INDEX IF NOT EXISTS idx_tenant_doc_embed_doc ON tenant_document_embeddings(document_id);`);
  } catch {
    // Non-critical
  }

  // Tenant knowledge base (team-confirmed answers; per-tenant)
  exec(`
    CREATE TABLE IF NOT EXISTS tenant_knowledge_items (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      tenant_id TEXT NOT NULL,
      question TEXT NOT NULL,
      normalized_question TEXT NOT NULL,
      answer TEXT NOT NULL,
      sources TEXT DEFAULT '[]',
      created_by TEXT DEFAULT 'dashboard',
      created_from_followup_id TEXT,
      created_at TEXT DEFAULT (DATETIME('now')),
      updated_at TEXT DEFAULT (DATETIME('now')),
      status TEXT DEFAULT 'active'
    );
  `);

  // --- Broadcasts / bulk scheduling (required for broadcast sending) ---
  exec(`
    CREATE TABLE IF NOT EXISTS bulk_schedules (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      tenant_id TEXT NOT NULL,
      to_phone_number TEXT,
      phone_number TEXT,
      campaign_id TEXT,
      campaign_name TEXT,
      message_text TEXT,
      message_body TEXT,
      image_url TEXT,
      media_url TEXT,
      scheduled_at TEXT,
      status TEXT DEFAULT 'pending',
      retry_count INTEGER DEFAULT 0,
      sequence_number INTEGER DEFAULT 0,
      delivery_status TEXT,
      error_message TEXT,
      processed_at TEXT,
      delivered_at TEXT,
      created_at TEXT DEFAULT (DATETIME('now')),
      updated_at TEXT DEFAULT (DATETIME('now')),
      parent_campaign_id TEXT,
      day_number INTEGER DEFAULT 1,
      total_days INTEGER DEFAULT 1,
      auto_scheduled INTEGER DEFAULT 0,
      greeting_template TEXT,
      random_delay_ms INTEGER DEFAULT 0,
      humanized INTEGER DEFAULT 0
    );
  `);

  exec(`
    CREATE TABLE IF NOT EXISTS broadcast_recipients (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      campaign_id TEXT NOT NULL,
      phone TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      sent_at TEXT,
      error_message TEXT,
      created_at TEXT DEFAULT (DATETIME('now'))
    );
  `);

  // In local SQLite, `broadcast_recipients` may already be used as a contact list table
  // (with UNIQUE(tenant_id, phone_number)). Use a dedicated table for per-campaign tracking.
  exec(`
    CREATE TABLE IF NOT EXISTS broadcast_campaign_recipients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT,
      campaign_id TEXT NOT NULL,
      phone TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      sent_at TEXT,
      error_message TEXT,
      created_at TEXT DEFAULT (DATETIME('now'))
    );
  `);

  // Contact groups used by /api/broadcast/groups/*
  exec(`
    CREATE TABLE IF NOT EXISTS contact_groups (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      tenant_id TEXT NOT NULL,
      group_name TEXT,
      name TEXT,
      contacts TEXT,
      contact_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (DATETIME('now')),
      updated_at TEXT DEFAULT (DATETIME('now'))
    );
  `);

  // broadcastService expects a single lock row with id=1
  exec(`
    CREATE TABLE IF NOT EXISTS broadcast_processing_lock (
      id INTEGER PRIMARY KEY,
      is_processing INTEGER DEFAULT 0,
      process_id TEXT,
      started_at TEXT,
      last_heartbeat TEXT
    );
  `);
  try {
    dbInstance.prepare(
      `INSERT OR IGNORE INTO broadcast_processing_lock (id, is_processing) VALUES (1, 0)`
    ).run();
  } catch (_) {}

  exec(`
    CREATE TABLE IF NOT EXISTS broadcast_batch_log (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      process_id TEXT,
      started_at TEXT,
      completed_at TEXT,
      status TEXT,
      batch_size INTEGER DEFAULT 0,
      messages_sent INTEGER DEFAULT 0,
      messages_failed INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (DATETIME('now'))
    );
  `);

  exec(`
    CREATE TABLE IF NOT EXISTS unsubscribed_users (
      phone_number TEXT PRIMARY KEY,
      created_at TEXT DEFAULT (DATETIME('now'))
    );
  `);

  const tableInfo = (table) => {
    try {
      return dbInstance.prepare(`PRAGMA table_info(${table})`).all();
    } catch {
      return [];
    }
  };

  const hasTable = (table) => {
    try {
      const row = dbInstance.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table);
      return !!row;
    } catch {
      return false;
    }
  };

  const ensureColumns = (table, columns) => {
    if (!hasTable(table)) return;
    const existing = new Set(tableInfo(table).map(c => c.name));
    for (const col of columns) {
      if (!existing.has(col.name)) {
        exec(`ALTER TABLE ${table} ADD COLUMN ${col.name} ${col.type}`);
      }
    }
  };

  const tryExec = (sql) => {
    try {
      exec(sql);
    } catch (_) {
      // Best-effort: indexes and optional DDL should not block startup.
    }
  };

  // Tenants: broadcasts rely on daily_message_limit existing
  ensureColumns('tenants', [
    { name: 'daily_message_limit', type: 'INTEGER DEFAULT 1000' },
    // Dashboard settings (local mode should not crash on updates)
    { name: 'gst_rate', type: 'REAL DEFAULT 18' },
    { name: 'business_state', type: "TEXT DEFAULT 'maharashtra'" },
    { name: 'free_shipping_threshold', type: 'REAL DEFAULT 10000' },
    { name: 'standard_shipping_rate', type: 'REAL DEFAULT 20' },
    { name: 'bulk_shipping_rate', type: 'REAL DEFAULT 15' },
    { name: 'bulk_threshold', type: 'INTEGER DEFAULT 15' },
    { name: 'gstin', type: 'TEXT' },
    { name: 'business_address', type: 'TEXT' },
    // Zoho (tenant-based auth)
    { name: 'zoho_access_token', type: 'TEXT' },
    { name: 'zoho_refresh_token', type: 'TEXT' },
    { name: 'zoho_organization_id', type: 'TEXT' },
    { name: 'zoho_organization_name', type: 'TEXT' },
    { name: 'zoho_client_id', type: 'TEXT' },
    { name: 'zoho_client_secret', type: 'TEXT' },
    { name: 'zoho_token_expires_at', type: 'TEXT' },
    { name: 'zoho_scopes', type: 'TEXT' },
    { name: 'zoho_authorized_at', type: 'TEXT' }
  ]);

  // Products: align to the fields used throughout dashboard/routes
  ensureColumns('products', [
    { name: 'price', type: 'REAL' },
    { name: 'packaging_unit', type: 'TEXT' },
    { name: 'units_per_carton', type: 'INTEGER' },
    { name: 'carton_price', type: 'REAL' },
    { name: 'brand', type: 'TEXT' },
    { name: 'category', type: 'TEXT' },
    { name: 'model_number', type: 'TEXT' },
    { name: 'category_id', type: 'TEXT' },
    { name: 'image_url', type: 'TEXT' },
    { name: 'is_active', type: 'INTEGER' },
    { name: 'created_at', type: 'TEXT' },
    { name: 'updated_at', type: 'TEXT' }
  ]);

  // If older schema used price_retail, best-effort copy to price
  try {
    const cols = new Set(tableInfo('products').map(c => c.name));
    if (cols.has('price_retail') && cols.has('price')) {
      exec(`UPDATE products SET price = COALESCE(price, price_retail) WHERE price IS NULL AND price_retail IS NOT NULL`);
    }
  } catch (_) {}

  // Conversations: some codepaths expect these fields
  ensureColumns('conversations', [
    { name: 'end_user_phone', type: 'TEXT' },
    { name: 'last_quoted_products', type: "TEXT DEFAULT '[]'" },
    { name: 'metadata', type: 'TEXT' },
    { name: 'last_message_at', type: 'TEXT' },
    { name: 'lead_type', type: 'TEXT' },
    // Dashboard conversations list expects these
    { name: 'state', type: 'TEXT' },
    { name: 'last_product_discussed', type: 'TEXT' },
    { name: 'created_at', type: 'TEXT' },
    { name: 'updated_at', type: 'TEXT' }
  ]);

  // Customer profiles: local SQLite schemas may be minimal; add commonly referenced columns.
  ensureColumns('customer_profiles', [
    { name: 'phone', type: 'TEXT' },
    { name: 'name', type: 'TEXT' },
    { name: 'business_name', type: 'TEXT' },
    { name: 'first_name', type: 'TEXT' },
    { name: 'last_name', type: 'TEXT' },
    { name: 'gst_preference', type: 'TEXT' },
    { name: 'gst_number', type: 'TEXT' },
    { name: 'customer_tier', type: "TEXT DEFAULT 'standard'" },
    { name: 'total_orders', type: 'INTEGER DEFAULT 0' },
    { name: 'total_spent', type: 'REAL DEFAULT 0' },
    { name: 'lead_score', type: 'INTEGER DEFAULT 0' },
    { name: 'created_at', type: 'TEXT' },
    { name: 'updated_at', type: 'TEXT' }
  ]);

  // Orders: dashboard expects these fields; older local schemas may not include all.
  ensureColumns('orders', [
    { name: 'tenant_id', type: 'TEXT' },
    { name: 'conversation_id', type: 'TEXT' },
    { name: 'created_at', type: 'TEXT' },
    { name: 'status', type: 'TEXT' },
    { name: 'order_status', type: 'TEXT' },
    { name: 'customer_name', type: 'TEXT' },
    { name: 'customer_email', type: 'TEXT' },
    { name: 'shipping_address', type: 'TEXT' },
    { name: 'zoho_sales_order_id', type: 'TEXT' },
    { name: 'zoho_invoice_id', type: 'TEXT' },
    { name: 'zoho_customer_id', type: 'TEXT' },
    { name: 'zoho_sync_status', type: 'TEXT' },
    { name: 'zoho_synced_at', type: 'TEXT' },
    { name: 'total_amount', type: 'REAL' },
    { name: 'subtotal_amount', type: 'REAL' },
    { name: 'original_amount', type: 'REAL' },
    { name: 'discount_amount', type: 'REAL' },
    { name: 'gst_rate', type: 'REAL' },
    { name: 'gst_amount', type: 'REAL' },
    { name: 'cgst_amount', type: 'REAL' },
    { name: 'sgst_amount', type: 'REAL' },
    { name: 'igst_amount', type: 'REAL' },
    { name: 'shipping_charges', type: 'REAL' },
    { name: 'shipping_cartons', type: 'INTEGER' },
    { name: 'shipping_rate_per_carton', type: 'REAL' },
    { name: 'shipping_rate_type', type: 'TEXT' },
    { name: 'free_shipping_applied', type: 'INTEGER DEFAULT 0' }
  ]);

  // Order items: support both legacy local schema (product_name/unit_price/total_price)
  // and newer schema used by dashboard + pricing/Zoho flows.
  ensureColumns('order_items', [
    // Legacy columns (may already exist)
    { name: 'order_id', type: 'TEXT' },
    { name: 'product_id', type: 'TEXT' },
    { name: 'product_name', type: 'TEXT' },
    { name: 'quantity', type: 'INTEGER DEFAULT 0' },
    { name: 'unit_price', type: 'REAL DEFAULT 0' },
    { name: 'total_price', type: 'REAL DEFAULT 0' },
    { name: 'created_at', type: "TEXT DEFAULT (DATETIME('now'))" },

    // Newer columns used by dashboard and integrations
    { name: 'price_at_time_of_purchase', type: 'REAL' },
    { name: 'unit_price_before_tax', type: 'REAL' },
    { name: 'gst_rate', type: 'REAL' },
    { name: 'gst_amount', type: 'REAL' },
    { name: 'zoho_item_id', type: 'TEXT' }
  ]);

  // WhatsApp Web connections: whatsappWebService updates connected_at on successful login
  ensureColumns('whatsapp_connections', [
    { name: 'connected_at', type: 'TEXT' }
  ]);

  // Messages: required for dashboard analytics and history logging
  exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      tenant_id TEXT,
      conversation_id TEXT,
      sender TEXT,
      message_body TEXT,
      message_type TEXT,
      created_at TEXT DEFAULT (DATETIME('now'))
    );
  `);

  // Scheduled follow-ups: required for followups dashboard + followup cron
  exec(`
    CREATE TABLE IF NOT EXISTS scheduled_followups (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      tenant_id TEXT NOT NULL,
      end_user_phone TEXT NOT NULL,
      scheduled_time TEXT NOT NULL,
      description TEXT,
      original_request TEXT,
      conversation_context TEXT,
      status TEXT DEFAULT 'scheduled',
      created_at TEXT DEFAULT (DATETIME('now')),
      completed_at TEXT,
      error_message TEXT
    );
  `);

  // Patch bulk_schedules if it existed with an older/partial schema
  ensureColumns('bulk_schedules', [
    { name: 'to_phone_number', type: 'TEXT' },
    { name: 'phone_number', type: 'TEXT' },
    { name: 'campaign_id', type: 'TEXT' },
    { name: 'campaign_name', type: 'TEXT' },
    { name: 'message_text', type: 'TEXT' },
    { name: 'message_body', type: 'TEXT' },
    { name: 'image_url', type: 'TEXT' },
    { name: 'media_url', type: 'TEXT' },
    { name: 'scheduled_at', type: 'TEXT' },
    { name: 'status', type: "TEXT DEFAULT 'pending'" },
    { name: 'retry_count', type: 'INTEGER DEFAULT 0' },
    { name: 'sequence_number', type: 'INTEGER DEFAULT 0' },
    { name: 'delivery_status', type: 'TEXT' },
    { name: 'error_message', type: 'TEXT' },
    { name: 'processed_at', type: 'TEXT' },
    { name: 'delivered_at', type: 'TEXT' },
    { name: 'created_at', type: "TEXT DEFAULT (DATETIME('now'))" },
    { name: 'updated_at', type: "TEXT DEFAULT (DATETIME('now'))" },
    { name: 'parent_campaign_id', type: 'TEXT' },
    { name: 'day_number', type: 'INTEGER DEFAULT 1' },
    { name: 'total_days', type: 'INTEGER DEFAULT 1' },
    { name: 'auto_scheduled', type: 'INTEGER DEFAULT 0' },
    { name: 'greeting_template', type: 'TEXT' },
    { name: 'random_delay_ms', type: 'INTEGER DEFAULT 0' },
    { name: 'humanized', type: 'INTEGER DEFAULT 0' }
  ]);

  ensureColumns('broadcast_processing_lock', [
    { name: 'is_processing', type: 'INTEGER DEFAULT 0' },
    { name: 'process_id', type: 'TEXT' },
    { name: 'started_at', type: 'TEXT' },
    { name: 'last_heartbeat', type: 'TEXT' }
  ]);

  ensureColumns('broadcast_batch_log', [
    { name: 'started_at', type: 'TEXT' },
    { name: 'completed_at', type: 'TEXT' },
    { name: 'status', type: 'TEXT' },
    { name: 'batch_size', type: 'INTEGER DEFAULT 0' },
    { name: 'messages_sent', type: 'INTEGER DEFAULT 0' },
    { name: 'messages_failed', type: 'INTEGER DEFAULT 0' }
  ]);

  ensureColumns('broadcast_recipients', [
    { name: 'tenant_id', type: 'TEXT' },
    { name: 'campaign_id', type: 'TEXT' },
    { name: 'phone', type: 'TEXT' },
    { name: 'phone_number', type: 'TEXT' },
    { name: 'status', type: "TEXT DEFAULT 'pending'" },
    { name: 'sent_at', type: 'TEXT' },
    { name: 'error_message', type: 'TEXT' },
    { name: 'created_at', type: "TEXT DEFAULT (DATETIME('now'))" }
  ]);

  ensureColumns('messages', [
    { name: 'tenant_id', type: 'TEXT' },
    { name: 'conversation_id', type: 'TEXT' },
    { name: 'sender', type: 'TEXT' },
    { name: 'message_body', type: 'TEXT' },
    { name: 'message_type', type: 'TEXT' },
    { name: 'whatsapp_message_id', type: 'TEXT' },
    { name: 'created_at', type: "TEXT DEFAULT (DATETIME('now'))" }
  ]);

  ensureColumns('scheduled_followups', [
    { name: 'tenant_id', type: 'TEXT' },
    { name: 'end_user_phone', type: 'TEXT' },
    { name: 'scheduled_time', type: 'TEXT' },
    { name: 'description', type: 'TEXT' },
    { name: 'original_request', type: 'TEXT' },
    { name: 'conversation_context', type: 'TEXT' },
    { name: 'status', type: "TEXT DEFAULT 'scheduled'" },
    { name: 'created_at', type: "TEXT DEFAULT (DATETIME('now'))" },
    { name: 'delivery_method', type: 'TEXT' },
    { name: 'whatsapp_message_id', type: 'TEXT' },
    { name: 'completed_at', type: 'TEXT' },
    { name: 'error_message', type: 'TEXT' }
  ]);

  ensureColumns('broadcast_campaign_recipients', [
    { name: 'tenant_id', type: 'TEXT' },
    { name: 'campaign_id', type: 'TEXT' },
    { name: 'phone', type: 'TEXT' },
    { name: 'status', type: "TEXT DEFAULT 'pending'" },
    { name: 'sent_at', type: 'TEXT' },
    { name: 'error_message', type: 'TEXT' },
    { name: 'created_at', type: "TEXT DEFAULT (DATETIME('now'))" }
  ]);

  ensureColumns('contact_groups', [
    { name: 'group_name', type: 'TEXT' },
    { name: 'name', type: 'TEXT' },
    { name: 'contacts', type: 'TEXT' },
    { name: 'contact_count', type: 'INTEGER DEFAULT 0' },
    { name: 'created_at', type: "TEXT DEFAULT (DATETIME('now'))" },
    { name: 'updated_at', type: "TEXT DEFAULT (DATETIME('now'))" }
  ]);

  // Indexes (best-effort; after columns are ensured)
  tryExec(`CREATE INDEX IF NOT EXISTS idx_bulk_schedules_status_sched ON bulk_schedules(status, scheduled_at);`);
  tryExec(`CREATE INDEX IF NOT EXISTS idx_bulk_schedules_tenant ON bulk_schedules(tenant_id);`);
  tryExec(`CREATE INDEX IF NOT EXISTS idx_bulk_schedules_campaign ON bulk_schedules(campaign_id);`);
  tryExec(`CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_campaign_phone ON broadcast_recipients(campaign_id, phone);`);
  tryExec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_bcr_campaign_phone_unique ON broadcast_campaign_recipients(campaign_id, phone);`);
  tryExec(`CREATE INDEX IF NOT EXISTS idx_bcr_tenant_campaign ON broadcast_campaign_recipients(tenant_id, campaign_id);`);
  tryExec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_groups_tenant_group_name ON contact_groups(tenant_id, group_name);`);
  tryExec(`CREATE INDEX IF NOT EXISTS idx_messages_tenant_created ON messages(tenant_id, created_at);`);
  tryExec(`CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages(conversation_id, created_at);`);
  tryExec(`CREATE INDEX IF NOT EXISTS idx_followups_tenant_time ON scheduled_followups(tenant_id, scheduled_time);`);
  tryExec(`CREATE INDEX IF NOT EXISTS idx_followups_status_time ON scheduled_followups(status, scheduled_time);`);
  tryExec(`CREATE INDEX IF NOT EXISTS idx_broadcast_batch_log_completed ON broadcast_batch_log(completed_at);`);
  tryExec(`CREATE INDEX IF NOT EXISTS idx_kb_tenant_normq ON tenant_knowledge_items(tenant_id, normalized_question);`);
  tryExec(`CREATE INDEX IF NOT EXISTS idx_kb_tenant_updated ON tenant_knowledge_items(tenant_id, updated_at);`);
}

// ---------- OpenAI ----------
const openaiApiKey = process.env.OPENAI_API_KEY;
if (!openaiApiKey) {
  throw new Error('OpenAI API Key must be provided in environment variables.');
}

// If you use sk-proj-* keys, pass the project id/slug
const openaiProject =
  process.env.OPENAI_PROJECT || undefined;

const openai = new OpenAI({
  apiKey: openaiApiKey,
  ...(openaiProject ? { project: openaiProject } : {})
});
dbg('OpenAI: project', openaiProject ? 'set' : 'not set');

// ---------- Google Cloud Storage ----------
const storage = new Storage();

// Accept multiple bucket env names to avoid boot failures
const gcsBucketName =
  process.env.GCS_BUCKET_NAME ||
  process.env.GCS_BUCKET ||
  process.env.GOOGLE_CLOUD_STORAGE_BUCKET;

if (!gcsBucketName) {
  throw new Error('Google Cloud Storage bucket name must be provided in environment variables.');
}
const bucket = storage.bucket(gcsBucketName);
dbg('GCS bucket:', gcsBucketName);

module.exports = {
  supabase,
  // Exposed for local-mode route fallbacks (additive; existing imports remain valid)
  db,
  USE_LOCAL_DB,
  openai,
  bucket,
};

// ---- ADD: project-aware OpenAI client (keeps existing exports) ----
try {
  const _apiKey = process.env.OPENAI_API_KEY;
  const _proj   = process.env.OPENAI_PROJECT; // e.g. proj_HXrnhKI5YuehJumAke2sXqiN
  if (_apiKey && _proj) {
    const OpenAI = require('openai');
    const _openaiWithProject = new OpenAI({ apiKey: _apiKey, project: _proj });
    module.exports.openaiV2 = _openaiWithProject;
    console.log('[CONFIG] OpenAI (project client) enabled');
  }
} catch (e) {
  console.error('[CONFIG] OpenAI project client init failed:', e?.message || e);
}

// ADDITIVE: config boot diagnostics (masked)
try {
  const dbg = require('./debug');
  if (process.env.DEBUG_CONFIG === '1') {
    console.log('[CONFIG] OpenAI project set:', !!process.env.OPENAI_PROJECT);
    console.log('[CONFIG] OpenAI key mask:', dbg.mask(process.env.OPENAI_API_KEY || ''));
    console.log('[CONFIG] Models fast/smart:', process.env.AI_MODEL_FAST, process.env.AI_MODEL_SMART);
  }
} catch (e) {}
