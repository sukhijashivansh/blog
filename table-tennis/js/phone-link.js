import qrcode from '../vendor/qrcode.mjs';
import { Playout } from './playout.js';

// a reloaded game tab asks for its old pairing code back. the service can take a moment to free it, so it asks a few times.
// pings go out four times a second. the quickest of the last SYNC lines up the phone's clock with this one
const RETRY_MS = 1500, PING_MS = 250, ID_TRIES = 4, SYNC = 16;
// a phone can't open this computer's own address, so when the game runs here the code sends it to the live phone page instead
const LIVE = 'https://flickpong.vercel.app/';
export const isLocal = () => ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, String(v)); } catch (e) {} } };
const makeId = () => `tt-${Math.random().toString(36).slice(2, 10)}`;
const num = v => Number.isFinite(v) ? v : 0;
const quantile = (list, q) => { const s = list.slice().sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : null; };

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('could not load the pairing library'));
    document.head.append(s);
  });
}

// the phone streams where it points and how it moves, straight to this tab over WebRTC
export class PhoneLink {
  constructor() {
    this.peer = null;
    this.conn = null;
    this.state = 'starting';
    this.url = '';
    this.stream = new Playout();
    this.seen = 0;
    this.taps = [];
    this.sent = '';
    this.lag = null;
    this.route = '';
    this.tries = 0;
    // for the lag monitor: the phone's clock minus this one in ms, round trips, how long each reading took to land, the phone's own report
    this.theta = null;
    this.syncs = [];
    this.trips = [];
    this.ways = [];
    this.phone = null;
    // a friend's laptop connects to the same pairing id as the phone does, saying it's a friend. onFriend takes it from there,
    // and onError hears about a friend's game that can't be found
    this.onFriend = null;
    this.onError = null;
    setInterval(() => this.ping(), PING_MS);
  }

  get paired() { return !!this.conn?.open; }

  // the same id across reloads, so a phone that's already paired finds the game again by itself. a laptop joining a friend's
  // game takes a fresh one and doesn't keep it, since the same browser may hold the inviter's tab, which uses the saved one
  async start({ fresh = false } = {}) {
    await loadScript(new URL('../vendor/peerjs.min.js', import.meta.url).href);
    this.keep = !fresh;
    this.open((!fresh && store.get('tt.peer')) || makeId());
  }

  open(id) {
    const peer = this.peer = new window.peerjs.Peer(id, { debug: 0 });
    peer.on('open', got => {
      this.tries = 0;
      if (this.keep) store.set('tt.peer', got);
      this.url = new URL(`phone.html#${got}`, isLocal() ? LIVE : location.href).href;
      if (!this.paired) this.state = 'waiting';
    });
    peer.on('connection', conn => {
      if (conn.metadata?.role === 'friend') { if (this.onFriend) this.onFriend(conn); else conn.close(); }
      else this.accept(conn);
    });
    peer.on('disconnected', () => this.retry(peer));
    peer.on('error', e => {
      if (peer === this.peer) this.onError?.(e);
      if (e.type === 'unavailable-id') {
        peer.destroy();
        const again = ++this.tries < ID_TRIES;
        setTimeout(() => this.open(again ? id : makeId()), again ? RETRY_MS : 0);
        return;
      }
      if (e.type === 'browser-incompatible') { this.state = 'unsupported'; return; }
      if (!this.paired && e.type !== 'peer-unavailable') this.state = 'offline';
      this.retry(peer);
    });
  }

  // losing the pairing service doesn't drop a phone that's already connected, it only stops new ones joining
  retry(peer) {
    if (peer !== this.peer || peer.destroyed) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => { if (peer.disconnected && !peer.destroyed) peer.reconnect(); }, RETRY_MS);
  }

  // one phone at a time. a new one takes over, so rescanning always works
  accept(conn) {
    conn.on('open', () => {
      if (this.conn && this.conn !== conn) this.conn.close();
      this.conn = conn;
      this.state = 'paired';
      this.sent = '';
      const predict = this.stream.predict;
      this.stream = new Playout();
      this.stream.predict = predict;
      this.theta = null;
      this.syncs = [];
    });
    conn.on('data', d => { if (conn === this.conn) this.receive(d); });
    conn.on('close', () => {
      if (conn !== this.conn) return;
      this.conn = null;
      this.state = 'waiting';
    });
  }

  receive(d) {
    if (!d || typeof d !== 'object') return;
    if (d.k === 'tap') { this.taps.push(d.n); return; }
    if (d.k === 'pong' && Number.isFinite(d.t)) {
      const rtt = performance.now() - d.t;
      this.lag = this.lag === null ? rtt / 2 : this.lag + (rtt / 2 - this.lag) * 0.3;
      this.trips.push(rtt);
      if (Number.isFinite(d.p)) {
        this.syncs.push({ rtt, theta: d.p - d.t - rtt / 2 });
        if (this.syncs.length > SYNC) this.syncs.shift();
        this.theta = this.syncs.reduce((a, q) => (q.rtt < a.rtt ? q : a)).theta;
      }
      return;
    }
    if (d.k === 'pstat') { this.phone = { hz: num(d.hz), gap: num(d.gap) * 1000, wait: num(d.wait) * 1000, waitMax: num(d.waitMax) * 1000 }; return; }
    if (d.k !== 'm' || !Number.isFinite(d.t)) return;
    const s = Array.isArray(d.s) ? d.s : [];
    const here = performance.now() / 1000;
    this.seen = here;
    // from the phone taking the reading to it landing here, once the clocks are lined up
    if (this.theta !== null) this.ways.push(here * 1000 - (d.t * 1000 - this.theta));
    this.stream.push({ t: d.t, yaw: num(d.yaw), pitch: num(d.pitch), twist: num(d.twist), s: [num(s[0]), num(s[1]), num(s[2])] }, here);
  }

  // the phone's state for this frame, played back smoothly
  read(now) { return this.stream.read(now); }

  get delay() { return this.stream.delay; }

  // how long a reading takes to arrive, and whether it goes straight across the wifi or round through a relay server
  async ping() {
    if (!this.paired) { this.lag = null; this.route = ''; return; }
    this.send({ k: 'ping', t: performance.now() });
    const pc = this.conn.peerConnection;
    if (!pc?.getStats) return;
    try {
      const stats = await pc.getStats();
      let pair = null;
      stats.forEach(r => { if (r.type === 'candidate-pair' && (r.nominated || r.selected) && r.state === 'succeeded') pair = r; });
      const local = pair && stats.get(pair.localCandidateId), remote = pair && stats.get(pair.remoteCandidateId);
      if (local && remote) this.route = local.candidateType === 'relay' || remote.candidateType === 'relay' ? 'relayed' : 'direct';
    } catch (e) {}
  }

  // the last second's numbers for the lag monitor. the typical trip also feeds lag compensation, so it knows how far to guess
  stats() {
    const trips = this.trips, ways = this.ways, way = quantile(ways, 0.5);
    if (way !== null) this.stream.extra = Math.min(Math.max(way, 0), 50) / 1000;
    const out = {
      paired: this.paired, route: this.route, synced: this.theta !== null, phone: this.phone,
      trip: trips.length ? { min: Math.min(...trips), avg: trips.reduce((a, b) => a + b, 0) / trips.length, max: Math.max(...trips) } : null,
      way: ways.length ? { p50: way, p90: quantile(ways, 0.9), max: Math.max(...ways) } : null,
      buffer: this.stream.takeCount(),
    };
    this.trips = [];
    this.ways = [];
    return out;
  }

  takeTap() { return this.taps.length ? this.taps.shift() : null; }

  // opens a link to a friend's game, on their laptop's pairing id. messages there must arrive, and in order
  callFriend(id) {
    return this.peer?.open ? this.peer.connect(id, { serialization: 'json', reliable: true, metadata: { role: 'friend' } }) : null;
  }

  send(msg) { if (this.paired) this.conn.send(msg); }

  // what the phone shows: the current question and the buttons that answer it
  menu(m) {
    const key = JSON.stringify(m);
    if (key === this.sent || !this.paired) return;
    this.sent = key;
    this.send({ k: 'menu', ...m });
  }

  buzz(ms) { this.send({ k: 'buzz', ms }); }

  qr() {
    const q = qrcode(0, 'M');
    q.addData(this.url);
    q.make();
    return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true, alt: 'Pairing code for your phone' });
  }
}
