import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js';
import { getAuth, GoogleAuthProvider } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js';

const app = initializeApp({
  apiKey: 'AIzaSyCKX5Es_5YluKI9tme8VJfGIoIy52lXQrc',
  authDomain: 'snapback-elastic.firebaseapp.com',
  projectId: 'snapback-elastic',
  storageBucket: 'snapback-elastic.firebasestorage.app',
  messagingSenderId: '419962992259',
  appId: '1:419962992259:web:9ee9314770545a95640db6',
});

export const auth = getAuth(app);
export const db = getFirestore(app);
export const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

// Must match isAdmin() in firestore.rules.
export const ADMIN_EMAIL = 'sukhija.shivansh@gmail.com';
