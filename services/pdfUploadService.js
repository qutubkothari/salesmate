// services/pdfUploadService.js
const { bucket } = require('./config');
const { dbClient } = require('./config');
const fetch = require('node-fetch');
const crypto = require('crypto');

/**
 * Upload PDF from URL to Google Cloud Storage
 * @param {string} pdfUrl - Source PDF URL (from Maytapi)
 * @param {string} tenantId - Tenant ID for organizing files
 * @param {string} category - Category (e.g., 'invoice', 'purchase_order', 'quotation')
 * @param {string} originalFilename - Original filename from upload
 * @returns {Promise<string>} - GCS public URL
 */
const uploadPDFToGCS = async (pdfUrl, tenantId, category = 'customer_documents', originalFilename = '') => {
    try {
        console.log('[GCS_PDF_UPLOAD] Starting upload for:', pdfUrl);
        
        // Download PDF from Maytapi
        const response = await fetch(pdfUrl);
        if (!response.ok) {
            throw new Error(`Failed to download PDF: ${response.status}`);
        }
        
        const pdfBuffer = await response.buffer();
        const contentType = 'application/pdf';
        
        // Generate unique filename
        const timestamp = Date.now();
        const hash = crypto.createHash('md5').update(pdfBuffer).digest('hex').substring(0, 8);
        const sanitizedFilename = originalFilename.replace(/[^a-zA-Z0-9.-]/g, '_');
        const fileName = `${category}/${tenantId}/${timestamp}_${hash}_${sanitizedFilename || 'document.pdf'}`;
        
        // Upload to GCS
        const file = bucket.file(fileName);
        await file.save(pdfBuffer, {
            metadata: {
                contentType,
                metadata: {
                    tenantId,
                    category,
                    originalUrl: pdfUrl,
                    originalFilename,
                    uploadedAt: new Date().toISOString()
                }
            }
        });
        
        // Make file publicly accessible
        await file.makePublic();
        
        // Get public URL
        const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
        
        console.log('[GCS_PDF_UPLOAD] Upload successful:', publicUrl);
        return publicUrl;
        
    } catch (error) {
        console.error('[GCS_PDF_UPLOAD] Upload failed:', error.message);
        throw error;
    }
};

/**
 * Save PDF metadata to database
 */
const savePDFMetadata = async (tenantId, phoneNumber, originalUrl, gcsUrl, analysis, filename) => {
    try {
        const { data, error } = await dbClient
            .from('uploaded_documents')
            .insert({
                tenant_id: tenantId,
                end_user_phone: phoneNumber,
                document_type: 'pdf',
                original_url: originalUrl,
                gcs_url: gcsUrl,
                filename: filename,
                document_category: analysis.documentType,
                analysis_result: analysis,
                confidence: analysis.confidence,
                products_found: analysis.productsFound || 0,
                created_at: new Date().toISOString()
            })
            .select()
            .single();
            
        if (error) throw error;
        console.log('[PDF_METADATA] Save successful, record ID:', data.id);
        return data;
    } catch (error) {
        console.error('[PDF_METADATA] Save failed:', error.message);
        // Don't throw - this is non-critical
        return null;
    }
};

module.exports = {
    uploadPDFToGCS,
    savePDFMetadata
};

