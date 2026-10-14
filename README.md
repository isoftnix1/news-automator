# Keyword News Intelligence Bot

A high-performance Node.js service that searches industry news for configurable keywords, uses Gemini AI to evaluate, score (0–100), and summarize each candidate, deduplicates stories, and appends high-relevance intelligence to Google Sheets with automatic styling.

---

## Key Features

- **Multi-Source Discovery Engine**:
  - **Google News RSS Search**: Fast, real-time indexed news for configured keyword combinations across both **India** and **Worldwide** regions with zero rate-limit blocks.
  - **GDELT Global Index**: Deep global public index search with polite rate limiting and automated circuit breaker.
  - **Curated Industry RSS Feeds**: Scans top publications for Energy Storage, EV Batteries, Heavy Fabrication, Robotics, and Automation.
- **Gemini AI Intelligence & Scoring**:
  - Scores business value from 0–100 using `gemini-3.8-flash` (with automated fallback to `gemini-flash-latest`, `gemini-3.5-flash`, and `gemini-3.1-flash-lite`).
  - Extracts key developments, deal/investment values, affected companies, location, development type, and rationale.
  - Rejects fluff, opinion, thin mentions, and unrelated stories.
- **Executive Google Sheet Formatting**:
  - Freezes header row with navy executive theme.
  - Sets optimal column widths automatically for clean, readable layouts.
  - Organizes records date-wise (`both` master sheet + daily tabs, `sheet` only, or `tabs` only).
- **Offline Persistence & Zero-Data-Loss Queue**:
  - If Google Sheets is temporarily unreachable or permissions are pending, evaluated high-score articles are safely queued in `data/offline_queue.json`.
  - Automatically flushes and syncs to Google Sheets once connection/permission is restored.
- **Built-in Diagnostic CLI Tools**:
  - `npm run test:sheets`: Validates Google Sheets connection, verifies Editor permission, and displays direct sharing links.
  - `npm run test:gemini`: Validates Gemini API key and tests AI scoring latency with a sample article.
  - `npm run test:discovery`: Tests Google News, GDELT, and RSS feeds in isolation.
  - `npm run sync`: Flushes any queued offline articles directly to Google Sheets.

---

## Prerequisites

1. **Node.js 20+** installed
2. A **Google Cloud Service Account** with Google Sheets API enabled (`credentials.json`)
3. A **Google Sheet** shared with the service account email as **Editor**
4. A **Gemini API Key** from [Google AI Studio](https://aistudio.google.com/)

---

## Quick Setup

### 1. Share your Google Sheet
1. Open your target Google Sheet (or create one).
2. Copy the **Spreadsheet ID** from the URL:
   `https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>/edit`
3. Click the green **Share** button in the top right corner.
4. Add your service account email (found in `credentials.json` under `client_email`) with **Editor** permission:
   ```text
   news-bot-sa@news-intelligence-bot.iam.gserviceaccount.com
   ```
5. Click **Save** / **Share**.

### 2. Configure Environment (`.env`)
Copy `.env.example` to `.env`:
```powershell
Copy-Item .env.example .env
```
Ensure the following variables are set:
```ini
GOOGLE_SHEET_ID=your_spreadsheet_id_here
GOOGLE_SERVICE_ACCOUNT_FILE=./credentials.json
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-3.8-flash
```

### 3. Run Diagnostics
Verify each integration independently before running the bot:
```bash
npm run test:gemini     # Verify Gemini AI connection and scoring
npm run test:discovery  # Verify multi-source discovery (Google News + RSS + GDELT)
npm run test:sheets     # Verify Google Sheets authentication and Editor access
```

### 4. Launch the Interactive Web Dashboard
Start the real-time visual dashboard:
```bash
npm run ui
```
Open **`http://localhost:3000`** in any browser. From the dashboard you can:
- Add, edit, or delete keywords and industry categories dynamically.
- Click **"Scan News Now"** to run on-demand discovery across Google News RSS, GDELT, and curated feeds.
- Inspect Gemini AI relevance scores, executive summaries, deal values, and evaluation rationales.
- Save stories directly to Google Sheets with 1 click.
- Reset back to default keywords anytime.

### 5. Automated Background Service
Run continuously as a scheduled background worker (default: every 3 hours):
```bash
npm start
```
Or run a single CLI cycle:
```bash
npm run run-once
```

---

## Configuration Details

All settings in `.env` are fully configurable:

| Variable | Default | Description |
| :--- | :--- | :--- |
| `GOOGLE_SHEET_ID` | *Required* | Spreadsheet ID from the Google Sheet URL |
| `GOOGLE_SERVICE_ACCOUNT_FILE` | `./credentials.json` | Path to Google Service Account JSON |
| `GOOGLE_SHEET_TAB` | `News` | Default master sheet tab name |
| `SHEET_DATE_MODE` | `both` | Date grouping: `both` (master + daily tabs), `sheet` (single tab), `tabs` (daily tabs) |
| `GEMINI_API_KEY` | *Required* | Google AI Studio API key |
| `GEMINI_MODEL` | `gemini-3.8-flash` | Gemini model (`gemini-3.8-flash`, `gemini-flash-latest`, etc.) |
| `MIN_RELEVANCE_SCORE` | `75` | Minimum score (0–100) required to save an article |
| `SEARCH_EVERY_HOURS` | `3` | Cron cadence in hours (1–23) |
| `LOOKBACK_HOURS` | `72` | Time window for news articles (hours) |
| `MAX_EVALUATIONS_PER_RUN`| `25` | Max candidates sent to AI per cycle (protects API quotas) |
| `GOOGLE_NEWS_ENABLED` | `true` | Toggle Google News RSS boolean search |
| `GDELT_ENABLED` | `true` | Toggle GDELT doc search |

### Keywords and Feeds
- **Keywords**: Configure industry categories and search terms in `config/keywords.json`.
- **Curated Feeds**: Add or remove publication RSS feeds in `config/feeds.json`.

---

## Google Sheet Output Columns

Every accepted row includes 16 standardized columns:
1. **Date**: YYYY-MM-DD
2. **Headline**: Clean article title
3. **Category**: Identified industry sector
4. **Company / Organizations**: Key corporate actors
5. **AI Summary**: 2 concise factual sentences
6. **Key Development**: 1 sentence high-impact summary
7. **Deal / Investment Value**: Disclosed financial value (e.g. ₹4,000 crore, $500M)
8. **Location**: Geography / State / Country
9. **Published Time (UTC)**: Publication timestamp
10. **Publisher**: Source publication
11. **Article URL**: Direct link to article
12. **Relevance Score**: 0–100
13. **Development Type**: investment, contract, plant expansion, deployment, etc.
14. **Matched Keywords**: Triggered keyword list
15. **AI Rationale**: Why the model accepted this story
16. **Discovery Date (UTC)**: Timestamp when bot processed the article

---

## Deployment (Render, Railway, or VPS)

1. Push the code to a private GitHub repository (ensure `.env` and `credentials.json` are excluded via `.gitignore`).
2. Create a **Background Worker** on Render or a Docker/Node container on any VPS.
3. Set the build command: `npm install`
4. Set the start command: `npm start`
5. Add the environment variables from your `.env` into the host dashboard.
6. Mount `credentials.json` securely as a secret file or environment variable.
