// vercel's visitor counts, for the project's analytics page. no cookies, and only on the live site:
// run locally there's nothing to load it from
if (!['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
  document.head.append(Object.assign(document.createElement('script'), { src: '/_vercel/insights/script.js', defer: true }));
}
