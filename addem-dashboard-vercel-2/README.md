# Addem Capital — Investor Reporting Dashboard

Production build. Reads your Google Sheet (Model + Portfolio Tape) and deploys on Netlify.

**Quick start**
1. `npm install`
2. `npm run dev` (local; runs with bundled sample data unless the Netlify function is available)
3. Deploy to Netlify and set the env vars listed in `.env.example`.

See **SETUP.md** for the full non-technical, step-by-step guide (Google Drive + service account + Netlify).

- App: `src/App.jsx` (English, official Addem branding, mobile-first)
- Data loader: `netlify/functions/data.js` (Google Drive → JSON)
- The dashboard auto-refreshes within ~5 minutes of a change to the Drive files.
