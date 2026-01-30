-- Add Gmail filter keywords column to tenants table
-- This allows filtering emails to only enquiries with specific keywords

ALTER TABLE tenants 
ADD COLUMN IF NOT EXISTS gmail_filter_keywords TEXT;

-- Default keywords for product enquiries (comma-separated)
-- Examples: 'quote,enquiry,price,product,order,purchase,RFQ,quotation'
COMMENT ON COLUMN tenants.gmail_filter_keywords IS 'Comma-separated keywords to filter Gmail enquiries. Only emails containing these keywords in subject/body will be synced.';
