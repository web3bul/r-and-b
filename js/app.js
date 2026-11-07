/* R & B v2 — a live, turn-based word game for two, built as a Telegram Mini App.
 * Both phones share one game in Firebase, so turns, guesses and taunts show up
 * instantly. When the app is closed, the bot sends a Telegram message instead. */
(function () {
  "use strict";

  var CFG = window.RB_CONFIG;
  var ANSWERS = window.RB_ANSWERS;
  var VALID = new Set(window.RB_VALID || []);
  ANSWERS.forEach(function (a) { VALID.add(a.w); });
  var NET = window.RBNet;

  var tg = window.Telegram && window.Telegram.WebApp;
  var inTelegram = !!(tg && tg.initData);
  var tgUser = (inTelegram && tg.initDataUnsafe && tg.initDataUnsafe.user) || null;
  var TAUNTS = ["Too easy! 😎", "Bet you can't beat that 😏", "Your move, babe 💅", "Try to keep up 🏃‍♀️", "I'm built different 💪", "Okay, you got me 😅", "Rematch? 🔥", "Love you, loser 💜"];
  var ONLINE_MS = 35000;
  var $ = function (s) { return document.querySelector(s); };

  /* ---------- local storage ---------- */
  var PFX = "rb2_" + (window.RB_MOCK ? window.RB_MOCK + "_" : "");
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem(PFX + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(PFX + k, JSON.stringify(v)); } catch (e) {} }
  };

  /* ---------- sound + haptics ---------- */
  var muted = store.get("muted", false);
  var actx = null;
  function beep(freq, dur, type, vol) {
    if (muted) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      var o = actx.createOscillator(), g = actx.createGain();
      o.type = type || "sine"; o.frequency.value = freq;
      g.gain.setValueAtTime(vol || 0.08, actx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + (dur || 0.08));
      o.connect(g); g.connect(actx.destination); o.start(); o.stop(actx.currentTime + (dur || 0.08));
    } catch (e) {}
  }
  var sfx = {
    key: function () { beep(520, 0.05, "triangle", 0.05); },
    pop: function () { beep(760, 0.09, "sine", 0.07); },
    bad: function () { beep(160, 0.2, "sawtooth", 0.05); },
    ding: function () { beep(880, 0.12, "sine", 0.08); setTimeout(function () { beep(1175, 0.18, "sine", 0.08); }, 120); },
    win: function () { [523, 659, 784, 1047].forEach(function (f, i) { setTimeout(function () { beep(f, 0.18, "triangle", 0.08); }, i * 120); }); },
    lose: function () { [392, 330, 262].forEach(function (f, i) { setTimeout(function () { beep(f, 0.22, "sine", 0.07); }, i * 160); }); }
  };
  function haptic(kind) {
    try {
      if (!tg || !tg.HapticFeedback) return;
      if (kind === "light") tg.HapticFeedback.impactOccurred("light");
      else tg.HapticFeedback.notificationOccurred(kind);
    } catch (e) {}
  }

  /* ---------- toast, bubble, confetti ---------- */
  var toastTimer, bubbleTimer;
  function toast(msg) {
    var t = $("#toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2600);
  }
  function bubble(from, msg) {
    var b = $("#bubble"); b.innerHTML = "<small>" + esc(from) + "</small>" + esc(msg); b.classList.add("show");
    clearTimeout(bubbleTimer); bubbleTimer = setTimeout(function () { b.classList.remove("show"); }, 3800);
  }
  function confetti() {
    var c = $("#confetti"), ctx = c.getContext("2d");
    var W = c.width = innerWidth, H = c.height = innerHeight;
    var colors = ["#ff6aa8", "#ffbf3c", "#2fd27a", "#8fb6ff", "#ffffff", "#b44dff"];
    var parts = [];
    for (var i = 0; i < 140; i++) parts.push({ x: W / 2, y: H / 3, vx: (Math.random() - .5) * 14, vy: Math.random() * -14 - 4, s: Math.random() * 7 + 4, r: Math.random() * 6, vr: (Math.random() - .5) * .3, c: colors[i % colors.length], heart: i % 7 === 0 });
    var frames = 0;
    (function step() {
      ctx.clearRect(0, 0, W, H);
      parts.forEach(function (p) {
        p.vy += 0.35; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.vx *= 0.99;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c;
        if (p.heart) { ctx.font = (p.s * 2.4) + "px serif"; ctx.fillText("💜", 0, 0); }
        else ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
        ctx.restore();
      });
      if (++frames < 150) requestAnimationFrame(step); else ctx.clearRect(0, 0, W, H);
    })();
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  /* ---------- game state ---------- */
  var uid = null;            // this device's Firebase user id
  var gameId = store.get("gameId", null);
  var G = null;              // the shared game document
  var me = -1;               // my index in G.uids (0 = creator)
  var unsub = null;
  var screen = "loading";
  var localResult = null;    // my most recent result, for the result screen
  var seenTaunt = store.get("seenTaunt", 0);
  var sentTaunt = false;

  function other(i) { return i === 0 ? 1 : 0; }
  function player(i) {
    if (!G || !G.uids[i]) return null;
    var u = G.uids[i];
    var list = (G.players || []).filter(function (p) { return p.uid === u; });
    return list[list.length - 1] || null;
  }
  function nameOf(i) { var p = player(i); return p ? p.name : "your partner"; }
  function myName() { return nameOf(me); }
  function partnerName() { return nameOf(other(me)); }
  function hasPartner() { return !!(G && G.uids.length === 2); }
  function guesser() { return other(G.setter); }
  function isOnline(i) {
    if (!G || !G.uids[i]) return false;
    var t = G.seen && G.seen[G.uids[i]];
    return !!t && Date.now() - t < ONLINE_MS;
  }
  function okWord(w) { return w.length >= CFG.MIN_LEN && w.length <= CFG.MAX_LEN && VALID.has(w); }
  function isBurned(row) { return /^\.+$/.test(row); }
  function wordLen() { return (G && G.word && G.word.length) || CFG.MAX_LEN; }
  function randId(n) {
    var chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789", out = "";
    var bytes = new Uint8Array(n); (window.crypto || window.msCrypto).getRandomValues(bytes);
    for (var i = 0; i < n; i++) out += chars[bytes[i] % chars.length];
    return out;
  }
  function patch(fields) {
    return NET.patch(gameId, fields).catch(function (e) {
      console.warn(e); toast("Couldn't save — check your connection");
    });
  }

  /* ---------- screens ---------- */
  function show(id) {
    document.querySelectorAll(".screen").forEach(function (s) { s.classList.toggle("active", s.id === id); });
    screen = id;
    var canBack = id === "score" || id === "setup" || (id === "set" && G && G.t > 0) || id === "board" || id === "forfeit";
    $("#btnBack").hidden = !canBack;
    if (tg && tg.BackButton) { try { canBack ? tg.BackButton.show() : tg.BackButton.hide(); } catch (e) {} }
    if (id !== "set" && id !== "board") activeKeyHandler = null;
    if (id !== "board" && clockTimer) pauseClock();
    window.scrollTo(0, 0);
  }
  function goHome() { renderHome(); show("home"); }

  /* ---------- keyboard ---------- */
  var ROWS = ["qwertyuiop", "asdfghjkl", "+zxcvbnm-"];
  function buildKeyboard(el, onKey) {
    el.innerHTML = "";
    ROWS.forEach(function (r) {
      var row = document.createElement("div"); row.className = "kb-row";
      r.split("").forEach(function (ch) {
        var b = document.createElement("button"); b.className = "key"; b.type = "button";
        if (ch === "+") { b.textContent = "Enter"; b.classList.add("wide"); b.dataset.k = "enter"; }
        else if (ch === "-") { b.textContent = "⌫"; b.classList.add("wide"); b.dataset.k = "back"; }
        else { b.textContent = ch; b.dataset.k = ch; }
        b.addEventListener("click", function () { onKey(b.dataset.k); });
        row.appendChild(b);
      });
      el.appendChild(row);
    });
  }
  var activeKeyHandler = null;
  document.addEventListener("keydown", function (e) {
    if (!activeKeyHandler || e.target.tagName === "INPUT") return;
    if (e.key === "Enter") activeKeyHandler("enter");
    else if (e.key === "Backspace") activeKeyHandler("back");
    else if (/^[a-zA-Z]$/.test(e.key)) activeKeyHandler(e.key.toLowerCase());
  });

  /* ---------- scoring ---------- */
  function scoreGuess(guess, answer) {
    var n = answer.length, res = [], left = {};
    for (var i = 0; i < n; i++) {
      res.push("x");
      if (guess[i] === answer[i]) res[i] = "g";
      else left[answer[i]] = (left[answer[i]] || 0) + 1;
    }
    for (var j = 0; j < n; j++) {
      if (res[j] !== "g" && left[guess[j]]) { res[j] = "y"; left[guess[j]]--; }
    }
    return res;
  }

  /* ---------- HOME ---------- */
  function renderHome() {
    document.querySelectorAll(".ptw").forEach(function (x) { x.textContent = CFG.POINTS_TO_WIN; });
    if (!G) { $("#homeEmpty").hidden = false; $("#homeGame").hidden = true; return; }
    $("#homeEmpty").hidden = true; $("#homeGame").hidden = false;
    var a = me, b = other(me), partner = hasPartner();

    $("#nameA").textContent = myName() + " (you)";
    $("#nameB").textContent = partner ? partnerName() : "Waiting…";
    $("#avA").firstChild.nodeValue = (myName() || "?")[0].toUpperCase();
    $("#avB").firstChild.nodeValue = partner ? (partnerName() || "?")[0].toUpperCase() : "?";
    $("#dotA").className = "dot on";
    $("#dotB").className = "dot " + (partner ? (isOnline(b) ? "on" : "off") : "");
    $("#roundsA").textContent = G.r[a]; $("#roundsB").textContent = G.r[b];
    $("#ptsA").textContent = G.s[a]; $("#ptsB").textContent = G.s[b];
    setTimeout(function () {
      $("#barA").style.width = Math.min(100, G.s[a] / CFG.POINTS_TO_WIN * 100) + "%";
      $("#barB").style.width = Math.min(100, G.s[b] / CFG.POINTS_TO_WIN * 100) + "%";
    }, 60);

    // Latest result line
    var ll = $("#lastLine");
    if (G.last && partner) {
      var l = G.last, gName = l.g === me ? "You" : nameOf(l.g), w = l.w.toUpperCase();
      var txt = l.t ? "<b>" + esc(gName) + "</b> solved <b>" + w + "</b> in " + l.t + " (+" + l.p + ")"
        : "<b>" + esc(gName) + "</b> missed <b>" + w + "</b> (+" + CFG.STUMP_BONUS + " to " + esc(l.g === me ? partnerName() : "you") + ")";
      if (l.rw != null && l.rw >= 0) txt += " · 🏆 " + (l.rw === me ? "You" : esc(nameOf(l.rw))) + " won the round!";
      ll.innerHTML = "Last turn: " + txt; ll.hidden = false;
    } else ll.hidden = true;

    forfeitCard();

    // Status + main button
    var status = $("#status"), btn = $("#btnMain"), title = $("#mainTitle"), sub = $("#mainSub");
    var live = $("#liveCard");
    status.classList.remove("go"); btn.disabled = false; live.hidden = true;
    $("#btnInvite").hidden = partner;
    $("#soloBar").hidden = !solo;
    $("#btnSolo2").hidden = solo;

    if (G.phase === "setting") {
      if (G.setter === me) {
        status.textContent = partner ? "Your turn to set a word ✍️" : "Set the first word ✍️"; status.classList.add("go");
        title.textContent = "Set a word"; sub.textContent = "for " + (partner ? partnerName() : "your partner");
      } else {
        status.textContent = partnerName() + " is picking a word for you… ✍️";
        title.textContent = "Waiting for " + partnerName(); sub.textContent = "You'll get a ping when it's ready";
        btn.disabled = true;
      }
    } else { // guessing
      if (guesser() === me) {
        status.textContent = "Your turn to guess! 🎯"; status.classList.add("go");
        title.textContent = (G.guesses && G.guesses.length ? "Keep guessing" : "Guess " + partnerName() + "'s word");
        sub.textContent = wordLen() + "-letter word · " + (CFG.MAX_GUESSES - (G.guesses || []).length) + " guesses left" + (G.clue ? " · clue inside" : "");
      } else if (!partner) {
        status.textContent = "Word ready. Now invite your partner 💌";
        title.textContent = "Waiting for your partner"; sub.textContent = "They'll guess as soon as they join";
        btn.disabled = true;
      } else {
        status.textContent = partnerName() + " is guessing your word 🤔";
        title.textContent = "Waiting for " + partnerName(); sub.textContent = "Watch them live below";
        btn.disabled = true;
        renderLive();
      }
    }
  }
  var liveCount = 0, liveTyped = "";
  function renderLive() {
    var live = $("#liveCard"), grid = $("#liveGrid");
    live.hidden = false;
    var L = wordLen(), rows = G.guesses || [], typing = (G.typing || "").slice(0, L);
    $("#liveTitle").textContent = typing
      ? partnerName() + " is typing… ✍️"
      : rows.length
        ? partnerName() + " has used " + rows.length + " of " + CFG.MAX_GUESSES + " guesses" + ((G.hints || []).length ? " (+" + G.hints.length + " hint)" : "")
        : partnerName() + " is thinking… 🤔";
    grid.innerHTML = "";
    for (var r = 0; r < CFG.MAX_GUESSES; r++) {
      var row = document.createElement("div"); row.className = "mini-row";
      var res = rows[r] ? scoreGuess(rows[r], G.word) : null;
      for (var c = 0; c < L; c++) {
        var m = document.createElement("div"); m.className = "mini" + (res ? " " + res[c] : "");
        if (res) {
          m.textContent = rows[r][c] === "." ? "" : rows[r][c];
          if (r >= liveCount) m.classList.add("pop");
        } else if (r === rows.length && typing[c]) {
          m.textContent = typing[c]; m.classList.add("typing");
          if (c >= liveTyped.length) m.classList.add("pop");
        }
        row.appendChild(m);
      }
      grid.appendChild(row);
    }
    liveCount = rows.length; liveTyped = typing;
    tickLiveClock();
  }
  // Countdown shown on the watcher's screen, driven by the guesser's deadline.
  function tickLiveClock() {
    var el = $("#liveTimer");
    if (G && G.phase === "guessing" && guesser() !== me && !G.deadline && G.clockLeft > 0 && !$("#liveCard").hidden) {
      el.hidden = false; el.classList.remove("urgent");
      el.textContent = "⏸ Paused · " + Math.ceil(G.clockLeft / 1000) + "s left"; return;
    }
    if (!G || G.phase !== "guessing" || guesser() === me || !G.deadline || $("#liveCard").hidden) { el.hidden = true; return; }
    var left = Math.ceil((G.deadline - Date.now()) / 1000);
    if (left < 0 || left > CFG.GUESS_SECONDS + 2) { el.hidden = true; return; }
    el.hidden = false; el.textContent = "⏱ " + left + "s";
    el.classList.toggle("urgent", left <= 5);
  }
  setInterval(function () { if (screen === "home" && G) tickLiveClock(); }, 250);
  function mainAction() {
    if (!G) return;
    if (G.phase === "setting" && G.setter === me) startSet();
    else if (G.phase === "guessing" && guesser() === me) startBoard();
  }

  /* ---------- live updates ---------- */
  function watchGame(id) {
    if (unsub) { try { unsub(); } catch (e) {} }
    gameId = id; if (!solo) store.set("gameId", id);
    var first = true;
    unsub = NET.watch(id, function (doc) {
      if (!doc) { if (first) lostGame(); return; }
      var prev = G; G = doc; me = G.uids.indexOf(uid);
      if (me < 0) { lostGame(); return; }
      onUpdate(prev, first); first = false;
    }, function (err) {
      console.warn(err);
      if (first) lostGame();
    });
  }
  function lostGame() {
    if (unsub) { try { unsub(); } catch (e) {} unsub = null; }
    G = null; gameId = null; store.set("gameId", null);
    renderHome(); show("home");
    toast("Couldn't open your game. Start a new one 💜");
  }
  function onUpdate(prev, first) {
    // Partner's taunt
    if (G.taunt && G.taunt.from !== me && G.taunt.at > seenTaunt) {
      seenTaunt = G.taunt.at; store.set("seenTaunt", seenTaunt);
      if (Date.now() - G.taunt.at < 10 * 60 * 1000) { bubble(partnerName() + " says", G.taunt.text || TAUNTS[G.taunt.i] || ""); sfx.pop(); haptic("light"); }
    }
    if (!first && prev) {
      // Partner joined
      if (prev.uids.length < 2 && G.uids.length === 2) { toast("💜 " + partnerName() + " joined!"); sfx.ding(); haptic("success"); }
      // A word was just set for me
      var newGuessTurn = G.phase === "guessing" && guesser() === me && !(prev.phase === "guessing" && prev.t === G.t);
      if (newGuessTurn) { toast("💌 " + partnerName() + " set you a word!"); sfx.ding(); haptic("success"); }
      // Partner finished guessing my word
      if (prev.phase === "guessing" && prev.setter === me && G.t === prev.t + 1 && G.last && G.last.g !== me) {
        var l = G.last;
        if (l.t) toast("🎉 " + partnerName() + " solved " + l.w.toUpperCase() + " in " + l.t + "!");
        else { toast("😈 " + partnerName() + " missed " + l.w.toUpperCase() + "! +" + CFG.STUMP_BONUS + " to you"); sfx.win(); }
        if (l.rw >= 0) confetti();
        haptic("warning");
      }
      // Forfeit updates
      var pf = prev.forfeit || {}, f = G.forfeit;
      if (f && f.state === "pending" && pf.at !== f.at && f.w === me && G.last && G.last.g !== me) {
        toast("🏆 You won the round! Pick " + partnerName() + "'s forfeit 😈"); sfx.win(); confetti();
      }
      if (f && f.state === "set" && pf.state !== "set" && f.l === me) {
        bubble(partnerName() + " picked your forfeit 😈", f.text); sfx.ding(); haptic("warning");
      }
      if (f && f.state === "done" && pf.state !== "done" && f.w === me) {
        toast("✅ " + partnerName() + " says they did the forfeit!"); sfx.ding(); haptic("success");
      }
    }
    if (first && ["loading", "join", "setup", "home"].indexOf(screen) >= 0) goHome();
    else if (screen === "home") renderHome();
    if (first) heartbeat();
    if (solo) botTick();
  }

  /* ---------- presence ---------- */
  function heartbeat() {
    if (!gameId || !uid || document.hidden) return;
    var f = {}; f["seen." + uid] = Date.now(); NET.patch(gameId, f).catch(function () {});
  }
  setInterval(function () { heartbeat(); if (screen === "home" && G) renderHome(); }, 20000);
  document.addEventListener("visibilitychange", function () {
    if (!gameId || !uid) return;
    if (document.hidden) pauseClock(); else resumeClock();
    var f = {}; f["seen." + uid] = document.hidden ? 0 : Date.now();
    NET.patch(gameId, f).catch(function () {});
  });
  window.addEventListener("pagehide", function () { pauseClock(); });

  /* ---------- notifications (via the bot) ---------- */
  function notify(payload) {
    if (!inTelegram || !G || !hasPartner()) return;
    var p = player(other(me));
    if (!p || !p.tg) return;
    if (isOnline(other(me))) return; // they're in the app and will see it live
    var body = Object.assign({ initData: tg.initData, to: p.tg, name: myName() }, payload);
    fetch("/api/notify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && j.blocked && !store.get("warnedBlocked", false)) {
          store.set("warnedBlocked", true);
          toast(partnerName() + " should tap Start on @" + CFG.BOT_USERNAME + " to get pings");
        }
      }).catch(function () {});
  }

  /* ---------- invite ---------- */
  function b64url(s) { return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
  function unb64url(s) { try { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return decodeURIComponent(escape(atob(s))); } catch (e) { return ""; } }
  function inviteLink() {
    var param = "j_" + gameId + "_" + b64url(myName());
    if (CFG.BOT_USERNAME && CFG.APP_SHORT_NAME && !window.RB_MOCK) return "https://t.me/" + CFG.BOT_USERNAME + "/" + CFG.APP_SHORT_NAME + "?startapp=" + param;
    return location.origin + location.pathname + "?startapp=" + param;
  }
  function shareInvite() {
    var link = inviteLink();
    var text = "💜 " + myName() + " invited you to play R & B! Tap to join 👇";
    if (inTelegram) tg.openTelegramLink("https://t.me/share/url?url=" + encodeURIComponent(link) + "&text=" + encodeURIComponent(text));
    else if (navigator.share) navigator.share({ title: "R & B", text: text, url: link }).catch(function () { copy(link); });
    else copy(link);
  }
  function copy(text) {
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { toast("Invite link copied! 💌"); }, function () { prompt("Copy this link:", text); });
    else prompt("Copy this link:", text);
  }
  function startParam() {
    var p = tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param;
    if (p) return p;
    var q = new URLSearchParams(location.search);
    return q.get("tgWebAppStartParam") || q.get("startapp");
  }

  /* ---------- SETUP (new game) ---------- */
  function startSetup() {
    $("#inMe").value = store.get("myName", (tgUser && tgUser.first_name) || "");
    show("setup");
  }
  function createGame() {
    var name = $("#inMe").value.trim().slice(0, 12);
    if (!name) { toast("Add your name first 💜"); return; }
    store.set("myName", name);
    leaveSoloQuietly();
    var id = randId(12), now = Date.now();
    var seen = {}; seen[uid] = now;
    var doc = {
      v: 2, createdAt: now, uids: [uid], players: [{ uid: uid, name: name, tg: tgUser ? tgUser.id : null }],
      s: [0, 0], r: [0, 0], t: 0, setter: 0, phase: "setting", word: "", clue: "",
      guesses: [], hints: [], last: null, taunt: null, history: [], seen: seen
    };
    $("#btnSetupGo").disabled = true;
    NET.create(id, doc).then(function () {
      G = doc; me = 0; gameId = id;
      watchGame(id);
      setTimeout(startSet, 150);
    }).catch(function (e) { console.warn(e); toast("Couldn't create the game. Try again."); })
      .then(function () { $("#btnSetupGo").disabled = false; });
  }

  /* ---------- JOIN ---------- */
  var joinId = null;
  function showJoin(id, inviter) {
    joinId = id;
    $("#joinTitle").textContent = (inviter || "Someone") + " invited you! 💜";
    $("#joinNote").textContent = gameId && gameId !== id ? "Joining will replace the game you're in now." : "Join and you'll play live from now on. No more links.";
    $("#inJoinName").value = store.get("myName", (tgUser && tgUser.first_name) || "");
    show("join");
  }
  function joinGame() {
    var name = $("#inJoinName").value.trim().slice(0, 12);
    if (!name) { toast("Add your name first 💜"); return; }
    store.set("myName", name);
    leaveSoloQuietly();
    $("#btnJoin").disabled = true;
    NET.join(joinId, uid, { uid: uid, name: name, tg: tgUser ? tgUser.id : null }, Date.now()).then(function () {
      G = null; watchGame(joinId);
      setTimeout(function () { notify({ type: "joined" }); }, 1500);
    }).catch(function (e) {
      console.warn(e);
      var code = e && e.code || "";
      toast(code.indexOf("permission") >= 0 ? "That game already has two players" : "That invite doesn't work anymore");
      if (gameId) watchGame(gameId); else { renderHome(); show("home"); }
    }).then(function () { $("#btnJoin").disabled = false; });
  }

  /* ---------- SET A WORD ---------- */
  var setWord = "", hideWord = false;
  // Where the text in the clue box came from: "" (empty), "user", "surprise" or "dict".
  var clueSource = "", clueFor = "";
  var CLUE_MAX = 100;
  var dictCache = {};

  // Look the word up in the free dictionary and turn its definition into a clue,
  // hiding the word itself so the clue doesn't give it away.
  function dictionaryClue(word) {
    if (dictCache[word] !== undefined) return Promise.resolve(dictCache[word]);
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 5000);
    return fetch("https://api.dictionaryapi.dev/api/v2/entries/en/" + encodeURIComponent(word), ctrl ? { signal: ctrl.signal } : {})
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (data) {
        clearTimeout(timer);
        var best = null, order = ["noun", "verb", "adjective", "adverb"];
        (Array.isArray(data) ? data : []).forEach(function (entry) {
          (entry.meanings || []).forEach(function (m) {
            (m.definitions || []).forEach(function (d) {
              var def = String(d.definition || "").trim();
              if (!def || def.length < 8) return;
              var rank = order.indexOf(m.partOfSpeech); if (rank < 0) rank = 9;
              var score = rank * 1000 + (def.length > 90 ? 500 : 0) + def.length;
              if (!best || score < best.score) best = { score: score, def: def, pos: m.partOfSpeech };
            });
          });
        });
        var clue = best ? makeClue(word, best.def, best.pos) : "";
        dictCache[word] = clue;
        return clue;
      })
      .catch(function () { clearTimeout(timer); return ""; });
  }
  function makeClue(word, def, pos) {
    var stem = word.length > 4 ? word.slice(0, 4) : word;
    var masked = def.replace(new RegExp("\\b" + stem + "[a-z]*", "gi"), "___");
    masked = masked.replace(/\s+/g, " ").replace(/\.$/, "");
    var label = pos ? "(" + pos + ") " : "";
    var room = CLUE_MAX - label.length;
    if (masked.length > room) masked = masked.slice(0, room - 1).replace(/\s+\S*$/, "") + "…";
    return label + masked.charAt(0).toUpperCase() + masked.slice(1);
  }
  function maybeAutoClue() {
    var inp = $("#inClue"), note = $("#clueNote");
    var ok = okWord(setWord);
    // Clear a clue that belonged to a different word (unless the user wrote it).
    if (clueSource && clueSource !== "user" && clueFor !== setWord) { inp.value = ""; clueSource = ""; note.textContent = ""; }
    if (!ok || clueSource) return;
    var word = setWord;
    note.textContent = "📖 Looking up a clue…";
    dictionaryClue(word).then(function (clue) {
      if (setWord !== word || clueSource) return; // word changed or user started typing
      if (clue) { inp.value = clue; clueSource = "dict"; clueFor = word; note.textContent = "📖 Clue from the dictionary. Edit it if you like."; }
      else note.textContent = "No dictionary clue for this one. Write your own, or leave it blank.";
    });
  }
  function renderEntry() {
    var e = $("#entry"); e.innerHTML = "";
    for (var i = 0; i < CFG.MAX_LEN; i++) {
      var t = document.createElement("div");
      // Boxes past the minimum length are optional; they fade once the word could stop there.
      t.className = "tile" + (setWord[i] ? " filled" : (i >= CFG.MIN_LEN && i >= setWord.length && setWord.length >= CFG.MIN_LEN ? " optional" : ""));
      t.textContent = setWord[i] || ""; e.appendChild(t);
    }
    e.classList.toggle("hidden-word", hideWord);
    var msg = $("#entryMsg"), ok = okWord(setWord), n = setWord.length;
    msg.className = "entry-msg";
    if (n < CFG.MIN_LEN) msg.textContent = "Type a word of " + CFG.MIN_LEN + " to " + CFG.MAX_LEN + " letters";
    else if (ok) { msg.textContent = "✓ " + n + "-letter word" + (n < CFG.MAX_LEN ? " · send it, or keep typing" : ""); msg.classList.add("ok"); }
    else { msg.textContent = n < CFG.MAX_LEN ? "Not a word yet… keep typing" : "Not in the word list"; if (n === CFG.MAX_LEN) msg.classList.add("bad"); }
    $("#btnSend").disabled = !ok;
    $("#btnSend").innerHTML = ok ? "Send " + n + "-letter word &#128140;" : "Send it &#128140;";
    maybeAutoClue();
  }
  function onSetKey(k) {
    if (k === "back") setWord = setWord.slice(0, -1);
    else if (k === "enter") { if (!$("#btnSend").disabled) sendWord(); return; }
    else if (setWord.length < CFG.MAX_LEN) setWord += k;
    sfx.key(); haptic("light"); renderEntry();
  }
  function startSet() {
    if (!G || G.phase !== "setting" || G.setter !== me) { goHome(); return; }
    setWord = ""; hideWord = false; $("#inClue").value = ""; clueSource = ""; clueFor = ""; $("#clueNote").textContent = "";
    $("#btnPeek").textContent = "👁 Hide";
    $("#setTitle").textContent = "Set a word for " + (hasPartner() ? partnerName() : "your partner");
    buildKeyboard($("#kbSet"), onSetKey);
    renderEntry(); show("set");
    activeKeyHandler = onSetKey;
  }
  function surprise() {
    var pick = ANSWERS[Math.floor(Math.random() * ANSWERS.length)];
    setWord = pick.w; $("#inClue").value = pick.c; clueSource = "surprise"; clueFor = pick.w;
    $("#clueNote").textContent = "";
    sfx.pop(); renderEntry();
  }
  function sendWord() {
    if (!okWord(setWord) || !G) return;
    var clue = $("#inClue").value.trim().slice(0, CLUE_MAX);
    $("#btnSend").disabled = true;
    patch({ word: setWord, clue: clue, phase: "guessing", guesses: [], hints: [] }).then(function () {
      if (hasPartner()) { notify({ type: "turn" }); toast("Sent! " + partnerName() + " can play now 💌"); }
      else { toast("Word saved! Now invite your partner 💌"); setTimeout(shareInvite, 600); }
      sfx.pop(); goHome();
    });
  }

  /* ---------- BOARD ---------- */
  var cur = "", locked = false;
  function startBoard() {
    if (!G || G.phase !== "guessing" || guesser() !== me) { goHome(); return; }
    cur = ""; locked = false;
    $("#bFor").textContent = "Guess " + partnerName() + "'s " + wordLen() + "-letter word";
    var cb = $("#bClue"); cb.hidden = !G.clue; cb.textContent = "Clue: " + G.clue;
    buildKeyboard($("#kbBoard"), onBoardKey);
    show("board"); renderBoard();
    activeKeyHandler = onBoardKey;
    startClock(savedClock());
  }

  /* ---------- guess clock ---------- */
  // The clock pauses when the guesser leaves the board or closes the game,
  // and picks up from the same second when they come back.
  var clockTimer = null, deadline = 0, lastTickSec = -1;
  function savedClock() {
    if (!G) return 0;
    if (G.clockLeft > 0) return G.clockLeft;                         // paused properly
    if (G.deadline > 0) return Math.max(3000, G.deadline - Date.now()); // app was killed mid-guess
    return 0;
  }
  function startClock(ms) {
    stopClock();
    var full = CFG.GUESS_SECONDS * 1000;
    deadline = Date.now() + (ms > 0 ? Math.min(ms, full) : full); lastTickSec = -1;
    patch({ deadline: deadline, clockLeft: 0, typing: "" });
    renderClock();
    clockTimer = setInterval(renderClock, 200);
  }
  function stopClock() {
    if (clockTimer) clearInterval(clockTimer);
    clockTimer = null;
  }
  function pauseClock() {
    if (!clockTimer) return;
    stopClock(); clearTimeout(typingTimer);
    var left = Math.max(1000, deadline - Date.now());
    if (G && G.phase === "guessing" && guesser() === me) {
      G.clockLeft = left; G.deadline = 0;
      NET.patch(gameId, { clockLeft: left, deadline: 0, typing: "" }).catch(function () {});
    }
  }
  function resumeClock() {
    if (screen === "board" && !clockTimer && !locked && G && G.phase === "guessing" && guesser() === me) startClock(savedClock());
  }
  function renderClock() {
    var left = Math.max(0, deadline - Date.now()), sec = Math.ceil(left / 1000);
    var el = $("#timer");
    el.textContent = sec + "s";
    el.style.setProperty("--p", (left / (CFG.GUESS_SECONDS * 1000)).toFixed(3));
    el.classList.toggle("urgent", sec <= 5);
    if (sec <= 5 && sec > 0 && sec !== lastTickSec) { lastTickSec = sec; beep(sec <= 3 ? 990 : 660, 0.05, "square", 0.04); if (sec <= 3) haptic("light"); }
    if (left <= 0) { stopClock(); timeUp(); }
  }
  function timeUp() {
    if (screen !== "board" || !G || G.phase !== "guessing" || guesser() !== me) return;
    if (locked) { setTimeout(timeUp, 300); return; }
    var rows = (G.guesses || []).concat([new Array(wordLen() + 1).join(".")]), rowIdx = rows.length - 1;
    G.guesses = rows; cur = "";
    toast("⏱ Time's up! That guess is gone"); sfx.bad(); haptic("warning");
    locked = true; renderBoard(rowIdx);
    var out = rows.length >= CFG.MAX_GUESSES;
    if (!out) patch({ guesses: rows, typing: "" });
    setTimeout(function () { locked = false; if (out) finish(false); else startClock(); }, 900);
  }

  /* ---------- live typing (so the other player can watch) ---------- */
  var typingTimer = null;
  function sendTyping() {
    clearTimeout(typingTimer);
    typingTimer = setTimeout(function () { if (screen === "board") NET.patch(gameId, { typing: cur }).catch(function () {}); }, 120);
  }
  function renderBoard(animateRow) {
    var L = wordLen(), rows = G.guesses || [], hints = G.hints || [], grid = $("#grid"); grid.innerHTML = "";
    grid.style.setProperty("--cols", L);
    for (var r = 0; r < CFG.MAX_GUESSES; r++) {
      var row = document.createElement("div"); row.className = "row";
      var done = rows[r], res = done ? scoreGuess(done, G.word) : null;
      for (var c = 0; c < L; c++) {
        var t = document.createElement("div"); t.className = "tile";
        if (done) {
          t.textContent = done[c] === "." ? "" : done[c];
          if (isBurned(done)) t.classList.add("burned");
          if (r === animateRow) {
            (function (tile, cls, delay) {
              tile.style.animationDelay = delay + "ms"; tile.classList.add("flip");
              setTimeout(function () { tile.classList.add(cls); sfx.key(); }, delay + 250);
            })(t, res[c], c * 160);
          } else t.classList.add(res[c]);
        } else if (r === rows.length) {
          if (cur[c]) { t.textContent = cur[c]; t.classList.add("filled"); }
          else if (hints.indexOf(c) >= 0) { t.classList.add("hint-slot"); t.innerHTML = '<span class="hl">' + G.word[c] + "</span>"; }
        }
        row.appendChild(t);
      }
      grid.appendChild(row);
    }
    paintKeys(animateRow != null ? 1100 : 0);
    fitBoard();
  }
  // Size the tiles so the clue, grid and keyboard all fit on screen without scrolling,
  // using the height Telegram actually gives the Mini App (iPhones vary a lot).
  function viewH() { return Math.round((tg && tg.viewportStableHeight) || window.innerHeight || 700); }
  function fitScreen() {
    var h = viewH();
    document.documentElement.style.setProperty("--vh", h + "px");
    document.documentElement.classList.toggle("short", h < 720);
    document.documentElement.classList.toggle("tiny", h < 620);
    fitBoard();
  }
  function fitBoard() {
    if (screen !== "board" || !G || !G.word) return;
    var grid = $("#grid"), L = wordLen(), gap = 6;
    var used = $(".topbar").offsetHeight + $("#board .board-top").offsetHeight + $("#kbBoard").offsetHeight + 14 * 2 + 18;
    var byH = (viewH() - used - gap * (CFG.MAX_GUESSES - 1)) / CFG.MAX_GUESSES;
    var byW = (Math.min(window.innerWidth - 32, 420) - gap * (L - 1)) / L;
    var ts = Math.max(28, Math.floor(Math.min(byH, byW, 66)));
    grid.style.setProperty("--ts", ts + "px");
  }
  window.addEventListener("resize", fitScreen);
  if (tg && tg.onEvent) { try { tg.onEvent("viewportChanged", fitScreen); } catch (e) {} }
  function paintKeys(delay) {
    var best = {}, rank = { x: 1, y: 2, g: 3 };
    (G.guesses || []).forEach(function (g) {
      scoreGuess(g, G.word).forEach(function (r, i) { if (!best[g[i]] || rank[r] > rank[best[g[i]]]) best[g[i]] = r; });
    });
    (G.hints || []).forEach(function (i) { best[G.word[i]] = "g"; });
    setTimeout(function () {
      document.querySelectorAll("#kbBoard .key").forEach(function (k) {
        k.classList.remove("g", "y", "x"); if (best[k.dataset.k]) k.classList.add(best[k.dataset.k]);
      });
    }, delay || 0);
  }
  function onBoardKey(k) {
    if (locked || !G || G.phase !== "guessing" || guesser() !== me) return;
    if (k === "back") { cur = cur.slice(0, -1); sfx.key(); renderBoard(); sendTyping(); return; }
    if (k === "enter") return submitGuess();
    if (cur.length < wordLen()) { cur += k; sfx.key(); haptic("light"); renderBoard(); sendTyping(); }
  }
  function shakeRow(msg) {
    var rows = document.querySelectorAll("#grid .row"), row = rows[(G.guesses || []).length];
    if (row) { row.classList.remove("shake"); void row.offsetWidth; row.classList.add("shake"); }
    toast(msg); sfx.bad(); haptic("error");
  }
  function submitGuess() {
    if (cur.length < wordLen()) return shakeRow("Not enough letters");
    if (!VALID.has(cur)) return shakeRow("Not in the word list");
    var rows = (G.guesses || []).concat([cur]), guess = cur, rowIdx = rows.length - 1;
    G.guesses = rows; cur = ""; clearTimeout(typingTimer);
    stopClock(); locked = true; renderBoard(rowIdx);
    var solved = guess === G.word, out = rows.length >= CFG.MAX_GUESSES;
    if (!solved && !out) patch({ guesses: rows, typing: "" });
    setTimeout(function () {
      locked = false;
      if (solved) { var rs = document.querySelectorAll("#grid .row"); rs[rowIdx].classList.add("win"); finish(true); }
      else if (out) finish(false);
      else if (screen === "board") startClock();
    }, 1050);
  }
  function useHint() {
    if (!G || G.phase !== "guessing" || guesser() !== me) return;
    var known = {};
    (G.guesses || []).forEach(function (g) { scoreGuess(g, G.word).forEach(function (r, i) { if (r === "g") known[i] = 1; }); });
    (G.hints || []).forEach(function (i) { known[i] = 1; });
    var open = []; for (var p = 0; p < wordLen(); p++) if (!known[p]) open.push(p);
    if (open.length <= 1) { toast("No more hints — you've got this!"); return; }
    var pick = open[Math.floor(Math.random() * open.length)];
    G.hints = (G.hints || []).concat([pick]);
    patch({ hints: G.hints }); sfx.pop();
    toast("Letter " + (pick + 1) + " revealed (-1 point)");
    renderBoard();
  }
  function finish(solved) {
    stopClock(); clearTimeout(typingTimer);
    var setter = G.setter, rows = G.guesses || [], hints = G.hints || [];
    var tries = solved ? rows.length : 0;
    var pts = solved ? Math.max(0, CFG.MAX_GUESSES + 1 - tries - hints.length) : 0;
    var s = G.s.slice(), r = G.r.slice();
    s[me] += pts; if (!solved) s[setter] += CFG.STUMP_BONUS;
    var rw = -1;
    if (s[me] >= CFG.POINTS_TO_WIN) rw = me; else if (s[setter] >= CFG.POINTS_TO_WIN) rw = setter;
    if (rw >= 0) { r[rw]++; s = [0, 0]; }
    var now = Date.now(), word = G.word;
    var hist = [{ w: word, g: me, t: tries, p: pts, at: now }].concat(G.history || []).slice(0, 40);
    localResult = { w: word, t: tries, p: pts, h: hints.length, rw: rw, s: s };
    sentTaunt = false;
    var fields = {
      s: s, r: r, last: { g: me, w: word, t: tries, p: pts, rw: rw, at: now }, history: hist,
      phase: "setting", setter: me, word: "", clue: "", guesses: [], hints: [], t: G.t + 1,
      typing: "", deadline: 0, clockLeft: 0
    };
    // The round is over: the winner gets to pick the loser's forfeit.
    if (rw >= 0) fields.forfeit = solo ? soloForfeit(rw, now) : { w: rw, l: other(rw), state: "pending", text: "", at: now };
    patch(fields).then(function () {
      notify({ type: "result", w: word, t: tries, p: pts, rw: rw < 0 ? "" : (rw === me ? "sender" : "you") });
    });
    setTimeout(showResult, solved ? 700 : 300);
  }

  /* ---------- RESULT ---------- */
  function showResult() {
    var l = localResult; if (!l) return goHome();
    var solved = l.t > 0;
    $("#rTitle").textContent = solved ? (l.t <= 2 ? "Genius! 🤯" : l.t <= 4 ? "You got it! 🎉" : "Phew, close one! 😅") : "So close… 💔";
    var wr = $("#rWord"); wr.innerHTML = ""; wr.style.setProperty("--cols", l.w.length);
    l.w.split("").forEach(function (ch, i) {
      var t = document.createElement("div"); t.className = "tile flip " + (solved ? "g" : "x");
      t.style.animationDelay = (i * 120) + "ms"; t.textContent = ch; wr.appendChild(t);
    });
    var pb = $("#rPoints");
    pb.className = "points-badge" + (solved ? "" : " lose");
    pb.textContent = solved ? "+" + l.p + " point" + (l.p === 1 ? "" : "s") : "+" + CFG.STUMP_BONUS + " to " + partnerName();
    $("#rSub").textContent = solved ? ("Solved in " + l.t + (l.t === 1 ? " guess" : " guesses") + (l.h ? " with " + l.h + " hint" + (l.h > 1 ? "s" : "") : "")) : "The word was " + l.w.toUpperCase();
    var rr = $("#rRound");
    rr.hidden = !(l.rw >= 0);
    if (l.rw >= 0) rr.textContent = "🏆 " + (l.rw === me ? "You won the round!" : partnerName() + " won the round!") + " Scores reset to 0.";
    $("#rTally").textContent = myName() + " " + l.s[me] + "  ·  " + partnerName() + " " + l.s[other(me)];
    $("#btnNext").textContent = l.rw === me && !solo ? "🎡 Pick " + partnerName() + "'s forfeit" : solo ? "Next: set a word for the bot" : "Your turn: set a word";
    renderTaunts();
    show("result");
    if (solved) { sfx.win(); haptic("success"); confetti(); } else { sfx.lose(); haptic("warning"); }
  }
  function renderTaunts() {
    var box = $("#taunts"); box.innerHTML = "";
    TAUNTS.forEach(function (t, i) {
      var b = document.createElement("button"); b.className = "taunt"; b.type = "button"; b.textContent = t;
      b.addEventListener("click", function () { sendTaunt(i, b); });
      box.appendChild(b);
    });
  }
  function sendTaunt(i, btn) {
    if (!G) return;
    var now = Date.now();
    patch({ taunt: { from: me, i: i, at: now } });
    btn.classList.add("sent"); sfx.pop(); haptic("light");
    toast("Sent to " + partnerName() + " 😏");
    if (!sentTaunt) { sentTaunt = true; notify({ type: "taunt", i: i }); }
  }

  /* ---------- FORFEITS ---------- */
  function forfeitCard() {
    var f = G && G.forfeit, card = $("#forfeitCard"), btn = $("#btnFfAction");
    if (!f || !hasPartner() || (f.state === "done" && Date.now() - (f.doneAt || 0) > 6 * 3600 * 1000)) { card.hidden = true; return; }
    card.hidden = false; btn.hidden = true; card.className = "card forfeit-card " + f.state;
    var winner = f.w === me ? "You" : nameOf(f.w), loser = f.l === me ? "you" : nameOf(f.l);
    if (f.state === "pending") {
      if (f.w === me) {
        $("#ffTitle").textContent = "🏆 You won the round!";
        $("#ffText").textContent = "Now pick " + partnerName() + "'s forfeit 😈";
        btn.hidden = false; btn.textContent = "🎡 Spin the forfeit wheel"; btn.dataset.act = "spin";
      } else {
        $("#ffTitle").textContent = "😬 " + partnerName() + " won the round";
        $("#ffText").textContent = "They're picking your forfeit right now…";
      }
    } else if (f.state === "set") {
      if (f.l === me) {
        $("#ffTitle").textContent = "😈 Your forfeit from " + partnerName();
        $("#ffText").textContent = f.text;
        btn.hidden = false; btn.textContent = "I did it ✅"; btn.dataset.act = "done";
      } else {
        $("#ffTitle").textContent = "💅 " + partnerName() + " owes you";
        $("#ffText").textContent = f.text;
      }
    } else {
      $("#ffTitle").textContent = "✅ " + (f.l === me ? "You" : nameOf(f.l)) + " did the forfeit";
      $("#ffText").textContent = f.text;
    }
  }
  function forfeitAction() {
    var act = $("#btnFfAction").dataset.act;
    if (act === "spin") showWheel();
    else if (act === "done") forfeitDone();
  }

  var spinsLeft = 0, spinning = false, picked = "";
  function showWheel() {
    if (!G || !G.forfeit || G.forfeit.state !== "pending" || G.forfeit.w !== me) { goHome(); return; }
    spinsLeft = CFG.FORFEIT_SPINS; picked = ""; spinning = false;
    $("#wheelTitle").textContent = "Pick " + partnerName() + "'s forfeit";
    $("#wheelSub").textContent = "You get " + spinsLeft + " spins. Or write your own.";
    $("#slotText").textContent = "Tap spin 👇"; $("#slot").className = "slot";
    $("#ownField").hidden = true; $("#inOwn").value = "";
    updateWheelButtons();
    show("forfeit");
  }
  function updateWheelButtons() {
    var own = !$("#ownField").hidden && $("#inOwn").value.trim();
    $("#btnSpin").disabled = spinning || spinsLeft <= 0;
    $("#btnSpin").textContent = spinsLeft === CFG.FORFEIT_SPINS ? "🎰 Spin" : spinsLeft > 0 ? "🎰 Spin again (" + spinsLeft + " left)" : "No spins left";
    $("#btnLock").disabled = spinning || !(own || picked);
  }
  function spin() {
    if (spinning || spinsLeft <= 0) return;
    spinning = true; spinsLeft--; $("#ownField").hidden = true;
    var list = CFG.FORFEITS, slot = $("#slot"), txt = $("#slotText");
    var final = list[Math.floor(Math.random() * list.length)];
    if (final === picked && list.length > 1) final = list[(list.indexOf(final) + 1) % list.length];
    slot.className = "slot spinning"; updateWheelButtons();
    var steps = 18 + Math.floor(Math.random() * 6), i = 0;
    (function tick() {
      i++;
      if (i >= steps) {
        txt.textContent = final; picked = final; spinning = false;
        slot.className = "slot landed"; sfx.win(); haptic("success");
        updateWheelButtons(); return;
      }
      txt.textContent = list[Math.floor(Math.random() * list.length)];
      beep(500 + (i % 2) * 120, 0.03, "triangle", 0.04);
      setTimeout(tick, 50 + Math.pow(i / steps, 3) * 380);
    })();
  }
  function lockForfeit() {
    var own = !$("#ownField").hidden ? $("#inOwn").value.trim().slice(0, 100) : "";
    var text = own || picked;
    if (!text || !G || !G.forfeit) return;
    var f = Object.assign({}, G.forfeit, { state: "set", text: text, setAt: Date.now() });
    G.forfeit = f;
    patch({ forfeit: f }).then(function () {
      notify({ type: "forfeit", text: text });
      toast("Locked in! " + partnerName() + " can see it now 😈");
    });
    sfx.ding(); confetti();
    goHome();
  }
  function forfeitDone() {
    if (!G || !G.forfeit || G.forfeit.l !== me) return;
    var f = Object.assign({}, G.forfeit, { state: "done", doneAt: Date.now() });
    G.forfeit = f;
    patch({ forfeit: f }).then(function () { notify({ type: "forfeit_done", text: f.text }); });
    toast("Nice 😅 " + partnerName() + " will see you did it");
    sfx.ding(); renderHome();
  }

  /* ---------- SOLO MODE (vs the R&B Bot) ----------
   * Same game, but the other player is a bot and the game lives on this phone only.
   * The bot sets words (with clues) and guesses your words live, letter by letter. */
  var BOT = "rnb-bot", BOT_I = 1;
  var solo = false, onlineId = null;
  var ONLINE_NET = NET;
  function clone(x) { return x == null ? x : JSON.parse(JSON.stringify(x)); }
  var SoloNet = (function () {
    var doc = store.get("soloGame", null), cbs = [];
    function emit() { var d = clone(doc); cbs.forEach(function (cb) { setTimeout(function () { cb(clone(d)); }, 0); }); }
    function setPath(o, k, v) {
      var p = k.split("."), x = o;
      for (var i = 0; i < p.length - 1; i++) { x[p[i]] = x[p[i]] || {}; x = x[p[i]]; }
      x[p[p.length - 1]] = v;
    }
    return {
      get: function () { return clone(doc); },
      reset: function () { doc = null; store.set("soloGame", null); },
      ready: function () { return Promise.resolve(uid); },
      create: function (id, data) { doc = clone(data); store.set("soloGame", doc); emit(); return Promise.resolve(); },
      join: function () { return Promise.reject({ code: "not-found" }); },
      watch: function (id, cb) { cbs.push(cb); setTimeout(function () { cb(clone(doc)); }, 0); return function () { cbs = cbs.filter(function (x) { return x !== cb; }); }; },
      patch: function (id, fields) {
        if (!doc) return Promise.reject({ code: "not-found" });
        Object.keys(fields).forEach(function (k) { setPath(doc, k, clone(fields[k])); });
        store.set("soloGame", doc); emit(); return Promise.resolve();
      }
    };
  })();
  function newSoloDoc() {
    var name = store.get("myName", (tgUser && tgUser.first_name) || "You").slice(0, 12) || "You";
    var seen = {}; seen[uid] = Date.now(); seen[BOT] = 9e15;
    return {
      v: 2, solo: true, createdAt: Date.now(), uids: [uid, BOT],
      players: [{ uid: uid, name: name, tg: null }, { uid: BOT, name: CFG.BOT_NAME, tg: null }],
      s: [0, 0], r: [0, 0], t: 0, setter: BOT_I, phase: "setting", word: "", clue: "",
      guesses: [], hints: [], last: null, taunt: null, history: [], seen: seen
    };
  }
  function enterSolo(fresh) {
    stopBot();
    if (!solo) onlineId = gameId;
    if (unsub) { try { unsub(); } catch (e) {} unsub = null; }
    solo = true; NET = SoloNet; G = null;
    var d = SoloNet.get();
    if (fresh || !d || d.uids[0] !== uid) { d = newSoloDoc(); SoloNet.create("solo", d); }
    toast("🤖 Solo mode: you vs the bot");
    watchGame("solo");
  }
  function exitSolo() {
    stopBot();
    if (unsub) { try { unsub(); } catch (e) {} unsub = null; }
    solo = false; NET = ONLINE_NET; G = null; gameId = null;
    if (onlineId) watchGame(onlineId); else goHome();
  }
  function leaveSoloQuietly() {
    store.set("mode", "online");
    if (!solo) return;
    stopBot(); if (unsub) { try { unsub(); } catch (e) {} unsub = null; }
    solo = false; NET = ONLINE_NET;
  }
  function soloForfeit(rw, now) {
    // The bot only hands out dares when it wins a round. If you win, you just get the glory.
    if (rw !== BOT_I) return null;
    var list = CFG.SOLO_DARES;
    return { w: BOT_I, l: 0, state: "set", text: list[Math.floor(Math.random() * list.length)], at: now, setAt: now };
  }

  // --- the bot's brain ---
  var botBusy = false, botTimers = [], poolCache = {};
  function botLater(fn, ms) {
    var t = setTimeout(function () { botTimers = botTimers.filter(function (x) { return x !== t; }); if (solo) fn(); }, ms);
    botTimers.push(t);
  }
  function stopBot() { botTimers.forEach(clearTimeout); botTimers = []; botBusy = false; }
  function botTick() {
    if (!solo || !G || botBusy) return;
    if (G.phase === "setting" && G.setter === BOT_I) { botBusy = true; botLater(botSetWord, 1500); }
    else if (G.phase === "guessing" && guesser() === BOT_I) { botBusy = true; botLater(botGuess, 1200 + Math.random() * 1200); }
  }
  function botSetWord() {
    var used = (G.history || []).map(function (h) { return h.w; });
    var fresh = ANSWERS.filter(function (a) { return used.indexOf(a.w) < 0; });
    var list = fresh.length ? fresh : ANSWERS;
    var pick = list[Math.floor(Math.random() * list.length)];
    NET.patch("solo", { word: pick.w, clue: pick.c, phase: "guessing", guesses: [], hints: [], deadline: 0, clockLeft: 0, typing: "" })
      .then(function () { botBusy = false; });
  }
  function pool(L) {
    if (!poolCache[L]) {
      var common = ANSWERS.filter(function (a) { return a.w.length === L; }).map(function (a) { return a.w; });
      var all = []; VALID.forEach(function (w) { if (w.length === L) all.push(w); });
      poolCache[L] = { common: common, all: all };
    }
    return poolCache[L];
  }
  function sameScore(a, b) { for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; }
  function botChoose() {
    var L = G.word.length, rows = (G.guesses || []).filter(function (g) { return !isBurned(g); }), P = pool(L);
    function pickFrom(list) { return list[Math.floor(Math.random() * list.length)]; }
    if (!rows.length) return pickFrom(P.common.length && Math.random() < .7 ? P.common : P.all);
    var fits = function (w) { return rows.every(function (g) { return sameScore(scoreGuess(g, w), scoreGuess(g, G.word)); }); };
    // The bot isn't perfect: sometimes it only pays attention to the green letters.
    var sloppy = Math.random() < 0.3;
    var greensFit = function (w) { return rows.every(function (g) { var r = scoreGuess(g, G.word); for (var i = 0; i < L; i++) if (r[i] === "g" && w[i] !== g[i]) return false; return true; }); };
    var test = sloppy ? greensFit : fits;
    var common = P.common.filter(test).filter(function (w) { return rows.indexOf(w) < 0; });
    if (common.length && Math.random() < .6) return pickFrom(common);
    var all = P.all.filter(test).filter(function (w) { return rows.indexOf(w) < 0; });
    return all.length ? pickFrom(all) : pickFrom(P.all);
  }
  function botGuess() {
    if (!G || G.phase !== "guessing" || guesser() !== BOT_I) { botBusy = false; return; }
    var guess = botChoose(), L = guess.length;
    // "Type" the guess one letter at a time so you can watch it think.
    for (var i = 1; i <= L; i++) (function (n) { botLater(function () { NET.patch("solo", { typing: guess.slice(0, n) }); }, 260 * n); })(i);
    botLater(function () {
      var rows = (G.guesses || []).concat([guess]);
      var solved = guess === G.word, out = rows.length >= CFG.MAX_GUESSES;
      if (solved || out) { G.guesses = rows; botFinish(solved); }
      else NET.patch("solo", { guesses: rows, typing: "" }).then(function () { botBusy = false; });
    }, 260 * L + 500);
  }
  function botFinish(solved) {
    var g = BOT_I, setter = 0, rows = G.guesses || [];
    var tries = solved ? rows.length : 0;
    var pts = solved ? Math.max(0, CFG.MAX_GUESSES + 1 - tries) : 0;
    var s = G.s.slice(), r = G.r.slice();
    s[g] += pts; if (!solved) s[setter] += CFG.STUMP_BONUS;
    var rw = -1;
    if (s[g] >= CFG.POINTS_TO_WIN) rw = g; else if (s[setter] >= CFG.POINTS_TO_WIN) rw = setter;
    if (rw >= 0) { r[rw]++; s = [0, 0]; }
    var now = Date.now(), word = G.word;
    var lines = solved ? CFG.BOT_TAUNTS_WIN : CFG.BOT_TAUNTS_LOSE;
    var fields = {
      s: s, r: r, last: { g: g, w: word, t: tries, p: pts, rw: rw, at: now },
      history: [{ w: word, g: g, t: tries, p: pts, at: now }].concat(G.history || []).slice(0, 40),
      phase: "setting", setter: g, word: "", clue: "", guesses: [], hints: [], t: G.t + 1,
      typing: "", deadline: 0, clockLeft: 0,
      taunt: { from: g, text: lines[Math.floor(Math.random() * lines.length)], at: now + 1500 }
    };
    if (rw >= 0) fields.forfeit = soloForfeit(rw, now);
    NET.patch("solo", fields).then(function () { botBusy = false; });
  }

  /* ---------- SCOREBOARD ---------- */
  function showScore() {
    if (!G) return;
    var h = G.history || [];
    function statsFor(idx) {
      var mine = h.filter(function (x) { return x.g === idx; });
      var solved = mine.filter(function (x) { return x.t > 0; });
      var streak = 0; for (var i = 0; i < mine.length; i++) { if (mine[i].t > 0) streak++; else break; }
      var avg = solved.length ? (solved.reduce(function (a, x) { return a + x.t; }, 0) / solved.length).toFixed(1) : "–";
      var best = solved.length ? Math.min.apply(null, solved.map(function (x) { return x.t; })) : "–";
      return { played: mine.length, solved: solved.length, streak: streak, avg: avg, best: best };
    }
    var A = statsFor(me), B = statsFor(other(me));
    function bestTxt(v) { return v === "–" ? "–" : v + " guess" + (v === 1 ? "" : "es"); }
    var rows = [
      ["🏆 Round wins", G.r[me], G.r[other(me)]],
      ["⭐ Points this round", G.s[me], G.s[other(me)]],
      ["🔥 Solve streak", A.streak, B.streak],
      ["✅ Words solved", A.solved + "/" + A.played, B.solved + "/" + B.played],
      ["🎯 Avg guesses", A.avg, B.avg],
      ["⚡ Best game", bestTxt(A.best), bestTxt(B.best)]
    ];
    var html = '<div></div><div class="h him">' + esc(myName()) + '</div><div class="h her">' + esc(hasPartner() ? partnerName() : "Partner") + "</div>";
    rows.forEach(function (r) { html += '<div class="lbl">' + r[0] + '</div><div class="v">' + r[1] + '</div><div class="v">' + r[2] + "</div>"; });
    $("#stats").innerHTML = html;
    $("#history").innerHTML = h.length ? h.slice(0, 20).map(function (x) {
      return '<div class="hrow"><span class="hword">' + esc(x.w.toUpperCase()) + '</span><span class="hmeta">' + esc(x.g === me ? "You" : nameOf(x.g)) + " · " + (x.t ? "solved in " + x.t + " (+" + x.p + ")" : "stumped") + "</span></div>";
    }).join("") : '<p class="muted">No words played yet. Go set one! 💌</p>';
    show("score");
  }

  /* ---------- wiring ---------- */
  function on(id, fn) { $(id).addEventListener("click", fn); }
  on("#btnStart", startSetup);
  on("#btnNew", function () {
    if (solo) { if (confirm("Start a fresh solo game against the bot?")) enterSolo(true); return; }
    if (confirm("Start a brand new game? You'll need to invite your partner again.")) startSetup();
  });
  on("#btnSolo1", function () { store.set("mode", "solo"); enterSolo(false); });
  on("#btnSolo2", function () { store.set("mode", "solo"); enterSolo(false); });
  on("#btnExitSolo", function () { store.set("mode", "online"); exitSolo(); });
  on("#btnSetupGo", createGame);
  on("#btnJoin", joinGame);
  on("#btnMain", mainAction);
  on("#btnInvite", shareInvite);
  on("#btnScore", showScore);
  on("#btnSurprise", surprise);
  on("#btnPeek", function () { hideWord = !hideWord; $("#btnPeek").textContent = hideWord ? "👁 Show" : "👁 Hide"; renderEntry(); });
  on("#btnSend", sendWord);
  on("#btnHint", useHint);
  on("#btnNext", function () {
    if (G && G.forfeit && G.forfeit.state === "pending" && G.forfeit.w === me) showWheel(); else startSet();
  });
  on("#btnFfAction", forfeitAction);
  on("#btnSpin", spin);
  on("#btnLock", lockForfeit);
  on("#btnOwnToggle", function () {
    var f = $("#ownField"); f.hidden = !f.hidden;
    if (!f.hidden) setTimeout(function () { $("#inOwn").focus(); }, 50);
    updateWheelButtons();
  });
  $("#inOwn").addEventListener("input", updateWheelButtons);
  $("#inClue").addEventListener("input", function () {
    clueSource = this.value.trim() ? "user" : ""; clueFor = setWord;
    $("#clueNote").textContent = "";
  });
  on("#btnBack", goHome);
  on("#btnSound", function () {
    muted = !muted; store.set("muted", muted);
    $("#btnSound").innerHTML = muted ? "&#128263;" : "&#128266;"; if (!muted) sfx.pop();
  });
  $("#btnSound").innerHTML = muted ? "&#128263;" : "&#128266;";

  fitScreen();
  if (tg) {
    try {
      tg.ready(); tg.expand();
      if (tg.setHeaderColor) tg.setHeaderColor("#2b0f4c");
      if (tg.setBackgroundColor) tg.setBackgroundColor("#2b0f4c");
      if (tg.disableVerticalSwipes) tg.disableVerticalSwipes();
      if (tg.BackButton) tg.BackButton.onClick(goHome);
    } catch (e) {}
  }

  /* ---------- start ---------- */
  function boot() {
    if (!NET) { $("#loadingMsg").textContent = "Couldn't load the game. Please reopen it."; return; }
    NET.ready().then(function (id) {
      uid = id;
      var sp = startParam();
      if (sp && sp.indexOf("j_") === 0) {
        var rest = sp.slice(2), cut = rest.indexOf("_");
        var id2 = cut > 0 ? rest.slice(0, cut) : rest, inviter = cut > 0 ? unb64url(rest.slice(cut + 1)) : "";
        if (id2 && id2 !== gameId) { showJoin(id2, inviter); return; }
      }
      if (store.get("mode", "online") === "solo") enterSolo(false);
      else if (gameId) watchGame(gameId); else goHome();
    }).catch(function (e) {
      console.warn(e);
      $("#loadingMsg").textContent = "Couldn't connect. Check your internet and reopen the game.";
    });
  }
  boot();
})();
