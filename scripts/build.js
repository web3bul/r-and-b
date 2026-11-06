// Builds the site into dist/ and generates js/valid.js (all accepted guesses)
// from the word-list package plus the words in js/answers.js.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const dist = path.join(root, "dist");

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(path.join(dist, "js"), { recursive: true });
fs.mkdirSync(path.join(dist, "css"), { recursive: true });

fs.copyFileSync(path.join(root, "index.html"), path.join(dist, "index.html"));
fs.copyFileSync(path.join(root, "css/style.css"), path.join(dist, "css/style.css"));
for (const f of ["app.js", "answers.js", "config.js"]) {
  fs.copyFileSync(path.join(root, "js", f), path.join(dist, "js", f));
}

const wordsFile = require.resolve("word-list/words.txt");
const words = fs.readFileSync(wordsFile, "utf8").split("\n").filter((w) => /^[a-z]{5}$/.test(w));

global.window = {};
eval(fs.readFileSync(path.join(root, "js/answers.js"), "utf8"));
const all = new Set(words);
window.RB_ANSWERS.forEach((a) => all.add(a.w));

const list = [...all].sort();
const out = "// All five-letter words accepted as guesses (generated at build time).\nwindow.RB_VALID=\"" + list.join(" ") + "\".split(\" \");\n";
fs.writeFileSync(path.join(dist, "js/valid.js"), out);
fs.writeFileSync(path.join(root, "js/valid.js"), out); // handy for local testing
console.log("Built dist/ with " + list.length + " valid words and " + window.RB_ANSWERS.length + " surprise words.");
