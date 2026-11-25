// end-to-end in a real browser: a game tab and a phone tab pair over WebRTC through the real pairing service,
// the phone tab gets made-up motion, and every screen of the game is walked through.
// npm run e2e tests the local files, BASE=https://... npm run e2e tests a deployed copy. CHROME=/path/to/chrome picks the browser
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = os.tmpdir();
const EXE = process.env.CHROME || undefined;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

// the game page reports its lag numbers to /stats when it runs locally, as it does to the dev server
const reports = [];
const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/stats') {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => { try { reports.push(JSON.parse(body)); } catch (e) {} res.writeHead(204).end(); });
    return;
  }
  let file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (file.endsWith('/')) file += 'index.html';
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
// BASE=https://... tests a deployed copy instead of the local files
if (!process.env.BASE) await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = process.env.BASE || `http://127.0.0.1:${server.address().port}/`, local = !process.env.BASE;

const results = [], errors = [];
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 15000, every = 100) { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch (e) {} await sleep(every); } return null; }

const browser = await chromium.launch({ executablePath: EXE, headless: true });
console.log(`testing ${base}\n`);
const lapCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const watch = (page, who) => {
  // firebase answers 400 when asked about sign-in before it's switched on. that's expected, not a fault
  page.on('response', r => { if (r.status() >= 400 && !r.url().includes('/relyingparty/getProjectConfig')) errors.push(`${who} ${r.status()}: ${r.url()}`); });
  page.on('pageerror', e => errors.push(`${who} page error: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(`${who} console: ${m.text()}`); });
};

// a stand-in for the phone's sensors: a pose the test steers, sent 60 times a second, plus flicks
const SENSORS = () => {
  window.__pose = { alpha: 40, beta: 0, gamma: 2 };
  window.__on = true;
  const send = () => {
    if (window.__on) {
      dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: __pose.alpha, beta: __pose.beta, gamma: __pose.gamma, absolute: false }));
      dispatchEvent(new DeviceMotionEvent('devicemotion', { acceleration: { x: 0, y: 0, z: 0 }, accelerationIncludingGravity: { x: 0, y: 0, z: 9.81 }, rotationRate: { alpha: 0, beta: 0, gamma: 0 }, interval: 16 }));
    }
    setTimeout(send, 16);
  };
  send();
  window.__flick = (amp = 32) => {
    const t0 = performance.now(), from = __pose.beta, ease = x => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, x)));
    const step = () => {
      const u = (performance.now() - t0) / 1000;
      __pose.beta = from + (u < 0.06 ? amp * ease(u / 0.06) : amp * (1 - ease((u - 0.06) / 0.16)));
      if (u < 0.24) setTimeout(step, 4); else __pose.beta = from;
    };
    step();
  };
};

const lap = await lapCtx.newPage();
watch(lap, 'game');
await lap.goto(base);
const webgl = await lap.evaluate(() => !!document.createElement('canvas').getContext('webgl2'));
check('game page has WebGL', webgl);
const link = await until(async () => { const t = await lap.textContent('#link'); return t.startsWith('http') ? t : null; }, 30000);
check('pairing code appears', !!link, link || '(none: is the pairing service reachable?)');
check('QR code is drawn', await lap.$eval('#qr', el => !!el.querySelector('svg')));
// until google sign-in is switched on for the project, firebase says so and the game stays open to everyone
check('until sign-in is switched on, the game stays open', !!await until(async () => !(await lap.isVisible('#gate')) && !(await lap.evaluate(() => document.body.classList.contains('gated'))), 15000));
check(local ? 'locally, the code sends the phone to the live phone page' : 'the code points at this site', link.startsWith(local ? 'https://flickpong.vercel.app/phone.html#' : base));
// the test drives the phone page from the same copy as the game page
const phoneUrl = new URL(new URL(link).pathname + new URL(link).hash, base).href;
check('lag monitor stays hidden until D is pressed', !(await lap.isVisible('#debug')));
// sound needs a click on the game screen
await lap.mouse.click(640, 400);

let phone = await phoneCtx.newPage();
watch(phone, 'phone');
await phone.goto(phoneUrl);
check('phone connects to the game', !!await until(() => phone.isEnabled('#go'), 30000));
check('game shows "Phone connected"', !!await until(async () => (await lap.textContent('#title')) === 'Phone connected', 8000));
await phone.evaluate(SENSORS);
await phone.click('#go');
check('phone shows the controller after Start', !!await until(() => phone.isVisible('#pad'), 5000));
check('warm-up starts', !!await until(async () => (await lap.textContent('#title')) === 'Point your phone', 8000));
check('phone mirrors the prompt', !!await until(async () => (await phone.textContent('#title')) === 'Point your phone', 4000));
check('game no longer shows the code', !(await lap.isVisible('#pair')));

// warm-up 1: touch the ring on each side
await phone.evaluate(() => { __pose.alpha = 40 + 16; });
await sleep(700);
await phone.evaluate(() => { __pose.alpha = 40 - 16; });
check('pointing left and right passes the first lesson', !!await until(async () => (await lap.textContent('#title')) === 'Meet the ball', 6000));
await phone.evaluate(() => { __pose.alpha = 40; });

// warm-up 2: three returns. aim at the middle and keep flicking
const flicker = setInterval(() => phone.evaluate(() => __flick()).catch(() => {}), 1100);
check('balls are returned in the second lesson', !!await until(async () => (await lap.textContent('#title')) === 'Now serve', 40000), `title: ${await lap.textContent('#title')}`);
clearInterval(flicker);

// warm-up 3: flick up to toss, flick again as it drops
let served = false;
for (let i = 0; i < 8 && !served; i++) {
  await phone.evaluate(() => __flick(28));
  await sleep(640);
  await phone.evaluate(() => __flick());
  served = !!await until(async () => (await lap.textContent('#title')) === 'Pick your opponent', 2600);
}
check('a serve goes in and the warm-up finishes', served, served ? '' : `title: ${await lap.textContent('#title')}`);
if (!served) { await phone.click('#menu button:has-text("Skip")').catch(() => {}); await until(async () => (await lap.textContent('#title')) === 'Pick your opponent', 4000); }

// menus answered from the phone
const levels = await until(async () => { const b = await phone.$$eval('#menu button b', bs => bs.map(b => b.textContent)); return b.length >= 5 ? b : null; }, 4000);
check('phone lists the opponents', !!levels && levels.join(',') === 'Beginner,Club,Pro,A friend,Replay the warm-up', levels?.join(', '));
await phone.click('#menu button:has-text("Club")');
check('tapping a level asks how long', !!await until(async () => (await lap.textContent('#title')) === 'Club. How long?', 4000));
await until(async () => (await phone.$$('#menu button')).length === 3, 3000);
await phone.click('#menu button:has-text("One game")');
check('match starts after the coin toss', !!await until(() => lap.isVisible('#board'), 6000));

// play: frame pacing on the game tab while the phone aims and flicks. a player serves when told to, and otherwise keeps flicking
// at whatever comes. stopping waits for a serve in progress to finish
function player(game, ph) {
  let serving = false;
  const timer = setInterval(async () => {
    if (serving) return;
    const title = await game.textContent('#title').catch(() => '');
    if (title === 'Your serve') {
      serving = true;
      await ph.evaluate(() => { __pose.alpha = 40; __flick(28); }).catch(() => {});
      await sleep(640);
      await ph.evaluate(() => __flick()).catch(() => {});
      await sleep(1200);
      serving = false;
    } else ph.evaluate(() => { __pose.alpha = 40 + (Math.random() - 0.5) * 16; __flick(); }).catch(() => {});
  }, 900);
  return async () => { clearInterval(timer); while (serving) await sleep(100); };
}
await lap.evaluate(() => { window.__frames = []; let last = 0; const f = t => { if (last) window.__frames.push(t - last); last = t; requestAnimationFrame(f); }; requestAnimationFrame(f); });
const stopPlaying = player(lap, phone);
await sleep(25000);
await stopPlaying();
const score = await lap.evaluate(() => [...document.querySelectorAll('.pts')].map(e => +e.textContent));
check('points are being played', score[0] + score[1] > 0, `score ${score.join('-')}`);
const frames = await lap.evaluate(() => window.__frames.slice(30));
frames.sort((a, b) => a - b);
const med = frames[frames.length >> 1], long = frames.filter(f => f > med * 1.8).length;
check('game tab keeps an even frame rate', long / frames.length < 0.02, `median frame ${med.toFixed(1)} ms, ${long} long frames of ${frames.length}`);
const lag = await lap.textContent('#lag');
check('latency badge shows', /^Phone \d+ ms/.test(lag), lag);
await lap.screenshot({ path: path.join(OUT, 'e2e-game.png') });
await phone.screenshot({ path: path.join(OUT, 'e2e-phone.png') });

// phone goes quiet: pause, then carry on
await phone.evaluate(() => { __on = false; });
check('game pauses when the phone goes quiet', !!await until(async () => (await lap.textContent('#title')) === 'Paused', 6000));
check('phone shows paused too', !!await until(async () => (await phone.textContent('#title')) === 'Paused', 3000));
await phone.evaluate(() => { __on = true; });
check('moving the phone counts back in and resumes', !!await until(async () => ['3', '2', '1'].includes(await lap.textContent('#title')), 4000) && !!await until(async () => (await lap.textContent('#title')) !== 'Paused' && !['3', '2', '1'].includes(await lap.textContent('#title')), 6000));

// phone settings: aim speed and hold to recenter
await phone.click('[data-speed="quick"]');
check('aim speed switches', (await phone.getAttribute('[data-speed="quick"]', 'aria-pressed')) === 'true' && (await phone.getAttribute('[data-speed="normal"]', 'aria-pressed')) === 'false');
const box = await phone.$('#center').then(e => e.boundingBox());
await phone.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await phone.mouse.down();
await sleep(120);
await phone.mouse.up();
const early = await phone.$eval('#center', e => e.classList.contains('flash'));
await phone.mouse.down();
await sleep(450);
const done = await phone.$eval('#center', e => e.classList.contains('flash'));
await phone.mouse.up();
check('recenter needs a hold, a tap does nothing', !early && done);

// the phone page closes mid-match, then the same code is opened again
await phone.close();
check('game pauses and shows the code again when the phone leaves', !!await until(async () => (await lap.textContent('#title')) === 'Paused' && await lap.isVisible('#pair'), 8000));
phone = await phoneCtx.newPage();
watch(phone, 'phone');
await phone.goto(phoneUrl);
await until(() => phone.isEnabled('#go'), 20000);
await phone.evaluate(SENSORS);
await phone.click('#go');
check('a reopened phone picks the match back up', !!await until(async () => (await lap.textContent('#title')) !== 'Paused', 10000) && !(await lap.isVisible('#pair')));

// the game tab reloads: the paired phone finds it again by itself
await lap.reload();
await lap.mouse.click(640, 400);
check('after a game reload the phone reconnects on its own', !!await until(async () => (await lap.textContent('#title')) === 'Pick your opponent', 30000), `title: ${await lap.textContent('#title')}`);
check('same pairing code after reload', (await until(async () => { const t = await lap.textContent('#link'); return t.startsWith('http') ? t : null; }, 10000)) === link);

await lap.keyboard.press('d');
check('D shows the lag monitor', await lap.isVisible('#debug'));
const monitorText = await until(async () => { const t = await lap.textContent('#debug'); return /reading → frame\s+\d+ ms/.test(t) && /round trip \d+ ms/.test(t) ? t : null; }, 8000);
check('lag monitor measures the trip once the clocks line up', !!monitorText, (monitorText || await lap.textContent('#debug')).split('\n')[0]);
if (local) {
  const timed = reports.filter(r => r.lag && r.trip && r.phone);
  check('lag reports reach the dev server every second', reports.length >= 40 && timed.length >= 20, `${reports.length} reports, ${timed.length} with full timing`);
  const last = timed.at(-1);
  if (last) console.log(`      last report: reading→frame ${Math.round(last.lag.p50)} ms, round trip ${Math.round(last.trip.avg)} ms, lands after ${Math.round(last.way.p50)} ms, buffer ${Math.round(last.buffer.delay * 1000)} ms, phone ${last.phone.hz}/s`);
}
// two players, each at their own laptop with their own phone, play each other online
const scoreOf = page => page.evaluate(() => [...document.querySelectorAll('.pts')].map(e => +e.textContent));
await phone.click('#menu button:has-text("A friend")');
check('picking "A friend" shows an invite link', !!await until(async () => (await lap.textContent('#title')) === 'Invite a friend' && await lap.isVisible('#invite'), 4000), await lap.textContent('#title'));
const invite = await lap.inputValue('#inviteLink');
check('the invite link carries this laptop\'s pairing id', invite === `${base}#join=${new URL(link).hash.slice(1)}`, invite);
const lapB = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
watch(lapB, 'friend\'s game');
await lapB.goto(invite);
await lapB.mouse.click(640, 400);
check('the friend\'s laptop says they were invited', !!await until(async () => (await lapB.textContent('#sub')).includes('invited you to a match'), 30000), await lapB.textContent('#sub'));
check('the inviter sees their friend arrive', !!await until(async () => (await lap.textContent('#hint')).includes('pairing their phone'), 10000), await lap.textContent('#hint'));
const linkB = await until(async () => { const t = await lapB.textContent('#link'); return t.startsWith('http') ? t : null; }, 30000);
const phoneB = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })).newPage();
watch(phoneB, 'friend\'s phone');
await phoneB.goto(new URL(new URL(linkB).pathname + new URL(linkB).hash, base).href);
await until(() => phoneB.isEnabled('#go'), 30000);
await phoneB.evaluate(SENSORS);
await phoneB.click('#go');
check('a first-time friend warms up, and the inviter is told', !!await until(async () => (await lap.textContent('#hint')).includes('warming up'), 10000), await lap.textContent('#hint'));
await until(() => phoneB.isVisible('#menu button:has-text("Skip")'), 4000);
await phoneB.click('#menu button:has-text("Skip")');
check('then the friend waits for the inviter', !!await until(async () => (await lapB.textContent('#title')) === 'Waiting for your friend', 6000), await lapB.textContent('#title'));
check('and the inviter picks how long to play', !!await until(async () => (await lap.textContent('#title')) === 'Your friend is ready. How long?', 6000), await lap.textContent('#title'));
await until(async () => (await phone.$$('#menu button')).length === 3, 3000);
await phone.click('#menu button:has-text("One game")');
check('the match starts on both laptops', !!await until(async () => await lap.isVisible('#board') && await lapB.isVisible('#board'), 8000));
check('each scoreboard names the other player', (await lap.textContent('#foeName')) === 'Friend' && (await lapB.textContent('#foeName')) === 'Friend');
const stopA = player(lap, phone), stopB = player(lapB, phoneB);
await sleep(30000);
const agreed = await until(async () => { const [a, b] = [await scoreOf(lap), await scoreOf(lapB)]; return a[0] + a[1] > 0 && a[0] === b[1] && a[1] === b[0] ? a : null; }, 10000);
check('both laptops show the same score', !!agreed, `inviter ${(await scoreOf(lap)).join('-')}, friend ${(await scoreOf(lapB)).join('-')}`);
await stopA();
await stopB();
await lapB.screenshot({ path: path.join(OUT, 'e2e-friend.png') });

// a third laptop with the same link while the match is on is turned away
const lapC = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
watch(lapC, 'third game');
await lapC.goto(invite);
check('a third laptop with the same link is turned away', !!await until(async () => (await lapC.textContent('#call')).includes('isn\'t inviting anyone'), 30000), await lapC.textContent('#call'));
await lapC.context().close();

// the friend's phone drops out: both games stop, and both carry on once it's back
await phoneB.evaluate(() => { __on = false; });
check('a friend\'s phone dropping out pauses both games', !!await until(async () => (await lapB.textContent('#title')) === 'Paused' && (await lap.textContent('#title')) === 'Your friend\'s phone dropped out', 8000), `inviter: ${await lap.textContent('#title')}, friend: ${await lapB.textContent('#title')}`);
await phoneB.evaluate(() => { __on = true; });
const counting = ['3', '2', '1'], held = ['Paused', 'Your friend\'s phone dropped out', ...counting];
check('both count back in together', !!await until(async () => counting.includes(await lap.textContent('#title')) && counting.includes(await lapB.textContent('#title')), 5000));
check('and play on', !!await until(async () => !held.includes(await lap.textContent('#title')) && !held.includes(await lapB.textContent('#title')), 8000));

// the friend's laptop closes: the inviter is told and goes back to the menu
await lapB.context().close();
await phoneB.context().close();
check('when the friend\'s laptop closes, the inviter goes back to the menu', !!await until(async () => (await lap.textContent('#title')) === 'Pick your opponent', 20000), await lap.textContent('#title'));
check('and the board goes back to the computer', (await lap.textContent('#foeName')) === 'Opponent' && !(await lap.isVisible('#board')));

// once google sign-in is switched on, the game waits behind the sign-in card. firebase's answer is stood in for here
const gatedPage = await lapCtx.newPage();
watch(gatedPage, 'gated game');
await gatedPage.route('**/identitytoolkit/v3/relyingparty/getProjectConfig**', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ idpConfig: [{ provider: 'google.com', enabled: true }], authorizedDomains: [new URL(base).hostname] }) }));
await gatedPage.goto(base);
check('with sign-in switched on, the game waits behind the sign-in card', !!await until(() => gatedPage.isVisible('#gateSignIn'), 15000) && !(await gatedPage.isVisible('#pair')));
check('the sign-in card shows the leaderboard', !!await until(async () => (await gatedPage.$$('#gateLeaders li')).length > 0, 10000));
await gatedPage.close();

// opened on a phone, the game asks for a bigger screen, and still lets you play there if you insist
const small = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const smallPage = await small.newPage();
watch(smallPage, 'game on a phone');
await smallPage.goto(base);
check('opened on a phone, the game asks for a bigger screen', !!await until(() => smallPage.isVisible('#small'), 5000));
await smallPage.tap('#smallAnyway');
check('"Play here anyway" goes on into the game', !!await until(async () => !(await smallPage.isVisible('#small')) && !!(await smallPage.$eval('#qr', el => el.querySelector('svg'))), 30000));
await small.close();

check('no errors on either page', errors.length === 0, errors.slice(0, 6).join(' || '));
await browser.close();
if (local) server.close();
const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed. screenshots: ${path.join(OUT, 'e2e-game.png')}, ${path.join(OUT, 'e2e-phone.png')}`);
process.exit(failed ? 1 : 0);
