// google sign-in and the leaderboard. once google sign-in is switched on for this address, signing in is required to play,
// and every match counts toward the player's record and league points. until it's switched on, or if firebase can't be reached,
// the game stays open and finished matches wait on this computer for the next sign-in. it loads after the game has started,
// so it never holds the game up
import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc, serverTimestamp, collection, query, where, orderBy, limit, getDocs } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js';
import { blank, clean, fold, describe } from './record.js';

const KEY = 'AIzaSyAHY1iSkH-SV1S2g_lQAfjL6KxDzL3sydY';
const app = initializeApp({
  apiKey: KEY,
  authDomain: 'flickpong-game.firebaseapp.com',
  projectId: 'flickpong-game',
  storageBucket: 'flickpong-game.firebasestorage.app',
  messagingSenderId: '630889402272',
  appId: '1:630889402272:web:27094bdbd87b07e5ed1ec5',
});
const auth = getAuth(app), db = getFirestore(app), provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

const $ = id => document.getElementById(id);
// at most this many finished matches wait on this computer for a sign-in, and this many leaders are fetched
const KEEP = 50, LEADERS = 50;
// firestore keeps retrying when it can't reach the database, so a request gets a deadline instead
const deadline = (p, ms = 10000) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(Object.assign(new Error('timeout'), { code: 'timeout' })), ms))]);
const waiting = () => { try { return JSON.parse(localStorage.getItem('tt.waiting')) || []; } catch (e) { return []; } };
const keepWaiting = list => { try { localStorage.setItem('tt.waiting', JSON.stringify(list.slice(-KEEP))); } catch (e) {} };
const make = (tag, props = {}) => Object.assign(document.createElement(tag), props);

// required: null until firebase has said whether google sign-in is switched on for this address
let me = null, record = null, saving = false, noteTimer = 0, leaders = [], required = null, known = false;

function note(text = '', secs = 0) {
  clearTimeout(noteTimer);
  for (const id of ['accountNote', 'gateNote']) {
    $(id).textContent = text;
    $(id).hidden = !text;
  }
  if (text && secs) noteTimer = setTimeout(() => note(), secs * 1000);
}

// asks firebase directly, so the game never locks players out before sign-in actually works here
async function signInIsOn() {
  try {
    const r = await deadline(fetch(`https://www.googleapis.com/identitytoolkit/v3/relyingparty/getProjectConfig?key=${KEY}`).then(x => x.json()), 6000);
    const google = (r.idpConfig || []).some(p => p.enabled && /google/i.test(p.provider || ''));
    return google && (r.authorizedDomains || []).includes(location.hostname);
  } catch (e) {
    return false;
  }
}

// the game waits behind the sign-in card until the player may start
function decide() {
  if (required === null || !known) return;
  const open = !required || !!me;
  $('gate').hidden = open;
  dispatchEvent(new CustomEvent('tt:gate', { detail: { open } }));
}

function render() {
  $('me').hidden = !me;
  $('account').hidden = !me && !$('accountNote').textContent;
  if (!me) return;
  $('meName').textContent = (me.displayName || me.email || 'Player').split(' ')[0];
  const pic = $('mePic');
  if (me.photoURL && !pic.firstChild) pic.append(make('img', { alt: '', referrerPolicy: 'no-referrer' }));
  if (me.photoURL) pic.firstChild.src = me.photoURL;
  pic.hidden = !me.photoURL;
  $('meRecord').textContent = record ? describe(record) : 'Loading your record';
}

/* ---------- the leaderboard ---------- */
function fill(list, count) {
  list.textContent = '';
  if (!leaders.length) {
    list.append(make('li', { className: 'empty', textContent: 'No wins yet. The first one tops the board.' }));
    return;
  }
  leaders.slice(0, count).forEach((p, i) => {
    const li = make('li', { className: me && p.uid === me.uid ? 'me' : '' });
    li.append(make('span', { className: 'rank', textContent: i + 1 }));
    li.append(p.photo ? make('img', { src: p.photo, alt: '', referrerPolicy: 'no-referrer' }) : make('span', { className: 'nopic' }));
    li.append(make('span', { className: 'who', textContent: p.name || 'Player' }), make('b', { textContent: p.score }));
    list.append(li);
  });
}

function showLeaders() {
  fill($('gateLeaders'), 10);
  fill($('leadersList'), 5);
  const i = me ? leaders.findIndex(p => p.uid === me.uid) : -1;
  $('myRank').textContent = !me ? '' : i >= 0 ? `You're number ${i + 1}` : record?.score ? `You're outside the top ${LEADERS}` : 'Win a match to get on the board';
}

async function loadLeaders() {
  try {
    const snap = await deadline(getDocs(query(collection(db, 'players'), where('score', '>', 0), orderBy('score', 'desc'), limit(LEADERS))));
    leaders = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
    showLeaders();
    document.body.classList.add('ranked');
  } catch (e) {
    console.warn('FlickPong: could not load the leaderboard', e);
  }
}

/* ---------- the player's record ---------- */
// adds every match waiting on this computer to the saved record, creating the record on the first sign-in
async function sync() {
  if (!me || saving) return;
  saving = true;
  const user = me, ref = doc(db, 'players', user.uid), list = waiting();
  try {
    const snap = await deadline(getDoc(ref));
    let rec = snap.exists() ? clean(snap.data()) : blank();
    for (const m of list) rec = fold(rec, m);
    const profile = { name: (user.displayName || 'Player').slice(0, 80), photo: (user.photoURL || '').slice(0, 500), lastSeen: serverTimestamp() };
    await deadline(setDoc(ref, { ...rec, ...profile, joinedAt: snap.exists() ? snap.data().joinedAt : serverTimestamp() }));
    // matches that finished while this was saving stay waiting for the next save
    keepWaiting(waiting().slice(list.length));
    if (me !== user) return;
    record = rec;
    render();
    showLeaders();
    if (list.length) note(list.length === 1 ? 'Match saved to your record' : `${list.length} matches saved to your record`, 3);
    if (list.some(m => m.won)) loadLeaders();
  } catch (e) {
    console.warn('FlickPong: could not save the record', e);
    note('Couldn\'t reach your record. It saves after the next match.', 5);
  } finally {
    saving = false;
  }
}

onAuthStateChanged(auth, user => {
  me = user;
  record = null;
  known = true;
  render();
  showLeaders();
  if (user) sync();
  decide();
});

// the game announces each finished match. signed in it's saved straight away, otherwise it waits here
addEventListener('tt:match', e => {
  keepWaiting([...waiting(), e.detail]);
  if (me) sync();
});

$('gateSignIn').addEventListener('click', async () => {
  note();
  $('gateSignIn').disabled = true;
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') return;
    note(e.code === 'auth/popup-blocked' ? 'Your browser blocked the sign-in window. Allow pop-ups for this site and try again.'
      : e.code === 'auth/network-request-failed' ? 'No connection. Try again.'
      : 'Sign-in didn\'t work. Try again.', 6);
  } finally {
    $('gateSignIn').disabled = false;
  }
});

// signing out starts over at the sign-in card
$('signOut').addEventListener('click', () => signOut(auth).then(() => location.reload()));

loadLeaders();
signInIsOn().then(on => {
  required = on;
  decide();
});
