(() => {
  'use strict';
  if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));

  const btn = document.getElementById('installBtn'), tip = document.getElementById('installTip');
  const installed = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (installed) return;

  let deferred = null;
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; btn.hidden = false; });
  addEventListener('appinstalled', () => { deferred = null; btn.hidden = tip.hidden = true; });

  // iOS never fires beforeinstallprompt; the only route is Safari's Share sheet.
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios) btn.hidden = false;

  btn.addEventListener('click', async () => {
    if (deferred) {
      const e = deferred; deferred = null;
      btn.hidden = true;
      e.prompt();
      return;
    }
    tip.hidden = !tip.hidden;
  });
})();
