const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// Configuration from environment variables
const TARGET_URL = process.env.TARGET_URL;
const DATA_VARIABLE_NAME = process.env.DATA_VARIABLE_NAME;

async function scrapeSchedule() {
    console.log('Starting scraper...');
    
    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    
    // Set realistic browser settings
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.setExtraHTTPHeaders({
        'Accept-Language': 'uk-UA,uk;q=0.9,en-US;q=0.8,en;q=0.7'
    });
    
    try {
        console.log('Navigating to target website...');
        await page.goto(TARGET_URL, {
            waitUntil: 'networkidle',
            timeout: 60000
        });
        
        console.log('Waiting for page to fully load...');
        await page.waitForTimeout(8000);
        
        // Extract schedule data from the page
        console.log('Extracting schedule data...');
        const scheduleData = await page.evaluate((varName) => {
            // Look for the data variable in the page
            const scriptContent = document.body.innerHTML;
            const escapedVarName = varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const pattern = new RegExp(escapedVarName + '\\s*=\\s*(\\{[^<]+\\})', 's');
            const match = scriptContent.match(pattern);
            
            if (match && match[1]) {
                try {
                    // Parse the JSON data
                    return JSON.parse(match[1]);
                } catch (e) {
                    console.error('Failed to parse schedule data:', e);
                    return null;
                }
            }
            return null;
        }, DATA_VARIABLE_NAME);
        
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
                last_update: scheduleData.update
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
