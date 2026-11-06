/* R & B — a Wordle-style word game for two, built as a Telegram Mini App.
 * No server needed: each turn's game state travels inside the shared link
 * (lightly scrambled so the secret word isn't readable in the link). */
(function () {
  "use strict";

  var CFG = window.RB_CONFIG;
  var ANSWERS = window.RB_ANSWERS;
  var VALID = new Set(window.RB_VALID);
  ANSWERS.forEach(function (a) { VALID.add(a.w); });

  var tg = window.Telegram && window.Telegram.WebApp;
  var inTelegram = !!(tg && tg.initData);
  var TAUNTS = ["Too easy! 😎", "Bet you can't beat that 😏", "Your move, babe 💅", "Try to keep up 🏃‍♀️", "I'm built different 💪", "Okay, you got me 😅", "Rematch? 🔥", "Love you, loser 💜"];
  var SCRAMBLE = "R&B-love-game";
  var $ = function (s) { return document.querySelector(s); };

  /* ---------- storage ---------- */
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem("rb_" + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem("rb_" + k, JSON.stringify(v)); } catch (e) {} }
  };

  /* ---------- link encoding ---------- */
  function encode(obj) {
    var bytes = new TextEncoder().encode(JSON.stringify(obj));
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i] ^ SCRAMBLE.charCodeAt(i % SCRAMBLE.length));
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function decode(str) {
    try {
      var s = str.replace(/-/g, "+").replace(/_/g, "/");
      while (s.length % 4) s += "=";
      var bin = atob(s), bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) ^ SCRAMBLE.charCodeAt(i % SCRAMBLE.length);
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch (e) { return null; }
  }
  function linkFor(payload) {
    if (CFG.BOT_USERNAME && CFG.APP_SHORT_NAME) {
      return "https://t.me/" + CFG.BOT_USERNAME + "/" + CFG.APP_SHORT_NAME + "?startapp=" + payload;
    }
    return location.origin + location.pathname + "?g=" + payload;
  }
  function incomingPayload() {
    var p = tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param;
    if (p) return p;
    var q = new URLSearchParams(location.search);
    return q.get("tgWebAppStartParam") || q.get("g");
  }

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

  /* ---------- toast + confetti ---------- */
  var toastTimer;
  function toast(msg) {
    var t = $("#toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2200);
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

  /* ---------- game state ---------- */
  // saved = { st: game state, me: my player index, phase: "set"|"wait"|"guess"|"result",
  //           board: {rows:[], hints:[]}, last: my last result, out: last payload sent }
  var saved = store.get("game", null);
  function save() { store.set("game", saved); }
  function other(i) { return i === 0 ? 1 : 0; }
  function myName() { return saved.st.n[saved.me]; }
  function theirName() { return saved.st.n[other(saved.me)]; }

  function addHistory(entry) {
    var h = store.get("history", []);
    if (h.some(function (x) { return x.k === entry.k; })) return;
    h.unshift(entry); store.set("history", h.slice(0, 60));
  }

  /* ---------- screens ---------- */
  var current = "home";
  function show(id) {
    document.querySelectorAll(".screen").forEach(function (s) { s.classList.toggle("active", s.id === id); });
    current = id;
    var canBack = id === "score" || id === "setup" || (id === "set" && saved && saved.phase === "set" && saved.st.t > 0);
    $("#btnBack").hidden = !canBack;
    if (tg && tg.BackButton) { canBack ? tg.BackButton.show() : tg.BackButton.hide(); }
    window.scrollTo(0, 0);
  }
  function goBack() { renderHome(); show("home"); }

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

  /* ---------- HOME ---------- */
  function renderHome() {
    activeKeyHandler = null;
    $(".ptw") && document.querySelectorAll(".ptw").forEach(function (x) { x.textContent = CFG.POINTS_TO_WIN; });
    if (!saved) { $("#homeEmpty").hidden = false; $("#homeGame").hidden = true; return; }
    $("#homeEmpty").hidden = true; $("#homeGame").hidden = false;
    var st = saved.st, a = saved.me, b = other(a);
    $("#nameA").textContent = st.n[a]; $("#nameB").textContent = st.n[b];
    $("#avA").textContent = (st.n[a] || "?")[0].toUpperCase();
    $("#avB").textContent = (st.n[b] || "?")[0].toUpperCase();
    $("#roundsA").textContent = st.r[a]; $("#roundsB").textContent = st.r[b];
    $("#ptsA").textContent = st.s[a]; $("#ptsB").textContent = st.s[b];
    setTimeout(function () {
      $("#barA").style.width = Math.min(100, st.s[a] / CFG.POINTS_TO_WIN * 100) + "%";
      $("#barB").style.width = Math.min(100, st.s[b] / CFG.POINTS_TO_WIN * 100) + "%";
    }, 60);

    var status = $("#status"), btn = $("#btnTakeTurns"), hint = $("#ttHint");
    status.classList.remove("go"); btn.disabled = false; $("#btnResend").hidden = true;
    if (saved.phase === "guess") {
      status.textContent = "Your turn to guess!"; status.classList.add("go");
      hint.textContent = "Solve " + theirName() + "'s word";
    } else if (saved.phase === "set" || saved.phase === "result") {
      status.textContent = "Your turn to set a word"; status.classList.add("go");
      hint.textContent = "Set a word for " + theirName();
    } else {
      status.textContent = "Waiting for " + theirName() + "… ⏳";
      hint.textContent = "It's " + theirName() + "'s move";
      btn.disabled = true; $("#btnResend").hidden = !saved.out;
    }
  }
  function takeTurns() {
    if (!saved) return;
    if (saved.phase === "guess") startBoard();
    else if (saved.phase === "result") showResult();
    else if (saved.phase === "set") startSet();
  }

  /* ---------- SETUP ---------- */
  function startSetup() {
    var tgName = tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.first_name;
    $("#inMe").value = store.get("myName", tgName || "");
    $("#inThem").value = "";
    show("setup");
  }
  function finishSetup() {
    var me = $("#inMe").value.trim().slice(0, 12), them = $("#inThem").value.trim().slice(0, 12);
    if (!me || !them) { toast("Add both names first 💜"); return; }
    store.set("myName", me);
    saved = {
      st: { id: Math.random().toString(36).slice(2, 8), n: [me, them], s: [0, 0], r: [0, 0], t: 0, b: 0, w: "", c: "", l: null, m: -1 },
      me: 0, phase: "set", board: null, last: null, out: null
    };
    save(); startSet();
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
    setWord = ""; hideWord = false; $("#inClue").value = "";
    $("#btnPeek").textContent = "👁 Hide";
    $("#setTitle").textContent = "Set a word for " + theirName();
    buildKeyboard($("#kbSet"), onSetKey);
    activeKeyHandler = onSetKey;
    renderEntry(); show("set");
  }
  function surprise() {
    var pick = ANSWERS[Math.floor(Math.random() * ANSWERS.length)];
    setWord = pick.w; $("#inClue").value = pick.c;
    sfx.pop(); renderEntry();
  }
  function sendWord() {
    if (setWord.length !== 5 || !VALID.has(setWord)) return;
    var st = saved.st;
    var next = {
      id: st.id, n: st.n, s: st.s, r: st.r, t: st.t + 1, b: saved.me,
      w: setWord, c: $("#inClue").value.trim().slice(0, 60),
      l: saved.last, m: saved.taunt == null ? -1 : saved.taunt
    };
    var payload = encode(next);
    saved.st = next; saved.phase = "wait"; saved.out = payload; saved.last = null; saved.taunt = null; saved.board = null;
    save();
    shareLink(payload);
    renderHome(); show("home");
  }
  function shareLink(payload) {
    var link = linkFor(payload);
    var text = "💜 " + myName() + " set you a word in R & B! Tap to play 👇";
    if (inTelegram) {
      tg.openTelegramLink("https://t.me/share/url?url=" + encodeURIComponent(link) + "&text=" + encodeURIComponent(text));
    } else if (navigator.share) {
      navigator.share({ title: "R & B", text: text, url: link }).catch(function () { copy(link); });
    } else copy(link);
  }
  function copy(text) {
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { toast("Link copied! Send it to " + theirName() + " 💌"); }, function () { prompt("Copy this link:", text); });
    else prompt("Copy this link:", text);
  }

  /* ---------- INCOMING ---------- */
  function lastResultText(st, l) {
    if (!l) return "";
    var g = st.n[l.g], s = st.n[other(l.g)], w = l.w.toUpperCase();
    var line = l.t ? "<b>" + esc(g) + "</b> solved <b>" + w + "</b> in " + l.t + (l.t === 1 ? " guess" : " guesses") + " (+" + l.p + ")"
      : "<b>" + esc(g) + "</b> couldn't get <b>" + w + "</b>. +" + CFG.STUMP_BONUS + " to " + esc(s) + " 😈";
    if (l.rw != null && l.rw >= 0) line += "<br>🏆 <b>" + esc(st.n[l.rw]) + "</b> won the round!";
    return line;
  }
  function showIncoming() {
    var st = saved.st;
    $("#inTitle").textContent = st.n[st.b] + " set you a word!";
    var lc = $("#inLast"); lc.hidden = !st.l; lc.innerHTML = lastResultText(st, st.l);
    var tb = $("#inTaunt"); tb.hidden = !(st.m >= 0); tb.textContent = st.m >= 0 ? "“" + TAUNTS[st.m] + "”" : "";
    var cb = $("#incClue"); cb.hidden = !st.c; cb.textContent = "Clue: " + st.c;
    show("incoming");
    if (st.l && st.l.rw >= 0) confetti();
  }

  /* ---------- BOARD ---------- */
  var cur = "";
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
  function startBoard() {
    var st = saved.st;
    if (!saved.board) saved.board = { rows: [], hints: [] };
    cur = "";
    $("#bFor").textContent = "Guess " + st.n[st.b] + "'s word";
    var cb = $("#bClue"); cb.hidden = !st.c; cb.textContent = "Clue: " + st.c;
    buildKeyboard($("#kbBoard"), onBoardKey);
    activeKeyHandler = onBoardKey;
    renderBoard(); show("board");
  }
  function renderBoard(animateRow) {
    var st = saved.st, bd = saved.board, grid = $("#grid"); grid.innerHTML = "";
    for (var r = 0; r < CFG.MAX_GUESSES; r++) {
      var row = document.createElement("div"); row.className = "row";
      var done = bd.rows[r], res = done ? scoreGuess(done, st.w) : null;
      for (var c = 0; c < 5; c++) {
        var t = document.createElement("div"); t.className = "tile";
        if (done) {
          t.textContent = done[c];
          if (r === animateRow) {
            (function (tile, cls, delay) {
              tile.style.animationDelay = delay + "ms"; tile.classList.add("flip");
              setTimeout(function () { tile.classList.add(cls); sfx.key(); }, delay + 250);
            })(t, res[c], c * 160);
          } else t.classList.add(res[c]);
        } else if (r === bd.rows.length) {
          if (cur[c]) { t.textContent = cur[c]; t.classList.add("filled"); }
          else if (bd.hints.indexOf(c) >= 0) { t.classList.add("hint-slot"); t.innerHTML = '<span class="hl">' + st.w[c] + "</span>"; }
        }
        row.appendChild(t);
      }
      grid.appendChild(row);
    }
    paintKeys(animateRow != null ? 1100 : 0);
  }
  function paintKeys(delay) {
    var st = saved.st, best = {}, rank = { x: 1, y: 2, g: 3 };
    saved.board.rows.forEach(function (g) {
      scoreGuess(g, st.w).forEach(function (r, i) { if (!best[g[i]] || rank[r] > rank[best[g[i]]]) best[g[i]] = r; });
    });
    saved.board.hints.forEach(function (i) { best[st.w[i]] = "g"; });
    setTimeout(function () {
      document.querySelectorAll("#kbBoard .key").forEach(function (k) {
        k.classList.remove("g", "y", "x"); if (best[k.dataset.k]) k.classList.add(best[k.dataset.k]);
      });
    }, delay || 0);
  }
  var locked = false;
  function onBoardKey(k) {
    if (locked || saved.phase !== "guess") return;
    var bd = saved.board;
    if (k === "back") { cur = cur.slice(0, -1); sfx.key(); renderBoard(); return; }
    if (k === "enter") return submitGuess();
    if (cur.length < 5) { cur += k; sfx.key(); haptic("light"); renderBoard(); }
  }
  function shakeRow(msg) {
    var rows = document.querySelectorAll("#grid .row"), row = rows[saved.board.rows.length];
    if (row) { row.classList.remove("shake"); void row.offsetWidth; row.classList.add("shake"); }
    toast(msg); sfx.bad(); haptic("error");
  }
  function submitGuess() {
    var st = saved.st, bd = saved.board;
    if (cur.length < 5) return shakeRow("Not enough letters");
    if (!VALID.has(cur)) return shakeRow("Not in the word list");
    bd.rows.push(cur); var rowIdx = bd.rows.length - 1, guess = cur; cur = ""; save();
    locked = true; renderBoard(rowIdx);
    setTimeout(function () {
      locked = false;
      if (guess === st.w) {
        var rows = document.querySelectorAll("#grid .row"); rows[rowIdx].classList.add("win");
        finish(true);
      } else if (bd.rows.length >= CFG.MAX_GUESSES) finish(false);
    }, 1050);
  }
  function useHint() {
    if (saved.phase !== "guess") return;
    var st = saved.st, bd = saved.board, known = {};
    bd.rows.forEach(function (g) { scoreGuess(g, st.w).forEach(function (r, i) { if (r === "g") known[i] = 1; }); });
    bd.hints.forEach(function (i) { known[i] = 1; });
    var open = [0, 1, 2, 3, 4].filter(function (i) { return !known[i]; });
    if (open.length <= 1) { toast("No more hints — you've got this!"); return; }
    var pick = open[Math.floor(Math.random() * open.length)];
    bd.hints.push(pick); save(); sfx.pop();
    toast("Letter " + (pick + 1) + " revealed (-1 point)");
    renderBoard();
  }

  function finish(solved) {
    var st = saved.st, me = saved.me, setter = st.b, bd = saved.board;
    var tries = solved ? bd.rows.length : 0;
    var pts = solved ? Math.max(0, CFG.MAX_GUESSES + 1 - tries - bd.hints.length) : 0;
    var s = st.s.slice(), r = st.r.slice();
    s[me] += pts; if (!solved) s[setter] += CFG.STUMP_BONUS;
    var rw = -1;
    if (s[me] >= CFG.POINTS_TO_WIN) rw = me; else if (s[setter] >= CFG.POINTS_TO_WIN) rw = setter;
    if (rw >= 0) { r[rw]++; s = [0, 0]; }
    st.s = s; st.r = r;
    saved.last = { g: me, w: st.w, t: tries, p: pts, h: bd.hints.length, rw: rw };
    saved.phase = "result"; saved.taunt = null; save();
    addHistory({ k: st.id + ":" + st.t, w: st.w, g: st.n[me], t: tries, p: pts, at: Date.now() });
    setTimeout(showResult, solved ? 700 : 300);
  }

  /* ---------- RESULT ---------- */
  function showResult() {
    var st = saved.st, l = saved.last, me = saved.me;
    activeKeyHandler = null;
    var solved = l.t > 0;
    $("#rTitle").textContent = solved ? (l.t <= 2 ? "Genius! 🤯" : l.t <= 4 ? "You got it! 🎉" : "Phew, close one! 😅") : "So close… 💔";
    var wr = $("#rWord"); wr.innerHTML = "";
    l.w.split("").forEach(function (ch, i) {
      var t = document.createElement("div"); t.className = "tile flip " + (solved ? "g" : "x");
      t.style.animationDelay = (i * 120) + "ms"; t.textContent = ch; wr.appendChild(t);
    });
    var pb = $("#rPoints");
    pb.className = "points-badge" + (solved ? "" : " lose");
    pb.textContent = solved ? "+" + l.p + " point" + (l.p === 1 ? "" : "s") : "+" + CFG.STUMP_BONUS + " to " + theirName();
    $("#rSub").textContent = solved ? ("Solved in " + l.t + (l.t === 1 ? " guess" : " guesses") + (l.h ? " with " + l.h + " hint" + (l.h > 1 ? "s" : "") : "")) : "The word was " + l.w.toUpperCase();
    var rr = $("#rRound");
    rr.hidden = !(l.rw >= 0);
    if (l.rw >= 0) rr.textContent = "🏆 " + (l.rw === me ? "You won the round!" : st.n[l.rw] + " won the round!") + " Scores reset to 0.";
    $("#rTally").textContent = st.n[me] + " " + st.s[me] + "  ·  " + st.n[other(me)] + " " + st.s[other(me)];
    renderTaunts();
    show("result");
    if (solved) { sfx.win(); haptic("success"); confetti(); } else { sfx.lose(); haptic("warning"); }
  }
  function renderTaunts() {
    var box = $("#taunts"); box.innerHTML = "";
    TAUNTS.forEach(function (t, i) {
      var b = document.createElement("button"); b.className = "taunt" + (saved.taunt === i ? " on" : ""); b.type = "button"; b.textContent = t;
      b.addEventListener("click", function () { saved.taunt = saved.taunt === i ? null : i; save(); sfx.pop(); renderTaunts(); });
      box.appendChild(b);
    });
  }

  /* ---------- SCOREBOARD ---------- */
  function showScore() {
    var st = saved && saved.st, h = store.get("history", []);
    var names = st ? [st.n[saved.me], st.n[other(saved.me)]] : ["You", "Partner"];
    function statsFor(name) {
      var mine = h.filter(function (x) { return x.g === name; });
      var solved = mine.filter(function (x) { return x.t > 0; });
      var streak = 0; for (var i = 0; i < mine.length; i++) { if (mine[i].t > 0) streak++; else break; }
      var avg = solved.length ? (solved.reduce(function (a, x) { return a + x.t; }, 0) / solved.length).toFixed(1) : "–";
      var best = solved.length ? Math.min.apply(null, solved.map(function (x) { return x.t; })) : "–";
      return { played: mine.length, solved: solved.length, streak: streak, avg: avg, best: best };
    }
    var A = statsFor(names[0]), B = statsFor(names[1]);
    var rows = [
      ["🏆 Round wins", st ? st.r[saved.me] : 0, st ? st.r[other(saved.me)] : 0],
      ["⭐ Points this round", st ? st.s[saved.me] : 0, st ? st.s[other(saved.me)] : 0],
      ["🔥 Solve streak", A.streak, B.streak],
      ["✅ Words solved", A.solved + "/" + A.played, B.solved + "/" + B.played],
      ["🎯 Avg guesses", A.avg, B.avg],
      ["⚡ Best game", A.best === "–" ? "–" : A.best + " guess" + (A.best === 1 ? "" : "es"), B.best === "–" ? "–" : B.best + " guess" + (B.best === 1 ? "" : "es")]
    ];
    var html = '<div></div><div class="h him">' + esc(names[0]) + '</div><div class="h her">' + esc(names[1]) + "</div>";
    rows.forEach(function (r) { html += '<div class="lbl">' + r[0] + '</div><div class="v">' + r[1] + '</div><div class="v">' + r[2] + "</div>"; });
    $("#stats").innerHTML = html;
    var hist = $("#history");
    hist.innerHTML = h.length ? h.slice(0, 20).map(function (x) {
      return '<div class="hrow"><span class="hword">' + x.w.toUpperCase() + '</span><span class="hmeta">' + esc(x.g) + " · " + (x.t ? "solved in " + x.t + " (+" + x.p + ")" : "stumped") + "</span></div>";
    }).join("") : '<p class="muted">No words played yet. Go set one! 💌</p>';
    show("score");
  }

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  /* ---------- incoming link handling ---------- */
  function handleIncoming() {
    var raw = incomingPayload();
    if (!raw) return false;
    var st = decode(raw);
    if (!st || !st.w || !st.n || st.b == null) return false;
    var me = other(st.b);
    // Already handled this turn (e.g. reopened the same link)? Just show home.
    if (saved && saved.st.id === st.id && saved.st.t >= st.t) return false;
    if (st.l) addHistory({ k: st.id + ":" + (st.t - 1), w: st.l.w, g: st.n[st.l.g], t: st.l.t, p: st.l.p, at: Date.now() });
    if (!store.get("myName", "")) store.set("myName", st.n[me]);
    saved = { st: st, me: me, phase: "guess", board: null, last: null, out: null, taunt: null };
    save();
    showIncoming();
    return true;
  }

  /* ---------- wiring ---------- */
  function on(id, fn) { $(id).addEventListener("click", fn); }
  on("#btnStart", startSetup);
  on("#btnNew", function () { if (confirm("Start a brand new game? Current scores will be cleared.")) { startSetup(); } });
  on("#btnSetupGo", finishSetup);
  on("#btnTakeTurns", takeTurns);
  on("#btnScore", showScore);
  on("#btnResend", function () { if (saved && saved.out) shareLink(saved.out); });
  on("#btnSurprise", surprise);
  on("#btnPeek", function () { hideWord = !hideWord; $("#btnPeek").textContent = hideWord ? "👁 Show" : "👁 Hide"; renderEntry(); });
  on("#btnSend", sendWord);
  on("#btnPlay", startBoard);
  on("#btnHint", useHint);
  on("#btnNext", startSet);
  on("#btnBack", goBack);
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
      if (tg.BackButton) tg.BackButton.onClick(goBack);
    } catch (e) {}
  }

  renderHome();
  if (!handleIncoming()) show("home");
})();
