/* R & B — Live Duel.
 * Both players guess at the same time. Two modes:
 *   "same": the game picks one word and both race to solve it.
 *   "each": each player sets a secret word for the other, then they race.
 * First to solve wins. If nobody solves it, whoever got closest wins (greens, then yellows).
 * All duel state lives in G.duel inside the shared game document. */
window.RBDuel = function (A) {
  "use strict";
  var $ = function (s) { return document.querySelector(s); };
  var CFG = A.CFG;
  var mode = "same";          // choice on the setup screen
  var cdFor = null;           // duel id we've already run the countdown for
  var live = false;           // racing right now on this phone
  var cur = "", locked = false;
  var clock = null, deadline = 0, lastTick = -1;
  var shownResultFor = null;

  function D() { var G = A.G(); return G && G.duel; }
  function me() { return A.me(); }
  function opp() { return A.other(A.me()); }
  function active(d) { return d && ["invite", "setting", "countdown", "live"].indexOf(d.state) >= 0; }
  function myWord(d) { return d.mode === "same" ? d.word : (d.words || {})[me()] || ""; }
  function oppWord(d) { return d.mode === "same" ? d.word : (d.words || {})[opp()] || ""; }
  function myClue(d) { return d.mode === "same" ? d.clue : (d.clues || {})[me()] || ""; }
  function rowsOf(d, i) { return ((d.rows || {})[i]) || []; }
  function finOf(d, i) { return (d.fin || {})[i] || null; }
  function k(path, i) { return "duel." + path + "." + i; }

  /* ---------- home ---------- */
  function homeButton() {
    var b = $("#btnDuel"), sub = $("#duelSub"), d = D();
    if (A.solo()) { b.disabled = true; sub.textContent = "Play with your partner to duel"; return; }
    if (!A.hasPartner()) { b.disabled = true; sub.textContent = "Invite your partner first"; return; }
    if (d && (d.state === "countdown" || d.state === "live")) { b.disabled = false; sub.textContent = "Duel in progress. Jump back in!"; return; }
    b.disabled = active(d);
    sub.textContent = active(d) ? "Duel waiting below 👆" : "Race " + A.partnerName() + " live ⚡";
  }
  function onHomeButton() {
    var d = D();
    if (d && (d.state === "countdown" || d.state === "live")) openRace(false);
    else openSetup(d && d.mode);
  }
  function renderCard() {
    homeButton();
    var d = D(), card = $("#duelCard"), b1 = $("#btnDc1"), b2 = $("#btnDc2");
    if (A.solo() || !d || !active(d)) { card.hidden = true; return; }
    card.hidden = false; card.classList.remove("hot"); b1.hidden = true; b2.hidden = true;
    var them = A.partnerName(), modeTxt = d.mode === "same" ? "🎯 same word" : "💌 each other's words";
    if (d.state === "invite") {
      if (d.by === me()) {
        $("#dcTitle").textContent = "⚡ Challenge sent";
        $("#dcText").textContent = "Waiting for " + them + " to accept (" + modeTxt + ")…";
        b2.hidden = false; b2.textContent = "Cancel"; b2.dataset.act = "cancel";
      } else {
        card.classList.add("hot");
        $("#dcTitle").textContent = "⚡ " + them + " challenged you!";
        $("#dcText").textContent = "Live Duel · " + modeTxt + (d.stake ? " · loser spins the forfeit wheel 😈" : "");
        b1.hidden = false; b1.textContent = "Accept ⚡"; b1.dataset.act = "accept";
        b2.hidden = false; b2.textContent = "Not now"; b2.dataset.act = "decline";
      }
    } else if (d.state === "setting") {
      var ready = d.ready || {};
      if (!ready[me()]) {
        card.classList.add("hot");
        $("#dcTitle").textContent = "💌 Set your secret word";
        $("#dcText").textContent = them + " will race to solve it";
        b1.hidden = false; b1.textContent = "Set my word"; b1.dataset.act = "setword";
      } else {
        $("#dcTitle").textContent = "⏳ Word locked in";
        $("#dcText").textContent = "Waiting for " + them + " to set theirs…";
      }
      b2.hidden = false; b2.textContent = "Cancel duel"; b2.dataset.act = "cancel";
    } else {
      card.classList.add("hot");
      $("#dcTitle").textContent = "⚡ Duel in progress";
      $("#dcText").textContent = "Get in there before " + them + " solves it!";
      b1.hidden = false; b1.textContent = "Jump in ⚡"; b1.dataset.act = "join";
    }
  }
  function cardAction(btn) {
    var act = btn.dataset.act;
    if (act === "accept") accept();
    else if (act === "decline") { A.patch({ "duel.state": "declined" }); A.toast("Maybe next time 😅"); }
    else if (act === "cancel") { A.patch({ "duel.state": "cancelled" }); A.toast("Duel cancelled"); }
    else if (act === "setword") A.startSet("duel");
    else if (act === "join") openRace(false);
  }

  /* ---------- challenge ---------- */
  function openSetup(prefer) {
    setMode(prefer || mode);
    A.show("duelSetup");
  }
  function setMode(m) {
    mode = m;
    $("#modeSame").classList.toggle("on", m === "same");
    $("#modeEach").classList.toggle("on", m === "each");
  }
  function sendChallenge() {
    var now = Date.now();
    var d = {
      id: now, by: me(), mode: mode, stake: !!$("#inStake").checked, state: "invite",
      word: "", clue: "", words: { "0": "", "1": "" }, clues: { "0": "", "1": "" },
      ready: { "0": false, "1": false }, rows: { "0": [], "1": [] }, fin: { "0": null, "1": null }, winner: -2
    };
    A.patch({ duel: d }).then(function () { A.notify({ type: "duel", mode: mode }); });
    A.toast("⚡ Challenge sent to " + A.partnerName());
    A.sfx.ding();
    A.goHome();
  }
  function accept() {
    var d = D(); if (!d || d.state !== "invite") return;
    if (d.mode === "same") {
      var pick = A.ANSWERS[Math.floor(Math.random() * A.ANSWERS.length)];
      A.patch({ "duel.word": pick.w, "duel.clue": pick.c, "duel.state": "countdown", "duel.go": Date.now() });
    } else {
      d.state = "setting"; // update our local copy right away so the word screen opens instantly
      A.patch({ "duel.state": "setting" });
      A.startSet("duel");
    }
  }
  // Called by the "set a word" screen when it's being used for a duel.
  function submitWord(word, clue) {
    var d = D(); if (!d || d.state !== "setting") { A.goHome(); return; }
    var f = {}; f[k("words", opp())] = word; f[k("clues", opp())] = clue; f[k("ready", me())] = true;
    var bothReady = (d.ready || {})[opp()];
    if (bothReady) { f["duel.state"] = "countdown"; f["duel.go"] = Date.now(); }
    A.patch(f);
    A.toast(bothReady ? "Both words set. Get ready! ⚡" : "Word locked in 🔒");
    A.sfx.pop();
    A.goHome();
  }

  /* ---------- live updates ---------- */
  function onUpdate(prev, first) {
    var d = D(), pd = prev && prev.duel;
    if (!d || A.solo()) return;
    var fresh = !pd || pd.id !== d.id;
    if (!first) {
      if (d.state === "invite" && d.by !== me() && (fresh || pd.state !== "invite")) {
        A.toast("⚡ " + A.partnerName() + " challenged you to a Live Duel!"); A.sfx.ding(); A.haptic("success");
      }
      if (!fresh && pd.state !== d.state) {
        if (d.state === "declined" && d.by === me()) A.toast(A.partnerName() + " said not now 😅");
        if (d.state === "cancelled" && (d.by !== me() || pd.state === "setting")) A.toast("Duel cancelled");
        if (d.state === "setting" && d.by === me()) { A.toast("⚡ " + A.partnerName() + " accepted! Set your secret word"); A.sfx.ding(); }
      }
    }
    // Both words are in but nobody started it (e.g. both submitted at once): the challenger starts it.
    if (d.state === "setting" && (d.ready || {})[0] && (d.ready || {})[1] && d.by === me()) {
      A.patch({ "duel.state": "countdown", "duel.go": Date.now() });
    }
    // Race is starting: everyone who's here gets the countdown.
    if ((d.state === "countdown" || d.state === "live") && cdFor !== d.id && !finOf(d, me())) {
      if (!first || Date.now() - (d.go || 0) < 15000) openRace(true);
    }
    if (A.screen() === "duel") renderRace();
    if (d.state === "done" && shownResultFor !== d.id && (A.screen() === "duel" || (!first && pd && pd.state !== "done"))) {
      if (A.screen() !== "duel") A.show("duel");
      showResult();
    }
  }

  /* ---------- the race ---------- */
  function openRace(withCountdown) {
    var d = D(); if (!d) return;
    cur = ""; locked = false; live = false;
    A.buildKeyboard($("#kbDuel"), onKey);
    $("#duelResult").hidden = true;
    A.show("duel");
    A.setKeyHandler(onKey);
    renderRace();
    if (finOf(d, me())) { stopClock(); return; }
    if (withCountdown && cdFor !== d.id) {
      cdFor = d.id;
      countdown(function () { startRacing(); });
    } else { cdFor = d.id; startRacing(); }
  }
  function countdown(done) {
    var el = $("#countdown"), num = $("#cdNum"), n = 3;
    el.hidden = false;
    (function step() {
      num.textContent = n > 0 ? n : "GO!";
      num.style.animation = "none"; void num.offsetWidth; num.style.animation = "";
      A.beep(n > 0 ? 660 : 990, 0.15, "triangle", 0.09); A.haptic(n > 0 ? "light" : "success");
      if (n-- > 0) setTimeout(step, 800);
      else setTimeout(function () { el.hidden = true; done(); }, 450);
    })();
  }
  function startRacing() {
    var d = D(); if (!d || d.state === "done" || finOf(d, me())) return;
    live = true;
    if (d.state === "countdown" && d.by !== me()) A.patch({ "duel.state": "live" });
    startClock();
  }
  function renderRace() {
    var d = D(); if (!d) return;
    var word = myWord(d), L = word.length || 5, rows = rowsOf(d, me());
    $("#oppName").textContent = A.partnerName();
    $("#duelModeTag").textContent = d.mode === "same" ? "🎯 Same word" : "💌 Each other's words";
    var cb = $("#dClue"), clue = myClue(d); cb.hidden = !clue; cb.textContent = "Clue: " + clue;
    // My grid
    var grid = $("#dGrid"); grid.innerHTML = ""; grid.style.setProperty("--cols", L);
    for (var r = 0; r < CFG.MAX_GUESSES; r++) {
      var row = document.createElement("div"); row.className = "row";
      var done = rows[r], res = done && word ? A.scoreGuess(done, word) : null;
      for (var c = 0; c < L; c++) {
        var t = document.createElement("div"); t.className = "tile";
        if (done) { t.textContent = done[c] === "." ? "" : done[c]; t.classList.add(res[c]); if (A.isBurned(done)) t.classList.add("burned"); }
        else if (r === rows.length && cur[c]) { t.textContent = cur[c]; t.classList.add("filled"); }
        row.appendChild(t);
      }
      grid.appendChild(row);
    }
    paintKeys(d, word, rows);
    // Opponent: colours only, no letters
    var ow = oppWord(d), orows = rowsOf(d, opp()), og = $("#oppGrid"); og.innerHTML = "";
    for (var r2 = 0; r2 < CFG.MAX_GUESSES; r2++) {
      var mr = document.createElement("div"); mr.className = "mini-row";
      var rr = orows[r2] && ow ? A.scoreGuess(orows[r2], ow) : null;
      for (var c2 = 0; c2 < (ow.length || 5); c2++) {
        var m = document.createElement("div"); m.className = "mini" + (rr ? " " + rr[c2] : ""); mr.appendChild(m);
      }
      og.appendChild(mr);
    }
    var of = finOf(d, opp());
    $("#oppStatus").textContent = of ? (of.solved ? "✅ Solved in " + of.t + "!" : of.resigned ? "🏳️ Gave up" : "❌ Out of guesses") : orows.length + "/" + CFG.MAX_GUESSES + " guesses";
    fit();
  }
  function paintKeys(d, word, rows) {
    var best = {}, rank = { x: 1, y: 2, g: 3 };
    rows.forEach(function (g) { A.scoreGuess(g, word).forEach(function (r, i) { if (g[i] !== "." && (!best[g[i]] || rank[r] > rank[best[g[i]]])) best[g[i]] = r; }); });
    document.querySelectorAll("#kbDuel .key").forEach(function (key) {
      key.classList.remove("g", "y", "x"); if (best[key.dataset.k]) key.classList.add(best[key.dataset.k]);
    });
  }
  function fit() {
    if (A.screen() !== "duel") return;
    var d = D(); if (!d) return;
    var L = (myWord(d) || "").length || 5, gap = 6;
    var used = $(".topbar").offsetHeight + $("#duelTop").offsetHeight + ($("#dClue").hidden ? 0 : $("#dClue").offsetHeight + 10) + $("#kbDuel").offsetHeight + 10 * 3 + 18;
    var byH = (A.viewH() - used - gap * (CFG.MAX_GUESSES - 1)) / CFG.MAX_GUESSES;
    var byW = (Math.min(window.innerWidth - 32, 420) - gap * (L - 1)) / L;
    $("#dGrid").style.setProperty("--ts", Math.max(26, Math.floor(Math.min(byH, byW, 60))) + "px");
  }
  function onKey(key) {
    var d = D();
    if (!live || locked || !d || d.state === "done" || finOf(d, me())) return;
    var L = myWord(d).length;
    if (key === "back") { cur = cur.slice(0, -1); A.sfx.key(); renderRace(); return; }
    if (key === "enter") return submit();
    if (cur.length < L) { cur += key; A.sfx.key(); A.haptic("light"); renderRace(); }
  }
  function shake(msg) {
    var rows = document.querySelectorAll("#dGrid .row"), d = D(), row = rows[rowsOf(d, me()).length];
    if (row) { row.classList.remove("shake"); void row.offsetWidth; row.classList.add("shake"); }
    A.toast(msg); A.sfx.bad(); A.haptic("error");
  }
  function submit() {
    var d = D(), word = myWord(d);
    if (cur.length < word.length) return shake("Not enough letters");
    if (!A.VALID.has(cur)) return shake("Not in the word list");
    addRow(cur);
  }
  function addRow(guess) {
    var d = D(), word = myWord(d);
    var rows = rowsOf(d, me()).concat([guess]);
    var f = {}; f[k("rows", me())] = rows;
    d.rows = d.rows || {}; d.rows[me()] = rows; cur = "";
    stopClock(); locked = true;
    A.patch(f);
    renderRace();
    var tiles = document.querySelectorAll("#dGrid .row")[rows.length - 1].children;
    for (var i = 0; i < tiles.length; i++) { tiles[i].style.animationDelay = (i * 110) + "ms"; tiles[i].classList.add("flip"); }
    setTimeout(function () {
      locked = false;
      if (guess === word) finish(true);
      else if (rows.length >= CFG.MAX_GUESSES) finish(false);
      else startClock();
    }, 700);
  }

  /* ---------- clock (doesn't pause in a duel: it's a race) ---------- */
  function startClock() {
    stopClock(); deadline = Date.now() + CFG.GUESS_SECONDS * 1000; lastTick = -1;
    tick(); clock = setInterval(tick, 200);
  }
  function stopClock() { if (clock) clearInterval(clock); clock = null; }
  function tick() {
    var left = Math.max(0, deadline - Date.now()), sec = Math.ceil(left / 1000), el = $("#dTimer");
    el.textContent = sec + "s";
    el.style.setProperty("--p", (left / (CFG.GUESS_SECONDS * 1000)).toFixed(3));
    el.classList.toggle("urgent", sec <= 5);
    if (sec <= 5 && sec > 0 && sec !== lastTick) { lastTick = sec; A.beep(sec <= 3 ? 990 : 660, 0.05, "square", 0.04); }
    if (left <= 0) {
      stopClock();
      var d = D(); if (!live || !d || finOf(d, me()) || d.state === "done") return;
      A.toast("⏱ Time's up! That guess is gone");
      addRow(new Array(myWord(d).length + 1).join("."));
    }
  }

  /* ---------- finishing ---------- */
  function closeness(rows, word) {
    var best = { g: 0, y: 0 };
    rows.forEach(function (r) {
      if (A.isBurned(r)) return;
      var s = A.scoreGuess(r, word), g = 0, y = 0;
      s.forEach(function (x) { if (x === "g") g++; else if (x === "y") y++; });
      if (g > best.g || (g === best.g && y > best.y)) best = { g: g, y: y };
    });
    return best;
  }
  function finish(solved, resigned) {
    stopClock(); live = false;
    var d = D(); if (!d) return;
    var rows = rowsOf(d, me()), c = closeness(rows, myWord(d));
    var fin = { solved: solved, t: rows.length, at: Date.now(), g: c.g, y: c.y };
    if (resigned) fin.resigned = true;
    var f = {}; f[k("fin", me())] = fin;
    var of = finOf(d, opp()), winner = null;
    if (d.state !== "done") {
      if (resigned) winner = opp();
      else if (solved) winner = me();
      else if (of && !of.solved) {
        // Nobody solved it: closest wins.
        if (of.resigned) winner = me();
        else if (fin.g !== of.g) winner = fin.g > of.g ? me() : opp();
        else if (fin.y !== of.y) winner = fin.y > of.y ? me() : opp();
        else winner = -1;
      }
    }
    if (winner !== null) Object.assign(f, endFields(d, winner));
    A.patch(f);
    if (solved) { A.sfx.win(); A.confetti(); }
    else if (!resigned && winner === null) A.toast("Out of guesses… waiting for " + A.partnerName() + " 😬");
  }
  function endFields(d, winner) {
    var G = A.G(), f = { "duel.state": "done", "duel.winner": winner, "duel.endAt": Date.now() };
    if (winner >= 0) {
      var dw = (G.dw || [0, 0]).slice(); dw[winner]++; f.dw = dw;
      if (d.stake) f.forfeit = { w: winner, l: A.other(winner), state: "pending", text: "", at: Date.now() };
    }
    return f;
  }
  function onBack() {
    var d = D();
    if (A.screen() === "duel" && live && d && d.state !== "done" && !finOf(d, me())) {
      if (!confirm("Give up the duel? " + A.partnerName() + " will win.")) return true;
      finish(false, true);
    }
    stopClock(); live = false;
    return false;
  }

  /* ---------- result ---------- */
  function showResult() {
    var d = D(); if (!d) return;
    shownResultFor = d.id; stopClock(); live = false;
    renderRace();
    var w = d.winner, them = A.partnerName();
    $("#drTitle").textContent = w === me() ? "🏆 You won the duel!" : w === -1 ? "🤝 It's a draw!" : "😩 " + them + " won the duel";
    var mf = finOf(d, me()) || {}, of = finOf(d, opp()) || {};
    function line(who, word, f) {
      var how = f.solved ? "solved in " + f.t : f.resigned ? "gave up" : f.t ? "missed (" + (f.g || 0) + " green, " + (f.y || 0) + " yellow at best)" : "still going";
      return '<div class="dr-line">' + A.esc(who) + ": <b>" + A.esc(String(word).toUpperCase()) + "</b> · " + how + "</div>";
    }
    $("#drLines").innerHTML = line("You", myWord(d), mf) + line(them, oppWord(d), of);
    $("#drStake").textContent = d.stake && w >= 0 ? (w === me() ? "Now spin " + them + "'s forfeit from the home screen 😈" : them + " gets to pick your forfeit 😬") : "";
    $("#duelResult").hidden = false;
    if (w === me()) { A.sfx.win(); A.confetti(); A.haptic("success"); } else if (w !== -1) { A.sfx.lose(); A.haptic("warning"); }
  }

  /* ---------- wiring ---------- */
  $("#modeSame").addEventListener("click", function () { setMode("same"); A.sfx.pop(); });
  $("#modeEach").addEventListener("click", function () { setMode("each"); A.sfx.pop(); });
  $("#btnChallenge").addEventListener("click", sendChallenge);
  $("#btnDc1").addEventListener("click", function () { cardAction(this); });
  $("#btnDc2").addEventListener("click", function () { cardAction(this); });
  $("#btnRematch").addEventListener("click", function () { var d = D(); openSetup(d && d.mode); });
  $("#btnDuelHome").addEventListener("click", function () { A.goHome(); });
  window.addEventListener("resize", fit);

  return {
    renderCard: renderCard, onUpdate: onUpdate, onHomeButton: onHomeButton,
    submitWord: submitWord, onBack: onBack, isActive: function () { return active(D()); }
  };
};
