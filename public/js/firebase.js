import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  getAuth,
  browserLocalPersistence,
  setPersistence
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

let initialized = null;

export async function initFirebase() {
  if (initialized) return initialized;

  initialized = (async () => {
    const response = await fetch('/__/firebase/init.json', { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(
        'Firebase Hosting configuration is unavailable. Run this app through Firebase Hosting or the Firebase Hosting emulator.'
      );
    }
    const config = await response.json();
    const app = initializeApp(config);
    const auth = getAuth(app);
    await setPersistence(auth, browserLocalPersistence);
    const db = getFirestore(app);
    return { app, auth, db, config };
  })();

  return initialized;
}
