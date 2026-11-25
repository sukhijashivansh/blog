import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, SKILLS } from './sim.js';
import { NEAR, FAR, TABLE } from '../js/config.js';
import { NET_TOP } from '../js/physics.js';

// what a player sees: paddles meeting the ball on the blade, an opponent that moves like a person, shots of different shapes
const BLADE = 0.082 * 1.25;
const q = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

function watch(level = 2, seeds = 3) {
  const mine = [], theirs = [], steps = [], shots = [];
  for (let seed = 1; seed <= seeds; seed++) {
    let last = null, cur = null, prevZ = null;
    run({ level, bestOf: 1, seconds: 600, seed: seed * 11, skill: SKILLS.average, firstServer: seed % 2, onFrame: ({ game, events }) => {
      for (const e of events) {
        if (e.type === 'hit' && !e.late) {
          if (e.who === NEAR) mine.push(game.hitOff * game.level.hitRadius);
          else theirs.push(Math.hypot(game.ball.p.x - game.ai.p.x, game.ball.p.y - game.ai.p.y));
          if (cur) shots.push(cur);
          cur = { who: e.who, name: e.name, net: null, land: null };
        }
        if (e.type === 'bounce' && e.on === 'table' && cur && !cur.land) cur.land = Math.abs(game.ball.p.z);
      }
      const b = game.ball.p;
      if (cur && cur.net === null && prevZ !== null && prevZ * b.z <= 0) cur.net = b.y - NET_TOP;
      prevZ = b.z;
      const a = game.drawn.ai;
      if (last) steps.push(Math.hypot(a.x - last.x, a.y - last.y, a.z - last.z));
      last = { ...a };
    } });
  }
  return { mine, theirs, steps, shots };
}

const seen = watch();

test('your paddle meets the ball on its blade', () => {
  const outside = seen.mine.filter(d => d > BLADE).length / seen.mine.length;
  assert.ok(outside < 0.08, `${Math.round(outside * 100)}% of your hits were outside the blade`);
});

test("the opponent's paddle meets the ball on its blade", () => {
  const outside = seen.theirs.filter(d => d > BLADE).length / seen.theirs.length;
  assert.ok(outside < 0.02, `${Math.round(outside * 100)}% of its hits were outside the blade`);
});

test("the opponent's paddle glides and never jumps", () => {
  // 6 m/s is a fast lunge. at 60 frames a second that's 10 cm a frame
  assert.ok(Math.max(...seen.steps) < 0.11, `largest step ${Math.max(...seen.steps)} m in one frame`);
});

test('shots come in different shapes, not one flat line to the baseline', () => {
  const theirs = seen.shots.filter(s => s.who === FAR), mine = seen.shots.filter(s => s.who === NEAR);
  const kinds = new Set(theirs.map(s => s.name));
  assert.ok(kinds.has('Topspin') && kinds.has('Drive'), [...kinds].join(', '));
  const share = theirs.filter(s => s.name === 'Topspin').length / theirs.length;
  assert.ok(share > 0.2, `only ${Math.round(share * 100)}% of the opponent's shots were loops`);
  const clear = theirs.filter(s => s.net !== null).map(s => s.net);
  assert.ok(q(clear, 0.9) - q(clear, 0.1) > 0.1, 'the opponent sends some balls low over the net and some high');
  const depth = mine.filter(s => s.land).map(s => s.land);
  assert.ok(q(depth, 0.9) - q(depth, 0.1) > 0.2, 'your shots land at different depths');
  assert.ok(depth.every(d => d <= TABLE.halfL + 0.05));
});
