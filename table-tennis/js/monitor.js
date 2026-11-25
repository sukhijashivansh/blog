// the lag monitor. once a second it times how long a phone reading takes to reach a frame on this screen, and each step on the way:
// the phone's sensors, the trip over wifi, the playback buffer and the frames themselves. when the game runs locally it also
// reports each second to the dev server, so the numbers can be watched from outside the browser
const ms = v => (v === null || v === undefined || !Number.isFinite(v) ? '–' : `${Math.round(v)} ms`);
const tenth = v => (Number.isFinite(v) ? `${v.toFixed(1)} ms` : '–');
const median = list => { const s = list.slice().sort((a, b) => a - b); return s.length ? s[s.length >> 1] : null; };
const quantile = (list, q) => { const s = list.slice().sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : null; };
const COMP = { 0: 'off', 0.5: 'half', 1: 'full' };

export class Monitor {
  constructor(el, { show = false, report = false } = {}) {
    this.el = el;
    this.report = report;
    this.el.hidden = !show;
    this.since = 0;
    this.reset();
  }

  reset() {
    this.frames = [];
    this.lags = [];
    this.shown = [];
    this.update = 0;
    this.render = 0;
  }

  toggle() { this.el.hidden = !this.el.hidden; }

  // ms is the frame's time. theta lines the phone's clock up with this one, once the link has worked it out
  frame(ms, dt, state, theta, update, render) {
    this.frames.push(dt * 1000);
    this.update += update;
    this.render += render;
    if (!state || theta === null || state.age > 0.25) return;
    const lag = ms - (state.t * 1000 - theta);
    this.lags.push(lag);
    this.shown.push(lag - state.lead * 1000);
  }

  tick(ms, link, ratio) {
    if (!this.since) this.since = ms;
    if (ms - this.since < 1000) return;
    const f = this.frames, n = f.length || 1, mid = median(f), net = link.stats();
    const r = {
      at: new Date().toISOString(), comp: link.stream.predict,
      lag: this.lags.length ? { p50: median(this.lags), p90: quantile(this.lags, 0.9), shown: median(this.shown) } : null,
      fps: f.length * 1000 / (ms - this.since), frame: { p50: mid, p99: quantile(f, 0.99), long: f.filter(x => x > mid * 1.5).length },
      work: { update: this.update / n, render: this.render / n }, ratio, ...net,
    };
    this.since = ms;
    this.reset();
    if (!this.el.hidden) this.show(r);
    if (this.report) navigator.sendBeacon('/stats', JSON.stringify(r));
  }

  show(r) {
    const p = r.phone, t = r.trip, w = r.way, b = r.buffer;
    this.el.textContent = [
      `reading → frame  ${r.lag ? `${ms(r.lag.p50)}, p90 ${ms(r.lag.p90)}` : '–'}${r.comp && r.lag ? `, ${ms(r.lag.shown)} with compensation` : ''}  (+ the screen's own delay)`,
      `compensation     ${COMP[r.comp] ?? r.comp}  (P to change)`,
      `phone            ${p ? `${p.hz} readings/s, longest gap ${ms(p.gap)}, page busy ${tenth(p.wait)}` : '–'}`,
      `wifi             ${t ? `round trip ${ms(t.avg)} (max ${ms(t.max)})` : '–'}${w ? `, reading lands after ${ms(w.p50)} (p90 ${ms(w.p90)})` : ''}${r.route ? `, ${r.route}` : ''}`,
      `buffer           ${ms(b.delay * 1000)}, ran dry ${b.reads ? Math.round(100 * b.starved / b.reads) : 0}%, longest gap ${ms(b.gap * 1000)}, ${b.reorder} out of order`,
      `screen           ${Math.round(r.fps)} fps, slowest ${tenth(r.frame.p99)}, ${r.frame.long} long, work ${r.work.update.toFixed(1)} + ${r.work.render.toFixed(1)} ms, ${r.ratio}x`,
    ].join('\n');
  }
}
