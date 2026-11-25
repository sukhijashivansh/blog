import { TABLE, BALL_R, NEAR, FAR, lerp } from './config.js';

const GRAVITY = 9.81, DRAG = 0.125, MAGNUS = 0.0042, SPIN_DECAY = 0.3, MAX_H = 1 / 480, MIN_REACH = 0.3, LATEST = 1.7;
// the table's bounce gives the rules' 23 cm back from a 30 cm drop, once air drag is counted
const TABLE_HIT = { e: 0.905, mu: 0.3 }, FLOOR_HIT = { e: 0.7, mu: 0.4 }, NET_HIT = { e: 0.18, mu: 0.4 }, CORD_HIT = { e: 0.42, mu: 0.12 };
const UP = { x: 0, y: 1, z: 0 }, STILL = { x: 0, y: 0, z: 0 };

export const TOP = TABLE.height + BALL_R;
export const NET_TOP = TABLE.height + TABLE.netH;
export const NET_SAFE = NET_TOP + BALL_R + 0.012;
export const sideOf = z => z >= 0 ? NEAR : FAR;
export const makeBall = () => ({ p: { x: 0, y: 1, z: 0 }, v: { x: 0, y: 0, z: 0 }, w: { x: 0, y: 0, z: 0 } });
export const cloneBall = b => ({ p: { ...b.p }, v: { ...b.v }, w: { ...b.w } });

/* ---------- flight: gravity, air drag, and the magnus force from spin ---------- */
export function integrate(b, h) {
  const { p, v, w } = b, s = Math.hypot(v.x, v.y, v.z);
  const ax = -DRAG * s * v.x + MAGNUS * (w.y * v.z - w.z * v.y);
  const ay = -GRAVITY - DRAG * s * v.y + MAGNUS * (w.z * v.x - w.x * v.z);
  const az = -DRAG * s * v.z + MAGNUS * (w.x * v.y - w.y * v.x);
  v.x += ax * h; v.y += ay * h; v.z += az * h;
  p.x += v.x * h; p.y += v.y * h; p.z += v.z * h;
  const d = Math.exp(-SPIN_DECAY * h);
  w.x *= d; w.y *= d; w.z *= d;
}

// impulse against a moving surface. friction trades slip for spin, treating the ball as a hollow sphere
export function contact(b, n, surf, { e, mu }) {
  const { v, w } = b, R = BALL_R;
  const rx = v.x - surf.x, ry = v.y - surf.y, rz = v.z - surf.z;
  const vn = rx * n.x + ry * n.y + rz * n.z;
  if (vn >= 0) return 0;
  const ux = rx - R * (w.y * n.z - w.z * n.y), uy = ry - R * (w.z * n.x - w.x * n.z), uz = rz - R * (w.x * n.y - w.y * n.x);
  const un = ux * n.x + uy * n.y + uz * n.z;
  const tx = ux - un * n.x, ty = uy - un * n.y, tz = uz - un * n.z, slip = Math.hypot(tx, ty, tz);
  const jn = -(1 + e) * vn;
  let dx = 0, dy = 0, dz = 0;
  if (slip > 1e-6) {
    const jt = Math.min(0.4 * slip, mu * jn);
    dx = -tx / slip * jt; dy = -ty / slip * jt; dz = -tz / slip * jt;
  }
  v.x += n.x * jn + dx; v.y += n.y * jn + dy; v.z += n.z * jn + dz;
  const k = -1.5 / R;
  w.x += k * (n.y * dz - n.z * dy);
  w.y += k * (n.z * dx - n.x * dz);
  w.z += k * (n.x * dy - n.y * dx);
  return -vn;
}

function collide(b, py, pz, emit) {
  const { p, v } = b;
  if (v.y < 0 && p.y < TOP && py >= TOP - 1e-3 && Math.abs(p.x) <= TABLE.halfW && Math.abs(p.z) <= TABLE.halfL) {
    p.y = TOP;
    emit?.('table', contact(b, UP, STILL, TABLE_HIT), sideOf(p.z));
  }
  if (Math.abs(p.x) <= TABLE.netHalfW + BALL_R && p.y > TABLE.height && p.y < NET_TOP + BALL_R) {
    const dy = p.y - NET_TOP;
    if (dy > 0) {
      // over the top the net acts like a thin rod, which is what makes net cords hop
      const d = Math.hypot(dy, p.z);
      if (d < BALL_R && d > 1e-6) {
        const n = { x: 0, y: dy / d, z: p.z / d };
        if (v.y * n.y + v.z * n.z < 0) {
          p.y = NET_TOP + n.y * BALL_R; p.z = n.z * BALL_R;
          emit?.('net', contact(b, n, STILL, CORD_HIT));
        }
      }
    } else if (Math.abs(p.z) < BALL_R) {
      const s = pz >= 0 ? 1 : -1;
      if (v.z * s < 0) { p.z = s * BALL_R; emit?.('net', contact(b, { x: 0, y: 0, z: s }, STILL, NET_HIT)); }
    }
  }
  if (v.y < 0 && p.y < BALL_R) { p.y = BALL_R; emit?.('floor', contact(b, UP, STILL, FLOOR_HIT)); }
}

// substeps shrink with speed so a fast ball can't tunnel through the net
export function advance(b, dt, emit) {
  let left = dt;
  while (left > 1e-7) {
    const s = Math.hypot(b.v.x, b.v.y, b.v.z);
    const h = Math.min(left, MAX_H, s > 0 ? BALL_R * 0.75 / s : MAX_H);
    const py = b.p.y, pz = b.p.z;
    integrate(b, h);
    collide(b, py, pz, emit);
    left -= h;
  }
}

/* ---------- reading the ball ahead of time ---------- */
export function firstContact(ball, maxT = 2.4) {
  const b = cloneBall(ball);
  let hit = null;
  const emit = (type, s, side) => { if (!hit && type !== 'net') hit = { type, side }; };
  for (let t = 0; t < maxT && !hit; t += 1 / 240) advance(b, 1 / 240, emit);
  return hit;
}

// where to meet the ball on `side`: just past the top of its bounce, or sooner if it would carry far behind the table
export function predictStrike(ball, side, alreadyBounced = false) {
  const b = cloneBall(ball), dir = side === NEAR ? 1 : -1, h = 1 / 240;
  let bounce = null, landed = alreadyBounced, fail = false, t = 0;
  const emit = (type, s, at) => {
    if (type === 'floor') fail = true;
    if (type !== 'table') return;
    if (landed || at !== side) fail = true;
    else { landed = true; bounce = { x: b.p.x, z: b.p.z, t }; }
  };
  while (t < 2.4) {
    advance(b, h, emit);
    t += h;
    if (fail) return { valid: false, bounce };
    if (landed && b.v.z * dir > 0 && b.p.z * dir >= MIN_REACH && (b.v.y <= 0 || b.p.z * dir >= LATEST)) return { valid: true, t, p: { ...b.p }, bounce };
  }
  return { valid: false, bounce };
}

// flight with no collisions until the ball drops through table height
export function landing(ball) {
  const b = cloneBall(ball), h = 1 / 360;
  let netY = null, pz = b.p.z;
  for (let t = 0; t < 2.6; t += h) {
    integrate(b, h);
    if (netY === null && pz * b.p.z <= 0) netY = b.p.y;
    pz = b.p.z;
    if (b.v.y < 0 && b.p.y <= TOP) return { x: b.p.x, z: b.p.z, netY, t };
  }
  return { x: b.p.x, z: b.p.z, netY, t: 2.6 };
}

/* ---------- aiming: find the launch velocity that reaches a point, spin included ---------- */
function fly(from, v, w, T, visit) {
  const b = { p: { ...from }, v: { ...v }, w: { ...w } }, n = Math.max(8, Math.ceil(T * 360)), h = T / n;
  for (let i = 0; i < n; i++) { integrate(b, h); visit?.(b); }
  return b;
}

export function solveFlight(from, to, T, w) {
  const v = { x: (to.x - from.x) / T, y: (to.y - from.y) / T + 0.5 * GRAVITY * T, z: (to.z - from.z) / T };
  for (let i = 0; i < 10; i++) {
    const end = fly(from, v, w, T).p, ex = to.x - end.x, ey = to.y - end.y, ez = to.z - end.z;
    if (Math.hypot(ex, ey, ez) < 2e-3) break;
    v.x += ex / T; v.y += ey / T; v.z += ez / T;
  }
  return v;
}

function cleanPath(from, v, w, T, lift = 0) {
  let ok = true, pz = from.z;
  const end = fly(from, v, w, T, b => {
    const { x, y, z } = b.p;
    if (pz * z <= 0 && Math.abs(x) <= TABLE.netHalfW && y < NET_SAFE + lift) ok = false;
    if (Math.abs(x) <= TABLE.halfW && Math.abs(z) <= TABLE.halfL && y < TOP - 0.004) ok = false;
    pz = z;
  });
  return ok && end.v.y < 0;
}

// fastest arc at this pace that clears the net, by lift metres more than it must: slows down and lifts until it does.
// a loop asks for lift, so it arcs high over the net and its topspin brings it down on the table
export function planShot(from, to, speed, w, lift = 0) {
  const dist = Math.hypot(to.x - from.x, to.z - from.z);
  let T = Math.max(0.14, dist / Math.max(speed, 1)), v;
  for (let i = 0; i < 48; i++) {
    v = solveFlight(from, to, T, w);
    if (cleanPath(from, v, w, T, lift)) return v;
    T *= 1.07;
  }
  return v;
}

function traceServe(from, v0, w, server) {
  const b = { p: { ...from }, v: { ...v0 }, w: { ...w } };
  let bounces = 0, clean = true, land = null, t = 0, pz = from.z;
  const emit = (type, s, side) => {
    if (type === 'net' || type === 'floor') clean = false;
    if (type !== 'table') return;
    if (bounces === 0 && side === server) bounces = 1;
    else if (bounces === 1 && side !== server) { bounces = 2; land = { x: b.p.x, z: b.p.z, t }; }
    else clean = false;
  };
  while (t < 1.8 && clean && bounces < 2) {
    advance(b, 1 / 240, emit);
    t += 1 / 240;
    if (pz * b.p.z <= 0 && b.p.y < NET_SAFE) clean = false;
    pz = b.p.z;
  }
  if (!clean || !land || Math.abs(land.x) > TABLE.halfW - 0.03 || Math.abs(land.z) > TABLE.halfL - 0.03) return null;
  return land;
}

// a serve has two bounces, so search first-bounce spots and timings for one that lands near the target.
// a coarse pass first, then a closer look around the best, so working it out never holds up a frame for long
export function planServe(from, to, speed, w) {
  const server = sideOf(from.z), dir = server === NEAR ? 1 : -1;
  const want = Math.hypot(to.x - from.x, to.z - from.z) / Math.max(speed, 1);
  let best = null;
  const attempt = (bx, bz, T1) => {
    const v = solveFlight(from, { x: bx, y: TOP, z: bz }, T1, w), r = traceServe(from, v, w, server);
    if (!r) return;
    const miss = Math.hypot(r.x - to.x, r.z - to.z) + 0.2 * Math.abs(r.t - want);
    if (!best || miss < best.miss) best = { v, r, miss, bx, bz, T1 };
  };
  const grid = start => {
    for (const f of [0.4, 0.5, 0.6, 0.7, 0.8, 0.9]) {
      const bz = dir * TABLE.halfL * f, share = (Math.abs(from.z) - Math.abs(bz)) / (Math.abs(from.z) + Math.abs(to.z));
      const bx = lerp(from.x, to.x, share);
      for (let T1 = start; T1 <= 0.6; T1 += 0.06) attempt(bx, bz, T1);
    }
  };
  grid(0.12);
  if (!best) grid(0.15);
  if (!best) return null;
  for (const d of [-0.03, 0.03]) attempt(best.bx, best.bz, best.T1 + d);
  for (let i = 0; i < 3; i++) attempt(best.bx + (to.x - best.r.x) * 0.5, best.bz, best.T1);
  return best.v;
}
