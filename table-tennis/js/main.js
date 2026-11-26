import { NEAR, FAR, LEVELS, clamp } from './config.js';
import { Game } from './game.js';
import { PhoneLink, isLocal } from './phone-link.js';
import { Monitor } from './monitor.js';
import { PhonePaddle } from './phone-paddle.js';
import { View } from './view.js';
import { Sound } from './sound.js';
import { Hud } from './hud.js';
import { Versus } from './versus.js';

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

// playing a friend online, each at their own laptop with their own phone. the invite link carries this laptop's pairing id, and
// the friend's laptop connects to it. online is { host, name, here, status, held, holds, quiet, want, wants, route, own } while
// that's on: host is whether this laptop sent the invite, here whether the two laptops have said hello, status how far along the
// friend is, held and holds whether this end or theirs has stopped the match for a phone that dropped out, quiet whether their
// laptop has gone silent, want and wants whether this end or theirs has asked for a rematch, route how the invited laptop is
// trying to reach the inviter's, and own whether the invite link was made in this same browser. a friend's matches are played
// at Club pace and don't count towards league points. the invited laptop tries a direct link for DIRECT_WAIT seconds and then
// the relay for RELAY_WAIT more. SILENT seconds without a word stops a match
const PROTOCOL = 2, FRIEND_LEVEL = 2, DIRECT_WAIT = 8, RELAY_WAIT = 20, SILENT = 1.2;
const joinId = (new URLSearchParams(location.hash.slice(1)).get('join') || '').replace(/[^\w-]/g, '').slice(0, 64);
// hostRelay is the inviting laptop's wait in the relay: null before it starts, 'starting', the link itself, or 'off' if the relay
// can't be reached from here
let versus = null, online = joinId ? { host: false, own: joinId === store.get('tt.peer') } : null, myName = '', hostRelay = null, copyTimer = 0;
// the other player, as the screens name them
const foe = () => (online ? online.name || 'Your friend' : 'Opponent');
const foeIn = () => (online ? online.name || 'your friend' : 'the opponent');

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
  hud.say('Pick your opponent', 'Tap one on your phone');
  hud.choices([
    { n: 1, label: 'Beginner', note: 'Slow and friendly' },
    { n: 2, label: 'Club', note: 'A fair game' },
    { n: 3, label: 'Pro', note: 'Fast, with spin' },
    { n: 4, label: 'A friend', note: 'Online, anywhere' },
  ]);
  hud.hint('Your phone can replay the warm-up too');
}

function askFormat() {
  mode = 'format';
  timer = FORMAT_WAIT;
  hud.say(online ? `${foe()} is ready. How long?` : `${LEVELS[levelId].name}. How long?`, 'Tap one on your phone');
  hud.choices([
    { n: 1, label: 'One game', note: 'First to 11' },
    { n: 2, label: 'Best of 3', note: 'First to 2 games' },
    { n: 3, label: 'Best of 5', note: 'First to 3 games' },
  ]);
}

function coinToss() {
  mode = 'coin';
  timer = 1.8;
  // playing a friend, the inviter's laptop tosses the coin and tells the other one how it fell
  if (!online || online.host) firstServer = Math.random() < 0.5 ? NEAR : FAR;
  if (online?.host) versus.send({ k: 'setup', bestOf, first: firstServer === NEAR ? 'me' : 'you' });
  if (online) Object.assign(online, { want: false, wants: false });
  hud.choices();
  hud.hint();
  hud.say('Coin toss', firstServer === NEAR ? 'You serve first' : `${foe()} serves first`);
}

function kickOff() {
  game.start(levelId, bestOf, firstServer, null, online ? { host: online.host } : null);
  versus?.attach(game, performance.now() / 1000);
  view.setReach(game.level.hitRadius);
  $('foeName').textContent = online ? online.name || 'Friend' : 'Opponent';
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
  if (online?.host) toInvite();
  else if (online) toLobby();
  else askLevel();
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
    if (!store.get('tt.warm')) startCoach();
    else if (online?.host) toInvite();
    else if (online) toLobby();
    else askLevel();
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
    const got = pick([0, 1, 2, 3, 4]);
    if (got === 0) startCoach();
    else if (got === 4) startInvite();
    else if (got) { levelId = got; askFormat(); }
  },
  // the inviter waits here for their friend to open the link, pair a phone and be ready
  invite() {
    if (pick([0]) === 0) { endOnline(); return; }
    if (online.here && online.status === 'ready') askFormat();
  },
  // the friend who was invited waits here for the inviter to pick how long to play
  lobby() {
    if (pick([0]) === 0) { endOnline(); return; }
      if (online.here) hud.say(`Waiting for ${foeIn()}`, 'They pick how long to play. Keep your phone in hand.');
    else hud.say('Connecting to your friend\'s game', online.route === 'relay' ? 'A direct link didn\'t work on this network, so it\'s going another way. A few more seconds.' : 'One moment.');
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
    // paused for a friend's phone, this one may drop out too, and then they wait for it as well
    if (timer < BACK_AFTER) { if (!s) hold(true); return; }
    hud.meter(0);
    hold(false);
    // playing a friend, the match only carries on once both phones are back
    if (online?.holds || online?.quiet) return;
    timer = COUNTDOWN;
    mode = 'countdown';
  },
  countdown(dt) {
    if (online?.holds || online?.quiet) { friendHeld(); return; }
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
    if (!online) {
      if (got === 1) coinToss();
      else if (got === 2) askLevel();
      return;
    }
    // a rematch needs both players to ask for one, and the inviter's laptop starts it
    if (got === 2) { endOnline(); return; }
    if (got === 1 && !online.want) {
      online.want = true;
      versus.send({ k: 'again' });
    }
    hud.hint(online.want ? `Waiting for ${foeIn()} to choose` : online.wants ? `${foe()} wants a rematch` : '');
    if (online.host && online.want && online.wants) coinToss();
  },
};

/* ---------- playing a friend online ---------- */
// the invite can be made on the start screen, before this player's own phone is paired, or from the menu once it is
function startInvite() {
  online = { host: true };
  levelId = FRIEND_LEVEL;
  $('inviteLink').value = `${location.origin}${location.pathname}#join=${link.peer.id}`;
  $('inviteShare').hidden = !navigator.share;
  if (mode !== 'find') toInvite();
}

function toInvite() {
  mode = 'invite';
  hud.choices();
  hud.hint();
  hud.say('Invite a friend', 'Send them this link. They open it on their laptop or tablet and pair their own phone, then you pick how long to play.');
}

// how far along the invited friend is, on the invite card
function inviteStatus() {
  const o = online, ready = mode === 'find' ? '. Pair your phone to start' : '';
  const text = !o.here ? 'Waiting for your friend to open the link'
    : o.status === 'ready' ? `${foe()} is ready${ready}`
    : o.status === 'warming' ? `${foe()} is here and warming up`
    : `${foe()} is here and pairing their phone`;
  if ($('inviteStatus').textContent !== text) $('inviteStatus').textContent = text;
  $('inviteStatus').classList.toggle('on', !!o.here);
}

function toLobby() {
  mode = 'lobby';
  $('board').hidden = true;
  hud.choices();
  hud.hint();
}

// ends playing a friend. why says what happened when it wasn't this player's own choice, and then the friend isn't told again
function endOnline(why = '') {
  if (!online) return;
  versus?.close(why ? '' : 'leave');
  versus = null;
  online = null;
  if (typeof hostRelay === 'object') hostRelay?.close();
  hostRelay = null;
  $('foeName').textContent = 'Opponent';
  // a reload shouldn't join the same friend again
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  if (why) hud.flash(why, 4);
  // still pairing a phone or warming up, that carries on, and the menu comes after it as usual
  if (mode === 'find' || mode === 'coach') return;
  game.phase = 'idle';
  game.drain();
  $('board').hidden = true;
  hud.meter(0);
  askLevel();
}

// the invited laptop calls the inviter's directly first, as that's quickest. if they haven't said hello within DIRECT_WAIT
// seconds, or the inviter's pairing id can't be found, it goes through the relay instead
function joinDirect(now) {
  const conn = link.callFriend(joinId);
  if (!conn) return;
  versus = new Versus({ host: false });
  versus.use(conn);
  Object.assign(online, { route: 'direct', since: now });
}

async function joinRelay(now) {
  if (!online || online.route === 'relay') return;
  versus?.close('');
  versus = null;
  Object.assign(online, { route: 'relay', since: now });
  try {
    const { RelayLink } = await import('./relay.js');
    if (online?.route !== 'relay' || online.here) return;
    versus = new Versus({ host: false });
    versus.use(new RelayLink(joinId, 'guest'));
  } catch (e) {
    console.warn('FlickPong: the relay is unavailable', e);
    joinFailed();
  }
}

function joinFailed() {
  endOnline(online?.own ? 'That invite link was made in this browser, and its game has closed. Send it to your friend to open on their own laptop.'
    : 'Couldn\'t reach your friend\'s game. Make sure it\'s still open on their laptop, then open the link again.');
}

// the inviting laptop also waits in the relay, for a friend whose network won't allow a direct link. it stops once a friend
// has said hello, and waits again if one who came through the relay leaves before that
async function listenRelay() {
  hostRelay = 'starting';
  try {
    const { RelayLink } = await import('./relay.js');
    if (hostRelay !== 'starting') return;
    if (!online?.host || online.here || !link.peer?.open) { hostRelay = null; return; }
    const r = hostRelay = new RelayLink(link.peer.id, 'host');
    r.on('open', () => {
      if (hostRelay !== r) return;
      hostRelay = null;
      if (!online?.host || online.here) { r.close(); return; }
      versus?.close('');
      versus = new Versus({ host: true });
      versus.use(r);
    });
    r.on('error', () => { if (hostRelay === r) hostRelay = 'off'; });
  } catch (e) {
    console.warn('FlickPong: the relay is unavailable', e);
    hostRelay = 'off';
  }
}

// a friend's laptop calling in directly. one at a time, and only while this laptop is inviting
link.onFriend = conn => {
  if (!online?.host || online.here || versus?.open) {
    conn.on('open', () => { conn.send({ k: 'busy' }); setTimeout(() => conn.close(), 1000); });
    return;
  }
  versus?.close('');
  versus = new Versus({ host: true });
  versus.use(conn);
};
// the inviter's pairing id isn't there. their game may have closed, or only lost the pairing service, so the relay is tried
link.onError = e => {
  if (e.type === 'peer-unavailable' && online && !online.host && !online.here && online.route === 'direct') joinRelay(performance.now() / 1000);
};
addEventListener('tt:me', e => {
  myName = e.detail.name || '';
  if (versus?.open) versus.send({ k: 'hello', v: PROTOCOL, name: myName });
});

// once a frame: joins, hears what the friend's laptop says, and tells it how far along this end is
function friendTick(now) {
  const o = online;
  if (!o.host && !o.here) {
    if (!o.route && link.peer?.open) joinDirect(now);
    else if (o.route === 'direct' && now - o.since > DIRECT_WAIT) joinRelay(now);
    else if (o.route === 'relay' && now - o.since > RELAY_WAIT) { joinFailed(); return; }
  }
  if (o.host && !o.here && hostRelay === null && !versus?.relayed && link.peer?.open) listenRelay();
  for (const d of versus ? versus.takeEvents() : []) {
    const o = online;
    if (!o) return;
    if (d.k === 'open') {
      o.told = '';
      versus.send({ k: 'hello', v: PROTOCOL, name: myName });
    } else if (d.k === 'hello') {
      if (d.v !== PROTOCOL) { endOnline('You and your friend have different versions of FlickPong. Both reload the page, then try again.'); return; }
      o.name = String(d.name || '').trim().slice(0, 24);
      // answered once, in case this end's own hello was lost on the way
      if (!d.re) versus.send({ k: 'hello', v: PROTOCOL, name: myName, re: true });
      if (!o.here) {
        o.here = true;
        if (o.host && typeof hostRelay === 'object') { hostRelay?.close(); hostRelay = null; }
      }
    } else if (d.k === 'status' && o.host) o.status = String(d.s);
    else if (d.k === 'setup' && !o.host && (mode === 'lobby' || mode === 'over') && [1, 3, 5].includes(d.bestOf)) {
      bestOf = d.bestOf;
      levelId = FRIEND_LEVEL;
      firstServer = d.first === 'me' ? FAR : NEAR;
      coinToss();
    } else if (d.k === 'hold') {
      o.holds = !!d.on;
      if (o.holds && (mode === 'play' || mode === 'countdown')) friendHeld();
    } else if (d.k === 'again') o.wants = true;
    else if (d.k === 'leave') { endOnline(`${foe()} left the match`); return; }
    else if (d.k === 'busy') { endOnline('Your friend\'s game isn\'t inviting anyone right now. Ask them to pick "A friend" and send you the link.'); return; }
    else if (d.k === 'gone') {
      // a link that worked and then dropped ends the match. one that never said hello is dropped, and the invited laptop
      // tries the relay next, or gives up if that was it
      if (o.here) { endOnline(`Lost the connection to ${foeIn()}`); return; }
      if (o.host) versus = null;
      else if (o.route === 'direct') joinRelay(now);
      else { joinFailed(); return; }
    }
  }
  if (online?.host) inviteStatus();
  if (!online || !versus?.open) return;
  // their laptop going quiet in the middle of a match stops it until it's heard from again
  const quiet = mode !== 'over' && performance.now() / 1000 - versus.heard > SILENT, was = online.quiet;
  online.quiet = quiet;
  if (quiet && !was && (mode === 'play' || mode === 'countdown')) friendHeld();
  if (!online.host) {
    const status = mode === 'lobby' ? 'ready' : mode === 'coach' ? 'warming' : 'pairing';
    if (status !== online.told) { online.told = status; versus.send({ k: 'status', s: status }); }
  }
}

// playing a friend, the match stops for both whenever either one's phone drops out
function hold(on) {
  if (!online || !!online.held === on) return;
  online.held = on;
  versus?.send({ k: 'hold', on });
}

function friendHeld() {
  resume = 'play';
  mode = 'paused';
  timer = BACK_AFTER;
  hud.say(online.quiet ? `Waiting for ${foeIn()}\'s connection` : `${foe()}\'s phone dropped out`, 'The match carries on as soon as it\'s back.');
}

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
  hold(true);
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
    if (r === 'Out' || r === 'Ball was going out') return `Your point. ${foe()} hit it out`;
    if (r === 'Ball did not cross the net') return `Your point. ${foe()} hit the net`;
    if (r.startsWith('Serve')) return `Your point. ${foe()} missed the serve`;
    return `Your point. ${foe()} couldn't reach it`;
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
  if (e.type === 'game') hud.say(`Game ${e.last[0] > e.last[1] ? 'to you' : `to ${foeIn()}`}, ${e.last[0]}-${e.last[1]}`, 'Next game coming up');
  if (e.type === 'over') {
    const m = game.match, st = game.stats;
    mode = 'over';
    // the sign-in corner adds it to the player's record, or keeps it until they sign in. a friend's match isn't recorded
    if (!online) dispatchEvent(new CustomEvent('tt:match', { detail: { level: LEVELS[levelId].name, won: e.winner === NEAR, pointsWon: st.won, pointsLost: st.lost, longest: st.longest, fastest: st.fastest } }));
    hud.say(e.winner === NEAR ? 'You win the match!' : `${foe()} wins the match`,
      `Games ${m.games[0]}-${m.games[1]} (${m.history.map(g => g.join('-')).join(', ')}). Longest rally ${st.longest} shots, fastest shot ${st.fastest.toFixed(1)} m/s.`);
    hud.choices(online ? [{ n: 1, label: 'Rematch', note: 'Same length' }, { n: 2, label: 'Leave', note: 'Back to the menu' }]
      : [{ n: 1, label: 'Rematch', note: 'Same settings' }, { n: 2, label: 'Change', note: 'Level and length' }]);
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
  if (online) friendTick(now);
  FLOW[mode]?.(real, s, now, pose);
  const t0 = performance.now();
  // the friend's laptop gets this paddle and every hit and call on the same clock its pings are answered on
  versus?.tick(performance.now() / 1000, mode === 'play' ? pose : null, real);
  if (live) game.update(dt, pose);
  for (const e of game.drain()) {
    versus?.onEvent(e, performance.now() / 1000);
    handle(e);
  }
  hud.tick(real);
  const t1 = performance.now();
  view.render(game, pose, dt);
  monitor.frame(ms, real, state, link.theta, t1 - t0, performance.now() - t1);
  monitor.tick(ms, link, view.ratio);
  // while paused the code stays up too, since a phone page that was closed can take a while to count as gone
  $('pair').hidden = mode === 'find' ? link.paired : mode !== 'paused';
  // the start screen offers to play a friend, and the invite link shows from then until the friend is ready
  $('friendStart').hidden = !(mode === 'find' && !online && link.url);
  $('invite').hidden = !(online?.host && (mode === 'find' || mode === 'invite'));
  // the leaderboard shows between matches, once there's one to show
  $('leaders').hidden = !document.body.classList.contains('ranked') || !['level', 'format', 'over'].includes(mode);
  // the network's share plus the little the playback buffer adds to keep the paddle smooth
  const total = link.lag === null ? null : link.lag + link.delay * 1000;
  // playing a friend, how long a hit takes to reach their laptop
  const far = versus?.open && versus.rtt !== null ? ` · Friend ${Math.round(versus.rtt * 500)} ms${versus.relayed ? ' · relayed' : ''}` : '';
  const lag = total === null ? '' : `Phone ${Math.round(total)} ms${link.route ? ` · ${link.route}` : ''}${far}`;
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
  else if (st === 'waiting') hud.say('Scan with your phone', `${invited()}Open your phone's camera, point it at the code and open the link.${online?.host ? ' Send your friend the invite link too.' : ''}`);
  else hud.say('Getting a pairing code', 'One moment.');
  // browsers keep a page silent until it's clicked, and the phone does everything else
  hud.hint(sound.ctx?.state === 'running' ? '' : 'Click anywhere on this screen to turn the sound on');
  if (link.url && $('link').textContent !== link.url) {
    $('qr').innerHTML = link.qr();
    $('link').textContent = link.url;
  }
}

// opened from a friend's invite, the pairing screen says so
function invited() {
  if (!online || online.host) return '';
  if (online.here) return `${foe()} invited you to a match. `;
  return online.route === 'relay' ? 'Connecting to your friend\'s game another way. ' : 'Connecting to your friend\'s game. ';
}

function phoneMenu() {
  const items = hud.list.map(({ n, label, note }) => ({ n, label, note }));
  if (mode === 'level') items.push({ n: 0, label: 'Replay the warm-up', note: '' });
  if (mode === 'coach') items.push({ n: 0, label: 'Skip the warm-up', note: '' });
  if (mode === 'invite') items.push({ n: 0, label: 'Back', note: '' });
  if (mode === 'lobby') items.push({ n: 0, label: 'Leave', note: '' });
  const playing = mode === 'play' || mode === 'countdown';
  return { title: hud.text.title || (playing ? 'Playing' : ''), sub: hud.text.sub, items };
}

function openGate(open) {
  gated = !open;
  document.body.classList.toggle('gated', gated);
}
addEventListener('tt:gate', e => openGate(e.detail.open));

// the invite link goes to the friend by whatever they use to talk: copied, or through the computer's own share sheet
$('inviteCopy').addEventListener('click', async () => {
  const b = $('inviteCopy');
  try {
    await navigator.clipboard.writeText($('inviteLink').value);
    b.textContent = 'Copied';
  } catch (e) {
    $('inviteLink').select();
    b.textContent = 'Selected, copy it';
  }
  clearTimeout(copyTimer);
  copyTimer = setTimeout(() => { b.textContent = 'Copy link'; }, 2200);
});
$('inviteShare').addEventListener('click', () => {
  navigator.share?.({ title: 'FlickPong', text: 'Play me at table tennis. Open this on your laptop, then pair your phone as the paddle.', url: $('inviteLink').value }).catch(() => {});
});
$('inviteLink').addEventListener('focus', e => e.target.select());
$('friendStart').addEventListener('click', () => { if (mode === 'find' && !online && link.peer?.open) startInvite(); });
$('inviteCancel').addEventListener('click', () => endOnline());

// the game is played on a big screen with the phone as the paddle. opened on a phone itself, it says so first.
// tablets have a screen at least 600 wide either way round, so they go straight in
const onPhone = () => matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600;

function bigScreenFirst() {
  $('small').hidden = false;
  // a friend's invite opened on a phone: it's the invite itself that has to go to the computer
  if (joinId) {
    $('smallTitle').textContent = 'Open this invite on a laptop or tablet';
    $('smallOpen').textContent = 'Send this link to your laptop or tablet, and open it there.';
    $('smallShare').textContent = 'Share invite link';
  }
  $('smallShare').addEventListener('click', async () => {
    const url = joinId ? location.href : 'https://flickpong.vercel.app/';
    try {
      if (navigator.share) await navigator.share({ title: 'FlickPong', text: joinId ? 'Open this on your laptop to join the match.' : 'Table tennis with your phone as the racket.', url });
      else { await navigator.clipboard.writeText(url); $('smallNote').textContent = 'Copied. Open it on your laptop or tablet.'; $('smallNote').hidden = false; }
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
  try { await link.start({ fresh: !!joinId }); }
  catch (e) { hud.say('Phone pairing unavailable', e.message); }
}

boot();
