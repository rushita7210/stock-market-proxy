/**
 * STOCK MASTER — Enhanced Proxy Server v2
 * • Real NSE prices via Yahoo Finance
 * • Price alert checking
 * • CORS-enabled for mobile PWA
 *
 * Deploy free on Render.com — see deploy-guide.md
 */

const express = require("express");
const cors    = require("cors");
const axios   = require("axios");

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: "*" }));
app.use(express.json());

// ── Symbol map ───────────────────────────────────────────────────────────────
const SYMBOL_MAP = {
  ICICIBANK:       "ICICIBANK.NS",
  RELIANCE:        "RELIANCE.NS",
  SBIN:            "SBIN.NS",
  HINDALCO:        "HINDALCO.NS",
  ADANIPOWER:      "ADANIPOWER.NS",
  COALINDIA:       "COALINDIA.NS",
  HDFCAMC:         "HDFCAMC.NS",
  ICICIAMC:        "ICICIAMC.NS",
  IRCTC:           "IRCTC.NS",
  CANFINHOME:      "CANFINHOME.NS",
  TATAPOWER:       "TATAPOWER.NS",
  JUBLFOOD:        "JUBLFOOD.NS",
  TMPV:            "TATAMOTORS.NS",
  GAIL:            "GAIL.NS",
  IREDA:           "IREDA.NS",
  CYIENT:          "CYIENT.NS",
  WIPRO:           "WIPRO.NS",
  ITC:             "ITC.NS",
  POWERGRID:       "POWERGRID.NS",
  "DIXON TECH":    "DIXON.NS",
  "BAJAJ FINANCE": "BAJFINANCE.NS",
  ZOMATO:          "ZOMATO.NS",
  "SUN PHARMA":    "SUNPHARMA.NS",
  BEL:             "BEL.NS",
  "L&T":           "LT.NS",
  "BSE LTD":       "BSE.NS",
  TRENT:           "TRENT.NS",
};

// ── Price alert thresholds (buy alerts for watchlist) ────────────────────────
const ALERT_ZONES = {
  ITC:             { type:"buy",  threshold:309,  condition:"below" },
  POWERGRID:       { type:"buy",  threshold:280,  condition:"below" },
  "DIXON TECH":    { type:"buy",  threshold:9800, condition:"below" },
  "BAJAJ FINANCE": { type:"buy",  threshold:900,  condition:"below" },
  ZOMATO:          { type:"buy",  threshold:215,  condition:"below" },
  "SUN PHARMA":    { type:"buy",  threshold:1700, condition:"below" },
  BEL:             { type:"buy",  threshold:400,  condition:"below" },
  "L&T":           { type:"buy",  threshold:3700, condition:"below" },
  "BSE LTD":       { type:"buy",  threshold:2400, condition:"below" },
  TRENT:           { type:"buy",  threshold:3500, condition:"below" },
  // Profit booking alerts
  HINDALCO:        { type:"book", threshold:960,  condition:"above" },
  ADANIPOWER:      { type:"book", threshold:138,  condition:"above" },
  RELIANCE:        { type:"book", threshold:1550, condition:"above" },
  SBIN:            { type:"book", threshold:1250, condition:"above" },
  COALINDIA:       { type:"book", threshold:480,  condition:"above" },
  // Stop loss alerts
  WIPRO:           { type:"sl",   threshold:180,  condition:"below" },
  CYIENT:          { type:"sl",   threshold:800,  condition:"below" },
  JUBLFOOD:        { type:"sl",   threshold:420,  condition:"below" },
};

// ── Simple in-memory cache (avoid hammering Yahoo) ────────────────────────────
let priceCache = { data: {}, ts: 0 };
const CACHE_TTL = 60 * 1000; // 60 seconds

async function fetchOne(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`;
  const res  = await axios.get(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
    timeout: 8000,
  });
  const meta = res.data?.chart?.result?.[0]?.meta;
  if (!meta) throw new Error(`No data for ${symbol}`);
  const price = meta.regularMarketPrice || meta.previousClose;
  const prev  = meta.previousClose;
  return {
    price:         Math.round(price * 100) / 100,
    previousClose: Math.round(prev  * 100) / 100,
    change:        Math.round((price - prev)        * 100) / 100,
    changePct:     Math.round(((price - prev) / prev * 100) * 100) / 100,
    dayHigh:       Math.round((meta.regularMarketDayHigh  || price) * 100) / 100,
    dayLow:        Math.round((meta.regularMarketDayLow   || price) * 100) / 100,
    volume:        meta.regularMarketVolume || 0,
    marketState:   meta.marketState || "CLOSED",
  };
}

async function fetchAll(names) {
  const now = Date.now();

  // Return cached data if fresh
  if (now - priceCache.ts < CACHE_TTL && Object.keys(priceCache.data).length > 0) {
    console.log("📦 Serving from cache");
    return { prices: priceCache.data, fromCache: true };
  }

  const prices  = {};
  const errors  = {};

  await Promise.allSettled(
    names.map(async name => {
      const sym = SYMBOL_MAP[name];
      if (!sym) { errors[name] = "Not in symbol map"; return; }
      try {
        prices[name] = await fetchOne(sym);
      } catch (e) {
        errors[name] = e.message;
        console.warn(`⚠️  ${name}: ${e.message}`);
      }
    })
  );

  priceCache = { data: prices, ts: now };
  return { prices, errors, fromCache: false };
}

// ── Check which alerts are triggered ─────────────────────────────────────────
function checkAlerts(prices) {
  const triggered = [];
  for (const [name, alert] of Object.entries(ALERT_ZONES)) {
    const p = prices[name];
    if (!p) continue;
    const hit = alert.condition === "below"
      ? p.price <= alert.threshold
      : p.price >= alert.threshold;
    if (hit) {
      triggered.push({
        name,
        price:     p.price,
        threshold: alert.threshold,
        type:      alert.type,
        condition: alert.condition,
        message:   alert.type === "buy"
          ? `🟢 ${name} @ ₹${p.price} — BUY ZONE reached (≤₹${alert.threshold})`
          : alert.type === "book"
          ? `🔥 ${name} @ ₹${p.price} — BOOK PROFIT now (≥₹${alert.threshold})`
          : `🔴 ${name} @ ₹${p.price} — STOP LOSS hit (≤₹${alert.threshold})`,
      });
    }
  }
  return triggered;
}

// ── Routes ────────────────────────────────────────────────────────────────────

// All prices + alert check
app.get("/prices", async (req, res) => {
  const names = req.query.symbols
    ? req.query.symbols.split(",").map(s => s.trim().toUpperCase())
    : Object.keys(SYMBOL_MAP);

  try {
    const { prices, errors, fromCache } = await fetchAll(names);
    const alerts = checkAlerts(prices);
    res.json({
      success:     true,
      timestamp:   new Date().toISOString(),
      fromCache,
      fetched:     Object.keys(prices).length,
      failed:      Object.keys(errors || {}).length,
      marketState: Object.values(prices)[0]?.marketState || "UNKNOWN",
      prices,
      errors:      errors || {},
      alerts,         // ← triggered alerts
      alertCount:  alerts.length,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Single stock
app.get("/price/:symbol", async (req, res) => {
  const name = req.params.symbol.toUpperCase();
  const sym  = SYMBOL_MAP[name];
  if (!sym) return res.status(404).json({ error: `'${name}' not found` });
  try {
    const data = await fetchOne(sym);
    const alert = ALERT_ZONES[name];
    res.json({ success:true, symbol:name, ...data, alert: alert || null });
  } catch (err) {
    res.status(500).json({ success:false, error: err.message });
  }
});

// Just alerts (lightweight — for polling)
app.get("/alerts", async (req, res) => {
  try {
    const { prices } = await fetchAll(Object.keys(SYMBOL_MAP));
    const alerts = checkAlerts(prices);
    res.json({ success:true, timestamp:new Date().toISOString(), alerts, count:alerts.length });
  } catch (err) {
    res.status(500).json({ success:false, error:err.message });
  }
});

// Symbols list
app.get("/symbols", (req, res) => {
  res.json({ symbols: Object.keys(SYMBOL_MAP), map: SYMBOL_MAP });
});

// Health
app.get("/health", (req, res) => {
  res.json({ status:"ok", uptime:Math.round(process.uptime()), port:PORT,
    cacheAge: Math.round((Date.now()-priceCache.ts)/1000)+"s",
    cachedSymbols: Object.keys(priceCache.data).length });
});

// Root
app.get("/", (req, res) => {
  res.json({ name:"Stock Master Proxy", version:"2.0",
    endpoints:["/prices","/price/:symbol","/alerts","/symbols","/health"] });
});

app.listen(PORT, () => {
  console.log(`\n🚀 Stock Master Proxy v2 → http://localhost:${PORT}`);
  console.log(`📡 /prices  /alerts  /price/:symbol  /health\n`);
});
