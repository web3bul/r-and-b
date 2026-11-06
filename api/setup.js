// GET /api/setup — open this once in a browser after adding BOT_TOKEN in Vercel.
// It points the bot at /api/bot and adds a "Play" button to the bot's chat menu.
// Safe to open again: it just re-applies the same settings.
const { webhookSecret, tgCall, APP_URL } = require("./_lib");

module.exports = async (req, res) => {
  const token = process.env.BOT_TOKEN;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  const page = (title, body) => '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:system-ui;background:#2b0f4c;color:#fff;padding:32px;line-height:1.5"><h1>' + title + "</h1>" + body + "</body>";
  if (!token) return res.status(500).send(page("Almost there", "<p>BOT_TOKEN isn't set yet. Add it in Vercel → Project → Settings → Environment Variables, then redeploy and open this page again.</p>"));

  try {
    const hook = await tgCall(token, "setWebhook", {
      url: APP_URL + "/api/bot",
      secret_token: webhookSecret(token),
      allowed_updates: ["message"],
      drop_pending_updates: true
    });
    const menu = await tgCall(token, "setChatMenuButton", {
      menu_button: { type: "web_app", text: "Play", web_app: { url: APP_URL } }
    });
    const desc = await tgCall(token, "setMyDescription", {
      description: "R & B 💜 A word game for two. Set a secret word, your partner guesses it, and the bot pings you when it's your turn."
    });
    const ok = hook.ok && menu.ok;
    return res.status(ok ? 200 : 500).send(page(ok ? "All set ✅" : "Something went wrong",
      "<p>Webhook: " + (hook.ok ? "connected" : (hook.description || "failed")) + "</p>" +
      "<p>Play button: " + (menu.ok ? "added" : (menu.description || "failed")) + "</p>" +
      "<p>Bot description: " + (desc.ok ? "updated" : "skipped") + "</p>" +
      (ok ? "<p>Now open your bot in Telegram and tap Start. You can close this page.</p>" : "")));
  } catch (e) {
    return res.status(502).send(page("Couldn't reach Telegram", "<p>Please try again in a minute.</p>"));
  }
};
