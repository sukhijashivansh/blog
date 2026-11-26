// playing a friend online the ways real people try it, beyond the plain case in browser.mjs: a friend whose network won't allow
// a direct link (the match goes through the relay), both laptops in the same browser, and an invite link opened after its own
// game has closed. npm run e2e:online runs it against a local stand-in for the relay database, which also checks its rules.
// BASE=https://... node e2e/online.mjs runs it against a deployed copy and the real database. CHROME=/path/to/chrome picks the browser
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = os.tmpdir();
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const EMULATOR = '127.0.0.1:9000', NS = 'flickpong-game-default-rtdb';

// locally the game page is also allowed to reach the stand-in database
const server = http.createServer((req, res) => {
  if (req.method === 'POST') { req.resume(); res.writeHead(204).end(); return; }
  let file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (file.endsWith('/')) file += 'index.html';
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  if (file.endsWith('index.html')) res.end(fs.readFileSync(file, 'utf8').replace("connect-src 'self'", `connect-src 'self' ws://${EMULATOR} http://${EMULATOR}`));
  else fs.createReadStream(file).pipe(res);
});
if (!process.env.BASE) await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = process.env.BASE || `http://127.0.0.1:${server.address().port}/`, local = !process.env.BASE;

const results = [], errors = [];
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 15000, every = 100) { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch (e) {} await sleep(every); } return null; }
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, headless: true });
console.log(`testing ${base}${local ? ` with the relay database stood in for at ${EMULATOR}` : ' with the real relay database'}\n`);

const watch = (page, who) => {
  page.on('response', r => { if (r.status() >= 400 && !r.url().includes('/relyingparty/getProjectConfig')) errors.push(`${who} ${r.status()}: ${r.url()}`); });
  page.on('pageerror', e => errors.push(`${who} page error: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(`${who} console: ${m.text()}`); });
};
// a laptop, pointed at the stand-in database when testing locally. blocked means its network won't allow a direct link
// to a friend's laptop: a friend's link is the one that asks for ordered delivery, and it's told to use only relay servers,
// of which there are none. the phone's link is untouched
async function laptop(who, blocked = false, ctx = null) {
  ctx ||= await browser.newContext({ viewport: { width: 1280, height: 800 } });
  if (local) await ctx.addInitScript(at => { try { localStorage.setItem('tt.relay', at); } catch (e) {} }, EMULATOR);
  if (blocked) await ctx.addInitScript(() => {
    const make = RTCPeerConnection.prototype.createDataChannel;
    RTCPeerConnection.prototype.createDataChannel = function (label, init) {
      if (init?.ordered) this.setConfiguration({ ...this.getConfiguration(), iceTransportPolicy: 'relay' });
      return make.call(this, label, init);
    };
  });
  const page = await ctx.newPage();
  watch(page, who);
  return page;
}
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
// pairs a phone with a laptop and skips the warm-up
async function pairPhone(game, who) {
  const link = await until(async () => { const t = await game.textContent('#link'); return t.startsWith('http') ? t : null; }, 30000);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const phone = await ctx.newPage();
  watch(phone, who);
  await phone.goto(new URL(new URL(link).pathname + new URL(link).hash, base).href);
  await until(() => phone.isEnabled('#go'), 30000);
  await phone.evaluate(SENSORS);
  await phone.click('#go');
  if (await until(() => phone.isVisible('#menu button:has-text("Skip")'), 8000)) await phone.click('#menu button:has-text("Skip")');
  return phone;
}
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
const scoreOf = page => page.evaluate(() => [...document.querySelectorAll('.pts')].map(e => +e.textContent));
async function invite(page) {
  await page.goto(base);
  await until(() => page.isVisible('#friendStart'), 30000);
  await page.click('#friendStart');
  return page.inputValue('#inviteLink');
}

// the relay database's rules: only rooms named like a pairing id, two sides each, short strings, and no listing the rooms
if (local) {
  const at = p => `http://${EMULATOR}/${p}.json?ns=${NS}`;
  const put = async (p, v) => (await fetch(at(p), { method: 'PUT', body: JSON.stringify(v) })).status;
  check('relay rules: a laptop can write its side of a room', await put('rooms/tt-abc123/host/here', 'x1') === 200 && await put('rooms/tt-abc123/guest/m/a', '{"k":"ping"}') === 200);
  check('relay rules: and read a room it knows the name of', (await fetch(at('rooms/tt-abc123'))).status === 200);
  check('relay rules: but not list the rooms', (await fetch(at('rooms'))).status !== 200);
  check('relay rules: rooms must be named like a pairing id', await put('rooms/evil/host/here', 'x') !== 200 && await put('rooms/tt-ABC/host/here', 'x') !== 200);
  check('relay rules: a room has only the two sides, holding only the expected fields', await put('rooms/tt-abc123/spy/here', 'x') !== 200 && await put('rooms/tt-abc123/host/score', 'x') !== 200);
  check('relay rules: messages are short strings', await put('rooms/tt-abc123/host/m/b', { k: 'ping' }) !== 200 && await put('rooms/tt-abc123/host/m/c', 'x'.repeat(2001)) !== 200 && await put('rooms/tt-abc123/host/pose', 'x'.repeat(401)) !== 200);
  await fetch(at('rooms/tt-abc123'), { method: 'DELETE' });
}

// a friend whose network won't allow a direct link: the whole match goes through the relay
const t0 = Date.now();
const host = await laptop('inviter');
const link = await invite(host);
const guest = await laptop('friend', true);
await guest.goto(link);
await guest.mouse.click(640, 400);
check('a friend who can\'t link directly says why it\'s taking a moment', !!await until(async () => (await guest.textContent('#sub')).includes('another way'), 20000), await guest.textContent('#sub'));
const arrived = await until(async () => (await host.textContent('#inviteStatus')).includes('is here'), 40000);
check('and gets through the relay', !!arrived, `${((Date.now() - t0) / 1000).toFixed(1)} s after the invite, inviter shows "${await host.textContent('#inviteStatus')}"`);
const phoneH = await pairPhone(host, 'inviter\'s phone'), phoneG = await pairPhone(guest, 'friend\'s phone');
check('both pair their phones, and the inviter picks how long', !!await until(async () => (await host.textContent('#title')) === 'Your friend is ready. How long?', 20000), await host.textContent('#title'));
await until(async () => (await phoneH.$$('#menu button')).length === 3, 3000);
await phoneH.click('#menu button:has-text("One game")');
check('the match starts on both laptops', !!await until(async () => await host.isVisible('#board') && await guest.isVisible('#board'), 10000));
const stopH = player(host, phoneH), stopG = player(guest, phoneG);
await sleep(35000);
const agreed = await until(async () => { const [a, b] = [await scoreOf(host), await scoreOf(guest)]; return a[0] + a[1] > 0 && a[0] === b[1] && a[1] === b[0] ? a : null; }, 40000);
check('both laptops show the same score through the relay', !!agreed, `inviter ${(await scoreOf(host)).join('-')}, friend ${(await scoreOf(guest)).join('-')}`);
const badges = [await host.textContent('#lag'), await guest.textContent('#lag')];
check('both corners say the friend is relayed, with the delay', badges.every(b => /Friend \d+ ms · relayed/.test(b)), badges.join(' | '));
await stopH();
await stopG();
await guest.screenshot({ path: path.join(OUT, 'e2e-relay-friend.png') });
await guest.context().close();
await phoneG.context().close();
check('when the relayed friend leaves, the inviter goes back to the menu', !!await until(async () => (await host.textContent('#title')) === 'Pick your opponent', 20000), await host.textContent('#title'));
await host.context().close();
await phoneH.context().close();

// both laptops in one browser, as someone trying it on their own might: the second tab no longer has to wait for the first
// tab's pairing id, so it's in at once
const same = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const tab1 = await laptop('first tab', false, same), tab2Link = await invite(tab1), t1 = Date.now();
const tab2 = await same.newPage();
watch(tab2, 'second tab');
await tab2.goto(tab2Link);
const inTab = await until(async () => (await tab1.textContent('#inviteStatus')).includes('is here'), 20000);
check('two tabs of one browser link up quickly', !!inTab && Date.now() - t1 < 8000, `${((Date.now() - t1) / 1000).toFixed(1)} s`);
await same.close();

// the invite link opened in its own tab, which closes the game it came from: it says so instead of waiting forever
const solo = await laptop('own link');
const ownLink = await invite(solo);
await solo.goto('about:blank');
await solo.goto(ownLink);
const told = await until(async () => (await solo.textContent('#call')).includes('made in this browser'), 45000, 200);
check('an invite link whose game has closed says so', !!told, await solo.textContent('#call'));
check('and the page carries on as a normal game', await solo.isVisible('#friendStart') || await solo.isVisible('#pair'));
await solo.context().close();

check('no errors on any page', errors.length === 0, errors.slice(0, 6).join(' || '));
await browser.close();
if (local) server.close();
const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed. screenshot: ${path.join(OUT, 'e2e-relay-friend.png')}`);
process.exit(failed ? 1 : 0);
