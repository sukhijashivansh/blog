import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Playout } from '../js/playout.js';
import { rng } from './sim.js';

const reading = (t, yaw, s = [0, 0, 0]) => ({ t, yaw, pitch: 0, twist: 0, s });

// readings of a steady turn at 60 a second, landing after a random delay. returns what was read at each frame
function stream({ seconds = 3, jitter = 0.004, clock = -812.5, fps = 120, rate = 0.5, seed = 1, drop = 0 } = {}) {
  const r = rng(seed), p = new Playout(), sends = [];
  for (let t = 0; t < seconds; t += 1 / 60) if (r() >= drop) sends.push({ t, at: t + 0.005 - jitter * Math.log(1 - r()) });
  sends.sort((a, b) => a.at - b.at);
  const out = [];
  let i = 0;
  for (let now = 0; now < seconds; now += 1 / fps) {
    while (i < sends.length && sends[i].at <= now) { p.push(reading(sends[i].t + clock, sends[i].t * rate), sends[i].at); i++; }
    const s = p.read(now);
    if (s) out.push({ now, yaw: s.yaw, truth: now * rate, delay: p.delay });
  }
  return { p, out };
}

test('plays back evenly despite jitter, a few milliseconds behind', () => {
  const { out } = stream();
  const steady = out.filter(q => q.now > 0.5);
  const steps = steady.slice(1).map((q, i) => q.yaw - steady[i].yaw), want = 0.5 / 120;
  for (const d of steps) assert.ok(Math.abs(d - want) < want * 0.35, `uneven step ${d} vs ${want}`);
  const lag = steady.reduce((a, q) => a + (q.truth - q.yaw) / 0.5, 0) / steady.length;
  assert.ok(lag > 0 && lag < 0.03, `lag ${(lag * 1000).toFixed(1)} ms`);
});

test('works whatever the phone clock reads', () => {
  for (const clock of [-1e5, 0, 12345.678]) {
    const { out } = stream({ clock });
    assert.ok(Math.abs(out.at(-1).truth - out.at(-1).yaw) < 0.02, `clock ${clock}`);
  }
});

test('never runs backwards when readings arrive out of order or twice', () => {
  const p = new Playout();
  const order = [0, 2, 1, 3, 3, 5, 4, 6, 7, 7, 9, 8];
  order.forEach((k, i) => p.push(reading(k / 60, k), 0.01 + i / 60));
  assert.equal(p.buf.length, 10);
  assert.ok(p.buf.every((q, i) => i === 0 || q.t > p.buf[i - 1].t));
  let last = -Infinity;
  for (let now = 0.05; now < 0.3; now += 1 / 120) { const s = p.read(now); assert.ok(s.yaw >= last - 1e-9); last = s.yaw; }
});

test('a reloaded phone page starts playback over', () => {
  const p = new Playout();
  for (let i = 0; i < 30; i++) p.push(reading(900 + i / 60, 1), i / 60);
  for (let i = 0; i < 30; i++) p.push(reading(2 + i / 60, -1), 1 + i / 60);
  assert.ok(p.buf.every(q => q.t < 10));
  assert.ok(Math.abs(p.read(1.6).yaw + 1) < 1e-9);
});

test('carries on briefly, then holds still when readings stop', () => {
  const p = new Playout();
  for (let i = 0; i < 60; i++) p.push(reading(i / 60, i / 60), i / 60 + 0.005);
  const last = 59 / 60, a = p.read(1.0).yaw, b = p.read(1.3).yaw, c = p.read(1.6).yaw;
  assert.ok(a <= last + 0.04 && b <= last + 0.04, 'guesses only a little way past the newest reading');
  assert.equal(b, c, 'then holds');
});

test('swings come straight through without waiting for the playback delay', () => {
  const p = new Playout();
  for (let i = 0; i < 60; i++) p.push(reading(i / 60, 0, i === 59 ? [0, 2, -6] : [0, 0, 0]), i / 60 + 0.005);
  const s = p.read(59 / 60 + 0.006);
  assert.ok(s.peak.z === -6 && s.swing.z === -6);
  assert.ok(s.yaw === 0);
});

test('the delay grows on a bumpy link and settles back once it calms', () => {
  const calm = stream({ jitter: 0.001 }), bumpy = stream({ jitter: 0.015, seed: 3 });
  const d = q => q.out.at(-1).delay;
  assert.ok(d(bumpy) > d(calm) + 0.01, `bumpy ${d(bumpy)} calm ${d(calm)}`);
  assert.ok(d(bumpy) <= 0.05, 'but never past the cap');
  const p = bumpy.p;
  for (let i = 0; i < 600; i++) p.push(reading(3 + i / 60 - 812.5, 0), 3.5 + i / 60);
  assert.ok(p.delay < d(bumpy) * 0.6, `settled to ${p.delay}`);
});

test('a lost reading here and there does not cause a jump', () => {
  const { out } = stream({ drop: 0.1, seed: 4 });
  const steady = out.filter(q => q.now > 0.5), want = 0.5 / 120;
  for (let i = 1; i < steady.length; i++) assert.ok(Math.abs(steady[i].yaw - steady[i - 1].yaw - want) < want);
});
