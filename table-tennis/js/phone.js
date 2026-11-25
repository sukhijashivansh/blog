// the controller page: reads how the phone points and moves and streams it to the game tab
import { Motion } from './motion.js';

const $ = id => document.getElementById(id);
const SEND_EVERY = 0.006, RETRY_MS = 2000, HOLD_MS = 350;
const SPEEDS = { gentle: 0.75, normal: 1, quick: 1.35 };
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, String(v)); } catch (e) {} } };
const r3 = n => Math.round(n * 1e3) / 1e3, r4 = n => Math.round(n * 1e4) / 1e4;
// when the sensor took the reading, on the same clock as performance.now
const stamp = e => (e.timeStamp > 0 && e.timeStamp < performance.now() + 1000 ? e.timeStamp : performance.now()) / 1000;
const id = location.hash.slice(1);
const motion = new Motion();

let peer = null, conn = null, started = false, retryTimer = 0, lastSend = 0, holdTimer = 0, sensed = false;
// for the game's lag monitor: readings a second, the longest wait between two, and how long a reading waited before this page saw it
let sense = { n: 0, gap: 0, wait: 0, waitMax: 0, last: 0 };

function status(text, on = false) {
  $('status').textContent = text;
  $('dot').classList.toggle('on', on);
}

function fail(text) {
  $('error').textContent = text;
  $('error').hidden = !text;
}

/* ---------- pairing ---------- */
function connect() {
  clearTimeout(retryTimer);
  if (!peer || peer.destroyed) return;
  if (peer.disconnected) { peer.reconnect(); return; }
  conn?.close();
  const c = conn = peer.connect(id, { serialization: 'json' });
  c.on('open', () => {
    if (c !== conn) return;
    status('Connected to the game', true);
    fail('');
    $('go').disabled = false;
  });
  c.on('data', onData);
  c.on('close', () => { if (c === conn) lost(); });
  c.on('error', () => { if (c === conn) lost(); });
}

function lost() {
  conn = null;
  status('Lost the game. Reconnecting');
  clearTimeout(retryTimer);
  retryTimer = setTimeout(connect, RETRY_MS);
}

function pair() {
  if (!id) { status('Not paired'); fail('Open the game on your computer and scan the code it shows.'); return; }
  if (!window.peerjs) { fail('The pairing library did not load. Reload the page.'); return; }
  peer = new window.peerjs.Peer({ debug: 0 });
  peer.on('open', connect);
  peer.on('disconnected', () => { clearTimeout(retryTimer); retryTimer = setTimeout(connect, RETRY_MS); });
  peer.on('error', e => {
    if (e.type === 'peer-unavailable') { status('Looking for the game'); fail('Can\'t find the game. Keep it open on your computer. Trying again.'); }
    else if (e.type === 'browser-incompatible') { fail('This browser can\'t connect directly to your computer. Try Safari or Chrome.'); return; }
    else status('No connection. Retrying');
    clearTimeout(retryTimer);
    retryTimer = setTimeout(connect, RETRY_MS);
  });
}

function send(msg) { if (conn?.open) conn.send(msg); }

/* ---------- what the game tells the phone ---------- */
function onData(d) {
  if (!d || typeof d !== 'object') return;
  // answering with this phone's own clock lets the game line the two clocks up and time each reading's trip
  if (d.k === 'ping') send({ k: 'pong', t: d.t, p: performance.now() });
  if (d.k === 'buzz') buzz(clamp(d.ms | 0, 5, 200));
  if (d.k === 'menu') showMenu(d);
}

// iPhones have no vibration API, but Safari ticks the haptic engine when a switch toggles
function buzz(ms) {
  if (navigator.vibrate) navigator.vibrate(ms);
  else $('tick').click();
}

function showMenu({ title, sub, items }) {
  $('title').textContent = title || 'Playing';
  $('sub').textContent = sub || '';
  $('sub').hidden = !sub;
  const box = $('menu');
  box.textContent = '';
  for (const it of Array.isArray(items) ? items : []) {
    const b = document.createElement('button');
    const name = document.createElement('b'), note = document.createElement('small');
    name.textContent = it.label;
    note.textContent = it.note || '';
    b.append(name);
    if (it.note) b.append(note);
    b.addEventListener('click', () => { send({ k: 'tap', n: it.n }); buzz(10); });
    box.append(b);
  }
}

/* ---------- sensors ---------- */
// each reading goes out the moment it lands, not on the next screen refresh, so nothing waits
function onOrient(e) {
  if (e.alpha == null || e.beta == null || e.gamma == null) return;
  const t = stamp(e), wait = performance.now() / 1000 - t;
  sensed = true;
  sense.n++;
  if (sense.last) sense.gap = Math.max(sense.gap, t - sense.last);
  sense.last = t;
  sense.wait += wait;
  sense.waitMax = Math.max(sense.waitMax, wait);
  motion.orient(e.alpha, e.beta, e.gamma, t);
  if (t - lastSend < SEND_EVERY) return;
  lastSend = t;
  const s = motion.sample();
  send({ k: 'm', t: r4(s.t), yaw: r4(s.yaw), pitch: r4(s.pitch), twist: r3(s.twist), s: s.s.map(r3) });
}

function onMotion(e) { motion.motion(e.acceleration, e.accelerationIncludingGravity, stamp(e)); }

function recenter() {
  motion.recenter();
  const c = $('center');
  c.classList.add('flash');
  setTimeout(() => c.classList.remove('flash'), 300);
  buzz(15);
}

// recentering needs a press and hold, so a thumb resting on the screen mid-rally can't move the paddle
function holdStart(e) {
  e.preventDefault();
  clearTimeout(holdTimer);
  $('center').classList.add('holding');
  holdTimer = setTimeout(() => { $('center').classList.remove('holding'); recenter(); }, HOLD_MS);
}

function holdEnd() {
  clearTimeout(holdTimer);
  $('center').classList.remove('holding');
}

function setSpeed(name) {
  if (!SPEEDS[name]) name = 'normal';
  motion.sens = SPEEDS[name];
  store.set('tt.speed', name);
  for (const b of document.querySelectorAll('[data-speed]')) b.setAttribute('aria-pressed', String(b.dataset.speed === name));
}

async function keepAwake() {
  try { await navigator.wakeLock?.request('screen'); } catch (e) {}
}

// iPhones only hand out motion data after a tap asks for it
async function start() {
  const ask = async E => (typeof E?.requestPermission === 'function' ? E.requestPermission() : 'granted');
  try {
    const [o, m] = await Promise.all([ask(window.DeviceOrientationEvent), ask(window.DeviceMotionEvent)]);
    if (o !== 'granted' || m !== 'granted') { fail('Motion access was turned down. Reload the page and tap Allow.'); return; }
  } catch (e) {
    fail('Motion access needs a secure (https) page. Open the game from its https link.');
    return;
  }
  if (!started) {
    started = true;
    addEventListener('deviceorientation', onOrient);
    addEventListener('devicemotion', onMotion);
  }
  keepAwake();
  setTimeout(() => {
    if (!sensed) { fail('This phone isn\'t sending motion data. It needs a gyroscope, and some browsers block it on non-https pages.'); return; }
    recenter();
    $('intro').hidden = true;
    $('pad').hidden = false;
  }, 300);
}

setInterval(() => {
  if (started) send({ k: 'pstat', hz: sense.n, gap: r3(sense.gap), wait: sense.n ? r4(sense.wait / sense.n) : 0, waitMax: r4(sense.waitMax) });
  sense = { n: 0, gap: 0, wait: 0, waitMax: 0, last: sense.last };
}, 1000);

$('go').addEventListener('click', start);
$('center').addEventListener('pointerdown', holdStart);
for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) $('center').addEventListener(ev, holdEnd);
for (const b of document.querySelectorAll('[data-speed]')) b.addEventListener('click', () => setSpeed(b.dataset.speed));
setSpeed(store.get('tt.speed'));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  if (started) keepAwake();
  if (!conn?.open) connect();
});
pair();
