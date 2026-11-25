import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Motion, YAW_EDGE } from '../js/motion.js';
import { GAIN } from '../js/phone-paddle.js';

const DEG = 180 / Math.PI;
const ease = x => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(Math.max(x, 0), 1));

// feeds the phone one pose per sensor reading, 60 a second. heading and elev in radians
function drive(m, seconds, pose, from = 0, t0 = 500) {
  const out = [];
  for (let i = 0; i <= Math.round(seconds * 60); i++) {
    const u = from + i / 60, p = pose(u), t = t0 + u;
    m.orient(((p.heading * DEG) % 360 + 360) % 360, (p.elev ?? 0) * DEG, (p.twist ?? 0) * DEG, t);
    m.motion(p.acc ?? { x: 0, y: 0, z: 0 }, p.gravity ?? { x: 0, y: 0, z: 9.81 }, t);
    const s = m.sample();
    out.push({ u, yaw: s.yaw, pitch: s.pitch, swing: Math.hypot(...s.s), s: s.s });
  }
  return out;
}

const HOME = 2.1;
const still = () => ({ heading: HOME, elev: 0 });

test('pointing left and up reads as yaw and pitch', () => {
  const m = new Motion();
  drive(m, 0.2, still);
  const out = drive(m, 1, () => ({ heading: HOME + 0.2, elev: 0.1 }), 0.2);
  const last = out.at(-1);
  assert.ok(Math.abs(last.yaw - 0.2) < 0.002, `yaw ${last.yaw}`);
  assert.ok(Math.abs(last.pitch - 0.1) < 0.002, `pitch ${last.pitch}`);
});

test('slow aiming is followed exactly, with no lag', () => {
  const m = new Motion();
  drive(m, 0.2, still);
  const out = drive(m, 3, u => ({ heading: HOME + 0.3 * Math.sin(u * 2), elev: 0.1 * Math.sin(u * 3) }), 0.2);
  for (const q of out) {
    assert.ok(Math.abs(q.yaw - 0.3 * Math.sin(q.u * 2)) < 1e-3, `yaw off at ${q.u}`);
    assert.ok(Math.abs(q.pitch - 0.1 * Math.sin(q.u * 3)) < 1e-3, `pitch off at ${q.u}`);
  }
});

test('a flick barely moves the paddle but registers as a strong swing', () => {
  const m = new Motion();
  drive(m, 0.3, still);
  // up 32° in 60 ms and back down over 160 ms: a quick wrist flick
  const flick = u => { const k = u - 0.3; return k < 0.06 ? 0.55 * ease(k / 0.06) : 0.55 * (1 - ease((k - 0.06) / 0.16)); };
  const out = drive(m, 0.6, u => ({ heading: HOME, elev: flick(u) }), 0.3);
  const moved = Math.max(...out.map(q => Math.abs(q.pitch))) * GAIN.y, swing = Math.max(...out.map(q => q.swing));
  assert.ok(moved < 0.05, `paddle moved ${(moved * 100).toFixed(1)} cm during the flick`);
  assert.ok(swing > 3, `swing only ${swing.toFixed(2)} m/s`);
  // the flick drives at the table: the forward part is the biggest
  const peak = out.reduce((a, q) => (q.swing > a.swing ? q : a));
  assert.ok(peak.s[2] < 0 && Math.abs(peak.s[2]) >= Math.abs(peak.s[1]), 'swing should mostly drive forward');
});

test('after a flick that stays up, the paddle glides to where the phone points', () => {
  const m = new Motion();
  drive(m, 0.3, still);
  const out = drive(m, 1.2, u => ({ heading: HOME, elev: 0.3 * ease((u - 0.3) / 0.05) }), 0.3);
  const soon = out.find(q => q.u >= 0.36), later = out.at(-1);
  assert.ok(soon.pitch < 0.15, 'held still through the flick');
  assert.ok(Math.abs(later.pitch - 0.3) < 0.01, `settled at ${later.pitch}`);
});

test('pointing past the side edge drags the middle along, so drift never strands you', () => {
  const m = new Motion();
  drive(m, 0.2, still);
  // a slow turn well past the edge, then back the other way
  let out = drive(m, 3, u => ({ heading: HOME + Math.min(1, (u - 0.2) * 0.4) }), 0.2);
  assert.ok(Math.abs(out.at(-1).yaw - YAW_EDGE) < 1e-3, 'stops at the edge');
  out = drive(m, 1, u => ({ heading: HOME + 1 - (u - 3.2) * 0.3 }), 3.2);
  assert.ok(out.at(-1).yaw < YAW_EDGE - 0.25, 'turning back moves the paddle straight away');
});

test('recenter makes the current direction the middle', () => {
  const m = new Motion();
  drive(m, 0.2, () => ({ heading: HOME + 0.3, elev: 0.2 }));
  m.recenter();
  const out = drive(m, 0.2, () => ({ heading: HOME + 0.3, elev: 0.2 }), 0.2);
  assert.ok(Math.abs(out.at(-1).yaw) < 1e-6 && Math.abs(out.at(-1).pitch) < 1e-6);
});

test('pointing almost straight up does not spin the heading', () => {
  const m = new Motion();
  drive(m, 0.2, still);
  const out = drive(m, 1, u => ({ heading: HOME + 3 * Math.sin(u * 7), elev: 1.45 }), 0.2);
  for (const q of out.slice(2)) assert.ok(Math.abs(q.yaw) < 0.05, `yaw jumped to ${q.yaw}`);
});

test('upside-down accelerometer readings are caught from gravity', () => {
  for (const sign of [1, -1]) {
    const m = new Motion();
    drive(m, 1, () => ({ heading: HOME, elev: 0, gravity: { x: 0, y: 0, z: 9.81 * sign } }));
    // a push towards the screen: the top edge's direction, which is device +y
    const out = drive(m, 0.15, () => ({ heading: HOME, elev: 0, acc: { x: 0, y: 12 * sign, z: 0 }, gravity: { x: 0, y: 12 * sign, z: 9.81 * sign } }), 1);
    assert.ok(out.at(-1).s[2] < -0.5, `push read as ${out.at(-1).s[2]} with gravity sign ${sign}`);
  }
});

test('aim speed scales the pointer', () => {
  const m = new Motion();
  m.sens = 1.35;
  drive(m, 0.2, still);
  const out = drive(m, 1, () => ({ heading: HOME + 0.2, elev: 0 }), 0.2);
  assert.ok(Math.abs(out.at(-1).yaw - 0.27) < 0.002);
});
