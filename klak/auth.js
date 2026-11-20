import { onAuthStateChanged, signInWithPopup, signOut } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js';
import { collection, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp, setDoc, updateDoc, where } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js';
import { auth, db, provider, withTimeout } from './firebase.js';

const $ = id => document.getElementById(id);
const signInBtn = $('signInBtn'), who = $('who'), pic = $('whoPic'), err = $('authErr');

function showError(msg) { err.textContent = msg; err.hidden = !msg; }

// The player's leaderboard row. Created on first sign-in (that is what the admin page counts as "joined").
let me = null, myBest = 0;
const localBest = () => { try { return +localStorage.getItem('snapback.best') || 0; } catch { return 0; } };

async function syncPlayer(user) {
  const ref = doc(db, 'players', user.uid);
  const profile = { name: user.displayName || 'Player', photo: user.photoURL || '', lastSeen: serverTimestamp() };
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    myBest = localBest();
    await setDoc(ref, { ...profile, best: myBest, level: 0, joinedAt: serverTimestamp() });
  } else {
    myBest = snap.data().best || 0;
    const best = Math.max(myBest, localBest());
    await updateDoc(ref, best > myBest ? { ...profile, best } : profile);
    myBest = best;
  }
  if (user.email) await setDoc(doc(db, 'emails', user.uid), { email: user.email });
}

onAuthStateChanged(auth, user => {
  me = user;
  signInBtn.hidden = !!user;
  who.hidden = !user;
  if (!user) return;
  $('whoName').textContent = user.displayName || user.email;
  pic.hidden = !user.photoURL;
  if (user.photoURL) pic.src = user.photoURL;
  syncPlayer(user).catch(e => console.warn('Klak: could not save player', e));
});

window.addEventListener('klak:score', async e => {
  const { score, level } = e.detail;
  if (!me || score <= myBest) return;
  const prev = myBest; myBest = score;
  try { await updateDoc(doc(db, 'players', me.uid), { best: score, level, lastSeen: serverTimestamp() }); }
  catch (e) { myBest = prev; console.warn('Klak: could not save score', e); }
});

const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
window.addEventListener('klak:board', async () => {
  const list = $('boardList'), note = $('boardNote');
  list.innerHTML = ''; note.textContent = 'Loading…'; note.hidden = false;
  try {
    const snap = await withTimeout(getDocs(query(collection(db, 'players'), where('best', '>', 0), orderBy('best', 'desc'), limit(25))));
    list.innerHTML = snap.docs.map((d, i) => {
      const p = d.data();
      return `<li${me && d.id === me.uid ? ' class="me"' : ''}><span class="rank">${i + 1}</span>`
        + (p.photo ? `<img src="${esc(p.photo)}" alt="" referrerpolicy="no-referrer">` : '<i></i>')
        + `<span class="name">${esc(p.name)}</span><b>${p.best}</b></li>`;
    }).join('');
    note.textContent = snap.empty ? 'No scores yet. Be the first.' : me ? '' : 'Sign in with Google to put your score on the board.';
    note.hidden = !note.textContent;
  } catch (e) {
    console.warn('Klak: could not load leaderboard', e);
    note.textContent = navigator.onLine ? 'The leaderboard is not available right now.' : 'You are offline.';
  }
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
