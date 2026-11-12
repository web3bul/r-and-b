/* R & B: Market Rush.
 * A three-lane runner through real Lagos markets. Swipe to dodge, jump and slide past
 * wheelbarrows, danfos, okadas and shop banners.
 * Two rules: Race (first to 1,000 m; a hit makes you stumble) and Last One Standing (3 hits and you're out).
 * Step 1 is solo. The course comes from a seed, so two phones with the same seed get the
 * exact same run (used later for live races). Drawn on a canvas, no image files. */
(function () {
  "use strict";
  var tg = window.Telegram && window.Telegram.WebApp;
  var PFX = "rb2_" + (window.RB_MOCK ? window.RB_MOCK + "_" : "");
  function sget(k, d) { try { var v = localStorage.getItem(PFX + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function sset(k, v) { try { localStorage.setItem(PFX + k, JSON.stringify(v)); } catch (e) {} }

  /* ---------- the markets ---------- */
  var MARKETS = [
    { name: "Balogun Market", area: "Lagos Island", goods: "fabric", accent: "#ff6aa8", can: ["#e63946", "#ffbf3c", "#2a9d8f", "#ff6aa8"], sky: ["#3b1360", "#ff8a5c"] },
    { name: "Computer Village", area: "Ikeja", goods: "phones", accent: "#4cc9f0", can: ["#1d4ed8", "#e5e7eb", "#ef4444", "#f59e0b"], sky: ["#1b1b4b", "#f97362"] },
    { name: "Mile 12 Market", area: "Kosofe", goods: "tomato", accent: "#ef4444", can: ["#16a34a", "#ef4444", "#facc15", "#f97316"], sky: ["#3a0f4c", "#ffb35c"] },
    { name: "Ladipo Market", area: "Mushin", goods: "tyres", accent: "#f59e0b", can: ["#334155", "#f59e0b", "#b91c1c", "#64748b"], sky: ["#2a1440", "#ff7a45"] },
    { name: "Oshodi Market", area: "Oshodi", goods: "mixed", accent: "#facc15", can: ["#facc15", "#2563eb", "#dc2626", "#16a34a"], sky: ["#341150", "#ff9966"] },
    { name: "Tejuosho Market", area: "Yaba", goods: "shoes", accent: "#a78bfa", can: ["#7c3aed", "#f472b6", "#22d3ee", "#fbbf24"], sky: ["#2b0f4c", "#e0457b"] },
    { name: "Alaba International", area: "Ojo", goods: "boxes", accent: "#38bdf8", can: ["#0ea5e9", "#f8fafc", "#f43f5e", "#84cc16"], sky: ["#13234b", "#ff8c69"] },
    { name: "Idumota Market", area: "Lagos Island", goods: "fabric", accent: "#fb7185", can: ["#be123c", "#f59e0b", "#059669", "#7c3aed"], sky: ["#3d1155", "#ffa26b"] },
    { name: "Oyingbo Market", area: "Ebute Metta", goods: "food", accent: "#84cc16", can: ["#65a30d", "#ea580c", "#facc15", "#0891b2"], sky: ["#2d1250", "#ff9f5a"] },
    { name: "Lekki Arts & Crafts", area: "Lekki", goods: "crafts", accent: "#d97706", can: ["#92400e", "#d97706", "#065f46", "#b45309"], sky: ["#241046", "#ff7f50"] }
  ];
  var LOW_BY_GOODS = { fabric: "bales", phones: "crate", tomato: "basket", tyres: "tyres", mixed: "barrow", shoes: "barrow", boxes: "crate", food: "basket", crafts: "drums" };
  var SECTION = 250;          // metres per market
  var RACE_LEN = 1000;
  var LX = [-1.1, 0, 1.1];    // lane centres
  var FAR = 110;              // how far ahead we draw
  var CAMH = 2.0, CAMB = 3.6; // camera height and distance behind the runner
  var JUMP_D = 0.62, JUMP_H = 1.35, SLIDE_D = 0.7;

  /* ---------- seeded randomness (same seed = same course) ---------- */
  function mulberry(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function hash(n) { var x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

  /* ---------- sound + haptics (respects the game's mute button) ---------- */
  var actx = null;
  function muted() { return sget("muted", false); }
  function beep(f, d, type, v, to) {
    if (muted()) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === "suspended") actx.resume();
      var o = actx.createOscillator(), g = actx.createGain(), t0 = actx.currentTime;
      o.type = type || "sine"; o.frequency.setValueAtTime(f, t0);
      if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + d);
      g.gain.setValueAtTime(v || 0.07, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
      o.connect(g); g.connect(actx.destination); o.start(t0); o.stop(t0 + d + 0.02);
    } catch (e) {}
  }
  var sfx = {
    coin: function () { beep(1320, 0.07, "square", 0.035); setTimeout(function () { beep(1760, 0.09, "square", 0.03); }, 55); },
    jump: function () { beep(380, 0.16, "triangle", 0.06, 760); },
    slide: function () { beep(300, 0.18, "sawtooth", 0.03, 120); },
    hit: function () { beep(140, 0.3, "sawtooth", 0.09, 60); },
    lane: function () { beep(600, 0.04, "triangle", 0.03); },
    market: function () { [523, 659, 784].forEach(function (f, i) { setTimeout(function () { beep(f, 0.14, "triangle", 0.06); }, i * 110); }); },
    go: function () { beep(990, 0.2, "triangle", 0.08); },
    tick: function () { beep(660, 0.12, "triangle", 0.07); },
    end: function () { [523, 659, 784, 1047].forEach(function (f, i) { setTimeout(function () { beep(f, 0.18, "triangle", 0.08); }, i * 120); }); }
  };
  function haptic(k) { try { if (tg && tg.HapticFeedback) { if (k === "light") tg.HapticFeedback.impactOccurred("light"); else tg.HapticFeedback.notificationOccurred(k); } } catch (e) {} }

  /* ---------- DOM ---------- */
  var root, cv, ctx, W = 360, H = 640, DPR = 1, Fx = 1, Fy = 1, HOR = 200;
  var $ = function (s) { return root.querySelector(s); };
  function buildDom() {
    root = document.createElement("div");
    root.className = "rush-root"; root.id = "rush"; root.hidden = true;
    root.innerHTML =
      '<canvas class="rush-cv"></canvas>' +
      '<div class="rush-hud" hidden>' +
        '<button class="rush-x" data-act="pause" aria-label="Pause">&#10074;&#10074;</button>' +
        '<div class="rh-dist"><b id="rhDist">0</b><small>m</small></div>' +
        '<div class="rh-coins">&#8358;<b id="rhCoins">0</b></div>' +
        '<div class="rh-sub" id="rhSub"></div>' +
        '<div class="rh-market" id="rhMarket"></div>' +
      '</div>' +
      '<div class="rush-enter" id="rushEnter"><small>Now entering</small><b></b><span></span></div>' +
      '<div class="rush-cd" id="rushCd" hidden></div>' +
      '<div class="rush-help" id="rushHelp" hidden>Swipe &larr; &rarr; to dodge &middot; &uarr; jump &middot; &darr; slide</div>' +
      '<div class="rush-panel" id="rushMenu">' +
        '<button class="rush-close" data-act="close" aria-label="Close">&#10005;</button>' +
        '<div class="rush-logo"><span>MARKET</span><b>RUSH</b></div>' +
        '<p class="rush-tag">Dash through Lagos markets. Dodge the danfos, jump the wheelbarrows, duck the banners.</p>' +
        '<button class="rush-mode" data-mode="race"><i>&#127937;</i><span><b>Race to 1,000 m</b><small>Hits make you stumble. Fastest time wins.</small><em id="rushBestRace"></em></span></button>' +
        '<button class="rush-mode" data-mode="surv"><i>&#128165;</i><span><b>Last One Standing</b><small>Three hits and you\'re out. Go as far as you can.</small><em id="rushBestSurv"></em></span></button>' +
        '<p class="rush-note">Solo practice for now. Live races with your partner are coming next.</p>' +
      '</div>' +
      '<div class="rush-panel" id="rushPause" hidden>' +
        '<h2>Paused</h2>' +
        '<button class="rush-btn" data-act="resume">&#9654; Keep running</button>' +
        '<button class="rush-btn soft" data-act="quit">Quit run</button>' +
      '</div>' +
      '<div class="rush-panel" id="rushOver" hidden>' +
        '<div class="ro-emoji" id="roEmoji"></div>' +
        '<h2 id="roTitle"></h2>' +
        '<div class="ro-big" id="roBig"></div>' +
        '<p class="ro-sub" id="roSub"></p>' +
        '<div class="ro-best" id="roBest"></div>' +
        '<button class="rush-btn" data-act="again">&#8635; Run again</button>' +
        '<button class="rush-btn soft" data-act="menu">Change mode</button>' +
      '</div>';
    document.body.appendChild(root);
    cv = root.querySelector(".rush-cv"); ctx = cv.getContext("2d");
    root.addEventListener("click", function (e) {
      var b = e.target.closest("[data-act],[data-mode]"); if (!b) return;
      if (b.dataset.mode) { startRun(b.dataset.mode); return; }
      var a = b.dataset.act;
      if (a === "close") close();
      else if (a === "pause") pause();
      else if (a === "resume") resume();
      else if (a === "quit") toMenu();
      else if (a === "again") startRun(mode);
      else if (a === "menu") toMenu();
    });
    bindInput();
    window.addEventListener("resize", resize);
    if (tg && tg.onEvent) { try { tg.onEvent("viewportChanged", resize); } catch (e) {} }
    document.addEventListener("visibilitychange", function () { if (document.hidden && state === "run") pause(); });
  }
  function resize() {
    if (!root || root.hidden) return;
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = root.clientWidth || window.innerWidth; H = root.clientHeight || window.innerHeight;
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    HOR = H * 0.34;
    Fx = Math.min(W, H * 0.62) * 0.29 * CAMB / 1.1; // lanes are ~29% of the width apart at the runner
    Fy = Fx * 1.12;                                  // near-true proportions
    CAMH = (H * 0.88 - HOR) * CAMB / Fy;             // camera height puts the runner's feet at 88% of the screen
    skyKey = "";
  }

  /* ---------- game state ---------- */
  var state = "closed";   // closed, menu, countdown, run, paused, over
  var mode = "race";
  var seed = 1, rng = Math.random, order = [];
  var dist = 0, speed = 0, time = 0, coins = 0, hearts = 3;
  var lane = 1, px = 0, py = 0, jumpT = 0, slideT = 0, stumble = 0, invuln = 0, shake = 0, crashT = 0;
  var objs = [], nextRow = 0, marketIdx = -1, camX = 0, last = 0, raf = 0, anim = 0;

  function marketAt(p) { return MARKETS[order[Math.floor(Math.max(0, p) / SECTION) % order.length]]; }
  function baseSpeed() { return mode === "race" ? 12 + Math.min(dist, RACE_LEN) / 100 : Math.min(25, 11 + dist / 90); }

  /* ---------- course generation ---------- */
  function newCourse(s) {
    seed = s; rng = mulberry(s);
    order = MARKETS.map(function (_, i) { return i; });
    for (var i = order.length - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)), t = order[i]; order[i] = order[j]; order[j] = t; }
    objs = []; nextRow = 45;
  }
  function add(o) { objs.push(o); return o; }
  function coinLine(ln, p, n, arc) {
    for (var i = 0; i < n; i++) add({ t: "coin", lane: ln, x: LX[ln], pos: p + i * 2.2, len: 0.3, y: arc ? 0.55 + 1.05 * Math.sin(Math.PI * i / (n - 1)) : 0.55 });
  }
  function low(ln, p, m) { return add({ t: "low", v: LOW_BY_GOODS[m.goods], lane: ln, x: LX[ln], pos: p, len: 0.8, h: 0.78 }); }
  function tall(ln, p) { return rng() < 0.5 ? add({ t: "danfo", lane: ln, x: LX[ln], pos: p, len: 3.6, h: 1.75 }) : add({ t: "stack", lane: ln, x: LX[ln], pos: p, len: 1.0, h: 1.9, v: rng() }); }
  function over(ln, p) { return add({ t: "over", lane: ln, x: LX[ln], pos: p, len: 0.12, h: 0.95, v: Math.floor(rng() * 4) }); }
  function makeRow(p) {
    if (mode === "race" && p > RACE_LEN - 25) return;
    var m = marketAt(p), free = Math.floor(rng() * 3), r = rng(), early = p < 160;
    var others = [0, 1, 2].filter(function (l) { return l !== free; });
    if (rng() < 0.5) others.reverse();
    if (early) {
      if (r < 0.45) { low(others[0], p, m); coinLine(free, p - 4, 5); }
      else if (r < 0.75) { tall(others[0], p); coinLine(free, p - 3, 4); }
      else coinLine(free, p, 6);
      return;
    }
    var hard = Math.min(1, p / 900);
    if (r < 0.26) {                                   // one or two blockers, coins in the free lane
      low(others[0], p, m);
      if (rng() < 0.4 + hard * 0.4) (rng() < 0.5 ? tall : function (l, q) { low(l, q, m); })(others[1], p);
      coinLine(free, p - 3, 5);
    } else if (r < 0.42) {                            // a danfo, maybe with company
      add({ t: "danfo", lane: others[0], x: LX[others[0]], pos: p, len: 3.6, h: 1.75 });
      if (rng() < 0.5 + hard * 0.3) low(others[1], p + 1, m);
      coinLine(free, p - 2, 5);
    } else if (r < 0.56) {                            // shop banners: slide under
      over(others[0], p);
      if (rng() < 0.5) over(free, p); else coinLine(free, p - 3, 4);
      if (rng() < 0.3 + hard * 0.4) over(others[1], p);
    } else if (r < 0.68) {                            // a wall of goods: jump it
      [0, 1, 2].forEach(function (l) { low(l, p, m); });
      coinLine(1, p - 4.4, 5, true);
    } else if (r < 0.82) {                            // an okada coming at you
      add({ t: "okada", lane: others[0], x: LX[others[0]], pos: p + 20, len: 1.4, h: 1.6, moving: true });
      coinLine(free, p - 2, 5);
    } else {                                          // breather: just coins
      coinLine(free, p - 2, 7);
      if (hard > 0.4) low(others[0], p + 6, m);
    }
  }
  function generate(upto) {
    while (nextRow < upto) { makeRow(nextRow); nextRow += Math.max(9, 18 - nextRow / 110) + rng() * 4; }
  }

  /* ---------- runs ---------- */
  function resetRunner() {
    dist = 0; speed = 0; time = 0; coins = 0; hearts = 3;
    lane = 1; px = 0; py = 0; jumpT = 0; slideT = 0; stumble = 0; invuln = 0; shake = 0; crashT = 0; marketIdx = -1;
  }
  function startRun(m, s) {
    mode = m === "surv" ? "surv" : "race";
    resetRunner();
    newCourse(s || (Math.random() * 1e9) >>> 0);
    generate(FAR + 20);
    panel(null); $(".rush-hud").hidden = false; $("#rushHelp").hidden = !(sget("rushRuns", 0) < 3);
    renderHud(true);
    state = "countdown";
    var cd = $("#rushCd"), n = 3; cd.hidden = false;
    (function step() {
      if (state !== "countdown") { cd.hidden = true; return; }
      cd.textContent = n > 0 ? n : "GO!";
      cd.style.animation = "none"; void cd.offsetWidth; cd.style.animation = "";
      if (n > 0) { sfx.tick(); haptic("light"); setTimeout(step, 700); n--; }
      else { sfx.go(); haptic("success"); setTimeout(function () { cd.hidden = true; $("#rushHelp").hidden = true; }, 500); state = "run"; sset("rushRuns", sget("rushRuns", 0) + 1); }
    })();
  }
  function endRun(finished) {
    state = "over"; $(".rush-hud").hidden = true;
    var best, isBest = false;
    if (mode === "race") {
      best = sget("rushBestRace", 0);
      if (finished && (!best || time < best)) { best = time; isBest = true; sset("rushBestRace", time); }
      $("#roEmoji").textContent = isBest ? "🏆" : "🏁";
      $("#roTitle").textContent = isBest ? "New best time!" : "Finished!";
      $("#roBig").textContent = time.toFixed(2) + "s";
      $("#roSub").textContent = "1,000 m through " + sectionsRun() + " · ₦" + coins + " picked up";
      $("#roBest").textContent = best && !isBest ? "Your best: " + best.toFixed(2) + "s" : "";
    } else {
      best = sget("rushBestSurv", 0);
      var d = Math.floor(dist);
      if (d > best) { best = d; isBest = true; sset("rushBestSurv", d); }
      $("#roEmoji").textContent = isBest ? "🏆" : "💥";
      $("#roTitle").textContent = isBest ? "New best distance!" : "Knocked out!";
      $("#roBig").textContent = d.toLocaleString() + " m";
      $("#roSub").textContent = "You made it to " + marketAt(dist).name + " · ₦" + coins + " picked up";
      $("#roBest").textContent = !isBest && best ? "Your best: " + best.toLocaleString() + " m" : "";
    }
    if (isBest) sfx.end();
    setTimeout(function () { if (state === "over") panel("#rushOver"); }, finished ? 300 : 900);
  }
  function sectionsRun() {
    var n = Math.min(order.length, Math.ceil(Math.min(dist, RACE_LEN) / SECTION));
    var names = []; for (var i = 0; i < n; i++) names.push(MARKETS[order[i]].name.replace(/ Market$/, ""));
    return names.length > 1 ? names.slice(0, -1).join(", ") + " and " + names[names.length - 1] : names[0];
  }
  function pause() { if (state !== "run" && state !== "countdown") return; state = "paused"; panel("#rushPause"); }
  function resume() { if (state !== "paused") return; panel(null); state = "run"; last = performance.now(); }
  function toMenu() {
    state = "menu"; resetRunner(); objs = []; newCourse(7);
    $(".rush-hud").hidden = true; $("#rushCd").hidden = true; $("#rushHelp").hidden = true;
    var br = sget("rushBestRace", 0), bs = sget("rushBestSurv", 0);
    $("#rushBestRace").textContent = br ? "Best: " + br.toFixed(2) + "s" : "";
    $("#rushBestSurv").textContent = bs ? "Best: " + bs.toLocaleString() + " m" : "";
    panel("#rushMenu");
  }
  function panel(id) {
    ["#rushMenu", "#rushPause", "#rushOver"].forEach(function (p) { $(p).hidden = p !== id; });
  }
  function open() {
    if (!root) buildDom();
    root.hidden = false; document.documentElement.classList.add("rush-open");
    resize(); toMenu();
    if (tg && tg.BackButton) { try { tg.BackButton.hide(); } catch (e) {} }
    last = performance.now(); cancelAnimationFrame(raf); raf = requestAnimationFrame(frame);
  }
  function close() {
    state = "closed"; root.hidden = true; cancelAnimationFrame(raf);
    document.documentElement.classList.remove("rush-open");
    if (tg && tg.BackButton) { try { tg.BackButton.show(); } catch (e) {} }
  }

  /* ---------- input: swipes + keyboard ---------- */
  function act(a) {
    if (state !== "run") return;
    if (a === "left" && lane > 0) { lane--; sfx.lane(); }
    else if (a === "right" && lane < 2) { lane++; sfx.lane(); }
    else if (a === "up" && py < 0.05 && jumpT <= 0) { jumpT = JUMP_D; slideT = 0; sfx.jump(); }
    else if (a === "down") { jumpT = 0; slideT = SLIDE_D; sfx.slide(); }
  }
  function bindInput() {
    var sx = 0, sy = 0, used = false;
    root.addEventListener("touchstart", function (e) {
      if (state !== "run") return;
      var t = e.touches[0]; sx = t.clientX; sy = t.clientY; used = false;
    }, { passive: true });
    root.addEventListener("touchmove", function (e) {
      if (state !== "run") return;
      e.preventDefault();
      if (used) return;
      var t = e.touches[0], dx = t.clientX - sx, dy = t.clientY - sy;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 26) return;
      used = true; // one move per swipe, fires mid-swipe so it feels instant
      act(Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? "left" : "right") : (dy < 0 ? "up" : "down"));
    }, { passive: false });
    document.addEventListener("keydown", function (e) {
      if (!root || root.hidden) return;
      var k = e.key, a = null;
      if (k === "ArrowLeft" || k === "a" || k === "A") a = "left";
      else if (k === "ArrowRight" || k === "d" || k === "D") a = "right";
      else if (k === "ArrowUp" || k === "w" || k === "W" || k === " ") a = "up";
      else if (k === "ArrowDown" || k === "s" || k === "S") a = "down";
      else if (k === "Escape") { state === "run" ? pause() : state === "paused" ? resume() : null; }
      if (a) { e.preventDefault(); e.stopPropagation(); act(a); }
    }, true);
  }

  /* ---------- update ---------- */
  function update(dt) {
    anim += dt;
    if (state === "menu") { speed = 7; dist += speed * dt; px += (0 - px) * Math.min(1, dt * 8); return; }
    if (state !== "run") return;
    if (crashT > 0) { crashT -= dt; speed *= Math.pow(0.02, dt); dist += speed * dt; if (crashT <= 0) endRun(false); return; }
    time += dt;
    stumble = Math.max(0, stumble - dt); invuln = Math.max(0, invuln - dt); shake = Math.max(0, shake - dt);
    var target = baseSpeed() * (stumble > 0 ? 0.3 + 0.7 * (1 - stumble / 1.1) : 1);
    speed += (target - speed) * Math.min(1, dt * (stumble > 0 ? 8 : 2.5));
    dist += speed * dt;
    px += (LX[lane] - px) * Math.min(1, dt * 14);
    if (jumpT > 0) { jumpT -= dt; var u = 1 - Math.max(0, jumpT) / JUMP_D; py = JUMP_H * 4 * u * (1 - u); } else py = 0;
    if (slideT > 0) slideT -= dt;
    // okadas ride toward you
    for (var i = 0; i < objs.length; i++) { var o = objs[i]; if (o.moving && o.pos - dist < 70) o.pos -= 7 * dt; }
    collide();
    // market change
    var mi = Math.floor(dist / SECTION);
    if (mi !== marketIdx) { marketIdx = mi; if (dist > 5 || mi === 0) announce(marketAt(dist)); }
    if (mode === "race" && dist >= RACE_LEN) { dist = RACE_LEN; renderHud(); endRun(true); return; }
    objs = objs.filter(function (o) { return !o.gone && o.pos + o.len > dist - CAMB; });
    generate(dist + FAR + 20);
    renderHud();
  }
  function collide() {
    var standH = slideT > 0 ? 0.6 : 1.55;
    for (var i = 0; i < objs.length; i++) {
      var o = objs[i], z = o.pos - dist;
      if (z > 1.5 || z + o.len < -0.6 || o.hit) continue;
      if (Math.abs(px - o.x) > 0.6) continue;
      if (o.t === "coin") {
        if (z < 0.5 && z + o.len > -0.4 && Math.abs(py + 0.6 - o.y) < 0.85) { o.gone = true; coins++; sfx.coin(); }
        continue;
      }
      if (!(z < 0.35 && z + o.len > -0.35)) continue;
      var hit = o.t === "low" ? py < o.h - 0.08 : o.t === "over" ? py + standH > o.h : true;
      if (hit) { o.hit = true; onHit(o); return; }
    }
  }
  function onHit(o) {
    if (invuln > 0) return;
    sfx.hit(); haptic("error"); shake = 0.35;
    if (mode === "surv") {
      hearts--;
      renderHud(true);
      if (hearts <= 0) { crashT = 0.9; stumble = 0; return; }
    }
    stumble = 1.1; invuln = 1.3; jumpT = 0; slideT = 0;
    // knock the runner into a free lane if a vehicle is in the way
    if (o.t === "danfo" || o.t === "okada" || o.t === "stack") o.gone = mode === "race";
  }
  var enterTimer = null;
  function announce(m) {
    var el = $("#rushEnter");
    el.querySelector("b").textContent = m.name;
    el.querySelector("span").textContent = m.area;
    el.style.setProperty("--acc", m.accent);
    el.classList.remove("show"); void el.offsetWidth; el.classList.add("show");
    clearTimeout(enterTimer); enterTimer = setTimeout(function () { el.classList.remove("show"); }, 2600);
    if (state === "run" && dist > 5) sfx.market();
    $("#rhMarket").textContent = "📍 " + m.name + " · " + m.area;
  }
  var hudCache = {};
  function setText(id, v) { if (hudCache[id] !== v) { hudCache[id] = v; $("#" + id).textContent = v; } }
  function renderHud(force) {
    if (force) hudCache = {};
    setText("rhDist", String(Math.floor(dist)));
    setText("rhCoins", String(coins));
    if (mode === "race") setText("rhSub", "⏱ " + time.toFixed(1) + "s · " + Math.max(0, RACE_LEN - Math.floor(dist)) + " m to go");
    else setText("rhSub", new Array(hearts + 1).join("❤️") + new Array(4 - hearts).join("🤍"));
  }

  /* ---------- drawing helpers ---------- */
  function P(x, y, z) {
    var d = z + CAMB; if (d < 0.35) return null;
    var s = 1 / d;
    return { x: W / 2 + (x - camX) * Fx * s, y: HOR + (CAMH - y) * Fy * s, sx: Fx * s, sy: Fy * s };
  }
  function quad(a, b, c, d, fill) {
    ctx.fillStyle = fill; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.closePath(); ctx.fill();
  }
  function shade(hex, amt) {
    var n = parseInt(hex.slice(1), 16), r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255;
    var f = amt < 0 ? 0 : 255, p = Math.abs(amt);
    return "rgb(" + Math.round(r + (f - r) * p) + "," + Math.round(g + (f - g) * p) + "," + Math.round(b + (f - b) * p) + ")";
  }
  // A solid box seen from behind: front face, top, and the side facing the middle of the road.
  function box(x, w, y0, h, z, len, col) {
    var x0 = x - w / 2, x1 = x + w / 2, zb = z + len;
    var a = P(x0, y0, z), b = P(x1, y0, z), c = P(x1, y0 + h, z), d = P(x0, y0 + h, z);
    var a2 = P(x0, y0 + h, zb), b2 = P(x1, y0 + h, zb);
    if (!a || !a2) return null;
    if (x0 > camX) quad(a, d, a2, P(x0, y0, zb), shade(col, -0.35));
    else if (x1 < camX) quad(b, c, b2, P(x1, y0, zb), shade(col, -0.35));
    if (y0 + h < CAMH) quad(d, c, b2, a2, shade(col, 0.22));
    quad(a, b, c, d, col);
    return { l: a.x, r: b.x, t: d.y, b: a.y, s: a.sx };
  }
  function fade(z) { return Math.max(0, Math.min(1, (FAR - z) / 28)); }

  /* ---------- sky + skyline ---------- */
  var skyCv = null, skyKey = "";
  function sky(m) {
    var key = m.name + W + "x" + H;
    if (skyKey !== key) {
      skyKey = key;
      skyCv = skyCv || document.createElement("canvas");
      skyCv.width = Math.round(W * 1.4 * DPR); skyCv.height = Math.round(HOR * DPR);
      var c = skyCv.getContext("2d"); c.setTransform(DPR, 0, 0, DPR, 0, 0);
      var w = W * 1.4, g = c.createLinearGradient(0, 0, 0, HOR);
      g.addColorStop(0, m.sky[0]); g.addColorStop(1, m.sky[1]);
      c.fillStyle = g; c.fillRect(0, 0, w, HOR);
      c.fillStyle = "rgba(255,230,160,.9)"; c.beginPath(); c.arc(w * 0.68, HOR * 0.62, HOR * 0.13, 0, Math.PI * 2); c.fill();
      var r = mulberry(m.name.length * 977 + m.area.length);
      for (var layer = 0; layer < 2; layer++) {
        c.fillStyle = layer ? "rgba(30,8,50,.92)" : "rgba(60,20,80,.55)";
        for (var xx = -10; xx < w; ) {
          var bw = 18 + r() * 40, bh = HOR * (layer ? 0.12 + r() * 0.22 : 0.2 + r() * 0.35);
          c.fillRect(xx, HOR - bh, bw, bh);
          if (layer && r() < 0.5) { c.fillStyle = "rgba(255,200,90,.55)"; for (var wy = HOR - bh + 6; wy < HOR - 6; wy += 9) for (var wx = xx + 4; wx < xx + bw - 4; wx += 8) if (r() < 0.35) c.fillRect(wx, wy, 3, 4); c.fillStyle = "rgba(30,8,50,.92)"; }
          xx += bw + (layer ? 2 : 6);
        }
      }
    }
    ctx.drawImage(skyCv, -W * 0.2 - camX * 14, 0, W * 1.4, HOR);
  }

  /* ---------- the world ---------- */
  function drawGround(m) {
    ctx.fillStyle = "#6b3a2a"; ctx.fillRect(0, HOR, W, H - HOR);
    var zNear = -CAMB + 0.4, step = 2.5, off = dist % (step * 2);
    for (var z = FAR; z > zNear; z -= step) {
      var z0 = Math.max(zNear, z - step), band = Math.floor((z + dist) / step) % 2;
      var a = P(-9, 0, z), b = P(9, 0, z), c = P(9, 0, z0), d = P(-9, 0, z0);
      if (!a || !d) continue;
      quad(a, b, c, d, band ? "#8a4b33" : "#7d432e");                                   // laterite ground
      quad(P(-3.4, 0, z), P(3.4, 0, z), P(3.4, 0, z0), P(-3.4, 0, z0), band ? "#a79a8c" : "#9b8f82"); // walkway
      quad(P(-1.72, 0, z), P(1.72, 0, z), P(1.72, 0, z0), P(-1.72, 0, z0), band ? "#55505a" : "#4d4852"); // road
      if (band) { [-0.55, 0.55].forEach(function (lx) { quad(P(lx - 0.035, 0, z), P(lx + 0.035, 0, z), P(lx + 0.035, 0, z0), P(lx - 0.035, 0, z0), "rgba(255,230,150,.75)"); }); }
    }
    // haze where the road meets the sky
    var hz = ctx.createLinearGradient(0, HOR, 0, HOR + 26);
    hz.addColorStop(0, m.sky[1]); hz.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = hz; ctx.fillRect(0, HOR, W, 26);
  }
  function drawStall(side, k, z, m) {
    var h = hash(k * 7 + side), x = side * (2.55 + h * 0.25), col = m.can[Math.floor(h * 4) % 4], col2 = m.can[(Math.floor(h * 4) + 1) % 4];
    var p = P(x, 0, z); if (!p) return;
    ctx.globalAlpha = fade(z);
    // pole
    var top = P(x, 2.2, z + 0.8);
    ctx.strokeStyle = "#3a2a20"; ctx.lineWidth = Math.max(1, 0.05 * p.sx);
    ctx.beginPath(); ctx.moveTo(top.x, P(x, 0, z + 0.8).y); ctx.lineTo(top.x, top.y); ctx.stroke();
    // table and goods
    var t = box(x, 1.25, 0, 0.8, z, 1.6, "#7a4a2b");
    if (t) goods(m.goods, t, h, k);
    // seller
    if (h > 0.45) {
      var sp = P(x + side * 0.55, 0.95, z + 1.9);
      if (sp) {
        ctx.fillStyle = h > 0.7 ? "#3b2216" : "#4a2a1a";
        ctx.beginPath(); ctx.arc(sp.x, sp.y, 0.17 * sp.sx, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = col2; ctx.beginPath(); ctx.ellipse(sp.x, sp.y - 0.17 * sp.sy, 0.2 * sp.sx, 0.11 * sp.sy, 0, 0, Math.PI * 2); ctx.fill(); // gele
        ctx.fillStyle = col; ctx.fillRect(sp.x - 0.2 * sp.sx, sp.y + 0.14 * sp.sy, 0.4 * sp.sx, 0.45 * sp.sy);
      }
    }
    // umbrella: striped panels from the tip down to a scalloped edge
    var r = 1.0 * top.sx, ry = 0.5 * top.sy, ax = top.x, ay = top.y - ry;
    function rim(f) { return top.y + ry * 0.22 * Math.sin(Math.PI * f); }
    for (var i = 0; i < 6; i++) {
      var f0 = i / 6, f1 = (i + 1) / 6;
      ctx.fillStyle = i % 2 ? col2 : col;
      ctx.beginPath(); ctx.moveTo(ax, ay);
      ctx.lineTo(top.x - r + 2 * r * f0, rim(f0));
      ctx.quadraticCurveTo(top.x - r + 2 * r * (f0 + f1) / 2, rim((f0 + f1) / 2) + ry * 0.18, top.x - r + 2 * r * f1, rim(f1));
      ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  function goods(kind, t, h, k) {
    var w = t.r - t.l, top = t.t, u = t.s;
    var r2 = mulberry(k * 31 + 7);
    if (kind === "tomato" || kind === "food") {
      for (var i = 0; i < 9; i++) { ctx.fillStyle = kind === "food" && i % 3 === 0 ? "#8b5a2b" : i % 4 === 0 ? "#f59e0b" : "#d62828"; ctx.beginPath(); ctx.arc(t.l + w * (0.12 + 0.76 * r2()), top - u * 0.06 * (1 + (i % 3)), u * 0.09, 0, Math.PI * 2); ctx.fill(); }
    } else if (kind === "fabric") {
      for (var j = 0; j < 4; j++) { ctx.fillStyle = ["#ff6aa8", "#2a9d8f", "#ffbf3c", "#7c3aed", "#e63946"][(j + Math.floor(h * 5)) % 5]; ctx.fillRect(t.l + w * 0.08, top - u * 0.1 * (j + 1), w * 0.84, u * 0.09); }
    } else if (kind === "phones" || kind === "boxes") {
      for (var p = 0; p < 4; p++) { ctx.fillStyle = kind === "phones" ? "#111827" : "#b08158"; ctx.fillRect(t.l + w * (0.08 + p * 0.22), top - u * 0.22, w * 0.17, u * 0.22); if (kind === "phones") { ctx.fillStyle = "#38bdf8"; ctx.fillRect(t.l + w * (0.1 + p * 0.22), top - u * 0.19, w * 0.13, u * 0.14); } }
    } else if (kind === "tyres") {
      ctx.fillStyle = "#1f2937"; for (var q = 0; q < 3; q++) { ctx.beginPath(); ctx.ellipse(t.l + w * (0.2 + q * 0.3), top - u * 0.16, w * 0.13, u * 0.16, 0, 0, Math.PI * 2); ctx.fill(); }
    } else if (kind === "shoes") {
      for (var s = 0; s < 5; s++) { ctx.fillStyle = ["#111", "#a16207", "#be123c", "#f8fafc"][s % 4]; ctx.beginPath(); ctx.ellipse(t.l + w * (0.12 + s * 0.19), top - u * 0.05, w * 0.07, u * 0.05, 0, 0, Math.PI * 2); ctx.fill(); }
    } else if (kind === "crafts") {
      for (var c = 0; c < 4; c++) { ctx.fillStyle = c % 2 ? "#78350f" : "#a16207"; ctx.fillRect(t.l + w * (0.12 + c * 0.22), top - u * (0.25 + 0.1 * (c % 2)), w * 0.1, u * (0.25 + 0.1 * (c % 2))); }
    } else { goods(["tomato", "fabric", "shoes", "boxes"][Math.floor(h * 4)], t, h, k); }
  }
  function drawArch(p, m, finish) {
    var z = p - dist; if (z < -CAMB + 0.6 || z > FAR) return;
    ctx.globalAlpha = fade(z);
    var l = box(-2.15, 0.14, 0, 3.1, z, 0.14, "#3a2a20"), r = box(2.15, 0.14, 0, 3.1, z, 0.14, "#3a2a20");
    var b = box(0, 4.45, 2.35, 0.8, z, 0.1, finish ? "#111111" : m.accent);
    if (b && l && r) {
      if (finish) { var n = 12, cw = (b.r - b.l) / n; for (var i = 0; i < n; i++) for (var j = 0; j < 2; j++) if ((i + j) % 2) { ctx.fillStyle = "#fff"; ctx.fillRect(b.l + i * cw, b.t + j * (b.b - b.t) / 2, cw, (b.b - b.t) / 2); } }
      var fs = (b.b - b.t) * (finish ? 0.62 : 0.42);
      if (fs > 5) {
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.font = "700 " + fs + "px Fredoka, system-ui, sans-serif";
        var label = finish ? "FINISH" : m.name.toUpperCase();
        if (finish) { ctx.fillStyle = "#e11d48"; ctx.fillText(label, (b.l + b.r) / 2, (b.t + b.b) / 2); }
        else {
          ctx.fillStyle = "#fff"; ctx.fillText(label, (b.l + b.r) / 2, b.t + (b.b - b.t) * 0.4, b.r - b.l - 6);
          ctx.font = "500 " + fs * 0.55 + "px Fredoka, system-ui, sans-serif"; ctx.fillStyle = "rgba(255,255,255,.85)";
          ctx.fillText(m.area, (b.l + b.r) / 2, b.t + (b.b - b.t) * 0.78);
        }
      }
    }
    ctx.globalAlpha = 1;
  }
  function drawObj(o) {
    var z = o.pos - dist; if (z < -CAMB + 0.5 || z > FAR) return;
    ctx.globalAlpha = fade(z);
    if (o.t === "coin") {
      var c = P(o.x, o.y, z); if (!c) return;
      var r = 0.22 * c.sx, sw = Math.abs(Math.cos(anim * 5 + o.pos));
      ctx.fillStyle = "#b7791f"; ctx.beginPath(); ctx.ellipse(c.x, c.y, Math.max(1, r * sw), r, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#facc15"; ctx.beginPath(); ctx.ellipse(c.x, c.y, Math.max(0.5, r * 0.78 * sw), r * 0.78, 0, 0, Math.PI * 2); ctx.fill();
      if (r > 7 && sw > 0.5) { ctx.fillStyle = "#92400e"; ctx.font = "700 " + r * 1.1 + "px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("₦", c.x, c.y + 1); }
    } else if (o.t === "low") drawLow(o, z);
    else if (o.t === "danfo") drawDanfo(o, z);
    else if (o.t === "okada") drawOkada(o, z);
    else if (o.t === "stack") {
      var cols = ["#b08158", "#9a6b45", "#c49a6c"];
      for (var i = 0; i < 3; i++) box(o.x + (i % 2 ? 0.04 : -0.04), 0.9, i * 0.63, 0.62, z, o.len, cols[i]);
      var f = box(o.x, 0.9, 1.26, 0.62, z, o.len, cols[2]);
      if (f && f.s > 18) { ctx.fillStyle = "rgba(60,30,10,.6)"; ctx.font = "600 " + f.s * 0.13 + "px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("FRAGILE", (f.l + f.r) / 2, (f.t + f.b) / 2); }
    } else if (o.t === "over") {
      var pl = P(o.x - 0.5, 0, z), pr = P(o.x + 0.5, 0, z), pt = P(o.x - 0.5, 1.75, z);
      if (!pl) return;
      ctx.strokeStyle = "#3a2a20"; ctx.lineWidth = Math.max(1, 0.05 * pl.sx);
      ctx.beginPath(); ctx.moveTo(pl.x, pl.y); ctx.lineTo(pl.x, pt.y); ctx.moveTo(pr.x, pr.y); ctx.lineTo(pr.x, pt.y); ctx.stroke();
      var m = marketAt(o.pos), bcol = m.can[o.v % 4];
      var bb = box(o.x, 1.02, o.h, 0.78, z, o.len, bcol);
      if (bb) {
        var txt = ["SALE!", "₦500", "OYA COME", "BUY 1 GET 1"][o.v];
        var fs2 = (bb.b - bb.t) * 0.36;
        if (fs2 > 5) { ctx.fillStyle = bcol === "#f8fafc" || bcol === "#e5e7eb" || bcol === "#facc15" || bcol === "#ffbf3c" ? "#1f2937" : "#fff"; ctx.font = "700 " + fs2 + "px Fredoka, system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(txt, (bb.l + bb.r) / 2, (bb.t + bb.b) / 2, bb.r - bb.l - 4); }
      }
    }
    ctx.globalAlpha = 1;
  }
  function drawLow(o, z) {
    var v = o.v;
    if (v === "barrow") {
      var t = box(o.x, 0.85, 0.28, 0.42, z, 0.8, "#2f7d4f");
      var w = P(o.x, 0.16, z - 0.02); if (w) { ctx.fillStyle = "#1f2937"; ctx.beginPath(); ctx.arc(w.x, w.y, 0.16 * w.sx, 0, Math.PI * 2); ctx.fill(); }
      if (t) { ctx.fillStyle = "#d62828"; for (var i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(t.l + (t.r - t.l) * (0.15 + i * 0.17), t.t, t.s * 0.09, 0, Math.PI * 2); ctx.fill(); } }
    } else if (v === "basket") {
      var b = box(o.x, 0.9, 0, 0.62, z, 0.8, "#a8742f");
      if (b) {
        ctx.strokeStyle = "rgba(90,50,10,.55)"; ctx.lineWidth = 1;
        for (var k = 1; k < 4; k++) { var yy = b.t + (b.b - b.t) * k / 4; ctx.beginPath(); ctx.moveTo(b.l, yy); ctx.lineTo(b.r, yy); ctx.stroke(); }
        ctx.fillStyle = "#e11d1d"; for (var j = 0; j < 6; j++) { ctx.beginPath(); ctx.arc(b.l + (b.r - b.l) * (0.12 + j * 0.15), b.t - b.s * 0.04, b.s * 0.085, 0, Math.PI * 2); ctx.fill(); }
      }
    } else if (v === "tyres") {
      for (var n = 0; n < 3; n++) {
        var c = P(o.x, 0.12 + n * 0.22, z);
        if (!c) continue;
        ctx.fillStyle = "#111827"; ctx.beginPath(); ctx.ellipse(c.x, c.y, 0.45 * c.sx, 0.13 * c.sy, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#374151"; ctx.beginPath(); ctx.ellipse(c.x, c.y - 0.03 * c.sy, 0.2 * c.sx, 0.05 * c.sy, 0, 0, Math.PI * 2); ctx.fill();
      }
    } else if (v === "crate") {
      var cr = box(o.x, 0.9, 0, 0.72, z, 0.8, "#b08158");
      if (cr) { ctx.strokeStyle = "rgba(80,45,15,.6)"; ctx.lineWidth = Math.max(1, cr.s * 0.03); ctx.beginPath(); ctx.moveTo(cr.l, cr.t); ctx.lineTo(cr.r, cr.b); ctx.moveTo(cr.r, cr.t); ctx.lineTo(cr.l, cr.b); ctx.stroke(); }
    } else if (v === "bales") {
      var cols = ["#e63946", "#2a9d8f", "#ffbf3c"];
      for (var q = 0; q < 3; q++) box(o.x, 0.92 - q * 0.08, q * 0.25, 0.25, z, 0.8, cols[(q + Math.floor(o.pos)) % 3]);
    } else if (v === "drums") {
      [-0.25, 0.25].forEach(function (dx, i) {
        var d = box(o.x + dx, 0.38, 0, 0.7, z, 0.4, i ? "#92400e" : "#78350f");
        if (d) { ctx.strokeStyle = "#f5deb3"; ctx.lineWidth = 1; for (var s = 0; s < 4; s++) { var xx = d.l + (d.r - d.l) * (s + 0.5) / 4; ctx.beginPath(); ctx.moveTo(xx, d.t); ctx.lineTo(xx, d.b); ctx.stroke(); } }
      });
    }
  }
  function drawDanfo(o, z) {
    var f = box(o.x, 0.95, 0.12, 1.63, z, o.len, "#f7c600");
    if (!f) return;
    var w = f.r - f.l, h = f.b - f.t;
    ctx.fillStyle = "#111"; ctx.fillRect(f.l, f.t + h * 0.55, w, h * 0.07); ctx.fillRect(f.l, f.t + h * 0.7, w, h * 0.07);
    ctx.fillStyle = "#1e3a5f"; ctx.fillRect(f.l + w * 0.08, f.t + h * 0.1, w * 0.84, h * 0.36);
    ctx.fillStyle = "rgba(255,255,255,.25)"; ctx.fillRect(f.l + w * 0.1, f.t + h * 0.12, w * 0.3, h * 0.1);
    ctx.fillStyle = "#fff7c2"; ctx.beginPath(); ctx.arc(f.l + w * 0.15, f.t + h * 0.86, w * 0.07, 0, Math.PI * 2); ctx.arc(f.r - w * 0.15, f.t + h * 0.86, w * 0.07, 0, Math.PI * 2); ctx.fill();
    if (w > 60) { ctx.fillStyle = "#111"; ctx.font = "700 " + w * 0.09 + "px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(["OSHODI", "OBALENDE", "CMS", "IKEJA"][Math.floor(o.pos) % 4], (f.l + f.r) / 2, f.t + h * 0.04 + 6); }
    var wl = P(o.x - 0.38, 0.12, z), wr = P(o.x + 0.38, 0.12, z);
    if (wl) { ctx.fillStyle = "#111"; ctx.beginPath(); ctx.ellipse(wl.x, wl.y, 0.1 * wl.sx, 0.13 * wl.sy, 0, 0, Math.PI * 2); ctx.ellipse(wr.x, wr.y, 0.1 * wr.sx, 0.13 * wr.sy, 0, 0, Math.PI * 2); ctx.fill(); }
  }
  function drawOkada(o, z) {
    var wf = P(o.x, 0.25, z), wb = P(o.x, 0.25, z + 1.2);
    if (!wf) return;
    ctx.fillStyle = "#111"; ctx.beginPath(); ctx.ellipse(wb.x, wb.y, 0.09 * wb.sx, 0.25 * wb.sy, 0, 0, Math.PI * 2); ctx.fill();
    box(o.x, 0.4, 0.35, 0.45, z + 0.2, 1.0, "#b91c1c");
    var r = box(o.x, 0.55, 0.8, 0.62, z + 0.6, 0.35, "#1d4ed8");
    var hd = P(o.x, 1.58, z + 0.7);
    if (hd) { ctx.fillStyle = "#facc15"; ctx.beginPath(); ctx.arc(hd.x, hd.y, 0.19 * hd.sx, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = "#111"; ctx.fillRect(hd.x - 0.15 * hd.sx, hd.y - 0.02 * hd.sy, 0.3 * hd.sx, 0.08 * hd.sy); }
    ctx.fillStyle = "#111"; ctx.beginPath(); ctx.ellipse(wf.x, wf.y, 0.1 * wf.sx, 0.26 * wf.sy, 0, 0, Math.PI * 2); ctx.fill();
    var hl = P(o.x, 0.75, z - 0.02);
    if (hl) { ctx.fillStyle = "rgba(255,245,180,.95)"; ctx.beginPath(); ctx.arc(hl.x, hl.y, 0.09 * hl.sx, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = "rgba(255,245,180,.18)"; ctx.beginPath(); ctx.arc(hl.x, hl.y, 0.35 * hl.sx, 0, Math.PI * 2); ctx.fill(); }
  }
  // The runner, seen from behind: ankara top, shorts, running cycle.
  function drawRunner() {
    if (invuln > 0 && Math.floor(anim * 12) % 2 && crashT <= 0) return;
    var g = P(px, 0, 0), p = P(px, py, 0); if (!g) return;
    var sx = p.sx, sy = p.sy, slide = slideT > 0, crash = crashT > 0;
    ctx.fillStyle = "rgba(0,0,0,.28)"; ctx.beginPath(); ctx.ellipse(g.x, g.y, 0.32 * sx * (1 - py * 0.2), 0.08 * sy, 0, 0, Math.PI * 2); ctx.fill();
    ctx.save(); ctx.translate(p.x, p.y);
    var lean = (LX[lane] - px) * 0.25 + (crash ? 1.3 : 0);
    ctx.rotate(lean);
    var ph = dist * 1.6, sw = Math.sin(ph), air = py > 0.05;
    var hip = slide ? 0.45 : 0.78, sh = slide ? 0.95 : 1.35;
    ctx.lineCap = "round";
    // legs
    ctx.strokeStyle = "#5a3420"; ctx.lineWidth = 0.13 * sx;
    if (slide) { ctx.beginPath(); ctx.moveTo(-0.08 * sx, -hip * sy); ctx.lineTo(-0.1 * sx, -0.05 * sy); ctx.moveTo(0.08 * sx, -hip * sy); ctx.lineTo(0.14 * sx, -0.08 * sy); ctx.stroke(); }
    else {
      var l1 = air ? 0.25 : sw * 0.28, l2 = air ? -0.1 : -sw * 0.28;
      ctx.beginPath(); ctx.moveTo(-0.1 * sx, -hip * sy); ctx.lineTo(-0.1 * sx, -(0.1 + Math.max(0, l1)) * sy); ctx.moveTo(0.1 * sx, -hip * sy); ctx.lineTo(0.1 * sx, -(0.1 + Math.max(0, l2)) * sy); ctx.stroke();
      ctx.fillStyle = "#f8fafc"; // trainers
      [[-0.1, l1], [0.1, l2]].forEach(function (f) { ctx.beginPath(); ctx.ellipse(f[0] * sx, -(0.08 + Math.max(0, f[1])) * sy, 0.07 * sx, 0.04 * sy, 0, 0, Math.PI * 2); ctx.fill(); });
    }
    // shorts
    ctx.fillStyle = "#1e3a8a"; ctx.fillRect(-0.22 * sx, -(hip + 0.08) * sy, 0.44 * sx, 0.22 * sy);
    // ankara top
    var ty = -sh * sy, th = (sh - hip) * sy;
    ctx.fillStyle = "#f97316"; ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-0.26 * sx, ty, 0.52 * sx, th, 0.08 * sx); else ctx.rect(-0.26 * sx, ty, 0.52 * sx, th);
    ctx.fill();
    ctx.fillStyle = "#15803d";
    for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) { ctx.beginPath(); ctx.arc((-0.16 + i * 0.16) * sx, ty + th * (0.2 + j * 0.3), 0.04 * sx, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = "#facc15"; for (var k = 0; k < 3; k++) { ctx.beginPath(); ctx.arc((-0.08 + k * 0.16) * sx, ty + th * (0.35 + (k % 2) * 0.3), 0.025 * sx, 0, Math.PI * 2); ctx.fill(); }
    // arms
    ctx.strokeStyle = "#5a3420"; ctx.lineWidth = 0.1 * sx;
    var a1 = air ? -0.5 : -sw * 0.3;
    ctx.beginPath(); ctx.moveTo(-0.26 * sx, ty + th * 0.15); ctx.lineTo(-0.36 * sx, ty + th * (0.75 + a1 * 0.5)); ctx.moveTo(0.26 * sx, ty + th * 0.15); ctx.lineTo(0.36 * sx, ty + th * (0.75 - a1 * 0.5)); ctx.stroke();
    // head + hair
    var hy = ty - 0.2 * sy;
    ctx.fillStyle = "#5a3420"; ctx.beginPath(); ctx.arc(0, hy, 0.19 * sx, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#1a1a1a"; ctx.beginPath(); ctx.arc(0, hy - 0.02 * sy, 0.2 * sx, Math.PI * 1.02, Math.PI * 1.98); ctx.fill();
    ctx.beginPath(); ctx.arc(0, hy, 0.17 * sx, 0, Math.PI * 2); ctx.globalAlpha = 0.9; ctx.fill(); ctx.globalAlpha = 1; // back of the head
    ctx.restore();
    if (slide) { ctx.fillStyle = "rgba(200,170,140,.5)"; for (var d = 0; d < 4; d++) { ctx.beginPath(); ctx.arc(g.x + (d - 1.5) * 0.18 * sx, g.y - 0.02 * sy, (0.05 + (anim * 7 + d) % 1 * 0.06) * sx, 0, Math.PI * 2); ctx.fill(); } }
  }

  function render() {
    var m = marketAt(dist);
    camX += ((px * 0.55) - camX) * 0.18;
    ctx.save();
    if (shake > 0) ctx.translate((Math.random() - 0.5) * 10 * shake, (Math.random() - 0.5) * 10 * shake);
    sky(m);
    drawGround(m);
    // everything with a depth, far to near
    var items = [], k0 = Math.floor((dist - CAMB) / 5), k1 = Math.floor((dist + FAR) / 5);
    for (var k = k1; k >= k0; k--) { var zz = k * 5 - dist; items.push({ z: zz, f: drawStall, a: -1, k: k }); items.push({ z: zz + 0.01, f: drawStall, a: 1, k: k }); }
    var s0 = Math.ceil((dist - CAMB) / SECTION), s1 = Math.floor((dist + FAR) / SECTION);
    for (var s = Math.max(0, s0); s <= s1; s++) {
      var isFinish = mode === "race" && s * SECTION === RACE_LEN && state !== "menu";
      if (mode === "race" && s * SECTION > RACE_LEN && state !== "menu") continue;
      items.push({ z: (s ? s * SECTION : 14) - dist + 0.5, arch: s * SECTION, fin: isFinish }); // the first arch sits just past the start line
    }
    for (var i = 0; i < objs.length; i++) if (!objs[i].gone) items.push({ z: objs[i].pos - dist, o: objs[i] });
    items.push({ z: 0.0001, runner: true });
    items.sort(function (a, b) { return b.z - a.z; });
    for (var j = 0; j < items.length; j++) {
      var it = items[j];
      if (it.runner) drawRunner();
      else if (it.o) drawObj(it.o);
      else if (it.arch != null) drawArch(it.arch || 14, marketAt(it.arch + 1), it.fin);
      else drawStall(it.a, it.k, it.z, marketAt(it.k * 5));
    }
    // speed streaks when fast
    if (state === "run" && speed > 17) {
      ctx.strokeStyle = "rgba(255,255,255," + Math.min(0.25, (speed - 17) / 30) + ")"; ctx.lineWidth = 1.5;
      for (var n = 0; n < 6; n++) { var a = hash(Math.floor(anim * 20) + n * 13), y = HOR + (H - HOR) * (0.2 + a * 0.6), x = a < 0.5 ? W * a * 0.4 : W - W * (1 - a) * 0.4; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (x < W / 2 ? -30 : 30), y + 18); ctx.stroke(); }
    }
    ctx.restore();
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    var dt = Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now;
    if (state === "paused" || state === "closed") { render(); return; }
    update(dt);
    render();
  }

  /* ---------- wiring ---------- */
  function hook() {
    var b = document.getElementById("btnRush");
    if (b) b.addEventListener("click", function () { open(); });
  }
  window.RBRush = { open: open, close: close, startRun: startRun, _debug: function () { return { state: state, dist: dist, lane: lane, px: px, py: py, hearts: hearts, coins: coins, time: time, objs: objs.length, mode: mode }; } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", hook); else hook();
})();
