import * as THREE from '../vendor/three.module.js';
import { TABLE, BALL_R, clamp, rollNeeded, paddleFloor } from './config.js';

const WHITE = 0xffffff, BLUE = 0x7fe3ff, GREEN = 0x57e389, TRAIL = 18, BALL_SIZE = 1.5, MAX_SHOWN_SPIN = 34, PADDLE_SCALE = 1.25;
// if frames keep running this much slower than the screen can show them, the picture drops a notch in resolution.
// the screen's pace is the quick end of recent frames, never quicker than 250 a second, so one odd short frame can't set it
const SLOW = 1.4, SLOW_FOR = 60, SETTLE_FRAMES = 120, MIN_RATIO = 1, FASTEST = 1 / 250;
// how far from the blade's centre a ball can be met before the drawn paddle reaches over to it, and how fast that reach fades
const REACH_EDGE = 0.07, REACH_TIME = 0.12;
const CALM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const EYE = { y: 1.74, z: 3.32 }, LOOK = { y: 0.84, z: 0.16 };
const FACE_AWAY = new THREE.Vector3(0, 0, -1), Q = new THREE.Quaternion(), Q2 = new THREE.Quaternion(), N = new THREE.Vector3(), AXIS = new THREE.Vector3();

function box(parent, w, h, d, color, x, y, z, shadow = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: 0.65 }));
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function makePaddle(rubber, scale, opacity = 1) {
  const g = new THREE.Group();
  const blade = new THREE.Mesh(new THREE.CylinderGeometry(0.082, 0.082, 0.012, 40), new THREE.MeshStandardMaterial({ color: rubber, roughness: 0.55, transparent: opacity < 1, opacity }));
  blade.rotation.x = Math.PI / 2;
  blade.castShadow = true;
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.1, 0.022), new THREE.MeshStandardMaterial({ color: 0xc9a06b, roughness: 0.7, transparent: opacity < 1, opacity }));
  grip.position.y = -0.125;
  grip.castShadow = true;
  g.add(blade, grip);
  g.scale.setScalar(scale);
  return g;
}

function ring(inner, outer, color, opacity, onTop = false) {
  const m = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false, depthTest: !onTop }));
  if (onTop) m.renderOrder = 5;
  return m;
}

export class View {
  constructor(canvas) {
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.ratio = Math.min(devicePixelRatio || 1, 2);
    r.setPixelRatio(this.ratio);
    r.shadowMap.enabled = true;
    const s = this.scene = new THREE.Scene();
    s.background = new THREE.Color(0x15181d);
    this.camera = new THREE.PerspectiveCamera(46, 1, 0.05, 40);
    this.camera.position.set(0, EYE.y, EYE.z);
    this.camera.lookAt(0, LOOK.y, LOOK.z);

    s.add(new THREE.HemisphereLight(0xffffff, 0x30343a, 1.5));
    const sun = new THREE.DirectionalLight(WHITE, 2);
    sun.position.set(0.8, 4, 1.4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -2.2, right: 2.2, top: 2.2, bottom: -2.2 });
    s.add(sun);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.MeshStandardMaterial({ color: 0x24282f, roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    s.add(floor);
    this.buildTable(s);

    this.ballMesh = new THREE.Group();
    const skin = document.createElement('canvas');
    skin.width = 64; skin.height = 32;
    const g = skin.getContext('2d');
    g.fillStyle = '#ff8a1f'; g.fillRect(0, 0, 64, 32);
    g.fillStyle = '#ffe9d2'; g.fillRect(0, 13, 64, 6);
    this.ballMesh.add(new THREE.Mesh(new THREE.SphereGeometry(BALL_R * BALL_SIZE, 20, 14), new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(skin), roughness: 0.4 })));
    s.add(this.ballMesh);

    this.blob = new THREE.Mesh(new THREE.CircleGeometry(BALL_R * 1.7, 20), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.42, depthWrite: false }));
    this.blob.rotation.x = -Math.PI / 2;
    s.add(this.blob);

    this.trailPts = new Float32Array(TRAIL * 3);
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(this.trailPts, 3));
    this.trail = new THREE.Line(tg, new THREE.LineBasicMaterial({ color: 0xffb066, transparent: true, opacity: 0.55 }));
    this.trail.frustumCulled = false;
    s.add(this.trail);
    this.trailFilled = 0;

    // see-through so your own paddle never hides the ball
    this.near = makePaddle(0xd8232f, PADDLE_SCALE, 0.6);
    this.far = makePaddle(0x2fbf71, PADDLE_SCALE);
    s.add(this.near, this.far);
    this.reach = ring(0.2, 0.205, WHITE, 0.3);
    this.near.add(this.reach);

    this.landMark = ring(0.035, 0.052, 0xffd23f, 0.95);
    this.landMark.rotation.x = -Math.PI / 2;
    this.strikeMark = ring(0.04, 0.052, BLUE, 0.95, true);
    this.timeMark = ring(0.05, 0.056, BLUE, 0.7, true);
    this.pop = ring(0.03, 0.04, WHITE, 0, true);
    this.beacons = [ring(0.1, 0.118, GREEN, 0.9, true), ring(0.1, 0.118, GREEN, 0.9, true)];
    for (const b of this.beacons) b.visible = false;
    s.add(this.landMark, this.strikeMark, this.timeMark, this.pop, ...this.beacons);

    this.kick = 0;
    this.kickV = 0;
    this.farKick = 0;
    this.farKickV = 0;
    // if your paddle was still a little off the ball when they met, it's drawn reaching across to it for a moment
    this.reachTo = { x: 0, y: 0 };
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

  buildTable(s) {
    const { width: W, length: L, height: H, halfW, halfL, netH, netHalfW } = TABLE;
    box(s, W, 0.03, L, 0x17507f, 0, H - 0.015, 0);
    const line = (w, d, x, z) => box(s, w, 0.002, d, WHITE, x, H + 0.001, z, false);
    line(W, 0.02, 0, halfL - 0.01); line(W, 0.02, 0, -halfL + 0.01);
    line(0.02, L, halfW - 0.01, 0); line(0.02, L, -halfW + 0.01, 0);
    line(0.003, L, 0, 0);
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(s, 0.05, H - 0.03, 0.05, 0x3a3f47, x * (halfW - 0.1), (H - 0.03) / 2, z * (halfL - 0.2));

    const c = document.createElement('canvas');
    c.width = c.height = 16;
    const g = c.getContext('2d');
    g.strokeStyle = 'rgba(255,255,255,.75)';
    g.strokeRect(0.5, 0.5, 15, 15);
    const mesh = new THREE.CanvasTexture(c);
    mesh.wrapS = mesh.wrapT = THREE.RepeatWrapping;
    mesh.repeat.set(92, 8);
    const net = new THREE.Mesh(new THREE.PlaneGeometry(netHalfW * 2, netH), new THREE.MeshBasicMaterial({ map: mesh, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    net.position.set(0, H + netH / 2, 0);
    s.add(net);
    box(s, netHalfW * 2, 0.014, 0.004, WHITE, 0, H + netH - 0.007, 0, false);
    for (const x of [-netHalfW, netHalfW]) box(s, 0.016, netH + 0.01, 0.016, 0x101216, x, H + netH / 2, 0);
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
    this.reach.geometry.dispose();
    this.reach.geometry = new THREE.RingGeometry(radius / PADDLE_SCALE - 0.003, radius / PADDLE_SCALE, 48);
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
    if (who === 0 && this.nearAt) {
      const dx = ball.p.x - this.nearAt.x, dy = ball.p.y - this.nearAt.y, d = Math.hypot(dx, dy), k = d > REACH_EDGE ? (d - REACH_EDGE) / d : 0;
      this.reachTo = { x: dx * k, y: dy * k };
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
    const z = p.z + this.farKick, y = Math.max(p.y + this.farKick * 0.3, paddleFloor(p.x, z)), need = rollNeeded(p.x, y, z), side = p.x > 0 ? -1 : 1;
    this.farRoll += (side * need - this.farRoll) * (1 - Math.exp(-dt * 16));
    this.far.position.set(p.x, y, z);
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
    this.reach.material.opacity = g ? (lock ? 0.7 : 0.32) : 0.18;
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
      this.pop.material.opacity = this.popT * 0.8;
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
