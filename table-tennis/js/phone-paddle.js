import { TABLE, clamp, sstep, paddleFloor } from './config.js';

// the playback buffer already glides between the phone's readings, so the paddle follows them directly with no smoothing of its own
export const HOME = { x: 0, y: TABLE.height + 0.26, z: 1.62 };
const BOUNDS = { x: [-1.15, 1.15], y: [TABLE.height, 1.62] };
// paddle metres per radian of pointing. about 11° left or right reaches the edge of the table
export const GAIN = { x: 1.9, y: 1.2 };
// readings older than this count as the phone going quiet. a swing faster than FLICK m/s shows on screen as a swing
const COAST = 0.25, PULL_TIME = 0.035, MAX_ROLL = 0.8, FLICK = 2;
// a wrist flick moves the phone far less than a real stroke moves a paddle, so its speed is scaled up to a stroke's
const POWER = 1.5;
// like a real player, the paddle face closes over topspin and opens under backspin, by this much per rad/s of spin, within FACE
const FACE_PER_SPIN = 1 / 400, FACE = [-0.35, 0.45], FACE_TIME = 0.08;
const ZERO = { x: 0, y: 0, z: 0 };
const ease = (x, goal, time, dt) => x + (goal - x) * (1 - Math.exp(-dt / time));

export class PhonePaddle {
  constructor() { this.reset(); }

  reset() {
    this.at = { x: HOME.x, y: HOME.y };
    this.ox = 0;
    this.oy = 0;
    this.z = HOME.z;
    this.swinging = false;
    this.face = 0;
    this.pose = { p: { ...HOME }, v: { ...ZERO }, n: { x: 0, y: 0, z: -1 }, swing: { ...ZERO }, roll: 0, ready: 0, forehand: true, flick: 0 };
  }

  // the phone already zeroes itself on Start and Recenter
  calibrate() { this.reset(); }

  // s is the phone's state from the playback buffer, or null before it has sent anything
  tick(dt, now, aim = null, s = null) {
    const pose = this.pose, fresh = !!s && s.age < COAST;
    if (s) {
      this.at = { x: clamp(HOME.x - s.yaw * GAIN.x, ...BOUNDS.x), y: clamp(HOME.y + s.pitch * GAIN.y, ...BOUNDS.y) };
      pose.roll = clamp(s.twist * 0.7, -MAX_ROLL, MAX_ROLL);
    }
    const hx = this.at.x, hy = this.at.y;

    // pointing near the ball is enough: the paddle is drawn the rest of the way onto it
    let wantX = 0, wantY = 0, ready = 0;
    if (aim) {
      const dx = aim.x - hx, dy = aim.y === null ? 0 : aim.y - hy, d = Math.hypot(dx, dy);
      ready = sstep(aim.magnet, aim.reach * 0.6, d);
      // in the last moment a paddle close enough to hit the ball, counting the pull it already has, reaches the rest of the way,
      // so they meet on the blade
      const gap = Math.hypot(dx - this.ox, aim.y === null ? 0 : dy - this.oy);
      const pull = Math.max(ready * sstep(0.7, 0.18, aim.t), gap <= aim.reach ? sstep(0.2, 0.05, aim.t) : 0);
      wantX = dx * pull;
      wantY = dy * pull;
    }
    this.ox = ease(this.ox, wantX, PULL_TIME, dt);
    this.oy = ease(this.oy, wantY, PULL_TIME, dt);
    const { p } = pose;
    p.x = hx + this.ox;
    // the paddle settles at the depth where it meets the ball faster as the ball arrives, so they meet where it was aimed
    this.z = ease(this.z, aim ? aim.z : HOME.z, aim ? (aim.t < 0.25 ? 0.025 : 0.06) : 0.16, dt);
    p.z = this.z;
    p.y = Math.max(hy + this.oy, paddleFloor(p.x, p.z));
    pose.forehand = p.x >= 0;
    pose.ready = ready;
    // closing the face tips its top towards the net, so the normal leans down
    this.face = ease(this.face, aim && aim.spin ? clamp(aim.spin * FACE_PER_SPIN, ...FACE) : 0, FACE_TIME, dt);
    pose.n = { x: 0, y: -Math.sin(this.face), z: -Math.cos(this.face) };

    // the toss reads lifting the phone, whether that's a slow tip or a quick flick up
    const sw = fresh ? s.swing : ZERO, speed = Math.hypot(sw.x, sw.y, sw.z);
    pose.v = fresh ? { x: -s.rate.yaw * GAIN.x + sw.x, y: s.rate.pitch * GAIN.y + sw.y, z: 0 } : { ...ZERO };
    pose.swing = fresh ? { x: s.peak.x * POWER, y: s.peak.y * POWER, z: s.peak.z * POWER } : ZERO;
    pose.flick = speed > FLICK && !this.swinging ? speed : 0;
    if (speed > FLICK) this.swinging = true;
    else if (speed < FLICK * 0.5) this.swinging = false;
    return pose;
  }
}
