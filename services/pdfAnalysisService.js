// services/pdfAnalysisService.js
const { openai } = require('./config');
const { dbClient } = require('./config');
const fetch = require('node-fetch');

/**
 * Extract text from PDF using OpenAI API
 * @param {string} pdfUrl - URL of the PDF file
 * @returns {Promise<string>} - Extracted text content
 */
const extractTextFromPDF = async (pdfUrl) => {
    try {
        console.log('[PDF_OCR] Processing URL:', pdfUrl);
        // Ensure URL is properly formatted
        let processUrl = pdfUrl;
        if (!processUrl.startsWith('http://') && !processUrl.startsWith('https://')) {
            processUrl = 'https://' + processUrl;
        }
        console.log('[PDF_OCR] Using URL:', processUrl);

        // Download PDF as base64
        const response = await fetch(processUrl);
        if (!response.ok) {
            throw new Error(`Failed to download PDF: ${response.status}`);
        }
        
        const pdfBuffer = await response.buffer();
        const base64Data = pdfBuffer.toString('base64');
        
        // Use OpenAI to extract text from PDF
        const completion = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                {
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: "Extract all text content from this PDF document. Focus on product names, codes, quantities, prices, dates, and company information. Return the extracted text in a structured format."
                        },
                        {
                            type: "image_url",
                            image_url: {
                                url: `data:application/pdf;base64,${base64Data}`
                            }
                        }
                    ]
                }
            ],
            max_tokens: 1000,
            temperature: 0.1
        });

        const extractedText = completion.choices[0]?.message?.content || '';
        console.log('[PDF_OCR] Extracted text length:', extractedText.length);
        
        return extractedText;
    } catch (error) {
        console.error('[PDF_OCR] Text extraction failed:', error.message);
        return '';
    }
};

/**
 * Analyze PDF content and determine document type
 * @param {string} extractedText - Text extracted from PDF
 * @param {string} filename - Original filename
 * @returns {Object} - Analysis result with document type and confidence
 */
const analyzePDFContent = (extractedText, filename = '') => {
    const text = extractedText.toLowerCase();
    const filenameLC = filename.toLowerCase();
    
    console.log('[PDF_ANALYSIS] Analyzing content, text length:', text.length);
    
    // Document type patterns
    const patterns = {
        invoice: {
            keywords: ['invoice', 'bill', 'payment due', 'amount due', 'tax invoice', 'gst invoice'],
            patterns: [/invoice\s*#?\s*\d+/i, /bill\s*#?\s*\d+/i, /total\s*amount/i],
            filenameKeywords: ['invoice', 'bill']
        },
        purchase_order: {
            keywords: ['purchase order', 'po number', 'order date', 'delivery date', 'vendor'],
            patterns: [/po\s*#?\s*\d+/i, /purchase\s*order/i, /order\s*number/i],
            filenameKeywords: ['po', 'purchase', 'order']
        },
        quotation: {
            keywords: ['quotation', 'quote', 'estimate', 'proposal', 'valid until'],
            patterns: [/quote\s*#?\s*\d+/i, /quotation\s*#?\s*\d+/i, /estimate/i],
            filenameKeywords: ['quote', 'quotation', 'estimate']
        },
        receipt: {
            keywords: ['receipt', 'payment received', 'transaction', 'paid'],
            patterns: [/receipt\s*#?\s*\d+/i, /transaction\s*id/i, /paid/i],
            filenameKeywords: ['receipt', 'payment']
        },
        delivery_challan: {
            keywords: ['delivery challan', 'challan', 'goods delivered', 'transport'],
            patterns: [/challan\s*#?\s*\d+/i, /delivery\s*note/i, /transport/i],
            filenameKeywords: ['challan', 'delivery']
        },
        specification: {
            keywords: ['specification', 'datasheet', 'technical details', 'dimensions'],
            patterns: [/spec\s*sheet/i, /technical\s*specification/i, /datasheet/i],
            filenameKeywords: ['spec', 'datasheet', 'technical']
        }
    };
    
    let bestMatch = null;
    let highestScore = 0;
    
    // Analyze each document type
    for (const [type, config] of Object.entries(patterns)) {
        let score = 0;
        
        // Check keywords
        config.keywords.forEach(keyword => {
            if (text.includes(keyword)) score += 2;
        });
        
        // Check patterns
        config.patterns.forEach(pattern => {
            if (pattern.test(text)) score += 3;
        });
        
        // Check filename
        config.filenameKeywords.forEach(keyword => {
            if (filenameLC.includes(keyword)) score += 4;
        });
        
        if (score > highestScore) {
            highestScore = score;
            bestMatch = type;
        }
    }
    
    // Determine confidence
    let confidence = 'low';
    if (highestScore >= 6) confidence = 'high';
    else if (highestScore >= 3) confidence = 'medium';
    
    console.log('[PDF_ANALYSIS] Best match:', bestMatch, 'Score:', highestScore, 'Confidence:', confidence);
    
    return {
        documentType: bestMatch || 'general_document',
        confidence,
        score: highestScore,
        extractedText
    };
};

/**
 * Search for products mentioned in PDF text
 * @param {string} tenantId - Tenant ID
 * @param {string} extractedText - Text from PDF
 * @returns {Promise<Array>} - Found products
 */
const searchProductsInPDF = async (tenantId, extractedText) => {
    if (!extractedText || extractedText.length < 5) {
        return [];
    }

    try {
        console.log('[PDF_PRODUCT_SEARCH] Searching for products in text');
        
        // Extract potential product codes and names
        const productPatterns = [
            /NFF\s*\d+x\d+/gi,
            /\b\d+x\d+\b/g,
            /ANCHOR/gi,
            /[A-Z]{2,}\s*\d+/g
        ];
        
        const foundTerms = [];
        productPatterns.forEach(pattern => {
            const matches = extractedText.match(pattern);
            if (matches) {
                foundTerms.push(...matches);
            }
        });
        
        if (foundTerms.length === 0) {
            return [];
        }
        
        console.log('[PDF_PRODUCT_SEARCH] Found terms:', foundTerms);
        
        // Search database for matching products
        const searchConditions = foundTerms.map(term => 
            `name.ilike.%${term}%,description.ilike.%${term}%,sku.ilike.%${term}%`
        ).join(',');

        const { data: products, error } = await dbClient
            .from('products')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('is_active', true)
            .or(searchConditions)
            .limit(10);

        if (error) {
            console.error('[PDF_PRODUCT_SEARCH] Database error:', error.message);
            return [];
        }

        console.log('[PDF_PRODUCT_SEARCH] Found products:', products?.length || 0);
        return products || [];

    } catch (error) {
        console.error('[PDF_PRODUCT_SEARCH] Search failed:', error.message);
        return [];
    }
};

/**
 * Generate contextual response based on PDF analysis
 * @param {Object} analysis - PDF analysis result
 * @param {Array} products - Found products
 * @param {string} filename - Original filename
 * @returns {Object} - Response object
 */
const generatePDFResponse = (analysis, products = [], filename = '') => {
    const { documentType, confidence, extractedText } = analysis;
    
    // Base responses for different document types
    const responses = {
        invoice: {
            high: "I can see this is an invoice document. I've forwarded this to our accounts team for processing. They'll verify the details and contact you regarding payment status.",
            medium: "This appears to be a billing document. I've sent it to our accounts team for review. They'll get back to you shortly.",
            low: "I've received your document and forwarded it to our accounts team for review."
        },
        purchase_order: {
            high: "Thank you for the purchase order! I've forwarded this to our fulfillment team immediately. They'll review the requirements and confirm the delivery timeline within 2 hours.",
            medium: "I can see this is an order document. Our fulfillment team has been notified and will process this request promptly.",
            low: "I've received your order document and our team will review it shortly."
        },
        quotation: {
            high: "I see you've shared a quotation request. Our sales team has been notified and will provide you with detailed pricing and specifications within 4 hours.",
            medium: "Thank you for sharing the quotation details. Our sales team will review and respond with pricing shortly.",
            low: "I've received your quotation request and our team will get back to you."
        },
        receipt: {
            high: "Thank you for sharing the payment receipt! I've noted this in our records and forwarded it to accounts for verification.",
            medium: "I can see this is a payment document. Our accounts team will verify and update the records.",
            low: "Payment document received and forwarded to accounts team."
        },
        delivery_challan: {
            high: "Delivery challan received! I've noted the delivery details and our logistics team will verify the shipment status.",
            medium: "Thank you for the delivery document. Our team will verify the shipment details.",
            low: "Delivery document received and being processed."
        },
        specification: {
            high: "I can see this contains technical specifications. Our technical team will review these requirements and provide suitable product recommendations.",
            medium: "Technical document received. Our team will review the specifications and respond accordingly.",
            low: "Specification document received and under review."
        },
        general_document: {
            high: "Thank you for sharing this document! I've reviewed the content and forwarded it to the appropriate team for processing.",
            medium: "Document received and being reviewed by our team. We'll get back to you with relevant information.",
            low: "Document received. Our team will review and respond appropriately."
        }
    };
    
    let message = responses[documentType]?.[confidence] || responses.general_document.low;
    
    // Add product information if found
    if (products.length > 0) {
        const productNames = products.slice(0, 3).map(p => p.name).join(', ');
        message += `\n\nI noticed these products mentioned: ${productNames}. Let me know if you need pricing or specifications for any of these.`;
    }
    
    return {
        type: `pdf_${documentType}`,
        message,
        documentType,
        confidence,
        productsFound: products.length,
        products: products.slice(0, 5) // Limit to top 5
    };
};

/**
 * Complete PDF analysis workflow
 * @param {string} pdfUrl - URL of the PDF
 * @param {string} tenantId - Tenant ID
 * @param {string} filename - Original filename
 * @returns {Promise<Object>} - Complete analysis result
 */
const analyzePDF = async (pdfUrl, tenantId, filename = '') => {
    try {
        console.log('[PDF_ANALYSIS] Starting complete analysis for:', filename);
        
        // Extract text from PDF
        const extractedText = await extractTextFromPDF(pdfUrl);
        
        // Analyze document type
        const analysis = analyzePDFContent(extractedText, filename);
        
        // Search for products
        const products = await searchProductsInPDF(tenantId, extractedText);
        
        // Generate response
        const response = generatePDFResponse(analysis, products, filename);
        
        console.log('[PDF_ANALYSIS] Complete analysis finished:', response.type);
        
        return {
            ...response,
            extractedText,
            analysis
        };
        
    } catch (error) {
        console.error('[PDF_ANALYSIS] Complete analysis failed:', error.message);
        return {
            type: 'pdf_processing_error',
            message: "I received your PDF document and our team will review it. There was a minor issue processing it automatically, but we'll handle it manually.",
            error: error.message
        };
    }
};

module.exports = {
    extractTextFromPDF,
    analyzePDFContent,
    searchProductsInPDF,
    generatePDFResponse,
    analyzePDF
};

