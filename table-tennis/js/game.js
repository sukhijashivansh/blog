import { TABLE, BALL_R, NEAR, FAR, STEP, LEVELS, PRACTICE, clamp, lerp, other } from './config.js';
import { makeBall, cloneBall, advance, predictStrike, firstContact } from './physics.js';
import { Match, Rally } from './rules.js';
import { Opponent } from './opponent.js';
import { playerStroke, playerServe, describeShot } from './strokes.js';

const TOSS_SPEED = 2.6, LIFT = 0.08, LIFT_SPEED = 1.2, SERVE_SWING = 0.8, SERVE_SETTLE = 0.45, COOLDOWN = 0.18;
// the tossed ball can be struck from this far above the paddle down to this far below it, since a flick reaches the game a moment late
// the ball is behind the end line by then, so it can drop to just above table height before it counts as missed
const SERVE_ZONE = [0.34, -0.16], DROP_TO = TABLE.height + 0.04;
const POINT_PAUSE = 1.3, GAME_PAUSE = 2.6, AI_SERVE_WAIT = 1.2, PRACTICE_PAUSE = 0.8;
// a flick can reach the game a moment after the ball has met the paddle. if one lands this soon after contact, and it's a real
// flick that beats the swing the ball was hit with, the shot is played again from the contact with it
const LATE = 0.11, LATE_FLICK = 1.5, STRONGER = 1.35;
// the drawn ball eases onto a replayed path over this long, longer the further it has to go, so it never visibly jumps
const NUDGE = [0.05, 0.16];
// playing a friend online. the ball waits at most HOLD (game seconds) at their paddle for their hit to arrive over the internet,
// then runs up to WARP faster until it has caught up with the time it lost. each end judges what happens on its own half, and
// the net zone, within NET_ZONE of the net, belongs to whoever sent the invite, so every call has one judge. if a call never
// comes, the inviter's laptop makes it after WAIT_CALL and the friend's after twice that, so the two can't both step in at once
const HOLD = 0.3, WARP = 0.6, WAIT_CALL = 2.5, NET_ZONE = 0.3;
// a ball this long past where you should have met it counts as gone by, and your friend's laptop is told at once, so it never
// waits at your paddle for a hit that isn't coming
const PASS = 0.03;
const speed = v => Math.hypot(v.x, v.y, v.z);
const mix = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) });
const put = (to, a, b, t) => { to.x = lerp(a.x, b.x, t); to.y = lerp(a.y, b.y, t); to.z = lerp(a.z, b.z, t); };

export class Game {
  constructor(rng = Math.random) {
    this.rng = rng;
    this.ball = makeBall();
    this.phase = 'idle';
    this.events = [];
    this.guide = null;
    this.acc = 0;
    this.padAt = null;
    this.practice = null;
    this.onBall = this.onBall.bind(this);
    // where things are drawn: between the last two physics steps, so they move evenly whatever the frame rate
    this.was = { ball: { ...this.ball.p }, ai: { x: 0, y: 0, z: 0 } };
    this.drawn = { ball: { ...this.ball.p }, ai: { x: 0, y: 0, z: 0 } };
    // when a late flick replays a shot, the drawn ball eases onto the new path instead of jumping
    this.nudge = { x: 0, y: 0, z: 0 };
    this.nudgeTime = NUDGE[0];
    this.late = null;
    this.remote = null;
    this.rallyNo = 0;
  }

  // practice = { server } runs the warm-up: no score, and the opponent keeps the ball in play.
  // remote = { host } plays a friend online: their hits, calls and paddle come in over the network instead of from the computer
  start(levelId, bestOf, firstServer, practice = null, remote = null) {
    this.practice = practice;
    this.remote = remote ? { host: !!remote.host, farAt: null, hold: 0, holdMax: HOLD, debt: 0, waiting: null, passed: true, ahead: [] } : null;
    this.rallyNo = 0;
    this.level = practice ? { ...LEVELS[levelId], ...PRACTICE } : LEVELS[levelId];
    this.match = new Match(bestOf, firstServer);
    this.ai = new Opponent(this.level, this.rng);
    this.stats = { longest: 0, fastest: 0, won: 0, lost: 0 };
    Object.assign(this.was.ai, this.ai.p);
    this.acc = 0;
    this.padAt = null;
    this.beginPoint();
  }

  // where the player's paddle should be drawn toward right now
  get assist() {
    const L = this.level;
    if (this.phase === 'toss' && this.rally.server === NEAR) {
      const b = this.ball.p;
      return { x: b.x, y: null, z: b.z + 0.04, t: 0, magnet: L.magnet, reach: L.hitRadius };
    }
    const g = this.guide;
    if (!g || this.phase !== 'play') return null;
    // spin is the incoming ball's topspin (backspin below zero), so the paddle can angle its face to meet it
    return { x: g.p.x, y: g.p.y, z: Math.max(g.p.z, this.ball.p.z + 0.06), t: Math.max(g.t, 0) / L.timeScale, magnet: L.magnet, reach: L.hitRadius, spin: this.ball.w.x };
  }

  drain() { const e = this.events; this.events = []; return e; }

  beginPoint() {
    const server = this.practice ? this.practice.server : this.match.server;
    this.rallyNo++;
    this.rally = new Rally(server);
    this.phase = 'serve';
    this.guide = null;
    this.settle = 0;
    this.rest = null;
    this.wait = AI_SERVE_WAIT;
    this.cooldown = 0;
    this.result = null;
    this.late = null;
    this.dropped = null;
    this.ai.reset();
    this.ai.standAt(0);
    const b = this.ball;
    b.v = { x: 0, y: 0, z: 0 };
    b.w = { x: 0, y: 0, z: 0 };
    this.aiServe = null;
    const R = this.remote;
    if (R) Object.assign(R, { farAt: null, hold: 0, debt: 0, waiting: null });
    if (server === FAR && R) {
      // your friend serves from their own paddle. the ball sits in front of it until their toss comes through
      Object.assign(b.p, this.farServeSpot());
    } else if (server === FAR) {
      this.aiServeX = (this.rng() - 0.5) * 0.7;
      this.ai.standAt(this.aiServeX);
      b.p = { x: this.aiServeX, y: 1, z: -(TABLE.halfL + 0.14) };
      // worked out now, while the ball sits still, so the serve itself never costs a frame
      this.aiServe = this.ai.serve({ p: { x: this.aiServeX, y: b.p.y + 0.05, z: b.p.z }, v: { x: 0, y: 0, z: 0 }, w: { x: 0, y: 0, z: 0 } }, this.padAt?.x ?? 0);
    }
    // the ball jumps to the server, so don't draw it sliding there
    Object.assign(this.was.ball, b.p);
    this.events.push({ type: 'serve', server, rally: this.rallyNo });
    // anything the friend sent for this point before it began here is played now
    if (R) {
      const now = R.ahead.filter(m => m.rally === this.rallyNo);
      R.ahead = R.ahead.filter(m => m.rally > this.rallyNo);
      for (const m of now) this[m.kind](m.msg, m.late);
    }
  }

  farServeSpot() {
    const a = this.ai.p;
    return { x: clamp(a.x, -TABLE.halfW, TABLE.halfW), y: Math.max(a.y + 0.08, TABLE.height + 0.12), z: Math.min(a.z + 0.06, -(TABLE.halfL + 0.04)) };
  }

  // the paddle is swept between frames so a fast swing can't skip past the ball
  update(dt, pad) {
    if (this.phase === 'idle' || this.phase === 'over') return;
    this.acc += dt * this.level.timeScale;
    // catching up on time lost waiting for a friend's hit: the world runs a little fast until it's back in step
    const R = this.remote;
    if (R && R.debt > 0) {
      const extra = Math.min(R.debt, dt * this.level.timeScale * WARP);
      R.debt -= extra;
      this.acc += extra;
    }
    const n = Math.floor(this.acc / STEP);
    this.acc -= n * STEP;
    if (n) {
      const from = this.padAt ?? pad.p;
      let prev = from;
      for (let i = 1; i <= n && this.phase !== 'over'; i++) {
        const cur = mix(from, pad.p, i / n);
        this.step(prev, cur, pad);
        prev = cur;
      }
      this.padAt = { ...pad.p };
    }
    const f = this.acc / STEP, d = this.drawn.ball, k = Math.exp(-dt / this.nudgeTime), u = this.nudge;
    put(d, this.was.ball, this.ball.p, f);
    u.x *= k; u.y *= k; u.z *= k;
    d.x += u.x; d.y += u.y; d.z += u.z;
    put(this.drawn.ai, this.was.ai, this.ai.p, f);
  }

  step(prev, cur, pad) {
    const real = STEP / this.level.timeScale;
    Object.assign(this.was.ball, this.ball.p);
    Object.assign(this.was.ai, this.ai.p);
    if (this.cooldown > 0) this.cooldown -= STEP;
    if (this.late) this.lateFlick(pad);
    if (this.guide) this.guide.t -= STEP;
    const R = this.remote;
    if (R) {
      if (R.farAt) R.farAt.t -= STEP;
      if (R.waiting && (R.waiting.t += STEP) > WAIT_CALL * (R.host ? 1 : 2)) this.resolve(R.waiting.call, 'late');
      if (this.guide && this.guide.t < -PASS && !R.passed && this.phase === 'play') {
        R.passed = true;
        this.events.push({ type: 'passed', rally: this.rallyNo, n: this.rally.shots });
      }
    }
    if (this.phase === 'serve') this.stepServe(real, cur, pad);
    else if (this.phase === 'toss') this.stepToss(cur, pad);
    else if (this.phase === 'play') this.stepPlay(prev, cur, pad);
    else if (this.phase === 'dead') this.stepDead(real);
    else if (this.phase === 'break') {
      this.timer -= real;
      if (this.timer <= 0) { this.match.nextGame(); this.beginPoint(); }
    }
  }

  /* ---------- serving: tip the phone up to toss, flick as it falls. a missed toss just comes back to you ---------- */
  stepServe(real, cur, pad) {
    const b = this.ball;
    if (this.remote && this.rally.server === FAR) { Object.assign(b.p, this.farServeSpot()); return; }
    if (!this.remote) this.ai.update(STEP, b);
    if (this.rally.server === FAR) {
      // it walks over to where it serves from, and only tosses once it's there
      this.wait -= real;
      if (this.wait <= 0 && Math.abs(this.ai.p.x - this.aiServeX) < 0.02) this.toss();
      return;
    }
    b.p.x = clamp(cur.x, -TABLE.halfW, TABLE.halfW);
    b.p.y = Math.max(cur.y + 0.08, TABLE.height + 0.12);
    b.p.z = Math.max(cur.z - 0.06, TABLE.halfL + 0.04);
    this.settle += real;
    // the baseline trails the paddle, so any deliberate lift above it counts, however slowly you tip up
    this.rest = this.rest === null ? cur.y : this.rest + (cur.y - this.rest) * (1 - Math.exp(-real * 2.2));
    if (this.settle > SERVE_SETTLE && (cur.y - this.rest > LIFT || pad.v.y > LIFT_SPEED)) this.toss();
  }

  toss() {
    this.ball.v = { x: 0, y: TOSS_SPEED, z: 0 };
    this.aiHitY = this.ball.p.y + 0.05;
    this.phase = 'toss';
    this.events.push({ type: 'toss', who: this.rally.server, rally: this.rallyNo, state: cloneBall(this.ball) });
  }

  stepToss(cur, pad) {
    const b = this.ball, L = this.level;
    advance(b, STEP, this.onBall);
    if (this.phase !== 'toss' || b.v.y >= 0) return;
    // your friend's toss: they hit it, or toss again, on their own laptop
    if (this.remote && this.rally.server === FAR) return;
    if (this.rally.server === FAR) {
      if (b.p.y > this.aiHitY) return;
      this.rally.strike(FAR);
      this.applyShot(FAR, this.aiServe ?? this.ai.serve(b, cur.x));
      return;
    }
    const dx = Math.abs(b.p.x - cur.x), dy = b.p.y - cur.y, swung = speed(pad.swing) >= SERVE_SWING, low = b.p.y < DROP_TO;
    // the ball has just dropped out of reach. a flick that lands now still serves it, from where it dropped out
    const T = this.dropped;
    if (T) {
      T.t += STEP;
      if (low || T.t > LATE * L.timeScale) this.retoss();
      else if (swung) {
        // one try: working out a serve isn't cheap, so it isn't repeated step after step
        if (!this.replay(T.ball, playerServe(T.ball, pad, L, T.offset), T.t)) { this.retoss(); return; }
        this.dropped = null;
        this.rally.strike(NEAR);
        this.applyShot(NEAR, { v: { ...b.v }, w: { ...b.w } }, pad);
      }
      return;
    }
    const offset = clamp(dx / L.hitRadius, 0, 1), reach = dx <= L.hitRadius * 1.2;
    if (reach && dy <= SERVE_ZONE[0] && dy >= SERVE_ZONE[1] && swung) {
      const at = cloneBall(b);
      this.rally.strike(NEAR);
      this.applyShot(NEAR, playerServe(b, pad, L, offset), pad);
      this.lateFrom('serve', at, pad, offset);
    } else if (reach && dy < SERVE_ZONE[1] && !low) this.dropped = { ball: cloneBall(b), offset, t: 0 };
    else if (dy < SERVE_ZONE[1] || low) this.retoss();
  }

  retoss() {
    this.dropped = null;
    this.phase = 'serve';
    this.settle = 0;
    this.rest = null;
    this.ball.v = { x: 0, y: 0, z: 0 };
    this.events.push({ type: 'retoss', rally: this.rallyNo });
  }

  /* ---------- the rally ---------- */
  stepPlay(prev, cur, pad) {
    const b = this.ball, before = { ...b.p }, R = this.remote;
    // the ball reached your friend's paddle before their hit came through. it waits there a moment for it
    if (R && R.farAt && R.farAt.t <= 0 && !R.waiting) {
      if (R.hold < R.holdMax) { R.hold += STEP; return; }
      R.farAt = null;
    }
    advance(b, STEP, this.onBall);
    if (this.phase !== 'play') return;
    if (!R && this.ai.update(STEP, b) && this.rally.phase === 'bounced') {
      const call = this.rally.strike(FAR), shot = this.ai.stroke(b, cur.x, this.rally.shots);
      if (call) { b.v = shot.v; b.w = shot.w; this.resolve(call); return; }
      this.applyShot(FAR, shot);
    }
    if (this.phase !== 'play') return;
    if (this.cooldown <= 0 && this.touches(before, prev, cur)) {
      const first = firstContact(b), headed = first?.type === 'table' && first.side === NEAR, at = cloneBall(b);
      const call = this.rally.strike(NEAR, headed), shot = playerStroke(b, pad, this.level, this.hitOff);
      // a fault in your own stroke is yours to call, wherever on the table you made it
      if (call) { b.v = shot.v; b.w = shot.w; this.cooldown = COOLDOWN; this.resolve(call, 'own'); return; }
      this.applyShot(NEAR, shot, pad);
      this.lateFrom('stroke', at, pad, this.hitOff);
    }
    if (this.phase !== 'play') return;
    if (b.p.y < 0.45 || Math.abs(b.p.z) > 3.6 || Math.abs(b.p.x) > 2.6) this.resolve(this.rally.dead());
  }

  touches(before, prev, cur) {
    const b = this.ball;
    if (b.v.z < -0.4) return false;
    const d0 = prev.z - before.z, d1 = cur.z - b.p.z;
    if (d0 < -0.05 || d1 > BALL_R) return false;
    const f = d0 > d1 ? clamp((d0 - BALL_R) / (d0 - d1), 0, 1) : 1;
    const at = mix(before, b.p, f), pa = mix(prev, cur, f), off = Math.hypot(at.x - pa.x, at.y - pa.y);
    if (off > this.level.hitRadius) return false;
    // brushing a ball that's about to land on your side isn't held against you, the paddle just waits for the bounce
    if (this.rally.phase !== 'bounced') {
      const first = firstContact(b);
      if (first?.type === 'table' && first.side === NEAR) return false;
    }
    b.p = at;
    this.hitOff = off / this.level.hitRadius;
    return true;
  }

  lateFrom(kind, ball, pad, offset) {
    this.late = { kind, ball, offset, n: { ...pad.n }, swing: speed(pad.swing), t: 0 };
  }

  lateFlick(pad) {
    const L = this.late;
    if (L.t > LATE * this.level.timeScale || this.phase !== 'play' || this.rally.striker !== NEAR) { this.late = null; return; }
    const m = speed(pad.swing);
    if (m < LATE_FLICK || m < L.swing * STRONGER) { L.t += STEP; return; }
    this.late = null;
    const p = { ...pad, n: L.n }, shot = L.kind === 'serve' ? playerServe(L.ball, p, this.level, L.offset) : playerStroke(L.ball, p, this.level, L.offset);
    if (!this.replay(L.ball, shot, L.t)) return;
    const info = describeShot({ p: L.ball.p, v: shot.v, w: shot.w }, L.ball.p.y);
    this.stats.fastest = Math.max(this.stats.fastest, info.speed);
    this.events.push({ type: 'hit', who: NEAR, ...info, side: pad.forehand ? 'Forehand' : 'Backhand', late: true, rally: this.rallyNo, n: this.rally.shots, state: cloneBall(this.ball) });
    this.readBall();
  }

  // plays a shot from an earlier moment up to now and puts the ball on that path, easing the drawn ball across.
  // if the ball would already have touched something on the way, it's too late to change and nothing happens
  replay(from, shot, elapsed) {
    const b = cloneBall(from);
    b.v = { ...shot.v };
    b.w = { ...shot.w };
    let touched = false;
    advance(b, elapsed, () => { touched = true; });
    if (touched) return false;
    const ball = this.ball, u = this.nudge, w = this.was.ball;
    for (const k of ['x', 'y', 'z']) {
      u[k] += ball.p[k] - b.p[k];
      w[k] += b.p[k] - ball.p[k];
    }
    this.nudgeTime = clamp(NUDGE[0] + Math.hypot(u.x, u.y, u.z) * 0.25, ...NUDGE);
    Object.assign(ball.p, b.p);
    Object.assign(ball.v, b.v);
    Object.assign(ball.w, b.w);
    return true;
  }

  applyShot(who, shot, pad) {
    const b = this.ball, hitY = b.p.y;
    b.v = shot.v;
    b.w = shot.w;
    this.phase = 'play';
    this.guide = null;
    if (who === NEAR) this.cooldown = COOLDOWN;
    const info = describeShot(b, hitY);
    if (who === NEAR) this.stats.fastest = Math.max(this.stats.fastest, info.speed);
    this.events.push({ type: 'hit', who, ...info, side: pad ? (pad.forehand ? 'Forehand' : 'Backhand') : '', rally: this.rallyNo, n: this.rally.shots, state: cloneBall(b) });
    this.readBall();
  }

  /* ---------- a friend's play, arriving over the network, already turned round to this end of the table ---------- */
  // late is how long ago, in real seconds, it happened on their laptop
  hold(kind, msg, late) {
    if (msg.rally < this.rallyNo || this.phase === 'over') return true;
    if (msg.rally > this.rallyNo || this.phase === 'dead' || this.phase === 'break') { this.remote.ahead.push({ kind, msg, late }); return true; }
    return false;
  }

  remoteToss(msg, late = 0) {
    if (this.hold('remoteToss', msg, late) || this.rally.server !== FAR || this.phase !== 'serve') return;
    this.remote.waiting = null;
    Object.assign(this.ball, cloneBall(msg.ball));
    Object.assign(this.was.ball, this.ball.p);
    this.phase = 'toss';
    this.events.push({ type: 'toss', who: FAR, rally: this.rallyNo });
  }

  // their toss dropped out of reach. if it fell far enough here to look like a missed serve, that call is dropped
  remoteRetoss(msg) {
    if (this.hold('remoteRetoss', msg, 0) || this.rally.server !== FAR || this.phase !== 'toss') return;
    this.remote.waiting = null;
    this.phase = 'serve';
    this.ball.v = { x: 0, y: 0, z: 0 };
  }

  remoteShot(msg, late = 0) {
    if (this.hold('remoteShot', msg, late)) return;
    const R = this.remote, r = this.rally;
    if (msg.late) {
      // a late flick on their side replayed a shot this laptop already has: swap in the stronger path
      if (r.striker !== FAR || r.shots !== msg.n) return;
    } else {
      if (r.striker === FAR && r.shots >= msg.n) return;
      // their laptop already judged this strike legal, so the rally moves on even if this end would have read it differently
      if (r.phase === 'toss') { r.phase = 'serve-own'; r.striker = FAR; r.shots = 1; }
      else { r.striker = FAR; r.phase = 'flying'; r.shots = msg.n; }
    }
    const from = this.ball.p, to = msg.ball.p, u = this.nudge, w = this.was.ball;
    for (const k of ['x', 'y', 'z']) { u[k] += from[k] - to[k]; w[k] += to[k] - from[k]; }
    this.nudgeTime = clamp(NUDGE[0] + Math.hypot(u.x, u.y, u.z) * 0.25, ...NUDGE);
    this.ball.p = { ...to };
    this.ball.v = { ...msg.ball.v };
    this.ball.w = { ...msg.ball.w };
    this.phase = 'play';
    this.guide = null;
    R.farAt = null;
    R.hold = 0;
    R.waiting = null;
    // the time it spent on the way is made up by running a little fast
    R.debt = Math.min(late, 0.4) * this.level.timeScale;
    if (!msg.late) this.events.push({ type: 'hit', who: FAR, speed: msg.info?.speed || speed(msg.ball.v), name: msg.info?.name || '', rpm: msg.info?.rpm || 0, side: '', rally: this.rallyNo, n: r.shots });
    this.readBall();
  }

  // the ball went past your friend's paddle on their laptop, so it carries on here too
  remotePass(msg) {
    if (this.hold('remotePass', msg, 0) || this.rally.striker !== NEAR || this.rally.shots !== msg.n) return;
    this.remote.farAt = null;
  }

  remotePoint(msg) {
    if (this.hold('remotePoint', msg, 0)) return;
    this.resolve({ type: msg.kind === 'let' ? 'let' : 'point', winner: msg.winner, reason: msg.reason }, 'told');
  }

  // which end owns a call: yours on your half, your friend's on theirs, and the net zone the inviter's
  mine() {
    const z = this.ball.p.z;
    return this.remote.host ? z > -NET_ZONE : z > NET_ZONE;
  }

  onBall(type, speed, side) {
    if (speed > 0.2) this.events.push({ type: 'bounce', on: type, speed, side });
    if (this.phase !== 'toss' && this.phase !== 'play') return;
    // waiting on your friend's call: the ball keeps bouncing, but nothing more is judged here
    if (this.remote?.waiting) return;
    const was = this.rally.phase;
    const call = type === 'table' ? this.rally.table(side) : type === 'net' ? this.rally.net() : this.rally.dead();
    if (call) { this.resolve(call); return; }
    if (was === 'serve-cross' && this.rally.phase === 'bounced') this.events.push({ type: 'serveIn', who: this.rally.server });
    this.readBall();
  }

  // whoever has to play the ball next re-reads it after every contact
  readBall() {
    const { phase, striker, receiver } = this.rally;
    let who;
    if (phase === 'serve-cross') who = receiver;
    else if (phase === 'flying' || phase === 'bounced') who = other(striker);
    else return;
    const bounced = phase === 'bounced';
    if (who === FAR && this.remote) {
      // where your friend should meet it, so the ball can wait there if their hit is still on its way
      const seen = predictStrike(this.ball, FAR, bounced);
      this.remote.farAt = seen.valid ? { t: seen.t } : null;
      this.remote.hold = 0;
      return;
    }
    if (who === FAR) { this.ai.read(this.ball, bounced); return; }
    const seen = predictStrike(this.ball, NEAR, bounced);
    this.guide = seen.valid ? seen : null;
    if (this.remote) this.remote.passed = !this.guide;
  }

  /* ---------- ending the point ---------- */
  // how, playing a friend: 'auto' judges it here if it happened on this end, 'own' is a fault in your own stroke, 'told' is your
  // friend's call arriving and 'late' a call of theirs that never came. every call made here is sent to them
  resolve(call, how = 'auto') {
    const R = this.remote;
    if (R) {
      // on your friend's half it's theirs to call. the ball plays on while their call comes through
      if (how === 'auto' && !this.mine()) { if (!R.waiting) R.waiting = { call, t: 0 }; return; }
      if (how !== 'told') this.events.push({ type: 'decided', rally: this.rallyNo, winner: call.winner, reason: call.reason, kind: call.type });
      R.waiting = null;
    }
    this.phase = 'dead';
    this.timer = POINT_PAUSE;
    this.guide = null;
    this.ai.reset();
    if (this.practice) {
      this.result = {};
      this.timer = PRACTICE_PAUSE;
      this.events.push({ type: 'practice', winner: call.winner, reason: call.reason });
      return;
    }
    if (call.type === 'let') {
      this.result = {};
      this.events.push({ type: 'let', reason: call.reason, rally: this.rallyNo });
      return;
    }
    this.result = this.match.point(call.winner);
    if (!R) this.ai.adapt(call.winner === NEAR);
    this.stats.longest = Math.max(this.stats.longest, this.rally.shots);
    this.stats[call.winner === NEAR ? 'won' : 'lost']++;
    this.events.push({ type: 'point', winner: call.winner, reason: call.reason, rally: this.rallyNo, ...this.result });
  }

  stepDead(real) {
    advance(this.ball, STEP, this.onBall);
    if (!this.remote) this.ai.update(STEP, this.ball);
    this.timer -= real;
    if (this.timer > 0) return;
    if (this.result.matchOver) {
      this.phase = 'over';
      this.events.push({ type: 'over', winner: this.match.winner });
    } else if (this.result.gameOver) {
      this.phase = 'break';
      this.timer = GAME_PAUSE;
      this.events.push({ type: 'game', last: this.match.history[this.match.history.length - 1] });
    } else this.beginPoint();
  }
}
