// playing a friend online: each at their own laptop with their own phone as the paddle. each laptop runs the match and owns the
// hits and calls on its own half, so both players hit with no lag at all. the laptops swap only what's needed: each hit, each
// call, the toss, and where each paddle is. everything is turned round on the way, since each player sees their own end nearest
import { NEAR, FAR, clamp } from './config.js';

// the other end of the table: x and z flip, and so does spin about those axes
export const mirror = p => ({ x: -p.x, y: p.y, z: -p.z });
export const mirrorBall = b => ({ p: mirror(b.p), v: mirror(b.v), w: { x: -b.w.x, y: b.w.y, z: -b.w.z } });

// pings twice a second, and the quickest of the last SYNC lines up the two clocks. a paddle update goes out every frame, and the
// friend's paddle glides toward the latest over GLIDE seconds. anything said to have happened more than MAX_LATE ago is capped there.
// a friend not heard from in QUIET seconds is gone, since a laptop that closes or sleeps doesn't always say goodbye
const PING = 0.5, SYNC = 12, POSE_EVERY = 1 / 60, GLIDE = 0.03, MAX_LATE = 0.4, QUIET = 8;
// what the two laptops say to each other outside the match itself, passed on to the game screens as they come
const LOBBY = ['hello', 'status', 'setup', 'hold', 'again', 'leave', 'busy'];
// the ball waits at the friend's paddle about a round trip for their hit, plus a little spare, and never longer than WAIT_MAX
const WAIT_SPARE = 0.05, WAIT_MAX = 0.45;
const num = (v, lim = 100) => Number.isFinite(v) && Math.abs(v) < lim;
const vec = (v, lim) => !!v && num(v.x, lim) && num(v.y, lim) && num(v.z, lim);
// a friend's laptop is trusted to play fair, but never to send something that would break this one
const sane = b => !!b && vec(b.p, 10) && vec(b.v, 60) && vec(b.w, 2000);
const r3 = n => Math.round(n * 1000) / 1000;

export class Versus {
  // host: whether this laptop sent the invite. send: how a message reaches the friend's laptop
  constructor({ host, send = () => {} }) {
    this.host = host;
    this.send = send;
    this.conn = null;
    this.game = null;
    this.offset = null;
    this.rtt = null;
    this.syncs = [];
    this.lastPing = -1;
    this.lastPose = -1;
    this.far = null;
    this.events = [];
    this.open = false;
    this.closed = false;
    this.heard = 0;
    // match messages that arrive before this laptop's match has started wait here
    this.early = [];
  }

  // conn is a PeerJS data connection to the friend's laptop
  use(conn) {
    this.conn = conn;
    this.send = m => { if (conn.open) conn.send(m); };
    conn.on('open', () => {
      this.open = true;
      this.heard = performance.now() / 1000;
      this.events.push({ k: 'open' });
    });
    conn.on('data', d => this.receive(d, performance.now() / 1000));
    conn.on('close', () => this.gone());
    conn.on('error', () => this.gone());
  }

  gone() {
    if (this.closed) return;
    this.closed = true;
    this.open = false;
    this.events.push({ k: 'gone' });
  }

  // leaving says so first, so the friend hears it at once rather than after QUIET
  close(say = 'leave') {
    if (say) this.send({ k: say });
    this.closed = true;
    this.open = false;
    const c = this.conn;
    if (c) setTimeout(() => c.close(), 300);
  }

  attach(game, now = performance.now() / 1000) {
    this.game = game;
    this.far = null;
    const early = this.early;
    this.early = [];
    for (const d of early) this.receive(d, now);
  }

  takeEvents() { const e = this.events; this.events = []; return e; }

  // once a frame: keeps the clocks lined up, sends where this paddle is, and glides the friend's toward where theirs is
  tick(now, pose, dt) {
    if (now - this.lastPing >= PING) { this.lastPing = now; this.send({ k: 'ping', t: now }); }
    if (this.open && this.heard && now - this.heard > QUIET) this.gone();
    const g = this.game;
    if (!g?.remote) return;
    g.remote.holdMax = clamp(((this.rtt ?? 0.15) + WAIT_SPARE) * g.level.timeScale, 0.05, WAIT_MAX);
    if (pose && now - this.lastPose >= POSE_EVERY) {
      this.lastPose = now;
      this.send({ k: 'pose', p: { x: r3(pose.p.x), y: r3(pose.p.y), z: r3(pose.p.z) }, roll: r3(pose.roll || 0) });
    }
    if (this.far) {
      const k = 1 - Math.exp(-Math.max(dt, 0) / GLIDE), p = g.ai.p;
      for (const a of ['x', 'y', 'z']) p[a] += (this.far.p[a] - p[a]) * k;
    }
  }

  // passes on what this laptop did or decided
  onEvent(e, now) {
    if (!this.game?.remote) return;
    if (e.type === 'hit' && e.who === NEAR && e.state) this.send({ k: 'shot', rally: e.rally, n: e.n, t: now, late: !!e.late, ball: e.state, info: { speed: e.speed, name: e.name, rpm: e.rpm } });
    if (e.type === 'toss' && e.who === NEAR && e.state) this.send({ k: 'toss', rally: e.rally, t: now, ball: e.state });
    if (e.type === 'retoss') this.send({ k: 'retoss', rally: e.rally });
    if (e.type === 'passed') this.send({ k: 'pass', rally: e.rally, n: e.n });
    if (e.type === 'decided') this.send({ k: 'point', rally: e.rally, winner: e.winner === NEAR ? 'me' : 'you', reason: e.reason, kind: e.kind });
  }

  // how long ago something happened on the friend's laptop, by its clock
  ago(t, now) {
    return Number.isFinite(t) && this.offset !== null ? clamp(now - (t - this.offset), 0, MAX_LATE) : (this.rtt ?? 0.08) / 2;
  }

  receive(d, now) {
    if (!d || typeof d !== 'object' || typeof d.k !== 'string') return;
    this.heard = now;
    if (d.k === 'ping' && num(d.t, 1e9)) { this.send({ k: 'pong', t: d.t, p: now }); return; }
    if (d.k === 'pong' && num(d.t, 1e9) && num(d.p, 1e9)) {
      const rtt = now - d.t;
      if (rtt < 0 || rtt > 5) return;
      this.syncs.push({ rtt, offset: d.p - d.t - rtt / 2 });
      if (this.syncs.length > SYNC) this.syncs.shift();
      const best = this.syncs.reduce((a, q) => (q.rtt < a.rtt ? q : a));
      this.offset = best.offset;
      this.rtt = this.rtt === null ? rtt : this.rtt + (rtt - this.rtt) * 0.2;
      return;
    }
    if (LOBBY.includes(d.k)) { this.events.push(d); return; }
    if (d.k === 'pose') { if (vec(d.p, 10)) this.far = { p: mirror(d.p) }; return; }
    const g = this.game;
    if (!Number.isInteger(d.rally)) return;
    if (!g?.remote) { if (this.early.length < 50) this.early.push(d); return; }
    if (d.k === 'shot' && sane(d.ball) && Number.isInteger(d.n)) g.remoteShot({ rally: d.rally, n: d.n, late: !!d.late, ball: mirrorBall(d.ball), info: d.info && num(d.info.speed) ? { speed: d.info.speed, name: String(d.info.name || '').slice(0, 20), rpm: num(d.info.rpm, 1e5) ? d.info.rpm : 0 } : null }, this.ago(d.t, now));
    else if (d.k === 'toss' && sane(d.ball)) g.remoteToss({ rally: d.rally, ball: mirrorBall(d.ball) }, this.ago(d.t, now));
    else if (d.k === 'retoss') g.remoteRetoss({ rally: d.rally });
    else if (d.k === 'pass' && Number.isInteger(d.n)) g.remotePass({ rally: d.rally, n: d.n });
    else if (d.k === 'point' && (d.winner === 'me' || d.winner === 'you')) g.remotePoint({ rally: d.rally, winner: d.winner === 'me' ? FAR : NEAR, reason: String(d.reason || '').slice(0, 60), kind: d.kind === 'let' ? 'let' : 'point' });
  }
}
