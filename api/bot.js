// POST /api/bot — Telegram sends bot messages here (the webhook).
// Replies to /start (and anything else) with a Play button.
const { webhookSecret, tgCall, playButton, readBody } = require("./_lib");

module.exports = async (req, res) => {
  const token = process.env.BOT_TOKEN;
  if (req.method !== "POST" || !token) return res.status(200).send("ok");
  if (req.headers["x-telegram-bot-api-secret-token"] !== webhookSecret(token)) return res.status(401).send("no");

  const update = readBody(req);
  const msg = update.message;
  if (msg && msg.chat && msg.chat.type === "private") {
    const name = (msg.from && msg.from.first_name) || "there";
    const text = (msg.text || "").trim();
    const reply = text.indexOf("/start") === 0
      ? "Hey " + name + "! 💜 Welcome to R & B, the word game for two.\n\nTap Play to start a game or open the one you're in. I'll message you here whenever it's your turn."
      : "Tap Play to open R & B 💜";
    try { await tgCall(token, "sendMessage", { chat_id: msg.chat.id, text: reply, reply_markup: playButton() }); } catch (e) {}
  }
  return res.status(200).send("ok");
};
