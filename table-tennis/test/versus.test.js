import { test } from 'node:test';
import assert from 'node:assert/strict';
import { duel, SKILLS } from './sim.js';
import { NEAR, FAR, STEP } from '../js/config.js';
import { makeBall, cloneBall, advance } from '../js/physics.js';
import { Game } from '../js/game.js';
import { Versus, mirror, mirrorBall } from '../js/versus.js';

const q = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const turned = h => h.map(([a, b]) => [b, a]);
// how each rally ended on one laptop, from its own player's side
function rallies(side) {
  const out = new Map();
  let rally = 0;
  for (const e of side.events) {
    if (e.type === 'serve') rally = e.rally;
    if (e.type === 'point' || e.type === 'let') out.set(rally, e);
  }
  return out;
}

// both laptops scored the same match, each from its own end
function agree(a, b, what) {
  assert.equal(a.game.phase, 'over', `${what}: the inviter's match never finished`);
  assert.equal(b.game.phase, 'over', `${what}: the friend's match never finished`);
  assert.deepEqual(b.game.match.history, turned(a.game.match.history), `${what}: the scores differ`);
  const ra = rallies(a), rb = rallies(b);
  assert.equal(ra.size, rb.size, `${what}: ${ra.size} points on one laptop, ${rb.size} on the other`);
  for (const [n, e] of ra) {
    const f = rb.get(n);
    assert.ok(f, `${what}: rally ${n} has no result on the friend's laptop`);
    assert.equal(f.type, e.type, `${what}: rally ${n} was a ${e.type} on one laptop and a ${f.type} on the other`);
    if (e.type === 'point') assert.equal(f.winner, e.winner === NEAR ? FAR : NEAR, `${what}: rally ${n} went to different players`);
    assert.equal(f.reason, e.reason, `${what}: rally ${n} was called for different reasons`);
  }
}

test('online: the far end is the near end turned round, and a ball flies the same from either', () => {
  const a = { p: { x: 0.31, y: 1.02, z: 1.48 }, v: { x: -1.3, y: 1.4, z: -7.2 }, w: { x: 140, y: -35, z: 18 } };
  assert.deepEqual(mirrorBall(mirrorBall(a)), a);
  const here = cloneBall(a), there = mirrorBall(a), seenHere = [], seenThere = [];
  for (let i = 0; i < 300; i++) {
    advance(here, STEP, (type, speed, side) => seenHere.push(`${type}:${side}`));
    advance(there, STEP, (type, speed, side) => seenThere.push(`${type}:${side}`));
  }
  for (const k of ['x', 'y', 'z']) assert.ok(Math.abs(mirror(here.p)[k] - there.p[k]) < 1e-9, `${k} drifted`);
  // a bounce on one end's side is a bounce on the other end's opposite side
  assert.deepEqual(seenThere, seenHere.map(s => s.replace(/:(\d)$/, (m, d) => `:${d === '0' ? 1 : d === '1' ? 0 : d}`)));
});

test('online: both laptops agree on every point, from a city away to the far side of the world', () => {
  for (const [ms, seed] of [[15, 2], [50, 3], [120, 4]]) {
    const [a, b] = duel({ seconds: 900, ms, jitter: ms / 4, seed, level: 2 });
    agree(a, b, `${ms} ms`);
  }
});

test('online: weak and strong players, every level, still one score', () => {
  for (const [skill, level, seed] of [['weak', 1, 5], ['weak', 3, 6], ['average', 3, 7], ['good', 2, 9]]) {
    const [a, b] = duel({ seconds: 900, ms: 40, jitter: 10, seed, level, skill: SKILLS[skill] });
    agree(a, b, `${skill} on level ${level}`);
  }
});

test('online: faults the bots never make are judged the same on both ends', () => {
  // the inviter's returns are spoiled in turn: into the net, long, wide, and one that dies just over the net
  const bad = [
    { name: 'net', v: { x: 0, y: -0.6, z: -5 }, w: { x: 0, y: 0, z: 0 } },
    { name: 'long', v: { x: 0, y: 1.6, z: -13 }, w: { x: 0, y: 0, z: 0 } },
    { name: 'wide', v: { x: 5.5, y: 1.2, z: -7 }, w: { x: 0, y: 0, z: 0 } },
    { name: 'short', v: { x: 0, y: 1.1, z: -2.9 }, w: { x: -60, y: 0, z: 0 } },
  ];
  for (const host of [true, false]) {
    let spoiled = 0;
    const tweak = (side, e) => {
      if (side.game.remote.host !== host || e.type !== 'hit' || e.who !== NEAR || e.late || e.n < 2 || e.rally % 2) return;
      const k = bad[spoiled++ % bad.length], g = side.game;
      g.ball.v = { ...k.v };
      g.ball.w = { ...k.w };
      e.state = cloneBall(g.ball);
      g.readBall();
    };
    const [a, b] = duel({ seconds: 900, ms: 60, jitter: 15, seed: host ? 21 : 22, level: 2, tweak });
    assert.ok(spoiled >= 4, `only ${spoiled} spoiled shots`);
    agree(a, b, host ? 'spoiled by the inviter' : 'spoiled by the friend');
    const reasons = new Set([...rallies(a).values()].map(e => e.reason));
    for (const r of ['Ball did not cross the net', 'Out']) assert.ok(reasons.has(r), `no "${r}" call among ${[...reasons].join(', ')}`);
  }
});

test('online: the ball waits at a friend\'s paddle only as long as the internet takes, and their hit lands where it waited', () => {
  for (const ms of [20, 60, 120]) {
    const waits = [], jumps = [], held = [0, 0];
    duel({ seconds: 600, ms, jitter: ms / 4, seed: 3, onFrame: ({ side, events }) => {
      const g = side.game;
      if (g.remote.hold > 0) held[side.i] = g.remote.hold / g.level.timeScale;
      for (const e of events) {
        if (e.type === 'hit' && e.who === FAR && !e.late) {
          waits.push(held[side.i]);
          jumps.push(Math.hypot(g.nudge.x, g.nudge.y, g.nudge.z));
        }
        if (e.type === 'hit' || e.type === 'serve' || e.type === 'point') held[side.i] = 0;
      }
    } });
    assert.ok(waits.length > 50, `only ${waits.length} hits`);
    // about one trip across the internet, and never stuck there
    assert.ok(q(waits, 0.5) < ms / 1000 * 1.25 + 0.012, `${ms} ms: median wait ${q(waits, 0.5).toFixed(3)} s`);
    assert.ok(Math.max(...waits) < ms / 1000 * 2 + 0.06, `${ms} ms: longest wait ${Math.max(...waits).toFixed(3)} s`);
    assert.ok(q(jumps, 0.9) < 0.04, `${ms} ms: their hit lands ${(q(jumps, 0.9) * 100).toFixed(1)} cm from the waiting ball`);
  }
});

test('online: a ball your friend misses isn\'t kept waiting at their paddle', () => {
  const misses = [], held = [0, 0];
  duel({ seconds: 900, ms: 25, jitter: 6, seed: 8, skill: SKILLS.weak, onFrame: ({ side, events }) => {
    const g = side.game;
    if (g.remote.hold > 0) held[side.i] = g.remote.hold / g.level.timeScale;
    for (const e of events) {
      if (e.type === 'point' && e.winner === NEAR && e.reason === 'Not returned' && held[side.i] > 0) misses.push(held[side.i]);
      if (e.type === 'hit' || e.type === 'serve' || e.type === 'point') held[side.i] = 0;
    }
  } });
  assert.ok(misses.length >= 5, `only ${misses.length} misses`);
  assert.ok(Math.max(...misses) < 0.085, `a missed ball waited ${Math.max(...misses).toFixed(3)} s`);
});

test('online: nothing a friend\'s laptop sends can break this one', () => {
  const g = new Game(() => 0.5), v = new Versus({ host: true, send: () => {} });
  g.start(2, 1, NEAR, null, { host: true });
  v.attach(g, 10);
  const before = JSON.stringify({ ball: g.ball, phase: g.phase, score: g.match.score });
  for (const d of [null, 7, 'x', [], {}, { k: 5 }, { k: 'shot' }, { k: 'shot', rally: 1, n: 2, ball: { p: { x: NaN, y: 1, z: 0 }, v: { x: 0, y: 0, z: 0 }, w: { x: 0, y: 0, z: 0 } } },
    { k: 'shot', rally: 1, n: 2, ball: { p: { x: 0, y: 1, z: 0 }, v: { x: 1e9, y: 0, z: 0 }, w: { x: 0, y: 0, z: 0 } } }, { k: 'point', rally: 1, winner: 'everyone' },
    { k: 'toss', rally: 'one' }, { k: 'pose', p: { x: 'a' } }, { k: 'pong', t: -1, p: 1e12 }, { k: 'ping', t: Infinity }, { k: '__proto__' }])
    assert.doesNotThrow(() => v.receive(d, 11));
  assert.equal(JSON.stringify({ ball: g.ball, phase: g.phase, score: g.match.score }), before);
});

test('online: a hit that lands before this laptop has started the match is played once it has', () => {
  const g = new Game(() => 0.5), v = new Versus({ host: false, send: () => {} });
  const ball = { p: { x: 0.1, y: 1.0, z: 1.5 }, v: { x: 0, y: 0.3, z: -6 }, w: { x: 0, y: 0, z: 0 } };
  // the inviter serves: their toss and serve arrive before this laptop has started
  v.receive({ k: 'toss', rally: 1, t: 1, ball: { p: { ...ball.p }, v: { x: 0, y: 2.6, z: 0 }, w: { x: 0, y: 0, z: 0 } } }, 1.05);
  v.receive({ k: 'shot', rally: 1, n: 1, t: 1.3, late: false, ball, info: { speed: 6, name: 'Push', rpm: 0 } }, 1.35);
  g.start(2, 1, FAR, null, { host: false });
  v.attach(g, 1.4);
  assert.equal(g.phase, 'play');
  assert.equal(g.rally.striker, FAR);
  assert.ok(Math.abs(g.ball.p.z + 1.5) < 1e-9 && Math.abs(g.ball.v.z - 6) < 1e-9, 'the serve was not turned round to this end');
});
