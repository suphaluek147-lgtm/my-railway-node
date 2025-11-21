// index.js (เว็บ + worker ในไฟล์เดียว)
require("dotenv").config();
const express = require("express");
const fetch = require("node-fetch");

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 10000;

const API_BASE = process.env.DATA_API_BASEURL || "https://api.twelvedata.com";
const API_KEY = process.env.DATA_API_KEY || "";
const SYMBOL = process.env.SYMBOL || "XAUUSD";
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";
const CHECK_INTERVAL_SEC = Number(process.env.CHECK_INTERVAL_SEC || 60);
const NO_REPEAT_MIN = Number(process.env.NO_REPEAT_MIN || 15);

// ---------- simple indicators ----------
function ema(values, period) {
  const k = 2 / (period + 1);
  let out = [];
  if (values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  let prev = sum / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function rsi(closes, period = 14) {
  if (closes.length <= period) return [];
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gains += d; else losses -= d;
  }
  let avgGain = gains / period, avgLoss = losses / period;
  let out = [];
  out[period] = 100 - 100 / (1 + (avgGain / (avgLoss || 1e-8)));
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const gain = d > 0 ? d : 0;
    const loss = d < 0 ? -d : 0;
    avgGain = ((avgGain * (period - 1)) + gain) / period;
    avgLoss = ((avgLoss * (period - 1)) + loss) / period;
    out[i] = 100 - 100 / (1 + (avgGain / (avgLoss || 1e-8)));
  }
  return out;
}

function atr(highs, lows, closes, period = 14) {
  if (highs.length <= period) return [];
  const tr = [];
  for (let i = 1; i < highs.length; i++) {
    const t = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    tr.push(t);
  }
  const out = [];
  let sum = 0;
  for (let i = 0; i < period; i++) sum += tr[i];
  out[period] = sum / period;
  for (let i = period; i < tr.length; i++) {
    sum = sum - tr[i - period] + tr[i];
    out[i + 1] = sum / period;
  }
  return out;
}

// ---------- Twelve Data fetch (time_series) ----------
async function fetchCandlesTD(symbol, interval = "1m", outputsize = 200) {
  const url = `${API_BASE}/time_series?symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=${outputsize}&apikey=${API_KEY}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error("Fetch failed: " + r.statusText);
  const j = await r.json();
  // Twelve Data returns { values: [ { datetime, open, high, low, close }, ... ] }
  const vals = j.values || j.data || [];
  const open = [], high = [], low = [], close = [];
  // values come newest first -> reverse to chronological
  for (let i = vals.length - 1; i >= 0; i--) {
    open.push(Number(vals[i].open));
    high.push(Number(vals[i].high));
    low.push(Number(vals[i].low));
    close.push(Number(vals[i].close));
  }
  return { open, high, low, close };
}

// ---------- decision logic (simplified but strict) ----------
function decideSignal(m1, m5, h1, d1) {
  try {
    // trend: H1 EMA50 > EMA200 -> uptrend
    const ema50_h1 = ema(h1.close, 50);
    const ema200_h1 = ema(h1.close, 200);
    if (!ema50_h1.length || !ema200_h1.length) return null;
    const trendUp = ema50_h1[ema50_h1.length - 1] > ema200_h1[ema200_h1.length - 1];

    // momentum: RSI on M1 and M5
    const rsiM1 = rsi(m1.close, 14);
    const rsiM5 = rsi(m5.close, 14);
    if (!rsiM1.length || !rsiM5.length) return null;
    const lastRsiM1 = rsiM1[rsiM1.length - 1];
    const lastRsiM5 = rsiM5[rsiM5.length - 1];

    // ATR on M1
    const atrM1arr = atr(m1.high, m1.low, m1.close, 14);
    const atrVal = atrM1arr[atrM1arr.length - 1] || 0.5;

    const lastPrice = m1.close[m1.close.length - 1];

    const atrThreshold = 0.1; // adjust later; default low
    // Buy condition
    if (trendUp && lastRsiM1 > 55 && lastRsiM5 > 50 && atrVal > atrThreshold) {
      const entry = lastPrice;
      const tp = Number((entry + 20).toFixed(2));
      const sl = Number((entry - Math.max(atrVal * 1.5, 10)).toFixed(2));
      return { side: "BUY", entry, tp, sl };
    }
    // Sell condition
    if (!trendUp && lastRsiM1 < 45 && lastRsiM5 < 50 && atrVal > atrThreshold) {
      const entry = lastPrice;
      const tp = Number((entry - 20).toFixed(2));
      const sl = Number((entry + Math.max(atrVal * 1.5, 10)).toFixed(2));
      return { side: "SELL", entry, tp, sl };
    }
    return {
    side: "BUY",
    entry: 2000,
    tp: 2020,
    sl: 1990
};
  } catch (e) {
    console.error("decideSignal error", e);
    return null;
  }
}

// ---------- Telegram sender ----------
async function sendTelegram(text) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
    console.warn("Telegram not configured");
    return;
  }
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: "HTML" })
    });
  } catch (e) {
    console.error("sendTelegram error", e);
  }
}

// ---------- main worker flow ----------
let lastSent = { side: null, time: 0 };

async function runOnce() {
  try {
    // fetch multi timeframes
    const [m1, m5, h1, d1] = await Promise.all([
      fetchCandlesTD(SYMBOL, "1min", 300),
      fetchCandlesTD(SYMBOL, "5min", 300),
      fetchCandlesTD(SYMBOL, "1h", 500),
      fetchCandlesTD(SYMBOL, "1day", 365)
    ]);

    const signal = decideSignal(m1, m5, h1, d1);
    if (signal) {
      // prevent duplicates: same side within NO_REPEAT_MIN minutes
      const now = Date.now();
      const minMs = NO_REPEAT_MIN * 60 * 1000;
      if (lastSent.side === signal.side && (now - lastSent.time) < minMs) {
        console.log("Duplicate signal suppressed:", signal.side);
        return;
      }
      // format exactly required
      const msg = `${signal.side} | Entry: ${signal.entry.toFixed(2)} | TP: ${signal.tp.toFixed(2)} | SL: ${signal.sl.toFixed(2)}`;
      console.log("SIGNAL ->", msg);
      await sendTelegram(msg);
      lastSent = { side: signal.side, time: now };
    } else {
      console.log(new Date().toISOString(), "No strong signal");
    }
  } catch (e) {
    console.error("runOnce error", e.message || e);
  }
}

// start periodic check
setInterval(runOnce, CHECK_INTERVAL_SEC * 1000);
runOnce();

// ---------- express web (for Render health check) ----------
app.get("/", (req, res) => {
  res.send("Server is running OK - Signals worker active");
});

app.get("/status", (req, res) => {
  res.json({ ok: true, lastSignal: lastSent, symbol: SYMBOL });
});
// ... โค้ดส่วนบนทั้งหมด ....

//////////////////////////////////////////////
//        TELEGRAM WEBHOOK (NEW)           //
//////////////////////////////////////////////

app.post("/webhook", async (req, res) => {
    try {
        const message = req.body.message;

        if (!message) return res.sendStatus(200);

        const chatId = message.chat.id;
        const text = message.text || "";

        // ❌ ป้องกันตอบตัวเอง
        if (message.from.is_bot) return res.sendStatus(200);

        // ✔ อนุญาตเฉพาะ USER ที่กำหนดเท่านั้น
        if (chatId.toString() !== TELEGRAM_CHAT_ID.toString()) {
            return res.sendStatus(200);
        }

        // ✔ ส่งข้อความตอบกลับ
        await sendTelegram(`คุณพิมพ์ว่า: ${text}`);

        res.sendStatus(200);

    } catch (e) {
        console.error("Webhook error:", e);
        res.sendStatus(500);
    }
});


//////////////////////////////////////////////
//        START SERVER                      //
//////////////////////////////////////////////

app.listen(PORT, () => {
    console.log("Server running on port", PORT);
});
