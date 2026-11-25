// a stand-in for the whole setup: a person pointing and flicking a phone, its readings crossing wifi,
// and the game tab playing them back, all on one simulated clock so every run can be repeated exactly
import { Motion } from '../js/motion.js';
import { Playout } from '../js/playout.js';
import { PhonePaddle, HOME, GAIN } from '../js/phone-paddle.js';
import { Game } from '../js/game.js';
import { NEAR, FAR } from '../js/config.js';

const DEG = 180 / Math.PI;

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const gauss = r => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());

// stall: now and then the link freezes and everything sent meanwhile lands together. bunch: power-saving wifi that
// only hands packets over every so often. tail: this share of readings arrives up to tailMax late.
// silences: now and then the phone's sensor itself goes quiet for about silence seconds
export const NETS = {
  clean: { base: 0.003, jitter: 0.0008, stalls: 0, stall: 0, bunch: 0 },
  wifi: { base: 0.006, jitter: 0.003, stalls: 0.004, stall: 0.04, bunch: 0 },
  rough: { base: 0.01, jitter: 0.006, stalls: 0.01, stall: 0.08, bunch: 0.045 },
  // measured on a real iPhone and Mac on home wifi: most readings land in about 12 ms, a steady quarter 10 to 50 ms late,
  // a freeze every few seconds, and the phone's sensor dropping to half rate for a while now and then
  bursty: { base: 0.008, jitter: 0.003, tail: 0.22, tailMax: 0.05, stalls: 0.003, stall: 0.25, bunch: 0, silences: 0.012, silence: 0.07 },
};

export class Net {
  constructor(cfg, r) { this.cfg = cfg; this.r = r; this.q = []; this.stallEnd = -1; }

  send(msg, at) {
    const { base, jitter, stalls, stall, bunch, tail = 0, tailMax = 0 } = this.cfg, r = this.r;
    let t = at + base - jitter * Math.log(1 - r());
    if (r() < tail) t += 0.008 + r() * (tailMax - 0.008);
    if (at < this.stallEnd) t = Math.max(t, this.stallEnd + base);
    else if (r() < stalls) { this.stallEnd = at + stall * (0.5 + r()); t = this.stallEnd + base; }
    if (bunch) t = Math.ceil(t / bunch) * bunch + r() * 0.001;
    this.q.push({ t, msg: JSON.parse(JSON.stringify(msg)) });
  }

  take(now) {
    const out = this.q.filter(p => p.t <= now).sort((a, b) => a.t - b.t);
    this.q = this.q.filter(p => p.t > now);
    return out;
  }
}

// rounds readings the way the phone page does before sending
export const wire = s => ({ k: 'm', t: Math.round(s.t * 1e4) / 1e4, yaw: Math.round(s.yaw * 1e4) / 1e4, pitch: Math.round(s.pitch * 1e4) / 1e4, twist: Math.round(s.twist * 1e3) / 1e3, s: s.s.map(n => Math.round(n * 1e3) / 1e3) });

// a quick wrist turn of amp radians, there and back
const flickAt = (u, { amp, rise, back }) => {
  const ease = x => 0.5 - 0.5 * Math.cos(Math.PI * x);
  if (u <= 0) return 0;
  if (u < rise) return amp * ease(u / rise);
  if (u < rise + back) return amp * (1 - ease((u - rise) / back));
  return 0;
};

// how long they take to react (s), how far off they aim (m), how far off their flick timing is (s), and how quick their arm is
export const SKILLS = {
  weak: { react: 0.28, aim: 0.16, timing: 0.06, speed: 8, maxTurn: 2, flick: 0.45, place: 0.2 },
  average: { react: 0.22, aim: 0.1, timing: 0.04, speed: 10, maxTurn: 2.6, flick: 0.55, place: 0.45 },
  good: { react: 0.17, aim: 0.06, timing: 0.025, speed: 12, maxTurn: 3.2, flick: 0.62, place: 0.7 },
};

// a person holding the phone like a remote. they see the ball late, aim imperfectly, and flick a little early or late
export class Player {
  constructor(r, skill = {}) {
    this.r = r;
    this.skill = { ...SKILLS.average, lead: 0.04, tremor: 0.0015, ...skill };
    this.home = 3.3;
    this.yaw = 0;
    this.pitch = 0;
    this.vy = 0;
    this.vp = 0;
    this.goal = { yaw: 0, pitch: 0 };
    this.flicks = [];
    this.key = null;
    this.swingAt = null;
    this.tossAt = null;
  }

  // a hit flicks up, and a little to one side to steer the shot. better players steer it away from the opponent more often
  flick(at, kind, awayFrom = 0) {
    const s = this.skill, r = this.r;
    if (kind === 'toss') { this.flicks.push({ at, amp: 0.35, side: 0, rise: 0.09, back: 0.25 }); return; }
    const dir = r() < s.place ? (awayFrom > 0 ? 1 : -1) : r() < 0.5 ? -1 : 1;
    this.flicks.push({ at, amp: s.flick * (0.85 + 0.3 * r()), side: dir * 0.22 * r(), rise: 0.055 + 0.02 * r(), back: 0.16 });
  }

  // what they decide from what they see, once a frame
  think(game, pose, now) {
    const s = this.skill, L = game.level, r = this.r;
    if (!L || !game.rally) return;
    const yours = game.rally.server === NEAR;
    // a missed toss comes back to the serve, so they toss again
    if (game.phase !== this.phase && game.phase === 'serve') { this.tossAt = null; this.tossed = false; this.served = false; }
    this.phase = game.phase;
    if (game.phase === 'serve' && yours) {
      this.goal = { yaw: 0, pitch: 0 };
      if (this.tossAt === null) this.tossAt = now + 0.6 + 0.4 * r();
      if (now >= this.tossAt && !this.tossed) { this.flick(now, 'toss'); this.tossed = true; }
      return;
    }
    if (game.phase !== 'toss') { this.tossAt = null; this.tossed = false; this.served = false; }
    if (game.phase === 'toss' && yours) {
      const b = game.ball;
      if (!this.served && b.v.y < 0 && b.p.y - pose.p.y < (s.serveAt ?? 0.24) + gauss(r) * 0.04) { this.flick(now, 'hit'); this.served = true; }
      return;
    }
    const g = game.guide, key = game.rally.shots;
    // they swing when they meant to, even if the ball has already met the paddle by then
    if (this.swingAt !== null && !this.flicked && now >= this.swingAt) { this.flick(now, 'hit', game.ai.p.x); this.flicked = true; }
    if (!g) { if (game.phase === 'play' && this.key !== key) this.goal = { yaw: 0, pitch: 0 }; return; }
    if (key !== this.key) {
      this.key = key;
      this.seenAt = now;
      this.err = { x: gauss(r) * s.aim, y: gauss(r) * s.aim * 0.7 };
      this.late = gauss(r) * s.timing;
      this.flicked = false;
      this.swingAt = null;
    }
    if (now - this.seenAt < s.react) return;
    this.goal = { yaw: -(g.p.x + this.err.x - HOME.x) / GAIN.x, pitch: (g.p.y + this.err.y - HOME.y) / GAIN.y };
    this.swingAt = now + g.t / L.timeScale - s.lead + this.late;
    if (!this.flicked && now >= this.swingAt) { this.flick(now, 'hit', game.ai.p.x); this.flicked = true; }
  }

  // the arm moves toward where they want to point, a little shaky, never instantly
  orient(t, dt) {
    const s = this.skill, w = s.speed;
    for (const [k, v, goal] of [['yaw', 'vy', this.goal.yaw], ['pitch', 'vp', this.goal.pitch]]) {
      this[v] += (w * w * (goal - this[k]) - 2 * w * this[v]) * dt;
      this[v] = Math.max(-s.maxTurn, Math.min(s.maxTurn, this[v]));
      this[k] += this[v] * dt;
    }
    this.flicks = this.flicks.filter(f => t - f.at < 1);
    const flick = this.flicks.reduce((a, f) => a + flickAt(t - f.at, f), 0);
    // turning left raises the heading, which steers the shot left: the opposite sign to the table's x
    const sideways = this.flicks.reduce((a, f) => a - flickAt(t - f.at, { ...f, amp: f.side }), 0);
    const shake = s.tremor * (Math.sin(2 * Math.PI * 9 * t) + 0.6 * Math.sin(2 * Math.PI * 11.3 * t + 1));
    const heading = this.home + this.yaw + sideways + shake;
    return { alpha: ((heading * DEG) % 360 + 360) % 360, beta: (this.pitch + flick + shake * 0.8) * DEG, gamma: 3 + 2 * Math.sin(t) };
  }

  // where they actually point, without flicks, as a paddle position. what a perfect controller would show
  truth() { return { x: HOME.x - this.yaw * GAIN.x, y: HOME.y + this.pitch * GAIN.y }; }
}

// the shipping pipeline. tests can swap in another to compare
export const pipeline = () => ({ phone: new Motion(), link: new Playout(), paddle: new PhonePaddle() });

// plays on one clock: phone sensor ticks, packets landing, and screen frames, each at its own pace
export function run({ level = 2, practice = false, bestOf = 1, seconds = 60, net = 'wifi', fps = 60, seed = 1, skill = {}, pipe = pipeline(), firstServer = FAR, onFrame, path } = {}) {
  const r = rng(seed), game = new Game(rng(seed + 7)), player = new Player(rng(seed + 13), skill), wifi = new Net(NETS[net], rng(seed + 29));
  const { phone, link, paddle } = pipe;
  const clockGap = 4321.123, stats = { hits: 0, serves: 0, speeds: [], aiHits: 0, tosses: 0, servesIn: 0, retoss: 0, won: {}, lost: {}, points: 0, over: false, frameMs: [], winner: null, tossing: false, served: false, upgrades: 0 };
  if (path) player.think = () => {};
  game.start(level, bestOf, firstServer, practice ? { server: firstServer } : null);
  let t = 0, nextSense = 0, nextFrame = 0, last = 0, lastSense = 0, quietUntil = 0;
  const net_ = NETS[net];
  const end = seconds;
  while (t < end && !stats.over) {
    const arrive = wifi.q.length ? Math.min(...wifi.q.map(p => p.t)) : Infinity;
    t = Math.min(nextSense, nextFrame, arrive);
    if (t === arrive) {
      for (const p of wifi.take(t)) link.push(p.msg, p.t);
      continue;
    }
    if (t === nextSense) {
      if (path) { const g = path(t); player.goal = g; }
      const o = player.orient(t, t - lastSense || 1 / 60);
      lastSense = t;
      if (net_.silences && t >= quietUntil && r() < net_.silences) quietUntil = t + net_.silence * (0.5 + r());
      if (t >= quietUntil) {
        const pt = t - clockGap;
        phone.orient(o.alpha, o.beta, o.gamma, pt);
        phone.motion({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 9.81 }, pt);
        wifi.send(wire(phone.sample()), t);
      }
      nextSense = t + 1 / 60 + (r() - 0.5) * 0.001;
      continue;
    }
    const dt = last ? t - last : 1 / fps;
    last = t;
    const state = link.read(t);
    const pose = paddle.tick(dt, t, path ? null : game.assist, state);
    const t0 = performance.now();
    if (!path) game.update(Math.min(dt, 0.05), pose);
    stats.frameMs.push(performance.now() - t0);
    const events = game.drain();
    for (const e of events) tally(stats, e, game);
    onFrame?.({ t, pose, state, game, player, events });
    if (!path) player.think(game, pose, t);
    nextFrame = t + 1 / fps;
  }
  return stats;
}

function tally(stats, e, game) {
  if (e.type === 'hit' && e.who === NEAR && e.late) {
    stats.upgrades++;
    if (!stats.served) stats.speeds[stats.speeds.length - 1] = e.speed;
    return;
  }
  if (e.type === 'hit' && e.who === NEAR) {
    stats.hits++;
    stats.served = stats.tossing;
    if (stats.tossing) stats.serves++;
    else stats.speeds.push(e.speed);
    stats.tossing = false;
  }
  if (e.type === 'hit' && e.who === FAR) stats.aiHits++;
  if (e.type === 'toss' && e.who === NEAR) { stats.tosses++; stats.tossing = true; }
  if (e.type === 'serveIn' && e.who === NEAR) stats.servesIn++;
  if (e.type === 'retoss') stats.retoss++;
  if (e.type === 'point' || e.type === 'practice') {
    stats.points++;
    stats.tossing = false;
    const box = e.winner === NEAR ? stats.won : stats.lost;
    box[e.reason] = (box[e.reason] || 0) + 1;
  }
  if (e.type === 'over') { stats.over = true; stats.winner = e.winner; stats.games = game.match.games.slice(); }
}

// how often the player got a paddle on a ball they could have reached, and how many of those landed
export function rates(st) {
  const missed = (st.lost['Not returned'] || 0) + (st.lost['Double bounce'] || 0);
  const wild = (st.lost['Out'] || 0) + (st.lost['Ball did not cross the net'] || 0) + (st.lost['Hit before it bounced'] || 0);
  const rallyHits = st.hits - st.serves;
  return { returned: rallyHits / Math.max(1, rallyHits + missed), landed: 1 - wild / Math.max(1, st.hits), missed, wild };
}

// follows a set of aiming moves and compares where the paddle was drawn with where the phone really pointed.
// lag: the delay that lines them up best. step: how far a single frame's movement strayed from the real one (stutter)
export function track(pipe = pipeline(), { net = 'wifi', fps = 60, seed = 2, seconds = 30 } = {}) {
  const r = rng(seed * 101), moves = [];
  for (let t = 0; t < seconds; t += 0.4 + r() * 0.6) moves.push({ t, yaw: (r() - 0.5) * 0.6, pitch: (r() - 0.5) * 0.25 });
  const path = t => {
    let g = moves[0];
    for (const m of moves) if (m.t <= t) g = m;
    return { yaw: g.yaw + 0.08 * Math.sin(2 * Math.PI * 0.7 * t), pitch: g.pitch };
  };
  const rows = [];
  run({ seconds, net, fps, seed, pipe, path, onFrame: ({ t, pose, player }) => { const q = player.truth(); rows.push({ t, x: pose.p.x, y: pose.p.y, tx: q.x, ty: q.y }); } });
  let j = 0;
  const at = (t, k) => {
    while (j > 0 && rows[j].t > t) j--;
    while (j < rows.length - 2 && rows[j + 1].t <= t) j++;
    const a = rows[j], b = rows[j + 1];
    return t <= a.t ? a[k] : a[k] + (b[k] - a[k]) * (t - a.t) / (b.t - a.t);
  };
  const use = rows.filter(q => q.t > 2);
  let best = { lag: 0, rms: Infinity };
  for (let L = 0; L <= 0.15; L += 0.002) {
    let s = 0;
    for (const q of use) s += (q.x - at(q.t - L, 'tx')) ** 2 + (q.y - at(q.t - L, 'ty')) ** 2;
    if (Math.sqrt(s / use.length) < best.rms) best = { lag: L, rms: Math.sqrt(s / use.length) };
  }
  const steps = [];
  for (let i = 1; i < use.length; i++) steps.push(Math.abs(use[i].x - use[i - 1].x - (at(use[i].t - best.lag, 'tx') - at(use[i - 1].t - best.lag, 'tx'))));
  steps.sort((a, b) => a - b);
  return { lag: best.lag, step: steps[Math.floor(steps.length * 0.99)], worst: steps.at(-1) };
}
