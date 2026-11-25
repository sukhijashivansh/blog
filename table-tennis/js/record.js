// a player's record and how a finished match adds to it. it has no sign-in parts, so the tests can check it on its own
export const blank = () => ({ played: 0, won: 0, pointsWon: 0, pointsLost: 0, bestRally: 0, fastest: 0, levels: {}, score: 0 });

// league points for the leaderboard: a win is worth more the harder the level, so climbing beats grinding easy matches
export const WORTH = { Beginner: 1, Club: 3, Pro: 6 };
export const points = levels => Object.entries(WORTH).reduce((a, [k, w]) => a + w * (levels[k]?.won || 0), 0);

const count = v => (Number.isInteger(v) && v >= 0 ? v : 0);

// only the fields a record has, with anything missing or broken read as zero
export function clean(d = {}) {
  const levels = {};
  for (const [k, v] of Object.entries(d.levels || {})) if (WORTH[k] && v && typeof v === 'object') levels[k] = { played: count(v.played), won: Math.min(count(v.won), count(v.played)) };
  const r = { played: count(d.played), won: count(d.won), pointsWon: count(d.pointsWon), pointsLost: count(d.pointsLost), bestRally: count(d.bestRally), fastest: Number.isFinite(d.fastest) && d.fastest > 0 ? d.fastest : 0, levels, score: points(levels) };
  r.won = Math.min(r.won, r.played);
  return r;
}

// m: { level, won, pointsWon, pointsLost, longest, fastest } for one finished match
export function fold(r, m) {
  if (!WORTH[m.level]) return r;
  const lv = r.levels[m.level] || { played: 0, won: 0 }, win = m.won ? 1 : 0, levels = { ...r.levels, [m.level]: { played: lv.played + 1, won: lv.won + win } };
  return {
    played: r.played + 1, won: r.won + win,
    pointsWon: r.pointsWon + count(m.pointsWon), pointsLost: r.pointsLost + count(m.pointsLost),
    bestRally: Math.max(r.bestRally, count(m.longest)), fastest: Math.max(r.fastest, Math.round((m.fastest || 0) * 10) / 10),
    levels, score: points(levels),
  };
}

// a short line for the corner of the screen
export function describe(r) {
  if (!r.played) return 'No matches yet';
  return `${r.score} league points · ${r.won} of ${r.played} won · best rally ${r.bestRally}`;
}
