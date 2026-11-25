import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advance, landing, planShot, TOP, NET_TOP } from '../js/physics.js';
import { TABLE } from '../js/config.js';

const ball = (p, v, w = { x: 0, y: 0, z: 0 }) => ({ p: { ...p }, v: { ...v }, w: { ...w } });

// flies the ball until a test says stop, recording the path
function fly(b, until, max = 3) {
  const path = [];
  let bounced = null;
  for (let t = 0; t < max; t += 1 / 240) {
    advance(b, 1 / 240, (type, speed) => { if (type === 'table' && !bounced) bounced = { t, v: { ...b.v } }; });
    path.push({ t, ...b.p, vy: b.v.y });
    if (until(b, bounced)) break;
  }
  return { path, bounced };
}

test('air drag gives a real ball\'s top falling speed, about 8.5 to 9.5 m/s', () => {
  const b = ball({ x: 3, y: 100, z: 3 }, { x: 0, y: 0, z: 0 });
  advance(b, 8);
  assert.ok(-b.v.y > 8.5 && -b.v.y < 9.5, `${-b.v.y}`);
});

test('dropped from 30.5 cm it bounces back to about 23 cm, as the rules require of a real table', () => {
  const b = ball({ x: 0, y: TOP + 0.305, z: 0.5 }, { x: 0, y: 0, z: 0 });
  const { path } = fly(b, (x, hit) => hit && x.v.y < 0);
  const top = Math.max(...path.filter(q => q.t > 0.25).map(q => q.y)) - TOP;
  assert.ok(top > 0.22 && top < 0.255, `rebound ${top}`);
});

test('topspin dips in flight and kicks on, backspin floats and checks', () => {
  // moving away from you (−z), topspin turns the top of the ball forward: negative x spin
  const shot = wx => {
    const b = ball({ x: 0, y: 1.0, z: 1.2 }, { x: 0, y: 1.5, z: -5 }, { x: wx, y: 0, z: 0 });
    let hit = null;
    for (let t = 0; t < 2 && !hit; t += 1 / 240) {
      const before = -b.v.z;
      advance(b, 1 / 240, (type) => { if (type === 'table' && !hit) hit = { t, z: b.p.z, kept: -b.v.z / before }; });
    }
    return hit;
  };
  const flat = shot(0), top = shot(-150), back = shot(150);
  assert.ok(flat && top && back && [flat, top, back].every(h => h.z < 0), 'all three land on the far side');
  assert.ok(top.t < flat.t && flat.t < back.t, 'topspin dips and lands soonest, backspin floats and lands latest');
  assert.ok(Math.abs(top.z) < Math.abs(flat.z) && Math.abs(flat.z) < Math.abs(back.z), 'topspin lands shorter, backspin longer');
  // while the ball skids on the table, friction takes the same off whatever the spin. topspin starts rolling sooner, so it keeps
  // far more pace through the bounce. backspin's check shows as the later, longer landing above, never as a kick
  assert.ok(top.kept > flat.kept + 0.1 && top.kept > back.kept + 0.1, `share of forward speed kept through the bounce: top ${top.kept} flat ${flat.kept} back ${back.kept}`);
  assert.ok(back.kept < flat.kept + 0.05, 'backspin never kicks on');
});

test('sidespin curves the ball sideways', () => {
  const from = { x: 0, y: 1.0, z: 1.2 }, v = { x: 0, y: 1.5, z: -7 };
  const a = ball(from, v, { x: 0, y: 200, z: 0 }), b = ball(from, v, { x: 0, y: -200, z: 0 });
  advance(a, 0.3);
  advance(b, 0.3);
  assert.ok(Math.abs(a.p.x - b.p.x) > 0.05 && Math.sign(a.p.x) === -Math.sign(b.p.x));
});

test('a bounce never adds energy', () => {
  for (const w of [{ x: -300, y: 0, z: 0 }, { x: 300, y: 0, z: 0 }, { x: 0, y: 300, z: 0 }, { x: 0, y: 0, z: 0 }]) {
    const b = ball({ x: 0, y: TOP + 0.3, z: -0.5 }, { x: 0.5, y: -2, z: -5 }, w);
    const e = s => 0.5 * (s.v.x ** 2 + s.v.y ** 2 + s.v.z ** 2) + 9.81 * s.p.y + (2 / 3) * 0.5 * 0.02 ** 2 * (s.w.x ** 2 + s.w.y ** 2 + s.w.z ** 2);
    const before = e(b);
    fly(b, (x, hit) => hit && x.v.y > 0);
    assert.ok(e(b) <= before + 1e-6, `spin ${JSON.stringify(w)}`);
  }
});

test('planned shots land where they were aimed, with and without extra height over the net', () => {
  for (const [to, speed, w, lift] of [
    [{ x: 0.4, z: -1.1 }, 9, { x: -150, y: 0, z: 0 }, 0],
    [{ x: -0.5, z: -0.9 }, 6, { x: -300, y: 40, z: 0 }, 0.25],
    [{ x: 0.2, z: -0.6 }, 4, { x: 120, y: 0, z: 0 }, 0.03],
  ]) {
    const from = { x: 0.1, y: 0.95, z: 1.5 }, v = planShot(from, { x: to.x, y: TOP, z: to.z }, speed, w, lift);
    const land = landing(ball(from, v, w));
    assert.ok(Math.hypot(land.x - to.x, land.z - to.z) < 0.03, `missed by ${Math.hypot(land.x - to.x, land.z - to.z)}`);
    assert.ok(land.netY >= NET_TOP + lift, `crossed the net at ${land.netY} wanting ${NET_TOP + lift}`);
  }
});
