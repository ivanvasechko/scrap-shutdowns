# Power Outage Schedule Scraper

**Personal project** for monitoring electricity shutdown schedules in Fastiv, Ukraine.

## ⚠️ Disclaimer

This project is for **personal use only**. All data is sourced from publicly available information.

- **Educational/personal use** only
- Respects reasonable request intervals (every 5 minutes)
- Does not store copyrighted HTML content

## 📊 What it does

Automatically scrapes power outage schedule data every 30 minutes using GitHub Actions and publishes the extracted JSON as a static site.

## 🔧 How it works

1. **GitHub Action** runs every 30 minutes (or "manually" via external cronjob)
2. **Playwright** loads the page like a real browser
3. Extracts schedule data from dynamic responses when available, with a safe fallback strategy
4. Saves only JSON outputs (no HTML stored)
5. Deploys to **Cloudflare Pages** for easy API access
6. **Optional**: Notifies a webhook endpoint when scraping succeeds

## 🧩 CI helper scripts

To keep GitHub Actions readable/maintainable, small Node utilities live in `scripts/` and are used by the workflow:

- `scripts/extract-update-from-stdin.js`: reads JSON from stdin and prints the `update` stamp (or another field)
- `scripts/extract-update-from-file.js`: reads a JSON file and prints the `update` stamp (or another field)
- `scripts/print-scrape-summary.js`: prints a short, non-sensitive scrape summary
- `scripts/verify-pages-updated.sh`: waits until the hosting provider serves the new `schedule.json`
- `scripts/resolve-playwright-version.sh`: resolves the Playwright version for caching/installs
- `scripts/read-deployed-update-stamp.sh`: reads the deployed `schedule.json` update stamp

## 📡 Access the data

Latest schedule data available at (Cloudflare Pages):
- **JSON API**: `https://<project>.pages.dev/schedule.json`
- **Metadata**: `https://<project>.pages.dev/latest-metadata.json`

Metadata is intentionally **redacted** and does not include any information about where the data was parsed from.

## 🏗️ Technical Stack

- **Node.js** + **Playwright** (headless browser)
- **GitHub Actions** (free tier - unlimited for public repos)
- **Cloudflare Pages** (free hosting)

## ⚙️ Configuration

Set these secrets in your GitHub repository (Settings → Secrets and variables → Actions):

### Required Secrets
- `TARGET_URL`: The URL to scrape
- `DATA_VARIABLE_NAME`: JavaScript variable name containing the data

### Required Secrets (Cloudflare Pages deployment)

- `CLOUDFLARE_API_TOKEN`: Cloudflare API token with Pages deploy permissions
- `CLOUDFLARE_ACCOUNT_ID`: Cloudflare account id
- `CLOUDFLARE_PAGES_PROJECT`: Cloudflare Pages project name
- (optional) `CLOUDFLARE_PAGES_URL`: base URL to verify against (e.g. `https://your-domain.example/`)
  - If omitted, the workflow assumes `https://<project>.pages.dev/`.

## ☁️ Cloudflare Pages setup (free)

1. Cloudflare Dashboard → **Workers & Pages** → **Create application**.
2. Choose **Pages**.
3. Create a project (any simple placeholder settings are fine; the GitHub workflow deploys via API).
4. Copy the **Account ID** from the dashboard.
5. Cloudflare Dashboard → **My Profile** → **API Tokens** → create a token that can deploy to Pages.
6. Add the GitHub secrets listed above.
7. Run **Actions → Scrape Shutdowns Information → Run workflow**.

The workflow deploys the contents of `scraped-data/` and publishes `_headers` so `schedule.json` and `latest-metadata.json` are served with `Cache-Control: no-store`.

### Optional Secrets (for webhook notifications)
- `WEBHOOK_URL`: URL to ping when scraping succeeds
- `WEBHOOK_AUTH_TOKEN`: Authorization token for the webhook endpoint (include the scheme prefix if needed, e.g., "Bearer YOUR_TOKEN")

## 📋 Data Format

```json
{
  "data": {
    "1763676000": {
      "GPV1.1": {
        "1": "yes",
        "2": "yes",
        ...
      }
    }
  },
  "update": "21.11.2025 15:45",
  "today": 1763676000,
  "scraped_at": "2025-11-21T14:42:55.354Z"
}
```

## 📜 License

Personal use only. Data copyright belongs to respective owners.

## 🤝 Contributing

This is a personal project. If you want to use it, please fork and respect the source website's terms of service.
