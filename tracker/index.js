// tracker/index.js
import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import "dotenv/config";

const API_URL = process.env.API_URL; // your endpoint
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN; // BotFather token
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID; // your chat/channel id
const API_KEY = process.env.API_KEY;
const UA = process.env.USER_AGENT || "stock-bot/1.0";

// const EMAIL_ENABLED = process.env.EMAIL_ENABLED === "true";
// const GMAIL_USER = process.env.GMAIL_USER;
// const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;

const STATE_PATH = path.join(process.cwd(), "tracker", "state.json");

function flattenStockTotal(payload) {
    // use the API's "stock_at_takealot_total" as headline stock
    return Number(payload?.stock_at_takealot_total ?? 0);
}

function formatWarehouseBreakdown(payload) {
    const lines = (payload?.stock_at_takealot ?? []).map(w =>
        `${w.warehouse.name}: ${w.quantity_available}`
    );
    return lines.join(", ");
}

async function sendTelegram(text) {
    if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) return;
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
    const body = { chat_id: TELEGRAM_CHAT_ID, text, parse_mode: "Markdown" };
    await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });
}

// async function sendEmail(subject, text) {
//   if (!EMAIL_ENABLED) return;
//   const nodemailer = await import("nodemailer");
//   const transporter = nodemailer.createTransport({
//     service: "gmail",
//     auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
//   });
//   await transporter.sendMail({
//     from: GMAIL_USER,
//     to: GMAIL_USER,
//     subject,
//     text,
//   });
// }

function readPrev() {
    try {
        const raw = fs.readFileSync(STATE_PATH, "utf8");
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function writeState(obj) {
    fs.writeFileSync(STATE_PATH, JSON.stringify(obj, null, 2));
}

async function main() {
    const res = await fetch(process.env.API_URL, {
        method: "GET",
        headers: {
            "User-Agent": UA,
            "Accept": "application/json",
            "Accept-Language": "en-US,en;q=0.9",
            "Authorization": `Key ${API_KEY}`,
            "Origin": "https://seller-api.takealot.com",
            "Referer": "https://seller-api.takealot.com/",
            "DNT": "1"
        }
    });
    if (!res.ok) {
        let preview = "";
        try { preview = (await res.text()).slice(0, 500); } catch { }
        throw new Error(`API ${res.status} ${res.statusText} :: ${preview}`);
    }
    const data = await res.json();

    const nowTotal = flattenStockTotal(data);
    const prev = readPrev();
    const prevTotal = prev?.total ?? nowTotal;

    const delta = nowTotal - prevTotal; // negative means sales
    const title = data?.title ?? "Unknown";
    const breakdown = formatWarehouseBreakdown(data);
    const offerUrl = data?.offer_url ?? "";

    // naive sales calc: decrease in TA DC stock = sales (may include ops adjustments)
    if (delta < 0) {
        const sold = Math.abs(delta);
        const msg =
            `✅ *Sale detected* — ${title}\n` +
            `Sold (approx): *${sold}* units\n` +
            `Stock total: ${prevTotal} → ${nowTotal}\n` +
            `DC breakdown: ${breakdown}\n` +
            (offerUrl ? `Link: ${offerUrl}` : "");
        await sendTelegram(msg);
        // await sendEmail("Sale detected", msg.replace(/\*/g, ""));
    }

    writeState({
        total: nowTotal,
        perWarehouse: (data?.stock_at_takealot ?? []).map(w => ({
            id: w.warehouse.warehouse_id,
            name: w.warehouse.name,
            qty: w.quantity_available,
        })),
        lastCheckedIso: new Date().toISOString(),
    });
}

main().catch(async (e) => {
    const err = `Stock Bot failed: ${e.message}`;
    console.error(err);
    try { await sendTelegram(`⚠️ ${err}`); } catch { }
    process.exit(1);
});
