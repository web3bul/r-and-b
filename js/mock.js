// Test-only stand-in for Firebase. Active only when the page URL has ?mock=<player>.
// Two tabs in the same browser (e.g. ?mock=a and ?mock=b) share one fake database.
(function () {
  var q = new URLSearchParams(location.search);
  var who = q.get("mock");
  if (!who) return;
  window.RB_MOCK = who;
  var uid = "uid_" + who;
  var KEY = "rb_mockdb";
  var watchers = [];
  function all() { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) { return {}; } }
  function fire() {
    var d = all();
    watchers.forEach(function (w) {
      var g = d[w.id];
      setTimeout(function () { w.cb(g ? JSON.parse(JSON.stringify(g)) : null); }, 20);
    });
  }
  function put(d) { localStorage.setItem(KEY, JSON.stringify(d)); fire(); }
  window.addEventListener("storage", function (e) { if (e.key === KEY) fire(); });
  function setPath(o, k, v) {
    var p = k.split("."), x = o;
    for (var i = 0; i < p.length - 1; i++) { x[p[i]] = x[p[i]] || {}; x = x[p[i]]; }
    x[p[p.length - 1]] = v;
  }
  window.RBNet = {
    ready: function () { return Promise.resolve(uid); },
    create: function (id, data) { var d = all(); d[id] = JSON.parse(JSON.stringify(data)); put(d); return Promise.resolve(); },
    join: function (id, u, player, now) {
      var d = all(), g = d[id];
      if (!g) return Promise.reject({ code: "not-found" });
      if (g.uids.indexOf(u) < 0) {
        if (g.uids.length >= 2) return Promise.reject({ code: "permission-denied" });
        g.uids.push(u); g.players.push(player);
      }
      g.seen = g.seen || {}; g.seen[u] = now; put(d); return Promise.resolve();
    },
    watch: function (id, cb) {
      var w = { id: id, cb: cb }; watchers.push(w); fire();
      return function () { watchers.splice(watchers.indexOf(w), 1); };
    },
    patch: function (id, fields) {
      var d = all(), g = d[id];
      if (!g) return Promise.reject({ code: "not-found" });
      Object.keys(fields).forEach(function (k) { setPath(g, k, JSON.parse(JSON.stringify(fields[k]))); });
      put(d); return Promise.resolve();
    }
  };
})();
