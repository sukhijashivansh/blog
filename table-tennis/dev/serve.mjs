// runs the game from this computer for testing: open http://localhost:8790 and scan the code with your phone.
// the game page posts its lag numbers here once a second. every report goes into a log file, and while a phone is
// connected a summary of the last ten seconds prints here
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = +process.env.PORT || 8790, LOG = process.env.LOG || path.join(os.tmpdir(), 'table-tennis-lag.jsonl'), EVERY = 10;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };

const median = list => { const s = list.slice().sort((a, b) => a - b); return s[s.length >> 1]; };
const vals = (list, f) => list.map(f).filter(Number.isFinite);
const mid = (list, f) => { const v = vals(list, f); return v.length ? Math.round(median(v)) : '-'; };
const top = (list, f) => { const v = vals(list, f); return v.length ? Math.round(Math.max(...v)) : '-'; };
const sum = (list, f) => vals(list, f).reduce((a, b) => a + b, 0);

function summary(list) {
  const r = list.at(-1), clock = new Date().toTimeString().slice(0, 8);
  const dry = Math.round(100 * sum(list, q => q.buffer.starved) / Math.max(1, sum(list, q => q.buffer.reads)));
  return `${clock}  reading→frame ${mid(list, q => q.lag?.p50)} ms (p90 ${mid(list, q => q.lag?.p90)}, compensation ${r.comp}: ${mid(list, q => q.lag?.shown)} ms)`
    + ` | phone ${mid(list, q => q.phone?.hz)}/s, gaps to ${top(list, q => q.phone?.gap)} ms`
    + ` | wifi round trip ${mid(list, q => q.trip?.avg)} ms (max ${top(list, q => q.trip?.max)}), lands after ${mid(list, q => q.way?.p50)} ms (p90 ${mid(list, q => q.way?.p90)}, max ${top(list, q => q.way?.max)}) ${r.route || ''}`
    + ` | buffer ${mid(list, q => q.buffer.delay * 1000)} ms, ran dry ${dry}%, gaps to ${top(list, q => q.buffer.gap * 1000)} ms`
    + ` | screen ${mid(list, q => q.fps)} fps, slowest ${top(list, q => q.frame.p99)} ms, ${sum(list, q => q.frame.long)} long frames`;
}

fs.writeFileSync(LOG, '');
let batch = [], paired = null;

http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/stats') {
    let body = '';
    req.on('data', d => { body += d; if (body.length > 65536) req.destroy(); });
    req.on('end', () => {
      res.writeHead(204).end();
      let r;
      try { r = JSON.parse(body); } catch (e) { return; }
      fs.appendFileSync(LOG, JSON.stringify(r) + '\n');
      if (r.paired !== paired) { paired = r.paired; batch = []; console.log(paired ? 'phone connected' : 'no phone connected'); }
      if (!paired) return;
      batch.push(r);
      if (batch.length >= EVERY) { console.log(summary(batch)); batch = []; }
    });
    return;
  }
  let file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (file.endsWith(path.sep)) file += 'index.html';
  if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1', () => console.log(`game running at http://localhost:${PORT}\nlag log: ${LOG}`));
