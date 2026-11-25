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
  }

  // practice = { server } runs the warm-up: no score, and the opponent keeps the ball in play
  start(levelId, bestOf, firstServer, practice = null) {
    this.practice = practice;
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
    if (server === FAR) {
      this.aiServeX = (this.rng() - 0.5) * 0.7;
      this.ai.standAt(this.aiServeX);
      b.p = { x: this.aiServeX, y: 1, z: -(TABLE.halfL + 0.14) };
      // worked out now, while the ball sits still, so the serve itself never costs a frame
      this.aiServe = this.ai.serve({ p: { x: this.aiServeX, y: b.p.y + 0.05, z: b.p.z }, v: { x: 0, y: 0, z: 0 }, w: { x: 0, y: 0, z: 0 } }, this.padAt?.x ?? 0);
    }
    // the ball jumps to the server, so don't draw it sliding there
    Object.assign(this.was.ball, b.p);
    this.events.push({ type: 'serve', server });
  }

  // the paddle is swept between frames so a fast swing can't skip past the ball
  update(dt, pad) {
    if (this.phase === 'idle' || this.phase === 'over') return;
    this.acc += dt * this.level.timeScale;
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
    this.ai.update(STEP, b);
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
    this.events.push({ type: 'toss', who: this.rally.server });
  }

  stepToss(cur, pad) {
    const b = this.ball, L = this.level;
    advance(b, STEP, this.onBall);
    if (this.phase !== 'toss' || b.v.y >= 0) return;
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
    this.events.push({ type: 'retoss' });
  }

  /* ---------- the rally ---------- */
  stepPlay(prev, cur, pad) {
    const b = this.ball, before = { ...b.p };
    advance(b, STEP, this.onBall);
    if (this.phase !== 'play') return;
    if (this.ai.update(STEP, b) && this.rally.phase === 'bounced') {
      const call = this.rally.strike(FAR), shot = this.ai.stroke(b, cur.x, this.rally.shots);
      if (call) { b.v = shot.v; b.w = shot.w; this.resolve(call); return; }
      this.applyShot(FAR, shot);
    }
    if (this.phase !== 'play') return;
    if (this.cooldown <= 0 && this.touches(before, prev, cur)) {
      const first = firstContact(b), headed = first?.type === 'table' && first.side === NEAR, at = cloneBall(b);
      const call = this.rally.strike(NEAR, headed), shot = playerStroke(b, pad, this.level, this.hitOff);
      if (call) { b.v = shot.v; b.w = shot.w; this.cooldown = COOLDOWN; this.resolve(call); return; }
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
    this.events.push({ type: 'hit', who: NEAR, ...info, side: pad.forehand ? 'Forehand' : 'Backhand', late: true });
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
    this.events.push({ type: 'hit', who, ...info, side: pad ? (pad.forehand ? 'Forehand' : 'Backhand') : '' });
    this.readBall();
  }

  onBall(type, speed, side) {
    if (speed > 0.2) this.events.push({ type: 'bounce', on: type, speed, side });
    if (this.phase !== 'toss' && this.phase !== 'play') return;
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
    if (who === FAR) { this.ai.read(this.ball, bounced); return; }
    const seen = predictStrike(this.ball, NEAR, bounced);
    this.guide = seen.valid ? seen : null;
  }

  /* ---------- ending the point ---------- */
  resolve(call) {
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
      this.events.push({ type: 'let', reason: call.reason });
      return;
    }
    this.result = this.match.point(call.winner);
    this.ai.adapt(call.winner === NEAR);
    this.stats.longest = Math.max(this.stats.longest, this.rally.shots);
    this.stats[call.winner === NEAR ? 'won' : 'lost']++;
    this.events.push({ type: 'point', winner: call.winner, reason: call.reason, ...this.result });
  }

  stepDead(real) {
    advance(this.ball, STEP, this.onBall);
    this.ai.update(STEP, this.ball);
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
