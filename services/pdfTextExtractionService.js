// services/pdfTextExtractionService.js
const fetch = require('node-fetch');
const pdf = require('pdf-parse');

class PDFTextExtractionService {

    /**
     * High-level GST extraction flow: extract text, detect GST cert, parse details
     */
    static async extractGSTFromPDF(pdfUrl, filename = 'document.pdf') {
        console.log('[GST_FLOW] Starting GST extraction flow for:', filename);
        // 1) Extract text (comprehensive: direct -> OCR fallback -> manual flag)
        const extractionResult = await this.extractTextComprehensive(pdfUrl, filename);
        const finalText = extractionResult.final_text || '';
        // 2) Detect if likely GST certificate
        const detection = this.detectGSTCertificate(finalText, filename);
        if (!detection.isGSTCertificate) {
            return {
                success: false,
                reason: 'not_gst_document',
                detection,
                extractionResult
            };
        }
        // 3) Parse details using helper
    const gstDetails = this.extractGSTDetails(finalText);
    console.log('[GST_EXTRACT_RESULT] gstDetails ->', JSON.stringify(gstDetails || {}, null, 2));
        return {
            success: true,
            detection,
            extractionResult,
            gstDetails
        };
    }
    
    /**
     * Primary method: Extract text directly from PDF using pdf-parse
     */
    static async extractTextFromPDF(pdfUrl) {
        console.log('[PDF_TEXT] Starting direct PDF text extraction from:', pdfUrl);
        
        try {
            // Download PDF
            console.log('[PDF_TEXT] Downloading PDF...');
            const response = await fetch(pdfUrl);
            if (!response.ok) {
                throw new Error(`Failed to download PDF: ${response.status} ${response.statusText}`);
            }
            
            const pdfBuffer = await response.buffer();
            console.log('[PDF_TEXT] PDF downloaded, size:', pdfBuffer.length, 'bytes');
            
            // Extract text using pdf-parse
            console.log('[PDF_TEXT] Extracting text with pdf-parse...');
            const data = await pdf(pdfBuffer);
            
            const extractedText = data.text.trim();
            console.log('[PDF_TEXT] Extraction complete. Text length:', extractedText.length);
            console.log('[PDF_TEXT] First 200 chars:', extractedText.substring(0, 200));
            
            if (extractedText.length < 20) {
                console.log('[PDF_TEXT] Warning: Very short text extracted, might be image-based PDF');
                return {
                    success: false,
                    text: extractedText,
                    method: 'pdf-parse',
                    requiresOCR: true,
                    error: 'Insufficient text content - may be scanned/image PDF'
                };
            }
            
            return {
                success: true,
                text: extractedText,
                method: 'pdf-parse',
                pages: data.numpages,
                requiresOCR: false
            };
            
        } catch (error) {
            console.error('[PDF_TEXT] Direct extraction failed:', error.message);
            return {
                success: false,
                text: null,
                method: 'pdf-parse',
                requiresOCR: true,
                error: error.message
            };
        }
    }
    
    /**
     * Convert PDF to images for OCR processing (fallback method)
     */
    static async convertPDFToImages(pdfUrl) {
        console.log('[PDF_CONVERT] Converting PDF to images for OCR...');
        
        // This would require pdf-poppler or similar
        // For now, return indication that OCR conversion is needed
        return {
            success: false,
            error: 'PDF to image conversion not implemented',
            recommendation: 'Use external service or pdf2pic library'
        };
    }
    
    /**
     * Comprehensive PDF text extraction with multiple fallbacks
     */
    static async extractTextComprehensive(pdfUrl, filename = 'document.pdf') {
        console.log('[PDF_COMPREHENSIVE] Starting comprehensive extraction for:', filename);
        
        const results = {
            url: pdfUrl,
            filename: filename,
            methods_attempted: [],
            final_text: null,
            success: false,
            requires_manual_review: false
        };
        
        // Method 1: Direct PDF text extraction
        console.log('[PDF_COMPREHENSIVE] Method 1: Direct PDF text extraction');
        results.methods_attempted.push('pdf-parse');
        
        const directResult = await this.extractTextFromPDF(pdfUrl);
        if (directResult.success && directResult.text.length > 50) {
            console.log('[PDF_COMPREHENSIVE] Success with direct extraction');
            results.final_text = directResult.text;
            results.success = true;
            results.method_used = 'pdf-parse';
            results.pages = directResult.pages;
            return results;
        }
        
        // Method 2: OCR fallback (would need PDF to image conversion)
        console.log('[PDF_COMPREHENSIVE] Method 2: OCR fallback needed');
        results.methods_attempted.push('ocr-attempted');
        
        // For production, you'd implement PDF to image conversion here
        // const ocrResult = await this.convertAndOCR(pdfUrl);
        
        // Method 3: Manual review required
        console.log('[PDF_COMPREHENSIVE] Manual review required');
        results.methods_attempted.push('manual-review');
        results.requires_manual_review = true;
        results.final_text = `GST Certificate: ${filename}\nDirect PDF text extraction failed - manual review required for image-based PDF.`;
        results.success = true; // Success in handling, even if extraction incomplete
        results.method_used = 'manual-review-flagged';
        
        return results;
    }
    
    /**
     * Detect if PDF is likely a GST certificate based on text content
     */
    static detectGSTCertificate(text, filename) {
        const gstIndicators = [
            'goods and services tax',
            'gst',
            'gstin',
            'registration certificate',
            'tax registration',
            'principal place of business',
            'legal name',
            'trade name',
            'constitution of business',
            'date of registration',
            'valid from',
            'commissioner',
            'central tax',
            'state tax'
        ];
        
        const lowerText = text.toLowerCase();
        const lowerFilename = filename.toLowerCase();
        
        const textMatches = gstIndicators.filter(indicator => 
            lowerText.includes(indicator)
        ).length;
        
        const filenameMatches = ['gst', 'certificate', 'registration'].filter(word =>
            lowerFilename.includes(word)
        ).length;
        
        const confidence = (textMatches * 0.7) + (filenameMatches * 0.3);
        const isGSTCertificate = confidence > 2 || textMatches >= 3;
        
        console.log('[GST_DETECT] Analysis:', {
            textMatches,
            filenameMatches,
            confidence,
            isGSTCertificate
        });
        
        return {
            isGSTCertificate,
            confidence,
            textMatches,
            filenameMatches,
            indicators_found: gstIndicators.filter(indicator => 
                lowerText.includes(indicator)
            )
        };
    }
    
    /**
     * Extract GST details from certificate text
     */
    static extractGSTDetails(text) {
        console.log('[GST_EXTRACT] ========================================');
        console.log('[GST_EXTRACT] Starting GST detail extraction');
        console.log('[GST_EXTRACT] Text length:', text.length);
        console.log('[GST_EXTRACT] First 500 chars:', text.substring(0, 500));
        console.log('[GST_EXTRACT] ========================================');
        // Use the helper parser which is more robust
        const { parseGSTCertificateText } = require('./pdfTextExtractionHelpers');
        const parsed = parseGSTCertificateText(text);
        console.log('[GST_EXTRACT] Helper parser result:', JSON.stringify(parsed, null, 2));
        console.log('[GST_EXTRACT] Proprietor name from helper:', parsed.proprietor_name);
        // Improved validation: reject if proprietor name is actually a company name
        const isValidPersonName = (name, legalName, tradeName) => {
            if (!name || name.length < 5) return false;
            // Reject if it's the same as company names
            if (name === legalName || name === tradeName) {
                console.log('[GST_EXTRACT] Rejected: proprietor name matches company name');
                return false;
            }
            // Reject common business suffixes/words
            const businessWords = ['SOLUTIONS', 'ENTERPRISES', 'PVT', 'LTD', 'LIMITED', 'INDIA', 
                                   'CORPORATION', 'COMPANY', 'INDUSTRIES', 'SERVICES', 'TRADING'];
            if (businessWords.some(word => name.toUpperCase().includes(word))) {
                console.log('[GST_EXTRACT] Rejected: contains business word');
                return false;
            }
            // Prefer names with at least 2 parts (first + last name)
            const nameParts = name.trim().split(/\s+/).filter(p => p.length > 1);
            if (nameParts.length < 2) {
                console.log('[GST_EXTRACT] Rejected: insufficient name parts');
                return false;
            }
            return true;
        };
        // If helper didn't get a valid person name, try enhanced patterns
        if (!isValidPersonName(parsed.proprietor_name, parsed.legal_name, parsed.trade_name)) {
            console.log('[GST_EXTRACT] Helper failed to get valid proprietor name. Trying enhanced patterns...');
            // Look for Annexure B section
            const annexBIndex = text.indexOf('Annexure B');
            if (annexBIndex !== -1) {
                console.log('[GST_EXTRACT] Found Annexure B at index:', annexBIndex);
                const annexBSection = text.substring(annexBIndex, annexBIndex + 800);
                console.log('[GST_EXTRACT] Annexure B section (800 chars):', annexBSection);
            } else {
                console.log('[GST_EXTRACT] WARNING: Annexure B not found in text');
            }
            // Enhanced proprietor extraction patterns
            const proprietorPatterns = [
                { name: 'Annexure B Name', regex: /Annexure B[\s\S]{0,500}?(?:1\s+)?Name\s+([A-Z][A-Z\s\.]{5,100}?)\s*(?:Designation|Status|Resident)/i },
                { name: 'Details section', regex: /Details of\s+(?:Managing|Authorized)?\s*(?:Partners?|Proprietor)[\s\S]{0,200}?Name\s+([A-Z][A-Z\s\.]{5,100}?)\s*(?:Designation|Status)/i },
                { name: 'After Proprietor label', regex: /(?:Proprietor|Partner)[\s\S]{0,100}?Name[:\s]+([A-Z][A-Z\s\.]{5,100}?)\s*Designation/i },
                { name: 'Name-Designation pair', regex: /\n\s*Name\s+([A-Z][A-Z\s\.]{5,100}?)\s*(?:\n|Designation)/i }
            ];
            for (const pattern of proprietorPatterns) {
                console.log(`[GST_EXTRACT] Trying pattern: ${pattern.name}`);
                const match = text.match(pattern.regex);
                if (match) {
                    console.log(`[GST_EXTRACT] Pattern "${pattern.name}" matched:`, match[0].substring(0, 100));
                    if (match[1]) {
                        const extractedName = match[1].trim();
                        console.log(`[GST_EXTRACT] Extracted name: "${extractedName}"`);
                        console.log(`[GST_EXTRACT] Name length: ${extractedName.length}`);
                        // Use the same validation
                        if (isValidPersonName(extractedName, parsed.legal_name, parsed.trade_name)) {
                            parsed.proprietor_name = extractedName;
                            console.log('[GST_EXTRACT] ✅ SUCCESS: Enhanced pattern found valid name:', extractedName);
                            break;
                        } else {
                            console.log('[GST_EXTRACT] ❌ REJECTED: Name failed validation');
                        }
                    }
                } else {
                    console.log(`[GST_EXTRACT] Pattern "${pattern.name}" did not match`);
                }
            }
        } else {
            console.log('[GST_EXTRACT] ✅ Helper parser got valid proprietor name:', parsed.proprietor_name);
        }
        // Final result
        console.log('[GST_EXTRACT] ========================================');
        console.log('[GST_EXTRACT] FINAL EXTRACTION RESULT:');
        console.log('[GST_EXTRACT] GST Number:', parsed.gst_number);
        console.log('[GST_EXTRACT] Legal Name:', parsed.legal_name);
        console.log('[GST_EXTRACT] Trade Name:', parsed.trade_name);
        console.log('[GST_EXTRACT] Proprietor Name:', parsed.proprietor_name);
        console.log('[GST_EXTRACT] ========================================');
        // Add confidence score
        parsed.confidence_score = 1;
        return parsed;
    }
    // Remove misplaced object literal here. If this was meant to be a return statement, place it inside a method.
}

module.exports = PDFTextExtractionService;
