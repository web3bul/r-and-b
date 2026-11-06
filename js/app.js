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
    var canBack = id === "score" || id === "setup" || (id === "set" && G && G.t > 0) || id === "board";
    $("#btnBack").hidden = !canBack;
    if (tg && tg.BackButton) { try { canBack ? tg.BackButton.show() : tg.BackButton.hide(); } catch (e) {} }
    if (id !== "set" && id !== "board") activeKeyHandler = null;
    if (id !== "board" && clockTimer) {
      stopClock(); clearTimeout(typingTimer);
      if (G && G.phase === "guessing" && guesser() === me) NET.patch(gameId, { typing: "", deadline: 0 }).catch(function () {});
    }
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
    var res = ["x", "x", "x", "x", "x"], left = {};
    for (var i = 0; i < 5; i++) {
      if (guess[i] === answer[i]) res[i] = "g";
      else left[answer[i]] = (left[answer[i]] || 0) + 1;
    }
    for (var j = 0; j < 5; j++) {
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

    // Status + main button
    var status = $("#status"), btn = $("#btnMain"), title = $("#mainTitle"), sub = $("#mainSub");
    var live = $("#liveCard");
    status.classList.remove("go"); btn.disabled = false; live.hidden = true;
    $("#btnInvite").hidden = partner;

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
        sub.textContent = (CFG.MAX_GUESSES - (G.guesses || []).length) + " guesses left" + (G.clue ? " · clue inside" : "");
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
    var rows = G.guesses || [], typing = (G.typing || "").slice(0, 5);
    $("#liveTitle").textContent = typing
      ? partnerName() + " is typing… ✍️"
      : rows.length
        ? partnerName() + " has used " + rows.length + " of " + CFG.MAX_GUESSES + " guesses" + ((G.hints || []).length ? " (+" + G.hints.length + " hint)" : "")
        : partnerName() + " is thinking… 🤔";
    grid.innerHTML = "";
    for (var r = 0; r < CFG.MAX_GUESSES; r++) {
      var row = document.createElement("div"); row.className = "mini-row";
      var res = rows[r] ? scoreGuess(rows[r], G.word) : null;
      for (var c = 0; c < 5; c++) {
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
    gameId = id; store.set("gameId", id);
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
      if (Date.now() - G.taunt.at < 10 * 60 * 1000) { bubble(partnerName() + " says", TAUNTS[G.taunt.i] || ""); sfx.pop(); haptic("light"); }
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
    }
    if (first && ["loading", "join", "setup", "home"].indexOf(screen) >= 0) goHome();
    else if (screen === "home") renderHome();
    if (first) heartbeat();
  }

  /* ---------- presence ---------- */
  function heartbeat() {
    if (!gameId || !uid || document.hidden) return;
    var f = {}; f["seen." + uid] = Date.now(); NET.patch(gameId, f).catch(function () {});
  }
  setInterval(function () { heartbeat(); if (screen === "home" && G) renderHome(); }, 20000);
  document.addEventListener("visibilitychange", function () {
    if (!gameId || !uid) return;
    var f = {}; f["seen." + uid] = document.hidden ? 0 : Date.now();
    NET.patch(gameId, f).catch(function () {});
  });

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
  function renderEntry() {
    var e = $("#entry"); e.innerHTML = "";
    for (var i = 0; i < 5; i++) {
      var t = document.createElement("div"); t.className = "tile" + (setWord[i] ? " filled" : "");
      t.textContent = setWord[i] || ""; e.appendChild(t);
    }
    e.classList.toggle("hidden-word", hideWord);
    var msg = $("#entryMsg"), ok = setWord.length === 5 && VALID.has(setWord);
    msg.className = "entry-msg";
    if (setWord.length < 5) msg.textContent = "Type a five-letter word";
    else if (ok) { msg.textContent = "✓ Valid word"; msg.classList.add("ok"); }
    else { msg.textContent = "Not in the word list"; msg.classList.add("bad"); }
    $("#btnSend").disabled = !ok;
  }
  function onSetKey(k) {
    if (k === "back") setWord = setWord.slice(0, -1);
    else if (k === "enter") { if (!$("#btnSend").disabled) sendWord(); return; }
    else if (setWord.length < 5) setWord += k;
    sfx.key(); haptic("light"); renderEntry();
  }
  function startSet() {
    if (!G || G.phase !== "setting" || G.setter !== me) { goHome(); return; }
    setWord = ""; hideWord = false; $("#inClue").value = "";
    $("#btnPeek").textContent = "👁 Hide";
    $("#setTitle").textContent = "Set a word for " + (hasPartner() ? partnerName() : "your partner");
    buildKeyboard($("#kbSet"), onSetKey);
    renderEntry(); show("set");
    activeKeyHandler = onSetKey;
  }
  function surprise() {
    var pick = ANSWERS[Math.floor(Math.random() * ANSWERS.length)];
    setWord = pick.w; $("#inClue").value = pick.c;
    sfx.pop(); renderEntry();
  }
  function sendWord() {
    if (setWord.length !== 5 || !VALID.has(setWord) || !G) return;
    var clue = $("#inClue").value.trim().slice(0, 60);
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
    $("#bFor").textContent = "Guess " + partnerName() + "'s word";
    var cb = $("#bClue"); cb.hidden = !G.clue; cb.textContent = "Clue: " + G.clue;
    buildKeyboard($("#kbBoard"), onBoardKey);
    renderBoard(); show("board");
    activeKeyHandler = onBoardKey;
    startClock();
  }

  /* ---------- guess clock ---------- */
  var clockTimer = null, deadline = 0, lastTickSec = -1;
  function startClock() {
    stopClock();
    deadline = Date.now() + CFG.GUESS_SECONDS * 1000; lastTickSec = -1;
    patch({ deadline: deadline, typing: "" });
    renderClock();
    clockTimer = setInterval(renderClock, 200);
  }
  function stopClock() {
    if (clockTimer) clearInterval(clockTimer);
    clockTimer = null;
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
    var rows = (G.guesses || []).concat(["....."]), rowIdx = rows.length - 1;
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
    var rows = G.guesses || [], hints = G.hints || [], grid = $("#grid"); grid.innerHTML = "";
    for (var r = 0; r < CFG.MAX_GUESSES; r++) {
      var row = document.createElement("div"); row.className = "row";
      var done = rows[r], res = done ? scoreGuess(done, G.word) : null;
      for (var c = 0; c < 5; c++) {
        var t = document.createElement("div"); t.className = "tile";
        if (done) {
          t.textContent = done[c] === "." ? "" : done[c];
          if (done === ".....") t.classList.add("burned");
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
  }
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
    if (cur.length < 5) { cur += k; sfx.key(); haptic("light"); renderBoard(); sendTyping(); }
  }
  function shakeRow(msg) {
    var rows = document.querySelectorAll("#grid .row"), row = rows[(G.guesses || []).length];
    if (row) { row.classList.remove("shake"); void row.offsetWidth; row.classList.add("shake"); }
    toast(msg); sfx.bad(); haptic("error");
  }
  function submitGuess() {
    if (cur.length < 5) return shakeRow("Not enough letters");
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
    var open = [0, 1, 2, 3, 4].filter(function (i) { return !known[i]; });
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
    patch({
      s: s, r: r, last: { g: me, w: word, t: tries, p: pts, rw: rw, at: now }, history: hist,
      phase: "setting", setter: me, word: "", clue: "", guesses: [], hints: [], t: G.t + 1,
      typing: "", deadline: 0
    }).then(function () {
      notify({ type: "result", w: word, t: tries, p: pts, rw: rw < 0 ? "" : (rw === me ? "sender" : "you") });
    });
    setTimeout(showResult, solved ? 700 : 300);
  }

  /* ---------- RESULT ---------- */
  function showResult() {
    var l = localResult; if (!l) return goHome();
    var solved = l.t > 0;
    $("#rTitle").textContent = solved ? (l.t <= 2 ? "Genius! 🤯" : l.t <= 4 ? "You got it! 🎉" : "Phew, close one! 😅") : "So close… 💔";
    var wr = $("#rWord"); wr.innerHTML = "";
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
  on("#btnNew", function () { if (confirm("Start a brand new game? You'll need to invite your partner again.")) startSetup(); });
  on("#btnSetupGo", createGame);
  on("#btnJoin", joinGame);
  on("#btnMain", mainAction);
  on("#btnInvite", shareInvite);
  on("#btnScore", showScore);
  on("#btnSurprise", surprise);
  on("#btnPeek", function () { hideWord = !hideWord; $("#btnPeek").textContent = hideWord ? "👁 Show" : "👁 Hide"; renderEntry(); });
  on("#btnSend", sendWord);
  on("#btnHint", useHint);
  on("#btnNext", startSet);
  on("#btnBack", goHome);
  on("#btnSound", function () {
    muted = !muted; store.set("muted", muted);
    $("#btnSound").innerHTML = muted ? "&#128263;" : "&#128266;"; if (!muted) sfx.pop();
  });
  $("#btnSound").innerHTML = muted ? "&#128263;" : "&#128266;";

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
      if (gameId) watchGame(gameId); else goHome();
    }).catch(function (e) {
      console.warn(e);
      $("#loadingMsg").textContent = "Couldn't connect. Check your internet and reopen the game.";
    });
  }
  boot();
})();
