/* ============================================================
   Addem Capital · Netlify Function — Google Sheet data loader
   Reads ONE Google Sheet (the financial Model + Portfolio Tape tabs),
   parses it, and returns the JSON the dashboard consumes.
   Configure env vars in the Netlify dashboard.
   ============================================================ */
import { google } from "googleapis";
import XLSX from "xlsx";

const SCOPES = ["https://www.googleapis.com/auth/drive.readonly"];
// Last historical (actuals) month, "YYYY-MM". Months up to and including this are
// treated as historical; later months are forecast. Update once when you close a month.
const LAST_HISTORICAL = process.env.LAST_HISTORICAL || "2026-05";

function authClient() {
  const email = process.env.GOOGLE_CLIENT_EMAIL;
  const key = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  if (!email || !key) throw new Error("Missing GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY");
  return new google.auth.JWT(email, null, key, SCOPES);
}
async function download(drive, fileId) {
  let meta = null;
  try { meta = await drive.files.get({ fileId, fields: "mimeType,name" }); } catch (e) {}
  const mime = meta && meta.data && meta.data.mimeType;
  if (mime === "application/vnd.google-apps.spreadsheet") {
    const res = await drive.files.export(
      { fileId, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
      { responseType: "arraybuffer" });
    return XLSX.read(Buffer.from(res.data), { type: "buffer", cellDates: true });
  }
  const res = await drive.files.get({ fileId, alt: "media" }, { responseType: "arraybuffer" });
  return XLSX.read(Buffer.from(res.data), { type: "buffer", cellDates: true });
}

/* ---------- helpers ---------- */
const num = (v) => (typeof v === "number" ? v : v ? Number(String(v).replace(/[^0-9.\-]/g, "")) || 0 : 0);
const norm = (s) => String(s || "").trim().toLowerCase();
const ym = (d) => {
  if (d instanceof Date) return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0");
  const dt = new Date(d); if (!isNaN(dt)) return dt.getUTCFullYear() + "-" + String(dt.getUTCMonth() + 1).padStart(2, "0");
  return String(d || "");
};

/* ---------- Financial Model ("Model" tab) ---------- */
const SERIES_LABELS = {
  cash:"Cash and Cash Equivalents", restricted:"Restricted Cash", tca:"Total Current Assets",
  loan:"Loan Portfolio (net of allowance for loan losses)", sfrVariant:"Structured Financing Receivables (Variant)",
  sfr:"Structured Financing Receivables", tnca:"Total Non-Current Assets", ta:"Total Assets",
  tcl:"Total Current Liabilities", borrowLocal:"Borrowings - Local Currency", borrowFx:"Borrowings - Foreign Currency",
  sfl:"Structured Financing Liabilities", secured:"Secured Payables and Structured Liabilities",
  tncl:"Total Non-Current Liabilities", tl:"Total Liabilities", eq:"Total Equity",
  intInc:"Interest Income", totInc:"Total Income", intExp:"Interest Expense / Financing Costs",
  tcf:"Total Cost of Financing", opex:"Total Operating Expenses", totExp:"Total Expenses",
  opInc:"Operating Income", nibt:"Net Income Before Taxes", tax:"Income Taxes", ni:"Net Income (Loss)",
  de:"Debt / Equity", da:"Debt / Total Assets", eqRatio:"Equity Ratio (Equity / Assets)",
  intCov:"Interest Coverage (EBIT / Int. Expense)", dscr:"Debt Service Coverage (Op. CF / Int.)",
  current:"Current Ratio", quick:"Quick Ratio (ex-prepaids)", nim:"Net Interest Margin (NIM)",
  netMargin:"Net Profit Margin", opMargin:"Operating Margin", roa:"Return on Assets (ROA)",
  roe:"Return on Equity (ROE)", rolp:"Return on Loan Portfolio",
  opexRatio:"Operating Expense Ratio (OpEx / Income)", cti:"Cost-to-Income Ratio",
  cof:"Cost of Funds (Int. Exp / Avg. Debt)", nimA:"NIM (Annualized)", roaA:"ROA (Annualized)",
  roeA:"ROE (Annualized)", rolpA:"Return on Loan Portfolio (Annualized)", cofA:"Cost of Funds (Annualized)",
};
const HEADERS = new Set(["balance sheet","current assets","non-current assets","equity","p&l","income",
  "cost of financing","operating expenses"]);

function parseFinancials(wb) {
  const ws = wb.Sheets["Model"] || wb.Sheets[wb.SheetNames[0]];
  const A = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  let dateRow = -1, best = 0;
  for (let r = 0; r < Math.min(A.length, 30); r++) {
    const n = (A[r] || []).filter((v) => v instanceof Date).length;
    if (n > best) { best = n; dateRow = r; }
  }
  const dr = A[dateRow] || [];
  let cols = []; for (let c = 0; c < dr.length; c++) if (dr[c] instanceof Date) cols.push(c);
  cols = cols.filter((c) => ym(dr[c]) >= "2025-01"); // drop any prior-year opening column
  // Detect the label column dynamically (the sheet's !ref origin can shift columns,
  // e.g. Google trims empty leading columns so the range may start at D). The label
  // column is the non-date column with the most DISTINCT text values (account names).
  const firstDateCol = cols.length ? Math.min.apply(null, cols) : 4;
  let labelCol = 0, bestLab = -1;
  for (let c = 0; c < firstDateCol; c++) {
    const set = new Set();
    for (let r = dateRow + 1; r < Math.min(A.length, dateRow + 260); r++) { const v = (A[r] || [])[c]; if (typeof v === "string" && v.trim()) set.add(v.trim()); }
    if (set.size > bestLab) { bestLab = set.size; labelCol = c; }
  }
  const months = cols.map((c) => { const m = ym(dr[c]); return { d: m, h: m <= LAST_HISTORICAL ? 1 : 0 }; });
  const nhist = months.filter((m) => m.h === 1).length;
  const rowOf = {};
  for (let r = dateRow + 1; r < A.length; r++) { const l = (A[r] || [])[labelCol]; if (typeof l === "string" && l.trim() && rowOf[norm(l)] == null) rowOf[norm(l)] = r; }
  // Carry forward the last valid value when a cell is an error (#VALUE!, #REF!, ...) or blank,
  // so a broken forecast formula in the Sheet does not drop the chart line to zero.
  const get = (label) => {
    const r = rowOf[norm(label)];
    if (r == null) return cols.map(() => 0);
    const out = []; let last = 0;
    cols.forEach((c) => { const raw = A[r][c]; let v; if (raw == null || raw === "") { v = last; } else { v = num(raw); } out.push(v); last = v; });
    return out;
  };

  const s = {};
  Object.keys(SERIES_LABELS).forEach((k) => { s[k] = get(SERIES_LABELS[k]); });

  const rangeLines = (fromLabel, toLabel) => {
    const rf = rowOf[norm(fromLabel)], rt = rowOf[norm(toLabel)]; const lines = [];
    if (rf == null || rt == null) return lines;
    for (let r = rf; r <= rt; r++) {
      const lab = (A[r] || [])[labelCol]; if (!(typeof lab === "string" && lab.trim())) continue;
      const t = lab.trim(); if (norm(t) === "checker") continue;
      const lvl = norm(t).startsWith("total") ? 2 : (HEADERS.has(norm(t)) ? 0 : 1);
      const v = cols.slice(0, nhist).map((c) => num(A[r][c]));
      lines.push({ n: t, lvl, v });
    }
    return lines;
  };
  const balance = rangeLines("Current Assets", "Total Equity");
  const income = rangeLines("Income", "Net Income (Loss)");
  return { months, s, nhist, stmt: { income, balance } };
}

/* ---------- Portfolio Tape ("Portfolio Tape" tab) ---------- */
function parsePortfolio(wb) {
  const ws = wb.Sheets["Portfolio Tape"]; if (!ws) return [];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: null });
  if (!rows.length) return [];
  const balCols = Object.keys(rows[0]).filter((k) => /^balance/i.test(k));
  const balKey = balCols.length ? balCols[balCols.length - 1] : "Current Balance (M)";
  return rows.filter((r) => r["Borrower"] && String(r["Borrower"]).trim()).map((r) => {
    const cur = r["Currency"] || "MXN";
    const rate = num(r["Interest Rate"]);
    let yld = r["Yield"]; yld = (typeof yld === "number") ? yld : rate + (String(cur).toUpperCase() === "USD" ? 0.06 : 0);
    let bal = num(r[balKey]) / 1e6; // tape balances are in MXN
    return {
      b: String(r["Borrower"]).trim(), ind: r["Industry"] || "—", cur,
      type: r["Facility Type"] || "Asset Backed", bal, yld: Number(yld) || 0,
      st: r["Status"] || "Active", asg: r["Assignment"] || "Unassigned",
    };
  }).filter((p) => p.bal > 0);
}

/* ---------- Origination ("Sheet3" / Portfolio Draws) ---------- */
function normName(s){
  let x = String(s || "").trim().toLowerCase();
  x = x.replace(/\s*-\s*(ext|t\d+|puente|co|b2b|zaragoza|juarez|camarones|unifin).*$/i, "");
  x = x.replace(/\s+\d+$/, "");
  return x.replace(/[^a-z0-9]/g, "");
}
function parseOrigination(wb) {
  const ws = wb.Sheets["Sheet3"] || wb.Sheets["Portfolio Draws"];
  if (!ws) return { months: [], borrowers: [], rows: [] };
  const A = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  let dateRow = -1, best = 0;
  for (let r = 0; r < Math.min(A.length, 15); r++) { const n = (A[r] || []).filter((v) => v instanceof Date).length; if (n > best) { best = n; dateRow = r; } }
  if (dateRow < 0) return { months: [], borrowers: [], rows: [] };
  const dr = A[dateRow] || [];
  const cols = []; for (let c = 0; c < dr.length; c++) if (dr[c] instanceof Date) cols.push(c);
  const firstMonthCol = Math.min.apply(null, cols);
  let labelCol = 0, lblBest = 0;
  for (let c = 0; c < firstMonthCol; c++) { let h = 0; for (let r = dateRow + 1; r < A.length; r++) if (typeof (A[r] || [])[c] === "string" && A[r][c].trim()) h++; if (h > lblBest) { lblBest = h; labelCol = c; } }
  const unitCol = labelCol + 1;
  const monthsAll = cols.map((c) => ym(dr[c]));
  const perB = {};
  for (let r = dateRow + 1; r < A.length; r++) {
    const lab = (A[r] || [])[labelCol];
    if (!(typeof lab === "string" && lab.trim())) continue;
    const t = lab.trim(); if (norm(t) === "total" || norm(t) === "draws") continue;
    const unit = String((A[r] || [])[unitCol] || "").toLowerCase();
    if (!unit.includes("mxn") && !unit.includes("usd")) continue;
    cols.forEach((c, k) => { const v = (A[r] || [])[c]; if (typeof v === "number" && v) { (perB[t] = perB[t] || {})[k] = (perB[t][k] || 0) + v / 1e6; } });
  }
  const monthlyTot = cols.map((_, k) => Object.values(perB).reduce((s, o) => s + (o[k] || 0), 0));
  const nz = monthlyTot.map((t, k) => (t > 0.0001 ? k : -1)).filter((k) => k >= 0);
  if (!nz.length) return { months: [], borrowers: [], rows: [] };
  const lo = nz[0], hi = nz[nz.length - 1];
  const months = []; for (let k = lo; k <= hi; k++) months.push(monthsAll[k]);
  const rows = [];
  for (let k = lo; k <= hi; k++) { const bb = {}; Object.keys(perB).forEach((b) => { const a = perB[b][k] || 0; if (a > 0.0001) bb[b] = +a.toFixed(4); }); rows.push({ m: monthsAll[k], total: +Object.values(bb).reduce((s, x) => s + x, 0).toFixed(4), b: bb }); }
  const borrowers = Object.keys(perB).map((b) => ({ b, total: +Object.keys(perB[b]).reduce((s, k) => s + perB[b][k], 0).toFixed(4) })).filter((x) => x.total > 0.0001).sort((a, b) => b.total - a.total);
  return { months, borrowers, rows };
}

/* ---------- cache + handler ---------- */
let CACHE = null, CACHE_AT = 0; const TTL = 60 * 1000;
const versionOf = (o) => { try { return JSON.stringify(o).length + ":" + (o.model ? o.model.months.length : 0); } catch (e) { return String(Date.now()); } };

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "public, max-age=60");
  try {
    if (CACHE && Date.now() - CACHE_AT < TTL) return res.status(200).send(JSON.stringify(CACHE));
    const drive = google.drive({ version: "v3", auth: authClient() });
    const out = {};
    const sheetId = process.env.DRIVE_SHEET_ID;
    if (!sheetId) throw new Error("Missing DRIVE_SHEET_ID");
    const wb = await download(drive, sheetId);
    try { out.model = parseFinancials(wb); } catch (e) { out.modelError = String(e.message || e); }
    try { out.portfolio = parsePortfolio(wb); } catch (e) { out.portfolioError = String(e.message || e); }
    try { out.origination = parseOrigination(wb); } catch (e) { out.originationError = String(e.message || e); }
    out.version = versionOf(out); out.fetchedAt = new Date().toISOString();
    CACHE = out; CACHE_AT = Date.now();
    return res.status(200).send(JSON.stringify(out));
  } catch (e) {
    return res.status(500).send(JSON.stringify({ error: String(e.message || e) }));
  }
}
