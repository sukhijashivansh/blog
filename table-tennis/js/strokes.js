import { TABLE, clamp, lerp, sstep } from './config.js';
import { TOP, NET_TOP, NET_SAFE, contact, cloneBall, landing, planShot, planServe, solveFlight } from './physics.js';

const RUBBER = { e: 0.8, mu: 0.95 };
const MAX_SPEED = 16, MAX_SPIN = 420, SERVE_SPIN = 34;
const COURT = { x: 0.66, short: 0.3, deep: 1.25 };
// how far off target a missed shot can still be dragged from. a wild hit is pulled in by the level's share of this, not all of its miss
const OVERSHOOT = 0.8;
// the sideways part of a flick steers the shot: metres across the table per m/s of sideways swing
const STEER = 0.12;

// past the level's top pace a shot only gains a little more, so the opponent gets to play it
function rein(b, top) {
  const s = Math.hypot(b.v.x, b.v.y, b.v.z);
  if (!top || s <= top) return;
  const k = (top + (s - top) * 0.25) / s;
  b.v.x *= k; b.v.y *= k; b.v.z *= k;
}

function limit(b) {
  const s = Math.hypot(b.v.x, b.v.y, b.v.z), w = Math.hypot(b.w.x, b.w.y, b.w.z);
  if (s > MAX_SPEED) { const k = MAX_SPEED / s; b.v.x *= k; b.v.y *= k; b.v.z *= k; }
  if (w > MAX_SPIN) { const k = MAX_SPIN / w; b.w.x *= k; b.w.y *= k; b.w.z *= k; }
}

// real contact first. assist only steps in when that shot would miss, or to send it where the flick pointed
export function playerStroke(ball, pad, level, offset) {
  const s = pad.swing, sweep = Math.hypot(s.x, s.y);
  const drive = Math.max(0, Math.max(0, -s.z) + sweep * 0.72 - Math.max(0, s.z) * 0.3);
  const out = cloneBall(ball);
  // brushing up or down along the rubber is what puts on topspin or backspin
  contact(out, pad.n, { x: s.x * 0.3, y: s.y * 1.1, z: -drive * 0.52 }, RUBBER);
  limit(out);
  rein(out, level.power);

  const land = landing(out), aimX = land.x + s.x * STEER;
  const clears = land.netY !== null && land.netY >= NET_SAFE, inside = Math.abs(land.x) <= COURT.x && land.z <= -COURT.short && land.z >= -COURT.deep;
  if (clears && inside && Math.abs(aimX - land.x) < 0.02) return out;

  // where the shot was meant to go: a block drops mid-table and the harder the flick the deeper it goes, pushes land short,
  // and the flick steers it across. your shots fly away from you, so topspin is negative x
  const power = Math.hypot(s.x, s.y, s.z), top = -out.w.x;
  const deep = top < -60 ? lerp(0.55, 0.9, sstep(0.5, 6, power)) : lerp(0.72, 1.2, sstep(0.5, 9, power));
  const tx = clamp(aimX, -COURT.x, COURT.x), tz = clamp(-deep, -COURT.deep, -COURT.short);
  // topspin arcs higher over the net and dips back down onto the table, like a loop
  const lift = clamp((top - 80) / 300, 0, 1) * 0.15;

  const assist = level.assist * (0.92 + 0.08 * (1 - offset * offset));
  const off = d => clamp(d, -OVERSHOOT, OVERSHOOT) * (1 - assist);
  const fx = tx + off(aimX - tx), fz = tz + off(land.z - tz);
  const short = land.netY === null ? 0 : Math.max(0, NET_SAFE - land.netY);
  if (fz > -0.04 || short * (1 - assist) > 0.06) return out;
  out.v = planShot(out.p, { x: fx, y: TOP, z: fz }, Math.max(Math.hypot(out.v.x, out.v.z), 3.2), out.w, lift);
  return out;
}

// brush up for topspin, down for backspin, across for sidespin. swing speed sets the depth
export function playerServe(ball, pad, level, offset) {
  const s = pad.swing, power = Math.hypot(s.x, s.y, s.z), out = cloneBall(ball);
  out.w = { x: clamp(-s.y * SERVE_SPIN, -MAX_SPIN, MAX_SPIN), y: clamp(s.x * SERVE_SPIN * 0.7, -MAX_SPIN, MAX_SPIN), z: 0 };
  const pace = clamp((power - 0.8) / 7, 0, 1);
  const to = { x: clamp(ball.p.x * 0.2 + s.x / (power + 1.5) * 0.8 + pad.n.x * 0.9, -0.62, 0.62), y: TOP, z: -lerp(0.5, 1.22, pace) };
  const v = planServe(out.p, to, lerp(3.5, Math.min(9, level.power || 9), pace), out.w);
  if (!v) { out.v = solveFlight(out.p, to, 0.45, out.w); return out; }
  // overhitting or catching it on the edge can still send a serve long
  const wild = 1 + (Math.max(0, power - 10) * 0.035 + Math.max(0, offset - 0.85)) * (1 - level.assist) * 3;
  out.v = { x: v.x * wild, y: v.y, z: v.z * wild };
  return out;
}

export function describeShot(b, hitY) {
  const speed = Math.hypot(b.v.x, b.v.y, b.v.z), top = b.w.x * Math.sign(b.v.z);
  let name = 'Drive';
  if (speed >= 11 && hitY > NET_TOP + 0.1) name = 'Smash';
  else if (top > 130) name = 'Topspin';
  else if (top < -70) name = speed < 6 ? 'Push' : 'Chop';
  else if (b.v.y > 3.2) name = 'Lob';
  else if (speed < 5) name = 'Block';
  return { name, speed, rpm: Math.round(Math.hypot(b.w.x, b.w.y, b.w.z) * 60 / (2 * Math.PI)) };
}
