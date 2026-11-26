// when two laptops can't connect to each other directly, as some home, mobile and office networks won't allow, their messages
// go through the game's Firebase realtime database instead. it's slower than a direct link, but it gets through.
// a room is named after the inviter's pairing id, and each laptop writes only under its own side of it: here while it's
// there, its latest paddle as pose, and every other message under m, in order, which the other laptop deletes as it reads
import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js';
import { getDatabase, connectDatabaseEmulator, ref, child, set, push, remove, onValue, onChildAdded, onDisconnect } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-database.js';

// in Singapore, the nearest region to India
const URL = 'https://flickpong-game-default-rtdb.asia-southeast1.firebasedatabase.app';
// the paddle goes through at most this often, half the direct rate, to keep the traffic down
const POSE_EVERY = 1 / 30;
const parse = v => { try { return typeof v === 'string' ? JSON.parse(v) : null; } catch (e) { return null; } };
let db = null;

function database() {
  if (db) return db;
  db = getDatabase(initializeApp({ apiKey: 'AIzaSyAHY1iSkH-SV1S2g_lQAfjL6KxDzL3sydY', projectId: 'flickpong-game', databaseURL: URL, appId: '1:630889402272:web:27094bdbd87b07e5ed1ec5' }, 'relay'));
  // the browser test points it at a local stand-in for the database, given as host:port
  let local = null;
  try { local = ['localhost', '127.0.0.1'].includes(location.hostname) && localStorage.getItem('tt.relay'); } catch (e) {}
  if (local) connectDatabaseEmulator(db, local.split(':')[0], +local.split(':')[1]);
  return db;
}

// one laptop's end of a link through the database. it behaves like a direct link: open once the other laptop is there too,
// data for each message, and close when either one leaves. error means the database couldn't be reached at all
export class RelayLink {
  constructor(room, side) {
    this.relay = true;
    this.open = false;
    this.closed = false;
    this.handlers = {};
    this.early = [];
    this.stops = [];
    this.lastPose = 0;
    this.id = Math.random().toString(36).slice(2, 10);
    const root = ref(database(), `rooms/${room}`);
    this.mine = child(root, side);
    this.theirs = child(root, side === 'host' ? 'guest' : 'host');
    // the inviter clears the whole room first, so nothing left from an earlier invite is taken for a friend
    this.start(side === 'host' ? root : this.mine).catch(e => {
      console.warn('FlickPong: the relay is unavailable', e);
      if (!this.closed) { this.end(false); this.emit('error', e); }
    });
  }

  on(type, fn) { (this.handlers[type] ||= []).push(fn); }

  emit(type, arg) { for (const fn of this.handlers[type] || []) fn(arg); }

  async start(clear) {
    await remove(clear);
    if (this.closed) return;
    await onDisconnect(this.mine).remove();
    if (this.closed) return;
    const here = child(this.mine, 'here');
    // says it's here, and says so again if the inviter clears the room while this end is already in it
    this.stops.push(onValue(here, s => { if (!s.exists() && !this.closed) set(here, this.id).catch(() => {}); }));
    this.stops.push(onValue(child(this.theirs, 'here'), s => {
      if (s.exists() && !this.open && !this.closed) {
        this.open = true;
        this.emit('open');
        for (const d of this.early.splice(0)) this.emit('data', d);
      } else if (!s.exists() && this.open) this.end(true);
    }));
    const take = d => { if (!d) return; if (this.open) this.emit('data', d); else this.early.push(d); };
    this.stops.push(onChildAdded(child(this.theirs, 'm'), s => { take(parse(s.val())); remove(s.ref).catch(() => {}); }));
    this.stops.push(onValue(child(this.theirs, 'pose'), s => take(parse(s.val()))));
  }

  send(msg) {
    if (!this.open || this.closed) return;
    if (msg.k === 'pose') {
      const now = performance.now() / 1000;
      if (now - this.lastPose < POSE_EVERY) return;
      this.lastPose = now;
      set(child(this.mine, 'pose'), JSON.stringify(msg)).catch(() => {});
    } else push(child(this.mine, 'm'), JSON.stringify(msg)).catch(() => {});
  }

  close() { this.end(false); }

  // leaving takes this end's side of the room with it, which is how the other laptop learns it has gone
  end(say) {
    if (this.closed) return;
    this.closed = true;
    this.open = false;
    for (const stop of this.stops) stop();
    this.stops = [];
    onDisconnect(this.mine).cancel().catch(() => {});
    remove(this.mine).catch(() => {});
    if (say) this.emit('close');
  }
}
