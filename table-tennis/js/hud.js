import { NEAR, clamp } from './config.js';

const $ = id => document.getElementById(id);

// a phone drawn in the prompt, so the instructions show what to do rather than describe it
const PHONE = '<svg viewBox="0 0 54 64" aria-hidden="true"><path fill-rule="evenodd" d="M18 4h18a6 6 0 0 1 6 6v44a6 6 0 0 1-6 6H18a6 6 0 0 1-6-6V10a6 6 0 0 1 6-6Zm-2 6v42h22V10Z"/></svg>';

export class Hud {
  constructor() {
    this.text = { title: '', sub: '' };
    this.list = [];
    this.said = '';
    this.flashT = 0;
    this.cards = new Map();
  }

  say(title, sub = '', demo = '') {
    const key = `${title}|${sub}|${demo}`;
    if (key === this.said) return;
    this.said = key;
    this.text = { title, sub };
    $('title').textContent = title;
    $('title').hidden = !title;
    $('sub').textContent = sub;
    $('sub').hidden = !sub;
    const d = $('demo');
    d.className = demo;
    d.innerHTML = demo ? PHONE : '';
    this.showPrompt();
  }

  showPrompt() {
    $('prompt').hidden = $('title').hidden && $('sub').hidden && !this.cards.size;
  }

  // the options on offer. they're answered by tapping on the phone, which shows the same list
  choices(list = []) {
    const box = $('choices');
    box.textContent = '';
    this.cards.clear();
    this.list = list;
    for (const c of list) {
      const el = document.createElement('div');
      el.className = 'choice';
      el.innerHTML = `<b>${c.label}</b><small>${c.note}</small>`;
      box.append(el);
      this.cards.set(c.n, el);
    }
    box.hidden = !list.length;
    this.showPrompt();
  }

  pips(done, total) {
    const box = $('pips');
    box.hidden = !total;
    if (box.children.length !== total) box.innerHTML = '<i></i>'.repeat(total);
    [...box.children].forEach((p, i) => p.classList.toggle('on', i < done));
  }

  meter(f) {
    $('meter').hidden = f <= 0;
    $('fill').style.width = `${clamp(f, 0, 1) * 100}%`;
  }

  hint(text = '') {
    if ($('hint').textContent !== text) $('hint').textContent = text;
    $('hint').hidden = !text;
  }

  flash(text, secs = 1.6, good = false) {
    const c = $('call');
    c.textContent = text;
    c.hidden = false;
    c.classList.toggle('good', good);
    this.flashT = secs;
  }

  tick(dt) {
    if (this.flashT > 0 && (this.flashT -= dt) <= 0) $('call').hidden = true;
  }

  board(game) {
    const m = game.match;
    if (!m) return;
    $('pYou').textContent = m.score[NEAR];
    $('pCpu').textContent = m.score[1];
    $('gYou').textContent = m.games[NEAR];
    $('gCpu').textContent = m.games[1];
    $('sYou').hidden = m.server !== NEAR;
    $('sCpu').hidden = m.server === NEAR;
    $('info').textContent = `${game.level.name} · Best of ${m.bestOf}${m.deuce ? ' · Deuce' : ''}`;
  }
}
