const { supabase, db, USE_LOCAL_DB } = require('./config');
const { formatPersonalizedPriceDisplay, createPriceMessage } = require('./pricingDisplayService');
const { searchWebsiteForQuery, isProductInfoQuery } = require('./websiteContentIntegration');
const { detectLanguage } = require('./multiLanguageService');
const { checkCache, storeInCache } = require('./smartCacheService');
const ConversationMemory = require('./core/ConversationMemory');
const { findBestKnowledgeAnswer } = require('./tenantKnowledgeService');
const TenantDocumentEmbeddingService = require('./tenantDocumentEmbeddingService');

function isOfficeLocationQuery(query) {
    const q = String(query || '').toLowerCase();
    if (!q) return false;

    if (q.includes('head office')) return true;
    if (q.includes('headoffice')) return true;
    if (/(\boffice\b.*\baddress\b|\baddress\b.*\boffice\b)/.test(q)) return true;
    if (/(\bwhere\b.*\b(office|located|location|address)\b)/.test(q)) return true;
    if (/\b(branch|hq|headquarters)\b/.test(q)) return true;
    return false;
}

async function answerFromTenantDocuments({ tenantId, question, maxChunks = 3, minSimilarity = 0.62 }) {
    try {
        if (!tenantId || !String(question || '').trim()) return null;
        const { openai } = require('./config');

        const results = await TenantDocumentEmbeddingService.searchTenantDocumentContent(question, tenantId, {
            limit: Math.max(2, maxChunks),
            minSimilarity
        });

        if (!Array.isArray(results) || !results.length) return null;

        // If we fell back to lexical (no embeddings yet), try indexing recent docs in the background.
        const likelyLexical = results.some(r => r && r.similarity == null);
        if (likelyLexical) {
            setTimeout(() => {
                TenantDocumentEmbeddingService
                    .ensureTenantDocumentsIndexed(tenantId, { maxDocs: 3 })
                    .catch(() => null);
            }, 0);
        }

        const blocks = results.slice(0, maxChunks).map((r, idx) => {
            const name = r.filename || 'document';
            const text = String(r.chunkText || '').trim().slice(0, 900);
            return `[Doc Chunk ${idx + 1}: ${name}]
${text}`;
        }).join('\n\n---\n\n');

        const resp = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content:
                        'You answer customer questions using ONLY the provided document excerpts. ' +
                        'Do NOT paste long excerpts. ' +
                        'Return ONLY JSON: {"answered": boolean, "answer": string}. ' +
                        'If the excerpts do not contain the answer, set answered=false and answer="".'
                },
                {
                    role: 'user',
                    content:
                        `Document excerpts:\n${blocks}\n\n` +
                        `Question: ${String(question).trim()}\n\n` +
                        `Rules for the answer field:\n` +
                        `- 2–6 short sentences\n` +
                        `- No long copy-paste\n` +
                        `- At most one short quote (max 25 words) if needed\n`
                }
            ],
            response_format: { type: 'json_object' },
            temperature: 0.2,
            max_tokens: 260
        });

        const raw = resp?.choices?.[0]?.message?.content?.trim();
        if (!raw) return null;
        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch {
            parsed = null;
        }

        const answered = !!parsed?.answered;
        const answerText = typeof parsed?.answer === 'string' ? parsed.answer.trim() : '';
        const filename = results[0]?.filename || null;
        return {
            answered,
            answerText,
            filename
        };
    } catch (e) {
        return null;
    }
}

function isMissingColumnError(error, columnName) {
    const msg = String(error?.message || error || '').toLowerCase();
    const col = String(columnName || '').toLowerCase();
    if (!msg || !col) return false;
    return (
        msg.includes(`no such column: ${col}`) ||
        msg.includes(`column \"${col}\" does not exist`) ||
        msg.includes(`unknown column '${col}'`) ||
        msg.includes(`unknown column: ${col}`) ||
        msg.includes(`has no column named ${col}`)
    );
}

function extractMissingColumnName(error) {
    const msg = String(error?.message || error || '');
    const lower = msg.toLowerCase();

    // SQLite: "no such column: subcategory"
    let m = lower.match(/no such column:\s*([a-z0-9_]+)/i);
    if (m?.[1]) return m[1];

    // Postgres-ish: column "subcategory" does not exist
    m = msg.match(/column\s+\"([^\"]+)\"\s+does\s+not\s+exist/i);
    if (m?.[1]) return m[1].toLowerCase();

    // MySQL-ish: Unknown column 'subcategory'
    m = msg.match(/unknown\s+column\s+'([^']+)'/i);
    if (m?.[1]) return m[1].toLowerCase();

    // SQLite create-table mismatch: has no column named subcategory
    m = lower.match(/has\s+no\s+column\s+named\s+([a-z0-9_]+)/i);
    if (m?.[1]) return m[1];

    return null;
}

function isPriceLikeQuery(text) {
    const q = String(text || '').toLowerCase();
    return /\b(price|prices|rate|cost|quotation|quote|kitna|₹|rs\b|amount)\b/.test(q);
}

function normalizeProductSearchNeedle(text) {
    let needle = String(text || '').trim();
    needle = needle.replace(/%/g, '').trim();
    needle = needle.replace(/^(show\s+me|give\s+me|what\s+is|tell\s+me\s+about|do\s+you\s+have|i\s+want|i\s+need|add|get)\s+/i, '').trim();
    return needle;
}

async function searchProductsForTenant(tenantId, rawNeedle, limit = 10) {
    const needle = normalizeProductSearchNeedle(rawNeedle);
    if (!tenantId || !needle || needle.length < 2) return [];

    const cappedLimit = Math.max(1, Math.min(Number(limit) || 10, 25));

    if (USE_LOCAL_DB) {
        const searchPattern = `%${needle}%`;
        const sql = `
            SELECT id, name, sku, description, category, price, units_per_carton, packaging_unit
            FROM products
            WHERE tenant_id = ?
              AND (
                name LIKE ?
                OR sku LIKE ?
                OR description LIKE ?
                OR category LIKE ?
              )
            ORDER BY name ASC
            LIMIT ?
        `;

        try {
            const stmt = db.prepare(sql);
            return stmt.all(tenantId, searchPattern, searchPattern, searchPattern, searchPattern, cappedLimit) || [];
        } catch (e) {
            console.error('[PRODUCT_SEARCH][SQLITE] Error:', e?.message || e);
            return [];
        }
    }

    // Remote (Supabase/PostgREST)
    try {
        const { data, error } = await supabase
            .from('products')
            .select('id, name, sku, description, category, price, units_per_carton, packaging_unit')
            .eq('tenant_id', tenantId)
            .or(`name.ilike.%${needle}%,sku.ilike.%${needle}%,description.ilike.%${needle}%,category.ilike.%${needle}%`)
            .order('name', { ascending: true })
            .limit(cappedLimit);

        if (error) {
            console.error('[PRODUCT_SEARCH][REMOTE] Error:', error.message || error);
            return [];
        }
        return data || [];
    } catch (e) {
        console.error('[PRODUCT_SEARCH][REMOTE] Exception:', e?.message || e);
        return [];
    }
}

function isContextDependentQueryLocal(query) {
    const q = String(query || '').toLowerCase().trim();
    if (!q) return true;

    const words = q.split(/\s+/).filter(Boolean);
    if (words.length <= 3) return true;

    if (/^(tell me more|more details|give me more details|give me more|more info|more information|details|explain more|continue|go on)$/i.test(q)) return true;
    if (/^(what about( it| that| this)?|how about( it| that| this)?)$/i.test(q)) return true;
    if (/^(and\??|then\??|ok\??|okay\??|yes\??|no\??)$/i.test(q)) return true;
    if (/^(أخبرني المزيد|المزيد|تفاصيل أكثر|مزيد من التفاصيل|زيدني تفاصيل|كمل)$/.test(q)) return true;
    if (/(\bit\b|\bthat\b|\bthis\b|\bthem\b)/.test(q) && words.length <= 6) return true;

    return false;
}

function isExtraFeatureOrSpecRequest(query) {
    const q = String(query || '').toLowerCase();
    if (!q) return false;

    // Requests that imply "beyond what's listed" / custom development / integrations
    if (/\b(more|extra|additional)\s+(features|feature|functions|functionality|capabilities|specs|specifications)\b/.test(q)) return true;
    if (/\b(can you|could you|do you)\s+(add|build|implement|customi[sz]e|develop|include)\b/.test(q)) return true;
    if (/\bdoes it support\b/.test(q)) return true;
    if (/\b(integration|integrate|api|webhook|sso|single sign on)\b/.test(q)) return true;
    if (/\b(sap|oracle|dynamics|zoho|salesforce|tally|quickbooks|sharepoint)\b/.test(q)) return true;

    return false;
}

function isChatbotInquiry(query) {
    const q = String(query || '').toLowerCase();
    if (!q) return false;
    if (q.includes('chatbot')) return true;

    // Website bot / live chat bot phrasing
    const hasBot = /\bbot\b/.test(q);
    const hasWeb = /\b(website|web\s*site|web|widget|live\s*chat)\b/.test(q);
    if (hasBot && hasWeb) return true;

    if (/\b(ai\s*(assistant|agent)|virtual\s*(assistant|agent))\b/.test(q) && hasWeb) return true;
    if (/\b(build|develop|make|create)\b.*\b(chatbot|bot)\b/.test(q)) return true;
    return false;
}

function isOfferingsQuery(query) {
    const q = String(query || '').toLowerCase().trim();
    if (!q) return false;

    // Broad "what do you offer" intent, not a specific SKU/price inquiry.
    if (/\bwhat\b.*\b(offer|provide|sell|deal)\b/.test(q)) return true;
    if (/\b(which|what)\b.*\b(services?|products?)\b.*\b(offer|provide|have|available|sell|deal)\b/.test(q)) return true;
    if (/\bservices?\b\s*\b(and|&)\b\s*\bproducts?\b/.test(q) && /\b(offer|provide|have|available|sell|deal)\b/.test(q)) return true;
    if (/\bwhat\b.*\bservices?\b.*\bproducts?\b/.test(q)) return true;
    // Common phrasing without "offer"
    if (/\b(services?|products?)\b/.test(q) && /\b(do you have|available|can you|what all|list)\b/.test(q)) return true;

    return false;
}

function parseOfferingsChoice(query) {
    const q = String(query || '').toLowerCase().trim();
    if (!q) return null;

    if (/^(1|one)\b/.test(q) || q.includes('stationery')) return 'stationery';
    if (/^(2|two)\b/.test(q) || q.includes('catalog') || q.includes('products') || q.includes('samples')) return 'catalog';
    if (/^(3|three)\b/.test(q) || q.includes('software') || q.includes('service') || q.includes('automation') || q.includes('website')) return 'software';
    return null;
}

function userExplicitlyRejectsMPaperless(query) {
    const q = String(query || '').toLowerCase();
    return /\b(not|no)\b\s*(m\s*-?\s*paperless|mpaperless)\b/.test(q);
}

function isContactInfoRequest(query) {
    const q = String(query || '').toLowerCase();
    if (!q) return false;

    // Common: sales number / contact number / phone / email / support number
    if (/\b(sales|support|customer\s*care|helpdesk|office)\b/.test(q) && /\b(number|phone|contact|call|mobile|whatsapp)\b/.test(q)) return true;
    if (/\b(contact\s*us|call\s*us|reach\s*us|get\s*in\s*touch)\b/.test(q)) return true;
    if (/\b(phone\s*number|contact\s*number|sales\s*number|support\s*number|helpline)\b/.test(q)) return true;
    if (/\b(email|e-?mail)\b/.test(q) && /\b(address|id|contact)\b/.test(q)) return true;

    // Short but explicit
    if (/^\s*(number\?|contact\?|phone\?)\s*$/.test(q)) return true;
    return false;
}

function normalizeDigitsOnly(input) {
    return String(input || '').replace(/\D/g, '');
}

function extractContactInfoFromText(text) {
    const raw = String(text || '');
    if (!raw) return { phones: [], emails: [] };

    const emails = Array.from(new Set(
        (raw.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/ig) || [])
            .map(e => e.trim())
            .filter(Boolean)
    ));

    // Broad phone capture, then filter by digit length.
    // Keep a distinction between international (+...) and local numbers.
    const phoneCandidates = raw.match(/(?:\+?\d[\d\s().-]{6,}\d)/g) || [];
    const phones = [];
    const seen = new Set();

    for (const cand of phoneCandidates) {
        const trimmed = String(cand || '').trim();
        if (!trimmed) continue;

        const digits = normalizeDigitsOnly(trimmed);
        if (digits.length < 8 || digits.length > 15) continue;

        // Preserve whether the website showed an explicit country calling prefix (+).
        const normalized = trimmed.startsWith('+') ? `+${digits}` : digits;
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        phones.push(normalized);
    }

    return { phones, emails };
}

function getCountryCallingCodeFromWhatsAppNumber(phoneNumber) {
    // phoneNumber may look like: "96567709452@c.us" or "96567709452"
    // NOTE: We avoid hardcoding a global country-code map here; matching is handled
    // by comparing the customer's digits with candidate phone prefixes.
    const digits = normalizeDigitsOnly(phoneNumber);
    if (!digits) return null;
    // Return first 1–3 digits as a weak hint (used only as a tie-breaker).
    return digits.length >= 3 ? digits.slice(0, 3) : digits;
}

function pickBestPhoneForCountry(phones, customerCountryCode) {
    const list = Array.isArray(phones) ? phones.filter(Boolean) : [];
    if (!list.length) return null;

    const ccHint = String(customerCountryCode || '').trim();
    if (ccHint) {
        const match = list.find(p => normalizeDigitsOnly(p).startsWith(ccHint));
        if (match) return match;
    }

    // Fallback: prefer international (+...) numbers over local numbers.
    const intl = list.find(p => String(p).trim().startsWith('+'));
    return intl || list[0];
}

function pickBestPhoneForCustomer(phones, customerPhoneNumber) {
    const list = Array.isArray(phones) ? phones.filter(Boolean) : [];
    if (!list.length) return null;

    const customerDigits = normalizeDigitsOnly(customerPhoneNumber);
    if (!customerDigits) {
        const intl = list.find(p => String(p).trim().startsWith('+'));
        return intl || list[0];
    }

    // Prefer the phone whose first 1–3 digits best match the customer's leading digits.
    // This reliably picks +965… for Kuwait customers, +971… for UAE customers, etc.,
    // when the tenant website lists those numbers.
    let best = null;
    let bestScore = -1;

    for (const phone of list) {
        const digits = normalizeDigitsOnly(phone);
        if (!digits) continue;

        let score = 0;
        // Longest-prefix match up to 3 digits.
        for (const n of [3, 2, 1]) {
            if (digits.length >= n && customerDigits.startsWith(digits.slice(0, n))) {
                score = Math.max(score, n);
                break;
            }
        }
        // Tie-breakers: prefer explicit + numbers; prefer longer digit strings.
        if (String(phone).trim().startsWith('+')) score += 0.5;
        score += Math.min(digits.length, 15) / 100;

        if (score > bestScore) {
            bestScore = score;
            best = phone;
        }
    }

    return best || (list.find(p => String(p).trim().startsWith('+')) || list[0]);
}

function extractFirstWebsiteSnippet(websiteContext, { maxChars = 1100 } = {}) {
    const raw = String(websiteContext?.context || '').trim();
    if (!raw) return null;

    // Context format from websiteContentIntegration:
    // [Source 1: title]\nCONTENT\n\n---\n\n[Source 2: ...]
    const firstBlock = raw.split(/\n\n---\n\n/)[0] || raw;
    const firstNewline = firstBlock.indexOf('\n');
    const contentOnly = firstNewline >= 0 ? firstBlock.slice(firstNewline + 1).trim() : firstBlock.trim();
    if (!contentOnly) return null;

    if (contentOnly.length <= maxChars) return contentOnly;
    // Keep as an exact substring (no paraphrase); try to cut cleanly at a newline.
    const sliced = contentOnly.slice(0, maxChars);
    const cutAt = Math.max(sliced.lastIndexOf('\n'), sliced.lastIndexOf('. '), sliced.lastIndexOf('。'));
    return (cutAt > 200 ? sliced.slice(0, cutAt + 1) : sliced).trim();
}

function tokenizeForMatch(text) {
    const lower = String(text || '').toLowerCase();
    const tokens = lower
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(Boolean);

    const stop = new Set([
        'the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'on', 'for', 'with', 'is', 'are', 'was', 'were',
        'i', 'you', 'we', 'they', 'it', 'this', 'that', 'these', 'those', 'my', 'your', 'our', 'their',
        'can', 'could', 'would', 'should', 'do', 'does', 'did', 'have', 'has', 'had', 'what', 'which',
        'when', 'where', 'why', 'how', 'tell', 'more', 'about', 'info', 'information', 'details', 'please'
    ]);

    return tokens.filter(t => !stop.has(t) && t.length > 2);
}

function pickBestWebsiteBlock(websiteContext, query) {
    const raw = String(websiteContext?.context || '').trim();
    if (!raw) return null;

    const blocks = raw.split(/\n\n---\n\n/).map(b => String(b || '').trim()).filter(Boolean);
    if (!blocks.length) return null;

    const qTokens = tokenizeForMatch(query);
    const qSet = new Set(qTokens);

    let bestIdx = 0;
    let bestScore = -1;

    for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        const blockTokens = tokenizeForMatch(block);
        if (!blockTokens.length) continue;

        let hits = 0;
        for (const t of blockTokens) {
            if (qSet.has(t)) hits++;
        }

        // Favor higher overlap, but don’t overly reward very long blocks.
        const score = hits / Math.sqrt(blockTokens.length);
        if (score > bestScore) {
            bestScore = score;
            bestIdx = i;
        }
    }

    return { block: blocks[bestIdx], index: bestIdx };
}

function extractWebsiteSnippetFromBlock(block, { maxChars = 850 } = {}) {
    const b = String(block || '').trim();
    if (!b) return null;

    const firstNewline = b.indexOf('\n');
    const contentOnly = firstNewline >= 0 ? b.slice(firstNewline + 1).trim() : b;
    if (!contentOnly) return null;

    if (contentOnly.length <= maxChars) return contentOnly;

    const sliced = contentOnly.slice(0, maxChars);
    const cutAt = Math.max(sliced.lastIndexOf('\n'), sliced.lastIndexOf('. '), sliced.lastIndexOf('。'));
    return (cutAt > 200 ? sliced.slice(0, cutAt + 1) : sliced).trim();
}

async function classifyWebsiteExplicitAnswer({ question, websiteContext, openai }) {
    try {
        const ctx = String(websiteContext?.context || '').trim();
        const q = String(question || '').trim();
        if (!ctx || !q) return { explicitAnswer: false, quote: null, confidence: 0 };

        // Keep context bounded for cost.
        const boundedContext = ctx.length > 6000 ? ctx.slice(0, 6000) : ctx;

        const resp = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content:
                        'You are a strict evidence checker. Decide if the provided website context explicitly answers the user question. ' +
                        'If yes, return a short EXACT quote copied from the context (no paraphrase). If no, set quote to null. ' +
                        'Respond ONLY as JSON: {"explicitAnswer": boolean, "quote": string|null, "confidence": number}.'
                },
                {
                    role: 'user',
                    content: `Question: ${q}\n\nWebsite context:\n${boundedContext}`
                }
            ],
            response_format: { type: 'json_object' },
            temperature: 0
        });

        const parsed = JSON.parse(resp?.choices?.[0]?.message?.content || '{}');
        const explicitAnswer = !!parsed.explicitAnswer;
        const quote = typeof parsed.quote === 'string' ? parsed.quote.trim() : null;
        const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0;

        // Safety: only accept quote if it appears verbatim in the provided context.
        if (explicitAnswer && quote && boundedContext.includes(quote)) {
            return { explicitAnswer: true, quote, confidence };
        }

        return { explicitAnswer: false, quote: null, confidence };
    } catch (e) {
        return { explicitAnswer: false, quote: null, confidence: 0 };
    }
}

function looksUnansweredByWebsite(query, websiteContext) {
    const q = String(query || '').toLowerCase();
    const ctx = String(websiteContext?.context || '').toLowerCase();
    if (!q || !ctx) return true;

    // If the query includes a specific integration/feature term and it's not present in the retrieved context,
    // assume the website doesn't explicitly cover it (so we should answer as "custom/possible" + flag).
    const mustMatch = [
        'api', 'webhook', 'sso', 'sap', 'oracle', 'dynamics', 'zoho', 'salesforce', 'tally', 'quickbooks', 'sharepoint',
        'integration', 'integrate'
    ];
    for (const term of mustMatch) {
        if (q.includes(term) && !ctx.includes(term)) return true;
    }
    return false;
}

async function logFeatureRequestToDashboard({ tenantId, phoneNumber, userQuery, aiReply, websiteSources }) {
    try {
        const cleanPhone = String(phoneNumber || '').replace(/\D/g, '');
        if (!tenantId || !cleanPhone || !userQuery) return;

        const noteParts = [
            `Customer asked: ${String(userQuery).trim()}`,
            aiReply ? `\nAI reply sent: ${String(aiReply).trim()}` : ''
        ].filter(Boolean);

        const ctx = {
            type: 'feature_request',
            note: noteParts.join('\n'),
            sources: Array.isArray(websiteSources) ? websiteSources.slice(0, 3) : []
        };

        await supabase
            .from('scheduled_followups')
            .insert({
                tenant_id: String(tenantId),
                end_user_phone: cleanPhone,
                scheduled_time: new Date().toISOString(),
                description: 'FEATURE REQUEST (needs review)',
                original_request: String(userQuery).slice(0, 1200),
                conversation_context: ctx,
                status: 'attention',
                created_at: new Date().toISOString()
            });
    } catch (e) {
        console.warn('[FEATURE_REQUEST] Failed to log feature request:', e?.message || e);
    }
}

async function buildTenantDocumentsContext(tenantId, userQuery, { limit = 2 } = {}) {
    try {
        const q = String(userQuery || '').trim();
        if (!tenantId || q.length < 3) return null;

        const results = await TenantDocumentEmbeddingService.searchTenantDocumentContent(q, tenantId, {
            limit: Math.max(2, limit),
            minSimilarity: 0.62
        });

        if (!Array.isArray(results) || !results.length) return null;

        // If we fell back to lexical (no embeddings yet), try indexing recent docs in the background
        // so future queries become semantic without requiring manual scripts.
        const likelyLexical = results.some(r => r && r.similarity == null);
        if (likelyLexical) {
            setTimeout(() => {
                TenantDocumentEmbeddingService
                    .ensureTenantDocumentsIndexed(tenantId, { maxDocs: 2 })
                    .catch(() => null);
            }, 0);
        }

        const snippets = results.slice(0, limit).map((r, idx) => {
            const name = r.filename || 'document';
            const chunkInfo = (r.chunkIndex != null) ? ` | chunk: ${r.chunkIndex}` : '';
            const scoreInfo = (r.relevanceScore != null) ? ` | relevance: ${r.relevanceScore}` : '';
            const text = String(r.chunkText || '').trim().slice(0, 900);
            return `[Document ${idx + 1}: ${name}${chunkInfo}${scoreInfo}]\n${text}`;
        }).join('\n\n---\n\n');

        return `--- TENANT DOCUMENTS (Uploaded Knowledge) ---\n${snippets}\n--- END TENANT DOCUMENTS ---`;
    } catch (e) {
        console.error('[SMART_ROUTER][DOCS] Build context failed:', e?.message || e);
        return null;
    }
}

async function buildProductsInfoContext(tenantId, userQuery, { limit = 10 } = {}) {
    try {
        const q = String(userQuery || '').trim();
        if (!tenantId || q.length < 3) return null;

        // Extract keywords by removing common query words
        let needle = q.slice(0, 120).replace(/%/g, '').trim();
        // Remove common question/command words to get just the product keywords
        needle = needle.replace(/^(show\s+me|give\s+me|what\s+is|tell\s+me\s+about|do\s+you\s+have|i\s+want|i\s+need|add|get)\s+/i, '').trim();
        if (!needle) return null;

        const runQuery = async ({ selectFields, includeSubcategoryInOr }) => {
            if (USE_LOCAL_DB) {
                // SQLite-compatible search using LIKE
                const searchPattern = `%${needle}%`;
                const fields = selectFields.join(', ');
                const subcategoryClause = includeSubcategoryInOr ? ' OR subcategory LIKE ?' : '';
                const query = `SELECT ${fields} FROM products WHERE tenant_id = ? AND (name LIKE ? OR sku LIKE ? OR description LIKE ? OR category LIKE ?${subcategoryClause}) ORDER BY created_at DESC LIMIT ?`;
                
                const params = includeSubcategoryInOr 
                    ? [tenantId, searchPattern, searchPattern, searchPattern, searchPattern, searchPattern, limit]
                    : [tenantId, searchPattern, searchPattern, searchPattern, searchPattern, limit];
                
                try {
                    const stmt = db.prepare(query);
                    const products = stmt.all(...params);
                    return { data: products, error: null };
                } catch (err) {
                    return { data: null, error: err };
                }
            }

            // Supabase PostgREST syntax for remote DB
            const orParts = [
                `name.ilike.%${needle}%`,
                `sku.ilike.%${needle}%`,
                `description.ilike.%${needle}%`,
                `category.ilike.%${needle}%`
            ];
            if (includeSubcategoryInOr) {
                orParts.push(`subcategory.ilike.%${needle}%`);
            }

            return await supabase
                .from('products')
                .select(selectFields.join(', '))
                .eq('tenant_id', tenantId)
                .or(orParts.join(','))
                .order('created_at', { ascending: false })
                .limit(limit);
        };

        let selectFields = ['id', 'name', 'sku', 'description', 'category', 'subcategory', 'technical_details', 'price', 'units_per_carton', 'packaging_unit'];
        let includeSubcategoryInOr = true;

        let products = null;
        let error = null;

        for (let attempt = 0; attempt < 5; attempt++) {
            ({ data: products, error } = await runQuery({ selectFields, includeSubcategoryInOr }));
            if (!error) break;

            const missing = extractMissingColumnName(error);
            if (!missing) break;

            if (missing === 'subcategory') {
                includeSubcategoryInOr = false;
            }

            if (selectFields.includes(missing)) {
                console.warn(`[SMART_ROUTER][PRODUCTS_INFO] Missing column "${missing}"; retrying without it`);
                selectFields = selectFields.filter(f => f !== missing);
                continue;
            }

            break;
        }

        if (error) {
            console.error('[SMART_ROUTER][PRODUCTS_INFO] Search error:', error.message || error);
            return null;
        }

        const rows = Array.isArray(products) ? products : [];
        if (!rows.length) return null;

        const blocks = rows.map((p, idx) => {
            const name = String(p.name || 'Unnamed product').trim();
            const sku = String(p.sku || '').trim();
            const cat = [p.category, p.subcategory].filter(Boolean).join(' / ');
            const desc = String(p.description || '').trim();
            const price = (p.price !== null && p.price !== undefined && p.price !== '') ? Number(p.price) : null;
            const unit = String(p.packaging_unit || 'carton').trim();
            const upc = p.units_per_carton ? Number(p.units_per_carton) : null;
            const tech = typeof p.technical_details === 'string'
                ? p.technical_details
                : (p.technical_details ? JSON.stringify(p.technical_details) : '');

            const body = [
                sku ? `SKU: ${sku}` : null,
                cat ? `Category: ${cat}` : null,
                (price !== null && !Number.isNaN(price)) ? `Price: ₹${price}/${unit}${upc ? ` (${upc} pcs/carton)` : ''}` : null,
                desc ? `Description: ${desc.slice(0, 900)}` : null,
                tech ? `Technical: ${String(tech).slice(0, 900)}` : null
            ].filter(Boolean).join('\n');

            return `[Product ${idx + 1}: ${name}]\n${body}`;
        }).join('\n\n---\n\n');

        return `--- PRODUCTS DATABASE (Tenant Catalog Metadata) ---\n${blocks}\n--- END PRODUCTS DATABASE ---`;
    } catch (e) {
        console.error('[SMART_ROUTER][PRODUCTS_INFO] Build context failed:', e?.message || e);
        return null;
    }
}

async function buildChatHistoryContext(tenantId, phoneNumber, { limit = 6 } = {}) {
    try {
        if (!tenantId || !phoneNumber) return null;
        const memory = await ConversationMemory.getMemory(tenantId, phoneNumber);
        const recent = Array.isArray(memory?.recentMessages) ? memory.recentMessages : [];
        const trimmed = recent.slice(-limit).map(m => {
            const who = (m?.sender === 'bot' || m?.sender === 'assistant') ? 'Assistant' : 'Customer';
            const text = String(m?.content || '').trim();
            if (!text) return null;
            return `${who}: ${text}`;
        }).filter(Boolean);

        if (!trimmed.length) return null;
        return `--- WHATSAPP CHAT HISTORY (Recent) ---\n${trimmed.join('\n')}\n--- END CHAT HISTORY ---`;
    } catch (e) {
        return null;
    }
}

function extractFirstSnippetFromLabeledBlocks(text, { maxChars = 850 } = {}) {
    const raw = String(text || '').trim();
    if (!raw) return null;

    // Remove wrapper sections if present
    const withoutWrappers = raw
        .replace(/---\s+TENANT DOCUMENTS[\s\S]*?---\n?/i, '')
        .replace(/---\s+END TENANT DOCUMENTS\s+---\n?/i, '')
        .replace(/---\s+PRODUCTS DATABASE[\s\S]*?---\n?/i, '')
        .replace(/---\s+END PRODUCTS DATABASE\s+---\n?/i, '')
        .replace(/---\s+WHATSAPP CHAT HISTORY[\s\S]*?---\n?/i, '')
        .replace(/---\s+END CHAT HISTORY\s+---\n?/i, '')
        .trim();

    const block = (withoutWrappers.split(/\n\n---\n\n/)[0] || withoutWrappers).trim();
    if (!block) return null;

    const firstNewline = block.indexOf('\n');
    const contentOnly = firstNewline >= 0 ? block.slice(firstNewline + 1).trim() : block;
    if (!contentOnly) return null;

    if (contentOnly.length <= maxChars) return contentOnly;
    const sliced = contentOnly.slice(0, maxChars);
    const cutAt = Math.max(sliced.lastIndexOf('\n'), sliced.lastIndexOf('. '), sliced.lastIndexOf('。'));
    return (cutAt > 200 ? sliced.slice(0, cutAt + 1) : sliced).trim();
}

async function classifyExplicitAnswerInText({ question, contextText, openai }) {
    try {
        const ctx = String(contextText || '').trim();
        const q = String(question || '').trim();
        if (!ctx || !q) return { explicitAnswer: false, quote: null, confidence: 0 };

        const boundedContext = ctx.length > 6000 ? ctx.slice(0, 6000) : ctx;
        const resp = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content:
                        'You are a strict evidence checker. Decide if the provided context explicitly answers the user question. ' +
                        'If yes, return a short EXACT quote copied from the context (no paraphrase). If no, set quote to null. ' +
                        'Respond ONLY as JSON: {"explicitAnswer": boolean, "quote": string|null, "confidence": number}.'
                },
                { role: 'user', content: `Question: ${q}\n\nContext:\n${boundedContext}` }
            ],
            response_format: { type: 'json_object' },
            temperature: 0
        });

        const parsed = JSON.parse(resp?.choices?.[0]?.message?.content || '{}');
        const explicitAnswer = !!parsed.explicitAnswer;
        const quote = typeof parsed.quote === 'string' ? parsed.quote.trim() : null;
        const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0;

        if (explicitAnswer && quote && boundedContext.includes(quote)) {
            return { explicitAnswer: true, quote, confidence };
        }
        return { explicitAnswer: false, quote: null, confidence };
    } catch (e) {
        return { explicitAnswer: false, quote: null, confidence: 0 };
    }
}

/**
 * 🤖 AI INTELLIGENCE LAYER
 * Analyzes queries without hardcoded patterns
 */
const analyzeQueryWithAI = async (userQuery, tenantId) => {
    try {
        const { openai } = require('./config');
        
        const analysis = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{
                role: 'system',
                content: `Analyze this customer query and extract:

1. Intent: "price_inquiry" | "order_request" | "availability_check" | "discount_request" | "general"
2. Query Type: 
   - "product_category": Brand/category queries (NFF, Nylon, anchors) OR "all products" OR "latest prices for all"
   - "specific_products": Specific product codes (8x80, 10x100)
3. Products/terms mentioned
4. Quantities if any

CRITICAL RULES:
- "8x80 10" or "8x80 5" (product code + number) = intent: "price_inquiry", extract product and quantity
- "NFF" alone OR "NFF prices" OR "order NFF" OR "latest prices for NFF" = queryType: "product_category"
- "give me all NFF products" = queryType: "product_category"
- "I want to order NFF" = queryType: "product_category" (show catalog first, not place order)
- ANY brand name without specific product code = "product_category"
- If user says "order [brand]" or "want [brand]", intent is still "price_inquiry" (show catalog first)
- Simple "8x80" alone = intent: "price_inquiry", queryType: "specific_products"

Respond in JSON:
{
  "intent": "price_inquiry",
  "queryType": "specific_products",
  "searchTerms": ["8x80"],
  "quantities": [{"product": "8x80", "quantity": 10, "unit": "cartons"}],
  "confidence": 0.95,
  "reasoning": "User asking for price/quote of 8x80 with quantity 10"
}`
            }, {
                role: 'user',
                content: userQuery
            }],
            response_format: { type: 'json_object' },
            temperature: 0.2
        });
        
        const result = JSON.parse(analysis.choices[0].message.content);
        console.log('[AI_ANALYSIS]', result);
        return result;
        
    } catch (error) {
        console.error('[AI_ANALYSIS] Error:', error.message);
        return null;
    }
};

/**
 * 🔍 AI-POWERED PRODUCT SEARCH
 * Finds products intelligently without hardcoded patterns
 */
const searchProductsWithAI = async (tenantId, searchTerm, queryType) => {
    try {
        console.log('[AI_SEARCH] Searching for:', searchTerm, 'Type:', queryType);

        // Split search term into individual keywords
        let searchTerms = [];
        if (queryType === 'product_category') {
            searchTerms = searchTerm.toLowerCase().split(/\s+/).filter(t => t.length > 2);
            console.log('[AI_SEARCH] Split category search into terms:', searchTerms);
        } else {
            searchTerms = [searchTerm.toLowerCase()];
        }

        // Get all products with ALL searchable fields (be tolerant if some columns don't exist)
        // NOTE: Do NOT filter by price/is_active here.
        // - Dashboard uploads often start with price=0 or unset; filtering makes the bot think there are “no products”.
        // - Some deployments (SQLite/local) may not reliably support all filter columns.
        const runAllProductsQuery = async (selectFields) => {
            return await supabase
                .from('products')
                .select(selectFields.join(', '))
                .eq('tenant_id', tenantId)
                .order('name');
        };

        // Include SKU because many users query by item code/sku (dashboard bulk upload stores it).
        let selectFields = ['id', 'name', 'sku', 'description', 'price', 'packaging_unit', 'units_per_carton', 'technical_details', 'category', 'subcategory', 'search_keywords'];
        let allProducts = null;
        let productsError = null;

        for (let attempt = 0; attempt < 6; attempt++) {
            ({ data: allProducts, error: productsError } = await runAllProductsQuery(selectFields));
            if (!productsError) break;

            const missing = extractMissingColumnName(productsError);
            if (!missing) break;

            if (selectFields.includes(missing)) {
                console.warn(`[AI_SEARCH] Missing column "${missing}"; retrying without it`);
                selectFields = selectFields.filter(f => f !== missing);
                continue;
            }

            break;
        }

        if (productsError) {
            console.error('[AI_SEARCH] Products query error:', productsError.message || productsError);
            return [];
        }

        if (!allProducts || allProducts.length === 0) {
            console.log('[AI_SEARCH] No products in database');
            return [];
        }

        console.log('[AI_SEARCH] Checking', allProducts.length, 'products against search terms:', searchTerms);

        // Enhanced matching: whole and partial terms
        let matchedProducts = allProducts.filter(product => {
            const searchableText = [
                product.name || '',
                product.sku || '',
                product.description || '',
                product.category || '',
                product.subcategory || '',
                Array.isArray(product.search_keywords) ? product.search_keywords.join(' ') : (product.search_keywords || ''),
                product.technical_details?.type || '',
                typeof product.technical_details === 'string' ? product.technical_details : ''
            ].join(' ').toLowerCase();

            // Match whole or partial terms
            const matches = searchTerms.some(term => {
                return searchableText.includes(term) ||
                    searchableText.split(/\s+/).some(word => word.startsWith(term));
            });

            if (matches) {
                console.log(`[AI_SEARCH] ✅ Product "${product.name}" matched for terms:`, searchTerms);
            }
            return matches;
        });

        // Fallback: if no matches, try single-term search
        if (matchedProducts.length === 0 && searchTerms.length > 1) {
            console.log('[AI_SEARCH] No multi-term matches, trying single-term fallback...');
            matchedProducts = allProducts.filter(product => {
                const searchableText = [
                    product.name || '',
                    product.sku || '',
                    product.description || '',
                    product.category || '',
                    product.subcategory || '',
                    Array.isArray(product.search_keywords) ? product.search_keywords.join(' ') : (product.search_keywords || ''),
                    product.technical_details?.type || '',
                    typeof product.technical_details === 'string' ? product.technical_details : ''
                ].join(' ').toLowerCase();
                return searchTerms.some(term => searchableText.includes(term));
            });
        }

        console.log('[AI_SEARCH] Search terms:', searchTerms);
        console.log('[AI_SEARCH] Found', matchedProducts.length, 'matching products:', matchedProducts.map(p => p.name));

        if (matchedProducts.length > 0) {
            console.log('[AI_SEARCH] Sample matches:', matchedProducts.slice(0, 3).map(p => p.name));
        }

        return matchedProducts;

    } catch (error) {
        console.error('[AI_SEARCH] Error:', error.message);
        return [];
    }
};

/**
 * ✍️ AI-POWERED RESPONSE GENERATION
 * Creates natural responses without templates
 * NOW WITH: Cache checking and conversation history
 */
const generateResponseWithAI = async (products, userQuery, detectedLanguage = 'en', tenantId = null, phoneNumber = null) => {
    try {
        const { openai } = require('./config');
        
        // 🎯 LAYER 2: CHECK CACHE FIRST (70-90% cost reduction)
        if (tenantId) {
            const cached = await checkCache(userQuery, tenantId);
            if (cached) {
                console.log('[AI_CACHE] ✅ Cache hit! Cost saved: $0.0008');
                return cached.response;
            }
        }
        
        // 🎯 LAYER 3: GET CONVERSATION HISTORY (context memory)
        let conversationHistory = [];
        if (tenantId && phoneNumber) {
            try {
                const memory = await ConversationMemory.getMemory(tenantId, phoneNumber);
                conversationHistory = (memory.recentMessages || []).map(msg => ({
                    role: msg.sender === 'bot' ? 'assistant' : 'user',
                    content: msg.content
                }));
                console.log(`[AI_MEMORY] Retrieved ${conversationHistory.length} recent messages for context`);
            } catch (error) {
                console.error('[AI_MEMORY] Failed to fetch conversation history:', error.message);
            }
        }
        
        // Language-specific instructions
        let languageInstruction = '';
        if (detectedLanguage === 'ar') {
            languageInstruction = '\n\nIMPORTANT: Respond in Arabic (العربية). Use Modern Standard Arabic that is widely understood.';
        } else if (detectedLanguage === 'hi' || detectedLanguage === 'hinglish') {
            languageInstruction = '\n\nIMPORTANT: Respond in Hinglish (natural mix of Hindi and English). Use Hindi words casually but keep it readable.';
        } else if (detectedLanguage === 'ur') {
            languageInstruction = '\n\nIMPORTANT: Respond in Urdu (اردو). Keep it professional yet friendly.';
        } else if (detectedLanguage && detectedLanguage !== 'en') {
            languageInstruction = `\n\nIMPORTANT: Respond in ${detectedLanguage}. Keep it natural and conversational.`;
        }
        
        // Build messages array with conversation history
        const systemMessage = {
            role: 'system',
            content: `Create a professional sales response showing product pricing.

STYLE:
- Use emojis: 📦 💰 🔹 ✅
- Show per-piece AND per-carton pricing clearly
- Format: ₹XX.XX/pc, ₹XX/carton
- Clean list format if multiple products
- Add helpful call-to-action
- Be conversational but professional

IMPORTANT:
- Always end with "To order, reply with product code and quantity (e.g., '8x80 - 10 cartons')"
- Do NOT use phrases that trigger orders like "added to cart" or "place order"
- This is ONLY a price catalog, not an order confirmation${languageInstruction}

Keep it concise and scannable.`
        };
        
        const userMessage = {
            role: 'user',
            content: `Query: "${userQuery}"

Products:
${products.map(p => {
    const unitsPerCarton = p.units_per_carton || 1;
    const unitLabel = p.packaging_unit || 'unit';
    const perUnit = Number(p.price) || 0;
    const perCarton = perUnit * unitsPerCarton;
    return `- ${p.name}: ₹${perUnit}/${unitLabel} (₹${perCarton}/carton, ${unitsPerCarton} pcs/carton)`;
}).join('\n')}`
        };
        
        // Combine: system + history + current query
        const messages = [
            systemMessage,
            ...conversationHistory.slice(-4), // Last 4 messages for context
            userMessage
        ];
        
        const generation = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: messages,
            temperature: 0.7,
            max_tokens: 1000
        });
        
        const response = generation.choices[0].message.content;
        
        // 🎯 LAYER 2: STORE IN CACHE for next time
        if (tenantId) {
            const tokens = generation.usage?.total_tokens || 0;
            const cost = tokens * 0.0000008; // gpt-4o-mini pricing
            await storeInCache(userQuery, response, tenantId, 'product_pricing', tokens, cost);
            console.log(`[AI_CACHE] Stored response (${tokens} tokens, $${cost.toFixed(6)})`);
        }
        
        return response;
        
    } catch (error) {
        console.error('[AI_GENERATE] Error:', error.message);
        // Fallback formatting
        let response = '💰 **Latest Pricing Information:**\n\n';
        for (const p of products) {
            const unitsPerCarton = p.units_per_carton || 1;
            const unitLabel = p.packaging_unit || 'unit';
            const perUnit = Number(p.price) || 0;
            const perCarton = perUnit * unitsPerCarton;
            const perPiece = perUnit.toFixed(2);
            response += `📦 **${p.name}**\n`;
            response += `   🔹 ₹${perPiece}/pc per piece\n`;
            response += `   💰 ₹${perUnit}/${unitLabel}\n`;
            response += `   📦 ₹${perCarton}/carton\n`;
            response += `   (${unitsPerCarton} pcs/carton)\n\n`;
        }
        response += '\n✅ To order, reply with product code and quantity (e.g., "8x80 - 10 cartons")';
        return response;
    }
};

/**
 * Calculate proper quote based on unit type
 */
const calculateQuoteAmount = (product, quantity, unit, isPieces) => {
    const unitsPerCarton = product.units_per_carton || 1;
    const perUnit = Number(product.price) || 0;
    const pricePerCarton = perUnit * unitsPerCarton;
    
    if (isPieces || unit === 'pieces') {
        // Convert pieces to cartons for total
        const cartonsNeeded = quantity / unitsPerCarton;
        const totalAmount = cartonsNeeded * pricePerCarton;
        const pricePerPiece = perUnit;
        
        return {
            displayQuantity: quantity,
            displayUnit: 'pieces',
            cartonsEquivalent: cartonsNeeded.toFixed(2),
            pricePerUnit: pricePerPiece.toFixed(2),
            totalAmount: totalAmount.toFixed(2),
            calculation: `${quantity} pcs ÷ ${unitsPerCarton} × ₹${pricePerCarton} = ₹${totalAmount.toFixed(2)}`
        };
    } else {
        // Cartons - direct calculation
        const totalAmount = quantity * pricePerCarton;
        
        return {
            displayQuantity: quantity,
            displayUnit: 'cartons',
            piecesEquivalent: quantity * unitsPerCarton,
            pricePerUnit: pricePerCarton.toFixed(2),
            totalAmount: totalAmount.toFixed(2),
            calculation: `${quantity} cartons × ₹${pricePerCarton} = ₹${totalAmount.toFixed(2)}`
        };
    }
};

/**
 * Handle multi-product price inquiry with personalized pricing
 */
const handleMultiProductPriceInquiry = async (query, tenantId, phoneNumber = null, aiQuantities = null) => {
    try {
        console.log('[MULTI_PRODUCT] Processing multi-product price inquiry:', query);
        console.log('[MULTI_PRODUCT] Customer phone:', phoneNumber || 'Not provided');
        
        // Extract all product codes and their quantities from the query
        // Patterns: "8x80 10", "8x100 5 cartons", "8x120 2 ctns", etc.
        const productCodes = (query.match(/\d+[x*]\d+/gi) || []).map(code => code.replace('*', 'x'));
        
        console.log('[MULTI_PRODUCT] Found product codes:', productCodes);
        
        if (productCodes.length === 0) {
            return null;
        }
        
        // Build a map of product code to quantity and unit
        const codeToQuantityMap = {};
        const codeToUnitMap = {};
        
        // First, use AI-detected quantities if available
        if (aiQuantities && Array.isArray(aiQuantities)) {
            console.log('[MULTI_PRODUCT] Using AI-detected quantities:', aiQuantities);
            for (const qtyInfo of aiQuantities) {
                const code = qtyInfo.product.replace('*', 'x');
                codeToQuantityMap[code] = qtyInfo.quantity;
                codeToUnitMap[code] = qtyInfo.unit || 'carton';
                console.log('[MULTI_PRODUCT] AI quantity for', code, ':', qtyInfo.quantity, qtyInfo.unit);
            }
        }
        
        // Fallback: extract quantities from query string for any missing codes
        for (const code of productCodes) {
            if (codeToQuantityMap[code] === undefined) {
                // Look for quantity and unit after this product code
                // Pattern: "8x80 10 pcs", "8x80: 10 cartons", "8x80 - 10 pieces", "8x80 25ctns"
                const codePattern = code.replace(/[x*]/g, '[x*]');
                const quantityUnitRegex = new RegExp(codePattern + '\\s*[:-]?\\s*(\\d+)\\s*(cartons?|ctns?|pcs?|pieces?)?', 'i');
                const match = query.match(quantityUnitRegex);
                if (match && match[1]) {
                    codeToQuantityMap[code] = parseInt(match[1]);
                    let unit = 'carton';
                    if (match[2]) {
                        const unitStr = match[2].toLowerCase();
                        if (unitStr.startsWith('pc')) unit = 'pcs';
                        else if (unitStr.startsWith('carton') || unitStr.startsWith('ctn')) unit = 'carton';
                    }
                    codeToUnitMap[code] = unit;
                    console.log('[MULTI_PRODUCT] Regex extracted quantity for', code, ':', match[1], unit);
                } else {
                    codeToQuantityMap[code] = 1; // Default to 1 if no quantity specified
                    codeToUnitMap[code] = 'carton'; // Default unit
                    console.log('[MULTI_PRODUCT] No quantity found for', code, '- defaulting to 1 carton');
                }
            }
        }
        
        const products = [];
        const quotedProducts = [];
        const foundProductIds = new Set();
        
        for (const code of productCodes) {
            console.log('[MULTI_PRODUCT] Looking up product:', code);
            const product = await findProductByCode(tenantId, code);
            
            if (product && !foundProductIds.has(product.id)) {
                console.log('[MULTI_PRODUCT] Found product:', product.name, 'for code:', code);
                foundProductIds.add(product.id);
                
                const quantity = codeToQuantityMap[code] || 1;
                const unit = codeToUnitMap[code] || 'carton';
                products.push({ ...product, requestedQuantity: quantity, requestedUnit: unit });
                
                quotedProducts.push({
                    productCode: code,
                    productName: product.name,
                    productId: product.id,
                    price: product.price,
                    quantity: quantity,
                    unit: unit,
                    unitsPerCarton: product.units_per_carton
                });
                
                console.log('[MULTI_PRODUCT] Added to quotedProducts with quantity:', quantity);
            } else if (product && foundProductIds.has(product.id)) {
                console.log('[MULTI_PRODUCT] Skipping duplicate product:', product.name);
            } else {
                console.log('[MULTI_PRODUCT] Product not found for code:', code);
            }
        }
        
        if (products.length === 0) {
            return "Sorry, I couldn't find any of those products in our catalog.";
        }
        
        // Check if this is a volume order (10k+ pieces)
        const hasVolumeOrder = products.some(p => 
            p.requestedUnit === 'pcs' && p.requestedQuantity >= 10000
        );
        
        // If single product WITHOUT volume order, use beautiful personalized format
        // For volume orders, always use the detailed pricing with discounts
        if (products.length === 1 && phoneNumber && !hasVolumeOrder) {
            console.log('[MULTI_PRODUCT] Single product without volume order - using simple personalized pricing');
            const priceDisplay = await formatPersonalizedPriceDisplay(tenantId, phoneNumber, products[0].id);
            if (priceDisplay) {
                const message = createPriceMessage(priceDisplay, true, query); // Pass originalQuery for quantity extraction
                return {
                    response: message,
                    quotedProducts: quotedProducts
                };
            }
        }
        
        // For volume orders or multiple products, use detailed pricing
        if (hasVolumeOrder) {
            console.log('[MULTI_PRODUCT] Volume order detected - using detailed pricing with discounts');
        } else {
            console.log('[MULTI_PRODUCT] Multiple products - using detailed pricing');
        }
        
        // Multiple products - show compact list with per-piece pricing and personalization
        let response = "💰 **Price Information:**\n\n";
        let hasAnyPersonalizedPrice = false;
        
        console.log('[MULTI_PRODUCT] Starting to process', products.length, 'products');
        console.log('[MULTI_PRODUCT] Phone number for personalization:', phoneNumber);
        
        for (const product of products) {
            const unitsPerCarton = parseInt(product.units_per_carton) || 1;
            const pricePerPiece = (product.price / unitsPerCarton).toFixed(2);
            const requestedQuantity = product.requestedQuantity || 1;
            const requestedUnit = product.requestedUnit || 'carton';
            
            console.log('[MULTI_PRODUCT] Processing product:', product.name, 'ID:', product.id, 'Quantity:', requestedQuantity);
            
            // Get personalized pricing if available
            let personalizedInfo = null;
            if (phoneNumber) {
                console.log('[MULTI_PRODUCT] Fetching personalized pricing for:', product.name);
                personalizedInfo = await formatPersonalizedPriceDisplay(tenantId, phoneNumber, product.id);
                console.log('[MULTI_PRODUCT] Personalized info result:', personalizedInfo ? 'Found' : 'Not found');
                if (personalizedInfo) {
                    console.log('[MULTI_PRODUCT] Last purchase price:', personalizedInfo.lastPurchasePrice);
                }
            } else {
                console.log('[MULTI_PRODUCT] No phone number - skipping personalization');
            }
            
            response += `📦 **${product.name}**\n`;
            
            // Determine the base price to use
            let basePrice = product.price;
            let priceSource = 'catalog';
            
            if (personalizedInfo && personalizedInfo.lastPurchasePrice) {
                basePrice = personalizedInfo.lastPurchasePrice;
                priceSource = 'personalized';
                hasAnyPersonalizedPrice = true;
            }
            
            const basePricePerPiece = (basePrice / unitsPerCarton).toFixed(2);
            
            // ✅ VOLUME DISCOUNT LOGIC
            let finalPrice = basePrice;
            let finalPricePerPiece = basePricePerPiece;
            let discountPercent = 0;
            let volumeDiscountApplied = false;
            
            // Check for volume discounts based on quantity
            if (requestedUnit === 'pcs' && requestedQuantity >= 10000) {
                // Large volume orders get automatic discount
                if (requestedQuantity >= 100000) {
                    discountPercent = 15; // 15% off for 1 lakh+ pieces
                } else if (requestedQuantity >= 50000) {
                    discountPercent = 12; // 12% off for 50k+ pieces
                } else if (requestedQuantity >= 25000) {
                    discountPercent = 10; // 10% off for 25k+ pieces
                } else if (requestedQuantity >= 10000) {
                    discountPercent = 7; // 7% off for 10k+ pieces
                }
                
                if (discountPercent > 0) {
                    finalPrice = basePrice * (1 - discountPercent / 100);
                    finalPricePerPiece = (finalPrice / unitsPerCarton).toFixed(2);
                    volumeDiscountApplied = true;
                }
            }
            
            // Show price information
            if (priceSource === 'personalized') {
                response += `✨ Your Special Price:\n`;
            } else {
                response += `💵 Price:\n`;
            }
            
            if (volumeDiscountApplied) {
                // Show volume discount prominently
                response += `🎉 **VOLUME DISCOUNT: ${discountPercent}% OFF**\n`;
                response += `� ~~₹${basePricePerPiece}/pc~~ → **₹${finalPricePerPiece}/pc** per piece\n`;
                response += `📦 ~~₹${basePrice.toFixed(2)}~~ → **₹${finalPrice.toFixed(2)}/carton**\n`;
                response += `   (${unitsPerCarton} pcs/carton)\n`;
            } else {
                response += `🔹 ₹${finalPricePerPiece}/pc per piece\n`;
                response += `📦 ₹${finalPrice.toFixed(2)}/carton\n`;
                response += `   (${unitsPerCarton} pcs/carton)\n`;
            }
            
            if (priceSource === 'personalized' && personalizedInfo.savingsAmount > 0 && !volumeDiscountApplied) {
                response += `💰 Saves ₹${personalizedInfo.savingsAmount.toFixed(2)} vs catalog\n`;
            }
            
            // Show quote for requested quantity if specified
            if (requestedQuantity >= 1) {
                let totalAmount, calculationText, cartonsNeeded;
                
                if (requestedUnit === 'pcs') {
                    // Pieces calculation
                    totalAmount = parseFloat(finalPricePerPiece) * requestedQuantity;
                    cartonsNeeded = Math.ceil(requestedQuantity / unitsPerCarton);
                    const totalCartonPrice = cartonsNeeded * finalPrice;
                    
                    response += `\n📊 **Quote for ${requestedQuantity.toLocaleString('en-IN')} pieces:**\n`;
                    response += `   ${requestedQuantity.toLocaleString('en-IN')} pcs × ₹${finalPricePerPiece} = **₹${totalAmount.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}**\n`;
                    response += `   (≈ ${cartonsNeeded.toLocaleString('en-IN')} cartons)\n`;
                    
                    if (volumeDiscountApplied) {
                        const savingsAmount = (parseFloat(basePricePerPiece) * requestedQuantity) - totalAmount;
                        response += `   💰 You save: ₹${savingsAmount.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})} (${discountPercent}% off)\n`;
                    }
                } else {
                    // Cartons calculation
                    totalAmount = finalPrice * requestedQuantity;
                    const totalPieces = requestedQuantity * unitsPerCarton;
                    
                    response += `\n📊 **Quote for ${requestedQuantity.toLocaleString('en-IN')} cartons:**\n`;
                    response += `   ${requestedQuantity.toLocaleString('en-IN')} cartons × ₹${finalPrice.toFixed(2)} = **₹${totalAmount.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}**\n`;
                    response += `   (${totalPieces.toLocaleString('en-IN')} pieces total)\n`;
                    
                    if (volumeDiscountApplied) {
                        const savingsAmount = (basePrice * requestedQuantity) - totalAmount;
                        response += `   � You save: ₹${savingsAmount.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})} (${discountPercent}% off)\n`;
                    }
                }
            }
            
            response += `\n`;
        }
        
        // Calculate total if multiple products with quantities
        // IMPORTANT: totalCartons is actually total QUANTITY (could be pieces or cartons)
        const totalQuantity = products.reduce((sum, p) => sum + (p.requestedQuantity || 1), 0);
        const hasMultipleQuantities = products.some(p => (p.requestedQuantity || 1) > 1);
        
        // Calculate actual cartons for volume discount checks
        let actualCartonsTotal = 0;
        for (const product of products) {
            const qty = product.requestedQuantity || 1;
            const unit = product.requestedUnit || 'carton';
            if (unit === 'pcs' || unit === 'pieces') {
                // Convert pieces to cartons
                actualCartonsTotal += qty / (product.units_per_carton || 1);
            } else {
                actualCartonsTotal += qty;
            }
        }
        actualCartonsTotal = Math.ceil(actualCartonsTotal);
        
        if (hasMultipleQuantities && products.length > 1) {
            let grandTotal = 0;
            let totalUnits = 0;
            for (const product of products) {
                const qty = product.requestedQuantity || 1;
                const unit = product.requestedUnit || 'carton';
                if (unit === 'pcs' || unit === 'pieces') {
                    const pricePerPiece = product.price / (product.units_per_carton || 1);
                    grandTotal += pricePerPiece * qty;
                    totalUnits += qty / (product.units_per_carton || 1); // Convert to cartons for summary
                } else {
                    grandTotal += product.price * qty;
                    totalUnits += qty;
                }
            }
            
            response += `━━━━━━━━━━━━━━━━━━━━\n`;
            response += `📋 **Total Summary:**\n`;
            response += `   ${totalUnits.toFixed(1)} cartons total\n`;
            response += `   Grand Total: ₹${grandTotal.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}\n\n`;
        }
        
        // Only show volume discount info for new customers (no personalized pricing)
        // Use actualCartonsTotal for accurate discount tier messaging
        if (!hasAnyPersonalizedPrice && actualCartonsTotal >= 11) {
            const discountPercent = actualCartonsTotal >= 100 ? '7-10%' : 
                                   actualCartonsTotal >= 51 ? '5-7%' :
                                   actualCartonsTotal >= 26 ? '3-5%' : '2-3%';
            response += `💡 **Volume Discount Eligible:** ${discountPercent} off for ${actualCartonsTotal} cartons!\n\n`;
        } else if (!hasAnyPersonalizedPrice) {
            response += "💡 **Volume Discounts Available:**\n";
            response += "• 11-25 cartons: 2-3% off\n";
            response += "• 26-50 cartons: 3-5% off\n";
            response += "• 51-100 cartons: 5-7% off\n";
            response += "• 100+ cartons: 7-10% off\n\n";
        }
        
        response += hasMultipleQuantities ? 
            "🛒 Ready to place this order? Just say 'yes' or 'add to cart'!" :
            "✅ To order any of these products, just let me know the quantities!";
        
        console.log('[MULTI_PRODUCT] Returning', products.length, 'products');
        console.log('[MULTI_PRODUCT] ⭐ Final return value:', {
            hasResponse: !!response,
            hasQuotedProducts: !!quotedProducts,
            quotedProductsCount: quotedProducts.length,
            quotedProductsPreview: JSON.stringify(quotedProducts).substring(0, 200)
        });
        
        return {
            response: response,
            quotedProducts: quotedProducts
        };
        
    } catch (error) {
        console.error('[MULTI_PRICE_HANDLER] Error:', error.message);
        return null;
    }
};

/**
 * FIXED: Handle price queries without triggering order processing
 */
const handlePriceQueriesFixed = async (query, tenantId, phoneNumber = null) => {
    // [LOG] Processing price handler query
    const cleanQuery = query.toLowerCase().trim();
    console.log('[PRICE_HANDLER] Customer phone:', phoneNumber || 'Not provided');
    // === CRITICAL: Detect ORDER intent (not just price inquiry with quantity) ===
    // Only treat as order if it has CLEAR order keywords like "need", "want", "order", "buy", "chahiye"
    const hasOrderIntent = /(?:need|want|order|buy|place|chahiye|mangao|bhejo|send me)\s+\d+/i.test(cleanQuery);
    const hasQuantity = /(\d+)\s*(?:ctns?|cartons?|pcs|pieces)/i.test(cleanQuery);
    const hasPriceKeyword = /price|prices|rate|cost|kitna|best\s+price|final\s+price/i.test(cleanQuery);
    
    // If has ORDER intent with quantity (e.g., "I want 10 ctns"), skip price handler
    if (hasOrderIntent && hasQuantity && !hasPriceKeyword) {
    // [LOG] Order intent detected, treating as order
        return null; // Let order processing handle it
    }
    // === CRITICAL FIX: Detect "i need price for" patterns FIRST ===
    const explicitPricePatterns = [
        /^how\s+much\s+for\s+(.+)$/i,                    // "how much for 10000 pieces of 10x100"
        /^i\s+need\s+prices?\s+for\s+(.+)$/i,            // "i need price(s) for 8x80, 8x100"
        /^need\s+prices?\s+for\s+(.+)$/i,                // "need price(s) for 8x80" (without "i")
        /^i\s+want\s+prices?\s+for\s+(.+)$/i,            // "i want price(s) for 8x80"  
        /^want\s+prices?\s+for\s+(.+)$/i,                // "want price(s) for 8x80" (without "i")
        /^prices?\s+for\s+(.+)$/i,                       // "price(s) for 8x80, 8x100"
        /^give\s+me\s+(?:final|best|your)?\s*prices?\s+for\s+(.+)$/i,  // "give me final price for 8x80"
        /^tell\s+me\s+prices?\s+for\s+(.+)$/i,           // "tell me price(s) for 8x80"
        /^what\s+is\s+prices?\s+for\s+(.+)$/i,           // "what is price(s) for 8x80"
        /^what\s+are\s+prices?\s+for\s+(.+)$/i,          // "what are prices for 8x80"
        /^best\s+prices?\s+for\s+(.+)$/i,                // "best price(s) for 8x80" or "best price for 10x100"
        /^final\s+prices?\s+for\s+(.+)$/i,               // "final price for 8x80 100 ctns"
        /^(.+)\s+ki\s+prices?\s+chahiye$/i,              // "8x80, 8x100 ki price(s) chahiye"
        /^(.+)\s+ka\s+rate\s+batao$/i,                   // "8x80 ka rate batao"
    ];
    // Check explicit price patterns first
    for (const pattern of explicitPricePatterns) {
        const match = cleanQuery.match(pattern);
        if (match && match[1]) {
            const productPart = match[1].trim();
            // [LOG] Explicit price pattern matched
            // Check if it contains multiple products (comma separated)
            if (productPart.includes(',')) {
                // [LOG] Multi-product price inquiry detected
                // --- PATCHED LOGIC FOR MULTI-PRODUCT PRICE/ORDER INTENT ---
                // Check if explicitly asking for prices (has price keywords)
                const hasPriceKeywords = /price|prices|rate|cost|kitna|batao/i.test(productPart);
                // Simulate quantity/order intent detection (for demo, use >1 product as proxy)
                const quantity = (productPart.match(/\d+/g) || []).length;
                const hasOrderIntent = /order|buy|need|chahiye|mangao|bhejo|send|supply|purchase|le lo|lo/i.test(productPart);

                // Only treat as order if NO price keywords present
                if (!hasPriceKeywords && quantity > 1 && hasOrderIntent) {
                    // [LOG] Order intent detected, not a price inquiry
                    return null;
                }

                // Continue with price response if price keywords present
                // [LOG] Price inquiry with quantity
                const multiResult = await handleMultiProductPriceInquiry(productPart, tenantId, phoneNumber);
                console.log('[SMART_ROUTER] Multi-product result:', {
                    hasResult: !!multiResult,
                    isObject: typeof multiResult === 'object',
                    hasResponse: !!(multiResult && multiResult.response),
                    hasQuotedProducts: !!(multiResult && multiResult.quotedProducts),
                    quotedProductsLength: multiResult?.quotedProducts?.length || 0
                });
                if (multiResult && typeof multiResult === 'object' && multiResult.response) {
                    console.log('[SMART_ROUTER] ✅ Returning structured response with quotedProducts');
                    return multiResult; // Return structured response with quotedProducts
                }
                return multiResult;
            }
            // Single product price inquiry
            const productCode = productPart.match(/(\d+[x*]\d+)/i);
            if (productCode) {
                const code = productCode[1].replace('*', 'x');
                const product = await findProductByCode(tenantId, code);
                if (product) {
                    const priceMessage = await formatProductPrice(product, tenantId, phoneNumber, cleanQuery);
                    
                    // Extract quantity from query if mentioned
                    const quantityMatch = cleanQuery.match(/(\d+)\s*(?:pcs?|pieces?|cartons?|ctns?)/i);
                    let quantity = 1;
                    let unit = 'carton';
                    
                    if (quantityMatch) {
                        const extractedQty = parseInt(quantityMatch[1]);
                        const extractedUnit = quantityMatch[0].match(/cartons?|ctns?/i) ? 'cartons' : 'pieces';
                        
                        // Convert pieces to cartons if needed
                        if (extractedUnit === 'pieces') {
                            const unitsPerCarton = parseInt(product.units_per_carton) || 1;
                            quantity = Math.ceil(extractedQty / unitsPerCarton);
                            unit = 'carton';
                            console.log(`[QUANTITY_CALC] Converted ${extractedQty} pieces to ${quantity} cartons (${unitsPerCarton} pcs/carton)`);
                        } else {
                            quantity = extractedQty;
                            unit = 'carton';
                        }
                    }
                    
                    console.log(`[QUOTED_PRODUCT_SAVE] Saving quotedProduct with quantity:`, quantity, 'type:', typeof quantity);
                    
                    // Quick Test
                    console.log('🔍 QUOTE DEBUG:', {
                        quantity: quantity,
                        unit: unit,
                        isPieces: unit === 'pieces',
                        calculation: unit === 'pieces' ? 
                            `${quantity} pieces` : 
                            `${quantity} cartons`
                    });
                    
                    // Return structured response with quotedProducts for context-based ordering
                    return {
                        response: priceMessage,
                        source: 'product_price',
                        quotedProducts: [{
                            productCode: code,
                            productName: product.name,
                            productId: product.id,
                            price: product.price,
                            quantity: quantity,
                            unit: unit,
                            unitsPerCarton: product.units_per_carton
                        }]
                    };
                } else {
                    return `Sorry, I couldn't find product "${code}" in our catalog. Please check the product code.`;
                }
            }
        }
    }
    // === ENHANCED MULTI-PRODUCT DETECTION ===
    // Detect patterns like "8x80, 8x100" with price keywords
    const productCodesInQuery = (cleanQuery.match(/\d+[x*]\d+/g) || []).map(code => code.replace('*', 'x'));
    const hasPriceKeywords = /price|rate|cost|kitna|batao|chahiye/.test(cleanQuery);
    const hasMultipleProducts = productCodesInQuery.length > 1;
    if (hasMultipleProducts && hasPriceKeywords) {
    // [LOG] Multi-product with price keywords detected
        const multiResult = await handleMultiProductPriceInquiry(cleanQuery, tenantId, phoneNumber);
        if (multiResult && typeof multiResult === 'object' && multiResult.response) {
            return multiResult;
        }
        return multiResult;
    }
    // === ORDER EXCLUSION PATTERNS (More Aggressive) ===
    const orderPatterns = [
        /i\s+need\s+\d+\s+(?:cartons|ctns|pieces|pcs)/i,  // "i need 5 cartons"
        /mujhe\s+\d+\s+(?:cartons|ctns)\s+chahiye/i,       // "mujhe 5 ctns chahiye"
        /\d+\s+ctns?\s+each/i,                              // "5 ctns each"
        /each\s+\d+\s+ctns?/i,                             // "each 5 ctns"
        /order\s+\d+/i,                                     // "order 10"
        /add\s+\d+/i,                                       // "add 5"
    ];
    // Test for order exclusions
    for (const pattern of orderPatterns) {
        if (pattern.test(cleanQuery)) {
            // [LOG] Order pattern detected, excluding from price handling
            return null;
        }
    }
    // Rest of existing logic for other price patterns...
    const priceOnlyPatterns = [
        /^(?:price|pricing|cost|rate|kitna|kya rate).*(?:chahiye|batao|bata|tell|give|hai)$/i,
        /^(?:chahiye|batao|bata|tell|give).*(?:price|pricing|cost|rate)$/i,
        /^.*(?:price|rate|cost).*(?:chahiye|batao|bata)(?:\s+(?:bhai|sir|ji))?$/i,
        /^(?:kya|kitna).*(?:price|rate|cost).*hai$/i,
        /^prices?\s+chahiye$/i,
        /^rate\s+(?:chahiye|batao)$/i,
        // Product-specific price queries
        /^(?:price|cost|rate|best\s+price).*(?:of|for)\s*(\d+[x*]\d+)(?:\s+(?:chahiye|batao|hai))?$/i,  // Added "best price"
        /^(\d+[x*]\d+).*(?:price|cost|rate)(?:\s+(?:chahiye|batao|hai))?$/i,
        /^(?:how much|kitna).*(\d+[x*]\d+)(?:\s+(?:chahiye|hai))?$/i,
        /^(\d+[x*]\d+).*(?:ka|ka price|kitna)(?:\s+(?:chahiye|hai))?$/i,
    ];
    let productCode = null;
    for (let i = 0; i < priceOnlyPatterns.length; i++) {
        const pattern = priceOnlyPatterns[i];
        const match = cleanQuery.match(pattern);
        if (match) {
            if (match[1]) {
                productCode = match[1].replace('*', 'x');
            }
            // [LOG] Price pattern matched for productCode
            break;
        }
    }
    if (!productCode && !priceOnlyPatterns.some(pattern => pattern.test(cleanQuery))) {
    // [LOG] No price patterns matched, returning null
        return null;
    }
    // Handle specific product or general pricing
    if (productCode) {
        const product = await findProductByCode(tenantId, productCode);
        if (product) {
            const priceMessage = await formatProductPrice(product, tenantId, phoneNumber, cleanQuery);
            
            // Extract quantity from query if mentioned
            const quantityMatch = cleanQuery.match(/(\d+)\s*(?:pcs?|pieces?|cartons?|ctns?)/i);
            let quantity = 1;
            let unit = 'carton';
            
            if (quantityMatch) {
                const extractedQty = parseInt(quantityMatch[1]);
                const extractedUnit = quantityMatch[0].match(/cartons?|ctns?/i) ? 'cartons' : 'pieces';
                
                // Convert pieces to cartons if needed
                if (extractedUnit === 'pieces') {
                    const unitsPerCarton = parseInt(product.units_per_carton) || 1;
                    quantity = Math.ceil(extractedQty / unitsPerCarton);
                    unit = 'carton';
                    console.log(`[QUANTITY_CALC_FALLBACK] Converted ${extractedQty} pieces to ${quantity} cartons (${unitsPerCarton} pcs/carton)`);
                } else {
                    quantity = extractedQty;
                    unit = 'carton';
                }
            }
            
            console.log(`[QUOTED_PRODUCT_SAVE_FALLBACK] Saving quotedProduct with quantity:`, quantity, 'type:', typeof quantity);
            
            // Return object with quotedProducts for context-based ordering
            return {
                response: priceMessage,
                source: 'product_price',
                quotedProducts: [{
                    productCode: productCode,
                    productName: product.name,
                    productId: product.id,
                    price: product.price,
                    quantity: quantity,
                    unit: unit,
                    unitsPerCarton: product.units_per_carton
                }]
            };
        } else {
            return `Sorry, I couldn't find product "${productCode}" in our catalog. Please check the product code.`;
        }
    }
    return await handleGeneralPriceInquiry(tenantId, query, phoneNumber);
};

/**
 * AI-POWERED: Intelligent query understanding (no regex, pure AI)
 */
const getSmartResponse = async (userQuery, tenantId, phoneNumber = null) => {
    console.log('[SMART_ROUTER] AI-powered processing for:', userQuery);
    console.log('[SMART_ROUTER] Customer phone:', phoneNumber || 'Not provided');

    const originalQuery = userQuery;
    let retrievalQuery = userQuery;

    // Improve continuity for follow-ups: use memory to build a better retrieval query
    if (tenantId && phoneNumber && isContextDependentQueryLocal(userQuery)) {
        try {
            const memory = await ConversationMemory.getMemory(tenantId, phoneNumber);
            const recent = Array.isArray(memory?.recentMessages) ? memory.recentMessages : [];

            // Find the last meaningful customer message before the current follow-up
            const lastTopic = [...recent]
                .reverse()
                .find(m => (m?.sender === 'customer' || m?.sender === 'user') && m?.content && !isContextDependentQueryLocal(m.content) && String(m.content).trim().toLowerCase() !== String(userQuery).trim().toLowerCase());

            if (lastTopic?.content) {
                // For short follow-ups ("more details", "continue"), using only the last concrete topic
                // yields better retrieval than appending the vague follow-up text.
                retrievalQuery = String(lastTopic.content).trim();
                console.log('[SMART_ROUTER][CONTEXT] Built retrievalQuery from memory:', retrievalQuery);
            }
        } catch (e) {
            console.error('[SMART_ROUTER][CONTEXT] Failed to build retrievalQuery:', e?.message || e);
        }
    }

    // Tenant knowledge base (team-confirmed): respond exactly from KB when available.
    // Per-tenant by design: queries are filtered by tenant_id.
    try {
        if (tenantId) {
            const lookupQuery = isContextDependentQueryLocal(userQuery) ? retrievalQuery : originalQuery;
            const kb = await findBestKnowledgeAnswer({ tenantId, query: lookupQuery });
            if (kb?.answer) {
                const src = Array.isArray(kb.sources) && kb.sources.length
                    ? `\n\nSource: ${kb.sources.map(s => (typeof s === 'string' ? s : (s?.url || s?.title || ''))).filter(Boolean).slice(0, 2).join(' | ')}`
                    : `\n\nSource: Team knowledge base`;

                // Cache the final answer for low latency.
                try {
                    await storeInCache(String(lookupQuery || originalQuery), `${kb.answer}${src}`, tenantId, 'team_kb', 0, 0);
                } catch (_) {}

                return {
                    response: `${kb.answer}${src}`,
                    source: 'tenant_knowledge',
                    aiPowered: false,
                    exactFromWebsite: true
                };
            }
        }
    } catch (e) {
        // ignore, fallback to other sources
    }

    // Detect language for consistent response generation
    let detectedLanguage = 'en';
    try {
        detectedLanguage = await detectLanguage(userQuery);
        console.log('[SMART_ROUTER] Detected language:', detectedLanguage);
    } catch (error) {
        console.error('[SMART_ROUTER] Language detection failed:', error.message);
    }

    // Fast-path: head office / address / location should prefer uploaded docs.
    // This prevents answering with the tenant website HQ when the uploaded documents describe a different business entity (e.g., stationery company).
    try {
        const q = String(userQuery || '').trim();
        const contextQuery = (isContextDependentQueryLocal(userQuery) && retrievalQuery)
            ? String(retrievalQuery || '').trim()
            : q;

        if (tenantId && (isOfficeLocationQuery(q) || isOfficeLocationQuery(contextQuery))) {
            const docQA = await answerFromTenantDocuments({
                tenantId,
                question: contextQuery,
                maxChunks: 3,
                minSimilarity: 0.52
            });

            if (docQA && docQA.answered && docQA.answerText) {
                const sourceName = docQA.filename ? `Uploaded document: ${docQA.filename}` : 'Uploaded document';
                return {
                    response: `${docQA.answerText}\n\nSource: ${sourceName}`,
                    source: 'tenant_documents',
                    aiPowered: true
                };
            }
        }
    } catch (e) {
        // Ignore and proceed with existing handlers.
    }

    // Fast-path: greetings (prevents clarification loop on simple salutations)
    try {
        const q0 = String(userQuery || '').toLowerCase().trim();
        if (q0 && /^(hi|hello|hey|hii|hiii|good\s*(morning|afternoon|evening))$/.test(q0)) {
            console.log('[SMART_ROUTER][FASTPATH] Greeting detected');
            
            // Generate natural greeting variations
            const greetings = [
                "Hello! I'm here to help. What are you looking for today?",
                "Hi there! How can I assist you?",
                "Hey! What can I help you with?",
                "Hello! Feel free to ask me about products, prices, or placing orders.",
                "Hi! Looking for something specific?",
                "Good to hear from you! What would you like to know?",
                "Hello! I can help you browse products, check prices, or manage your cart. What interests you?"
            ];
            
            const randomGreeting = greetings[Math.floor(Math.random() * greetings.length)];
            
            return {
                response: randomGreeting,
                source: 'greeting'
            };
        }
    } catch (e) {
        // ignore
    }

    // Fast-path: broad offerings query should consider ALL sources (products + website + uploaded docs)
    // and ask a clarifying question when multiple business lines exist.
    try {
        const q = String(userQuery || '').trim();
        const choice = parseOfferingsChoice(q);

        if (tenantId && (isOfferingsQuery(q) || choice)) {
            // Source presence checks (cheap): do we have any content in each source?
            const [{ data: p1 }, { data: w1 }, { data: dRows }] = await Promise.all([
                supabase.from('products').select('id').eq('tenant_id', tenantId).limit(1),
                supabase.from('website_embeddings').select('id').eq('tenant_id', tenantId).limit(1),
                // Check a few recent docs because the latest upload might be a scan with empty extracted_text.
                supabase.from('tenant_documents').select('id, extracted_text').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(5)
            ]);

            const hasProducts = Array.isArray(p1) && p1.length > 0;
            const hasWebsite = Array.isArray(w1) && w1.length > 0;
            const hasDocs = Array.isArray(dRows) && dRows.some(d => String(d?.extracted_text || '').trim().length > 30);

            // If user picked a lane, route accordingly.
            if (choice === 'stationery') {
                const docQA = await answerFromTenantDocuments({
                    tenantId,
                    question: 'Which stationery products and services do you offer? Provide a short list.',
                    maxChunks: 4,
                    minSimilarity: 0.50
                });

                if (docQA && docQA.answered && docQA.answerText) {
                    const src = docQA.filename ? `Uploaded document: ${docQA.filename}` : 'Uploaded document';
                    return { response: `${docQA.answerText}\n\nSource: ${src}`, source: 'tenant_documents', aiPowered: true };
                }

                return {
                    response: `I can help — but I couldn’t find a clear “offerings list” in the uploaded documents yet.\n\nPlease tell me what you need (e.g., notebooks, pens, printing, corporate gifts), or upload a brochure/price list that includes the services/products section.`,
                    source: 'tenant_documents',
                    aiPowered: false
                };
            }

            if (choice === 'software') {
                try {
                    const websiteResults = await searchWebsiteForQuery('services products offer', tenantId);
                    const hasSiteCtx = !!(websiteResults && websiteResults.found && websiteResults.context);
                    if (hasSiteCtx) {
                        const { openai } = require('./config');
                        const resp = await openai.chat.completions.create({
                            model: 'gpt-4o-mini',
                            messages: [
                                {
                                    role: 'system',
                                    content: 'Summarize what the business offers using ONLY the provided website excerpts. Keep it to 3–6 short sentences. Do not paste long excerpts.'
                                },
                                {
                                    role: 'user',
                                    content: `Website excerpts:\n${websiteResults.context}\n\nQuestion: What services and products do you offer?`
                                }
                            ],
                            temperature: 0.2,
                            max_tokens: 240
                        });
                        const ans = resp?.choices?.[0]?.message?.content?.trim();
                        const bestUrl = Array.isArray(websiteResults.sources) && websiteResults.sources[0]?.url ? websiteResults.sources[0].url : null;
                        const sourceLine = bestUrl ? `\n\nSource: ${bestUrl}` : '';
                        if (ans) {
                            return { response: `${ans}${sourceLine}`, source: 'website_content', aiPowered: true };
                        }
                    }
                } catch (_) {}

                return {
                    response: `I can help — but I couldn’t find a clear offerings summary on the website crawl right now.\n\nPlease tell me which software/service you mean (WhatsApp bot, dashboard, automation, integrations), and I’ll share the relevant details.`,
                    source: 'website_content',
                    aiPowered: false
                };
            }

            if (choice === 'catalog') {
                // Let the existing catalog fast-path below handle it by falling through.
            } else if (!choice) {
                // No explicit choice: ask a disambiguation question whenever there's more than one plausible business line.
                // Prefer asking even if only docs+products exist (stationery vs catalog), which is your case.
                const options = [];
                if (hasDocs) options.push('1) Stationery products/services (from our uploaded documents)');
                if (hasProducts) options.push('2) Our product catalog (items in the Products section)');
                if (hasWebsite) options.push('3) Our software/automation services (from our website)');

                if (options.length >= 2) {
                    return {
                        response:
                            `We offer multiple things — which one do you mean?\n\n` +
                            options.join('\n') +
                            `\n\nReply with 1 / 2 / 3 (or say “stationery”, “catalog”, or “software”).`,
                        source: 'offerings_disambiguation',
                        aiPowered: false
                    };
                }

                // Only one source exists: answer from it.
                if (hasDocs) {
                    const docQA = await answerFromTenantDocuments({
                        tenantId,
                        question: 'Which products and services do you offer? Provide a short list.',
                        maxChunks: 4,
                        minSimilarity: 0.50
                    });
                    if (docQA && docQA.answered && docQA.answerText) {
                        const src = docQA.filename ? `Uploaded document: ${docQA.filename}` : 'Uploaded document';
                        return { response: `${docQA.answerText}\n\nSource: ${src}`, source: 'tenant_documents', aiPowered: true };
                    }
                }
            }
        }
    } catch (e) {
        // ignore
    }

    // Fast-path: product catalog / product overview queries.
    // Avoids falling into clarification loops when the user clearly asks what products are available.
    try {
        const q = String(userQuery || '').toLowerCase().trim();
        const looksLikeCatalogQuery = (
            q === 'catalog' ||
            q === 'products' ||
            q === 'product list' ||
            (!isOfferingsQuery(q) && !/\bservices?\b/.test(q) && /\b(products?|catalog|items)\b/.test(q) && /\b(have|available|show|list|what|wha|which|menu)\b/.test(q))
        );

        if (looksLikeCatalogQuery && tenantId) {
            console.log('[SMART_ROUTER][FASTPATH] Catalog query detected');
            const { data: products, error } = await supabase
                .from('products')
                .select('id, name, sku, description, price, packaging_unit, units_per_carton')
                .eq('tenant_id', tenantId)
                .order('created_at', { ascending: false })
                .limit(15);

            if (error) {
                console.error('[SMART_ROUTER][CATALOG] Fetch error:', error.message || error);
            }

            const rows = Array.isArray(products) ? products : [];
            if (!rows.length) {
                return {
                    response: `We don't have any products uploaded in the catalog right now.\n\nPlease ask the admin to upload the product list, or tell me what item you need and I’ll help you.`,
                    source: 'catalog_empty'
                };
            }

            let msg = `Here are some products we have:\n\n`;
            for (const p of rows) {
                const name = (p.name || 'Unnamed product').toString().trim();
                const sku = (p.sku || '').toString().trim();
                const price = (p.price !== null && p.price !== undefined && p.price !== '') ? `₹${Number(p.price)}` : null;
                const unit = (p.packaging_unit || 'carton').toString().trim();
                const upc = p.units_per_carton ? ` (${p.units_per_carton} pcs/carton)` : '';
                msg += `• *${name}*`;
                if (sku) msg += ` (SKU: ${sku})`;
                if (price) msg += ` — ${price}/${unit}${upc}`;
                msg += `\n`;
            }
            msg += `\nReply with a product name/SKU and quantity (e.g., "${rows[0].sku || rows[0].name} 5 cartons"), or ask "price of ${rows[0].sku || rows[0].name}".\n\n💡 _Need an image? Just ask "show image of [product name]"_`;

            return {
                response: msg,
                source: 'catalog_list'
            };
        }
    } catch (e) {
        console.error('[SMART_ROUTER][CATALOG] Fast-path failed:', e?.message || e);
        // Continue to AI layer
    }

    // Fast-path: contact / sales number / email requests.
    // Tenant-based: extracts contact info from the tenant's own website crawl (no hardcoding).
    // Country-aware: prefers the contact number matching the customer's calling code.
    try {
        const q = String(originalQuery || '').trim();
        const contextQuery = (isContextDependentQueryLocal(originalQuery) && retrievalQuery)
            ? String(retrievalQuery || '').trim()
            : q;

        if (tenantId && (isContactInfoRequest(q) || isContactInfoRequest(contextQuery))) {
            console.log('[SMART_ROUTER][FASTPATH] Contact info request detected');

            // Use multiple targeted queries to reliably find the tenant's contact info.
            // (Some sites store it on "Contact", "About", footer, etc.)
            const websiteQueries = [
                q,
                contextQuery && contextQuery !== q ? contextQuery : null,
                'contact us sales support phone number email whatsapp',
                'sales team number phone email contact',
            ].filter(Boolean);

            const allContexts = [];
            const allSources = [];
            const seenSource = new Set();

            for (const wq of websiteQueries) {
                try {
                    const r = await searchWebsiteForQuery(String(wq), tenantId);
                    if (!r) continue;
                    if (r?.context) allContexts.push(r.context);

                    if (Array.isArray(r?.sources)) {
                        for (const s of r.sources) {
                            const key = `${s?.url || ''}::${s?.title || ''}`;
                            if (seenSource.has(key)) continue;
                            seenSource.add(key);
                            allSources.push(s);
                        }
                    }
                } catch (_) {
                    // ignore, try next query
                }
            }

            const combinedText = [
                allContexts.join('\n\n---\n\n'),
                allSources.map(s => `${s?.title || ''}\n${s?.url || ''}`).join('\n')
            ].join('\n\n');

            const { phones, emails } = extractContactInfoFromText(combinedText);
            const customerCC = getCountryCallingCodeFromWhatsAppNumber(phoneNumber);
            const bestPhone = pickBestPhoneForCustomer(phones, phoneNumber) || pickBestPhoneForCountry(phones, customerCC);

            const bestUrl = allSources?.[0]?.url || null;

            if (bestPhone || (emails && emails.length)) {
                const lines = [];
                lines.push('Sure — here are our contact details:');
                if (bestPhone) {
                    lines.push(`Sales/Support: ${bestPhone}`);
                }
                if (emails && emails.length) {
                    lines.push(`Email: ${emails[0]}`);
                }

                // If we have multiple numbers and we selected one, optionally include alternates.
                const otherPhones = (phones || []).filter(p => p && p !== bestPhone).slice(0, 2);
                if (otherPhones.length) {
                    lines.push(`Other numbers: ${otherPhones.join(' | ')}`);
                }

                if (bestUrl) {
                    lines.push(`\nSource: ${bestUrl}`);
                }

                return {
                    response: lines.join('\n'),
                    source: 'website_contact_info',
                    aiPowered: false,
                    exactFromWebsite: true
                };
            }

            // If we couldn't extract any contact details from the crawl.
            return {
                response: `Sure — I can help with that. I couldn’t find the phone/email in the current website crawl for this tenant.\n\nPlease share your country (e.g., India/UAE/Kuwait) and I’ll send the correct local sales contact number. If you have the website URL/contact page, share it and I’ll pull the exact details.`,
                source: 'contact_info_missing',
                aiPowered: false
            };
        }
    } catch (e) {
        console.error('[SMART_ROUTER][CONTACT_FASTPATH] Failed:', e?.message || e);
    }

    // Fast-path: chatbot / website bot inquiries (sales flow)
    // Avoids unhelpful "I don't have that information" responses for general service requests.
    try {
        const q = String(originalQuery || '').trim();
        const contextQuery = (isContextDependentQueryLocal(originalQuery) && retrievalQuery)
            ? String(retrievalQuery || '').trim()
            : q;

        if (q && (isChatbotInquiry(q) || isChatbotInquiry(contextQuery))) {
            console.log('[SMART_ROUTER][FASTPATH] Chatbot inquiry detected');

            const { openai } = require('./config');

            // Try to ground in website content (e.g., "Custom AI Bots & Automation"), but answer can be general if not explicitly stated.
            const websiteQuery = userExplicitlyRejectsMPaperless(q)
                ? 'website chatbot custom ai bot'
                : `website chatbot ${contextQuery}`;

            let websiteResults = null;
            try {
                websiteResults = tenantId ? await searchWebsiteForQuery(websiteQuery, tenantId) : null;
            } catch (_) {
                websiteResults = null;
            }

            const hasWebsite = !!(websiteResults && websiteResults.found && websiteResults.context);
            const websiteContext = hasWebsite
                ? `--- WEBSITE (Crawled Content) ---\n${websiteResults.context}\n--- END WEBSITE ---`
                : '';

            const system = `You are a sales assistant for SAK Solutions.

The customer is asking to build a chatbot (often for a website).

Rules:
- Be confident and helpful: explain that we can build a website chatbot and what the usual approach is.
- Do NOT assume they want m-paperless. If the user says it's NOT m-paperless, never mention m-paperless.
- Do NOT claim a specific integration (e.g., SAP, webhooks, CRM) is supported unless it is explicitly stated in the provided website content.
- If the user asks about integrations and it's not explicitly stated, say it may be possible via integration/customization and ask a short clarifying question.
- Ask 2–3 short questions to qualify (website platform/URL, languages, main use-cases, any integrations, timeline).
- Keep the reply concise and sales-ready.`;

            const userMsg = `Customer messages (latest): ${q}

Context (previous topic if any): ${contextQuery}

Website info (if available):
${websiteContext || '(no website context found)'}`;

            const resp = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: system },
                    { role: 'user', content: userMsg }
                ],
                temperature: 0.3,
                max_tokens: 260
            });

            const answer = resp?.choices?.[0]?.message?.content?.trim();
            if (answer) {
                // Optional source line if we used website context.
                const bestUrl = hasWebsite && Array.isArray(websiteResults.sources) && websiteResults.sources[0]?.url
                    ? websiteResults.sources[0].url
                    : null;
                const sourceLine = bestUrl ? `\n\nSource: ${bestUrl}` : '';

                return {
                    response: `${answer}${sourceLine}`,
                    source: hasWebsite ? 'website_chatbot_inquiry' : 'chatbot_inquiry',
                    aiPowered: true
                };
            }

            return {
                response: `Yes — we can build a chatbot for your website.\n\nTo tailor it, a few quick questions:\n1) What is your website URL / platform (WordPress, Shopify, custom)?\n2) What should the bot do (FAQ, lead capture, support, bookings, sales)?\n3) Any integrations needed (CRM, WhatsApp, email, payments)?`,
                source: 'chatbot_inquiry',
                aiPowered: false
            };
        }
    } catch (e) {
        console.error('[SMART_ROUTER][CHATBOT_FASTPATH] Failed:', e?.message || e);
    }
    
    // ============================================
    // 🆕 NEW: AI INTELLIGENCE LAYER (ZERO HARDCODING)
    // ============================================
    try {
        console.log('[AI_LAYER] Activating AI intelligence...');
        
        // Step 1: AI analyzes the query
        const aiAnalysis = await analyzeQueryWithAI(userQuery, tenantId);
        
        if (aiAnalysis && aiAnalysis.intent === 'price_inquiry') {
            console.log('[AI_LAYER] Price inquiry detected by AI');
            console.log('[AI_LAYER] Query type:', aiAnalysis.queryType);
            console.log('[AI_LAYER] Search terms:', aiAnalysis.searchTerms);
            console.log('[AI_LAYER] Quantities:', aiAnalysis.quantities);
            
            let searchTerm = aiAnalysis.searchTerms[0];
            let queryType = aiAnalysis.queryType;
            
            // --- CATEGORY SEARCH (e.g., "NFF", "all products") ---
            if (queryType === 'product_category' && searchTerm) {
                console.log('[AI_LAYER] Processing as category search for:', searchTerm);
                const products = await searchProductsWithAI(tenantId, searchTerm, 'product_category');
                if (products.length > 0) {
                    console.log('[AI_LAYER] ✅ AI found', products.length, 'products for category:', searchTerm);
                    const aiResponse = await generateResponseWithAI(products, userQuery, detectedLanguage, tenantId, phoneNumber);
                    const quotedProducts = products.map(p => ({
                        productCode: p.name.match(/\d+[x*]\d+/)?.[0] || p.name,
                        productName: p.name,
                        productId: p.id,
                        price: p.price,
                        unitsPerCarton: p.units_per_carton || 1,
                        quantity: 1,
                        unit: 'cartons'
                    }));
                    return {
                        response: aiResponse,
                        source: 'ai_intelligence',
                        quotedProducts: quotedProducts,
                        aiPowered: true
                    };
                } else {
                    console.log('[AI_LAYER] No products found in table for category:', searchTerm);
                    
                    // Try website content as fallback
                    console.log('[AI_LAYER] Searching website content for category...');
                    const websiteResults = await searchWebsiteForQuery(retrievalQuery, tenantId);
                    
                    if (websiteResults && websiteResults.found) {
                        console.log('[AI_LAYER] ✅ Found category info in website content!');

                        const topSources = (websiteResults.sources || []).slice(0, 3)
                            .map((s, i) => `${i + 1}. ${s.title}${s.url ? `\n🔗 ${s.url}` : ''}`)
                            .join('\n\n');

                        return {
                            response: `📄 I found relevant information on our website:\n\n${topSources}\n\n💬 What exactly would you like to know about “${searchTerm}”? (features, pricing, setup, integrations?)`,
                            source: 'website_content',
                            quotedProducts: [],
                            aiPowered: true
                        };
                    }
                    
                    return {
                        response: `Sorry, I couldn't find any "${searchTerm}" products in our catalog or website.`,
                        source: 'ai_not_found',
                        quotedProducts: []
                    };
                }
            }
            
            // --- SPECIFIC PRODUCT SEARCH (e.g., "8x80", "8x80 10") ---
            if (queryType === 'specific_products' && searchTerm) {
                console.log('[AI_LAYER] Processing as specific product search for:', searchTerm);
                
                // First try products table
                const multiResult = await handleMultiProductPriceInquiry(
                    userQuery, 
                    tenantId, 
                    phoneNumber, 
                    aiAnalysis.quantities
                );
                
                if (multiResult && typeof multiResult === 'object' && multiResult.response) {
                    console.log('[AI_LAYER] ✅ Found in products table, returning price quote');
                    return {
                        ...multiResult,
                        source: 'ai_intelligence',
                        aiPowered: true
                    };
                } else if (typeof multiResult === 'string') {
                    // Check if product not found
                    if (multiResult.toLowerCase().includes('not found') || 
                        multiResult.toLowerCase().includes('couldn\'t find')) {
                        
                        console.log('[AI_LAYER] Product not in table, searching website content...');
                        
                        // Try website content as fallback
                        const websiteResults = await searchWebsiteForQuery(
                            retrievalQuery, 
                            tenantId, 
                            searchTerm
                        );
                        
                        if (websiteResults && websiteResults.found) {
                            console.log('[AI_LAYER] ✅ Found in website content!');

                            const topSources = (websiteResults.sources || []).slice(0, 3)
                                .map((s, i) => `${i + 1}. ${s.title}${s.url ? `\n🔗 ${s.url}` : ''}`)
                                .join('\n\n');

                            return {
                                response: `📄 I found information about "${searchTerm}" on our website:\n\n${topSources}\n\n💬 What details do you need (specs, features, pricing, compatibility)?`,
                                source: 'website_content',
                                aiPowered: true
                            };
                        }
                    }
                    
                    return {
                        response: multiResult,
                        source: 'ai_intelligence',
                        aiPowered: true
                    };
                }
            }
        }
        console.log('[AI_LAYER] Not a price inquiry, falling through to existing handlers');
    } catch (aiError) {
        console.error('[AI_LAYER] Error:', aiError.message);
        console.log('[AI_LAYER] Falling back to existing handlers');
    }
    
    // ============================================
    // EXISTING CODE CONTINUES HERE - DON'T CHANGE ANYTHING BELOW
    // ============================================
    
    // STEP 1: Use AI to understand what the customer wants
    const { openai } = require('./config');
    
    try {
        const understanding = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{
                role: 'system',
                content: `You are a product query analyzer. Analyze the customer's message and extract:
1. Intent: "price_inquiry", "availability_check", "specifications", "order_request", "discount_request", "brand_inquiry", or "general"
2. Product codes mentioned (e.g., "8x80", "10x140", "NFF 8x100")
3. Brand/Product lines mentioned (e.g., "NFF", "Nylon Anchors", "Nylon Frame")
4. Quantities if mentioned (e.g., "10 ctns", "1000 pieces")

IMPORTANT RULES:
- If message contains brand names like "NFF", "Nylon Anchors", "Nylon Frame" → intent should be "brand_inquiry"
- If the message contains multiple product codes (like "8x80 10 ctns, 8x100 5ctns"), prioritize "price_inquiry" even if discount terms are mentioned.
- Brand inquiries should return all products in that brand/line

Respond in JSON format:
{
  "intent": "price_inquiry" | "brand_inquiry" | "availability_check" | "specifications" | "order_request" | "discount_request" | "general",
  "products": ["8x80", "10x140"],
  "brands": ["NFF", "Nylon Anchors"],
  "quantities": [{"product": "8x80", "quantity": 10, "unit": "cartons"}],
  "confidence": 0.95
}`
            }, {
                role: 'user',
                content: userQuery
            }],
            response_format: { type: 'json_object' },
            temperature: 0.3
        });
        
        const parsed = JSON.parse(understanding.choices[0].message.content);
        console.log('[SMART_ROUTER] AI Understanding:', parsed);
        
        // STEP 2: Handle brand inquiries (e.g., "NFF", "Nylon Anchors")
        if (parsed.intent === 'brand_inquiry' && parsed.brands && parsed.brands.length > 0) {
            console.log('[SMART_ROUTER] Brand inquiry detected for:', parsed.brands);
            
            // Handle the first brand mentioned
            const brand = parsed.brands[0].toLowerCase();
            console.log('[SMART_ROUTER] Processing brand inquiry for:', brand);
            
            // Map common brand names to database search terms
            const brandMappings = {
                'nff': 'nff',
                'nylon': 'nylon',
                'nylon anchors': 'nylon',
                'nylon frame': 'nylon',
                'anchors': 'anchor',
                'frame': 'frame',
                'anchor': 'anchor'
            };
            
            const searchTerm = brandMappings[brand] || brand;
            console.log('[SMART_ROUTER] Searching for products with term:', searchTerm);
            
            // Fetch all products containing the brand term
            const { data: products } = await supabase
                .from('products')
                .select('name, price, packaging_unit, units_per_carton')
                .eq('tenant_id', tenantId)
                .ilike('name', `%${searchTerm}%`)
                .order('name');
            
            if (products && products.length > 0) {
                let priceMsg = `Here are all ${parsed.brands[0]} products and their prices:\n\n`;
                for (const product of products) {
                    priceMsg += `*${product.name}*: ₹${product.price} per ${product.packaging_unit || 'carton'}`;
                    if (product.units_per_carton) priceMsg += ` (${product.units_per_carton} pcs/carton)`;
                    priceMsg += '\n';
                }
                priceMsg += '\nTo order, reply with the product code and quantity (e.g., "8x80 - 10 cartons").';
                
                return {
                    response: priceMsg,
                    source: 'brand_inquiry'
                };
            } else {
                return `No ${parsed.brands[0]} products found in our catalog.`;
            }
        }
        
        // STEP 3: Based on intent, fetch and display information
        if ((parsed.intent === 'price_inquiry' || (parsed.intent === 'discount_request' && parsed.products && parsed.products.length > 1)) && parsed.products && parsed.products.length > 0) {
            console.log('[SMART_ROUTER] Price inquiry detected for:', parsed.products);
            
            // DIRECTLY fetch pricing using AI-extracted product codes (NO pattern matching!)
            const productCodes = parsed.products.map(p => p.replace('*', 'x'));
            console.log('[SMART_ROUTER_AI] Fetching prices for AI-extracted products:', productCodes);
            
            if (productCodes.length === 1) {
                // Single product inquiry
                const code = productCodes[0];
                
                // 🆕 Check if this looks like a brand query (NFF, Nylon Anchors, Nylon Frame, etc.)
                const brandKeywords = ['nff', 'nylon', 'anchors', 'frame', 'anchor'];
                const isBrandQuery = brandKeywords.some(keyword => 
                    code.toLowerCase().includes(keyword) && 
                    !/\d/.test(code) // No numbers = likely a brand, not a product code
                );
                
                console.log('[SMART_ROUTER_AI] Brand detection for code:', code, 'isBrandQuery:', isBrandQuery);
                
                if (isBrandQuery) {
                    console.log('[SMART_ROUTER_AI] Detected brand query for:', code);
                    
                    // Fetch all products containing the brand term
                    const { data: products } = await supabase
                        .from('products')
                        .select('name, price, packaging_unit, units_per_carton')
                        .eq('tenant_id', tenantId)
                        .ilike('name', `%${code}%`)
                        .order('name');
                    
                    if (products && products.length > 0) {
                        let priceMsg = `Here are all ${code.toUpperCase()} products and their prices:\n\n`;
                        for (const product of products) {
                            priceMsg += `*${product.name}*: ₹${product.price} per ${product.packaging_unit || 'carton'}`;
                            if (product.units_per_carton) priceMsg += ` (${product.units_per_carton} pcs/carton)`;
                            priceMsg += '\n';
                        }
                        priceMsg += '\nTo order, reply with the product code and quantity (e.g., "8x80 - 10 cartons").';
                        
                        return {
                            response: priceMsg,
                            source: 'ai_brand_inquiry'
                        };
                    } else {
                        return `No ${code.toUpperCase()} products found in our catalog.`;
                    }
                }
                
                // Regular product code search
                const product = await findProductByCode(tenantId, code);
                
                if (product) {
                    const priceMessage = await formatProductPrice(product, tenantId, phoneNumber, userQuery);
                    
                    // Extract quantity if mentioned
                    const quantityMatch = userQuery.match(/(\d+)\s*(?:pcs?|pieces?|cartons?|ctns?)/i);
                    let quantity = 1;
                    let unit = 'carton';
                    
                    if (quantityMatch) {
                        const extractedQty = parseInt(quantityMatch[1]);
                        const extractedUnit = quantityMatch[0].match(/cartons?|ctns?/i) ? 'cartons' : 'pieces';
                        
                        if (extractedUnit === 'pieces') {
                            const unitsPerCarton = parseInt(product.units_per_carton) || 1;
                            quantity = Math.ceil(extractedQty / unitsPerCarton);
                            console.log(`[AI_PRICE] Converted ${extractedQty} pieces to ${quantity} cartons`);
                        } else {
                            quantity = extractedQty;
                        }
                    }
                    
                    return {
                        response: priceMessage,
                        source: 'ai_direct_price',
                        quotedProducts: [{
                            productCode: code,
                            productName: product.name,
                            productId: product.id,
                            price: product.price,
                            quantity: quantity,
                            unit: unit,
                            unitsPerCarton: product.units_per_carton
                        }]
                    };
                } else {
                    return { 
                        response: `Sorry, I couldn't find product "${code}" in our catalog. Please check the product code.`,
                        source: 'ai_direct_price'
                    };
                }
            } else if (productCodes.length > 1) {
                // Multi-product inquiry
                console.log('[SMART_ROUTER_AI] Multi-product AI inquiry:', productCodes);
                console.log('[SMART_ROUTER_AI] AI extracted quantities:', parsed.quantities);
                
                // Pass the ORIGINAL QUERY and AI quantities to preserve quantity/unit information
                // The handleMultiProductPriceInquiry will use AI quantities when available
                const multiResult = await handleMultiProductPriceInquiry(userQuery, tenantId, phoneNumber, parsed.quantities);
                if (multiResult && typeof multiResult === 'object' && multiResult.response) {
                    return { ...multiResult, source: 'ai_direct_price' };
                }
                return multiResult;
            }
        }
        
        // STEP 3: If AI can't determine clear intent, use fallback handlers
        console.log('[SMART_ROUTER] No clear intent, trying specialized handlers...');
        
    } catch (aiError) {
        console.error('[SMART_ROUTER] AI understanding failed:', aiError.message);
        // Fall back to pattern-based handlers if AI fails
    }
    
    // FALLBACK: Pattern-based handlers (only if AI fails)
    // --- DYNAMIC FIELD SEARCH FOR NFF/NYLON/ANCHOR ---
    const lowerQuery = userQuery.toLowerCase();
    const brandKeywords = ['nff', 'nylon', 'anchor'];
    const matchedBrand = brandKeywords.find(k => lowerQuery.includes(k));
    if (matchedBrand) {
        const { getAllProducts } = require('./productService');
        const allProducts = await getAllProducts(tenantId);
        console.log(`[DYNAMIC_BRAND_SEARCH] Triggered for brand: ${matchedBrand}`);
        // Search all string fields for the keyword
        const matchedProducts = allProducts.filter(product => {
            return Object.values(product).some(val => {
                if (typeof val === 'string') {
                    return val.toLowerCase().includes(matchedBrand);
                }
                if (typeof val === 'object' && val !== null) {
                    return Object.values(val).some(subVal => typeof subVal === 'string' && subVal.toLowerCase().includes(matchedBrand));
                }
                return false;
            });
        });
        console.log(`[DYNAMIC_BRAND_SEARCH] Matched products for '${matchedBrand}':`, matchedProducts.map(p => p.name));
        if (matchedProducts.length > 0) {
            let priceMsg = `Here are all ${matchedBrand.toUpperCase()} products and their prices:\n\n`;
            for (const product of matchedProducts) {
                priceMsg += `*${product.name}*: ₹${product.price} per ${product.packaging_unit || 'carton'}`;
                if (product.units_per_carton) priceMsg += ` (${product.units_per_carton} pcs/carton)`;
                priceMsg += '\n';
            }
            priceMsg += '\nTo order, reply with the product code and quantity (e.g., "8x80 - 10 cartons").';
            console.log(`[DYNAMIC_BRAND_SEARCH] Returning ${matchedProducts.length} products for '${matchedBrand}'.`);
            return {
                response: priceMsg,
                source: 'dynamic_brand_search',
                quotedProducts: matchedProducts.map(p => ({
                    productCode: p.name.match(/\d+[x*]\d+/)?.[0] || p.name,
                    productName: p.name,
                    productId: p.id,
                    price: p.price,
                    unitsPerCarton: p.units_per_carton || 1,
                    quantity: 1,
                    unit: 'cartons'
                }))
            };
        } else {
            console.log(`[DYNAMIC_BRAND_SEARCH] No products found for '${matchedBrand}'.`);
            return { response: `No ${matchedBrand.toUpperCase()} products found in our catalog.`, source: 'dynamic_brand_search' };
        }
    }
    const priceResponse = await handlePriceQueriesFixed(userQuery, tenantId, phoneNumber);
    if (priceResponse) {
        if (typeof priceResponse === 'object' && priceResponse.response) {
            return { 
                response: priceResponse.response, 
                source: 'database',
                quotedProducts: priceResponse.quotedProducts || []
            };
        } else if (typeof priceResponse === 'string') {
            return { response: priceResponse, source: 'database' };
        }
    }

    const availabilityResponse = await handleAvailabilityQueries(userQuery, tenantId);
    if (availabilityResponse) return { response: availabilityResponse, source: 'database' };

    const specsResponse = await handleSpecQueries(userQuery, tenantId);
    if (specsResponse) return { response: specsResponse, source: 'database' };

    // Business-query caching can conflict with product/info answers.
    // Use generic signals (context-dependent + product/info style) instead of product-specific rules.
    const shouldSkipBusinessCache = isContextDependentQueryLocal(originalQuery) || isProductInfoQuery(originalQuery);
    if (!shouldSkipBusinessCache) {
        const businessResponse = await handleBusinessQueries(userQuery, tenantId, detectedLanguage, phoneNumber);
        if (businessResponse) return { response: businessResponse, source: 'cached' };
    }

    // IMPORTANT: Check product catalog availability BEFORE falling back to website/docs.
    // This prevents "do you have X?" queries from getting "not on our website" answers when X is in the products table.
    // Fast-path local catalog lookup (SQLite-safe): show matching products + prices.
    try {
        const q = String(userQuery || '').toLowerCase().trim();

        const isAddToCartIntent = /\b(add\s+to\s+cart|add\b|put\s+in\s+cart|to\s+cart)\b/.test(q);

        const looksLikeAvailabilityQuery = /\b(do\s*u\s*have|do\s+you\s+have|have\s+you\s+got|available|in\s+stock|stock|price\s+(of|for)|cost\s+(of|for)|rate\s+(of|for)|quotation\s+(for|of)|need|want|looking\s+for|can\s+i\s+get|can\s+you\s+provide|can\s+you\s+arrange)\b/.test(q);
        const looksLikeNonProductContext = /\b(website|software|app|dashboard|whatsapp\s*bot|automation|integration|service|services)\b/.test(q);
        const looksLikeShortProductQuery = q.split(/\s+/).filter(Boolean).length <= 6;
        const wantsPrice = isPriceLikeQuery(q);

        function extractItemPhrase(q0) {
            const patterns = [
                /\b(?:do\s*u\s*have|do\s+you\s+have|have\s+you\s+got)\s+(?<item>.+)$/i,
                /\b(?:price|cost|rate|quotation)\s+(?:of|for)\s+(?<item>.+)$/i,
                /\b(?:need|want|looking\s+for)\s+(?<item>.+)$/i,
                /\b(?<item>.+?)\s+(?:available|in\s+stock)\b/i,
                /\b(?:add|put)\s+\d+\s*(?:pieces?|pcs?|cartons?|ctns?)?\s*(?:of\s+)?(?<item>.+?)(?:\s+to\s+(?:my\s+)?cart)?$/i,
            ];
            for (const p of patterns) {
                const m = q0.match(p);
                const item = (m && (m.groups?.item || m[1])) ? String(m.groups?.item || m[1]) : '';
                if (item && item.trim().length >= 3) {
                    return item
                        .replace(/[?!.;,]+$/g, '')
                        .replace(/^\s*(a|an|any|the)\s+/i, '')
                        .trim();
                }
            }
            return '';
        }

        function extractAddToCartDetails(q0) {
            // Supports:
            //  - "add 10 pieces notebook scale"
            //  - "add 10 pcs of notebook scale to cart"
            //  - "add notebook scale 10 pieces"
            const p1 = q0.match(/\b(?:add|put)\s+(?<qty>\d+)\s*(?<unit>pieces?|pcs?|cartons?|ctns?)?\s*(?:of\s+)?(?<item>.+?)(?:\s+to\s+(?:my\s+)?cart)?$/i);
            if (p1?.groups?.qty && p1?.groups?.item) {
                return {
                    qty: parseInt(p1.groups.qty, 10),
                    unit: String(p1.groups.unit || '').toLowerCase(),
                    item: String(p1.groups.item || '').trim()
                };
            }

            const p2 = q0.match(/\b(?:add|put)\s+(?<item>.+?)\s+(?<qty>\d+)\s*(?<unit>pieces?|pcs?|cartons?|ctns?)\b/i);
            if (p2?.groups?.qty && p2?.groups?.item) {
                return {
                    qty: parseInt(p2.groups.qty, 10),
                    unit: String(p2.groups.unit || '').toLowerCase(),
                    item: String(p2.groups.item || '').trim()
                };
            }
            return null;
        }

        if (tenantId && !looksLikeNonProductContext && (looksLikeAvailabilityQuery || looksLikeShortProductQuery || wantsPrice || isAddToCartIntent)) {
            const addDetails = isAddToCartIntent ? extractAddToCartDetails(q) : null;
            const itemPhrase = (addDetails?.item ? addDetails.item : (extractItemPhrase(q) || q));

            // Avoid extremely generic/empty searches
            const needle = normalizeProductSearchNeedle(itemPhrase);
            if (needle && needle.length >= 2) {
                const rows = await searchProductsForTenant(tenantId, needle, wantsPrice ? 10 : 12);
                const hits = Array.isArray(rows) ? rows.filter(p => p && p.name) : [];

                if (hits.length) {
                    // Add-to-cart quote flow: return quotedProducts so main handler can add on "yes".
                    if (isAddToCartIntent && addDetails?.qty && addDetails.qty > 0) {
                        if (hits.length === 1) {
                            const p = hits[0];
                            const unitsPerCarton = (p.units_per_carton ? Number(p.units_per_carton) : 1) || 1;
                            const isPieces = /^pc|^pcs|piece/.test(String(addDetails.unit || ''));
                            const qtyForCartons = isPieces ? Math.ceil(addDetails.qty / Math.max(1, unitsPerCarton)) : addDetails.qty;
                            const unitDisplay = isPieces ? 'pieces' : 'cartons';
                            const conversionNote = isPieces && unitsPerCarton > 1
                                ? ` (≈ ${qtyForCartons} carton${qtyForCartons === 1 ? '' : 's'} @ ${unitsPerCarton} pcs/carton)`
                                : '';

                            const sku = String(p.sku || '').trim();
                            const msg = `Got it. I will add ${addDetails.qty} ${unitDisplay} of *${p.name}*${sku ? ` (SKU: ${sku})` : ''} to your cart${conversionNote}.
\nReply *yes* to proceed or *no* to cancel.`;

                            return {
                                response: msg,
                                source: 'add_to_cart_quote_fastpath',
                                aiPowered: false,
                                quotedProducts: [{
                                    productId: p.id,
                                    productName: p.name,
                                    price: p.price,
                                    quantity: qtyForCartons,
                                    unit: 'cartons',
                                    unitsPerCarton: p.units_per_carton
                                }]
                            };
                        }

                        // Multiple matches: ask user to choose a SKU/name explicitly.
                        let msg = `I found multiple matches for *${needle}*.
\nPlease reply with the exact *SKU* (or full name) and quantity to add (e.g., "add 10 pieces SKU123").\n\nMatches:\n`;
                        for (const p of hits.slice(0, 8)) {
                            const name = String(p.name || '').trim();
                            const sku = String(p.sku || '').trim();
                            msg += `• *${name}*${sku ? ` (SKU: ${sku})` : ''}\n`;
                        }
                        return { response: msg, source: 'add_to_cart_disambiguation_fastpath', aiPowered: false };
                    }

                    // If user explicitly asks for price, answer with price formatting.
                    if (wantsPrice) {
                        if (hits.length === 1) {
                            const msg = await formatProductPrice(hits[0], tenantId, phoneNumber, String(userQuery || ''));
                            return { response: msg, source: 'product_price_fastpath', aiPowered: false };
                        }

                        let msg = `Here are the closest matches for *${needle}* with pricing:\n\n`;
                        for (const p of hits.slice(0, 10)) {
                            const name = String(p.name || '').trim();
                            const sku = String(p.sku || '').trim();
                            const unitLabel = String(p.packaging_unit || 'carton').trim();
                            const upc = p.units_per_carton ? Number(p.units_per_carton) : null;
                            const perUnit = (p.price !== null && p.price !== undefined && p.price !== '') ? Number(p.price) : null;
                            const cartonPrice = (perUnit !== null && !Number.isNaN(perUnit) && upc) ? (perUnit * upc) : null;

                            msg += `• *${name}*`;
                            if (sku) msg += ` (SKU: ${sku})`;
                            if (perUnit !== null && !Number.isNaN(perUnit)) {
                                msg += ` — ₹${perUnit}/${unitLabel}`;
                                if (cartonPrice !== null && !Number.isNaN(cartonPrice)) msg += ` (₹${cartonPrice.toFixed(2)}/carton)`;
                            }
                            if (upc) msg += ` (${upc} pcs/carton)`;
                            msg += `\n`;
                        }

                        msg += `\nReply with the exact product name/SKU for a full quote (e.g., "price of ${hits[0].sku || hits[0].name}").`;
                        return { response: msg, source: 'product_price_list_fastpath', aiPowered: false };
                    }

                    // Otherwise: list products + prices (previous behavior)
                    let msg = `Here are the closest matches for *${needle}* in your product catalog:\n\n`;
                    for (const p of hits.slice(0, 12)) {
                        const name = String(p.name || '').trim();
                        const sku = String(p.sku || '').trim();
                        const unitLabel = String(p.packaging_unit || 'carton').trim();
                        const upc = p.units_per_carton ? Number(p.units_per_carton) : null;
                        const perUnit = (p.price !== null && p.price !== undefined && p.price !== '') ? Number(p.price) : null;
                        const cartonPrice = (perUnit !== null && !Number.isNaN(perUnit) && upc) ? (perUnit * upc) : null;

                        msg += `• *${name}*`;
                        if (sku) msg += ` (SKU: ${sku})`;
                        if (perUnit !== null && !Number.isNaN(perUnit)) {
                            msg += ` — ₹${perUnit}/${unitLabel}`;
                            if (cartonPrice !== null && !Number.isNaN(cartonPrice)) msg += ` (₹${cartonPrice.toFixed(2)}/carton)`;
                        }
                        if (upc) msg += ` (${upc} pcs/carton)`;
                        msg += `\n`;
                    }
                    msg += `\nAsk "price of <name/SKU>" for a full quote, or tell quantity to add to cart.`;

                    return { response: msg, source: 'product_search_fastpath', aiPowered: false };
                }
            }
        }
    } catch (e) {
        console.error('[SMART_ROUTER][PRODUCT_LOOKUP] Fast-path failed:', e?.message || e);
        // Continue to website/docs fallback
    }

    // FINAL FALLBACK: Check if it's a general product info query that could be in website content
    if (isProductInfoQuery(userQuery)) {
        console.log('[SMART_ROUTER] Query appears to be asking for product info, searching website...');
        
        try {
            // "Auto-train" behavior (safe): cache verified website/doc snippets so repeats avoid AI.
            const looksLikeDocRequest = /\b(doc|docs|document|pdf|file|manual)\b/i.test(String(originalQuery || ''));
            if (tenantId && !isContextDependentQueryLocal(originalQuery) && !looksLikeDocRequest) {
                const cached = await checkCache(originalQuery, tenantId);
                if (cached?.response) {
                    return {
                        response: cached.response,
                        source: 'smart_cache',
                        aiPowered: false,
                        exactFromWebsite: true
                    };
                }
            }

            const websiteResults = await searchWebsiteForQuery(retrievalQuery, tenantId);
            const docsContext = await buildTenantDocumentsContext(tenantId, retrievalQuery, { limit: 2 });
            
            const hasWebsite = !!(websiteResults && websiteResults.found && websiteResults.context);
            const hasDocs = !!(docsContext && String(docsContext).trim());

            if (hasWebsite || hasDocs) {
                console.log('[SMART_ROUTER] ✅ Found relevant info in website content!');

                // IDEAL BEHAVIOR:
                // - If it's product info we already provide, reply with exact website text (no AI paraphrase).
                // - If user asks for extra features/specs, reply via AI and also flag it in the dashboard.
                const { openai } = require('./config');

                // For short follow-ups, `originalQuery` may be ambiguous; use retrievalQuery for context.
                const questionForAnswer = (retrievalQuery && retrievalQuery !== originalQuery)
                    ? retrievalQuery
                    : originalQuery;

                const wantsExtras = isExtraFeatureOrSpecRequest(originalQuery);

                const combinedEvidence = [
                    hasWebsite ? `--- WEBSITE (Crawled Content) ---\n${websiteResults.context}\n--- END WEBSITE ---` : null,
                    hasDocs ? docsContext : null
                ].filter(Boolean).join('\n\n');

                if (wantsExtras) {
                    const websiteCoverage = hasWebsite
                        ? await classifyWebsiteExplicitAnswer({ question: questionForAnswer, websiteContext: websiteResults, openai })
                        : { explicitAnswer: false, quote: null, confidence: 0 };

                    const docsCoverage = hasDocs
                        ? await classifyExplicitAnswerInText({ question: questionForAnswer, contextText: docsContext, openai })
                        : { explicitAnswer: false, quote: null, confidence: 0 };

                    // Prefer the source that explicitly answers with higher confidence.
                    const preferDocs = /\b(doc|docs|document|pdf|file|manual)\b/i.test(String(originalQuery || ''));
                    const docsWins = docsCoverage.explicitAnswer && docsCoverage.quote && (
                        preferDocs ||
                        !websiteCoverage.explicitAnswer ||
                        (docsCoverage.confidence >= (websiteCoverage.confidence + 0.05))
                    );

                    if (docsWins) {
                        const sourceLine = `\n\nSource: Uploaded document`;
                        if (tenantId && !isContextDependentQueryLocal(originalQuery)) {
                            await storeInCache(originalQuery, `${docsCoverage.quote}${sourceLine}`, tenantId, 'verified_knowledge', 0, 0);
                        }
                        return {
                            response: `${docsCoverage.quote}${sourceLine}`,
                            source: 'tenant_documents',
                            aiPowered: false,
                            exactFromWebsite: true
                        };
                    }

                    if (websiteCoverage.explicitAnswer && websiteCoverage.quote) {
                        const best = hasWebsite ? pickBestWebsiteBlock(websiteResults, questionForAnswer) : null;
                        const sourceUrl = hasWebsite && Array.isArray(websiteResults.sources)
                            ? websiteResults.sources[best?.index ?? 0]?.url
                            : null;
                        const sourceLine = sourceUrl ? `\n\nSource: ${sourceUrl}` : '';

                        if (tenantId && !isContextDependentQueryLocal(originalQuery)) {
                            await storeInCache(originalQuery, `${websiteCoverage.quote}${sourceLine}`, tenantId, 'verified_knowledge', 0, 0);
                        }
                        return {
                            response: `${websiteCoverage.quote}${sourceLine}`,
                            source: 'website_content',
                            aiPowered: false,
                            exactFromWebsite: true
                        };
                    }

                    // Otherwise, answer via AI (strictly grounded) and flag it.
                    const aiResp = await openai.chat.completions.create({
                        model: 'gpt-4o-mini',
                        messages: [
                            {
                                role: 'system',
                                content: 'You are a sales assistant for our product. Use the provided website content as the ONLY official baseline. IMPORTANT: Do NOT claim that a feature/integration is supported unless it is explicitly stated in the website content. If it is not stated, respond using conditional language (e.g., "may be possible via integration/customization") and ask 1-2 short clarifying questions. Also confirm you will notify the team for review. Keep it concise.'
                            },
                            {
                                role: 'user',
                                content: `Customer asked: "${questionForAnswer}"\n\nOfficial info found (baseline):\n${combinedEvidence}`
                            }
                        ],
                        temperature: 0.2,
                        max_tokens: 300
                    });

                    const aiReply = aiResp?.choices?.[0]?.message?.content?.trim() || '';

                    await logFeatureRequestToDashboard({
                        tenantId,
                        phoneNumber,
                        userQuery: originalQuery,
                        aiReply,
                        websiteSources: hasWebsite ? websiteResults.sources : []
                    });

                    return {
                        response: aiReply || 'Sure — I can help. Please share the exact feature/spec you need, and I will have our team review it.',
                        source: 'feature_request',
                        aiPowered: true,
                        flaggedToDashboard: true
                    };
                }

                const preferDocs = /\b(doc|docs|document|pdf|file|manual)\b/i.test(String(originalQuery || ''));

                const best = (!preferDocs && hasWebsite)
                    ? pickBestWebsiteBlock(websiteResults, questionForAnswer)
                    : null;

                const websiteSnippet = (!preferDocs && hasWebsite)
                    ? (best?.block
                        ? extractWebsiteSnippetFromBlock(best.block, { maxChars: 850 })
                        : extractFirstWebsiteSnippet(websiteResults, { maxChars: 850 }))
                    : null;

                // Prefer semantic doc snippet when available.
                let docSnippet = null;
                let docScore = null;
                let docFilename = null;
                if (hasDocs) {
                    try {
                        const top = tenantId
                            ? await TenantDocumentEmbeddingService.searchTenantDocumentContent(questionForAnswer, tenantId, { limit: 1, minSimilarity: 0.62 })
                            : [];
                        if (Array.isArray(top) && top[0]?.chunkText) {
                            docSnippet = String(top[0].chunkText).trim().slice(0, 850);
                            docScore = (typeof top[0].relevanceScore === 'number') ? top[0].relevanceScore : null;
                            docFilename = top[0].filename || null;
                        } else {
                            docSnippet = extractFirstSnippetFromLabeledBlocks(docsContext, { maxChars: 850 });
                        }
                    } catch {
                        docSnippet = extractFirstSnippetFromLabeledBlocks(docsContext, { maxChars: 850 });
                    }
                }

                const websiteScore = (!preferDocs && hasWebsite && Array.isArray(websiteResults.sources))
                    ? (websiteResults.sources[best?.index ?? 0]?.relevance ?? null)
                    : null;

                // Selection policy:
                // - If user asked for docs, always prefer docs.
                // - Otherwise, prefer docs when docs exist and are clearly relevant; only use website if it is clearly stronger.
                let useDocs = false;
                if (preferDocs) {
                    useDocs = !!docSnippet;
                } else if (docSnippet && !websiteSnippet) {
                    useDocs = true;
                } else if (docSnippet && websiteSnippet) {
                    const d = (typeof docScore === 'number') ? docScore : 65;
                    const w = (typeof websiteScore === 'number') ? websiteScore : 65;
                    // Default bias towards docs (uploaded knowledge), unless website is meaningfully stronger.
                    useDocs = (d >= w - 2);
                } else {
                    useDocs = false;
                }

                // For documents: answer the question (don’t paste chunks).
                if (useDocs) {
                    const docQA = await answerFromTenantDocuments({ tenantId, question: questionForAnswer, maxChunks: 3 });
                    if (docQA && docQA.answered && docQA.answerText) {
                        const sourceName = docQA.filename ? `Uploaded document: ${docQA.filename}` : (docFilename ? `Uploaded document: ${docFilename}` : 'Uploaded document');
                        const response = `${docQA.answerText}\n\nSource: ${sourceName}`;
                        if (tenantId && !isContextDependentQueryLocal(originalQuery)) {
                            await storeInCache(originalQuery, response, tenantId, 'verified_knowledge', 0, 0);
                        }
                        return {
                            response,
                            source: 'tenant_documents',
                            aiPowered: true
                        };
                    }

                    // Fallback: short excerpt if AI is unavailable
                    const fallback = docSnippet ? String(docSnippet).trim().slice(0, 850) : null;
                    if (fallback) {
                        const docSourceName = docFilename ? `Uploaded document: ${docFilename}` : 'Uploaded document';
                        const response = `${fallback}\n\nSource: ${docSourceName}`;
                        if (tenantId && !isContextDependentQueryLocal(originalQuery)) {
                            await storeInCache(originalQuery, response, tenantId, 'verified_knowledge', 0, 0);
                        }
                        return {
                            response,
                            source: 'tenant_documents',
                            aiPowered: false,
                            exactFromWebsite: true
                        };
                    }
                }

                // For website: keep exact snippet behavior.
                const finalSnippet = websiteSnippet;
                if (finalSnippet) {
                    const sourceUrl = (hasWebsite && Array.isArray(websiteResults.sources))
                        ? websiteResults.sources[best?.index ?? 0]?.url
                        : null;
                    const sourceLine = sourceUrl ? `\n\nSource: ${sourceUrl}` : '';

                    if (tenantId && !isContextDependentQueryLocal(originalQuery)) {
                        await storeInCache(originalQuery, `${finalSnippet}${sourceLine}`, tenantId, 'verified_knowledge', 0, 0);
                    }
                    return {
                        response: `${finalSnippet}${sourceLine}`,
                        source: 'website_content',
                        aiPowered: false,
                        exactFromWebsite: true
                    };
                }
            }
        } catch (websiteError) {
            console.error('[SMART_ROUTER] Website search error:', websiteError.message);
        }
    }

    // FINAL FALLBACK (Knowledge): Use uploaded tenant documents (and optional website context) to answer.
    try {
        const { openai } = require('./config');
        const contextQuery = (isContextDependentQueryLocal(originalQuery) && retrievalQuery)
            ? retrievalQuery
            : originalQuery;

        const docsContext = await buildTenantDocumentsContext(tenantId, contextQuery, { limit: 2 });
        const productsInfoContext = await buildProductsInfoContext(tenantId, contextQuery, { limit: 3 });
        const chatHistoryContext = await buildChatHistoryContext(tenantId, phoneNumber, { limit: 6 });

        // Fetch website context when it plausibly helps (generic signals; no product-specific rules).
        let websiteContextBlock = null;
        const wordCount = String(originalQuery || '').trim().split(/\s+/).filter(Boolean).length;
        if (tenantId && (isProductInfoQuery(originalQuery) || wordCount <= 4 || isContextDependentQueryLocal(originalQuery))) {
            const websiteResults = await searchWebsiteForQuery(contextQuery, tenantId);
            if (websiteResults && websiteResults.found) {
                websiteContextBlock = `--- WEBSITE INDEXING (Crawled Content) ---\n${websiteResults.context}\n--- END WEBSITE INDEXING ---`;
            }
        }

        const combinedContext = [docsContext, productsInfoContext, chatHistoryContext, websiteContextBlock].filter(Boolean).join('\n\n');

        if (combinedContext) {
            const kbResponse = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: `You are a helpful sales assistant.

Answer the user's question using ONLY the context provided for factual claims (features, integrations, product specs, pricing).

If the context does not contain an explicit answer:
- For broad service requests (e.g., "I want to build a chatbot"), be helpful: explain the typical approach at a high level and ask 2–3 short clarifying questions.
- For specific feature/integration claims (e.g., SAP/webhooks/SSO), do NOT claim it's supported; say it may be possible via integration/customization and ask what system they use.

Do not invent facts.

IMPORTANT: Never paste large blocks of the provided context. If you need to cite, include at most 1 short quote.
Keep the reply concise.`
                    },
                    {
                        role: 'user',
                        content: `${combinedContext}\n\nUser Question: ${originalQuery}`
                    }
                ],
                temperature: 0.2,
                max_tokens: 320
            });

            const answer = kbResponse?.choices?.[0]?.message?.content?.trim();
            if (answer) {
                return {
                    response: answer,
                    source: 'ai_knowledge_fallback',
                    aiPowered: true
                };
            }
        }
    } catch (error) {
        console.error('[SMART_ROUTER][KB] Knowledge fallback error:', error?.message || error);
    }

    console.log('[SMART_ROUTER_DEBUG] NO RESPONSE FOUND - returning null');
    console.log('[SMART_ROUTER_DEBUG] ==========================================');
    return null; // No smart response available, use AI
};

const handleGeneralPriceInquiry = async (tenantId, query, phoneNumber = null) => {
    try {
        // Get a few popular products to show pricing
        const { data: products } = await supabase
            .from('products')
            .select('id, name, price, units_per_carton, packaging_unit')
            .eq('tenant_id', tenantId)
            .or('is_active.eq.true,is_active.eq.1')
            .limit(5);
            
        if (!products || products.length === 0) {
            return "Please contact us for current pricing information.";
        }
        
        let response = "📋 **Current Pricing:**\n\n";
        products.forEach(product => {
            const unitsPerCarton = parseInt(product.units_per_carton) || 1;
            const unitLabel = product.packaging_unit || 'unit';
            const perUnit = Number(product.price) || 0;
            const cartonPrice = perUnit * unitsPerCarton;
            const pricePerPiece = perUnit.toFixed(2);
            
            response += `📦 **${product.name}**\n`;
            response += `🔹 ₹${pricePerPiece}/pc per piece\n`;
            response += `💰 *₹${perUnit}/${unitLabel}*\n`;
            response += `📦 *₹${cartonPrice}/carton*\n`;
            response += `   (${unitsPerCarton} pcs/carton)\n\n`;
        });
        
        response += "💬 For specific products, ask: 'price of [product name]'";
        return response;
        
    } catch (error) {
        console.error('[PRICE_HANDLER] Error in general price inquiry:', error.message);
        return "Please contact us for current pricing information.";
    }
};
/**
 * Format individual product price response with personalized pricing
 */
const formatProductPrice = async (product, tenantId, phoneNumber = null, originalQuery = '') => {
    try {
        console.log('[FORMAT_PRICE] Product:', product.name, 'Phone:', phoneNumber || 'Not provided');
        
        // If phoneNumber is provided, use personalized pricing
        if (phoneNumber && product.id) {
            const priceDisplay = await formatPersonalizedPriceDisplay(tenantId, phoneNumber, product.id);
            if (priceDisplay) {
                console.log('[FORMAT_PRICE] Using personalized pricing for returning customer');
                return createPriceMessage(priceDisplay, true, originalQuery); // Pass originalQuery for quantity detection
            }
        }
        
        // Fallback to basic pricing if no phoneNumber or personalization unavailable
        console.log('[FORMAT_PRICE] Using basic pricing display');
        const unitsPerCarton = parseInt(product.units_per_carton) || 1;
        const unitLabel = product.packaging_unit || 'unit';
        const perUnit = Number(product.price) || 0;
        const cartonPrice = perUnit * unitsPerCarton;
        const pricePerPiece = perUnit.toFixed(2);
        
        // Check if quantity was mentioned in the original query
        const quantityMatch = originalQuery.match(/(\d+)\s*(?:pcs?|pieces?|cartons?|ctns?)/i);
        let response = `📦 *${product.name}*\n\n`;
        response += `💵 *Price*\n`;
        response += `━━━━━━━━━━━━━━━━━\n`;
        response += `🔹 *₹${pricePerPiece}/pc* per piece\n`;
        response += `💰 *₹${perUnit}/${unitLabel}*\n`;
        response += `📦 *₹${cartonPrice}/carton*\n\n`;
        
        if (quantityMatch) {
            const quantity = parseInt(quantityMatch[1]);
            const unit = quantityMatch[0].match(/cartons?|ctns?/i) ? 'cartons' : 'pieces';
            
            let finalQuantity, totalAmount;
            if (unit === 'pieces') {
                // Convert pieces to cartons - show exact then rounded
                const exactCartons = (quantity / unitsPerCarton).toFixed(2);
                const roundedCartons = Math.ceil(quantity / unitsPerCarton);
                finalQuantity = roundedCartons;
                totalAmount = (roundedCartons * cartonPrice).toFixed(2);
                
                response += `📊 *Quote for ${quantity.toLocaleString('en-IN')} pieces:*\n`;
                response += `   ${quantity.toLocaleString('en-IN')} pcs ÷ ${unitsPerCarton} pcs/carton = ${exactCartons} cartons\n`;
                response += `   (Rounded to ${roundedCartons} carton${roundedCartons !== 1 ? 's' : ''})\n`;
                response += `   ${roundedCartons} carton${roundedCartons !== 1 ? 's' : ''} × ₹${cartonPrice.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})} = *₹${parseFloat(totalAmount).toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}*\n\n`;
            } else {
                // Already in cartons
                finalQuantity = quantity;
                totalAmount = (quantity * cartonPrice).toFixed(2);
                
                response += `📊 *Quote for ${quantity} carton${quantity !== 1 ? 's' : ''}:*\n`;
                response += `   ${quantity} carton${quantity !== 1 ? 's' : ''} × ₹${cartonPrice.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})} = *₹${parseFloat(totalAmount).toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}*\n\n`;
            }
            
            response += `💡 *Volume Discounts:*\n`;
            response += `* 11-25 ctns: 2-3% • 26-50 ctns: 3-5%\n`;
            response += `* 51-100 ctns: 5-7% • 100+ ctns: 7-10%\n\n`;
            response += `🛒 Ready to add ${quantity.toLocaleString('en-IN')} ${unit} to your cart? Just say "yes"!`;
        } else {
            response += `📊 *Breakdown:*\n`;
            response += `   ₹${pricePerPiece}/pc × ${unitsPerCarton} pcs = ₹${cartonPrice.toFixed(2)}/carton\n\n`;
            response += `💡 *Volume Discounts:*\n`;
            response += `* 11-25 ctns: 2-3% • 26-50 ctns: 3-5%\n`;
            response += `* 51-100 ctns: 5-7% • 100+ ctns: 7-10%\n\n`;
            response += `🛒 Ready to order? Let me know the quantity!`;
        }
        
        return response;
        
    } catch (error) {
        console.error('[FORMAT_PRICE] Error:', error.message);
        // Fallback to simple format
        let response = `💰 **${product.name} Pricing**\n\n`;
        const upcFallback = product.units_per_carton && product.units_per_carton > 0 ? product.units_per_carton : 1;
        const unitLabelFallback = product.packaging_unit || 'unit';
        const perUnitFallback = Number(product.price) || 0;
        const cartonPriceFallback = perUnitFallback * upcFallback;
        response += `Price: ₹${perUnitFallback}/${unitLabelFallback}\n`;
        response += `Carton: ₹${cartonPriceFallback}/carton (${upcFallback} pcs/carton)\n`;
        
        if (upcFallback > 1) response += `Per piece: ₹${perUnitFallback.toFixed(2)}\n`;
        
        response += `\nReady to place an order? Just let me know the quantity!`;
        return response;
    }
};
/**
 * Handle availability queries
 */
const handleAvailabilityQueries = async (query, tenantId) => {
    const availabilityPatterns = [
        /(?:available|stock|have|hain|hai).*(\d+[x*]\d+)/i,
        /(\d+[x*]\d+).*(?:available|stock|milega|hain|hai)/i,
        /(?:aapke paas|do you have|paas).*(\d+[x*]\d+)/i,
        /(\d+[x*]\d+)\s+(?:hain|hai)/i  // Direct pattern like "8x80 hain"
    ];

    const nameAvailabilityPatterns = [
        // English + Hinglish: "do you have notebook scale", "aapke paas notebook scale hai"
        /(?:do\s+you\s+have|do\s+u\s+have|have\s+you\s+got|aapke\s+paas|aap\s+ke\s+paas|paas)\s+(?:any\s+)?(.+?)(?:\?|$)/i,
        // "is notebook scale available"
        /(?:is|are)\s+(.+?)\s+(?:available|in\s+stock|stock\s+mein|stock\s+me|milega|hai|hain)(?:\?|$)/i,
        // "notebook scale available?"
        /^(.+?)\s+(?:available|in\s+stock|stock\s+mein|stock\s+me)\??$/i
    ];
    
    console.log('[AVAILABILITY] Checking query:', query);
    
    for (const pattern of availabilityPatterns) {
        const match = query.match(pattern);
        if (match) {
            const productCode = match[1].replace('*', 'x');
            console.log('[AVAILABILITY] Matched pattern, looking up:', productCode);
            const product = await findProductByCode(tenantId, productCode);
            
            if (product) {
                console.log('[AVAILABILITY] Product found:', product.name);
                const upc = parseInt(product.units_per_carton, 10) > 0 ? parseInt(product.units_per_carton, 10) : 1;
                const unitLabel = product.packaging_unit || 'unit';
                const perUnit = Number(product.price) || 0;
                const cartonPrice = perUnit * upc;
                return `✅ **Haan, ${product.name} available hai!**\n\nPrice: ₹${perUnit}/${unitLabel}\nCarton: ₹${cartonPrice}/carton (${upc} pcs/carton)\n\nKitne cartons chahiye?`;
            } else {
                console.log('[AVAILABILITY] Product not found:', productCode);
            }
        }
    }

    // If no size/code matched, try name-based availability (e.g., "do you have notebook scale")
    for (const pattern of nameAvailabilityPatterns) {
        const match = query.match(pattern);
        if (!match) continue;

        const rawName = String(match[1] || '').trim();
        if (!rawName || rawName.length < 2) continue;

        // Guard against generic non-product asks (discounts, services, etc.)
        const lowered = rawName.toLowerCase();
        const ignoreIfContains = [
            'discount', 'offer', 'scheme',
            'service', 'services', 'products', 'catalog',
            'website', 'software', 'chatbot', 'crm', 'whatsapp', 'integration'
        ];
        if (ignoreIfContains.some(w => lowered.includes(w))) continue;

        console.log('[AVAILABILITY] Name-based lookup for:', rawName);
        const product = await findProductByName(tenantId, rawName);
        if (product) {
            const stockLine = (product.stock_quantity !== undefined && product.stock_quantity !== null)
                ? `Stock: ${product.stock_quantity}\n`
                : '';
            const skuLine = product.sku ? `SKU: ${product.sku}\n` : '';

            const upc = parseInt(product.units_per_carton, 10) > 0 ? parseInt(product.units_per_carton, 10) : 1;
            const unitLabel = product.packaging_unit || 'unit';
            const perUnit = Number(product.price) || 0;
            const cartonPrice = perUnit * upc;
            return `✅ Yes — *${product.name}* is available.\n\nPrice: ₹${perUnit}/${unitLabel}\nCarton: ₹${cartonPrice}/carton (${upc} pcs/carton)\n${stockLine}${skuLine}\nHow many cartons would you like?`;
        }
    }

    console.log('[AVAILABILITY] No pattern matched');
    return null;
};

/**
 * Find product by a free-text name/keyword.
 * Keeps it simple: exact name → name LIKE/ILIKE → sku LIKE/ILIKE → description LIKE/ILIKE.
 */
const findProductByName = async (tenantId, rawSearch) => {
    try {
        const search = String(rawSearch || '')
            .trim()
            .replace(/[\r\n\t]+/g, ' ')
            .replace(/[\?\!\.,]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        if (!search || search.length < 2) return null;

        // Exact name first
        const { data: exact } = await supabase
            .from('products')
            .select('*')
            .eq('tenant_id', tenantId)
            .or('is_active.eq.true,is_active.eq.1')
            .eq('name', search)
            .maybeSingle();

        if (exact) return exact;

        async function searchField(field) {
            let { data } = await supabase
                .from('products')
                .select('*')
                .eq('tenant_id', tenantId)
                .or('is_active.eq.true,is_active.eq.1')
                .ilike(field, `%${search.toLowerCase()}%`)
                .neq('price', 0);

            if (!data || data.length === 0) {
                const likeAttempt = await supabase
                    .from('products')
                    .select('*')
                    .eq('tenant_id', tenantId)
                    .or('is_active.eq.true,is_active.eq.1')
                    .like(field, `%${search.toLowerCase()}%`)
                    .neq('price', 0);
                data = likeAttempt.data;
            }
            return Array.isArray(data) ? data : [];
        }

        let products = await searchField('name');
        if (products.length === 0) products = await searchField('sku');
        if (products.length === 0) products = await searchField('description');
        if (products.length === 0) return null;

        // Prefer the closest match: more matched words in the product name
        const words = search.toLowerCase().split(' ').filter(w => w.length >= 2);
        const scored = products.map(p => {
            const name = String(p.name || '').toLowerCase();
            const score = words.reduce((acc, w) => acc + (name.includes(w) ? 1 : 0), 0);
            return { p, score };
        }).sort((a, b) => b.score - a.score);

        return scored[0]?.p || products[0];
    } catch (error) {
        console.error('[PRODUCT_SEARCH] Error finding product by name:', error.message);
        return null;
    }
};

// Handle specification queries
const handleSpecQueries = async (query, tenantId) => {
    const specPatterns = [
        /(?:specs|specifications|details).*(\d+[x*]\d+)/i,
        /(\d+[x*]\d+).*(?:specs|details|information)/i,
        /(?:tell me about|kya hai).*(\d+[x*]\d+)/i
    ];
    
    for (const pattern of specPatterns) {
        const match = query.match(pattern);
        if (match) {
            const productCode = match[1].replace('*', 'x');
            const product = await findProductByCode(tenantId, productCode);
            
            if (product) {
                let response = `📋 **${product.name} Specifications**\n\n`;
                response += `• Price: ₹${product.price}/carton\n`;
                response += `• Carton size: ${product.units_per_carton || 1} pieces\n`;
                response += `• Per piece: ₹${(product.price / (product.units_per_carton || 1)).toFixed(2)}\n`;
                if (product.description) {
                    response += `\n${product.description}`;
                }
                return response;
            }
        }
    }
    return null;
}

// Handle business queries with cached responses
const handleBusinessQueries = async (query, tenantId, detectedLanguage = 'en', phoneNumber = null) => {
    try {
        const { openai } = require('./config');
        
        // 🎯 LAYER 2: CHECK CACHE FIRST for business queries
        const cached = await checkCache(query, tenantId);
        if (cached) {
            console.log('[BUSINESS_CACHE] ✅ Cache hit! Saved $0.0008');
            return cached.response;
        }
        
        // Use AI to detect if this is a general business/company info query
        const analysis = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{
                role: 'system',
                content: `Analyze if this customer query is asking for general business information (company info, about us, product overview, etc.) or operational details (delivery, payment, minimum order).

Respond in JSON:
{
  "isBusinessQuery": true/false,
  "queryType": "company_info" | "product_overview" | "delivery" | "payment" | "minimum_order" | "other",
  "shouldSearchWebsite": true/false,
  "confidence": 0.0-1.0
}

Guidelines:
- "company_info": Questions about the company, who we are, what we do, our business
- "product_overview": General questions about products, product range, what products we have
- "delivery": Questions about shipping, delivery, transport
- "payment": Questions about payment methods, how to pay
- "minimum_order": Questions about minimum order quantities
- shouldSearchWebsite: true for company_info and product_overview, false for operational details`
            }, {
                role: 'user',
                content: query
            }],
            response_format: { type: 'json_object' },
            temperature: 0.2
        });
        
        const result = JSON.parse(analysis.choices[0].message.content);
        console.log('[BUSINESS_QUERIES_AI]', result);
        
        if (!result.isBusinessQuery) {
            return null;
        }
        
        // Handle operational queries with predefined responses (cache these too)
        let response = null;
        
        if (result.queryType === 'delivery') {
            response = "🚛 We provide delivery across major cities. Delivery time: 2-3 business days. Free delivery on orders above ₹10,000.";
        }
        
        if (result.queryType === 'payment') {
            response = "💳 We accept bank transfer, UPI, and cash on delivery. Payment details shared after order confirmation.";
        }
        
        if (result.queryType === 'minimum_order') {
            response = "📦 Minimum order: 1 carton per product. Bulk discounts available on larger quantities.";
        }
        
        // Cache and return operational responses
        if (response) {
            await storeInCache(query, response, tenantId, result.queryType, 0, 0);
            return response;
        }
        
        // For company info and product overview, ALWAYS try website content first
        if (result.shouldSearchWebsite) {
            console.log('[BUSINESS_QUERIES_AI] Searching website for:', result.queryType);
            
            // Try semantic search first
            const websiteResults = await searchWebsiteForQuery(query, tenantId);
            
            if (websiteResults && websiteResults.found) {
                console.log('[BUSINESS_QUERIES_AI] ✅ Found', websiteResults.count, 'results from website (semantic search)!');
                
                // Use AI to generate intelligent response from website content
                const { openai } = require('./config');
                const aiResponse = await openai.chat.completions.create({
                    model: 'gpt-4o-mini',
                    messages: [{
                        role: 'system',
                        content: `You are a helpful assistant answering questions about the company using information from their website.

IMPORTANT:
- Answer based on the website content provided
- Be conversational and natural
- Keep responses concise but informative
- Respond in ${detectedLanguage === 'ar' ? 'Arabic (العربية)' : detectedLanguage === 'hi' ? 'Hindi' : detectedLanguage === 'ur' ? 'Urdu (اردو)' : 'English'}`
                    }, {
                        role: 'user',
                        content: `Customer asked: "${query}"

Website content:
${websiteResults.context}

Answer the customer's question using the information above. Be helpful and specific.`
                    }],
                    temperature: 0.3,
                    max_tokens: 500
                });
                
                const aiResponseText = aiResponse.choices[0].message.content;
                const tokens = aiResponse.usage?.total_tokens || 0;
                const cost = tokens * 0.0000008;
                
                // Cache the response
                await storeInCache(query, aiResponseText, tenantId, 'website_semantic', tokens, cost);
                console.log(`[BUSINESS_CACHE] Stored response (${tokens} tokens, $${cost.toFixed(6)})`);
                
                return aiResponseText;
            }
            
            // If semantic search fails, try direct database query with broader search
            console.log('[BUSINESS_QUERIES_AI] Semantic search failed, trying direct content query...');
            
            const { data: allContent } = await supabase
                .from('website_embeddings')
                .select('page_title, chunk_text, content, url')
                .eq('tenant_id', tenantId)
                .eq('status', 'active')
                .limit(10);
            
            if (allContent && allContent.length > 0) {
                console.log('[BUSINESS_QUERIES_AI] ✅ Found', allContent.length, 'website chunks, using AI to answer...');
                
                // Combine all content
                const combinedContent = allContent.map((item, idx) => 
                    `[Section ${idx + 1}]\n${item.chunk_text || item.content || ''}`
                ).join('\n\n');
                
                // Use AI to answer from the content
                const { openai } = require('./config');
                const aiResponse = await openai.chat.completions.create({
                    model: 'gpt-4o-mini',
                    messages: [{
                        role: 'system',
                        content: `You are a helpful assistant answering questions about the company using information from their website.

IMPORTANT:
- Extract relevant information from the website content provided
- Be conversational and natural
- Focus on what the customer asked about
- If you find company name, services, or other details, use them
- Respond in ${detectedLanguage === 'ar' ? 'Arabic (العربية)' : detectedLanguage === 'hi' ? 'Hindi' : detectedLanguage === 'ur' ? 'Urdu (اردو)' : 'English'}`
                    }, {
                        role: 'user',
                        content: `Customer asked: "${query}"

Website content from our company website:
${combinedContent.substring(0, 3000)}

Answer the customer's question using the information above. Extract and present relevant details naturally.`
                    }],
                    temperature: 0.3,
                    max_tokens: 500
                });
                
                const aiResponseText = aiResponse.choices[0].message.content;
                const tokens = aiResponse.usage?.total_tokens || 0;
                const cost = tokens * 0.0000008;
                
                // Cache the response
                await storeInCache(query, aiResponseText, tenantId, 'website_direct', tokens, cost);
                console.log(`[BUSINESS_CACHE] Stored response (${tokens} tokens, $${cost.toFixed(6)})`);
                
                return aiResponseText;
            } else {
                console.log('[BUSINESS_QUERIES_AI] No website content found');
                
                // If asking about products, fetch from database instead of generic message
                if (result.queryType === 'product_overview') {
                    console.log('[BUSINESS_QUERIES_AI] Fetching products from database...');
                    
                    const { data: products } = await supabase
                        .from('products')
                        .select('id, name, description, price, packaging_unit, units_per_carton')
                        .eq('tenant_id', tenantId)
                        .or('is_active.eq.true,is_active.eq.1')
                        .order('created_at', { ascending: false })
                        .limit(10);
                    
                    if (products && products.length > 0) {
                        console.log('[BUSINESS_QUERIES_AI] Found', products.length, 'products, generating response...');
                        return await generateResponseWithAI(products, query, detectedLanguage, tenantId, phoneNumber);
                    }
                }
                
                // ✅ FIXED: Fetch REAL tenant business information instead of making up fake info
                console.log('[BUSINESS_QUERIES_AI] Fetching tenant business info from database...');
                
                const { data: tenant } = await supabase
                    .from('tenants')
                    .select('business_name, business_description, business_address, business_website')
                    .eq('id', tenantId)
                    .single();
                
                // If we have real business info, use AI to create a proper response
                if (tenant && (tenant.business_name || tenant.business_description)) {
                    console.log('[BUSINESS_QUERIES_AI] Using real tenant info:', tenant.business_name);
                    
                    const businessInfo = `
Business Name: ${tenant.business_name || 'Not set'}
${tenant.business_description ? `Description: ${tenant.business_description}` : ''}
${tenant.business_address ? `Address: ${tenant.business_address}` : ''}
${tenant.business_website ? `Website: ${tenant.business_website}` : ''}
`.trim();
                    
                    // Use AI to generate proper response with actual business info
                    const { openai } = require('./config');
                    const aiResponse = await openai.chat.completions.create({
                        model: 'gpt-4o-mini',
                        messages: [{
                            role: 'system',
                            content: `You are a helpful assistant. Provide business information based ONLY on the facts provided. 
NEVER make up information. If information is not available, say so honestly.
Respond in ${detectedLanguage === 'ar' ? 'Arabic' : detectedLanguage === 'hi' ? 'Hindi' : detectedLanguage === 'ur' ? 'Urdu' : 'English'}.`
                        }, {
                            role: 'user',
                            content: `Customer asked: "${query}"

Available business information:
${businessInfo}

Provide a helpful response using ONLY the information above. Keep it concise and professional.`
                        }],
                        temperature: 0.3,
                        max_tokens: 300
                    });
                    
                    return aiResponse.choices[0].message.content;
                }
                
                // ✅ HONEST fallback if no business info is available - NEVER make up fake information
                const honestResponses = {
                    'ar': 'عذراً، لم أجد معلومات تفصيلية عن الشركة حالياً. هل يمكنني مساعدتك بشيء آخر؟ يمكنني إخبارك عن المنتجات أو مساعدتك في الطلب.',
                    'hi': 'क्षमा करें, मुझे कंपनी की विस्तृत जानकारी नहीं मिली। क्या मैं किसी और चीज़ में आपकी मदद कर सकता हूं? मैं आपको उत्पादों के बारे में बता सकता हूं या ऑर्डर में मदद कर सकता हूं।',
                    'hinglish': 'Sorry, mujhe company ki detailed information nahi mili. Kya main aapki kisi aur cheez mein madad kar sakta hoon? Main aapko products ke baare mein bata sakta hoon ya order mein help kar sakta hoon.',
                    'ur': 'معذرت، مجھے کمپنی کی تفصیلی معلومات نہیںملی۔ کیا میں کسی اور چیز میں آپ کی مدد کر سکتا ہوں؟ میں آپ کو مصنوعات کے بارے میں بتا سکتا ہوں یا آرڈر میں مدد کر سکتا ہوں۔',
                    'en': 'I don\'t have detailed company information available right now. Can I help you with something else? I can tell you about our products or help you place an order.'
                };
                
                return honestResponses[detectedLanguage] || honestResponses['en'];
            }
        }
        
        return null;
        
    } catch (error) {
        console.error('[BUSINESS_QUERIES_AI] Error:', error.message);
        return null;
    }
};

/**
 * Find product by code (enhanced version)
 */
// =============================================================================
// FIX 1: Enhanced findProductByCode in smartResponseRouter.js
// =============================================================================

/**
 * Find product by code (enhanced version with exact pattern matching)
 */
const findProductByCode = async (tenantId, productCode) => {
    try {
        console.log('[PRODUCT_SEARCH] Looking for product code:', productCode);
        const code = productCode.trim().toLowerCase();
        
        // First, try exact matches with common patterns
        const exactPatterns = [
            `NFF ${productCode}`,
            `NFF-${productCode}`,
            `NFF ${productCode.toUpperCase()}`,
            `NFF ${productCode.toLowerCase()}`
        ];
        
        for (const pattern of exactPatterns) {
            const { data: exactMatch } = await supabase
                .from('products')
                .select('*')
                .eq('tenant_id', tenantId)
                .or('is_active.eq.true,is_active.eq.1')
                .eq('name', pattern)
                .maybeSingle();
            
            if (exactMatch) {
                console.log('[PRODUCT_SEARCH] Found exact match:', exactMatch.name);
                return exactMatch;
            }
        }
        
        // If no exact match, try pattern matching.
        // NOTE: SQLite mode doesn't support Postgres ILIKE, so we fall back to LIKE.
        let { data: products } = await supabase
            .from('products')
            .select('*')
            .eq('tenant_id', tenantId)
            .or('is_active.eq.true,is_active.eq.1')
            .ilike('name', `%${code}%`)
            .neq('price', 0);

        if (!products || products.length === 0) {
            const likeAttempt = await supabase
                .from('products')
                .select('*')
                .eq('tenant_id', tenantId)
                .or('is_active.eq.true,is_active.eq.1')
                .like('name', `%${code}%`)
                .neq('price', 0);
            products = likeAttempt.data;
        }

        if (!products || products.length === 0) {
            console.log('[PRODUCT_SEARCH] No products found for code:', productCode);
            return null;
        }

        // Filter to find the most specific match
        // Prioritize products where the code appears at clear boundaries
        // Examples that should match: "8x80 ...", "... 8x80 ...", "...-8x80-...", "... 8x80"
        const escapedCode = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const boundaryRegex = new RegExp(`(^|[\\s-])${escapedCode}($|[\\s-])`);
        const exactCodeMatch = products.find(product => {
            const name = (product.name || '').toLowerCase();
            return boundaryRegex.test(name);
        });

        if (exactCodeMatch) {
            console.log('[PRODUCT_SEARCH] Found specific match:', exactCodeMatch.name);
            return exactCodeMatch;
        }

        console.log('[PRODUCT_SEARCH] No suitable product found for:', productCode);
        return null;
    } catch (error) {
        console.error('[PRODUCT_SEARCH] Error finding product:', error.message);
        return null;
    }
};

// Ensure all exported functions are defined at the top level
// (No changes to function bodies, just a comment for clarity)
module.exports = {
    getSmartResponse,
    handlePriceQueriesFixed,
    handleAvailabilityQueries,
    handleBusinessQueries,
    findProductByCode,
    handleMultiProductPriceInquiry
};
