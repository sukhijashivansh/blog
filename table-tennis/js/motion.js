// turns the phone's sensor readings into where it points and how hard it's flicked.
// it runs on the phone and touches no browser APIs, so the tests can drive it with made-up motion
const RAD = Math.PI / 180, G = 9.81;
// a flick is read from how fast the top of the phone sweeps, as if it were the head of a paddle this far from your wrist
const ARM = 0.45, TIP_SMOOTH = 0.6;
// a fast turn is a swing, not aiming. past FLICK[1] rad/s the pointer holds still, through the flick and the wrist coming back,
// until the phone has turned slower than FLICK[0] for CALM seconds. any gap left over then fades out over SETTLE
const FLICK = [3.5, 7], CALM = 0.06, SETTLE = 0.15, SPEED_FALL = 0.05;
// pointing past the side edge drags the middle along with you. that also soaks up the gyro's slow drift
export const YAW_EDGE = 0.62;
// near vertical the heading means nothing, so it's held
const UPRIGHT = 0.94;
// a push towards the table comes from the accelerometer. that drifts, so speed leaks away and snaps to zero once the phone is still
const LEAK = 0.3, STILL_LEAK = 0.04, STILL_ACCEL = 0.7, STILL_FOR = 0.06, MAX_PUSH = 6;

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

// device to earth rotation for the W3C alpha, beta, gamma angles. columns are the phone's axes in earth space (x east, y north, z up)
export function rotation(a, b, g) {
  const cA = Math.cos(a), sA = Math.sin(a), cB = Math.cos(b), sB = Math.sin(b), cG = Math.cos(g), sG = Math.sin(g);
  return [
    cA * cG - sA * sB * sG, -cB * sA, cG * sA * sB + cA * sG,
    cG * sA + cA * sB * sG, cA * cB, sA * sG - cA * cG * sB,
    -cB * sG, sB, cB * cG,
  ];
}
const toEarth = (m, v) => ({ x: m[0] * v.x + m[1] * v.y + m[2] * v.z, y: m[3] * v.x + m[4] * v.y + m[5] * v.z, z: m[6] * v.x + m[7] * v.y + m[8] * v.z });

export class Motion {
  constructor() {
    this.R = null;
    this.gravity = G;
    this.sens = 1;
    this.heading = null;
    this.elev = 0;
    this.twist = 0;
    this.home = null;
    this.t = 0;
    this.lastMotion = 0;
    this.f = null;
    this.raw = { yaw: 0, pitch: 0 };
    this.aim = { yaw: 0, pitch: 0 };
    this.off = { yaw: 0, pitch: 0 };
    this.speed = 0;
    this.flicking = false;
    this.calm = 0;
    this.tip = { x: 0, y: 0, z: 0 };
    this.lin = { x: 0, y: 0, z: 0 };
    this.quiet = 0;
  }

  // wherever the phone points now becomes the middle of the table
  recenter() {
    if (this.heading === null) return;
    this.home = { heading: this.heading, elev: this.elev };
    this.raw = { yaw: 0, pitch: 0 };
    this.aim = { yaw: 0, pitch: 0 };
    this.off = { yaw: 0, pitch: 0 };
    this.speed = 0;
    this.flicking = false;
    for (const k of ['x', 'y', 'z']) { this.tip[k] = 0; this.lin[k] = 0; }
  }

  // earth space to the player's frame: right, up, and back from the table (the game's +z)
  toPlayer(w) {
    const h = this.home ? this.home.heading : 0, fwd = -Math.sin(h) * w.x + Math.cos(h) * w.y;
    return { x: Math.cos(h) * w.x + Math.sin(h) * w.y, y: w.z, z: -fwd };
  }

  orient(alpha, beta, gamma, t) {
    const R = this.R = rotation(alpha * RAD, beta * RAD, gamma * RAD);
    // the top edge is the pointer
    const f = { x: R[1], y: R[4], z: R[7] }, dt = this.t ? t - this.t : 0;
    this.t = t;
    if (this.heading === null || Math.abs(f.z) < UPRIGHT) this.heading = Math.atan2(-f.x, f.y);
    this.elev = Math.asin(clamp(f.z, -1, 1));
    this.twist = Math.asin(clamp(-R[6], -1, 1));
    if (!this.home) this.recenter();

    // the tip's speed comes from the change in direction, which is clean and has no drift
    let turn = 0;
    if (this.f && dt > 0.002 && dt < 0.1) {
      const v = this.toPlayer({ x: (f.x - this.f.x) * ARM / dt, y: (f.y - this.f.y) * ARM / dt, z: (f.z - this.f.z) * ARM / dt });
      for (const k of ['x', 'y', 'z']) this.tip[k] += (v[k] - this.tip[k]) * TIP_SMOOTH;
      turn = Math.acos(clamp(f.x * this.f.x + f.y * this.f.y + f.z * this.f.z, -1, 1)) / dt;
      // rises the instant a flick starts, so the pointer stops before it has moved far
      this.speed = Math.max(turn, this.speed * Math.exp(-dt / SPEED_FALL));
    } else {
      for (const k of ['x', 'y', 'z']) this.tip[k] = 0;
      this.speed = 0;
    }
    this.f = f;
    if (this.speed >= FLICK[1]) { this.flicking = true; this.calm = 0; }
    else if (this.flicking) {
      this.calm = turn < FLICK[0] ? this.calm + dt : 0;
      if (this.calm >= CALM) this.flicking = false;
    }

    let yaw = wrap(this.heading - this.home.heading) * this.sens;
    if (Math.abs(yaw) > YAW_EDGE) {
      const over = yaw - Math.sign(yaw) * YAW_EDGE;
      this.home.heading = wrap(this.home.heading + over / this.sens);
      yaw -= over;
    }
    const pitch = (this.elev - this.home.elev) * this.sens;

    // the part of a turn that's swing rather than aim builds up as a gap between where the phone points and the paddle.
    // the paddle always moves with the phone's aiming at once, and the gap fades out once the swing is over
    const follow = this.flicking ? 0 : 1 - sstep(FLICK[0], FLICK[1], this.speed), fade = this.flicking ? 1 : Math.exp(-Math.max(dt, 0) / SETTLE);
    this.off.yaw = (this.off.yaw - (yaw - this.raw.yaw) * (1 - follow)) * fade;
    this.off.pitch = (this.off.pitch - (pitch - this.raw.pitch) * (1 - follow)) * fade;
    this.aim = { yaw: clamp(yaw + this.off.yaw, -YAW_EDGE, YAW_EDGE), pitch: pitch + this.off.pitch };
    this.raw = { yaw, pitch };
  }

  motion(a, ag, t) {
    const dt = clamp(t - (this.lastMotion || t), 0.001, 0.05);
    this.lastMotion = t;
    if (!this.R || !a || a.x == null) return;
    // some browsers report acceleration upside down. gravity, which should point up in these readings, tells us which kind this is
    if (ag && ag.x != null) this.gravity += (toEarth(this.R, ag).z - this.gravity) * Math.min(1, dt * 2);
    const flip = this.gravity < 0 ? -1 : 1, acc = this.toPlayer(toEarth(this.R, { x: a.x * flip, y: a.y * flip, z: a.z * flip }));
    this.quiet = Math.hypot(acc.x, acc.y, acc.z) < STILL_ACCEL ? this.quiet + dt : 0;
    const keep = Math.exp(-dt / (this.quiet > STILL_FOR ? STILL_LEAK : LEAK));
    for (const k of ['x', 'y', 'z']) this.lin[k] = clamp((this.lin[k] + acc[k] * dt) * keep, -MAX_PUSH, MAX_PUSH);
  }

  // a flick drives the paddle at the ball whichever way the wrist turns. the direction of the turn only brushes it a little,
  // which is where topspin, backspin and sidespin come from. a real push forward adds to it
  swing() {
    const { tip, lin } = this, sweep = Math.hypot(tip.x, tip.y, tip.z);
    return { x: tip.x * 0.6 + lin.x, y: tip.y * 0.45 + lin.y, z: Math.min(0, lin.z) - sweep * 0.9 };
  }

  sample() {
    const s = this.swing();
    return { t: this.t, yaw: this.aim.yaw, pitch: this.aim.pitch, twist: this.twist, s: [s.x, s.y, s.z] };
  }
}
