// Shared helpers for the R & B bot functions (Vercel serverless).
const crypto = require("crypto");

const APP_URL = process.env.APP_URL || "https://r-and-b.vercel.app";
const BOT_USERNAME = process.env.BOT_USERNAME || "RandB_game_Bot";
const APP_SHORT_NAME = process.env.APP_SHORT_NAME || "play";
const PLAY_URL = "https://t.me/" + BOT_USERNAME + "/" + APP_SHORT_NAME;

// Checks that initData really came from Telegram for this bot.
// Returns the Telegram user object, or null if it doesn't check out.
function verifyInitData(initData, token, maxAgeSeconds) {
  if (!initData || !token) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const dataCheckString = [...params.entries()]
    .map(([k, v]) => k + "=" + v)
    .sort()
    .join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(token).digest();
  const calc = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");
  const a = Buffer.from(calc, "hex"), b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const authDate = Number(params.get("auth_date"));
  if (!authDate || Date.now() / 1000 - authDate > (maxAgeSeconds || 7 * 86400)) return null;
  try { return JSON.parse(params.get("user")); } catch (e) { return null; }
}

// Secret shared between Telegram and our webhook, derived from the bot token.
function webhookSecret(token) {
  return crypto.createHash("sha256").update("rnb-webhook:" + token).digest("hex").slice(0, 48);
}

async function tgCall(token, method, body) {
  const r = await fetch("https://api.telegram.org/bot" + token + "/" + method, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return r.json();
}

function playButton(text) {
  return { inline_keyboard: [[{ text: text || "▶️ Play R & B", url: PLAY_URL }]] };
}

function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try { return JSON.parse(req.body || "{}"); } catch (e) { return {}; }
}

module.exports = { verifyInitData, webhookSecret, tgCall, playButton, readBody, APP_URL, PLAY_URL, BOT_USERNAME };
