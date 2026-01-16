// services/documentRetrievalService.js
// Document retrieval from Google Cloud Storage

const { Storage } = require('@google-cloud/storage');
const { dbClient } = require('./config');

// Initialize GCS client
let storage = null;
let bucket = null;

const initializeGCS = () => {
  if (!storage) {
    try {
      storage = new Storage({
        keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
        projectId: process.env.GOOGLE_CLOUD_PROJECT_ID
      });
      bucket = storage.bucket(process.env.GOOGLE_CLOUD_STORAGE_BUCKET);
      console.log('[GCS_INIT] Google Cloud Storage initialized');
    } catch (error) {
      console.error('[GCS_INIT] Failed to initialize GCS:', error.message);
      return false;
    }
  }
  return true;
};

/**
 * Document types and their GCS folder mappings
 */
const DOCUMENT_TYPES = {
  CATALOG: 'catalogs',
  TECHNICAL: 'technical_docs',
  PRODUCT_IMAGE: 'product_images',
  PRICE_LIST: 'pricelists',
  INSTALLATION_GUIDE: 'installation_guides',
  BROCHURE: 'brochures'
};

/**
 * List all documents in a specific category
 */
const listDocumentsByCategory = async (category) => {
  try {
    if (!initializeGCS()) {
      throw new Error('GCS not configured');
    }

    const folder = DOCUMENT_TYPES[category] || category;
    const [files] = await bucket.getFiles({ prefix: `${folder}/` });

    const documents = files
      .filter(file => !file.name.endsWith('/')) // Exclude folder entries
      .map(file => ({
        name: file.name.split('/').pop(),
        fullPath: file.name,
        url: `https://storage.googleapis.com/${bucket.name}/${file.name}`,
        size: file.metadata.size,
        contentType: file.metadata.contentType,
        updated: file.metadata.updated
      }));

    console.log(`[DOC_RETRIEVAL] Found ${documents.length} documents in ${folder}`);
    return { success: true, documents };

  } catch (error) {
    console.error('[DOC_RETRIEVAL] Error listing documents:', error);
    return { success: false, error: error.message, documents: [] };
  }
};

/**
 * Search for documents related to a product
 */
const findProductDocuments = async (productCode, documentType = null) => {
  try {
    if (!initializeGCS()) {
      throw new Error('GCS not configured');
    }

    // Clean product code for search
    const cleanCode = productCode.replace(/\s+/g, '_').toLowerCase();
    console.log(`[DOC_SEARCH] Searching for documents matching: ${cleanCode}`);

    const searchFolders = documentType
      ? [DOCUMENT_TYPES[documentType]]
      : Object.values(DOCUMENT_TYPES);

    const allMatches = [];

    for (const folder of searchFolders) {
      const [files] = await bucket.getFiles({ prefix: `${folder}/` });

      const matches = files
        .filter(file => {
          const fileName = file.name.toLowerCase();
          return fileName.includes(cleanCode) && !file.name.endsWith('/');
        })
        .map(file => ({
          name: file.name.split('/').pop(),
          fullPath: file.name,
          url: `https://storage.googleapis.com/${bucket.name}/${file.name}`,
          type: folder,
          size: file.metadata.size,
          contentType: file.metadata.contentType,
          updated: file.metadata.updated
        }));

      allMatches.push(...matches);
    }

    console.log(`[DOC_SEARCH] Found ${allMatches.length} documents for ${productCode}`);
    return { success: true, documents: allMatches };

  } catch (error) {
    console.error('[DOC_SEARCH] Error searching documents:', error);
    return { success: false, error: error.message, documents: [] };
  }
};

/**
 * Get a signed URL for a document (temporary access)
 */
const getSignedDocumentUrl = async (filePath, expiryMinutes = 60) => {
  try {
    if (!initializeGCS()) {
      throw new Error('GCS not configured');
    }

    const file = bucket.file(filePath);

    // Check if file exists
    const [exists] = await file.exists();
    if (!exists) {
      return { success: false, error: 'Document not found' };
    }

    // Generate signed URL
    const [signedUrl] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + expiryMinutes * 60 * 1000
    });

    console.log(`[DOC_URL] Generated signed URL for ${filePath}`);
    return { success: true, url: signedUrl, expiresIn: expiryMinutes };

  } catch (error) {
    console.error('[DOC_URL] Error generating signed URL:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Get the latest catalog
 */
const getLatestCatalog = async (tenantId) => {
  try {
    // First check if tenant has a specific catalog configured
    const { data: tenantData } = await dbClient
      .from('tenants')
      .select('catalog_file_path')
      .eq('id', tenantId)
      .single();

    if (tenantData?.catalog_file_path) {
      console.log('[CATALOG] Using tenant-specific catalog:', tenantData.catalog_file_path);
      return await getSignedDocumentUrl(tenantData.catalog_file_path);
    }

    // Otherwise, get the latest catalog from GCS
    const result = await listDocumentsByCategory('CATALOG');

    if (!result.success || result.documents.length === 0) {
      return { success: false, error: 'No catalog available' };
    }

    // Sort by updated date and get the latest
    const latestCatalog = result.documents.sort((a, b) =>
      new Date(b.updated) - new Date(a.updated)
    )[0];

    // Get signed URL
    return await getSignedDocumentUrl(latestCatalog.fullPath);

  } catch (error) {
    console.error('[CATALOG] Error retrieving catalog:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Get the latest price list
 */
const getLatestPriceList = async (tenantId) => {
  try {
    // Check for tenant-specific price list
    const { data: tenantData } = await dbClient
      .from('tenants')
      .select('price_list_file_path')
      .eq('id', tenantId)
      .single();

    if (tenantData?.price_list_file_path) {
      console.log('[PRICELIST] Using tenant-specific price list:', tenantData.price_list_file_path);
      return await getSignedDocumentUrl(tenantData.price_list_file_path);
    }

    // Get latest from GCS
    const result = await listDocumentsByCategory('PRICE_LIST');

    if (!result.success || result.documents.length === 0) {
      return { success: false, error: 'No price list available' };
    }

    const latestPriceList = result.documents.sort((a, b) =>
      new Date(b.updated) - new Date(a.updated)
    )[0];

    return await getSignedDocumentUrl(latestPriceList.fullPath);

  } catch (error) {
    console.error('[PRICELIST] Error retrieving price list:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Get technical documentation for a product
 */
const getTechnicalDocs = async (productCode) => {
  try {
    const result = await findProductDocuments(productCode, 'TECHNICAL');

    if (!result.success || result.documents.length === 0) {
      return { success: false, error: 'No technical documentation found for this product' };
    }

    // Get signed URLs for all technical docs
    const docsWithUrls = await Promise.all(
      result.documents.map(async (doc) => {
        const urlResult = await getSignedDocumentUrl(doc.fullPath);
        return {
          ...doc,
          signedUrl: urlResult.success ? urlResult.url : null
        };
      })
    );

    return { success: true, documents: docsWithUrls.filter(d => d.signedUrl) };

  } catch (error) {
    console.error('[TECHNICAL_DOCS] Error retrieving technical docs:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Get product images
 */
const getProductImages = async (productCode) => {
  try {
    const result = await findProductDocuments(productCode, 'PRODUCT_IMAGE');

    if (!result.success || result.documents.length === 0) {
      return { success: false, error: 'No product images found' };
    }

    // Get signed URLs for all images
    const imagesWithUrls = await Promise.all(
      result.documents.map(async (img) => {
        const urlResult = await getSignedDocumentUrl(img.fullPath);
        return {
          ...img,
          signedUrl: urlResult.success ? urlResult.url : null
        };
      })
    );

    return { success: true, images: imagesWithUrls.filter(i => i.signedUrl) };

  } catch (error) {
    console.error('[PRODUCT_IMAGES] Error retrieving product images:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Upload a document to GCS (for admin use)
 */
const uploadDocument = async (fileBuffer, fileName, category, metadata = {}) => {
  try {
    if (!initializeGCS()) {
      throw new Error('GCS not configured');
    }

    const folder = DOCUMENT_TYPES[category] || 'miscellaneous';
    const filePath = `${folder}/${fileName}`;
    const file = bucket.file(filePath);

    await file.save(fileBuffer, {
      metadata: {
        contentType: metadata.contentType || 'application/octet-stream',
        metadata: {
          uploadedAt: new Date().toISOString(),
          uploadedBy: metadata.uploadedBy || 'system',
          ...metadata
        }
      }
    });

    // Make file publicly readable
    await file.makePublic();

    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${filePath}`;

    console.log('[DOC_UPLOAD] Document uploaded successfully:', publicUrl);
    return { success: true, url: publicUrl, path: filePath };

  } catch (error) {
    console.error('[DOC_UPLOAD] Error uploading document:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Delete a document from GCS (for admin use)
 */
const deleteDocument = async (filePath) => {
  try {
    if (!initializeGCS()) {
      throw new Error('GCS not configured');
    }

    const file = bucket.file(filePath);
    await file.delete();

    console.log('[DOC_DELETE] Document deleted:', filePath);
    return { success: true };

  } catch (error) {
    console.error('[DOC_DELETE] Error deleting document:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Handle customer document request
 */
const handleDocumentRequest = async (requestType, productCode, tenantId) => {
  try {
    console.log(`[DOC_REQUEST] Type: ${requestType}, Product: ${productCode}, Tenant: ${tenantId}`);

    let result;
    let responseMessage = '';

    switch (requestType) {
      case 'CATALOG':
        result = await getLatestCatalog(tenantId);
        if (result.success) {
          responseMessage = `📘 *Product Catalog*\n\nHere's our latest catalog:\n\n${result.url}\n\n_Link expires in ${result.expiresIn} minutes_`;
        } else {
          responseMessage = '❌ Sorry, catalog is currently unavailable. Please contact us directly.';
        }
        break;

      case 'PRICE_LIST':
        result = await getLatestPriceList(tenantId);
        if (result.success) {
          responseMessage = `💰 *Price List*\n\nHere's our latest price list:\n\n${result.url}\n\n_Link expires in ${result.expiresIn} minutes_`;
        } else {
          responseMessage = '❌ Sorry, price list is currently unavailable. Please contact us directly.';
        }
        break;

      case 'TECHNICAL':
        if (!productCode) {
          responseMessage = '❌ Please specify the product code. Example: "technical specs for NFF 8x80"';
          break;
        }
        result = await getTechnicalDocs(productCode);
        if (result.success && result.documents.length > 0) {
          responseMessage = `📋 *Technical Documentation for ${productCode}*\n\n`;
          result.documents.forEach((doc, index) => {
            responseMessage += `${index + 1}. ${doc.name}\n${doc.signedUrl}\n\n`;
          });
          responseMessage += '_Links expire in 60 minutes_';
        } else {
          responseMessage = `❌ No technical documentation found for ${productCode}. Please contact us for details.`;
        }
        break;

      case 'PRODUCT_IMAGE':
        if (!productCode) {
          responseMessage = '❌ Please specify the product code. Example: "show images of NFF 8x80"';
          break;
        }
        result = await getProductImages(productCode);
        if (result.success && result.images.length > 0) {
          responseMessage = `📸 *Product Images for ${productCode}*\n\n`;
          result.images.forEach((img, index) => {
            responseMessage += `Image ${index + 1}:\n${img.signedUrl}\n\n`;
          });
          responseMessage += '_Links expire in 60 minutes_';
        } else {
          responseMessage = `❌ No product images found for ${productCode}. Please contact us for images.`;
        }
        break;

      default:
        responseMessage = '❌ Sorry, I didn\'t understand that request. Try:\n• "send catalog"\n• "price list"\n• "technical specs for [product]"\n• "show images of [product]"';
    }

    return { success: true, message: responseMessage };

  } catch (error) {
    console.error('[DOC_REQUEST] Error handling request:', error);
    return {
      success: false,
      message: '❌ Sorry, there was an error processing your request. Please try again later.'
    };
  }
};

module.exports = {
  // Main functions for customer requests
  handleDocumentRequest,
  getLatestCatalog,
  getLatestPriceList,
  getTechnicalDocs,
  getProductImages,

  // Admin functions
  uploadDocument,
  deleteDocument,
  listDocumentsByCategory,
  findProductDocuments,
  getSignedDocumentUrl,

  // Constants
  DOCUMENT_TYPES
};


