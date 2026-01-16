/**
 * Web Crawler Service
 * Crawls websites, extracts content, and prepares it for embedding
 */

const axios = require('axios');
const cheerio = require('cheerio');
const { URL } = require('url');

/**
 * Crawl a website URL and extract clean text content
 * @param {string} url - URL to crawl
 * @param {Object} options - Crawling options
 * @returns {Promise<Object>} Extracted content and metadata
 */
async function crawlWebsite(url, options = {}) {
    const {
        maxDepth = 1, // How many levels deep to crawl
        maxPages = 10, // Maximum pages to crawl
        timeout = 10000, // Request timeout
        followLinks = false, // Whether to follow internal links
        contentSelectors = null, // CSS selectors for content extraction
        excludeSelectors = ['script', 'style', 'nav', 'header', 'footer', '.advertisement'] // Elements to exclude
    } = options;

    console.log(`[WebCrawler] Starting crawl for: ${url}`);

    try {
        // Fetch the page
        const response = await axios.get(url, {
            timeout,
            headers: {
                'User-Agent': 'SAK-WhatsApp-Bot/1.0 (Product Information Crawler)',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            },
            maxRedirects: 5
        });

        if (!response || !response.data) {
            throw new Error('No response data received');
        }

        console.log(`[WebCrawler] Received ${response.data.length} bytes`);

        // Load HTML into cheerio
        const $ = cheerio.load(response.data);

        // Extract metadata
        const pageTitle = $('title').text().trim() || 
                         $('meta[property="og:title"]').attr('content') || 
                         $('h1').first().text().trim() || 
                         'Untitled Page';

        const pageDescription = $('meta[name="description"]').attr('content') || 
                               $('meta[property="og:description"]').attr('content') || 
                               '';

        // Remove unwanted elements
        excludeSelectors.forEach(selector => {
            $(selector).remove();
        });

        // Extract main content
        let contentElement;
        if (contentSelectors && contentSelectors.length > 0) {
            // Use custom selectors if provided
            contentElement = $(contentSelectors.join(', '));
        } else {
            // Try common content containers
            const main = $('main');
            const article = $('article');
            const content = $('.content');
            const contentDiv = $('#content');
            
            if (main.length > 0) {
                contentElement = main;
            } else if (article.length > 0) {
                contentElement = article;
            } else if (content.length > 0) {
                contentElement = content;
            } else if (contentDiv.length > 0) {
                contentElement = contentDiv;
            } else {
                contentElement = $('body');
            }
        }

        // Extract text content
        const textContent = contentElement.text()
            .replace(/\s+/g, ' ') // Normalize whitespace
            .replace(/\n\s*\n/g, '\n') // Remove empty lines
            .trim();

        // Extract product codes (if any)
        const productCodes = extractProductCodes(textContent);

        // Extract tables (often contain specs/pricing)
        const tables = [];
        $('table').each((i, table) => {
            const tableData = extractTableData($, $(table));
            if (tableData && tableData.length > 0) {
                tables.push(tableData);
            }
        });

        // Extract links for further crawling (if enabled)
        const links = [];
        if (followLinks && maxDepth > 0) {
            $('a[href]').each((i, link) => {
                const href = $(link).attr('href');
                if (href) {
                    try {
                        const absoluteUrl = new URL(href, url).href;
                        const baseUrl = new URL(url);
                        const linkUrl = new URL(absoluteUrl);
                        
                        // Only include links from same domain
                        if (linkUrl.hostname === baseUrl.hostname) {
                            links.push({
                                url: absoluteUrl,
                                text: $(link).text().trim()
                            });
                        }
                    } catch (e) {
                        // Invalid URL, skip
                    }
                }
            });
        }

        console.log(`[WebCrawler] Successfully crawled: ${url} (${textContent.length} chars)`);

        return {
            success: true,
            url,
            pageTitle,
            pageDescription,
            content: textContent,
            productCodes,
            tables,
            links: links.slice(0, maxPages), // Limit links
            wordCount: textContent.split(/\s+/).length,
            crawledAt: new Date()
        };

    } catch (error) {
        console.error(`[WebCrawler] Error crawling ${url}:`, error.message);
        return {
            success: false,
            url,
            error: error.message,
            errorType: error.code || 'UNKNOWN_ERROR'
        };
    }
}

/**
 * Extract product codes from text (customize patterns as needed)
 */
function extractProductCodes(text) {
    const patterns = [
        /\b[A-Z]{2,4}[-\s]?\d{1,4}[-\s]?[A-Z0-9]{0,4}\b/g, // e.g., NFF-640, ABC 123
        /\b\d{4,6}\b/g, // Simple numeric codes
    ];

    const codes = new Set();
    patterns.forEach(pattern => {
        const matches = text.match(pattern);
        if (matches) {
            matches.forEach(code => codes.add(code.trim()));
        }
    });

    return Array.from(codes);
}

/**
 * Extract structured data from HTML tables
 */
function extractTableData($, $table) {
    const rows = [];
    
    $table.find('tr').each((i, row) => {
        const cells = [];
        $(row).find('td, th').each((j, cell) => {
            cells.push($(cell).text().trim());
        });
        if (cells.length > 0) {
            rows.push(cells);
        }
    });

    return rows;
}

/**
 * Crawl multiple pages (batch processing)
 */
async function crawlMultipleUrls(urls, options = {}) {
    const results = [];
    
    for (const url of urls) {
        const result = await crawlWebsite(url, options);
        results.push(result);
        
        // Add delay to be respectful to servers
        if (options.delayBetweenRequests) {
            await new Promise(resolve => setTimeout(resolve, options.delayBetweenRequests));
        }
    }

    return results;
}

/**
 * Recursively crawl a website and all its subpages
 * @param {string} startUrl - Starting URL to crawl
 * @param {Object} options - Crawling options
 * @param {Function} progressCallback - Optional callback for progress updates
 * @returns {Promise<Array>} Array of all crawled pages
 */
async function crawlEntireWebsite(startUrl, options = {}, progressCallback = null) {
    const {
        maxDepth = 3,
        maxPages = 100,
        delayBetweenRequests = 1000,
        contentSelectors = null,
        excludeSelectors = ['script', 'style', 'nav', 'header', 'footer', '.advertisement'],
        excludePatterns = ['/login', '/logout', '/admin', '/cart', '/checkout', '#', 'javascript:'], // URL patterns to skip
        sameDomainOnly = true
    } = options;

    console.log(`[WebCrawler] Starting recursive crawl from: ${startUrl}`);

    const baseUrl = new URL(startUrl);
    const visited = new Set();
    const toVisit = [{ url: normalizeUrl(startUrl), depth: 0 }];
    const results = [];

    while (toVisit.length > 0 && visited.size < maxPages) {
        const { url, depth } = toVisit.shift();
        
        // Skip if already visited or exceeds depth
        if (visited.has(url) || depth > maxDepth) {
            continue;
        }

        // Skip excluded patterns
        if (excludePatterns.some(pattern => url.includes(pattern))) {
            console.log(`[WebCrawler] Skipping excluded URL: ${url}`);
            continue;
        }

        visited.add(url);

        // Report progress
        if (progressCallback) {
            progressCallback({
                currentPage: visited.size,
                totalFound: visited.size + toVisit.length,
                currentUrl: url,
                depth
            });
        }

        // Crawl the page
        const result = await crawlWebsite(url, {
            maxDepth: 0, // Don't use internal link following
            followLinks: true,
            contentSelectors,
            excludeSelectors
        });

        if (result.success) {
            results.push(result);

            // Add new links to visit
            if (depth < maxDepth && result.links) {
                for (const link of result.links) {
                    const normalizedLink = normalizeUrl(link.url);
                    const linkUrl = new URL(normalizedLink);

                    // Check if same domain (if required)
                    if (sameDomainOnly && linkUrl.hostname !== baseUrl.hostname) {
                        continue;
                    }

                    // Skip if already visited or queued
                    if (!visited.has(normalizedLink) && !toVisit.some(item => item.url === normalizedLink)) {
                        toVisit.push({ url: normalizedLink, depth: depth + 1 });
                    }
                }
            }
        } else {
            console.error(`[WebCrawler] Failed to crawl ${url}: ${result.error}`);
        }

        // Respectful delay
        if (delayBetweenRequests > 0 && toVisit.length > 0) {
            await new Promise(resolve => setTimeout(resolve, delayBetweenRequests));
        }
    }

    console.log(`[WebCrawler] Recursive crawl complete. Visited ${visited.size} pages, found ${results.length} successful results`);

    return results;
}

/**
 * Parse sitemap.xml to discover all URLs
 * @param {string} sitemapUrl - URL to sitemap.xml (or base URL to auto-detect)
 * @returns {Promise<Array>} Array of URLs found in sitemap
 */
async function parseSitemap(sitemapUrl) {
    console.log(`[WebCrawler] Parsing sitemap: ${sitemapUrl}`);

    try {
        // If base URL provided, try common sitemap locations
        const sitemapUrls = sitemapUrl.endsWith('.xml') 
            ? [sitemapUrl]
            : [
                `${sitemapUrl}/sitemap.xml`,
                `${sitemapUrl}/sitemap_index.xml`,
                `${sitemapUrl.replace(/\/$/, '')}/sitemap.xml`
            ];

        let sitemapContent = null;
        let foundUrl = null;

        // Try each sitemap URL
        for (const url of sitemapUrls) {
            try {
                const response = await axios.get(url, {
                    timeout: 10000,
                    headers: {
                        'User-Agent': 'SAK-WhatsApp-Bot/1.0 (Sitemap Parser)'
                    }
                });
                sitemapContent = response.data;
                foundUrl = url;
                break;
            } catch (e) {
                // Try next URL
                continue;
            }
        }

        if (!sitemapContent) {
            console.log(`[WebCrawler] No sitemap found at ${sitemapUrl}`);
            return [];
        }

        console.log(`[WebCrawler] Found sitemap at: ${foundUrl}`);

        // Parse XML using cheerio
        const $ = cheerio.load(sitemapContent, { xmlMode: true });
        const urls = [];

        // Extract <loc> tags (standard sitemap format)
        $('loc').each((i, elem) => {
            const url = $(elem).text().trim();
            if (url) {
                urls.push(url);
            }
        });

        // If sitemap index, recursively parse child sitemaps
        if (foundUrl.includes('sitemap_index') || $('sitemap').length > 0) {
            console.log(`[WebCrawler] Found sitemap index with ${urls.length} child sitemaps`);
            const childUrls = [];
            for (const childSitemapUrl of urls) {
                if (childSitemapUrl.endsWith('.xml')) {
                    const childResults = await parseSitemap(childSitemapUrl);
                    childUrls.push(...childResults);
                }
            }
            return childUrls;
        }

        console.log(`[WebCrawler] Found ${urls.length} URLs in sitemap`);
        return urls;

    } catch (error) {
        console.error(`[WebCrawler] Error parsing sitemap:`, error.message);
        return [];
    }
}

/**
 * Detect content type based on URL and content
 */
function detectContentType(url, pageTitle, content) {
    const urlLower = url.toLowerCase();
    const titleLower = pageTitle.toLowerCase();
    const contentLower = content.toLowerCase();

    if (urlLower.includes('/product') || titleLower.includes('product') || contentLower.includes('product details')) {
        return 'product_page';
    } else if (urlLower.includes('/price') || urlLower.includes('/pricing') || titleLower.includes('price')) {
        return 'pricing';
    } else if (urlLower.includes('/spec') || urlLower.includes('/technical') || titleLower.includes('specification')) {
        return 'technical_spec';
    } else if (urlLower.includes('/faq') || titleLower.includes('faq') || titleLower.includes('questions')) {
        return 'faq';
    } else {
        return 'general';
    }
}

/**
 * Clean and normalize URL
 */
function normalizeUrl(url) {
    try {
        const urlObj = new URL(url);
        // Remove tracking parameters
        ['utm_source', 'utm_medium', 'utm_campaign', 'fbclid', 'gclid'].forEach(param => {
            urlObj.searchParams.delete(param);
        });
        return urlObj.href;
    } catch (e) {
        return url;
    }
}

module.exports = {
    crawlWebsite,
    crawlMultipleUrls,
    crawlEntireWebsite,
    parseSitemap,
    extractProductCodes,
    detectContentType,
    normalizeUrl
};

