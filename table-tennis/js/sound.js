// every sound is synthesised, so there are no audio files to load
export class Sound {
  constructor() {
    this.ctx = null;
    this.wake = this.wake.bind(this);
    addEventListener('pointerdown', this.wake);
    addEventListener('keydown', this.wake);
  }

  wake() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx ??= new AC();
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  knock(freq, gain, length) {
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    const t = c.currentTime, o = c.createOscillator(), g = c.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.55, t + length);
    g.gain.setValueAtTime(Math.min(gain, 0.5), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + length);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + length);
  }

  play(e) {
    if (e.type === 'hit') this.knock(e.who === 0 ? 1050 : 820, 0.16 + e.speed * 0.016, 0.07);
    else if (e.type === 'bounce') {
      const loud = Math.min(e.speed / 8, 1);
      if (e.on === 'table') this.knock(1500, 0.05 + loud * 0.16, 0.05);
      else if (e.on === 'net') this.knock(340, 0.08 + loud * 0.1, 0.09);
      else this.knock(620, 0.03 + loud * 0.07, 0.05);
    } else if (e.type === 'point') {
      this.knock(e.winner === 0 ? 880 : 300, 0.14, 0.22);
    }
  }
}
