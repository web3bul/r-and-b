# R & B 💜

A Wordle-style word game for two, played live as a Telegram Mini App.

One player sets a secret word of 3 to 5 letters, and the other gets six guesses to find it. Then you swap. The first to 30 points wins the round.

## Rules
- Points for solving: 6 for 1 guess, 5 for 2, and so on down to 1 for 6 guesses.
- If the guesser misses, the setter gets +2 for stumping them.
- Each guess has a 10-second clock. If it runs out, that guess is lost (change `GUESS_SECONDS` in `js/config.js`). Leaving or closing the game pauses the clock, and it picks up where it stopped.
- When you type your own word, a clue is filled in automatically from the free dictionary at dictionaryapi.dev, with the word itself hidden. You can edit or clear it.
- **Forfeits**: whoever wins a round spins the forfeit wheel (3 spins, or write your own) and the loser has to do it, then taps "I did it ✅". Edit the list in `FORFEITS` in `js/config.js`.
- Secret words can be 3, 4 or 5 letters (set `MIN_LEN` / `MAX_LEN` in `js/config.js`). Type 3 or 4 letters and tap Send, or keep typing to 5.
- **Live Duel ⚡**: challenge your partner to a real-time race with a 3-2-1 countdown. Pick **Same word** (the game picks one word and you both race) or **Each other's words** (you each set one, then race). You watch their progress live as colours only (never their letters), plus when they're typing and when they try a word that doesn't exist. First to solve wins; if nobody does, the closest guess wins. Duel wins get their own line on the scoreboard, and you can make the loser spin the forfeit wheel.
- **Solo mode**: play against the R&B Bot. It sets you words with clues, then guesses yours live while you watch. If it wins a round, it gives you a dare. Everything stays on your phone. The bot never sees your word, only the colours of its own guesses, and it plays like a person (it sometimes misses a clue). Tap the level button to switch between Easy, Normal and Hard.
- A hint reveals one letter and costs 1 point.
- Your next row shows a guide from your earlier guesses: green letters sit back in their spot, and yellow letters are suggested in a spot they haven't been tried in yet. As you type, a letter turns green in its known spot, or gets a yellow edge if it's in the word.
- If the clock runs out while a complete word is typed, it counts as sent.
- When you set a word, you can add a clue or tap **Surprise me** for a random word with an automatic clue.
- After each result, you can send a taunt, and your partner sees it straight away.
- **Reactions**: while you watch your partner guess, tap 😂 😭 😱 👏 🤡 😘. Each one floats up their screen with its own sound effect (made in the browser, no audio files).

## How it works
- **Live game**: both phones share one game stored in Firebase (Firestore), so turns, guesses, taunts and scores update instantly.
- **Invite once**: the creator sends a single invite link. After that, both players just open the game from the bot.
- **Live tracker**: while your partner guesses your word, you can watch them type each letter, see their colours and see their countdown.
- **Bot pings**: if your partner isn't in the app, the bot messages them in Telegram with a Play button.
- **Free to run**: it uses Firebase's free Spark plan and Vercel's free plan.

## Files
- `index.html`, `css/style.css` — the screens and the purple-to-pink look
- `js/app.js` — game logic
- `js/duel.js` — Live Duel
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
