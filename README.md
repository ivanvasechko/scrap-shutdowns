# Power Outage Schedule Scraper

**Personal project** for monitoring electricity shutdown schedules in Fastiv, Ukraine.

## ⚠️ Disclaimer

This project is for **personal use only**. All data is sourced from publicly available information.

- **Educational/personal use** only
- Respects reasonable request intervals (every 5 minutes)
- Does not store copyrighted HTML content

## 📊 What it does

Automatically scrapes power outage schedule data every 5 minutes using GitHub Actions and publishes the extracted JSON to GitHub Pages.

## 🔧 How it works

1. **GitHub Action** runs every 5 minutes
2. **Playwright** scrapes the target website (bypassing bot protection)
3. Extracts only the schedule data JavaScript variable
4. Saves as clean JSON file (no HTML stored to respect copyright)
5. Deploys to **GitHub Pages** for easy API access
6. **Optional**: Notifies a webhook endpoint when scraping succeeds

## 📡 Access the data

Latest schedule data available at:
- **JSON API**: `https://ivanvasechko.github.io/scrap-shutdowns/schedule.json`
- **Metadata**: `https://ivanvasechko.github.io/scrap-shutdowns/latest-metadata.json`

## 🏗️ Technical Stack

- **Node.js** + **Playwright** (headless browser)
- **GitHub Actions** (free tier - unlimited for public repos)
- **GitHub Pages** (free hosting)

## ⚙️ Configuration

Set these secrets in your GitHub repository (Settings → Secrets and variables → Actions):

### Required Secrets
- `TARGET_URL`: The URL to scrape
- `DATA_VARIABLE_NAME`: JavaScript variable name containing the data

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
