import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js';

const app = initializeApp({
  apiKey: 'AIzaSyCKX5Es_5YluKI9tme8VJfGIoIy52lXQrc',
  authDomain: 'snapback-elastic.firebaseapp.com',
  projectId: 'snapback-elastic',
  storageBucket: 'snapback-elastic.firebasestorage.app',
  messagingSenderId: '419962992259',
  appId: '1:419962992259:web:9ee9314770545a95640db6',
});

const auth = getAuth(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

const $ = id => document.getElementById(id);
const signInBtn = $('signInBtn'), who = $('who'), pic = $('whoPic'), err = $('authErr');

function showError(msg) { err.textContent = msg; err.hidden = !msg; }

onAuthStateChanged(auth, user => {
  signInBtn.hidden = !!user;
  who.hidden = !user;
  if (!user) return;
  $('whoName').textContent = user.displayName || user.email;
  pic.hidden = !user.photoURL;
  if (user.photoURL) pic.src = user.photoURL;
});

signInBtn.addEventListener('click', async () => {
  showError('');
  signInBtn.disabled = true;
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') return;
    showError(e.code === 'auth/popup-blocked' ? 'Your browser blocked the sign-in window. Allow pop-ups and try again.'
      : e.code === 'auth/unauthorized-domain' ? 'Sign-in is not enabled for this address yet.'
      : 'Sign-in failed. Try again.');
  } finally {
    signInBtn.disabled = false;
  }
});

$('signOutBtn').addEventListener('click', () => signOut(auth));
