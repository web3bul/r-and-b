// POST /api/notify — the game calls this to ping the other player through the bot.
// Only accepts requests carrying valid Telegram initData, and only sends fixed messages.
const { verifyInitData, tgCall, playButton, readBody } = require("./_lib");

const TAUNTS = ["Too easy! 😎", "Bet you can't beat that 😏", "Your move, babe 💅", "Try to keep up 🏃‍♀️", "I'm built different 💪", "Okay, you got me 😅", "Rematch? 🔥", "Love you, loser 💜"];
const STUMP_BONUS = 2;

function cleanName(s) {
  return String(s || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 20) || "Your partner";
}

function buildText(b, name) {
  const word = /^[a-z]{5}$/.test(String(b.w || "")) ? String(b.w).toUpperCase() : "";
  const tries = Number(b.t), pts = Number(b.p);
  switch (b.type) {
    case "joined":
      return "💜 " + name + " joined your game of R & B! Let the games begin.";
    case "turn":
      return "💌 " + name + " set you a word! Your turn to guess.";
    case "result": {
      let text;
      if (!word) return null;
      if (tries >= 1 && tries <= 6) text = "🎉 " + name + " solved your word " + word + " in " + tries + (tries === 1 ? " guess" : " guesses") + " (+" + (Number.isFinite(pts) ? pts : 0) + ").";
      else text = "😈 " + name + " couldn't get your word " + word + "! +" + STUMP_BONUS + " to you.";
      if (b.rw === "sender") text += "\n🏆 " + name + " won the round!";
      if (b.rw === "you") text += "\n🏆 You won the round!";
      return text + "\nThey're picking a word for you now ✍️";
    }
    case "taunt": {
      const t = TAUNTS[Number(b.i)];
      return t ? "💬 " + name + ": " + t : null;
    }
    default:
      return null;
  }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });
  const token = process.env.BOT_TOKEN;
  if (!token) return res.status(500).json({ ok: false, error: "BOT_TOKEN is not set in Vercel" });

  const b = readBody(req);
  const user = verifyInitData(String(b.initData || ""), token);
  if (!user) return res.status(401).json({ ok: false, error: "Invalid Telegram data" });

  const to = Number(b.to);
  if (!Number.isSafeInteger(to) || to <= 0 || to === user.id) return res.status(400).json({ ok: false, error: "Bad recipient" });

  const text = buildText(b, cleanName(b.name || user.first_name));
  if (!text) return res.status(400).json({ ok: false, error: "Bad message" });

  try {
    const j = await tgCall(token, "sendMessage", { chat_id: to, text, reply_markup: playButton() });
    if (!j.ok) return res.status(200).json({ ok: false, blocked: j.error_code === 403 || j.error_code === 400, error: j.description });
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(502).json({ ok: false, error: "Telegram unreachable" });
  }
};

module.exports.buildText = buildText;
