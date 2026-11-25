import * as THREE from '../vendor/three.module.js';
import { RoomEnvironment } from '../vendor/RoomEnvironment.js';
import { TABLE, BALL_R, clamp, rollNeeded, paddleFloor } from './config.js';
import { maple, walnut, oak, ash, plies, rubber, sponge, wood, metal } from './materials.js';

// the look: a daylit studio, the way a product shot is lit. a pale maple floor fades into cool white air, so the warmth comes from
// the wood alone. daylight falls soft from the front left, and the table is tournament blue on a walnut and oak frame. guides stay
// vivid and edged in white, so they read on wood and on blue
const HAZE = 0xeef0f3;
const WHITE = 0xffffff, BLUE = 0x1f6bff, GREEN = 0x14b35a, YELLOW = 0xffc21a, NAVY = 0x0f2f6b, RED = 0xa8102a, BLACK = 0x161616;
const TRAIL = 18, BALL_SIZE = 1.5, MAX_SHOWN_SPIN = 34, PADDLE_SCALE = 1.25;
// if frames keep running this much slower than the screen can show them, the picture drops a notch in resolution.
// the screen's pace is the quick end of recent frames, never quicker than 250 a second, so one odd short frame can't set it
const SLOW = 1.4, SLOW_FOR = 60, SETTLE_FRAMES = 120, MIN_RATIO = 1, FASTEST = 1 / 250;
// how far from the blade's centre a ball can be met before the drawn paddle reaches over to it, and how fast that reach fades
const REACH_EDGE = 0.07, REACH_TIME = 0.12;
const CALM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const EYE = { y: 1.74, z: 3.32 }, LOOK = { y: 0.84, z: 0.16 };
const FACE_AWAY = new THREE.Vector3(0, 0, -1), Q = new THREE.Quaternion(), Q2 = new THREE.Quaternion(), N = new THREE.Vector3(), AXIS = new THREE.Vector3();

function box(parent, w, h, d, material, x, y, z, shadow = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

// a real blade: plies of wood with a sheet of rubber on each face and a flared handle. the blade's outline is a little taller
// than wide, and its size matches the paddle the game has always drawn, so reach and table clearance are unchanged
const BLADE = new THREE.Shape();
BLADE.absellipse(0, 0, 0.082, 0.085, 0, Math.PI * 2, false, 0);
const HANDLE = new THREE.Shape();
HANDLE.moveTo(-0.0135, -0.062);
HANDLE.lineTo(-0.0125, -0.118);
HANDLE.quadraticCurveTo(-0.019, -0.163, -0.0145, -0.176);
HANDLE.quadraticCurveTo(0, -0.183, 0.0145, -0.176);
HANDLE.quadraticCurveTo(0.019, -0.163, 0.0125, -0.118);
HANDLE.lineTo(0.0135, -0.062);
HANDLE.closePath();
const CORE = 0.0062, SKIN = 0.0018;

// your paddle marks the screen wherever it's drawn, and the ball's silhouette shows through there and nowhere else
const STAMP = { stencilWrite: true, stencilRef: 1, stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp };

// front faces +z: the camera on your paddle, the net on the opponent's. a stamp goes on every part the paddle is drawn with
function makePaddle(front, back, look, stamp = {}) {
  const g = new THREE.Group(), hidden = new THREE.MeshBasicMaterial({ visible: false }), own = m => (m.setValues(stamp), m);
  const core = new THREE.Mesh(new THREE.ExtrudeGeometry(BLADE, { depth: CORE, bevelEnabled: false, curveSegments: 48 }), [hidden, own(look.edge.clone())]);
  core.position.z = -CORE / 2;
  const sheet = (color, foam, z) => {
    const m = new THREE.Mesh(new THREE.ExtrudeGeometry(BLADE, { depth: SKIN, bevelEnabled: false, curveSegments: 48 }), [own(rubber(color)), own(sponge(foam))]);
    m.position.z = z;
    return m;
  };
  // the handle's faces show its grain and walnut centre strip, and its sides the glued layers, as a real flared handle does
  const handle = new THREE.Mesh(new THREE.ExtrudeGeometry(HANDLE, { depth: 0.016, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.0035, bevelSegments: 3, curveSegments: 16 }), [own(look.handle.clone()), own(look.layers.clone())]);
  handle.position.z = -0.008;
  g.add(core, sheet(front, front === RED ? 0xe2584f : 0x2c2c2c, CORE / 2), sheet(back, back === RED ? 0xe2584f : 0x2c2c2c, -CORE / 2 - SKIN), handle);
  g.traverse(m => { if (m.isMesh) m.castShadow = true; });
  g.scale.setScalar(PADDLE_SCALE);
  return g;
}

// a guide ring, edged in white so it reads against the blue table and the pale floor alike
function ring(inner, outer, color, opacity, onTop = false) {
  const flat = (c, o) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, side: THREE.DoubleSide, depthWrite: false, depthTest: !onTop, fog: false });
  const m = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 48), flat(color, opacity));
  const w = (outer - inner) * 0.6, edge = new THREE.Mesh(new THREE.RingGeometry(Math.max(0, inner - w), outer + w, 48), flat(WHITE, opacity * 0.85));
  m.renderOrder = onTop ? 6 : 1;
  edge.renderOrder = m.renderOrder - 1;
  m.add(edge);
  m.userData.edge = edge;
  return m;
}
const fade = (m, o) => { m.material.opacity = o; m.userData.edge.material.opacity = o * 0.85; };

export class View {
  constructor(canvas) {
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, stencil: true, powerPreference: 'high-performance' });
    this.ratio = Math.min(devicePixelRatio || 1, 2);
    r.setPixelRatio(this.ratio);
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    // neutral tone mapping keeps the table's blue and the rubber's red true to colour, the way a product shot does
    r.toneMapping = THREE.NeutralToneMapping;
    r.toneMappingExposure = 1.04;
    const s = this.scene = new THREE.Scene(), aniso = Math.min(8, r.capabilities.getMaxAnisotropy());
    // one even haze behind everything, so nothing marks where the floor ends. the page lays a soft top light over it
    s.background = new THREE.Color(HAZE);
    // the floor melts into the backdrop well before the horizon, like a photo studio's curved wall
    s.fog = new THREE.Fog(HAZE, 4.5, 15);
    // soft studio reflections on the wood, rubber and metal, worked out once at the start
    const pmrem = new THREE.PMREMGenerator(r);
    s.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    s.environmentIntensity = 0.55;
    pmrem.dispose();
    this.camera = new THREE.PerspectiveCamera(46, 1, 0.05, 40);
    this.camera.position.set(0, EYE.y, EYE.z);
    this.camera.lookAt(0, LOOK.y, LOOK.z);

    // the ground light is the maple floor bouncing back, so it stays a little warm. the daylight itself is close to neutral
    s.add(new THREE.HemisphereLight(0xffffff, 0xd6cbb8, 0.55));
    const sun = new THREE.DirectionalLight(0xfff7ef, 2.3);
    sun.position.set(-2.2, 5, 2.6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    sun.shadow.radius = 3;
    Object.assign(sun.shadow.camera, { left: -2.6, right: 2.6, top: 2.6, bottom: -2.6, far: 12 });
    s.add(sun);
    const fill = new THREE.DirectionalLight(0xe4ecff, 0.35);
    fill.position.set(3, 2.5, -2);
    s.add(fill);

    const floorMap = maple(aniso);
    floorMap.repeat.set(107, 54);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ map: floorMap, roughness: 0.38, envMapIntensity: 0.6 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    s.add(floor);
    this.buildTable(s, aniso);

    this.ballMesh = new THREE.Group();
    const skin = document.createElement('canvas');
    skin.width = 64; skin.height = 32;
    const g = skin.getContext('2d');
    g.fillStyle = '#ff8a1f'; g.fillRect(0, 0, 64, 32);
    g.fillStyle = '#ffe9d2'; g.fillRect(0, 13, 64, 6);
    const skinMap = new THREE.CanvasTexture(skin);
    skinMap.colorSpace = THREE.SRGBColorSpace;
    const ballGeo = new THREE.SphereGeometry(BALL_R * BALL_SIZE, 24, 16);
    this.ballMesh.add(new THREE.Mesh(ballGeo, new THREE.MeshPhysicalMaterial({ map: skinMap, roughness: 0.34, clearcoat: 0.25, clearcoatRoughness: 0.3 })));
    // your paddle is solid now, so where it hides the ball a soft silhouette of the ball shows through it. only through it:
    // a ball dropping behind the table stays hidden, as it always was
    const ghost = new THREE.Mesh(ballGeo, new THREE.MeshBasicMaterial({ color: 0xff8a1f, transparent: true, opacity: 0.5, depthWrite: false, depthFunc: THREE.GreaterDepth, fog: false,
      stencilWrite: true, stencilRef: 1, stencilFunc: THREE.EqualStencilFunc }));
    ghost.scale.setScalar(1.03);
    ghost.renderOrder = 7;
    this.ballMesh.add(ghost);
    s.add(this.ballMesh);

    this.blob = new THREE.Mesh(new THREE.CircleGeometry(BALL_R * 1.7, 20), new THREE.MeshBasicMaterial({ color: 0x1a1206, transparent: true, opacity: 0.3, depthWrite: false }));
    this.blob.rotation.x = -Math.PI / 2;
    s.add(this.blob);

    this.trailPts = new Float32Array(TRAIL * 3);
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(this.trailPts, 3));
    this.trail = new THREE.Line(tg, new THREE.LineBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.6 }));
    this.trail.frustumCulled = false;
    s.add(this.trail);
    this.trailFilled = 0;

    // your paddle shows red towards you and the opponent's shows black, as real paddles carry one of each
    const look = { edge: new THREE.MeshStandardMaterial({ map: plies(CORE), roughness: 0.7 }), handle: wood(ash(aniso)), layers: new THREE.MeshStandardMaterial({ map: plies(0.024), roughness: 0.66 }) };
    look.handle.map.offset.x = 0.5;
    this.near = makePaddle(RED, BLACK, look, STAMP);
    this.far = makePaddle(BLACK, RED, look);
    s.add(this.near, this.far);
    this.reach = ring(0.2, 0.205, NAVY, 0.3);
    this.near.add(this.reach);

    this.landMark = ring(0.035, 0.052, YELLOW, 0.95);
    this.landMark.rotation.x = -Math.PI / 2;
    this.strikeMark = ring(0.04, 0.052, BLUE, 0.95, true);
    this.timeMark = ring(0.05, 0.056, BLUE, 0.7, true);
    this.pop = ring(0.03, 0.04, BLUE, 0, true);
    this.beacons = [ring(0.1, 0.118, GREEN, 0.9, true), ring(0.1, 0.118, GREEN, 0.9, true)];
    for (const b of this.beacons) b.visible = false;
    s.add(this.landMark, this.strikeMark, this.timeMark, this.pop, ...this.beacons);

    this.kick = 0;
    this.kickV = 0;
    this.farKick = 0;
    this.farKickV = 0;
    // if your paddle was still a little off the ball when they met, it's drawn reaching across to it for a moment. so is the
    // other end's, since a friend's paddle is drawn from readings that come over the internet and can trail the ball a little
    this.reachTo = { x: 0, y: 0 };
    this.farReach = { x: 0, y: 0 };
    this.farAt = null;
    this.popT = 0;
    this.nearRoll = 0;
    this.nearSide = 1;
    this.farRoll = 0;
    this.camX = 0;
    this.clock = 0;
    this.pace = { avg: 0, fast: 0, slow: 0, frames: 0, recent: new Float32Array(SETTLE_FRAMES) };

    this.resize = this.resize.bind(this);
    addEventListener('resize', this.resize);
    this.resize();
  }

  buildTable(s, aniso) {
    const { width: W, length: L, height: H, halfW, halfL, netH, netHalfW } = TABLE;
    // the playing surface is matte, as the rules require, in tournament blue
    const top = box(s, W, 0.025, L, new THREE.MeshPhysicalMaterial({ color: 0x163f7d, roughness: 0.6, clearcoat: 0.08, clearcoatRoughness: 0.55 }), 0, H - 0.0125, 0);
    top.castShadow = true;
    const paint = new THREE.MeshStandardMaterial({ color: WHITE, roughness: 0.55 });
    const line = (w, d, x, z) => box(s, w, 0.002, d, paint, x, H + 0.001, z, false);
    line(W, 0.02, 0, halfL - 0.01); line(W, 0.02, 0, -halfL + 0.01);
    line(0.02, L, halfW - 0.01, 0); line(0.02, L, -halfW + 0.01, 0);
    line(0.003, L, 0, 0);

    // a walnut apron under the edge, and four oak legs tied by low stretchers. long boards turn their grain to run along them
    const along = wood(walnut(aniso)), light = wood(oak(aniso)), lightAlong = wood(oak(aniso));
    for (const m of [along, lightAlong]) { m.map.center.set(0.5, 0.5); m.map.rotation = Math.PI / 2; }
    const apron = 0.07, under = H - 0.025;
    for (const x of [-1, 1]) box(s, 0.024, apron, L - 0.24, along, x * (halfW - 0.07), under - apron / 2, 0);
    for (const z of [-1, 1]) box(s, W - 0.14, apron, 0.024, along, 0, under - apron / 2, z * (halfL - 0.12));
    const leg = under - apron;
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(s, 0.06, leg, 0.06, light, x * (halfW - 0.13), leg / 2, z * (halfL - 0.32));
    for (const x of [-1, 1]) box(s, 0.04, 0.05, L - 0.64, lightAlong, x * (halfW - 0.13), 0.14, 0);
    box(s, W - 0.3, 0.05, 0.04, lightAlong, 0, 0.14, 0);

    const c = document.createElement('canvas');
    c.width = c.height = 16;
    const g = c.getContext('2d');
    g.strokeStyle = 'rgba(255,255,255,.85)';
    g.strokeRect(0.5, 0.5, 15, 15);
    const mesh = new THREE.CanvasTexture(c);
    mesh.wrapS = mesh.wrapT = THREE.RepeatWrapping;
    mesh.repeat.set(92, 8);
    const net = new THREE.Mesh(new THREE.PlaneGeometry(netHalfW * 2, netH), new THREE.MeshBasicMaterial({ map: mesh, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    net.position.set(0, H + netH / 2, 0);
    s.add(net);
    box(s, netHalfW * 2, 0.014, 0.004, paint, 0, H + netH - 0.007, 0, false);
    // brushed aluminium posts clamped to the table's edge
    const post = metal();
    for (const x of [-netHalfW, netHalfW]) {
      box(s, 0.016, netH + 0.01, 0.016, post, x, H + netH / 2, 0);
      box(s, 0.03, 0.03, 0.05, post, x - Math.sign(x) * 0.012, H - 0.01, 0);
    }
  }

  resize() {
    const w = innerWidth, h = innerHeight, aspect = w / h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = aspect;
    // keep the whole table in frame on a narrow window
    this.camera.fov = aspect >= 1.2 ? 46 : clamp(46 * 1.2 / aspect, 46, 78);
    this.camera.updateProjectionMatrix();
  }

  setReach(radius) {
    const outer = radius / PADDLE_SCALE, inner = outer - 0.003, w = 0.003 * 0.6, edge = this.reach.userData.edge;
    this.reach.geometry.dispose();
    this.reach.geometry = new THREE.RingGeometry(inner, outer, 48);
    edge.geometry.dispose();
    edge.geometry = new THREE.RingGeometry(inner - w, outer + w, 48);
  }

  // the rings the warm-up asks you to touch
  setBeacons(list) {
    this.beacons.forEach((b, i) => {
      const c = list[i];
      b.visible = !!c?.on;
      if (c) b.position.set(c.x, 1.02, 1.6);
    });
  }

  // a flick shows as the paddle punching forward, whether or not it meets the ball
  swing(speed) {
    if (!CALM) this.kickV = Math.max(this.kickV, clamp(speed * 0.5, 1, 4));
  }

  // keeps frames coming evenly on a computer that can't draw full resolution in time
  keepPace(dt) {
    const q = this.pace;
    if (!(dt > 0) || this.ratio <= MIN_RATIO) return;
    q.recent[q.frames++ % SETTLE_FRAMES] = dt;
    q.avg = q.avg ? q.avg + (dt - q.avg) * 0.05 : dt;
    if (q.frames < SETTLE_FRAMES) return;
    if (q.frames % 30 === 0) q.fast = Math.max(FASTEST, q.recent.slice().sort()[SETTLE_FRAMES / 10 | 0]);
    q.slow = q.fast && q.avg > q.fast * SLOW ? q.slow + 1 : 0;
    if (q.slow < SLOW_FOR) return;
    this.ratio = Math.max(MIN_RATIO, this.ratio - 0.25);
    this.renderer.setPixelRatio(this.ratio);
    this.resize();
    Object.assign(q, { avg: 0, fast: 0, slow: 0, frames: 0 });
  }

  hit(who, ball) {
    this.pop.position.set(ball.p.x, ball.p.y, ball.p.z);
    this.popT = 1;
    if (CALM) return;
    if (who === 0) this.kickV = 4.6;
    else this.farKickV = 4.6;
    const at = who === 0 ? this.nearAt : this.farAt;
    if (at) {
      const dx = ball.p.x - at.x, dy = ball.p.y - at.y, d = Math.hypot(dx, dy), k = d > REACH_EDGE ? (d - REACH_EDGE) / d : 0;
      if (who === 0) this.reachTo = { x: dx * k, y: dy * k };
      else this.farReach = { x: dx * k, y: dy * k };
    }
  }

  placeNear(pose, dt) {
    // a short follow-through after contact, so a hit feels like a hit
    for (let i = 0, n = Math.ceil(dt * 120), h = n ? dt / n : 0; i < n; i++) {
      this.kickV += (-289 * this.kick - 27.9 * this.kickV) * h;
      this.kick += this.kickV * h;
    }
    const fade = Math.exp(-dt / REACH_TIME), r = this.reachTo;
    r.x *= fade;
    r.y *= fade;
    this.nearAt = pose.p;
    const x = pose.p.x + r.x, z = pose.p.z - this.kick, y = Math.max(pose.p.y + r.y + this.kick * 0.3, paddleFloor(x, z));
    const need = rollNeeded(x, y, z);
    if (Math.abs(x) > 0.08) this.nearSide = x > 0 ? 1 : -1;
    const goal = Math.abs(pose.roll) >= need ? pose.roll : this.nearSide * need;
    this.nearRoll += (goal - this.nearRoll) * (1 - Math.exp(-dt * 16));
    const roll = Math.abs(this.nearRoll) >= need ? this.nearRoll : (this.nearRoll >= 0 ? 1 : -1) * need;
    N.set(pose.n.x, pose.n.y, pose.n.z);
    Q.setFromUnitVectors(FACE_AWAY, N);
    Q2.setFromAxisAngle(N, roll);
    this.near.quaternion.copy(Q2).multiply(Q);
    this.near.position.set(x, y, z);
  }

  placeFar(p, dt) {
    // the same follow-through as yours, towards the net
    for (let i = 0, n = Math.ceil(dt * 120), h = n ? dt / n : 0; i < n; i++) {
      this.farKickV += (-289 * this.farKick - 27.9 * this.farKickV) * h;
      this.farKick += this.farKickV * h;
    }
    const fade = Math.exp(-dt / REACH_TIME), r = this.farReach;
    r.x *= fade;
    r.y *= fade;
    this.farAt = p;
    const x = p.x + r.x, z = p.z + this.farKick, y = Math.max(p.y + r.y + this.farKick * 0.3, paddleFloor(x, z)), need = rollNeeded(x, y, z), side = x > 0 ? -1 : 1;
    this.farRoll += (side * need - this.farRoll) * (1 - Math.exp(-dt * 16));
    this.far.position.set(x, y, z);
    this.far.rotation.z = Math.abs(this.farRoll) >= need ? this.farRoll : side * need;
  }

  render(game, pose, dt) {
    const on = game.phase !== 'idle', b = game.ball, at = game.drawn.ball;
    this.clock += dt;
    this.keepPace(dt);
    if (pose.flick) this.swing(pose.flick);
    this.ballMesh.visible = this.blob.visible = this.trail.visible = on;
    this.far.visible = on;
    this.placeNear(pose, dt);

    if (!CALM) {
      this.camX += (pose.p.x * 0.09 - this.camX) * (1 - Math.exp(-dt * 3.5));
      this.camera.position.x = this.camX;
      this.camera.lookAt(0, LOOK.y, LOOK.z);
    }

    if (on) {
      this.ballMesh.position.set(at.x, at.y, at.z);
      const spin = Math.hypot(b.w.x, b.w.y, b.w.z);
      if (spin > 1) {
        AXIS.set(b.w.x / spin, b.w.y / spin, b.w.z / spin);
        this.ballMesh.rotateOnWorldAxis(AXIS, Math.min(spin, MAX_SHOWN_SPIN) * dt);
      }
      const over = Math.abs(at.x) <= TABLE.halfW && Math.abs(at.z) <= TABLE.halfL && at.y >= TABLE.height;
      this.blob.position.set(at.x, over ? TABLE.height + 0.003 : 0.003, at.z);

      const live = game.phase === 'play' || game.phase === 'dead' || game.phase === 'toss', pts = this.trailPts;
      if (live) {
        pts.copyWithin(3, 0, (TRAIL - 1) * 3);
        pts[0] = at.x; pts[1] = at.y; pts[2] = at.z;
        this.trailFilled = Math.min(this.trailFilled + 1, TRAIL);
      } else this.trailFilled = 0;
      this.trail.geometry.setDrawRange(0, this.trailFilled);
      this.trail.geometry.attributes.position.needsUpdate = true;
      this.placeFar(game.drawn.ai, dt);
    }

    // the blue ring is where to be, the outer ring closes as the ball arrives, and both turn green once you're there
    const g = on ? game.guide : null, lock = pose.ready > 0.75;
    this.landMark.visible = !!g?.bounce;
    this.strikeMark.visible = this.timeMark.visible = !!g;
    fade(this.reach, g ? (lock ? 0.7 : 0.32) : 0.18);
    if (g?.bounce) this.landMark.position.set(g.bounce.x, TABLE.height + 0.004, g.bounce.z);
    if (g) {
      const color = lock ? GREEN : BLUE;
      this.strikeMark.material.color.setHex(color);
      this.timeMark.material.color.setHex(color);
      this.strikeMark.position.set(g.p.x, g.p.y, g.p.z);
      this.timeMark.position.copy(this.strikeMark.position);
      this.timeMark.scale.setScalar(1 + clamp(g.t / 0.75, 0, 1) * 2.6);
      this.strikeMark.quaternion.copy(this.camera.quaternion);
      this.timeMark.quaternion.copy(this.camera.quaternion);
    }

    this.pop.visible = this.popT > 0;
    if (this.popT > 0) {
      this.popT = Math.max(0, this.popT - dt / 0.24);
      this.pop.scale.setScalar(1 + (1 - this.popT) * 3.4);
      fade(this.pop, this.popT * 0.8);
      this.pop.quaternion.copy(this.camera.quaternion);
    }
    for (const c of this.beacons) {
      if (!c.visible) continue;
      c.quaternion.copy(this.camera.quaternion);
      c.scale.setScalar(CALM ? 1 : 1 + Math.sin(this.clock * 5) * 0.08);
    }
    this.renderer.render(this.scene, this.camera);
  }
}
