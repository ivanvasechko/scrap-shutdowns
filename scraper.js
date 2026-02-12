const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const CONFIG = Object.freeze({
    outputDirName: 'scraped-data',
    outputScheduleFile: 'schedule.json',
    outputMetadataFile: 'latest-metadata.json',
    timeZone: 'Europe/Kiev',
    locale: 'uk-UA',
    navigationTimeoutMs: 60_000,
    initialLoadWaitMs: 4_000,
    hydrateWaitMs: 2_000,
    networkCollectTimeoutMs: 15_000,
    networkGracePeriodMs: 2_000,
    maxResponseChars: 6_000_000
});

// Configuration from environment variables (never log their values)
const TARGET_URL = process.env.TARGET_URL;
const DATA_VARIABLE_NAME = process.env.DATA_VARIABLE_NAME;

function logInfo(...args) {
    console.log(...args);
}

function logWarn(...args) {
    console.warn(...args);
}

function logError(...args) {
    console.error(...args);
}

function getOutputDir() {
    return path.join(__dirname, CONFIG.outputDirName);
}

function ensureDirExists(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function writeJsonFile(filePath, obj) {
    fs.writeFileSync(filePath, JSON.stringify(obj, null, 2));
}

function nowTimestampLocal() {
    return new Date().toLocaleString(CONFIG.locale, {
        timeZone: CONFIG.timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
}

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
            if (!text || text.length > CONFIG.maxResponseChars) return;

            let json;
            try {
                json = JSON.parse(text);
            } catch {
                return;
            }

            // url intentionally not persisted or logged to avoid exposing parsing sources.
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
        getBest: () => best
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

function validateConfig() {
    if (!TARGET_URL) {
        throw new Error('TARGET_URL env var is required');
    }
    if (!DATA_VARIABLE_NAME) {
        // Keep message generic; do not reveal any source-specific parsing details.
        logWarn('DATA_VARIABLE_NAME is not set; will attempt auto-detection.');
        return;
    }
    if (!isSafeJsPathExpression(DATA_VARIABLE_NAME)) {
        throw new Error(
            'DATA_VARIABLE_NAME contains unsupported characters. ' +
            'Expected a JS path expression like window.dataVar or some.ns["key"].'
        );
    }
}

async function createPage(browser) {
    const page = await browser.newPage();

    // Best-effort cache disable for Chromium.
    try {
        const context = page.context();
        const cdp = await context.newCDPSession(page);
        await cdp.send('Network.enable');
        await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    } catch (e) {
        logWarn('Could not disable cache via CDP:', e && e.message ? e.message : String(e));
    }

    // Set realistic browser settings
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.setExtraHTTPHeaders({
        'Accept-Language': 'uk-UA,uk;q=0.9,en-US;q=0.8,en;q=0.7',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
    });

    return page;
}

async function navigateAndCollectNetworkSchedule(page) {
    const scheduleCollector = createScheduleNetworkCollector(page);

    logInfo('Loading page...');
    await page.goto(withCacheBust(TARGET_URL), {
        waitUntil: 'domcontentloaded',
        timeout: CONFIG.navigationTimeoutMs
    });

    logInfo('Waiting for content to load...');
    await page.waitForTimeout(CONFIG.initialLoadWaitMs);

    logInfo('Collecting schedule data...');
    await scheduleCollector.waitForFirst(CONFIG.networkCollectTimeoutMs);
    await page.waitForTimeout(CONFIG.networkGracePeriodMs);
    return scheduleCollector.getBest();
}

async function extractScheduleFromPage(page) {
    logInfo('Extracting schedule...');
    await page.waitForTimeout(CONFIG.hydrateWaitMs);

    return await page.evaluate(async (varName) => {
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

        // Primary path: read the live JS object by variable name.
        if (varName) {
            for (let attempt = 0; attempt < 10; attempt++) {
                const candidate = getByExpression(varName);
                if (looksLikeSchedule(candidate)) {
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
            if (!t.includes('today')) continue;
            if (!t.includes('update')) continue;
            if (!t.includes('data')) continue;

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
}

function buildPublicMetadata({ timestamp, scheduleData, success }) {
    // Keep published metadata strictly source-agnostic (no URLs, endpoints, variable names, or stack traces).
    return {
        timestamp,
        success: Boolean(success),
        schedule_extracted: Boolean(success),
        last_update: scheduleData && scheduleData.update ? scheduleData.update : null
    };
}

function persistSuccess(scheduleData) {
    const outputDir = getOutputDir();
    ensureDirExists(outputDir);

    const timestamp = nowTimestampLocal();
    const scheduleWithMeta = {
        ...scheduleData,
        scraped_at: timestamp
    };

    writeJsonFile(path.join(outputDir, CONFIG.outputScheduleFile), scheduleWithMeta);
    writeJsonFile(
        path.join(outputDir, CONFIG.outputMetadataFile),
        buildPublicMetadata({ timestamp, scheduleData, success: true })
    );

    logInfo('Saved schedule data to schedule.json');
    logInfo('Scraping completed successfully!');
}

function persistFailure() {
    const outputDir = getOutputDir();
    ensureDirExists(outputDir);

    const timestamp = nowTimestampLocal();
    const safeError = {
        timestamp,
        success: false,
        schedule_extracted: false,
        error: 'scrape_failed'
    };

    writeJsonFile(path.join(outputDir, CONFIG.outputMetadataFile), safeError);
}

async function scrapeSchedule() {
    logInfo('Starting scraper...');
    validateConfig();
    
    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await createPage(browser);
    
    try {
        const networkSchedule = await navigateAndCollectNetworkSchedule(page);
        const scheduleData = networkSchedule || await extractScheduleFromPage(page);

        if (!scheduleData) {
            logWarn('Could not extract schedule data');
            throw new Error('Failed to extract schedule data');
        }

        persistSuccess(scheduleData);
        
    } catch (error) {
        // Detailed error stays in Actions logs; published metadata must remain source-agnostic.
        logError('Error during scraping:', error);
        persistFailure();
        throw error;
    } finally {
        await browser.close();
    }
}

scrapeSchedule();
