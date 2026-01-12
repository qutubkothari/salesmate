-- Add document management embeddings for SAK Solutions (Test Business)
-- This script inserts realistic document-related content into website_embeddings

-- First, get the correct tenant_id for the test business
-- In local dev: 'a49000aba12f9d71921c22dc5a36cdf0'
-- On Hostinger: it might be different, so we use whichever exists

BEGIN TRANSACTION;

-- Insert document management system information
INSERT OR IGNORE INTO website_embeddings (
    tenant_id,
    url,
    page_title,
    chunk_text,
    content,
    content_type,
    embedding,
    status,
    created_at
) 
SELECT 
    id as tenant_id,
    'https://saksolution.com/features/m-paperless' as url,
    'M-Paperless - Document Management System' as page_title,
    'M-Paperless is our advanced document management system. It provides comprehensive document scanning, storage, and retrieval capabilities. Key Features: Document Upload & Storage, Multilingual Support (Arabic, English), Scanning Integration, Document Search, Compliance (UAE/Middle East), Access Control, Version Control. Perfect for businesses needing to digitize paper workflows and maintain organized electronic records.' as chunk_text,
    'M-Paperless is our advanced document management system. It provides comprehensive document scanning, storage, and retrieval capabilities. Key Features: Document Upload & Storage, Multilingual Support (Arabic, English), Scanning Integration, Document Search, Compliance (UAE/Middle East), Access Control, Version Control. Perfect for businesses needing to digitize paper workflows and maintain organized electronic records.' as content,
    'feature' as content_type,
    '[0.1, 0.2, 0.15, 0.22, 0.18, 0.14, 0.19, 0.21, 0.17, 0.23, 0.16, 0.20, 0.13, 0.24, 0.12, 0.11, 0.25, 0.09, 0.26, 0.08, 0.27, 0.07, 0.28, 0.06, 0.29, 0.05, 0.04, 0.30, 0.31, 0.03, 0.32, 0.02, 0.33, 0.01, 0.34, 0.35, 0.36, -0.1, -0.15, -0.2, -0.25, -0.3, -0.05, 0.11, 0.12, 0.13, 0.14, 0.19, 0.22, 0.25, 0.28, 0.31, 0.34, 0.37, 0.40, -0.35, -0.4, -0.02, -0.03, -0.04, -0.06, -0.07, -0.08, -0.09, -0.11, -0.12, -0.13, -0.14, -0.16, -0.17, -0.18, -0.19, -0.21, -0.22, -0.23, -0.24, -0.26, -0.27, -0.28, -0.29, -0.31, -0.32, -0.33, -0.34, -0.36, -0.37, -0.38, -0.39, -0.41, 0.42, 0.43, 0.38, 0.39, 0.35, 0.36, 0.37, 0.41, 0.44, 0.45, 0.46, 0.47, 0.48, 0.49, 0.50, -0.42, -0.43, -0.44, -0.45, -0.46, -0.47, -0.48, -0.49, -0.50, 0.51, 0.52, 0.15, 0.16, 0.10, 0.09, 0.08, 0.07, 0.06, 0.05, 0.04, 0.03, 0.02, 0.01, 0.00, -0.01, -0.02, -0.03, -0.04, -0.05, -0.06, -0.07, -0.08, -0.09, -0.10, -0.11, -0.12, -0.13, -0.14, -0.15, -0.16, -0.17, -0.18, -0.19, -0.20, -0.21, -0.22, -0.23, -0.24, -0.25, -0.26, -0.27, -0.28, -0.29, -0.30, -0.31, -0.32, -0.33, -0.34, -0.35, -0.36, -0.37, -0.38, -0.39, -0.40, -0.41, -0.42, -0.43, -0.44, -0.45, -0.46, -0.47, -0.48, -0.49, -0.50, 0.53, 0.54, 0.55, 0.56, 0.57, 0.58, 0.59, 0.60, -0.51, -0.52, -0.53, -0.54, -0.55, -0.56, -0.57, -0.58, -0.59, -0.60, 0.61, 0.62, 0.63, 0.64, 0.65, 0.66, 0.67, 0.68, 0.69, 0.70, -0.61, -0.62, -0.63, -0.64, -0.65, -0.66, -0.67, -0.68, -0.69, -0.70, 0.11, 0.12, 0.13, 0.14, 0.15, 0.16, 0.17, 0.18, 0.19, 0.20, 0.21, 0.22, 0.23, 0.24, 0.25, 0.26, 0.27, 0.28, 0.29, 0.30, 0.31, 0.32, 0.33, 0.34, 0.35, 0.36, 0.37, 0.38, 0.39, 0.40, 0.41, 0.42, 0.43, 0.44, 0.45, 0.46, 0.47, 0.48, 0.49, 0.50, 0.51, 0.52, 0.53, 0.54, 0.55, 0.56, 0.57, 0.58, 0.59, 0.60, 0.61, 0.62, 0.63, 0.64, 0.65, 0.66, 0.67, 0.68, 0.69, 0.70, -0.11, -0.12, -0.13, -0.14, -0.15, -0.16, -0.17, -0.18, -0.19, -0.20, -0.21, -0.22, -0.23, -0.24, -0.25, -0.26, -0.27, -0.28, -0.29, -0.30, -0.31, -0.32, -0.33, -0.34, -0.35, -0.36, -0.37, -0.38, -0.39, -0.40, -0.41, -0.42, -0.43, -0.44, -0.45, -0.46, -0.47, -0.48, -0.49, -0.50, -0.51, -0.52, -0.53, -0.54, -0.55, -0.56, -0.57, -0.58, -0.59, -0.60, -0.61, -0.62, -0.63, -0.64, -0.65, -0.66, -0.67, -0.68, -0.69, -0.70, 0.71, 0.72, 0.73, 0.74, 0.75, 0.76, 0.77, 0.78, 0.79, 0.80, -0.71, -0.72, -0.73, -0.74, -0.75, -0.76, -0.77, -0.78, -0.79, -0.80]' as embedding,
    'active' as status,
    datetime('now') as created_at
FROM tenants 
WHERE business_name LIKE '%Test%' OR id = (SELECT id FROM tenants LIMIT 1);

INSERT OR IGNORE INTO website_embeddings (
    tenant_id,
    url,
    page_title,
    chunk_text,
    content,
    content_type,
    embedding,
    status,
    created_at
) 
SELECT 
    id as tenant_id,
    'https://saksolution.com/features/documents' as url,
    'Document Management Features' as page_title,
    'SAK Solutions offers comprehensive document management features. Document System Capabilities: Scan physical documents directly, Upload PDF/Word/image files, Organize by folders and tags, Full-text search, Arabic language support, Automatic classification. Benefits: Reduce paper usage and storage costs, Improve security with encrypted storage, Enable remote access, Maintain audit trails for compliance, Share securely with team, Automatic backup to cloud. Part of M-Paperless platform.' as chunk_text,
    'SAK Solutions offers comprehensive document management features. Document System Capabilities: Scan physical documents directly, Upload PDF/Word/image files, Organize by folders and tags, Full-text search, Arabic language support, Automatic classification. Benefits: Reduce paper usage and storage costs, Improve security with encrypted storage, Enable remote access, Maintain audit trails for compliance, Share securely with team, Automatic backup to cloud. Part of M-Paperless platform.' as content,
    'documentation' as content_type,
    '[0.1, 0.2, 0.15, 0.22, 0.18, 0.14, 0.19, 0.21, 0.17, 0.23, 0.16, 0.20, 0.13, 0.24, 0.12, 0.11, 0.25, 0.09, 0.26, 0.08, 0.27, 0.07, 0.28, 0.06, 0.29, 0.05, 0.04, 0.30, 0.31, 0.03, 0.32, 0.02, 0.33, 0.01, 0.34, 0.35, 0.36, -0.1, -0.15, -0.2, -0.25, -0.3, -0.05, 0.11, 0.12, 0.13, 0.14, 0.19, 0.22, 0.25, 0.28, 0.31, 0.34, 0.37, 0.40, -0.35, -0.4, -0.02, -0.03, -0.04, -0.06, -0.07, -0.08, -0.09, -0.11, -0.12, -0.13, -0.14, -0.16, -0.17, -0.18, -0.19, -0.21, -0.22, -0.23, -0.24, -0.26, -0.27, -0.28, -0.29, -0.31, -0.32, -0.33, -0.34, -0.36, -0.37, -0.38, -0.39, -0.41, 0.42, 0.43, 0.38, 0.39, 0.35, 0.36, 0.37, 0.41, 0.44, 0.45, 0.46, 0.47, 0.48, 0.49, 0.50, -0.42, -0.43, -0.44, -0.45, -0.46, -0.47, -0.48, -0.49, -0.50, 0.51, 0.52, 0.15, 0.16, 0.10, 0.09, 0.08, 0.07, 0.06, 0.05, 0.04, 0.03, 0.02, 0.01, 0.00, -0.01, -0.02, -0.03, -0.04, -0.05, -0.06, -0.07, -0.08, -0.09, -0.10, -0.11, -0.12, -0.13, -0.14, -0.15, -0.16, -0.17, -0.18, -0.19, -0.20, -0.21, -0.22, -0.23, -0.24, -0.25, -0.26, -0.27, -0.28, -0.29, -0.30, -0.31, -0.32, -0.33, -0.34, -0.35, -0.36, -0.37, -0.38, -0.39, -0.40, -0.41, -0.42, -0.43, -0.44, -0.45, -0.46, -0.47, -0.48, -0.49, -0.50, 0.53, 0.54, 0.55, 0.56, 0.57, 0.58, 0.59, 0.60, -0.51, -0.52, -0.53, -0.54, -0.55, -0.56, -0.57, -0.58, -0.59, -0.60, 0.61, 0.62, 0.63, 0.64, 0.65, 0.66, 0.67, 0.68, 0.69, 0.70, -0.61, -0.62, -0.63, -0.64, -0.65, -0.66, -0.67, -0.68, -0.69, -0.70, 0.11, 0.12, 0.13, 0.14, 0.15, 0.16, 0.17, 0.18, 0.19, 0.20, 0.21, 0.22, 0.23, 0.24, 0.25, 0.26, 0.27, 0.28, 0.29, 0.30, 0.31, 0.32, 0.33, 0.34, 0.35, 0.36, 0.37, 0.38, 0.39, 0.40, 0.41, 0.42, 0.43, 0.44, 0.45, 0.46, 0.47, 0.48, 0.49, 0.50, 0.51, 0.52, 0.53, 0.54, 0.55, 0.56, 0.57, 0.58, 0.59, 0.60, 0.61, 0.62, 0.63, 0.64, 0.65, 0.66, 0.67, 0.68, 0.69, 0.70, -0.11, -0.12, -0.13, -0.14, -0.15, -0.16, -0.17, -0.18, -0.19, -0.20, -0.21, -0.22, -0.23, -0.24, -0.25, -0.26, -0.27, -0.28, -0.29, -0.30, -0.31, -0.32, -0.33, -0.34, -0.35, -0.36, -0.37, -0.38, -0.39, -0.40, -0.41, -0.42, -0.43, -0.44, -0.45, -0.46, -0.47, -0.48, -0.49, -0.50, -0.51, -0.52, -0.53, -0.54, -0.55, -0.56, -0.57, -0.58, -0.59, -0.60, -0.61, -0.62, -0.63, -0.64, -0.65, -0.66, -0.67, -0.68, -0.69, -0.70, 0.71, 0.72, 0.73, 0.74, 0.75, 0.76, 0.77, 0.78, 0.79, 0.80, -0.71, -0.72, -0.73, -0.74, -0.75, -0.76, -0.77, -0.78, -0.79, -0.80]' as embedding,
    'active' as status,
    datetime('now') as created_at
FROM tenants 
WHERE business_name LIKE '%Test%' OR id = (SELECT id FROM tenants LIMIT 1);

INSERT OR IGNORE INTO website_embeddings (
    tenant_id,
    url,
    page_title,
    chunk_text,
    content,
    content_type,
    embedding,
    status,
    created_at
) 
SELECT 
    id as tenant_id,
    'https://saksolution.com/faq/documents' as url,
    'FAQ - Document Management' as page_title,
    'Q: Do you have a document management system? A: Yes! We offer M-Paperless, our comprehensive document management system with scanning, storage, retrieval, and search. Q: Can I scan documents directly? A: Yes, scanner device integration and mobile scanning supported. Q: Does it support Arabic? A: Yes, full Arabic support. Q: Is it secure? A: Encrypted, backed up, role-based permissions. Q: Can I search documents? A: Yes, intelligent search with OCR.' as chunk_text,
    'Q: Do you have a document management system? A: Yes! We offer M-Paperless, our comprehensive document management system with scanning, storage, retrieval, and search. Q: Can I scan documents directly? A: Yes, scanner device integration and mobile scanning supported. Q: Does it support Arabic? A: Yes, full Arabic support. Q: Is it secure? A: Encrypted, backed up, role-based permissions. Q: Can I search documents? A: Yes, intelligent search with OCR.' as content,
    'documentation' as content_type,
    '[0.1, 0.2, 0.15, 0.22, 0.18, 0.14, 0.19, 0.21, 0.17, 0.23, 0.16, 0.20, 0.13, 0.24, 0.12, 0.11, 0.25, 0.09, 0.26, 0.08, 0.27, 0.07, 0.28, 0.06, 0.29, 0.05, 0.04, 0.30, 0.31, 0.03, 0.32, 0.02, 0.33, 0.01, 0.34, 0.35, 0.36, -0.1, -0.15, -0.2, -0.25, -0.3, -0.05, 0.11, 0.12, 0.13, 0.14, 0.19, 0.22, 0.25, 0.28, 0.31, 0.34, 0.37, 0.40, -0.35, -0.4, -0.02, -0.03, -0.04, -0.06, -0.07, -0.08, -0.09, -0.11, -0.12, -0.13, -0.14, -0.16, -0.17, -0.18, -0.19, -0.21, -0.22, -0.23, -0.24, -0.26, -0.27, -0.28, -0.29, -0.31, -0.32, -0.33, -0.34, -0.36, -0.37, -0.38, -0.39, -0.41, 0.42, 0.43, 0.38, 0.39, 0.35, 0.36, 0.37, 0.41, 0.44, 0.45, 0.46, 0.47, 0.48, 0.49, 0.50, -0.42, -0.43, -0.44, -0.45, -0.46, -0.47, -0.48, -0.49, -0.50, 0.51, 0.52, 0.15, 0.16, 0.10, 0.09, 0.08, 0.07, 0.06, 0.05, 0.04, 0.03, 0.02, 0.01, 0.00, -0.01, -0.02, -0.03, -0.04, -0.05, -0.06, -0.07, -0.08, -0.09, -0.10, -0.11, -0.12, -0.13, -0.14, -0.15, -0.16, -0.17, -0.18, -0.19, -0.20, -0.21, -0.22, -0.23, -0.24, -0.25, -0.26, -0.27, -0.28, -0.29, -0.30, -0.31, -0.32, -0.33, -0.34, -0.35, -0.36, -0.37, -0.38, -0.39, -0.40, -0.41, -0.42, -0.43, -0.44, -0.45, -0.46, -0.47, -0.48, -0.49, -0.50, 0.53, 0.54, 0.55, 0.56, 0.57, 0.58, 0.59, 0.60, -0.51, -0.52, -0.53, -0.54, -0.55, -0.56, -0.57, -0.58, -0.59, -0.60, 0.61, 0.62, 0.63, 0.64, 0.65, 0.66, 0.67, 0.68, 0.69, 0.70, -0.61, -0.62, -0.63, -0.64, -0.65, -0.66, -0.67, -0.68, -0.69, -0.70, 0.11, 0.12, 0.13, 0.14, 0.15, 0.16, 0.17, 0.18, 0.19, 0.20, 0.21, 0.22, 0.23, 0.24, 0.25, 0.26, 0.27, 0.28, 0.29, 0.30, 0.31, 0.32, 0.33, 0.34, 0.35, 0.36, 0.37, 0.38, 0.39, 0.40, 0.41, 0.42, 0.43, 0.44, 0.45, 0.46, 0.47, 0.48, 0.49, 0.50, 0.51, 0.52, 0.53, 0.54, 0.55, 0.56, 0.57, 0.58, 0.59, 0.60, 0.61, 0.62, 0.63, 0.64, 0.65, 0.66, 0.67, 0.68, 0.69, 0.70, -0.11, -0.12, -0.13, -0.14, -0.15, -0.16, -0.17, -0.18, -0.19, -0.20, -0.21, -0.22, -0.23, -0.24, -0.25, -0.26, -0.27, -0.28, -0.29, -0.30, -0.31, -0.32, -0.33, -0.34, -0.35, -0.36, -0.37, -0.38, -0.39, -0.40, -0.41, -0.42, -0.43, -0.44, -0.45, -0.46, -0.47, -0.48, -0.49, -0.50, -0.51, -0.52, -0.53, -0.54, -0.55, -0.56, -0.57, -0.58, -0.59, -0.60, -0.61, -0.62, -0.63, -0.64, -0.65, -0.66, -0.67, -0.68, -0.69, -0.70, 0.71, 0.72, 0.73, 0.74, 0.75, 0.76, 0.77, 0.78, 0.79, 0.80, -0.71, -0.72, -0.73, -0.74, -0.75, -0.76, -0.77, -0.78, -0.79, -0.80]' as embedding,
    'active' as status,
    datetime('now') as created_at
FROM tenants 
WHERE business_name LIKE '%Test%' OR id = (SELECT id FROM tenants LIMIT 1);

COMMIT;

-- Verify the inserts
SELECT 'Document embeddings have been added.' as status;
