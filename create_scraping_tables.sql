-- ============================================
-- WEBSITE SCRAPING TABLES FOR SUPABASE
-- ============================================

-- Table: website_embeddings
-- Stores website content chunks with embeddings for AI context
CREATE TABLE IF NOT EXISTS website_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  
  -- Legacy/local schema compatibility
  content TEXT NOT NULL,
  source_url TEXT,
  metadata TEXT, -- JSON string
  
  -- New enhanced schema
  url TEXT NOT NULL,
  page_title TEXT,
  content_type TEXT DEFAULT 'html',
  original_content TEXT,
  chunk_text TEXT,
  chunk_index INTEGER DEFAULT 0,
  embedding TEXT, -- JSON array as string
  product_codes TEXT, -- JSON array as string
  keywords TEXT, -- JSON array as string
  status TEXT DEFAULT 'active',
  crawl_date TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  last_updated TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  
  -- Indexes for performance
  CONSTRAINT website_embeddings_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- Indexes for website_embeddings
CREATE INDEX IF NOT EXISTS idx_website_embeddings_tenant ON website_embeddings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_website_embeddings_url ON website_embeddings(url);
CREATE INDEX IF NOT EXISTS idx_website_embeddings_tenant_url ON website_embeddings(tenant_id, url);
CREATE INDEX IF NOT EXISTS idx_website_embeddings_status ON website_embeddings(status);

-- Enable Row Level Security
ALTER TABLE website_embeddings ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only access their tenant's data
CREATE POLICY website_embeddings_tenant_isolation ON website_embeddings
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant_id', TRUE));

COMMENT ON TABLE website_embeddings IS 'Stores crawled website content chunks with embeddings for AI context';
COMMENT ON COLUMN website_embeddings.content IS 'The text content chunk (required for local SQLite compatibility)';
COMMENT ON COLUMN website_embeddings.chunk_text IS 'The text content chunk (new schema)';
COMMENT ON COLUMN website_embeddings.embedding IS 'Vector embedding as JSON array string';
COMMENT ON COLUMN website_embeddings.metadata IS 'Additional metadata as JSON string';
