// services/gstVerificationService.js
const axios = require('axios');

class GSTVerificationService {
    
    /**
     * Verify GST number and fetch business details from government API
     */
    async verifyGSTNumber(gstNumber) {
        try {
            // Clean and validate GST number format
            const cleanGST = gstNumber.replace(/\s+/g, '').toUpperCase();
            
            if (!this.isValidGSTFormat(cleanGST)) {
                return {
                    success: false,
                    error: 'Invalid GST number format',
                    gstNumber: cleanGST
                };
            }

            // Try multiple GST verification sources
            let result = await this.verifyFromPrimaryAPI(cleanGST);
            
            if (!result.success) {
                // Fallback to alternative API
                result = await this.verifyFromAlternateAPI(cleanGST);
            }

            if (result.success) {
                // Standardize the response format
                return this.standardizeGSTResponse(cleanGST, result.data);
            } else {
                return {
                    success: false,
                    error: 'GST verification failed',
                    gstNumber: cleanGST
                };
            }

        } catch (error) {
            console.error('GST verification error:', error);
            return {
                success: false,
                error: 'GST verification service unavailable',
                gstNumber: gstNumber
            };
        }
    }

    /**
     * Primary GST verification using government API
     */
    async verifyFromPrimaryAPI(gstNumber) {
        try {
            // Using GST government portal API (requires registration)
            // You need to register at https://commonapi.nic.in/
            const response = await axios.post('https://commonapi.nic.in/gst/verify', {
                gstno: gstNumber
            }, {
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-KEY': process.env.GST_API_KEY // Set this in your environment
                },
                timeout: 10000
            });

            if (response.data && response.data.status === 'success') {
                return {
                    success: true,
                    data: response.data.result
                };
            } else {
                return { success: false, error: 'GST not found' };
            }

        } catch (error) {
            console.error('Primary GST API error:', error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Alternative GST verification using third-party service
     */
    async verifyFromAlternateAPI(gstNumber) {
        try {
            // Using a third-party GST verification service
            // Services like Clear Tax, Vakilsearch, etc. offer APIs
            const response = await axios.get(`https://api.cleartax.in/v1/gst/taxpayers/${gstNumber}`, {
                headers: {
                    'Authorization': `Bearer ${process.env.CLEARTAX_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                timeout: 10000
            });

            if (response.data && response.data.taxpayer) {
                return {
                    success: true,
                    data: response.data.taxpayer
                };
            } else {
                return { success: false, error: 'GST not found in alternate API' };
            }

        } catch (error) {
            console.error('Alternate GST API error:', error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Free GST verification using web scraping (backup method)
     */
    async verifyFromPublicPortal(gstNumber) {
        try {
            // This is a backup method that scrapes the public GST portal
            // Note: Web scraping may break if the portal changes
            
            const response = await axios.post('https://services.gst.gov.in/services/searchtp', {
                gstin: gstNumber
            }, {
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                timeout: 15000
            });

            // Parse the response (this depends on the actual portal structure)
            if (response.data && response.data.sts === 'success') {
                return {
                    success: true,
                    data: response.data
                };
            } else {
                return { success: false, error: 'GST not found in public portal' };
            }

        } catch (error) {
            console.error('Public portal GST verification error:', error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Validate GST number format
     */
    isValidGSTFormat(gstNumber) {
        // GST format: 2 digits state code + 10 digits PAN + 1 digit entity + 1 digit check + 1 character check digit
        const gstRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
        return gstRegex.test(gstNumber);
    }

    /**
     * Standardize GST verification response
     */
    standardizeGSTResponse(gstNumber, data) {
        // Standardize different API response formats
        return {
            success: true,
            gstNumber: gstNumber,
            businessDetails: {
                legalName: data.lgnm || data.legal_name || data.taxpayerName,
                tradeName: data.tradeNam || data.trade_name || data.tradeName,
                registrationDate: data.rgdt || data.registration_date || data.registrationDate,
                businessType: data.ctb || data.business_type || data.constitutionOfBusiness,
                status: data.sts || data.status || 'Active',
                address: {
                    building: data.addr?.bno || data.address?.building,
                    street: data.addr?.st || data.address?.street,
                    location: data.addr?.loc || data.address?.location,
                    district: data.addr?.dst || data.address?.district,
                    state: data.addr?.stcd || data.address?.state,
                    pincode: data.addr?.pncd || data.address?.pincode,
                    fullAddress: this.formatAddress(data.addr || data.address)
                },
                businessNature: data.nba || data.business_nature,
                taxPayerType: data.dty || data.taxpayer_type,
                filingStatus: data.lstupdt || data.last_updated,
                isActive: this.determineActiveStatus(data.sts || data.status)
            },
            lastUpdated: new Date().toISOString(),
            source: 'gst_api',
            confidence: 1.0
        };
    }

    /**
     * Format address from API response
     */
    formatAddress(addressData) {
        if (!addressData) return '';
        
        const parts = [
            addressData.bno || addressData.building,
            addressData.st || addressData.street,
            addressData.loc || addressData.location,
            addressData.dst || addressData.district,
            addressData.stcd || addressData.state,
            addressData.pncd || addressData.pincode
        ].filter(part => part && part.trim() !== '');
        
        return parts.join(', ');
    }

    /**
     * Determine if business is active
     */
    determineActiveStatus(status) {
        if (!status) return true;
        const activeStatuses = ['Active', 'active', 'ACTIVE', 'Compliant'];
        return activeStatuses.includes(status);
    }

    /**
     * Extract state code from GST number
     */
    getStateFromGST(gstNumber) {
        const stateCode = gstNumber.substring(0, 2);
        const stateMap = {
            '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab',
            '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana',
            '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh',
            '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh',
            '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram',
            '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam',
            '19': 'West Bengal', '20': 'Jharkhand', '21': 'Orissa',
            '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat',
            '25': 'Daman and Diu', '26': 'Dadra and Nagar Haveli',
            '27': 'Maharashtra', '28': 'Andhra Pradesh', '29': 'Karnataka',
            '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala',
            '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman and Nicobar Islands',
            '36': 'Telangana', '37': 'Andhra Pradesh'
        };
        
        return stateMap[stateCode] || 'Unknown State';
    }

    /**
     * Validate PAN from GST number
     */
    extractPANFromGST(gstNumber) {
        // PAN is characters 3-12 of GST number
        return gstNumber.substring(2, 12);
    }

    /**
     * Comprehensive GST verification with all methods
     */
    async comprehensiveGSTVerification(gstNumber) {
        const results = {
            gstNumber: gstNumber,
            isValid: false,
            businessDetails: null,
            verificationMethods: [],
            errors: []
        };

        // Try all verification methods
        const methods = [
            { name: 'primary_api', func: this.verifyFromPrimaryAPI.bind(this) },
            { name: 'alternate_api', func: this.verifyFromAlternateAPI.bind(this) },
            { name: 'public_portal', func: this.verifyFromPublicPortal.bind(this) }
        ];

        for (const method of methods) {
            try {
                const result = await method.func(gstNumber);
                results.verificationMethods.push({
                    method: method.name,
                    success: result.success,
                    timestamp: new Date().toISOString()
                });

                if (result.success) {
                    results.isValid = true;
                    results.businessDetails = this.standardizeGSTResponse(gstNumber, result.data);
                    break; // Stop on first successful verification
                } else {
                    results.errors.push(`${method.name}: ${result.error}`);
                }
            } catch (error) {
                results.errors.push(`${method.name}: ${error.message}`);
            }
        }

        // Add derived information
        if (results.isValid) {
            results.businessDetails.derivedInfo = {
                state: this.getStateFromGST(gstNumber),
                pan: this.extractPANFromGST(gstNumber)
            };
        }

        return results;
    }
}

module.exports = new GSTVerificationService();
