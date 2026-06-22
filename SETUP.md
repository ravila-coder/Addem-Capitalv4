# Addem Capital Dashboard — Vercel Deployment

This package is configured for **Vercel**. The dashboard is a Vite app; the live
data loader is a serverless function at `/api/data` that reads your Google Sheet.

## Deploy (one time)
1. Push this folder to a GitHub repo (or run `vercel` with the Vercel CLI).
2. In Vercel: New Project -> import the repo. Framework preset: **Vite** (auto-detected).
3. Add Environment Variables (Project -> Settings -> Environment Variables):
   - `GOOGLE_CLIENT_EMAIL`  — service-account email
   - `GOOGLE_PRIVATE_KEY`   — service-account private key (paste with the literal \n newlines, as in the JSON key)
   - `DRIVE_SHEET_ID`       — your Google Sheet ID (1NxWI2dXgYNz8Jsb5Gc8aIXXrUNePjxN6)
   - `LAST_HISTORICAL`      — last actuals month, e.g. 2026-04
4. Share the Google Sheet with the service-account email (Viewer).
5. Deploy. The app builds to `dist`; `/api/data` serves live data and is cached ~60s.

## How updates work
- The dashboard polls `/api/data` every ~60s and on tab focus.
- Edit the Google Sheet (Model / Portfolio Tape / Sheet3) -> the dashboard refreshes
  automatically within ~1 minute. No code changes or redeploys needed.
- The Technical Sheet contractual data is embedded (from the DOCX); only outstanding/
  yield are linked live from the portfolio tab.

------------------------------------------------------------------------

# Addem Capital Dashboard — Setup & Reporting Architecture

This is the production dashboard. It reads **your Google Sheet** (the one with the `Model` and
`Portfolio Tape` tabs) as the single source of truth and deploys on **Netlify**. After setup you
only edit the Google Sheet — the dashboard updates itself. You never touch code.

---

## Reporting architecture (the 5 questions)

**1. How the Google Sheet is connected.**
A small server function on Netlify (`netlify/functions/data.js`) reads your Sheet through the
official Google Drive API using a read-only **service account** (a robot Google account you share
the Sheet with). It parses the `Model` tab (balance sheet, P&L, ratios) and the `Portfolio Tape`
tab and returns clean data. The dashboard calls that function at `/.netlify/functions/data`.
Nothing is hardcoded — every KPI, chart, statement and portfolio view is built from the Sheet.

**2. How frequently it refreshes.**
The function re-reads the Sheet at most once per minute (60-second cache). The dashboard, while
open, checks for changes every 60 seconds and whenever you return to the tab. So an edit appears
within about a minute.

**3. Automatic or manual?**
**Automatic.** When the data changes, open dashboards detect a new “version” and refresh
themselves. No button, no redeploy.

**4. Limitations of Google Sheets.**
- **Tab names and the account labels in column D of `Model` must stay as they are**, and the
  `Portfolio Tape` headers must keep their names; don’t merge cells. The parser maps values by
  those labels/headers.
- **Historical vs forecast** is set by the `LAST_HISTORICAL` value (a month like `2026-04`).
  The green-font convention in the Sheet is for humans — the connector can’t read font colour, so
  the boundary is controlled by that one setting. Bump it when you close a new month.
- Google applies API rate limits; the 60-second cache stays well under them.
- There is no Origination tab in your model, so the **Loan Origination Forecast** section keeps an
  illustrative forecast until you add that data.
- On a data change the page reloads, so an open view returns to the top — fine for monthly reporting.

**5. How future users update data (no code).**
Open the Sheet, edit the numbers, save. Within ~1 minute the dashboard reflects it everywhere.

---

## One-time setup

Your Sheet is already at:
`https://docs.google.com/spreadsheets/d/1NxWI2dXgYNz8Jsb5Gc8aIXXrUNePjxN6/edit`

### Part 1 — Service account (read-only key)
1. https://console.cloud.google.com → create a project (e.g. “Addem Dashboard”).
2. Search **“Google Drive API”** → **Enable**.
3. **APIs & Services → Credentials → Create credentials → Service account** → name `addem-dashboard`
   → Create → Done.
4. Open it → **Keys → Add key → Create new key → JSON**. From the file you need `client_email`
   and `private_key`.
5. Open your Google Sheet → **Share** → paste the service account `client_email` → **Viewer** → Send.

*(Your Sheet is public, so this still works; the service account simply gives the server a stable,
read-only way in.)*

### Part 2 — Deploy to Netlify
- **From Git (recommended):** push this folder to GitHub → Netlify → **Add new site → Import from
  Git**. Netlify reads `netlify.toml` automatically.
- **Drag & drop:** `npm install` then `npm run build`, then drag the **whole project folder** into
  Netlify → **Add new site → Deploy manually** (include `netlify/functions`).

### Part 3 — Environment variables (Netlify → Site configuration → Environment variables)
| Key | Value |
|-----|-------|
| `GOOGLE_CLIENT_EMAIL` | service account `client_email` |
| `GOOGLE_PRIVATE_KEY` | the whole `private_key` block in quotes, keeping the `\n` characters |
| `DRIVE_SHEET_ID` | `1NxWI2dXgYNz8Jsb5Gc8aIXXrUNePjxN6` |
| `LAST_HISTORICAL` | `2026-04` (update when you close a month) |

Then **Deploys → Trigger deploy → Deploy site**. Open the URL — it runs live from your Sheet.

---

## Updating the data — what goes where
- **`Model` tab** — the monthly model (balance sheet, P&L, ratios). Edit the actuals; the dashboard
  recomputes everything (Executive Summary, Historical Financials, Projections). To advance the
  actuals/forecast split, change `LAST_HISTORICAL` once.
- **`Portfolio Tape` tab** — one row per borrower (the latest `Balance …` column is used as the
  current balance; yield, status, assignment drive the Portfolio sections and Questions search).

---

## Troubleshooting
- **Shows sample data.** Check the env vars, that the Sheet is shared with the service account, and
  that tab names/labels are unchanged. Logs: Netlify → **Logs → Functions → data**.
- **Wrong historical/forecast split.** Set `LAST_HISTORICAL` to your last actual month.
- **Private key error.** Re-paste `GOOGLE_PRIVATE_KEY` exactly, keeping the `\n`.

---

## What's inside
```
addem-netlify/
|- index.html                 . app shell + loading splash
|- src/main.jsx               . fetches data, renders, auto-refreshes on change
|- src/App.jsx                . the dashboard (live data; bundled real-data fallback)
|- netlify/functions/data.js  . reads your Sheet (Model + Portfolio Tape) -> dashboard JSON
|- netlify.toml . package.json . .env.example
```
The function returns `{ model, portfolio, version }`. The dashboard reads `window.__ADDEM_DATA__`;
ratios and statements come straight from the `Model` tab, so the dashboard always mirrors the Sheet.
