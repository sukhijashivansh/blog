# Klak Forest: the physics

Everything that moves in Klak Forest (twigshot) is simulated in `game.js` with small, hand-tuned models: no physics engine. This file walks through each one, with the real constants, so you can read the code next to it or retune it.

Units: metres, seconds, radians. "Spring k / damping c" means the classic damped spring `a = k·(target − x) − c·v`. Most smoothing uses frame-rate-independent easing, `x += (target − x) · (1 − e^(−rate·dt))`, so it behaves the same at 30 or 120 fps. A frame step is capped at 34 ms so a stutter can't explode anything.

---

## 1. The shot

### Launch (`computeLaunch`, `fire`)
- Pulling back gives a draw strength `n.len` from 0 to 1.
  - **Slingshot view:** pulling sideways and down aims, mapped to a point on screen.
  - **First-person view:** the stone always flies at the crosshair, and holding Fire builds the draw over **0.7 s**.
- The aim point is projected **62 m** into the scene; the stone flies from the pouch toward it.
- Launch speed:

| View | Weak draw | Full draw |
| --- | --- | --- |
| Slingshot | 50 m/s | 86 m/s |
| First person | 58 m/s | 90 m/s |

A loaded fireball goes 5% faster.

### Flight (`updateShots`)
- Plain ballistics with gravity **G = 15.5 m/s²**, a bit stronger than Earth so the drop is readable at these ranges. Each frame: `v.y −= G·dt`, then `p += v·dt`.
- The stone grows from 0.1 to 0.3 in scale over its first 0.2 s, because it starts right under the lens.
- Its motion-blur streak is as long as the blur a fast stone would leave: `min(speed·0.045, 3.2)` m.
- The aim guide (`updateGuide`) runs the same integrator ahead in 17 ms steps, but only draws the first stretch. Judging the drop is the game.

### Aim assist
For the first **1.6 s** of flight, each frame:
1. For every target ahead, predict where the stone and the target will be when the stone reaches the target's depth. Only look up to **1.4 s** ahead, and include gravity's drop on the stone.
2. If the predicted miss is under **2.6 m + 1.4 × the target's radius**, steer toward the nearest such target.
3. The steering velocity change is `(miss vector) / time-to-arrive`, blended in at a rate of `1 − e^(−6·dt)`.

The result: near misses curve in, and clear misses stay misses.

### Hitting things
- **Swept test:** each frame the stone moves from `prev` to `p`, and a hit is any target whose centre is within `target radius × hitScale + stone radius` of that segment (`segDist`). Fast stones can't tunnel through birds.
- **Stone radius:** 0.36 m; the fireball's is 0.5 m.
- **Forgiveness:** `hitScale` eases from **1.9× at level 1 to 1.45× by level 9**.
- **Pierce:** a draw over 93% punches through one target and keeps flying.

### Banking off trunks
- Trunks are vertical cylinders. On contact, the velocity's component into the trunk is reflected: `v −= 1.72·(v·n)·n`, which is a restitution of 0.72. Then the whole velocity is scaled by **0.82**.
- The stone is pushed back to the surface, so it can't stick inside.
- A stone may bank **twice**; a third trunk kills it. Any hit after a bank scores **double**.
- After a bank the stone ignores trunks for 80 ms, so it can't double-collide.

### Spent stones (`spendStone`, `updateProps`)
After a hit, a stone keeps a fraction of its velocity:

| Event | Velocity kept |
| --- | --- |
| Hitting a target | −0.16 (bounces back) |
| Dying on a third trunk | −0.14 |
| Landing on the ground | 0.34 |

It also gets a random upward kick of 2–4.5 m/s and some spin. On the ground:
- gravity is **13.5 m/s²** and air drag decays velocity as `e^(−0.25·dt)`;
- on touching the ground, vertical restitution is **0.36**, horizontal friction keeps **0.6**, and spin halves;
- it settles below 0.9 m/s, then shrinks away.

---

## 2. The slingshot itself

### Latex bands (`stepBand`)
Each band is a **10-point Verlet chain** from the fork tip to the pouch:
- Velocity is implicit, as `(p − p_prev)·0.94` (6% damping per step), plus a light gravity of 2.8 m/s².
- **6 constraint passes** per frame stop any segment growing past its rest length. The rest length is the larger of the current tip-to-pouch distance and **0.45 m**, so a slack band sags and a stretched one goes taut.
- The tube thins as it stretches: `radius = 0.019·√(0.45 / length)`, clamped. That's what rubber does as volume is conserved.

### Pouch (`updateSling`)
- **While drawing:** the pouch eases to the pull position at rate 34. Past 80% draw a small noise shake comes in: the hand straining.
- **On release:** a stiff spring, **k = 520, c = 21**, with 3 substeps per frame for stability. It snaps through the fork and rings out.

### Fork
The fork is a damped spring on its pitch, **k = 300, c = 11**, toward `pull × 0.15`. It bends back as you draw and shivers after the shot; firing gives it an extra kick of `−(0.8 + 3.6·draw)`.

### Moving along the rail
- The player strafes on a **±9 m** rail. Arrow keys move at 15 m/s.
- **Tilt:** past a 2.5° dead zone, slide speed is `min(26, 0.85·m + 0.05·m²)` m/s, where `m` is the extra tilt in degrees. More tilt means faster.
- **Weight:** the body follows the target through a spring, **k = 169, c = 26**, with speed capped at 34 m/s. It eases into a step and out of it.
- **Footsteps:** the camera bobs with a stride phase advanced by speed.

### Camera
- **Recoil:** a spring, **k = 280, c = 24**, kicked on every shot.
- **Shake:** noise scaled by `shake²`, decaying at 2.4 per second.
- **Lean:** the camera leans into sidesteps.
- **Zoom:** at full draw the field of view narrows by 1.7°, like leaning into the shot.

---

## 3. Birds

### Flight model (`flyBird`)
Each bird steers toward a moving target point with simple acceleration control:
- **Horizontal:** `ax = (wantVx − vx)·resp·0.7 + downstroke thrust`, where `wantVx = cruise speed × surge`.
- **Vertical:** `ay = (wantVy − vy)·resp + downstroke lift`, where `wantVy = (target height − y)·climb`, clamped to ±vyMax.
- **Depth:** `az = (wantVz − vz)·resp·0.6`.
- **Downstroke:** each beat adds `sin(beat) × power` of thrust and lift, so the bird surges on each flap.
- **Bounding (Parrot):** it alternates flapping with closed-wing coasting, falling at 9.5 m/s² on a ballistic arc. That's the bounding flight of small birds.
- **Banking:** the bird rolls into turns from its yaw rate: `roll → −yawRate·bank·1.9`, clamped to ±1.05.
- **Pitch:** the body pitches with vertical acceleration: `aoa → ay·0.016`.
- **Flight band:** birds stay between 3.2 m and 17.6 m of height.

| Bird | Cruise speed | Response | Climb | Max vertical | Gait |
| --- | --- | --- | --- | --- | --- |
| Parrot (10 pts) | 5–7.5 m/s | 5.5 | 2.6 | 5.5 m/s | bound: flap 0.3–0.58 s, coast 0.16–0.3 s |
| Flamingo (25 pts) | 8–11 m/s | 6.5 | 3.6 | 8 m/s | scythe: picks a new point every 0.8–1.6 s ("jinks") |
| Stork (40 pts, 2 hits) | 4–5.5 m/s | 2.4 | 1.4 | 3.2 m/s | soar: long glides |

- **Levels:** cruise speed rises with level by up to **×1.4**.
- **Wing animation:** the model's own flap clip plays faster on the climb (Parrot 2.1×, Flamingo 1.7×, Stork 1.1×) and drops to 0.08× in a glide.

### Getting hit (`hitTarget`, `knockBird`, `updateTumbling`)
- **Stork's first hit:** knocked 8 m/s along the shot and 2.6 m/s upward, rolls hard, panics, and flies on **34% faster**.
- **A finishing hit:**
  - The bird keeps 36% of its velocity, plus 14% of the stone's, or a 13 m/s radial push from a fireball.
  - It's thrown up 2–4.5 m/s and spun at 7–13 rad/s.
  - While stunned: air drag `e^(−0.85·dt)`, gravity 14 m/s², the spin applied as an axis-angle rotation each frame, and feathers shed every 80 ms.
- **Recovery:** after 0.62–0.95 s, or when it nears the ground, it rights itself. It slerps upright at rate 9 and blends toward `(1.25 × cruise speed, 7.5 m/s up)` at rate 3.2, then flees the scene.

---

## 4. Eggs

- **Tossed eggs:** a ballistic arc under g = **9.5**. The launch speed is solved so the egg crosses the view in the chosen flight time: `vy = g·T/2`, `vx = distance/T`.
- **Dropped eggs** (laid by a flying bird): fall under g = 7.
- **Spin:** an egg's spin axis slowly precesses (rotated 0.7 rad/s about vertical), like an egg's lopsided weight making it wobble.
- **Nest eggs:**
  - Fall in at 17 m/s², bounce once with restitution 0.32, then sit on a **rocking spring**: `rockV += (−52·rock − 3.6·rockV)·dt`.
  - In their last 1.7 s, a growing 9.5 Hz shove works them loose until they tip out of the nest and fall.
- **Breaking** (`breakEgg`): the shell splits into two halves.
  - Each half keeps 30% of the egg's velocity, plus the stone's push, plus 2.6–4.6 m/s outward along its axis.
  - Then they bounce and settle as props (section 1).
  - Yolk: one heavy blob plus a few thin drops. Each stretches along its velocity (`k = 1 + min(speed·0.035, 0.5)`, with width shrinking by √k so its volume holds), then flattens into a splat on landing.

---

## 5. Fireball

- Every **8 hits** loads a fireball.
- It explodes on any target, trunk or the ground. Everything within **7.4 m** takes a blast hit, which counts as 2 damage.
- **Shockwave** (`updateWind`): a ring that expands at **30 m/s** with strength 2.4, decaying as `e^(−2.8·t)`.
  - The grass, leaf and canopy shaders push vertices outward by a Gaussian band around the ring's edge: `push ∝ exp(−((distance − radius)/3.4)²) × strength`.
  - That's why the meadow flattens in a travelling ring.

---

## 6. Wind and vegetation (GPU)

All of this runs in vertex shaders (`WIND_GLSL`, `WIND_BODY`, `canopyify`), so tens of thousands of grass clumps cost almost nothing on the CPU.

- **Gusts** (CPU, `updateWind`):
  - Every 2.4–7 s a new gust target is picked: 30% of the time a strong one (1.1–1.7), otherwise light (0.15–0.7).
  - The target itself decays at 0.18 per second, and the live gust value chases it at rate 1.4.
  - The ambient wind sound's filter follows it.
- **Gust front** (GPU): a travelling sine band, `0.5 + 0.5·sin(p·windDir·0.085 − 0.72·t + wobble)`, cubed. Gusts roll across the forest as a visible wave instead of everything moving in sync.
- **Tree sway:** the offset grows with height squared, `(h/30)²`, so trunks stay planted and crowns move. Two sine layers plus the gust front.
- **Twig flutter:** each twig adds its own two-frequency flutter (2.6 and 4.1 rad/s), seeded by its position, so neighbours don't move together.
- **Grass blades and clumps:** bend grows with the square of height up the blade or clump. The tip is pushed downwind and dips slightly: `y −= (0.05 to 0.06)·gust·bend²`.
- **Falling leaves** (`updateAir`): a leaf sinks fastest at the bottom of each side-to-side swing, `fall speed × (0.62 + 0.5·cos²φ)`, while slipping sideways with `sin φ`. That's the falling-leaf motion, plus wind drift.
- **Feathers** (`updateDebris`, flutter mode): thrown and tumbling at first, then once their speed drops below about 2.2–6 m/s the air takes over and they rock flat, drifting with the wind.

---

## 7. Debris, sparks and smoke

- **Debris** (bark chips, shell, dirt, feathers): explicit Euler integration with per-type drag `e^(−drag·dt)` and gravity.
  - On touching the ground: restitution 0.34, or 0 for yolk and feathers, which just land. Friction keeps 0.55.
  - Debris rests below 0.6 m/s and fades out.
- **Sparks:** ballistic points with their own gravity, shrinking over their lifetime.
- **Smoke:** drag `e^(−2.6·dt)`, rising and spreading as it fades.

---

## 8. Light, for completeness

Not physics as such, but physically based:
- **Sky:** a real HDR sky photo lights the scene through image-based lighting.
- **Sun:** the game finds the sun in the photo (the brightest pixel), and the shadow-casting light points from there. The sky is rotated so the sun comes in from the right.
- **Materials:** physically based (roughness and metalness), from photo-scanned textures. Leaves get almost no specular sheen, plus a soft "sun shining through" term when you look toward the sun.

---

## Where to tune

| Feel | Constant | Where |
| --- | --- | --- |
| Stone drop | `G = 15.5` | game state constants |
| Shot speed | `launch.speed` lerp | `computeLaunch` |
| Forgiveness | `hitScale`, aim-assist `2.6 + t.r·1.4` and `1 − e^(−6·dt)` | shots section |
| Bird pace | `KINDS[*].speed`, `heat()` multiplier 1.4 | birds section |
| Band snap | pouch spring 520 / 21 | `updateSling` |
| Bank bounce | 1.72 reflection, 0.82 loss | `updateShots` trunk loop |
| Wind strength | gust targets, `WIND_BODY` amplitudes | `updateWind`, shaders |
