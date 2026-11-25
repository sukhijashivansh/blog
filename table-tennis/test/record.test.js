import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blank, clean, fold, describe, points } from '../js/record.js';

const win = { level: 'Club', won: true, pointsWon: 11, pointsLost: 7, longest: 9, fastest: 12.34 };
const loss = { level: 'Pro', won: false, pointsWon: 4, pointsLost: 11, longest: 14, fastest: 9.1 };

test('a finished match adds to the totals and keeps the bests', () => {
  const r = fold(fold(blank(), win), loss);
  assert.deepEqual(r, {
    played: 2, won: 1, pointsWon: 15, pointsLost: 18, bestRally: 14, fastest: 12.3,
    levels: { Club: { played: 1, won: 1 }, Pro: { played: 1, won: 0 } }, score: 3,
  });
});

test('bests never go down', () => {
  const r = fold(fold(blank(), { ...win, longest: 20, fastest: 15 }), { ...win, longest: 3, fastest: 4 });
  assert.equal(r.bestRally, 20);
  assert.equal(r.fastest, 15);
});

test('folding never changes the record it was given', () => {
  const r = blank(), before = JSON.stringify(r);
  fold(r, win);
  assert.equal(JSON.stringify(r), before);
});

test('a saved record with missing or broken fields reads as zeros', () => {
  assert.deepEqual(clean({}), blank());
  const r = clean({ played: 3, won: 9, pointsWon: -2, bestRally: 1.5, fastest: 'fast', levels: { Club: { played: 2, won: 5 }, junk: { played: 1, won: 1 } }, score: 999, name: 'x' });
  assert.deepEqual(r, { played: 3, won: 3, pointsWon: 0, pointsLost: 0, bestRally: 0, fastest: 0, levels: { Club: { played: 2, won: 2 } }, score: 6 });
});

test('what a saved record shows only uses fields the database rules allow', () => {
  const allowed = ['name', 'photo', 'played', 'won', 'pointsWon', 'pointsLost', 'bestRally', 'fastest', 'levels', 'score', 'joinedAt', 'lastSeen'];
  for (const k of Object.keys(fold(blank(), win))) assert.ok(allowed.includes(k), k);
  const r = fold(blank(), win);
  for (const k of ['played', 'won', 'pointsWon', 'pointsLost', 'bestRally']) assert.ok(Number.isInteger(r[k]), `${k} must be a whole number`);
});

test('the corner line reads naturally', () => {
  assert.equal(describe(blank()), 'No matches yet');
  assert.equal(describe(fold(blank(), win)), '3 league points · 1 of 1 won · best rally 9');
});

test('league points weigh wins by level, and a loss earns nothing', () => {
  assert.equal(points({ Beginner: { played: 4, won: 2 }, Club: { played: 1, won: 1 }, Pro: { played: 3, won: 1 } }), 2 + 3 + 6);
  const r = fold(fold(blank(), { ...win, level: 'Pro' }), { ...loss, level: 'Pro' });
  assert.equal(r.score, 6);
  assert.equal(fold(blank(), { ...win, level: 'Nonsense' }).played, 0, 'a level it does not know is ignored');
});
