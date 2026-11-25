// irons the network's bumps out of the phone's readings. they're played back a few milliseconds late, gliding between
// readings, so the paddle moves evenly at any frame rate even when wifi delivers them in clumps
const HISTORY = 2, KEEP = 0.6;
// cover: the delay waits for all but the latest few readings. gap: and for this share of the usual gap between readings.
// ahead: how far past the newest reading it will carry on before holding still.
// drift: the playhead runs this much fast or slow to stay on schedule, and only jumps when it's snap seconds off.
// lead: the furthest ahead lag compensation will guess. trend: how far back it looks to see which way the phone is turning.
// mend: how quickly a correction fades in when late readings show the paddle had guessed wrong, instead of jumping there
// cover and the cap are kept low on purpose. measured on real home wifi, chasing the slowest readings cost 50 ms of lag all the time
// to smooth over hiccups the playback can't cover anyway, so instead it guesses through them and eases the correction in
const TUNING = { cover: 0.6, gap: 0.3, minDelay: 0.004, maxDelay: 0.025, margin: 0.002, easeDown: 0.02, ahead: 0.035, drift: 0.25, snap: 0.12, lead: 0.06, trend: 0.033, mend: 0.08 };

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
// trusts a guessed speed only as far as the long and the short look agree, so it lets go the moment the phone slows
const agree = (a, b) => a * b <= 0 ? 0 : Math.abs(a) < Math.abs(b) ? a : b;
const fresh = () => ({ n: 0, reads: 0, starved: 0, reorder: 0, dup: 0, gap: 0 });

function quantile(list, q) {
  const s = list.slice().sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0;
}

export class Playout {
  constructor(tuning = {}) {
    this.o = { ...TUNING, ...tuning };
    this.buf = [];
    this.offsets = [];
    this.lates = [];
    this.offset = null;
    this.delay = 0.02;
    this.gap = 1 / 60;
    this.head = null;
    this.lastHere = 0;
    this.arrived = 0;
    // lag compensation: the share of the known lag (this playback delay plus extra, the time before a reading lands) to guess ahead
    this.predict = 0;
    this.extra = 0;
    this.count = fresh();
    // the last frame's playhead and the aim worked out for it, and the share of what's shown that's still being eased in
    this.prev = null;
    this.mending = { yaw: 0, pitch: 0 };
  }

  // s.t is on the phone's clock, here on this computer's, both in seconds
  push(s, here) {
    const gapNow = here - s.t, b = this.buf, c = this.count;
    if (b.length && Math.abs(s.t - b[b.length - 1].t) > 5) this.restart();
    // the quickest reading of the last couple of seconds shows how the two clocks line up
    this.offsets.push({ at: here, o: gapNow });
    while (here - this.offsets[0].at > HISTORY) this.offsets.shift();
    this.offset = Math.min(...this.offsets.map(q => q.o));
    this.lates.push({ at: here, v: gapNow - this.offset });
    while (here - this.lates[0].at > HISTORY) this.lates.shift();
    if (this.arrived) c.gap = Math.max(c.gap, here - this.arrived);
    this.arrived = here;
    c.n++;

    // wifi can deliver out of order. a reading that's already in is dropped
    let i = b.length;
    while (i > 0 && b[i - 1].t > s.t) i--;
    if (i > 0 && b[i - 1].t === s.t) { c.dup++; return; }
    if (i < b.length) c.reorder++;
    b.splice(i, 0, s);
    while (b.length > 2 && b[b.length - 1].t - b[0].t > KEEP) b.shift();
    if (i === b.length - 1 && i > 0) this.gap += (clamp(s.t - b[i - 1].t, 0.002, 0.05) - this.gap) * 0.1;

    // rises at once when readings start arriving late, and settles back slowly once they're on time again
    const o = this.o, want = clamp(quantile(this.lates.map(q => q.v), o.cover) + this.gap * o.gap + o.margin, o.minDelay, o.maxDelay);
    this.delay = want > this.delay ? want : this.delay + (want - this.delay) * o.easeDown;
  }

  restart() {
    this.buf.length = 0;
    this.offsets.length = 0;
    this.lates.length = 0;
    this.head = null;
    this.prev = null;
    this.mending = { yaw: 0, pitch: 0 };
  }

  // where the phone pointed at moment t on its clock: between readings it slides, past the newest it carries on a little, then holds
  at(t) {
    const b = this.buf, last = b[b.length - 1];
    let a = b[0], c = b[0], f = 0;
    if (t >= last.t) {
      a = b.length > 1 ? b[b.length - 2] : last;
      c = last;
      f = a === c ? 0 : 1 + Math.min(t - last.t, this.o.ahead) / (c.t - a.t);
    } else if (t > b[0].t) {
      let i = b.length - 1;
      while (b[i - 1].t > t) i--;
      a = b[i - 1];
      c = b[i];
      f = (t - a.t) / (c.t - a.t);
    }
    // carrying on past the newest reading only follows smooth aiming. the twist stays where it was
    const span = c.t - a.t || 1;
    return {
      yaw: a.yaw + (c.yaw - a.yaw) * f, pitch: a.pitch + (c.pitch - a.pitch) * f, twist: a.twist + (c.twist - a.twist) * Math.min(f, 1),
      rate: { yaw: (c.yaw - a.yaw) / span, pitch: (c.pitch - a.pitch) / span },
    };
  }

  // where the phone points as of a moment slightly in the past, so it glides. swings skip that wait:
  // the newest reading and the hardest swing of the last moment come straight through, since a flick is over in a blink
  read(here, window = 0.25) {
    const b = this.buf;
    if (!b.length) return null;
    const o = this.o, target = here - this.offset - this.delay, dt = this.lastHere ? clamp(here - this.lastHere, 0, 0.1) : 0;
    this.lastHere = here;
    const snapped = this.head === null || Math.abs(target - this.head - dt) > o.snap;
    if (snapped) this.head = target;
    else this.head += dt + clamp(target - this.head - dt, -dt * o.drift, dt * o.drift);

    const t = this.head, last = b[b.length - 1], p = this.at(t), m = this.mending;
    this.count.reads++;
    if (t > last.t) this.count.starved++;
    // readings that land late can move where the paddle should have been. that's a correction, not the player moving,
    // so rather than jump it fades in. a playhead that had to skip ahead after a freeze fades across the same way
    if (this.prev) {
      const was = this.at(this.prev.t), from = snapped ? this.at(this.prev.t + dt) : null, fade = Math.exp(-dt / o.mend);
      for (const k of ['yaw', 'pitch']) {
        m[k] = (m[k] - (was[k] - this.prev[k]) - (from ? p[k] - from[k] : 0)) * fade;
        p[k] += m[k];
      }
    }
    this.prev = { t, yaw: p.yaw - m.yaw, pitch: p.pitch - m.pitch };
    // lag compensation: carry the aim on by the lag, at the speed the phone has been turning. arms move smoothly, so a short guess holds.
    // both speeds are measured across the gliding playback rather than between raw readings, so the guess never jumps
    const lead = Math.min(o.lead, this.predict * (this.delay + this.extra));
    if (lead > 0) {
      const long = this.at(t - o.trend), short = this.at(t - o.trend / 2);
      for (const k of ['yaw', 'pitch']) p[k] += agree((p[k] - long[k]) / o.trend, (p[k] - short[k]) * 2 / o.trend) * lead;
    }
    let peak = last.s, top = -1;
    for (let i = b.length - 1; i >= 0 && b[i].t > last.t - window; i--) {
      const q = b[i].s, m = Math.hypot(q[0], q[1], q[2]);
      if (m > top) { top = m; peak = q; }
    }
    return {
      t, lead, ...p,
      swing: { x: last.s[0], y: last.s[1], z: last.s[2] }, peak: { x: peak[0], y: peak[1], z: peak[2] },
      age: here - this.arrived,
    };
  }

  // what happened since it was last asked: readings in, how many arrived out of order or twice, the longest wait between them,
  // and how often playback ran past the newest reading
  takeCount() {
    const c = this.count;
    this.count = fresh();
    return { ...c, delay: this.delay };
  }
}
