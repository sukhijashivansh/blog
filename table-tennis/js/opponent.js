import { TABLE, FAR, clamp, lerp } from './config.js';
import { TOP, NET_TOP, predictStrike, planShot, planServe, solveFlight } from './physics.js';

const HOME = { x: 0, y: 1.02, z: -1.62 };
// this long before the ball arrives it's settled whether the paddle can get there. if it can, it reaches the rest of the way onto
// the ball at up to LUNGE_SPEED, so the stroke meets it on the blade. if it can't, it carries on and visibly misses
const LUNGE = 0.12, LUNGE_SPEED = 6;
// how much likelier a slip gets with each stroke past the fourth
const RALLY_NERVES = 0.05;

export class Opponent {
  constructor(level, rng) {
    this.level = level;
    this.rng = rng;
    this.p = { ...HOME };
    // where it waits between shots. serving, that's where it tosses from
    this.rest = { ...HOME };
    this.n = { x: 0, y: 0, z: 1 };
    this.plan = null;
    this.delay = 0;
    this.aim = { x: 0, y: 0 };
    this.form = 0;
  }

  reset() { this.plan = null; }

  standAt(x) { this.rest = { ...HOME, x }; }

  // sharpens when you're ahead and eases off when you're behind, so points stay close at any skill
  adapt(playerWon) { this.form = clamp(this.form + (playerWon ? 0.14 : -0.14), -1, 1); }

  // reads the ball late and imperfectly, then corrects once it has seen the bounce
  read(ball, bounced = false) {
    const seen = predictStrike(ball, FAR, bounced);
    if (!seen.valid) { this.plan = null; return; }
    const L = this.level, r = this.rng, pace = Math.hypot(ball.v.x, ball.v.z) / 10;
    const fuzz = (bounced ? 0.03 : 0.14) * pace * (1.25 - L.placement);
    this.aim = { x: (r() - 0.5) * 2 * fuzz, y: (r() - 0.5) * fuzz };
    if (!this.plan) this.delay = L.reaction * (1 - 0.18 * this.form);
    this.plan = { t: seen.t, p: seen.p };
  }

  // true on the step it gets a paddle on the ball
  update(h, ball) {
    const L = this.level, { p, plan } = this;
    let goal = this.rest, speed = L.moveSpeed;
    if (plan) {
      plan.t -= h;
      this.delay -= h;
      goal = this.delay > 0 ? p : { x: plan.p.x + this.aim.x, y: plan.p.y + this.aim.y, z: plan.p.z };
      if (plan.t <= LUNGE && plan.reach === undefined) {
        // where the paddle would be when the ball arrives, moving as it is now
        const left = Math.max(plan.t, 0) * L.moveSpeed, d = Math.hypot(goal.x - p.x, goal.y - p.y, goal.z - p.z), k = d > left ? left / d : 1;
        plan.reach = Math.hypot(plan.p.x - (p.x + (goal.x - p.x) * k), plan.p.y - (p.y + (goal.y - p.y) * k)) <= L.reach;
      }
      if (plan.reach) {
        goal = plan.p;
        speed = Math.min(LUNGE_SPEED, Math.max(L.moveSpeed, Math.hypot(goal.x - p.x, goal.y - p.y, goal.z - p.z) / Math.max(plan.t, h)));
      }
    }
    const dx = goal.x - p.x, dy = goal.y - p.y, dz = goal.z - p.z, d = Math.hypot(dx, dy, dz), step = speed * h;
    if (d <= step) { p.x = goal.x; p.y = goal.y; p.z = goal.z; }
    else { p.x += dx / d * step; p.y += dy / d * step; p.z += dz / d * step; }
    if (!plan || plan.t > 0) return false;
    this.plan = null;
    return plan.reach ?? Math.hypot(ball.p.x - p.x, ball.p.y - p.y) <= L.reach;
  }

  // shots is how many strokes the rally has had: the longer it runs, the likelier a slip, as in a real rally
  stroke(ball, playerX, shots = 0) {
    const L = this.level, r = this.rng, S = L.spin, pace = 1 + 0.16 * this.form;
    const lo = L.shotSpeed[0] * pace, hi = L.shotSpeed[1] * pace, place = clamp(L.placement * (1 + 0.15 * this.form), 0, 1);
    const pressure = clamp(Math.hypot(ball.v.x, ball.v.y, ball.v.z) / 14 + Math.abs(ball.w.x) / 480, 0, 1.4);
    const topIn = -ball.w.x, above = ball.p.y - NET_TOP;
    let kind = 'drive';
    if (above > 0.2 && r() < L.attack) kind = 'smash';
    else if (pressure > 0.95) kind = 'block';
    else if (topIn < -50) kind = r() < L.loop ? 'topspin' : 'push';
    else if (r() < L.loop) kind = 'topspin';

    // each kind of shot has its own pace, spin and height over the net: a loop arcs high on heavy topspin and dips onto the
    // table, a drive skims flatter, a push floats short on backspin, a smash goes straight through
    const [speed, spin, lift] = {
      smash: [hi * 1.22, 0.3 * S, 0],
      drive: [lerp(lo, hi, r()), 0.7 * S, 0.02 + 0.05 * r()],
      topspin: [lerp(lo, hi, 0.55 + r() * 0.45), 1.5 * S, 0.08 + 0.16 * r()],
      push: [lo * 0.8, -1.0 * S, 0.02],
      block: [lo * 0.95, 0.25 * S, 0.01 + 0.03 * r()],
    }[kind];
    const w = { x: spin, y: (r() - 0.5) * S * 0.5, z: 0 };

    // aim away from where you are standing, with the odd ball back at you
    const away = playerX >= 0 ? -1 : 1, dir = r() < 0.75 ? away : -away;
    let x = dir * lerp(0.1, 0.62, place * Math.pow(r(), 0.6));
    let z = kind === 'push' ? lerp(0.45, 0.95, r()) : lerp(0.7, 1.24, lerp(r(), 1, place * 0.5));

    if (r() < L.err * (1 - 0.4 * this.form) * (1 + 2.4 * pressure) * (1 + RALLY_NERVES * Math.max(0, shots - 4))) {
      const miss = r();
      if (miss < 1 / 3) {
        const T = Math.hypot(x - ball.p.x, ball.p.z) / speed;
        return { v: solveFlight(ball.p, { x, y: NET_TOP - 0.045, z: 0 }, Math.max(T, 0.12), w), w, kind };
      }
      if (miss < 2 / 3) z = TABLE.halfL + lerp(0.08, 0.4, r());
      else x = (x >= 0 ? 1 : -1) * (TABLE.halfW + lerp(0.06, 0.3, r()));
    }
    return { v: planShot(ball.p, { x, y: TOP, z }, speed, w, lift), w, kind };
  }

  serve(ball, playerX) {
    const L = this.level, r = this.rng, S = L.spin, type = r();
    const w = type < 0.4 ? { x: -S * 0.9, y: (r() - 0.5) * S * 0.6, z: 0 }
      : type < 0.7 ? { x: S * 0.7, y: (r() - 0.5) * S * 0.5, z: 0 }
      : { x: 0, y: (r() < 0.5 ? -1 : 1) * S * 0.9, z: 0 };
    const to = {
      x: (playerX >= 0 ? -1 : 1) * lerp(0.05, 0.58, r() * L.placement), y: TOP,
      z: r() < 0.35 ? lerp(0.5, 0.8, r()) : lerp(0.9, 1.24, r()),
    };
    const pace = lerp(L.shotSpeed[0] * 0.7, L.shotSpeed[1] * 0.75, r()) * (1 + 0.16 * this.form);
    const v = planServe(ball.p, to, pace, w) ?? solveFlight(ball.p, to, 0.5, w);
    if (r() < L.serveErr) v.z *= r() < 0.5 ? 1.22 : 0.7;
    return { v, w };
  }
}
