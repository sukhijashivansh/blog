// light or dark, set before anything is drawn: the look picked on the phone, or else this device's own setting.
// the game page and the phone page both load it
(() => {
  let pick = null;
  try { pick = localStorage.getItem('tt.theme'); } catch (e) {}
  const dark = pick === 'dark' || (pick !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
})();
