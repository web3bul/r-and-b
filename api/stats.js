// GET /api/stats — numbers across every R & B game, for the game's owner only.
// Needs two Vercel environment variables:
//   STATS_KEY                 any password you choose; the stats page asks for it
//   FIREBASE_SERVICE_ACCOUNT  the full JSON of a Firebase service-account key (read access to Firestore + Auth)
const crypto = require("crypto");

let app = null;
function admin() {
  if (app) return app;
  const { initializeApp, cert, getApps } = require("firebase-admin/app");
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  app = getApps()[0] || initializeApp({ credential: cert(sa) });
  return app;
}

function keyOk(given) {
  const want = process.env.STATS_KEY || "";
  if (!want || !given) return false;
  const a = crypto.createHash("sha256").update(String(given)).digest();
  const b = crypto.createHash("sha256").update(want).digest();
  return crypto.timingSafeEqual(a, b);
}

const NOW_MS = 45 * 1000;          // "playing right now": seen in the last 45 seconds
const DAY_MS = 24 * 3600 * 1000;

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!process.env.STATS_KEY || !process.env.FIREBASE_SERVICE_ACCOUNT) {
    return res.status(500).json({ ok: false, error: "Add STATS_KEY and FIREBASE_SERVICE_ACCOUNT in Vercel, then redeploy" });
  }
  if (!keyOk(req.headers["x-stats-key"])) return res.status(401).json({ ok: false, error: "Wrong password" });

  try {
    const { getFirestore } = require("firebase-admin/firestore");
    const db = getFirestore(admin());
    const now = Date.now();

    const snap = await db.collection("games").get();
    const players = new Set(), tgUsers = new Set(), nowSet = new Set(), daySet = new Set(), weekSet = new Set();
    let games = 0, paired = 0, waiting = 0, words = 0, duels = 0, rounds = 0, gamesToday = 0;
    const list = [];
    snap.forEach((d) => {
      const g = d.data();
      const uids = g.uids || [];
      games++;
      if (uids.length >= 2) paired++; else waiting++;
      words += Number(g.t) || 0;
      const dw = g.dw || [0, 0];
      duels += g.dd != null ? Number(g.dd) || 0 : (Number(dw[0]) || 0) + (Number(dw[1]) || 0);
      rounds += ((g.r || [])[0] || 0) + ((g.r || [])[1] || 0);
      (g.players || []).forEach((p) => { if (p && p.tg) tgUsers.add(p.tg); });
      let last = 0;
      uids.forEach((u) => {
        players.add(u);
        const seen = Number((g.seen || {})[u]) || 0;
        last = Math.max(last, seen);
        if (now - seen < NOW_MS) nowSet.add(u);
        if (now - seen < DAY_MS) daySet.add(u);
        if (now - seen < 7 * DAY_MS) weekSet.add(u);
      });
      if (g.last && g.last.at) last = Math.max(last, Number(g.last.at) || 0);
      if (now - last < DAY_MS) gamesToday++;
      const names = uids.map((u) => {
        const p = (g.players || []).filter((x) => x && x.uid === u).pop();
        return p ? String(p.name || "?").slice(0, 12) : "?";
      });
      list.push({ names, words: Number(g.t) || 0, created: Number(g.createdAt) || 0, last, live: uids.some((u) => now - (Number((g.seen || {})[u]) || 0) < NOW_MS) });
    });
    list.sort((a, b) => b.last - a.last);

    // Everyone who has ever opened the game (each phone signs in anonymously), including solo-only players.
    // If this part fails, the rest of the stats still load.
    let opened = null, openedToday = null, token;
    try {
      const { getAuth } = require("firebase-admin/auth");
      const auth = getAuth(admin());
      opened = 0; openedToday = 0;
      do {
        const page = await auth.listUsers(1000, token);
        page.users.forEach((u) => {
          opened++;
          const t = Date.parse(u.metadata.lastRefreshTime || u.metadata.lastSignInTime || u.metadata.creationTime) || 0;
          if (now - t < DAY_MS) openedToday++;
        });
        token = page.pageToken;
      } while (token && opened < 50000);
    } catch (e) {
      opened = null; openedToday = null;
      console.warn("listUsers failed on Node " + process.version + ": " + (e && e.message));
    }

    return res.status(200).json({
      ok: true, at: now, node: process.version,
      totals: { opened, openedToday, players: players.size, telegramUsers: tgUsers.size, games, paired, waiting, words, duels, rounds },
      active: { now: nowSet.size, today: daySet.size, week: weekSet.size, gamesToday },
      recent: list.slice(0, 25)
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "Couldn't read Firebase (Node " + process.version + "): " + (e && e.message ? e.message : e) });
  }
};
