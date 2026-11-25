import { NEAR, FAR, LEVELS, clamp } from './config.js';
import { Game } from './game.js';
import { PhoneLink, isLocal } from './phone-link.js';
import { Monitor } from './monitor.js';
import { PhonePaddle } from './phone-paddle.js';
import { View } from './view.js';
import { Sound } from './sound.js';
import { Hud } from './hud.js';

const $ = id => document.getElementById(id);
// GRACE rides out dropped readings. the game only pauses once the phone has really gone quiet
const FIND = 0.4, GRACE = 0.5, LOST_AFTER = 2.2, BACK_AFTER = 0.3, COUNTDOWN = 3, FORMAT_WAIT = 5;
const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, String(v)); } catch (e) {} } };
const link = new PhoneLink(), paddle = new PhonePaddle(), game = new Game(), sound = new Sound(), hud = new Hud();
// lag compensation guesses ahead by this share of the measured lag. P steps through them
const COMPENSATE = [0, 0.5, 1];
// the panel starts hidden and D shows it. run locally, the numbers are reported either way
const monitor = new Monitor($('debug'), { show: new URLSearchParams(location.search).has('debug'), report: isLocal() });
link.stream.predict = COMPENSATE.includes(+store.get('tt.comp')) ? +store.get('tt.comp') : 0;
let view, mode = 'boot', resume = 'play', last = 0, timer = 0, levelId = 2, bestOf = 3, found = 0, firstServer = NEAR, tapped = null;
// true while the sign-in card holds the game. if sign-in can't load or doesn't answer in time, the game opens anyway
let gated = true;
const GATE_WAIT = 12000;
let lesson = 0, lessonDone = 0, nextIn = 0, sides = { l: false, r: false };

const LESSONS = [
  { key: 'move', title: 'Point your phone', sub: 'The red paddle goes where you point. Touch the ring on each side.', demo: 'sway', need: 2 },
  { key: 'hit', title: 'Meet the ball', sub: 'Point at the blue ring. Holding still sends it back, a flick hits harder.', demo: 'meet', need: 3 },
  { key: 'serve', title: 'Now serve', sub: 'Tip or flick your phone up to toss the ball, then flick again as it falls.', demo: 'lift', need: 1 },
];
const lessonSay = L => hud.say(L.title, L.sub, L.demo);

/* ---------- menus are answered by tapping on the phone ---------- */
function pick(allowed) {
  if (tapped === null || !allowed.includes(tapped)) return null;
  const n = tapped;
  tapped = null;
  return n;
}

function askLevel() {
  mode = 'level';
  hud.say('Pick your level', 'Tap one on your phone');
  hud.choices([
    { n: 1, label: 'Beginner', note: 'Slow and friendly' },
    { n: 2, label: 'Club', note: 'A fair game' },
    { n: 3, label: 'Pro', note: 'Fast, with spin' },
  ]);
  hud.hint('Your phone can replay the warm-up too');
}

function askFormat() {
  mode = 'format';
  timer = FORMAT_WAIT;
  hud.say(`${LEVELS[levelId].name}. How long?`, 'Tap one on your phone');
  hud.choices([
    { n: 1, label: 'One game', note: 'First to 11' },
    { n: 2, label: 'Best of 3', note: 'First to 2 games' },
    { n: 3, label: 'Best of 5', note: 'First to 3 games' },
  ]);
}

function coinToss() {
  mode = 'coin';
  timer = 1.8;
  firstServer = Math.random() < 0.5 ? NEAR : FAR;
  hud.choices();
  hud.hint();
  hud.say('Coin toss', firstServer === NEAR ? 'You serve first' : 'Opponent serves first');
}

function kickOff() {
  game.start(levelId, bestOf, firstServer);
  view.setReach(game.level.hitRadius);
  $('board').hidden = false;
  mode = 'play';
  hud.say('');
  hud.board(game);
}

/* ---------- the warm-up teaches by doing, and the phone can skip it ---------- */
function startCoach() {
  mode = 'coach';
  nextIn = 0;
  sides = { l: false, r: false };
  $('board').hidden = true;
  hud.choices();
  hud.hint('Skip it from your phone');
  teach(0);
}

function teach(i) {
  lesson = i;
  lessonDone = 0;
  const L = LESSONS[i];
  lessonSay(L);
  hud.pips(0, L.need);
  if (L.key === 'move') view.setBeacons([{ x: -0.5, on: !sides.l }, { x: 0.5, on: !sides.r }]);
  if (L.key === 'hit') {
    game.start(1, 1, FAR, { server: FAR });
    view.setReach(game.level.hitRadius);
  }
  if (L.key === 'serve') {
    game.practice.server = NEAR;
    game.beginPoint();
  }
}

function lessonProgress(n) {
  lessonDone = n;
  hud.pips(n, LESSONS[lesson].need);
  if (n >= LESSONS[lesson].need) { hud.flash('Nice!', 0.8, true); nextIn = 0.8; }
}

function finishCoach() {
  store.set('tt.warm', 1);
  game.phase = 'idle';
  game.drain();
  view.setBeacons([]);
  hud.pips(0, 0);
  hud.meter(0);
  askLevel();
}

const FLOW = {
  find(dt, s) {
    pairing();
    if (gated) return;
    found = clamp(found + (s ? dt : -dt * 0.6), 0, FIND);
    hud.meter(found / FIND);
    if (found < FIND) return;
    paddle.calibrate();
    hud.meter(0);
    document.body.classList.remove('finding');
    if (store.get('tt.warm')) askLevel();
    else startCoach();
  },
  coach(dt, s, now, pose) {
    if (lostPhone(now)) return;
    if (pick([0]) === 0) { finishCoach(); return; }
    if (nextIn > 0) {
      nextIn -= dt;
      if (nextIn <= 0) { if (lesson < LESSONS.length - 1) teach(lesson + 1); else finishCoach(); }
      return;
    }
    const L = LESSONS[lesson];
    if (L.key === 'move') {
      if (pose.p.x < -0.38) sides.l = true;
      if (pose.p.x > 0.38) sides.r = true;
      view.setBeacons([{ x: -0.5, on: !sides.l }, { x: 0.5, on: !sides.r }]);
      const n = (sides.l ? 1 : 0) + (sides.r ? 1 : 0);
      if (n !== lessonDone) lessonProgress(n);
    } else if (L.key === 'serve') {
      if (game.phase === 'toss') hud.say('Swing!', 'Flick as it falls', 'swing');
      else lessonSay(L);
    }
  },
  level() {
    const got = pick([0, 1, 2, 3]);
    if (got === 0) startCoach();
    else if (got) { levelId = got; askFormat(); }
  },
  format(dt) {
    const got = pick([1, 2, 3]);
    timer -= dt;
    hud.hint(`Starting best of 3 in ${Math.max(Math.ceil(timer), 1)}`);
    if (got || timer <= 0) { bestOf = got ? got * 2 - 1 : 3; coinToss(); }
  },
  coin(dt) {
    timer -= dt;
    if (timer <= 0) kickOff();
  },
  play(dt, s, now) {
    if (lostPhone(now)) return;
    prompts();
  },
  paused(dt, s) {
    timer = clamp(timer + (s ? dt : -dt), 0, BACK_AFTER);
    hud.meter(timer / BACK_AFTER);
    if (timer < BACK_AFTER) return;
    hud.meter(0);
    timer = COUNTDOWN;
    mode = 'countdown';
  },
  countdown(dt) {
    timer -= dt;
    hud.say(String(Math.max(Math.ceil(timer), 1)), 'Get ready');
    if (timer > 0) return;
    game.padAt = null;
    mode = resume;
    if (resume === 'coach') lessonSay(LESSONS[lesson]);
    else hud.say('');
  },
  over() {
    const got = pick([1, 2]);
    if (got === 1) coinToss();
    else if (got === 2) askLevel();
  },
};

function lostPhone(now) {
  if (now - link.seen <= LOST_AFTER) return false;
  pause();
  return true;
}

function pause() {
  if (mode !== 'play' && mode !== 'coach') return;
  resume = mode;
  mode = 'paused';
  timer = 0;
  hud.say('Paused', 'Move your phone and the game carries on. If it went to sleep, open it again.', 'show');
}

function prompts() {
  if (game.phase === 'break') return;
  const yours = game.rally.server === NEAR;
  if (game.phase === 'serve' && yours) hud.say('Your serve', 'Tip or flick your phone up to toss the ball', 'lift');
  else if (game.phase === 'toss' && yours) hud.say('Swing!', 'Flick as it falls', 'swing');
  else hud.say('');
}

// says what happened and, when you lost the point, what to try next
function explain(e) {
  const r = e.reason;
  if (e.winner === NEAR) {
    if (r === 'Out' || r === 'Ball was going out') return 'Your point. Opponent hit it out';
    if (r === 'Ball did not cross the net') return 'Your point. Opponent hit the net';
    if (r.startsWith('Serve')) return 'Your point. Opponent missed the serve';
    return 'Your point. Opponent couldn\'t reach it';
  }
  if (r === 'Out') return 'Went long. Try a softer flick';
  if (r === 'Ball did not cross the net') return 'Into the net. Flick slightly upward';
  if (r.startsWith('Serve')) return 'Serve missed. Try a softer flick';
  return 'Missed it. Point at the blue ring early';
}

/* ---------- events coming out of the game ---------- */
function handle(e) {
  sound.play(e);
  if (e.type === 'hit') {
    view.hit(e.who, game.ball);
    if (e.who === NEAR && mode === 'play') hud.flash(`${e.side} ${e.name} · ${e.speed.toFixed(1)} m/s`, 1.1, true);
    if (e.who === NEAR) link.buzz(Math.round(clamp(e.speed * 4, 15, 60)));
  }
  if (mode === 'coach' && nextIn <= 0) {
    const key = LESSONS[lesson].key;
    if (key === 'hit' && e.type === 'hit' && e.who === NEAR && !e.late) lessonProgress(lessonDone + 1);
    if (key === 'serve' && e.type === 'serveIn' && e.who === NEAR) lessonProgress(lessonDone + 1);
    if (e.type === 'practice' && e.winner === FAR) hud.flash(key === 'serve' ? 'Close. Try another serve' : 'No problem, here comes another', 1.2);
  }
  if (e.type === 'retoss') hud.flash('Flick at it as it drops. Tip up to try again', 1.6);
  if (e.type === 'let') hud.flash('Let. Net serve, play it again');
  if (e.type === 'point') {
    hud.flash(explain(e), 1.5, e.winner === NEAR);
    hud.board(game);
  }
  if (e.type === 'serve' && mode === 'play') hud.board(game);
  if (e.type === 'game') hud.say(`Game ${e.last[0] > e.last[1] ? 'to you' : 'to opponent'}, ${e.last[0]}-${e.last[1]}`, 'Next game coming up');
  if (e.type === 'over') {
    const m = game.match, st = game.stats;
    mode = 'over';
    // the sign-in corner adds it to the player's record, or keeps it until they sign in
    dispatchEvent(new CustomEvent('tt:match', { detail: { level: LEVELS[levelId].name, won: e.winner === NEAR, pointsWon: st.won, pointsLost: st.lost, longest: st.longest, fastest: st.fastest } }));
    hud.say(e.winner === NEAR ? 'You win the match!' : 'Opponent wins the match',
      `Games ${m.games[0]}-${m.games[1]} (${m.history.map(g => g.join('-')).join(', ')}). Longest rally ${st.longest} shots, fastest shot ${st.fastest.toFixed(1)} m/s.`);
    hud.choices([{ n: 1, label: 'Rematch', note: 'Same settings' }, { n: 2, label: 'Change', note: 'Level and length' }]);
  }
}

function frame(ms) {
  requestAnimationFrame(frame);
  // menus and the paddle run on real time. only the ball's world is capped, so a slow frame can't teleport it
  const now = ms / 1000, real = clamp(now - last, 0, 0.25), dt = Math.min(real, 0.05);
  last = now;
  tapped = link.takeTap();
  const state = link.read(now), s = state && state.age < GRACE ? state : null, live = mode === 'play' || mode === 'coach';
  const pose = paddle.tick(real, now, live ? game.assist : null, state);
  FLOW[mode]?.(real, s, now, pose);
  const t0 = performance.now();
  if (live) game.update(dt, pose);
  for (const e of game.drain()) handle(e);
  hud.tick(real);
  const t1 = performance.now();
  view.render(game, pose, dt);
  monitor.frame(ms, real, state, link.theta, t1 - t0, performance.now() - t1);
  monitor.tick(ms, link, view.ratio);
  // while paused the code stays up too, since a phone page that was closed can take a while to count as gone
  $('pair').hidden = mode === 'find' ? link.paired : mode !== 'paused';
  // the leaderboard shows between matches, once there's one to show
  $('leaders').hidden = !document.body.classList.contains('ranked') || !['level', 'format', 'over'].includes(mode);
  // the network's share plus the little the playback buffer adds to keep the paddle smooth
  const total = link.lag === null ? null : link.lag + link.delay * 1000;
  const lag = total === null ? '' : `Phone ${Math.round(total)} ms${link.route ? ` · ${link.route}` : ''}`;
  if ($('lag').textContent !== lag) $('lag').textContent = lag;
  $('lag').classList.toggle('slow', total > 45 || link.route === 'relayed');
  link.menu(phoneMenu());
}

document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

// D shows the lag monitor. P steps lag compensation through off, half and full
addEventListener('keydown', e => {
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'd') monitor.toggle();
  if (k === 'p') {
    const next = COMPENSATE[(COMPENSATE.indexOf(link.stream.predict) + 1) % COMPENSATE.length];
    link.stream.predict = next;
    store.set('tt.comp', next);
    hud.flash(`Lag compensation ${{ 0: 'off', 0.5: 'half', 1: 'full' }[next]}`, 1.2, true);
  }
});

/* ---------- pairing: scan the code, then the phone streams straight to this tab ---------- */
function pairing() {
  const st = link.state;
  if (st === 'paired') hud.say('Phone connected', 'Tap Start on your phone, holding it like a remote pointed at this screen.', 'show');
  else if (st === 'offline') hud.say('Can\'t reach the pairing service', 'Check your internet connection. It keeps trying.');
  else if (st === 'unsupported') hud.say('This browser can\'t pair a phone', 'Try Chrome, Safari or Firefox.');
  else if (st === 'waiting') hud.say('Scan with your phone', 'Open your phone\'s camera, point it at the code and open the link.');
  else hud.say('Getting a pairing code', 'One moment.');
  // browsers keep a page silent until it's clicked, and the phone does everything else
  hud.hint(sound.ctx?.state === 'running' ? '' : 'Click anywhere on this screen to turn the sound on');
  if (link.url && $('link').textContent !== link.url) {
    $('qr').innerHTML = link.qr();
    $('link').textContent = link.url;
  }
}

function phoneMenu() {
  const items = hud.list.map(({ n, label, note }) => ({ n, label, note }));
  if (mode === 'level') items.push({ n: 0, label: 'Replay the warm-up', note: '' });
  if (mode === 'coach') items.push({ n: 0, label: 'Skip the warm-up', note: '' });
  const playing = mode === 'play' || mode === 'countdown';
  return { title: hud.text.title || (playing ? 'Playing' : ''), sub: hud.text.sub, items };
}

function openGate(open) {
  gated = !open;
  document.body.classList.toggle('gated', gated);
}
addEventListener('tt:gate', e => openGate(e.detail.open));

// the game is played on a big screen with the phone as the paddle. opened on a phone itself, it says so first.
// tablets have a screen at least 600 wide either way round, so they go straight in
const onPhone = () => matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600;

function bigScreenFirst() {
  $('small').hidden = false;
  $('smallShare').addEventListener('click', async () => {
    const url = location.origin + '/';
    try {
      if (navigator.share) await navigator.share({ title: 'FlickPong', text: 'Table tennis played with your phone as the paddle', url });
      else { await navigator.clipboard.writeText(url); $('smallNote').textContent = 'Link copied. Paste it into your computer\'s browser.'; $('smallNote').hidden = false; }
    } catch (e) {}
  });
  return new Promise(resolve => $('smallAnyway').addEventListener('click', () => {
    $('small').hidden = true;
    try { sessionStorage.setItem('tt.small', '1'); } catch (e) {}
    resolve();
  }, { once: true }));
}

async function boot() {
  let seen = null;
  try { seen = sessionStorage.getItem('tt.small'); } catch (e) {}
  if (onPhone() && !seen) await bigScreenFirst();
  try { view = new View($('scene')); }
  catch (e) { hud.say('WebGL is unavailable', 'This browser can\'t draw the 3D table.'); return; }
  requestAnimationFrame(frame);
  // google sign-in loads alongside, so the game never waits on it for long
  openGate(false);
  const decided = new Promise(r => addEventListener('tt:gate', r, { once: true }));
  import('./account.js').catch(e => { console.warn('FlickPong: sign-in is unavailable', e); openGate(true); });
  Promise.race([decided, new Promise(r => setTimeout(r, GATE_WAIT, 'late'))]).then(v => { if (v === 'late') openGate(true); });
  mode = 'find';
  document.body.classList.add('finding');
  pairing();
  try { await link.start(); }
  catch (e) { hud.say('Phone pairing unavailable', e.message); }
}

boot();
