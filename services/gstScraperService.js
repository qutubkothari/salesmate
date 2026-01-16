// services/gstScraperService.js
const { chromium } = require('playwright');

async function fetchGSTINInfo(gstin) {
    console.log(`[GST Scraper] Starting browser for: ${gstin}`);
    
    let browser = null;
    try {
        browser = await chromium.launch({ 
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        const page = await browser.newPage();
        
        await page.goto('https://services.gst.gov.in/services/searchtp');
        await page.fill('#for_gstin', gstin);
        
        await Promise.all([
            page.click('#btnSearch'),
            page.waitForSelector('#lblLegalName', { timeout: 10000 })
        ]);
        
        const result = await page.evaluate(() => ({
            legalName: document.querySelector('#lblLegalName')?.textContent?.trim(),
            tradeName: document.querySelector('#lblTradeName')?.textContent?.trim(),
            status: document.querySelector('#lblStatus')?.textContent?.trim(),
            address: document.querySelector('#lblPrincipalPlace')?.textContent?.trim()
        }));
        
        if (result.legalName) {
            console.log(`[GST Scraper] Success: ${result.legalName}`);
            return { ok: true, gstin, ...result };
        } else {
            throw new Error('No company data found');
        }
        
    } catch (error) {
        console.log(`[GST Scraper] Failed to verify GST: ${error.message}`);
        
        // DO NOT return fake success - return failure so the system knows verification failed
        return {
            ok: false,
            gstin,
            error: `GST verification failed: ${error.message}`,
            message: 'Unable to verify GST from government portal. Please ensure the GST number is correct.'
        };
    } finally {
        if (browser) await browser.close();
    }
}

module.exports = { fetchGSTINInfo };
