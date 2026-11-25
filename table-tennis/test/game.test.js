import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, rates, track, SKILLS } from './sim.js';
import { NEAR, FAR, LEVELS } from '../js/config.js';
import { Game } from '../js/game.js';
import { PhonePaddle } from '../js/phone-paddle.js';

const share = st => {
  const w = Object.values(st.won).reduce((a, b) => a + b, 0), l = Object.values(st.lost).reduce((a, b) => a + b, 0);
  return { w, l };
};
// an average player's share of points over a few games
function pointShare(level, skill = SKILLS.average, net = 'wifi', seeds = 6) {
  let w = 0, l = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const st = run({ level, bestOf: 1, seconds: 600, net, seed: seed * 17 + level, skill, firstServer: seed % 2 });
    assert.ok(st.over, `level ${level} game ${seed} never finished`);
    const s = share(st);
    w += s.w;
    l += s.l;
  }
  return w / (w + l);
}

test('warm-up: an average player returns nearly every ball and it lands, on every level', () => {
  for (const level of [1, 2, 3]) {
    const st = run({ level, practice: true, seconds: 90, seed: 3 }), rt = rates(st);
    assert.ok(st.hits > 30, `only ${st.hits} hits`);
    assert.ok(rt.returned >= 0.95, `level ${level} returned ${rt.returned}`);
    assert.ok(rt.landed >= 0.9, `level ${level} landed ${rt.landed}`);
  }
});

test('flicks give real pace, and a flick that lands a moment late still counts', () => {
  const st = run({ level: 2, practice: true, seconds: 90, seed: 3 });
  const sp = st.speeds.slice().sort((a, b) => a - b);
  assert.ok(st.upgrades > st.hits * 0.2, `late flicks used ${st.upgrades} of ${st.hits}`);
  assert.ok(sp[sp.length >> 1] > 7, `median pace ${sp[sp.length >> 1]} m/s`);
  assert.ok(sp.at(-1) > 9, 'hard flicks go faster');
});

test('serving: flick up to toss, flick again and it goes in', () => {
  let tosses = 0, served = 0, landed = 0;
  for (let seed = 1; seed <= 4; seed++) {
    const st = run({ level: 2, bestOf: 1, seconds: 600, seed, firstServer: NEAR });
    tosses += st.tosses;
    served += st.serves;
    landed += st.servesIn;
  }
  assert.ok(tosses >= 20, `only ${tosses} tosses`);
  assert.ok(served / tosses > 0.9, `${served} serves from ${tosses} tosses`);
  assert.ok(landed / served > 0.9, `${landed} of ${served} serves went in`);
});

test('a serve flicked only once the ball reaches the paddle still goes', () => {
  let tosses = 0, served = 0;
  for (let seed = 1; seed <= 4; seed++) {
    const st = run({ level: 2, bestOf: 1, seconds: 600, seed, firstServer: NEAR, skill: { ...SKILLS.average, serveAt: 0 } });
    tosses += st.tosses;
    served += st.serves;
  }
  assert.ok(served / tosses > 0.8, `${served} serves from ${tosses} tosses`);
});

test('levels get harder in steps an average player can feel', () => {
  const easy = pointShare(1), club = pointShare(2), pro = pointShare(3);
  assert.ok(easy > 0.75, `beginner ${easy}`);
  assert.ok(club > 0.45 && club < 0.7, `club ${club}`);
  assert.ok(pro > 0.2 && pro < 0.45, `pro ${pro}`);
  assert.ok(easy > club && club > pro);
});

test('better players do better at every level', () => {
  for (const level of [2, 3]) {
    const weak = pointShare(level, SKILLS.weak, 'wifi', 4), good = pointShare(level, SKILLS.good, 'wifi', 4);
    assert.ok(good > weak + 0.25, `level ${level}: weak ${weak} good ${good}`);
  }
});

test('a full best of 3 match plays to the end', () => {
  const st = run({ level: 2, bestOf: 3, seconds: 1500, seed: 9 });
  assert.ok(st.over && st.games && Math.max(...st.games) === 2, JSON.stringify(st.games));
});

test('still playable on poor wifi', () => {
  const st = run({ level: 1, practice: true, seconds: 90, net: 'rough', seed: 3 }), rt = rates(st);
  assert.ok(rt.returned >= 0.9, `returned ${rt.returned}`);
  assert.ok(pointShare(2, SKILLS.average, 'rough', 4) > 0.35);
});

test('no frame does heavy work', () => {
  const ms = [];
  for (let seed = 1; seed <= 3; seed++) for (const level of [1, 2, 3]) ms.push(...run({ level, bestOf: 1, seconds: 300, seed, firstServer: seed % 2 }).frameMs.slice(300));
  ms.sort((a, b) => a - b);
  assert.ok(ms[Math.floor(ms.length * 0.999)] < 4, `p99.9 ${ms[Math.floor(ms.length * 0.999)]} ms`);
});

test('the paddle follows the phone smoothly and with little lag', () => {
  for (const fps of [60, 120]) {
    const clean = track(undefined, { net: 'clean', fps }), wifi = track(undefined, { net: 'wifi', fps }), rough = track(undefined, { net: 'rough', fps });
    assert.ok(clean.lag <= 0.01 && wifi.lag <= 0.015, `${fps}Hz lag clean ${clean.lag} wifi ${wifi.lag}`);
    assert.ok(rough.lag <= 0.04, `${fps}Hz rough lag ${rough.lag}`);
    for (const [name, m] of [['clean', clean], ['wifi', wifi]]) assert.ok(m.step < 0.015, `${fps}Hz ${name} stutter ${m.step}`);
    // on wifi that bunches readings, low lag is worth a little stutter
    assert.ok(rough.step < 0.025, `${fps}Hz rough stutter ${rough.step}`);
  }
});

test('on home wifi that stalls now and then, lag stays low and freezes glide instead of jumping', () => {
  const m = track(undefined, { net: 'bursty', fps: 60, seed: 5 });
  assert.ok(m.lag <= 0.03, `lag ${m.lag}`);
  assert.ok(m.worst < 0.15, `worst single-frame jump ${m.worst} m`);
});

test("the ball is drawn moving evenly even when frames and physics steps don't line up", () => {
  const game = new Game(() => 0.37), paddle = new PhonePaddle();
  game.start(2, 1, FAR, { server: FAR });
  const drawn = [], raw = [];
  for (let f = 0; f < 600; f++) {
    game.update(1 / 60, paddle.tick(1 / 60, f / 60, game.assist, null));
    game.drain();
    if (game.phase === 'play' && game.ball.v.z > 2) { drawn.push({ ...game.drawn.ball, f }); raw.push({ ...game.ball.p, f }); }
  }
  // how much the distance moved changes from one frame to the next. in steady flight it should barely change
  const judder = list => {
    const d = [], j = [];
    for (let i = 1; i < list.length; i++) d.push(list[i].f === list[i - 1].f + 1 ? Math.abs(list[i].z - list[i - 1].z) : null);
    for (let i = 1; i < d.length; i++) if (d[i] && d[i - 1]) j.push(Math.abs(d[i] - d[i - 1]) / d[i]);
    return j.sort((a, b) => a - b)[j.length >> 1];
  };
  assert.ok(raw.length > 30);
  assert.ok(judder(drawn) < 0.05, `drawn ball judders ${judder(drawn)}`);
  assert.ok(judder(raw) > judder(drawn) * 4, `raw ${judder(raw)} drawn ${judder(drawn)}`);
});

test('levels are set up consistently', () => {
  for (const L of Object.values(LEVELS)) {
    for (const k of ['timeScale', 'hitRadius', 'magnet', 'power', 'assist', 'reaction', 'moveSpeed', 'reach', 'err']) assert.ok(Number.isFinite(L[k]), `${L.name} ${k}`);
    assert.ok(L.magnet > L.hitRadius, `${L.name}: the pull should reach further than a hit`);
  }
});
