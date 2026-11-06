// Firebase data layer for R & B. Bundled into js/net.js at build time.
// Exposes window.RBNet: ready(), create(), join(), watch(), patch().
import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously, onAuthStateChanged } from "firebase/auth";
import { getFirestore, doc, setDoc, updateDoc, onSnapshot, arrayUnion } from "firebase/firestore";

if (!window.RBNet) {
  const app = initializeApp(window.RB_CONFIG.FIREBASE);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const ref = (id) => doc(db, "games", id);
  let readyPromise = null;

  window.RBNet = {
    // Signs in anonymously (once per device) and resolves with this device's user id.
    ready() {
      if (!readyPromise) {
        readyPromise = new Promise((resolve, reject) => {
          let off = null;
          off = onAuthStateChanged(auth, (user) => {
            if (user) { if (off) off(); resolve(user.uid); }
            else signInAnonymously(auth).catch((e) => { if (off) off(); reject(e); });
          }, reject);
        });
      }
      return readyPromise;
    },
    create(id, data) { return setDoc(ref(id), data); },
    join(id, uid, player, now) {
      return updateDoc(ref(id), { uids: arrayUnion(uid), players: arrayUnion(player), ["seen." + uid]: now });
    },
    watch(id, onData, onError) {
      return onSnapshot(ref(id), (snap) => onData(snap.exists() ? snap.data() : null), onError);
    },
    patch(id, fields) { return updateDoc(ref(id), fields); }
  };
}
