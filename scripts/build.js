// Builds the site into dist/:
//  - copies the page, styles and scripts
//  - bundles the Firebase SDK into js/net.js
//  - generates js/valid.js (all accepted guesses) from the word-list package
const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");

const root = path.join(__dirname, "..");
const dist = path.join(root, "dist");

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(path.join(dist, "js"), { recursive: true });
fs.mkdirSync(path.join(dist, "css"), { recursive: true });

// Stamp a version on every CSS/JS link so Telegram's in-app browser fetches fresh files after each update.
const ver = Date.now().toString(36);
const html = fs.readFileSync(path.join(root, "index.html"), "utf8")
  .replace(/(href="css\/[^"?]+\.css)"/g, "$1?v=" + ver + '"')
  .replace(/(src="js\/[^"?]+\.js)"/g, "$1?v=" + ver + '"');
fs.writeFileSync(path.join(dist, "index.html"), html);
fs.copyFileSync(path.join(root, "stats.html"), path.join(dist, "stats.html")); // owner-only stats page (data needs a password)
fs.copyFileSync(path.join(root, "css/style.css"), path.join(dist, "css/style.css"));
fs.copyFileSync(path.join(root, "css/rush.css"), path.join(dist, "css/rush.css"));
for (const f of ["app.js", "duel.js", "answers.js", "riddles.js", "rush.js", "config.js", "mock.js"]) {
  fs.copyFileSync(path.join(root, "js", f), path.join(dist, "js", f));
}

esbuild.buildSync({
  entryPoints: [path.join(root, "js/firebase-entry.js")],
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2020",
  outfile: path.join(dist, "js/net.js"),
  logLevel: "warning"
});
fs.copyFileSync(path.join(dist, "js/net.js"), path.join(root, "js/net.js")); // handy for local testing

const wordsFile = require.resolve("word-list/words.txt");
const words = fs.readFileSync(wordsFile, "utf8").split("\n").filter((w) => /^[a-z]{3,5}$/.test(w));
global.window = {};
eval(fs.readFileSync(path.join(root, "js/answers.js"), "utf8"));
const all = new Set(words);
window.RB_ANSWERS.forEach((a) => all.add(a.w));
eval(fs.readFileSync(path.join(root, "js/riddles.js"), "utf8"));
window.RB_RIDDLES.forEach((a) => all.add(a.w));
const list = [...all].sort();
const out = "// All 3- to 5-letter words accepted as guesses (generated at build time).\nwindow.RB_VALID=\"" + list.join(" ") + "\".split(\" \");\n";
fs.writeFileSync(path.join(dist, "js/valid.js"), out);
fs.writeFileSync(path.join(root, "js/valid.js"), out);

const kb = (f) => Math.round(fs.statSync(path.join(dist, f)).size / 1024) + " KB";
console.log("Built dist/: " + list.length + " valid words, " + window.RB_ANSWERS.length + " surprise words, net.js " + kb("js/net.js"));
