const { bucket } = require('./config');
const { dbClient } = require('./config');
const fetch = require('node-fetch');
const path = require('path');
const crypto = require('crypto');

/**
 * Upload image from URL to Google Cloud Storage
 * @param {string} imageUrl - Source image URL (from Maytapi)
 * @param {string} tenantId - Tenant ID for organizing files
 * @param {string} category - Category (e.g., 'customer_uploads', 'product_images')
 * @returns {Promise<string>} - GCS public URL
 */
const uploadImageToGCS = async (imageUrl, tenantId, category = 'customer_uploads') => {
    try {
        console.log('[GCS_UPLOAD] Starting upload for:', imageUrl);
        
        // Download image from Maytapi
        const response = await fetch(imageUrl);
        if (!response.ok) {
            throw new Error(`Failed to download image: ${response.status}`);
        }
        
        const imageBuffer = await response.buffer();
        const contentType = response.headers.get('content-type') || 'image/jpeg';
        
        // Generate unique filename
        const timestamp = Date.now();
        const hash = crypto.createHash('md5').update(imageBuffer).digest('hex').substring(0, 8);
        const extension = contentType.split('/')[1] || 'jpg';
        const fileName = `${category}/${tenantId}/${timestamp}_${hash}.${extension}`;
        
        // Upload to GCS
        const file = bucket.file(fileName);
        await file.save(imageBuffer, {
            metadata: {
                contentType,
                metadata: {
                    tenantId,
                    category,
                    originalUrl: imageUrl,
                    uploadedAt: new Date().toISOString()
                }
            }
        });
        
        // Make file publicly accessible
        await file.makePublic();
        
        // Get public URL
        const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
        
        console.log('[GCS_UPLOAD] Upload successful:', publicUrl);
        return publicUrl;
        
    } catch (error) {
        console.error('[GCS_UPLOAD] Upload failed:', error.message);
        throw error;
    }
};

/**
 * Save uploaded image metadata to database
 */
const saveImageMetadata = async (tenantId, phoneNumber, originalUrl, gcsUrl, category, analysis) => {
    try {
        const { data, error } = await dbClient
            .from('uploaded_images')
            .insert({
                tenant_id: tenantId,
                end_user_phone: phoneNumber,
                original_url: originalUrl,
                gcs_url: gcsUrl,
                category,
                analysis_result: analysis,
                created_at: new Date().toISOString()
            })
            .select()
            .single();
            
        if (error) throw error;
        return data;
    } catch (error) {
        console.error('[IMAGE_METADATA] Save failed:', error.message);
        throw error;
    }
};

module.exports = {
    uploadImageToGCS,
    saveImageMetadata
};


