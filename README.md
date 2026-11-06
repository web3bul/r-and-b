# R & B 💜

A Wordle-style word game for two, played live as a Telegram Mini App.

One player sets a secret five-letter word, and the other gets six guesses to find it. Then you swap. The first to 30 points wins the round.

## Rules
- Points for solving: 6 for 1 guess, 5 for 2, and so on down to 1 for 6 guesses.
- If the guesser misses, the setter gets +2 for stumping them.
- Each guess has a 15-second clock. If it runs out, that guess is lost (change `GUESS_SECONDS` in `js/config.js`).
- A hint reveals one letter and costs 1 point.
- When you set a word, you can add a clue or tap **Surprise me** for a random word with an automatic clue.
- After each result, you can send a taunt, and your partner sees it straight away.

## How it works
- **Live game**: both phones share one game stored in Firebase (Firestore), so turns, guesses, taunts and scores update instantly.
- **Invite once**: the creator sends a single invite link. After that, both players just open the game from the bot.
- **Live tracker**: while your partner guesses your word, you can watch them type each letter, see their colours and see their countdown.
- **Bot pings**: if your partner isn't in the app, the bot messages them in Telegram with a Play button.
- **Free to run**: it uses Firebase's free Spark plan and Vercel's free plan.

## Files
- `index.html`, `css/style.css` — the screens and the purple-to-pink look
- `js/app.js` — game logic
- `js/config.js` — bot name, game rules and Firebase project settings
- `js/firebase-entry.js` — connection to Firebase (bundled into `js/net.js` at build time)
- `js/mock.js` — a fake database for local testing only (`?mock=a` and `?mock=b` in two tabs)
- `js/answers.js` — words for "Surprise me", each with a clue (add your own!)
- `api/notify.js` — sends turn alerts through the bot, only for genuine Telegram users
- `api/bot.js` — replies to /start with a Play button
- `api/setup.js` — open once to connect the bot (webhook and Play menu button)
- `firestore.rules` — database security rules (paste into the Firebase console)
- `scripts/build.js` — builds `dist/`, run automatically by Vercel

## One-time setup
1. **Firestore**: in the Firebase console, go to Build → Firestore Database → Create database. Pick Production mode, then paste `firestore.rules` into the Rules tab and click Publish.
2. **Sign-in**: go to Build → Authentication → Get started, open the Sign-in method tab, and enable **Anonymous**.
3. **Bot token**: in Vercel, go to Project → Settings → Environment Variables and add `BOT_TOKEN` (from @BotFather), then redeploy.
4. **Connect the bot**: open `https://r-and-b.vercel.app/api/setup` once. It should say "All set ✅".
5. **Both players** open @RandB_game_Bot and tap **Start**, so the bot is allowed to message you.

## Coming next
- Live Duel (both racing at the same time)
