// forest.shivanshsukhija.com opens the 3D game at its root; everything else on the domain is served as files.
// Static files win over vercel.json rewrites, so the root has to be rewritten here, before the file lookup.
export const config = { matcher: '/', runtime: 'nodejs' };

export default function middleware(request) {
  const url = new URL(request.url);
  if (url.hostname !== 'forest.shivanshsukhija.com') return;
  return new Response(null, { headers: { 'x-middleware-rewrite': '/forest/' } });
}
