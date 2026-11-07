// R & B settings.
window.RB_CONFIG = {
  // Telegram bot + Mini App short name (the game opens at t.me/RandB_game_Bot/play)
  BOT_USERNAME: "RandB_game_Bot",
  APP_SHORT_NAME: "play",

  // Game rules
  POINTS_TO_WIN: 30,
  STUMP_BONUS: 2,
  MAX_GUESSES: 6,
  MIN_LEN: 3,        // shortest secret word allowed
  MAX_LEN: 5,        // longest secret word allowed
  GUESS_SECONDS: 15, // time allowed for each guess; when it runs out, that guess is lost
  FORFEIT_SPINS: 3,  // the round winner gets this many spins before locking a forfeit in

  // Forfeits the round loser has to do. Add, remove or edit freely.
  FORFEITS: [
    "Send the winner ₦500 💸",
    "Send the winner ₦1,000 💸",
    "Post the winner's picture on your status with a sweet caption 📸",
    "Buy the winner their favourite snack 🍫",
    "Treat the winner to suya 🍢",
    "Cook the winner's favourite meal 🍲",
    "Wash the dishes next time 🍽️",
    "Do one chore of the winner's choice 🧹",
    "Give the winner a 10-minute massage 💆",
    "Write the winner a 3-line love poem ✍️",
    "Send a voice note singing the winner's favourite song 🎤",
    "Send 5 genuine compliments right now 💌",
    "Plan the next date night 🌙",
    "Let the winner pick the next movie 🎬",
    "Send your silliest selfie 🤪",
    "Use a profile picture the winner chooses for 24 hours 🤳",
    "Dance for 30 seconds on a video call 💃",
    "Bring the winner breakfast in bed ☕",
    "Say \"You're the smartest person I know\" in a voice note 🧠",
    "Give the winner a big hug and 10 kisses 😘"
  ],

  // Solo mode: what the bot says, and the dares it gives you if it wins a round.
  BOT_NAME: "R&B Bot 🤖",
  BOT_TAUNTS_WIN: ["Beep boop. Too easy 🤖", "My circuits are warming up 🔥", "Is that all you've got? 😏", "Calculated. 🧠"],
  BOT_TAUNTS_LOSE: ["Okay, you got me 😅", "Recalculating… 🤖", "That word was evil 😤", "Rematch. Now. 🔥"],
  SOLO_DARES: [
    "Send a sweet text to someone you love 💌",
    "Do 15 push-ups 💪",
    "Drink a full glass of water 💧",
    "Dance to your favourite song for 1 minute 💃",
    "Tell someone a joke today 😂",
    "Tidy up around you for 5 minutes 🧹",
    "Take your silliest selfie 🤪",
    "Give someone a genuine compliment today 🌟",
    "Sing your favourite chorus out loud 🎤",
    "Stretch for 2 minutes 🧘"
  ],

  // Firebase project (safe to be public: it identifies the project, it isn't a password)
  FIREBASE: {
    apiKey: "AIzaSyCIFxy7QRcO3RWDjsZvOLI9txekYGrSUt4",
    authDomain: "r-and-b-e3996.firebaseapp.com",
    projectId: "r-and-b-e3996",
    storageBucket: "r-and-b-e3996.firebasestorage.app",
    messagingSenderId: "19315606564",
    appId: "1:19315606564:web:3eda8a0d6651a3099f84b1"
  }
};
