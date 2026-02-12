const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// Configuration from environment variables
const TARGET_URL = process.env.TARGET_URL;
const DATA_VARIABLE_NAME = process.env.DATA_VARIABLE_NAME;

function parseUpdateStamp(update) {
    // Expected like: "11.02.2026 21:12" (dd.mm.yyyy HH:MM)
    if (typeof update !== 'string') return null;
    const m = update.match(/(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})/);
    if (!m) return null;
    const day = Number(m[1]);
    const month = Number(m[2]);
    const year = Number(m[3]);
    const hour = Number(m[4]);
    const minute = Number(m[5]);
    if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year) || !Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    // A comparable number (not a timestamp) for ordering.
    return (((year * 100 + month) * 100 + day) * 100 + hour) * 100 + minute;
}

function looksLikeSchedule(obj) {
    return !!(obj && typeof obj === 'object' && obj.data && obj.today && obj.update);
}

function createScheduleNetworkCollector(page) {
    let best = null;
    let bestScore = -1;
    let bestUrl = null;
    let resolveFirst;
    const firstFound = new Promise((resolve) => {
        resolveFirst = resolve;
    });

    const maybeUpdateBest = (candidate, url) => {
        if (!looksLikeSchedule(candidate)) return;
        const score = parseUpdateStamp(candidate.update) ?? 0;
        if (!best || score > bestScore) {
            best = candidate;
            bestScore = score;
            bestUrl = url;
            resolveFirst(best);
        }
    };

    page.on('response', async (response) => {
        try {
            if (!response.ok()) return;
            const headers = response.headers();
            const ct = (headers['content-type'] || '').toLowerCase();
            const resourceType = response.request().resourceType();
            const url = response.url();
            const isLikelyJson = ct.includes('json') || url.toLowerCase().endsWith('.json');
            const isApiLike = resourceType === 'xhr' || resourceType === 'fetch';
            if (!isLikelyJson && !isApiLike) return;

            // Guard against very large responses.
            const text = await response.text();
            if (!text || text.length > 6_000_000) return;

            let json;
            try {
                json = JSON.parse(text);
            } catch {
                return;
            }

            maybeUpdateBest(json, url);
        } catch {
            // ignore individual response parsing errors
        }
    });

    return {
        waitForFirst: async (timeoutMs) => {
            const timeout = new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs));
            return await Promise.race([firstFound, timeout]);
        },
        getBest: () => best,
        getBestUrl: () => bestUrl
    };
}

function withCacheBust(url) {
    const cacheBust = `_cb=${Date.now()}`;
    return url.includes('?') ? `${url}&${cacheBust}` : `${url}?${cacheBust}`;
}

function isSafeJsPathExpression(expr) {
    // Allow identifiers, dots, and bracket access with quotes or numbers.
    // Examples: dataVar, window.dataVar, some.ns["key"], some.ns['key'], arr[0]
    return typeof expr === 'string' && /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[(?:\d+|"[^"]+"|'[^']+')\])*$/u.test(expr);
}

async function scrapeSchedule() {
    console.log('Starting scraper...');

    if (!TARGET_URL) {
        throw new Error('TARGET_URL env var is required');
    }
    if (!DATA_VARIABLE_NAME) {
        console.warn('DATA_VARIABLE_NAME is not set; will attempt auto-detection from page scripts.');
    } else if (!isSafeJsPathExpression(DATA_VARIABLE_NAME)) {
        throw new Error(
            'DATA_VARIABLE_NAME contains unsupported characters. ' +
            'Expected a JS path expression like window.dataVar or some.ns["key"].'
        );
    }
    
    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    // Playwright doesn't expose a direct "disable cache" API on Page.
    // For Chromium, use CDP to disable cache; if unavailable, continue with best-effort headers.
    try {
        const context = page.context();
        const cdp = await context.newCDPSession(page);
        await cdp.send('Network.enable');
        await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    } catch (e) {
        console.warn('Could not disable cache via CDP:', e && e.message ? e.message : String(e));
    }

    const scheduleCollector = createScheduleNetworkCollector(page);
    
    // Set realistic browser settings
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.setExtraHTTPHeaders({
        'Accept-Language': 'uk-UA,uk;q=0.9,en-US;q=0.8,en;q=0.7',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
    });
    
    try {
        console.log('Navigating to target website...');
        await page.goto(withCacheBust(TARGET_URL), {
            // networkidle can hang on sites with long-polling; we’ll wait for data explicitly.
            waitUntil: 'domcontentloaded',
            timeout: 60000
        });
        
        console.log('Waiting for page to fully load...');
        // Give the site a chance to fetch dynamic data.
        await page.waitForTimeout(4000);

        console.log('Listening for schedule JSON responses...');
        await scheduleCollector.waitForFirst(15000);
        // Give a brief grace period to prefer the newest schedule if multiple responses arrive.
        await page.waitForTimeout(2000);
        const networkSchedule = scheduleCollector.getBest();
        
        // Extract schedule data from the page
        console.log('Extracting schedule data...');

        // Wait for anti-bot challenges / JS hydration to settle.
        await page.waitForTimeout(2000);

        const scheduleData = networkSchedule || await page.evaluate(async (varName) => {
            const looksLikeSchedule = (obj) => {
                return obj && typeof obj === 'object' && obj.data && obj.today && obj.update;
            };

            const deepClone = (obj) => {
                try {
                    return JSON.parse(JSON.stringify(obj));
                } catch {
                    return null;
                }
            };

            const getByExpression = (expr) => {
                if (!expr) return undefined;
                try {
                    // expr is validated on Node side (restricted JS path expression)
                    // eslint-disable-next-line no-new-func
                    return (new Function(`return (${expr});`))();
                } catch {
                    return undefined;
                }
            };

            const extractJsonObjectAfterEquals = (text, equalsIndex) => {
                // Find first '{' after '=' and then parse balanced braces.
                const start = text.indexOf('{', equalsIndex);
                if (start === -1) return null;
                let depth = 0;
                let inString = false;
                let stringQuote = '';
                let escaped = false;
                for (let i = start; i < text.length; i++) {
                    const ch = text[i];
                    if (inString) {
                        if (escaped) {
                            escaped = false;
                            continue;
                        }
                        if (ch === '\\') {
                            escaped = true;
                            continue;
                        }
                        if (ch === stringQuote) {
                            inString = false;
                            stringQuote = '';
                        }
                        continue;
                    }
                    if (ch === '"' || ch === "'") {
                        inString = true;
                        stringQuote = ch;
                        continue;
                    }
                    if (ch === '{') depth++;
                    if (ch === '}') {
                        depth--;
                        if (depth === 0) {
                            const jsonText = text.slice(start, i + 1);
                            try {
                                return JSON.parse(jsonText);
                            } catch {
                                return null;
                            }
                        }
                    }
                }
                return null;
            };

            // Primary path: read the live JS object by variable name (preferred).
            if (varName) {
                for (let attempt = 0; attempt < 10; attempt++) {
                    const candidate = getByExpression(varName);
                    if (looksLikeSchedule(candidate)) {
                        // Give the page a moment to fetch/refresh, then re-check.
                        await new Promise((r) => setTimeout(r, 750));
                        const candidate2 = getByExpression(varName);
                        const chosen = looksLikeSchedule(candidate2) ? candidate2 : candidate;
                        return deepClone(chosen);
                    }
                    await new Promise((r) => setTimeout(r, 500));
                }
            }

            // Fallback: scan script tags and try to find a JSON blob with keys data/today/update.
            const scripts = Array.from(document.scripts || []).map((s) => s.textContent || '').filter(Boolean);
            for (let i = scripts.length - 1; i >= 0; i--) {
                const t = scripts[i];
                if (!t.includes('"today"') && !t.includes('today')) continue;
                if (!t.includes('"update"') && !t.includes('update')) continue;
                if (!t.includes('"data"') && !t.includes('data')) continue;

                // Try a few common assignment patterns.
                const patterns = [
                    /(?:window\.)?[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*=\s*/g,
                    /(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*/g
                ];

                for (const re of patterns) {
                    re.lastIndex = 0;
                    let m;
                    while ((m = re.exec(t))) {
                        const obj = extractJsonObjectAfterEquals(t, re.lastIndex);
                        if (looksLikeSchedule(obj)) {
                            return deepClone(obj);
                        }
                    }
                }
            }

            return null;
        }, DATA_VARIABLE_NAME || null);
        
        // Create output directory if it doesn't exist
        const outputDir = path.join(__dirname, 'scraped-data');
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
        
        const timestamp = new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Kiev', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
        
        // Save extracted schedule JSON only
        if (scheduleData) {
            const scheduleWithMeta = {
                ...scheduleData,
                scraped_at: timestamp
            };
            
            fs.writeFileSync(
                path.join(outputDir, 'schedule.json'),
                JSON.stringify(scheduleWithMeta, null, 2)
            );
            console.log('Saved schedule data to schedule.json');
            
            // Save metadata
            const metadata = {
                timestamp: timestamp,
                success: true,
                schedule_extracted: true,
                last_update: scheduleData.update,
                extraction_source: networkSchedule ? 'network-json' : 'page-eval',
                // Intentionally not exposing URLs / variable names / endpoints.
                // This file is published to GitHub Pages.
                extraction_url: null
            };
            fs.writeFileSync(
                path.join(outputDir, 'latest-metadata.json'),
                JSON.stringify(metadata, null, 2)
            );
            
            console.log('Scraping completed successfully!');
        } else {
            console.warn('Could not extract schedule data from page');
            throw new Error('Failed to extract schedule data');
        }
        
        console.log('Scraping completed successfully!');
        
    } catch (error) {
        console.error('Error during scraping:', error);
        
        // Save error info
        const outputDir = path.join(__dirname, 'scraped-data');
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
        
        const errorData = {
            timestamp: new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Kiev', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
            error: error.message,
            success: false,
            schedule_extracted: false
        };
        fs.writeFileSync(
            path.join(outputDir, 'latest-metadata.json'),
            JSON.stringify(errorData, null, 2)
        );
        
        throw error;
    } finally {
        await browser.close();
    }
}

scrapeSchedule();
