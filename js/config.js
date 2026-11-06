// R & B settings.
window.RB_CONFIG = {
  // Telegram bot + Mini App short name (the game opens at t.me/RandB_game_Bot/play)
  BOT_USERNAME: "RandB_game_Bot",
  APP_SHORT_NAME: "play",

  // Game rules
  POINTS_TO_WIN: 30,
  STUMP_BONUS: 2,
  MAX_GUESSES: 6,
  GUESS_SECONDS: 15, // time allowed for each guess; when it runs out, that guess is lost

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
