// metres, standard ITTF table. x = right, y = up, z = toward you, so your half is z > 0
export const TABLE = { width: 1.525, length: 2.74, height: 0.76, halfW: 0.7625, halfL: 1.37, netH: 0.1525, netHalfW: 0.915 };
export const BALL_R = 0.02;
export const NEAR = 0, FAR = 1;
export const other = who => who === NEAR ? FAR : NEAR;
export const STEP = 1 / 240;
export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const lerp = (a, b, t) => a + (b - a) * t;
export const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// drawn paddle size, used to keep it out of the table
export const BLADE = 0.103, GRIP = 0.22;
// 1 over the table, easing to 0 just past its edge
export const overTable = (x, z) => 1 - sstep(0, BLADE + 0.05, Math.max(Math.abs(x) - TABLE.halfW, Math.abs(z) - TABLE.halfL));
export const paddleFloor = (x, z) => lerp(TABLE.height + 0.06, TABLE.height + BLADE + 0.012, overTable(x, z));
// how far the handle must tip sideways so it can't poke through the surface
export const rollNeeded = (x, y, z) => Math.acos(clamp((y - TABLE.height - 0.032) / GRIP, 0, 1)) * overTable(x, z);

// timeScale slows the whole world a little, so there's time to line up each shot. magnet is how near the ball you have to point
// before the paddle is drawn onto it, and power is the pace above which your shots stop getting much faster. the rest is the opponent
export const LEVELS = {
  1: { name: 'Beginner', timeScale: 0.75, hitRadius: 0.3, magnet: 0.5, power: 8, assist: 1, reaction: 0.24, moveSpeed: 2.1, reach: 0.27, shotSpeed: [5.4, 8], spin: 70, err: 0.07, serveErr: 0.04, attack: 0.3, loop: 0.2, placement: 0.88 },
  2: { name: 'Club', timeScale: 0.86, hitRadius: 0.29, magnet: 0.42, power: 10, assist: 0.97, reaction: 0.14, moveSpeed: 2.9, reach: 0.28, shotSpeed: [8, 11.5], spin: 150, err: 0.017, serveErr: 0.025, attack: 0.55, loop: 0.5, placement: 0.95 },
  3: { name: 'Pro', timeScale: 0.94, hitRadius: 0.25, magnet: 0.36, power: 12.5, assist: 0.94, reaction: 0.13, moveSpeed: 3.4, reach: 0.3, shotSpeed: [7.6, 11.2], spin: 230, err: 0.02, serveErr: 0.012, attack: 0.85, loop: 0.8, placement: 0.97 },
};

// the warm-up opponent: gentle balls down the middle, and it never misses
export const PRACTICE = { err: 0, serveErr: 0, shotSpeed: [3.2, 4.2], placement: 0.3, spin: 8, loop: 0, attack: 0, reach: 0.7, moveSpeed: 3.2, reaction: 0.1 };
