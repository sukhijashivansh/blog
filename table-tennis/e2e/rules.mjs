// checks the database rules against firebase's own rules engine, running locally in the emulator. nothing touches the real
// database. run with npm run test:rules
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, getDocs, query, collection, orderBy, where, limit, serverTimestamp, Timestamp } from 'firebase/firestore';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { blank, fold } from '../js/record.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = await initializeTestEnvironment({ projectId: 'demo-flickpong', firestore: { rules: fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8'), host: '127.0.0.1', port: 8085 } });
const as = uid => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).firestore();
const profile = { name: 'Alice', photo: 'https://lh3.googleusercontent.com/a/x' };
const win = level => ({ level, won: true, pointsWon: 11, pointsLost: 6, longest: 8, fastest: 11.2 });

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log(`PASS  ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message.split('\n')[0]}`); }
}

const first = fold(blank(), win('Club'));
await check('a player creates their own record', () => assertSucceeds(setDoc(doc(as('alice'), 'players/alice'), { ...first, ...profile, joinedAt: serverTimestamp(), lastSeen: serverTimestamp() })));
await check("nobody can create someone else's record", () => assertFails(setDoc(doc(as('alice'), 'players/bob'), { ...first, ...profile, joinedAt: serverTimestamp(), lastSeen: serverTimestamp() })));
await check('signed out, nobody can write at all', () => assertFails(setDoc(doc(as(null), 'players/carol'), { ...first, ...profile, joinedAt: serverTimestamp(), lastSeen: serverTimestamp() })));
await check('anyone can read a record for the leaderboard', () => assertSucceeds(getDoc(doc(as(null), 'players/alice'))));
await check('anyone can list the top 50', () => assertSucceeds(getDocs(query(collection(as(null), 'players'), where('score', '>', 0), orderBy('score', 'desc'), limit(50)))));
await check('nobody can pull the whole list at once', () => assertFails(getDocs(query(collection(as(null), 'players'), orderBy('score', 'desc'), limit(500)))));
await check('a list without a limit is refused', () => assertFails(getDocs(collection(as(null), 'players'))));

const saved = (await getDoc(doc(as('alice'), 'players/alice'))).data(), keep = { ...profile, joinedAt: saved.joinedAt, lastSeen: serverTimestamp() };
const next = fold(first, win('Pro'));
await check('a finished match adds to the record', () => assertSucceeds(setDoc(doc(as('alice'), 'players/alice'), { ...next, ...keep })));
await check('league points have to match the wins', () => assertFails(setDoc(doc(as('alice'), 'players/alice'), { ...next, score: next.score + 50, ...keep })));
await check('totals never count down', () => assertFails(setDoc(doc(as('alice'), 'players/alice'), { ...first, ...keep })));
await check('no more than 50 matches can be added at once', () => {
  let big = next;
  for (let i = 0; i < 51; i++) big = fold(big, win('Beginner'));
  return assertFails(setDoc(doc(as('alice'), 'players/alice'), { ...big, ...keep }));
});
await check('a record can only hold the known fields', () => assertFails(setDoc(doc(as('alice'), 'players/alice'), { ...next, ...keep, email: 'a@b.c' })));
await check('only real levels can be stored', () => assertFails(setDoc(doc(as('alice'), 'players/alice'), { ...next, levels: { ...next.levels, Legend: { played: 1, won: 1 } }, ...keep })));
await check('the join date can never change', () => assertFails(setDoc(doc(as('alice'), 'players/alice'), { ...next, ...keep, joinedAt: Timestamp.fromMillis(0) })));
await check("nobody can change someone else's record", () => assertFails(setDoc(doc(as('bob'), 'players/alice'), { ...next, ...keep })));
await check('a brand-new record can bring at most 50 waiting matches', () => {
  let big = blank();
  for (let i = 0; i < 51; i++) big = fold(big, win('Beginner'));
  return assertFails(setDoc(doc(as('dave'), 'players/dave'), { ...big, ...profile, joinedAt: serverTimestamp(), lastSeen: serverTimestamp() }));
});

await env.cleanup();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
