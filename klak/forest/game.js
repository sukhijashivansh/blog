import * as THREE from './three.bundle.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { HDRLoader } from './vendor/HDRLoader.js';
import { Tree } from './vendor/ez-tree/tree.js';
const { EffectComposer, RenderPass, OutputPass, mergeGeometries } = THREE;

const $ = id => document.getElementById(id);
const cv = $('game');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];
const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, String(v)); } catch (e) {} } };
const nap = () => new Promise(r => setTimeout(r, 0));
const V = new THREE.Vector3(), V2 = new THREE.Vector3(), V3 = new THREE.Vector3(), Q0 = new THREE.Quaternion(), E0 = new THREE.Euler(), E1 = new THREE.Euler(0, 0, 0, 'YXZ'), M0 = new THREE.Matrix4(), C0 = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0), ONE = new THREE.Vector3(1, 1, 1);

// the forest is laid out from a fixed seed, so every player gets the same woods
let seed = 20261;
const srnd = (a = 0, b = 1) => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return a + (((t ^ (t >>> 14)) >>> 0) / 4294967296) * (b - a); };
function hash2(i, j) { let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vnoise(x, y) {
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return lerp(lerp(hash2(i, j), hash2(i + 1, j), u), lerp(hash2(i, j + 1), hash2(i + 1, j + 1), u), v);
}
const fbm = (x, y) => vnoise(x, y) * 0.55 + vnoise(x * 2.1 + 7, y * 2.1 + 3) * 0.3 + vnoise(x * 4.3 + 1, y * 4.3 + 9) * 0.15;
const groundH = (x, z) => {
  const d = Math.hypot(x * 0.8, (z + 12) * 0.55);
  return (fbm(x * 0.035, z * 0.035) - 0.5) * 2 + sstep(18, 80, d) * (fbm(x * 0.012 + 9, z * 0.012) * 24 - 5);
};

/* ---------- quality: picked from the device, stepped down at runtime if frames run long ---------- */
const QUALITY = [
  { dpr: 1.25, leaves: 0.42, grass: 1400, meadow: 13000, shadow: 0, post: false, samples: 0 },
  { dpr: 1.6, leaves: 0.58, grass: 2800, meadow: 20000, shadow: 1024, post: false, samples: 0 },
  { dpr: 2, leaves: 1, grass: 4500, meadow: 30000, shadow: 2048, post: true, samples: 4 },
];
const coarse = matchMedia('(pointer: coarse)').matches, cores = navigator.hardwareConcurrency || 4, memory = navigator.deviceMemory || 4;
const savedTier = store.get('klak.forest.q');
const tier = savedTier !== null ? clamp(+savedTier | 0, 0, 2) : /iPhone|iPad/.test(navigator.userAgent) ? 1 : coarse ? (cores >= 6 && memory >= 4 ? 1 : 0) : cores >= 8 ? 2 : 1;
const Q = { ...QUALITY[tier], leafFrac: 1 };

let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: !QUALITY[tier].post, powerPreference: 'high-performance', stencil: false, alpha: true }); }
catch (e) { $('menuCard').hidden = true; $('failCard').hidden = false; throw e; }
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
renderer.shadowMap.enabled = Q.shadow > 0;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xbdd3ca, 0.007);
const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 620);
scene.add(camera);
let W = 1, H = 1, composer = null;

/* ---------- sky: daytime, drifting slowly between morning, noon and afternoon light ---------- */
const hex = (...c) => c.map(h => new THREE.Color(h));
const KEY = (zen, mid, hor, sun, cloud, fog, hemi, gnd, dir, sunI, hemiI, glow, star, shaft, bloomI) => {
  const [a, b, c, d, e, f, g, h] = hex(zen, mid, hor, sun, cloud, fog, hemi, gnd);
  return { zen: a, mid: b, hor: c, sun: d, cloud: e, fog: f, hemi: g, gnd: h, dir: new THREE.Vector3(...dir).normalize(), sunI, hemiI, glow, star, shaft, bloomI };
};
const SKY = [                                      // a soft summer day: blue overhead, pale haze low down, the sun wandering across
  KEY('#4f86c6', '#8db8e0', '#cfe2ec', '#fff2d8', '#ffffff', '#b9cfc6', '#d6e6f2', '#4a5532', [0.45, 0.5, -0.74], 2.3, 1.15, 0.32, 0, 0.07, 0.05),
  KEY('#4a82c8', '#86b6e2', '#d3e5ee', '#fff6e6', '#ffffff', '#bdd3ca', '#dde9f2', '#4d5834', [0.18, 0.68, -0.7], 2.5, 1.2, 0.28, 0, 0.06, 0.04),
  KEY('#5288c4', '#94bde0', '#d8e4e6', '#fff0d4', '#fffaf2', '#c2d2c4', '#e2e8ea', '#4f5634', [-0.35, 0.55, -0.76], 2.3, 1.15, 0.32, 0, 0.07, 0.05),
];
const SKY_STEP = 24, sky = {
  zen: new THREE.Color(), mid: new THREE.Color(), hor: new THREE.Color(), sun: new THREE.Color(), cloud: new THREE.Color(), fog: new THREE.Color(), hemi: new THREE.Color(), gnd: new THREE.Color(),
  dir: new THREE.Vector3(), sunI: 1, hemiI: 1, glow: 1, star: 0, shaft: 0, bloomI: 0.4, t: rnd(0, 3),
};
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
  uniforms: {
    uZen: { value: sky.zen }, uMid: { value: sky.mid }, uHor: { value: sky.hor }, uSun: { value: sky.sun }, uCloud: { value: sky.cloud }, uDir: { value: sky.dir },
    uGlow: { value: 1 }, uStar: { value: 0 }, uTime: { value: 0 },
  },
  vertexShader: `varying vec3 vDir;
    void main() { vDir = position; vec4 p = projectionMatrix * mat4(mat3(viewMatrix)) * vec4(position, 1.0); gl_Position = p.xyww; }`,
  fragmentShader: `varying vec3 vDir; uniform vec3 uZen, uMid, uHor, uSun, uCloud, uDir; uniform float uGlow, uStar, uTime;
    float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    float ns(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
    float fb(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * ns(p); p = p * 2.03 + 11.7; a *= 0.5; } return s; }
    void main() {
      vec3 d = normalize(vDir); float y = max(d.y, 0.0);
      vec3 col = mix(uHor, uMid, smoothstep(0.0, 0.26, y)); col = mix(col, uZen, smoothstep(0.18, 0.78, y));
      float s = max(dot(d, uDir), 0.0);
      if (uStar > 0.01) {
        vec3 q = d * 170.0; vec3 c = floor(q); float h = h21(c.xy + c.z * 0.37);
        float tw = 0.6 + 0.4 * sin(uTime * 2.0 + h * 40.0);
        col += vec3(0.9, 0.95, 1.0) * smoothstep(0.992, 1.0, h) * smoothstep(0.5, 0.05, length(fract(q) - 0.5)) * tw * uStar * 1.6 * smoothstep(0.02, 0.2, d.y);
      }
      col += uSun * (pow(s, 6.0) * 0.26 + pow(s, 48.0) * 0.5) * uGlow;
      col += uSun * smoothstep(0.9988, 0.9994, s) * 5.0;
      vec2 p = d.xz / (d.y + 0.17) * 1.25 + vec2(uTime * 0.018, uTime * 0.007);
      float f = fb(p), a = smoothstep(0.46, 0.74, f) * smoothstep(0.015, 0.2, d.y);
      float lit = clamp((f - fb(p + uDir.xz * 0.16)) * 3.4 + 0.55, 0.0, 1.0);
      vec3 cl = mix(uCloud * 0.62, uCloud * 1.12 + uSun * pow(s, 3.0) * 0.5, lit);
      col = mix(col, cl, a * 0.86);
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
});
const skyDome = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 20), skyMat);
skyDome.frustumCulled = false; skyDome.renderOrder = -10;
scene.add(skyDome);

const hemi = new THREE.HemisphereLight(0xffffff, 0x223311, 1);
const sun = new THREE.DirectionalLight(0xffffff, 2);
sun.castShadow = Q.shadow > 0;
if (Q.shadow) {
  sun.shadow.mapSize.set(Q.shadow, Q.shadow); sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.05;
  Object.assign(sun.shadow.camera, { left: -46, right: 46, top: 46, bottom: -46, near: 10, far: 220 });
}
sun.target.position.set(0, 0, -20);
scene.add(hemi, sun, sun.target);

/* ---------- the real world: a photographed sky lights the scene, surfaces are photo scans (Poly Haven and ambientCG, CC0) ---------- */
const TEX = {};
async function loadWorld() {
  const tl = new THREE.TextureLoader(), aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const tex = (name, srgb, rep) => tl.loadAsync(new URL(`./tex/${name}.webp`, import.meta.url).href).then(t => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso; if (srgb) t.colorSpace = THREE.SRGBColorSpace; if (rep) t.repeat.set(...rep); TEX[name] = t;
  }, () => {});                                     // offline or blocked: the drawn textures stand in
  const sky_ = new HDRLoader().loadAsync(new URL('./tex/sky.hdr', import.meta.url).href).then(t => {
    t.mapping = THREE.EquirectangularReflectionMapping;
    const { data, width: w, height: h } = t.image; let peak = 0, at = 0;      // find the sun in the photo, so shadows fall the way the sky says
    for (let i = 0; i < w * h; i += 1) { const l = THREE.DataUtils.fromHalfFloat(data[i * 4 + 1]); if (l > peak) { peak = l; at = i; } }
    const el = (0.5 - (Math.floor(at / w) + 0.5) / h) * Math.PI, ph = ((at % w + 0.5) / w - 0.5) * Math.PI * 2;
    V.set(Math.cos(ph) * Math.cos(el), Math.sin(el), Math.sin(ph) * Math.cos(el));
    const turn = Math.atan2(V.z, V.x) + 0.36;                 // swing the sky so the sun comes in from the right: trunk shadows reach across the path
    scene.backgroundRotation.y = scene.environmentRotation.y = turn; V.applyEuler(E0.set(0, turn, 0));
    for (const k of SKY) { k.dir.copy(V); k.hemiI *= 0.3; }
    const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromEquirectangular(t).texture; pm.dispose();
    scene.background = t; scene.backgroundIntensity = 0.85; scene.environmentIntensity = 0.5; skyDome.visible = false;
  }, () => {});
  await Promise.all([sky_, tex('ground_diff', true, [110, 110]), tex('ground_nor', false, [110, 110]), tex('ground_rough', false, [110, 110]),
    tex('bark_diff', true, [2, 6]), tex('bark_nor', false, [2, 6]), tex('rock_diff', true), tex('rock_nor', false),
    tex('leaf_oak', true), tex('leaf_ash', true), tex('wood_diff', true, [2, 1]), tex('wood_rough', false, [2, 1]), tex('leather_nor', false)]);
}

const shared = { time: { value: 0 }, sunView: { value: new THREE.Vector3() }, sunCol: { value: new THREE.Color() }, rim: { value: new THREE.Color() }, gust: { value: 0 }, windAmp: { value: reduceMotion ? 0.3 : 1 }, blast: { value: new THREE.Vector4() }, lit: { value: new THREE.Color(1, 1, 1) } };
function applySky(dt) {
  sky.t = (sky.t + dt / SKY_STEP) % SKY.length;
  const i = Math.floor(sky.t), f = sstep(0.12, 0.88, sky.t - i), a = SKY[i], b = SKY[(i + 1) % SKY.length];
  for (const k of ['zen', 'mid', 'hor', 'sun', 'cloud', 'fog', 'hemi', 'gnd']) sky[k].copy(a[k]).lerp(b[k], f);
  for (const k of ['sunI', 'hemiI', 'glow', 'star', 'shaft', 'bloomI']) sky[k] = lerp(a[k], b[k], f);
  sky.dir.copy(a.dir).lerp(b.dir, f).normalize();
  skyMat.uniforms.uGlow.value = sky.glow; skyMat.uniforms.uStar.value = sky.star;
  scene.fog.color.copy(sky.fog);
  hemi.color.copy(sky.hemi); hemi.groundColor.copy(sky.gnd); hemi.intensity = sky.hemiI;
  sun.color.copy(sky.sun); sun.intensity = sky.sunI;
  V.copy(sky.dir); V.y = Math.max(V.y, 0.42); V.normalize();
  sun.position.copy(sun.target.position).addScaledVector(V, 110);
  shared.sunCol.value.copy(sky.sun).multiplyScalar(Math.min(1.4, sky.sunI * 0.5));
  shared.rim.value.setRGB(0.5, 0.62, 0.9).multiplyScalar(sky.star * 1.1).add(C0.copy(sky.sun).multiplyScalar(0.09));
  shared.lit.value.copy(sky.hemi).multiplyScalar(0.35 + sky.hemiI * 0.4);
}

/* ---------- textures, all drawn in code ---------- */
function mkCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d', { willReadFrequently: true })]; }
function leafPath(g, x, y, len, wid, ang) {
  g.save(); g.translate(x, y); g.rotate(ang);
  g.beginPath(); g.moveTo(0, 0); g.bezierCurveTo(len * 0.25, -wid, len * 0.72, -wid * 0.8, len, 0); g.bezierCurveTo(len * 0.72, wid * 0.8, len * 0.25, wid, 0, 0); g.closePath();
  g.fill();
  g.strokeStyle = 'rgba(70,100,50,0.42)'; g.lineWidth = Math.max(1, len * 0.022); g.beginPath(); g.moveTo(0, 0); g.lineTo(len * 0.95, 0);
  for (let t = 0.2; t < 0.85; t += 0.16) { g.moveTo(len * t, 0); g.lineTo(len * (t + 0.13), -wid * 0.55 * (1 - t * 0.5)); g.moveTo(len * t, 0); g.lineTo(len * (t + 0.13), wid * 0.55 * (1 - t * 0.5)); }
  g.stroke(); g.restore();
}
function leafTexture() {                            // edge pixels keep the leaf colour, so mipmaps don't grow a dark halo
  const S = 512, [c, g] = mkCanvas(S, S);
  for (let i = 0; i < 30; i++) {
    const a = srnd(0, Math.PI * 2), r = srnd(0, S * 0.27), x = S / 2 + Math.cos(a) * r, y = S / 2 + Math.sin(a) * r, l = Math.round(srnd(198, 255));
    g.fillStyle = `rgb(${l * 0.9 | 0},${l},${l * 0.82 | 0})`;
    leafPath(g, x, y, srnd(70, 118), srnd(22, 36), a + srnd(-0.7, 0.7));
  }
  const img = g.getImageData(0, 0, S, S), d = img.data;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] < 8) { d[i] = 208; d[i + 1] = 228; d[i + 2] = 186; d[i + 3] = 0; }
  const t = new THREE.DataTexture(new Uint8Array(d), S, S, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = 4; t.needsUpdate = true;
  return t;
}
function barkTexture() {
  const [c, g] = mkCanvas(256, 512);
  g.fillStyle = '#5f4630'; g.fillRect(0, 0, 256, 512);
  for (let i = 0; i < 520; i++) {
    const x = srnd(0, 256), y = srnd(-40, 512), l = srnd(30, 130), v = srnd(0, 1);
    g.strokeStyle = v < 0.55 ? `rgba(28,18,10,${srnd(0.2, 0.6)})` : `rgba(158,126,92,${srnd(0.1, 0.34)})`;
    g.lineWidth = srnd(1, 4.5); g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(x + srnd(-7, 7), y + l * 0.3, x + srnd(-7, 7), y + l * 0.7, x + srnd(-4, 4), y + l); g.stroke();
  }
  for (let i = 0; i < 26; i++) { g.fillStyle = `rgba(92,128,58,${srnd(0.08, 0.26)})`; g.beginPath(); g.ellipse(srnd(0, 256), srnd(0, 512), srnd(8, 28), srnd(14, 46), 0, 0, 7); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 3); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function groundTexture() {
  const S = 512, [c, g] = mkCanvas(S, S);
  g.fillStyle = '#c9c9b4'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 2600; i++) {
    const v = srnd(0, 1); g.strokeStyle = v < 0.5 ? `rgba(40,50,24,${srnd(0.08, 0.3)})` : `rgba(240,245,210,${srnd(0.05, 0.2)})`;
    g.lineWidth = srnd(0.6, 2); const x = srnd(0, S), y = srnd(0, S), a = srnd(0, 6.3), l = srnd(3, 15);
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(36, 36); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function eggTexture(base, spot, n) {
  const [c, g] = mkCanvas(256, 256);
  g.fillStyle = base; g.fillRect(0, 0, 256, 256); g.fillStyle = spot;
  for (let i = 0; i < n; i++) { g.globalAlpha = srnd(0.35, 0.95); g.beginPath(); g.ellipse(srnd(0, 256), srnd(0, 256) ** 1.08 % 256, srnd(1, 6.5), srnd(1, 4.5), srnd(0, 3), 0, 7); g.fill(); }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; return t;
}
function softTexture(vertical) {
  const [c, g] = mkCanvas(64, 256), l = g.createLinearGradient(0, 0, 0, 256);
  l.addColorStop(0, 'rgba(255,255,255,0)'); l.addColorStop(0.3, 'rgba(255,255,255,0.8)'); l.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = l; g.fillRect(0, 0, 64, 256);
  g.globalCompositeOperation = 'destination-in';
  const s = g.createLinearGradient(0, 0, 64, 0); s.addColorStop(0, 'rgba(0,0,0,0)'); s.addColorStop(0.5, 'rgba(0,0,0,1)'); s.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = s; g.fillRect(0, 0, 64, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/* ---------- wind and leaf light: instanced cards share one material, puffed normals make them read as soft crowns ---------- */
const WIND_DIR = new THREE.Vector2(0.82, 0.57);
const WIND_GLSL = `uniform float uTime, uGust, uWindAmp; uniform vec4 uBlast;
  const vec2 WIND_DIR = vec2(0.82, 0.57);
  float gustFront(vec2 p) { float a = dot(p, WIND_DIR) * 0.085 - uTime * 0.72 + sin(p.y * 0.05 + uTime * 0.2) * 1.4; float s = 0.5 + 0.5 * sin(a); return s * s * s; }
  vec3 treeSway(vec3 wp) {
    float h = clamp(wp.y / 30.0, 0.0, 1.25);
    float s = sin(uTime * 0.62 + wp.x * 0.034 + wp.z * 0.028) + 0.42 * sin(uTime * 1.17 + wp.x * 0.05 - wp.z * 0.04);
    return vec3(WIND_DIR.x, 0.0, WIND_DIR.y) * (s * 0.2 + gustFront(wp.xz) * (0.26 + uGust * 0.5)) * h * h * uWindAmp;
  }
  vec3 blastPush(vec3 wp) {
    if (uBlast.w < 0.002) return vec3(0.0);
    vec2 d = wp.xz - uBlast.xy; float l = length(d) + 0.001, f = (l - uBlast.z) / 3.4;
    return vec3(d.x / l, 0.2, d.y / l) * exp(-f * f) * uBlast.w;
  }`;
const WIND_BODY = {                                 // gusts roll through as a travelling front; trunks and crowns bend together, cards twist on top
  leaf: `float g = gustFront(wp.xz), w1 = sin(uTime * 1.6 + aPhase * 6.28 + wp.x * 0.28), w2 = sin(uTime * 2.9 + aPhase * 11.0 + wp.z * 0.37);
    float twist = sin(uTime * (5.0 + aPhase * 4.0) + aPhase * 40.0) * (0.05 + 0.18 * g + 0.12 * uGust);
    wp.xyz += treeSway(wp.xyz) + blastPush(wp.xyz) * 0.85 + (vec3(w1 + 0.5 * w2, 0.4 * w2, 0.6 * w1) * (0.06 + 0.09 * g + 0.08 * uGust) + aN * (uv.x - 0.5) * twist) * uWindAmp;`,
  frame: `float g = gustFront(wp.xz), w1 = sin(uTime * 1.6 + aPhase * 6.28), w2 = sin(uTime * 2.9 + aPhase * 11.0);
    float twist = sin(uTime * (4.0 + aPhase * 3.0) + aPhase * 40.0) * (0.012 + 0.05 * g + 0.03 * uGust);
    wp.xyz += (vec3(w1 + 0.5 * w2, 0.4 * w2, 0.6 * w1) * (0.012 + 0.02 * g + 0.018 * uGust) + aN * (uv.x - 0.5) * twist) * uWindAmp;`,
  clump: `float g = gustFront(wp.xz), bend = clamp(position.y, 0.0, 1.0); bend *= bend; float s = sin(uTime * 1.7 + aPhase * 6.28 + dot(wp.xz, WIND_DIR) * 0.5);
    wp.xz += WIND_DIR * (0.05 * s + (0.14 + 0.12 * uGust) * g) * bend * uWindAmp;
    wp.y -= 0.06 * g * bend * uWindAmp;
    wp.xyz += blastPush(wp.xyz) * 0.6 * bend;`,
  grass: `float g = gustFront(wp.xz), bend = uv.y * uv.y, s = sin(uTime * 1.7 + aPhase * 6.28 + dot(wp.xz, WIND_DIR) * 0.5);
    wp.xz += WIND_DIR * (0.035 * s + (0.1 + 0.09 * uGust) * g) * bend * uWindAmp;
    wp.y -= 0.05 * g * bend * uWindAmp;
    wp.xyz += blastPush(wp.xyz) * 0.5 * bend;`,
};
const windUniforms = sh => Object.assign(sh.uniforms, { uTime: shared.time, uGust: shared.gust, uWindAmp: shared.windAmp, uBlast: shared.blast });
function windify(mat, kind) {
  mat.onBeforeCompile = sh => {
    windUniforms(sh);
    Object.assign(sh.uniforms, { uSunView: shared.sunView, uSunCol: shared.sunCol });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aN; attribute float aPhase;\n' + WIND_GLSL)
      .replace('#include <defaultnormal_vertex>', 'vec3 transformedNormal = normalize(normalMatrix * aN);')
      .replace('#include <project_vertex>', `vec4 wp = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
        ${WIND_BODY[kind]}
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uSunView; uniform vec3 uSunCol;')
      .replace('#include <normal_fragment_begin>', 'float faceDirection = 1.0; vec3 normal = normalize(vNormal); vec3 nonPerturbedNormal = normal;')
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n material.specularColor *= 0.12; material.specularF90 *= 0.12;')    // leaves and blades are matte: no sheen off the sky
      .replace('#include <opaque_fragment>', `outgoingLight += diffuseColor.rgb * diffuseColor.rgb * uSunCol * pow(max(dot(-normalize(vViewPosition), uSunView), 0.0), 4.0) * 0.5;
        #include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => 'klak-' + kind;
  return mat;
}
function leafLight(sh) {                            // leaves: lit from their crown's centre, no sheen, sun glowing through from behind
  Object.assign(sh.uniforms, { uSunView: shared.sunView, uSunCol: shared.sunCol });
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform vec3 uSunView; uniform vec3 uSunCol;')
    .replace('#include <normal_fragment_begin>', 'float faceDirection = 1.0; vec3 normal = normalize(vNormal); vec3 nonPerturbedNormal = normal;')
    .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n material.specularColor *= 0.12; material.specularF90 *= 0.12;')
    .replace('#include <opaque_fragment>', `outgoingLight += diffuseColor.rgb * diffuseColor.rgb * uSunCol * pow(max(dot(-normalize(vViewPosition), uSunView), 0.0), 4.0) * 0.5;
      #include <opaque_fragment>`);
}
function canopyify(mat) {                           // EZ-Tree crowns: lean with the trunk, and every twig flutters on its own
  mat.onBeforeCompile = sh => {
    windUniforms(sh); leafLight(sh);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + WIND_GLSL)
      .replace('#include <project_vertex>', `vec4 wp = instanceMatrix * vec4(transformed, 1.0);
        wp = modelMatrix * wp;
        float g = gustFront(wp.xz), f = sin(uTime * 2.6 + dot(wp.xyz, vec3(0.9, 0.6, 0.7))) + 0.5 * sin(uTime * 4.1 + dot(wp.xyz, vec3(-0.5, 1.1, 0.8)));
        wp.xyz += treeSway(wp.xyz) + vec3(f, 0.45 * f, 0.7 * f) * (0.035 + 0.07 * g + 0.05 * uGust) * uWindAmp + blastPush(wp.xyz) * 0.35 * clamp(wp.y / 18.0, 0.0, 1.0);
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;`);
  };
  mat.customProgramCacheKey = () => 'klak-canopy';
  return mat;
}
function swayify(mat) {                             // trunks, limbs and nests lean with the crowns they carry
  mat.onBeforeCompile = sh => {
    windUniforms(sh);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + WIND_GLSL)
      .replace('#include <project_vertex>', `vec4 wp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
        wp = instanceMatrix * wp;
        #endif
        wp = modelMatrix * wp;
        wp.xyz += treeSway(wp.xyz) + blastPush(wp.xyz) * 0.05 * clamp(wp.y / 18.0, 0.0, 1.0);
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;`);
  };
  mat.customProgramCacheKey = () => 'klak-sway';
  return mat;
}
function addRim(mat) {                              // a thin light edge keeps targets readable against the night
  mat.onBeforeCompile = sh => {
    sh.uniforms.uRim = shared.rim;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRim;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += uRim * pow(1.0 - saturate(dot(normalize(vNormal), normalize(vViewPosition))), 2.4);`);
  };
  mat.customProgramCacheKey = () => 'klak-rim';
  return mat;
}

/* ---------- the forest ---------- */
const trunks = [], nests = [];
let leafTex, barkMat, frameMat, leafMeshes = [], grassMesh, meadowMesh, frameMesh, frameItems = [], fallLeaves, fallData = [], fireflies, shafts = [];
const GREENS = hex('#2f7d32', '#3f9440', '#1f6a35', '#5aa53a', '#2a8a4a', '#74b13c', '#1a5c30');
const HERO = [[-11.5, -23, 25, 1.05], [11, -27, 27, 1.15], [-7.6, -42, 28, 1.2], [7.2, -44, 26, 1.1], [-17, -39, 30, 1.3], [17, -37, 28, 1.25]];

function buildGround(bark) {
  const size = 360, g = new THREE.PlaneGeometry(size, size, 170, 170); g.rotateX(-Math.PI / 2); g.translate(0, 0, -70);
  const real = !!TEX.ground_diff, P = g.attributes.position, col = new Float32Array(P.count * 3), [a, b, dirt, moss] = real ? hex('#93ad6c', '#7fa055', '#8f765c', '#6f9452') : hex('#2f5a24', '#5b7f2e', '#6f5636', '#1d4a2a');
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), z = P.getZ(i); P.setY(i, groundH(x, z));
    const n = fbm(x * 0.09, z * 0.09), path = 1 - sstep(1.2, 4.6, Math.abs(x - Math.sin(z * 0.06) * 3.2) + (n - 0.5) * 3);
    C0.copy(a).lerp(b, sstep(0.32, 0.68, n)).lerp(moss, sstep(0.55, 0.8, fbm(x * 0.03 + 4, z * 0.03))).lerp(dirt, path * sstep(-90, -30, z) * 0.85);
    col.set([C0.r, C0.g, C0.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: TEX.ground_diff || groundTexture(), normalMap: TEX.ground_nor || null, roughnessMap: TEX.ground_rough || null, roughness: 1, metalness: 0, vertexColors: true }));
  m.receiveShadow = true; scene.add(m);

  // rocks along the clearing
  const rg = new THREE.IcosahedronGeometry(1, 2), rp = rg.attributes.position;
  for (let i = 0; i < rp.count; i++) { V.fromBufferAttribute(rp, i); const k = 0.76 + 0.42 * fbm(V.x * 1.7 + 5, V.y * 1.7 + V.z * 1.7); rp.setXYZ(i, V.x * k, V.y * k * 0.72, V.z * k); }
  rg.computeVertexNormals();
  const rocks = new THREE.InstancedMesh(rg, new THREE.MeshStandardMaterial({ map: TEX.rock_diff || null, normalMap: TEX.rock_nor || null, color: TEX.rock_diff ? 0xffffff : 0x8a8a7c, roughness: 0.9, metalness: 0 }), 46);
  for (let i = 0; i < rocks.count; i++) {
    const side = srnd() < 0.5 ? -1 : 1, x = side * srnd(4.5, 30), z = srnd(-62, 7), s = srnd(0.22, 1.05);
    rocks.setMatrixAt(i, M0.compose(V.set(x, groundH(x, z) + s * 0.12, z), Q0.setFromEuler(E0.set(srnd(0, 3), srnd(0, 6), srnd(0, 3))), V2.set(s * srnd(1, 1.7), s, s * srnd(1, 1.5))));
    rocks.setColorAt(i, TEX.rock_diff ? C0.setHSL(srnd(0.1, 0.25), 0.1, srnd(0.5, 0.72)) : C0.setHSL(srnd(0.14, 0.3), 0.12, srnd(0.3, 0.46)));
  }
  rocks.castShadow = rocks.receiveShadow = true; scene.add(rocks);

  // distant wooded hills
  const hg = new THREE.IcosahedronGeometry(1, 2), hills = new THREE.InstancedMesh(hg, new THREE.MeshLambertMaterial({ color: 0xffffff }), 360);
  for (let i = 0; i < hills.count; i++) {
    const a = srnd(-1.9, 1.9), d = srnd(135, 250), x = Math.sin(a) * d, z = -Math.cos(a) * d - 20, s = srnd(9, 24);
    hills.setMatrixAt(i, M0.compose(V.set(x, groundH(x, z) + s * srnd(0.2, 1.0), z), Q0.identity(), V2.set(s, s * srnd(1.2, 1.9), s)));
    hills.setColorAt(i, C0.copy(pick(GREENS)).multiplyScalar(srnd(0.6, 1)));
  }
  scene.add(hills);
}
const BUSH_KINDS = [{ preset: 'Bush 2', seed: 1203, leaf: 'oak', tint: 0xeef5dc, leafK: 1.6 }, { preset: 'Bush 1', seed: 860, leaf: 'ash', tint: 0xf4fae8 }];
const TREE_KINDS = [                                // EZ-Tree presets (MIT, Daniel Greenheck): real branching, photographed twigs
  { preset: 'Oak Large', seed: 23399, leaf: 'oak', tint: 0xffffff }, { preset: 'Oak Large', seed: 5521, leaf: 'oak', tint: 0xf4f8e8 },
  { preset: 'Ash Large', seed: 9172, leaf: 'ash', tint: 0xffffff }, { preset: 'Oak Medium', seed: 771, leaf: 'oak', tint: 0xf0f4e0 }, { preset: 'Ash Medium', seed: 3307, leaf: 'ash', tint: 0xf8fbef },
];
function growTree(k, detail) {                      // lower detail: fewer, larger twigs and coarser limbs
  const t = new Tree(); t.loadPreset(k.preset); const o = t.options; o.seed = k.seed;
  const thin = lerp(0.5, 1, detail);
  o.leaves.count = Math.max(3, Math.round(o.leaves.count * thin * (k.leafK || 1))); o.leaves.size *= 1 + (1 - thin) * 0.6;
  for (const l in o.branch.sections) { o.branch.sections[l] = Math.max(2, Math.round(o.branch.sections[l] * lerp(0.5, 1, detail))); o.branch.segments[l] = Math.max(3, Math.round(o.branch.segments[l] * lerp(0.55, 1, detail))); }
  t.generate();
  const branches = t.branchesMesh.geometry, leaves = t.leavesMesh.geometry;
  branches.computeBoundingBox(); leaves.computeBoundingBox();
  const c = leaves.boundingBox.getCenter(new THREE.Vector3()), p = leaves.attributes.position, n = leaves.attributes.normal;
  for (let i = 0; i < p.count; i++) {               // each twig faces out from the crown's middle, so the canopy shades like one rounded mass
    V.set(p.getX(i) - c.x, (p.getY(i) - c.y) * 0.8, p.getZ(i) - c.z).normalize(); V.y += 0.35; V.normalize(); n.setXYZ(i, V.x, V.y, V.z);
  }
  return { branches, leaves, height: Math.max(branches.boundingBox.max.y, leaves.boundingBox.max.y) };
}
function impostor(branches, branchMat, leaves, leafMat) {   // the grown tree, photographed once from the side for the far forest
  const box = new THREE.Box3().setFromBufferAttribute(leaves.attributes.position).union(branches.boundingBox);
  const w = Math.max(box.max.x - box.min.x, box.max.z - box.min.z), h = box.max.y, S = tier === 2 ? 512 : 256;
  const SH = Math.round(S * h / w), rt = new THREE.WebGLRenderTarget(S, SH);
  const s2 = new THREE.Scene(), cam = new THREE.OrthographicCamera(-w / 2, w / 2, h, 0, -w * 2, w * 2), lit = new THREE.DirectionalLight(sun.color, sun.intensity);
  s2.environment = scene.environment; s2.environmentIntensity = scene.environmentIntensity; lit.position.copy(sky.dir).setZ(Math.abs(sky.dir.z) + 0.4);
  s2.add(new THREE.Mesh(branches, branchMat), new THREE.Mesh(leaves, leafMat), lit, new THREE.HemisphereLight(hemi.color, hemi.groundColor, hemi.intensity));
  cam.position.set((box.max.x + box.min.x) / 2, 0, w); cam.lookAt(cam.position.x, 0, 0);
  const clear = renderer.getClearColor(new THREE.Color()), alpha = renderer.getClearAlpha();
  renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(s2, cam); renderer.setRenderTarget(null); renderer.setClearColor(clear, alpha);
  const px = new Uint8Array(S * SH * 4); renderer.readRenderTargetPixels(rt, 0, 0, S, SH, px); rt.dispose();     // copied out, so no render target lingers
  const map = new THREE.DataTexture(px, S, SH); map.generateMipmaps = true; map.minFilter = THREE.LinearMipmapLinearFilter; map.magFilter = THREE.LinearFilter; map.needsUpdate = true;
  const cards = mergeGeometries([0, Math.PI / 2].map(a => { const p = new THREE.PlaneGeometry(w, h); p.translate(0, h / 2, 0); p.rotateY(a); return p; }));
  return { cards, map };
}
function buildTrees() {
  const bark = barkTexture();
  // every species is grown once (two levels of detail) and instanced wherever it stands
  const kinds = TREE_KINDS.map(k => ({ ...k, near: [], far: [] })), place = (x, z, h, hero) => {
    const k = kinds[hero ? hero % 3 : Math.floor(srnd(0, kinds.length))], y = groundH(x, z) - 0.3;
    const m = new THREE.Matrix4().compose(V.set(x, y, z), Q0.setFromEuler(E0.set(srnd(-0.03, 0.03), srnd(0, TAU), srnd(-0.03, 0.03))), V2.setScalar(1));
    const near = hero || (Math.abs(x) < 46 && z > -86);
    (near ? k.near : k.far).push({ m, h });
    return k;
  };
  HERO.forEach(([x, z, h], i) => { place(x, z, h, i + 1); trunks.push({ x, z, r: 1.15, top: groundH(x, z) + h * 0.6 }); });
  const placed = HERO.map(([x, z]) => [x, z]), count = Math.round(lerp(60, 120, Q.leaves));
  for (let tries = 0; tries < 1800 && placed.length < count; tries++) {
    const x = srnd(-96, 96), z = srnd(-150, 16);
    if (Math.abs(x) < 15 && z > -48) continue;
    if (Math.abs(x) < 6.5 && z > -80) continue;              // leave a window of sky down the path
    if (placed.some(([a, b]) => Math.hypot(a - x, b - z) < 6.2)) continue;
    placed.push([x, z]);
    const h = srnd(19, 31); place(x, z, h, 0);
    if (Math.abs(x) < 42 && z > -60) trunks.push({ x, z, r: 0.95, top: groundH(x, z) + h * 0.6 });
  }
  const barkTex = TEX.bark_diff ? TEX.bark_diff.clone() : bark, barkNor = TEX.bark_nor ? TEX.bark_nor.clone() : null;
  for (const t of [barkTex, barkNor]) if (t) { t.repeat.set(1, 0.12); t.needsUpdate = true; }
  barkMat = swayify(new THREE.MeshStandardMaterial({ map: barkTex, normalMap: barkNor, color: 0xd8cdbd, roughness: 0.95, metalness: 0 }));
  const flat = new THREE.MeshStandardMaterial({ map: barkTex, color: 0xd8cdbd, roughness: 0.95 });
  for (const k of kinds) {
    const { branches, leaves, height } = growTree(k, lerp(0.25, 1, Q.leaves));
    const leafMatK = canopyify(new THREE.MeshStandardMaterial({ map: TEX['leaf_' + k.leaf] || leafTex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8, metalness: 0, color: k.tint }));
    const scaled = (it, sc = it.h / height) => M0.copy(it.m).multiply(new THREE.Matrix4().makeScale(sc, sc, sc));
    if (k.near.length) {
      const bm = new THREE.InstancedMesh(branches, barkMat, k.near.length), lm = new THREE.InstancedMesh(leaves, leafMatK, k.near.length);
      k.near.forEach((it, n) => { scaled(it); bm.setMatrixAt(n, M0); lm.setMatrixAt(n, M0); lm.setColorAt(n, C0.setHSL(0.24, 0.12, srnd(0.82, 1))); });
      bm.castShadow = bm.receiveShadow = true; lm.castShadow = Q.shadow > 0;
      bm.frustumCulled = lm.frustumCulled = false; scene.add(bm, lm); leafMeshes.push(lm);
    }
    if (k.far.length) {                             // behind the haze a tree is two crossed cards of its own photograph
      const im = impostor(branches, flat, leaves, new THREE.MeshStandardMaterial({ map: leafMatK.map, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8, color: k.tint }));
      const fm = new THREE.InstancedMesh(im.cards, new THREE.MeshBasicMaterial({ map: im.map, alphaTest: 0.5, side: THREE.DoubleSide }), k.far.length);
      k.far.forEach((it, n) => { scaled(it); fm.setMatrixAt(n, M0); fm.setColorAt(n, C0.setScalar(srnd(0.85, 1))); });
      fm.frustumCulled = false; scene.add(fm);
    }
  }
  leafTex = leafTexture();

  // bushes hugging the clearing: EZ-Tree shrubs in the same twigs
  BUSH_KINDS.forEach((k, bi) => {
    const { branches, leaves, height } = growTree(k, lerp(0.4, 1, Q.leaves)), n = Math.round(lerp(10, 22, Q.leaves));
    const mat = canopyify(new THREE.MeshStandardMaterial({ map: TEX['leaf_' + k.leaf] || leafTex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8, metalness: 0, color: k.tint }));
    const bm = new THREE.InstancedMesh(branches, barkMat, n), lm = new THREE.InstancedMesh(leaves, mat, n);
    for (let i = 0; i < n; i++) {
      const side = srnd() < 0.5 ? -1 : 1, x = side * srnd(7, 34), z = srnd(-58, 8), sc = srnd(1.6, 3.2) / height;
      M0.compose(V.set(x, groundH(x, z) - 0.1, z), Q0.setFromAxisAngle(UP, srnd(0, TAU)), V2.set(sc, sc * srnd(0.8, 1.15), sc));
      bm.setMatrixAt(i, M0); lm.setMatrixAt(i, M0); lm.setColorAt(i, C0.setHSL(0.24, 0.14, srnd(0.78, 1)));
    }
    bm.castShadow = lm.castShadow = Q.shadow > 0; bm.frustumCulled = lm.frustumCulled = false; scene.add(bm, lm); leafMeshes.push(lm);
  });

  // nests on branches reaching in from the big trees
  const twigs = [];
  for (let i = 0; i < 46; i++) {
    const t = new THREE.CylinderGeometry(0.035, 0.05, srnd(0.8, 1.35), 4); t.rotateZ(Math.PI / 2 + srnd(-0.35, 0.35)); t.rotateX(srnd(-0.3, 0.3));
    const a = i / 46 * 6.28 * 2, rr = 0.62 + srnd(-0.1, 0.16); t.rotateY(-a + Math.PI / 2 + srnd(-0.5, 0.5)); t.translate(Math.cos(a) * rr, srnd(-0.2, 0.2), Math.sin(a) * rr); twigs.push(t.toNonIndexed());
  }
  const bowl = new THREE.SphereGeometry(0.82, 14, 8, 0, 6.3, Math.PI * 0.52, Math.PI * 0.48); bowl.translate(0, 0.08, 0);
  const nestGeo = mergeGeometries([...twigs, bowl.toNonIndexed()]);
  const nestMat = swayify(new THREE.MeshStandardMaterial({ color: 0xe8bd80, map: TEX.bark_diff || bark, roughness: 1 })), limbMat = swayify(new THREE.MeshStandardMaterial({ map: TEX.bark_diff || bark, normalMap: TEX.bark_nor || null, color: 0xd9cbb8, roughness: 0.95 }));
  HERO.forEach(([x, z, h], i) => {
    const dir = x < 0 ? 1 : -1, ny = groundH(x, z) + 6.2 + (i * 2.7) % 5, nx = x + dir * 3.5;
    const limb = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.34, 4.4, 8), limbMat); limb.position.set(x + dir * 1.8, ny - 0.5, z); limb.rotation.z = -dir * (Math.PI / 2 - 0.16);
    const n = new THREE.Mesh(nestGeo, nestMat); n.position.set(nx, ny, z); n.scale.setScalar(1.28);
    limb.castShadow = n.castShadow = true; scene.add(limb, n);
    nests.push({ x: nx, y: ny + 0.62, z, egg: null });
  });
}
function grassTuft() {                              // one tuft: thin tapered blades fanning out from a shared root, each arching over
  const blades = [], root = new THREE.Color('#33421c'), tip = new THREE.Color('#e4ecb0');
  for (let b = 0; b < 7; b++) {
    const g = new THREE.PlaneGeometry(1, 1, 1, 3); g.translate(0, 0.5, 0);
    const p = g.attributes.position, uv = g.attributes.uv, col = new Float32Array(p.count * 3);
    const h = srnd(0.55, 1), w = srnd(0.018, 0.032), arc = srnd(0.12, 0.42), a = b / 7 * 6.28 + srnd(-0.4, 0.4), r = srnd(0, 0.07), lean = srnd(0.05, 0.25);
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      p.setXYZ(i, p.getX(i) * w * (1 - y ** 1.6 * 0.96), y * h * (1 - arc * y * y * 0.35), lean * y + arc * y * y);
      uv.setY(i, y * h);                            // wind bends by height, so tall blades sway further than short ones
      C0.copy(root).lerp(tip, y ** 0.8 * 0.85); col.set([C0.r, C0.g, C0.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.rotateY(a + srnd(-0.5, 0.5)); g.translate(Math.cos(a) * r, 0, Math.sin(a) * r);
    blades.push(g);
  }
  return mergeGeometries(blades);
}
function buildGrass() {
  const g = grassTuft();
  const n = Q.grass, aN = new Float32Array(n * 3), aP = new Float32Array(n), mat = windify(new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, vertexColors: true, roughness: 0.85, metalness: 0 }), 'grass');
  grassMesh = new THREE.InstancedMesh(g, mat, n);
  const dry = new THREE.Color('#b7b45a');
  for (let i = 0; i < n; i++) {                     // densest at the player's feet, where single blades can be seen
    const far = srnd() ** 1.75, z = lerp(12.6, -62, far), span = lerp(13, 40, far), x = srnd(-span, span), path = Math.abs(x - Math.sin(z * 0.06) * 3.2);
    if (path < 1.6 && srnd() < 0.8) { i--; continue; }
    const h = srnd(0.2, 0.46) * (path < 2.6 ? 0.55 : 1) * lerp(1, 1.35, far), wide = lerp(1, 3.2, far);
    grassMesh.setMatrixAt(i, M0.compose(V.set(x, groundH(x, z) - 0.02, z), Q0.setFromAxisAngle(UP, srnd(0, 6.28)), V2.set(wide * srnd(0.8, 1.3), h, wide * srnd(0.8, 1.3))));
    grassMesh.setColorAt(i, C0.copy(pick(GREENS)).lerp(dry, srnd() < 0.12 ? srnd(0.4, 0.75) : srnd(0, 0.25)).multiplyScalar(srnd(0.78, 1.12)));
    aN.set([srnd(-0.25, 0.25), 1, srnd(-0.25, 0.25)], i * 3); aP[i] = srnd();
  }
  g.setAttribute('aN', new THREE.InstancedBufferAttribute(aN, 3)); g.setAttribute('aPhase', new THREE.InstancedBufferAttribute(aP, 1));
  grassMesh.frustumCulled = false; grassMesh.receiveShadow = Q.shadow > 0; scene.add(grassMesh);
}
function buildFrame() {                             // branches that overhang the corners of the view, hung on the camera
  const add = (n, fn) => { for (let i = 0; i < n; i++) frameItems.push(fn(srnd())); };
  for (const side of [-1, 1]) {
    add(66, u => ({ x: side * lerp(1.22, 0.26, u ** 1.3), y: 1.14 - u * u * 0.2 - srnd(0, 0.3) * (1 - u * 0.75), d: srnd(2.7, 5), s: srnd(0.3, 0.52), r: srnd(0, 6.28), rx: srnd(-0.55, 0.55), ry: srnd(-0.55, 0.55), l: srnd(0.42, 0.98) }));
    add(22, u => ({ x: side * lerp(1.2, 0.74, u), y: -1.12 + (1 - u) * srnd(0, 0.34), d: srnd(2.8, 4.6), s: srnd(0.26, 0.42), r: srnd(0, 6.28), rx: srnd(-0.5, 0.5), ry: srnd(-0.5, 0.5), l: srnd(0.3, 0.72) }));
  }
  const n = frameItems.length, g = new THREE.PlaneGeometry(1, 1), aN = new Float32Array(n * 3), aP = new Float32Array(n);
  frameMat = windify(new THREE.MeshStandardMaterial({ map: TEX.leaf_oak || leafTex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.78, metalness: 0 }), 'frame');
  frameMesh = new THREE.InstancedMesh(g, frameMat, n);
  frameItems.forEach((it, i) => {
    frameMesh.setColorAt(i, TEX.leaf_oak ? C0.setHSL(0.24, 0.1, lerp(0.5, 0.95, it.l)) : C0.copy(pick(GREENS)).multiplyScalar(it.l)); aP[i] = srnd();
    aN.set([it.x * 0.35, 0.72, 0.6], i * 3);
  });
  g.setAttribute('aN', new THREE.InstancedBufferAttribute(aN, 3)); g.setAttribute('aPhase', new THREE.InstancedBufferAttribute(aP, 1));
  frameMesh.frustumCulled = false; frameMesh.renderOrder = 6;
  camera.add(frameMesh);
}
function layoutFrame() {
  const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)), a = camera.aspect, k = Math.min(1, 0.55 + a * 0.75);
  frameItems.forEach((it, i) => {
    const hh = it.d * tan;
    frameMesh.setMatrixAt(i, M0.compose(V.set(it.x * hh * a, it.y * hh, -it.d), Q0.setFromEuler(E0.set(it.rx, it.ry, it.r)), V2.setScalar(it.s * hh * k * 1.5)));
  });
  frameMesh.instanceMatrix.needsUpdate = true;
}
function buildAir() {
  const tex = softTexture();
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide }));
    m.userData = { x: -30 + i * 12 + srnd(-3, 3), w: srnd(5, 11), o: srnd(0.05, 0.13), ph: srnd(0, 6.28) };
    m.position.set(m.userData.x, 16, -48 + srnd(-5, 5)); m.scale.set(m.userData.w, 62, 1); m.renderOrder = 4;
    shafts.push(m); scene.add(m);
  }
  const n = 110, g = new THREE.PlaneGeometry(0.34, 0.34), aN = new Float32Array(n * 3), aP = new Float32Array(n);
  for (let i = 0; i < n; i++) { aN.set([0, 1, 0.3], i * 3); aP[i] = srnd(); }
  g.setAttribute('aN', new THREE.InstancedBufferAttribute(aN, 3)); g.setAttribute('aPhase', new THREE.InstancedBufferAttribute(aP, 1));
  fallLeaves = new THREE.InstancedMesh(g, frameMat, n); fallLeaves.frustumCulled = false;
  const tints = hex('#6faa3a', '#d6a636', '#c9702e', '#3f9440');
  for (let i = 0; i < n; i++) {
    fallData.push({ x: srnd(-30, 30), y: srnd(0, 24), z: srnd(-48, 11), s: srnd(0.5, 1.5), sp: srnd(0.7, 1.5), ph: srnd(0, 6.28), w: srnd(1.5, 2.8), a: srnd(0.8, 1.7), yaw: srnd(0, 6.28) });
    fallLeaves.setColorAt(i, tints[i % tints.length]);
  }
  scene.add(fallLeaves);

  const fn = 130, pos = new Float32Array(fn * 3), ph = new Float32Array(fn);
  for (let i = 0; i < fn; i++) { const x = srnd(-30, 30), z = srnd(-50, 8); pos.set([x, groundH(x, z) + srnd(0.6, 8), z], i * 3); ph[i] = srnd(0, 6.28); }
  const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); fg.setAttribute('aPh', new THREE.BufferAttribute(ph, 1));
  fireflies = new THREE.Points(fg, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: shared.time, uA: { value: 0 }, uScale: { value: 300 } },
    vertexShader: `attribute float aPh; uniform float uTime, uScale; varying float vF;
      void main() { vec3 p = position; p.x += sin(uTime * 0.5 + aPh) * 1.5; p.y += sin(uTime * 0.8 + aPh * 2.0) * 0.8; p.z += cos(uTime * 0.4 + aPh) * 1.5;
        vF = pow(0.5 + 0.5 * sin(uTime * 2.2 + aPh * 3.0), 3.0); vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_PointSize = uScale * 0.42 / max(-mv.z, 1.0); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uA; varying float vF;
      void main() { float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(vec3(1.5, 1.7, 0.5) * a * a * vF * uA, a * a * vF * uA);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  fireflies.frustumCulled = false; scene.add(fireflies);
}
const fallQ = new THREE.Quaternion(), wind = { x: 0, z: 0 }, gusts = { v: 0, to: 0.3, t: 2 }, blast = { x: 0, z: 0, r: 0, a: 0 };
function updateWind(dt) {
  gusts.t -= dt;
  if (gusts.t <= 0) {
    gusts.t = rnd(2.4, 7); gusts.to = Math.random() < 0.3 ? rnd(1.1, 1.7) : rnd(0.15, 0.7);
    if (ambient) ambient.f.frequency.setTargetAtTime(380 + gusts.to * 420, ac.currentTime, 0.9);
  }
  gusts.to *= Math.exp(-0.18 * dt);
  gusts.v += (gusts.to - gusts.v) * (1 - Math.exp(-1.4 * dt));
  shared.gust.value = gusts.v;
  wind.x = WIND_DIR.x * (0.35 + gusts.v * 1.25); wind.z = WIND_DIR.y * (0.35 + gusts.v * 1.25);
  if (blast.a > 0) {                                // the fireball's shockwave runs out through grass and leaves
    blast.r += 30 * dt; blast.a *= Math.exp(-2.8 * dt); if (blast.a < 0.01) blast.a = 0;
    shared.blast.value.set(blast.x, blast.z, blast.r, blast.a);
  }
}
function updateAir(dt) {
  const t = shared.time.value;
  for (let i = 0; i < fallData.length; i++) {       // a leaf falls by slipping side to side, dropping fastest through the bottom of each swing
    const f = fallData[i]; f.ph += f.w * dt;
    const sw = Math.sin(f.ph), cw = Math.cos(f.ph);
    f.y -= f.sp * (0.62 + 0.5 * cw * cw) * dt;
    f.x += (Math.cos(f.yaw) * sw * f.a + wind.x) * dt; f.z += (Math.sin(f.yaw) * sw * f.a + wind.z * 0.6) * dt;
    if (f.y < 0.1 || f.x > camera.position.x + 36) { f.y = rnd(16, 26); f.x = camera.position.x + rnd(-34, 22); f.z = rnd(-46, 11); }
    fallLeaves.setMatrixAt(i, M0.compose(V.set(f.x, f.y, f.z), fallQ.setFromEuler(E1.set(-Math.PI / 2 + cw * 0.72, f.yaw + sw * 0.3, sw * 0.62)), V2.setScalar(f.s)));
  }
  fallLeaves.instanceMatrix.needsUpdate = true;
  fireflies.material.uniforms.uA.value = sky.star;
  for (const m of shafts) {
    const u = m.userData; m.rotation.z = clamp(sky.dir.x * -0.8, -0.6, 0.6);
    m.material.opacity = sky.shaft * u.o * (0.65 + 0.35 * Math.sin(t * 0.5 + u.ph));
    m.visible = m.material.opacity > 0.004;
    m.material.color.copy(sky.sun);
  }
}

/* ---------- birds and eggs ---------- */
const KINDS = {                                    // anim is how fast the model's flap clip plays; each species has its own way of staying in the air
  finch: { name: 'Parrot', pts: 10, hp: 1, r: 1.1, scale: 1.45, speed: [5, 7.5], body: '#d8402c', belly: '#f2c94c', wing: '#2f6fc0', tip: '#1c3f80', anim: 2.1, beat: 7.4, gait: 'bound', climb: 2.6, vyMax: 5.5, resp: 5.5, bank: 0.7, flapFor: [0.3, 0.58], glideFor: [0.16, 0.3] },
  swift: { name: 'Flamingo', pts: 25, hp: 1, r: 1.05, scale: 1.4, speed: [8, 11], body: '#f28aa0', belly: '#f8c6d0', wing: '#e0607a', tip: '#2a2a2a', anim: 1.7, beat: 9.4, gait: 'scythe', climb: 3.6, vyMax: 8, resp: 6.5, bank: 0.9, flapFor: [0.5, 0.9], glideFor: [0.45, 1.05] },
  raven: { name: 'Stork', pts: 40, hp: 2, r: 1.6, scale: 2.1, speed: [4, 5.5], body: '#f2f0ea', belly: '#ffffff', wing: '#2b2b2b', tip: '#111111', anim: 1.1, beat: 3.2, gait: 'soar', climb: 1.4, vyMax: 3.2, resp: 2.4, bank: 0.5, flapFor: [1.1, 2.3], glideFor: [1.1, 2.4] },
};
const birdModels = {}, pools = { finch: [], swift: [], raven: [], egg: [], gold: [] };
let eggGeo, eggMats;
const flora = {};
async function loadFlora() {                        // grass clump and wildflowers from the EZ-Tree demo (MIT, Daniel Greenheck)
  const loader = new GLTFLoader();
  await Promise.all(['grass', 'flower_white', 'flower_yellow', 'flower_blue'].map(n =>
    loader.loadAsync(new URL(`./models/${n}.glb`, import.meta.url).href).then(gl => { gl.scene.updateMatrixWorld(true); flora[n] = gl.scene; }, () => {})));
}
function buildMeadow() {                            // a carpet of photographed grass clumps over the clearing, wildflowers through it
  if (!flora.grass) return;
  let src; flora.grass.traverse(o => { if (o.isMesh) src = o; });
  const g = src.geometry.clone().applyMatrix4(src.matrixWorld); g.computeBoundingBox();
  const b = g.boundingBox, hgt = b.max.y - b.min.y;
  g.translate(-(b.max.x + b.min.x) / 2, -b.min.y, -(b.max.z + b.min.z) / 2); g.scale(1 / hgt, 1 / hgt, 1 / hgt);      // unit height, root at 0
  const n = Q.meadow, aN = new Float32Array(n * 3), aP = new Float32Array(n);
  const mat = windify(new THREE.MeshStandardMaterial({ map: src.material.map, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.85, metalness: 0 }), 'clump');
  const mesh = new THREE.InstancedMesh(g, mat, n), lush = hex('#5f9a34', '#4c8a2c', '#78a83c', '#3f7a2a'), dry = new THREE.Color('#b3b45c');
  for (let i = 0; i < n; i++) {                     // thickest in front of the player, thinning into the trees
    const far = srnd() ** 1.7, z = lerp(12.4, -66, far), span = lerp(13, 42, far), x = srnd(-span, span), path = Math.abs(x - Math.sin(z * 0.06) * 3.2);
    if (path < 1.3 && srnd() < 0.85) { i--; continue; }
    const patch = 0.6 + 0.8 * fbm(x * 0.12 + 3, z * 0.12), h = srnd(0.32, 0.72) * patch * (path < 2.6 ? 0.6 : 1) * lerp(1, 1.5, far), w = h * srnd(1.1, 1.7);
    mesh.setMatrixAt(i, M0.compose(V.set(x, groundH(x, z) - 0.03, z), Q0.setFromAxisAngle(UP, srnd(0, TAU)), V2.set(w, h, w)));
    mesh.setColorAt(i, C0.copy(pick(lush)).lerp(dry, srnd() < 0.15 ? srnd(0.3, 0.6) : srnd(0, 0.15)).multiplyScalar(srnd(0.85, 1.15)));
    aN.set([srnd(-0.2, 0.2), 1, srnd(-0.2, 0.2)], i * 3); aP[i] = srnd();
  }
  g.setAttribute('aN', new THREE.InstancedBufferAttribute(aN, 3)); g.setAttribute('aPhase', new THREE.InstancedBufferAttribute(aP, 1));
  mesh.frustumCulled = false; mesh.receiveShadow = Q.shadow > 0; scene.add(mesh); meadowMesh = mesh;

  for (const kind of ['flower_white', 'flower_yellow', 'flower_blue']) {      // each part of a flower is one instanced draw
    const fs = flora[kind]; if (!fs) continue;
    const box = new THREE.Box3().setFromObject(fs), k = Math.round(lerp(18, 50, Q.leaves)), spots = [];
    for (let i = 0; i < k; i++) {
      const far = srnd() ** 1.6, z = lerp(11, -46, far), x = (srnd() < 0.5 ? -1 : 1) * srnd(2.6, lerp(12, 30, far)), sc = srnd(0.32, 0.5) / (box.max.y - box.min.y);
      spots.push(new THREE.Matrix4().compose(V.set(x, groundH(x, z) - 0.02, z), Q0.setFromAxisAngle(UP, srnd(0, TAU)), V2.setScalar(sc)));
    }
    fs.traverse(o => {
      if (!o.isMesh) return;
      const im = new THREE.InstancedMesh(o.geometry, o.material, k);
      spots.forEach((m, i) => im.setMatrixAt(i, M0.multiplyMatrices(m, o.matrixWorld)));
      im.frustumCulled = false; scene.add(im);
    });
  }
}
async function loadBirds() {                        // Parrot, Flamingo and Stork by mirada (ro.me), from the three.js examples, MIT
  const loader = new GLTFLoader(), mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.92, metalness: 0 });
  await Promise.all(Object.entries(KINDS).map(async ([kind, K]) => {
    const gl = await loader.loadAsync(new URL(`./models/${K.name}.glb`, import.meta.url).href);
    let mesh; gl.scene.traverse(o => { if (o.isMesh) mesh = o; });
    mesh.material = mat;
    const box = new THREE.Box3().setFromObject(mesh), size = box.getSize(new THREE.Vector3()), s = 3.8 / size.x;   // every species gets the same wingspan before its own scale
    birdModels[kind] = { mesh, clip: gl.animations[0], s, off: box.getCenter(new THREE.Vector3()).multiplyScalar(-s) };
  }));
}
function makeBird(kind) {
  const M = birdModels[kind], g = new THREE.Group(), m = M.mesh.clone();
  m.scale.setScalar(M.s); m.position.copy(M.off); m.castShadow = true; g.add(m);
  const mixer = new THREE.AnimationMixer(m), act = mixer.clipAction(M.clip).play(); act.time = rnd(0, M.clip.duration);
  return { g, mixer, act, head: new THREE.Object3D(), tail: new THREE.Object3D() };
}
function buildEggs() {
  const pts = []; for (let i = 0; i <= 26; i++) { const t = i / 26 * Math.PI, y = -Math.cos(t), r = Math.sin(t) * (0.76 - 0.14 * y); pts.push(new THREE.Vector2(Math.max(r, 0.0001), y)); }
  eggGeo = new THREE.LatheGeometry(pts, 26); eggGeo.computeVertexNormals();
  const envScene = new THREE.Scene(), envMesh = new THREE.Mesh(new THREE.SphereGeometry(5, 24, 16), new THREE.ShaderMaterial({ side: THREE.BackSide, vertexShader: 'varying vec3 p; void main(){ p = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }', fragmentShader: 'varying vec3 p; void main(){ float y = normalize(p).y; gl_FragColor = vec4(mix(vec3(0.16, 0.2, 0.05), vec3(3.4, 2.7, 1.3), smoothstep(-0.3, 0.75, y)), 1.0); }' }));
  envScene.add(envMesh);
  const pm = new THREE.PMREMGenerator(renderer), env = pm.fromScene(envScene, 0.03).texture; pm.dispose();
  eggMats = {
    egg: addRim(new THREE.MeshStandardMaterial({ map: eggTexture('#f4e9cf', '#7b5a36', 150), roughness: 0.42 })),
    blue: addRim(new THREE.MeshStandardMaterial({ map: eggTexture('#a6dcd6', '#2f5a56', 110), roughness: 0.38 })),
    gold: addRim(new THREE.MeshStandardMaterial({ color: 0xffc73a, metalness: 1, roughness: 0.2, envMap: env, envMapIntensity: 1.25, emissive: 0xb86f08, emissiveIntensity: 0.3 })),
  };
}
let halfTop, halfBot, shellInner;
function buildShell() {
  const make = top => {                             // half a shell with a jagged broken rim
    const rows = 13, cols = 24, pts = [];
    for (let i = 0; i < rows; i++) { const t = (top ? lerp(0.46, 1, i / (rows - 1)) : lerp(0, 0.54, i / (rows - 1))) * Math.PI, y = -Math.cos(t), r = Math.sin(t) * (0.76 - 0.14 * y); pts.push(new THREE.Vector2(Math.max(r, 0.0001), y)); }
    const g = new THREE.LatheGeometry(pts, cols), P = g.attributes.position;
    for (let c = 0; c <= cols; c++) for (let r = 0; r < rows; r++) {
      const w = (top ? 1 - r / (rows - 1) : r / (rows - 1)) ** 3, j = c % cols, zig = (j % 2 ? 0.15 : -0.15) * (0.6 + 0.4 * Math.sin(j * 1.7)), k = c * rows + r;
      P.setY(k, P.getY(k) + zig * w);
    }
    g.translate(0, top ? -0.5 : 0.5, 0); g.computeVertexNormals();
    return g;
  };
  halfTop = make(true); halfBot = make(false);
  shellInner = new THREE.MeshLambertMaterial({ color: 0xfff6e4, side: THREE.BackSide });
}
function makeHalf(top) {
  const g = new THREE.Group(), o = new THREE.Mesh(top ? halfTop : halfBot, eggMats.egg), i = new THREE.Mesh(top ? halfTop : halfBot, shellInner);
  i.scale.setScalar(0.975); o.castShadow = true; g.add(o, i); g.userData.outer = o;
  return g;
}
function makeEgg(kind) {
  const m = new THREE.Mesh(eggGeo, kind === 'gold' ? eggMats.gold : Math.random() < 0.5 ? eggMats.egg : eggMats.blue);
  m.castShadow = true;
  const g = new THREE.Group(); g.add(m);
  return { g, mesh: m };
}

/* ---------- slingshot ---------- */
const sling = { x: 0, tx: 0, v: 0 }, pouch = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }, aim = { on: false, id: null, sx: 0, sy: 0, px: 0, py: 0, len: 0, pw: 0 }, move = { id: null };
const RAIL = 9, SLING_D = 2.75;
let rig, bandL, bandR, pouchMesh, loaded, loadedFire, guide, woodMat, loadAge = 1;
const rigBase = new THREE.Vector3(), fork = { a: 0, v: 0, y: 0 }, BAND_N = 10, BAND_REST = 0.45, bandT = new THREE.Vector3(), bandS = new THREE.Vector3(), bandU = new THREE.Vector3(), BAND_FACE = new THREE.Vector3(0, 0.38, 1).normalize();
const TIP_L = new THREE.Vector3(-0.42, 0.62, 0), TIP_R = new THREE.Vector3(0.42, 0.62, 0), REST = new THREE.Vector3(0, 0.56, 0.02);
function limb(pts, r0, r1) {                       // a turned, sanded branch: the tube narrows from r0 to r1 along its length
  const curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p))), TS = 24, RS = 14, g = new THREE.TubeGeometry(curve, TS, 1, RS, false);
  const p = g.attributes.position, n = g.attributes.normal;
  for (let i = 0; i <= TS; i++) {
    const t = i / TS, c = curve.getPointAt(t), r = lerp(r0, r1, t) * (1 + 0.035 * Math.sin(t * 9 + r0 * 40));
    for (let k = 0; k <= RS; k++) { const v = i * (RS + 1) + k; p.setXYZ(v, c.x + n.getX(v) * r, c.y + n.getY(v) * r, c.z + n.getZ(v) * r); }
  }
  return { g, curve };
}
function endCap(curve, t, r, out) {                 // the cut end: flat with a softened edge
  const c = new THREE.SphereGeometry(r, 14, 5, 0, TAU, 0, Math.PI / 2); c.scale(1, 0.32, 1);
  const tan = curve.getTangentAt(t); if (!out) tan.negate();
  c.applyQuaternion(Q0.setFromUnitVectors(UP, tan)); const at = curve.getPointAt(t); c.translate(at.x, at.y, at.z);
  return c;
}
function buildSling() {                             // a whittled ash fork, amber latex tubes wrapped at the tips, a tan leather pouch
  rig = new THREE.Group(); camera.add(rig);
  const wood = woodMat = new THREE.MeshStandardMaterial({ map: TEX.wood_diff || barkTexture(), roughnessMap: TEX.wood_rough || null, color: TEX.wood_diff ? 0xffe4c4 : 0xffd9a8, roughness: 0.82, metalness: 0 });
  const latex = new THREE.MeshStandardMaterial({ color: 0xd29a52, roughness: 0.38, metalness: 0 });
  const leather = new THREE.MeshStandardMaterial({ normalMap: TEX.leather_nor || null, color: 0xc49a66, roughness: 0.8, side: THREE.DoubleSide });
  const handle = limb([[0, -1.62, 0.04], [0.008, -0.9, 0.01], [0, -0.2, 0]], 0.094, 0.084);
  const arms = [-1, 1].map(s => limb([[0, -0.22, 0], [s * 0.1, 0.04, 0], [s * 0.27, 0.3, 0], [s * 0.38, 0.54, 0], [s * 0.41, 0.76, 0]], 0.08, 0.066));
  const crotch = new THREE.SphereGeometry(0.09, 16, 12); crotch.scale(1.05, 1.25, 0.94); crotch.translate(0, -0.17, 0);
  const parts = [handle.g, ...arms.map(a => a.g), crotch, endCap(handle.curve, 0, 0.094, false), ...arms.map(a => endCap(a.curve, 1, 0.066, true))].map(g => { const ng = g.index ? g.toNonIndexed() : g; ng.deleteAttribute('uv'); return ng; });
  const woodGeo = mergeGeometries(parts);
  const wp = woodGeo.attributes.position, uv = new Float32Array(wp.count * 2);      // grain runs up the fork, the way the branch grew
  for (let i = 0; i < wp.count; i++) { uv[i * 2] = wp.getY(i) * 0.9; uv[i * 2 + 1] = (wp.getX(i) + wp.getZ(i)) * 1.4; }
  woodGeo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const fork_ = new THREE.Mesh(woodGeo, wood); fork_.castShadow = true; rig.add(fork_);
  arms.forEach((a, k) => {                          // three turns of tube round each tip, the band's own end tied off in them
    const tip = k ? TIP_R : TIP_L;
    for (let w = 0; w < 3; w++) {
      let best = 0, bd = 9; for (let t = 0.6; t <= 1; t += 0.01) { const d = a.curve.getPointAt(t).distanceTo(tip); if (d < bd) { bd = d; best = t; } }
      const t = clamp(best + (w - 1) * 0.035, 0, 0.97), at = a.curve.getPointAt(t), r = lerp(0.08, 0.066, t) + 0.012;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.014, 8, 20), latex);
      ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), a.curve.getTangentAt(t)); ring.position.copy(at); rig.add(ring);
    }
  });
  bandL = makeBand(latex); bandR = makeBand(latex);
  const pad = new THREE.Shape(), PW = 0.19, PH = 0.075, PR = 0.03;
  pad.moveTo(-PW + PR, -PH); pad.lineTo(PW - PR, -PH); pad.quadraticCurveTo(PW, -PH, PW, -PH + PR); pad.lineTo(PW, PH - PR); pad.quadraticCurveTo(PW, PH, PW - PR, PH);
  pad.lineTo(-PW + PR, PH); pad.quadraticCurveTo(-PW, PH, -PW, PH - PR); pad.lineTo(-PW, -PH + PR); pad.quadraticCurveTo(-PW, -PH, -PW + PR, -PH);
  for (const sx of [-1, 1]) { const h = new THREE.Path(); h.absellipse(sx * (PW - 0.04), 0, 0.016, 0.026, 0, TAU, false); pad.holes.push(h); }
  const pg = new THREE.ShapeGeometry(pad, 6), pp = pg.attributes.position, puv = pg.attributes.uv;
  for (let i = 0; i < pp.count; i++) { const x = pp.getX(i); pp.setZ(i, -x * x * 2.6); puv.setXY(i, x * 2.2 + 0.5, pp.getY(i) * 2.2 + 0.5); }   // cupped round the stone
  pg.computeVertexNormals();
  pouchMesh = new THREE.Mesh(pg, leather); pouchMesh.castShadow = true; rig.add(pouchMesh);
  loaded = new THREE.Mesh(stoneGeo(), new THREE.MeshStandardMaterial({ color: 0x9a968a, roughness: 0.72 })); loaded.scale.setScalar(0.105); rig.add(loaded);
  loadedFire = new THREE.Mesh(new THREE.SphereGeometry(0.115, 14, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 2.1, 0.5), fog: false })); loadedFire.visible = false; rig.add(loadedFire);
  guide = new THREE.InstancedMesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 1.42, 1.1), fog: false }), 13);
  guide.frustumCulled = false; guide.count = 0; scene.add(guide);
}
let _stone;
function stoneGeo() {
  if (_stone) return _stone;
  const g = new THREE.IcosahedronGeometry(1, 1), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { V.fromBufferAttribute(p, i); const k = 0.86 + 0.26 * vnoise(V.x * 1.6 + V.z + 3, V.y * 1.6 + 4); p.setXYZ(i, V.x * k, V.y * k * 0.88, V.z * k); }
  g.computeVertexNormals();
  return _stone = g;
}
const BAND_R = 7;
function makeBand(mat) {                            // a round latex tube, simulated as a chain so it whips and goes slack
  const g = new THREE.BufferGeometry(), idx = [];
  for (let i = 0; i < BAND_N - 1; i++) for (let k = 0; k < BAND_R; k++) {
    const a = i * BAND_R + k, b = i * BAND_R + (k + 1) % BAND_R; idx.push(a, b, a + BAND_R, b, b + BAND_R, a + BAND_R);
  }
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BAND_N * BAND_R * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(BAND_N * BAND_R * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setIndex(idx);
  const mesh = new THREE.Mesh(g, mat); mesh.frustumCulled = false; rig.add(mesh);
  return { mesh, pts: Array.from({ length: BAND_N }, () => new THREE.Vector3()), prev: Array.from({ length: BAND_N }, () => new THREE.Vector3()), live: false };
}
function stepBand(b, A, C, dt) {
  const N = BAND_N, dist = A.distanceTo(C), seg = Math.max(dist, BAND_REST) / (N - 1), P = b.pts, O = b.prev;
  if (!b.live) { for (let i = 0; i < N; i++) { P[i].lerpVectors(A, C, i / (N - 1)); O[i].copy(P[i]); } b.live = true; }
  P[0].copy(A); P[N - 1].copy(C);
  for (let i = 1; i < N - 1; i++) {
    const p = P[i], q = O[i], x = p.x, y = p.y, z = p.z;
    p.x += (x - q.x) * 0.94; p.y += (y - q.y) * 0.94 - 2.8 * dt * dt; p.z += (z - q.z) * 0.94;
    q.set(x, y, z);
  }
  for (let it = 0; it < 6; it++) for (let i = 0; i < N - 1; i++) {
    const a = P[i], c = P[i + 1], wa = i === 0 ? 0 : 1, wc = i + 1 === N - 1 ? 0 : 1, sum = wa + wc; if (!sum) continue;
    bandT.subVectors(c, a); const d = bandT.length(); if (d <= seg || d < 1e-5) continue;
    const k = (d - seg) / d / sum;
    a.addScaledVector(bandT, k * wa); c.addScaledVector(bandT, -k * wc);
  }
  const w = 0.019 * Math.sqrt(clamp(BAND_REST / Math.max(dist, 0.01), 0.42, 1)), pos = b.mesh.geometry.attributes.position, nor = b.mesh.geometry.attributes.normal;   // thins as it stretches
  for (let i = 0; i < N; i++) {
    bandT.subVectors(P[Math.min(i + 1, N - 1)], P[Math.max(i - 1, 0)]).normalize();
    bandS.crossVectors(bandT, BAND_FACE); if (bandS.lengthSq() < 1e-4) bandS.set(1, 0, 0); bandS.normalize();
    bandU.crossVectors(bandS, bandT);
    for (let k = 0; k < BAND_R; k++) {
      const a = k / BAND_R * TAU, cx = Math.cos(a), cy = Math.sin(a), nx = bandS.x * cx + bandU.x * cy, ny = bandS.y * cx + bandU.y * cy, nz = bandS.z * cx + bandU.z * cy, v = i * BAND_R + k;
      pos.setXYZ(v, P[i].x + nx * w, P[i].y + ny * w, P[i].z + nz * w); nor.setXYZ(v, nx, ny, nz);
    }
  }
  pos.needsUpdate = nor.needsUpdate = true;
}
function updateSlingMesh(dt) {
  V3.set(REST.x + pouch.x, REST.y + pouch.y, REST.z + pouch.z);
  stepBand(bandL, TIP_L, V3, dt); stepBand(bandR, TIP_R, V3, dt);
  pouchMesh.position.set(V3.x, V3.y, V3.z + 0.05); pouchMesh.rotation.set(clamp(pouch.z * 0.8, -0.7, 0.9), 0, -pouch.x * 0.7);
  loadAge += dt;
  const k = sstep(0, 0.13, loadAge), show = loadAge >= 0 && state === 'play' || state === 'menu';   // the next stone is set into the pouch from below
  loaded.position.set(V3.x, V3.y - 0.46 * (1 - k), V3.z + 0.3 * (1 - k)); loadedFire.position.copy(loaded.position);
  loaded.scale.setScalar(0.105 * (0.6 + 0.4 * k));
  loaded.visible = show && !fireLoaded; loadedFire.visible = show && fireLoaded;
  if (loadedFire.visible) loadedFire.scale.setScalar((0.6 + 0.4 * k) * (1 + (vnoise(shared.time.value * 14, 2.5) - 0.5) * 0.3));
}

/* ---------- particles ---------- */
const SPARKS = 460, sp = { i: 0, p: new Float32Array(SPARKS * 3), c: new Float32Array(SPARKS * 3), s: new Float32Array(SPARKS), v: new Float32Array(SPARKS * 3), life: new Float32Array(SPARKS), max: new Float32Array(SPARKS), base: new Float32Array(SPARKS), g: new Float32Array(SPARKS) };
let sparkPts, smokePts, feathers, shells, yolks;
const SMOKE = 80, sm = { i: 0, p: new Float32Array(SMOKE * 3), c: new Float32Array(SMOKE * 3), s: new Float32Array(SMOKE), a: new Float32Array(SMOKE), v: new Float32Array(SMOKE * 3), life: new Float32Array(SMOKE), max: new Float32Array(SMOKE), base: new Float32Array(SMOKE), rise: new Float32Array(SMOKE), peak: new Float32Array(SMOKE) };
function buildFx() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(sp.p, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aC', new THREE.BufferAttribute(sp.c, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aS', new THREE.BufferAttribute(sp.s, 1).setUsage(THREE.DynamicDrawUsage));
  sparkPts = new THREE.Points(g, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uScale: { value: 300 } },
    vertexShader: `attribute vec3 aC; attribute float aS; uniform float uScale; varying vec3 vC;
      void main() { vC = aC; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = min(aS * uScale / max(-mv.z, 0.5), uScale * 0.09); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying vec3 vC; void main() { float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.05, d); gl_FragColor = vec4(vC * a * a, a * a);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
  }));
  sparkPts.frustumCulled = false; sparkPts.renderOrder = 8; scene.add(sparkPts);

  const fs = new THREE.Shape(); fs.moveTo(0, -0.5); fs.quadraticCurveTo(0.22, -0.1, 0.1, 0.5); fs.quadraticCurveTo(-0.2, 0.15, 0, -0.5);
  feathers = debris(new THREE.ShapeGeometry(fs, 5), 200, 'flutter');
  shells = debris(new THREE.CircleGeometry(0.5, 5), 150, 'chip');
  yolks = debris(new THREE.IcosahedronGeometry(0.5, 1), 48, 'goo');

  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(sm.p, 3).setUsage(THREE.DynamicDrawUsage));
  sg.setAttribute('aC', new THREE.BufferAttribute(sm.c, 3).setUsage(THREE.DynamicDrawUsage));
  sg.setAttribute('aS', new THREE.BufferAttribute(sm.s, 1).setUsage(THREE.DynamicDrawUsage));
  sg.setAttribute('aA', new THREE.BufferAttribute(sm.a, 1).setUsage(THREE.DynamicDrawUsage));
  smokePts = new THREE.Points(sg, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, uniforms: { uScale: { value: 300 }, uLit: shared.lit },
    vertexShader: `attribute vec3 aC; attribute float aS, aA; uniform float uScale; varying vec3 vC; varying float vA;
      void main() { vC = aC; vA = aA; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = min(aS * uScale / max(-mv.z, 0.5), uScale * 0.22); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uLit; varying vec3 vC; varying float vA;
      void main() { vec2 p = gl_PointCoord - 0.5; float d = length(p), b = 0.76 + 0.24 * sin(p.x * 17.0 + vA * 9.0) * cos(p.y * 14.0 - vA * 7.0), a = smoothstep(0.5, 0.08, d) * b * vA;
        if (a < 0.005) discard; gl_FragColor = vec4(vC * uLit, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  smokePts.frustumCulled = false; smokePts.renderOrder = 7; scene.add(smokePts);
}
function debris(geo, n, mode) {
  const m = new THREE.InstancedMesh(geo, mode === 'goo' ? new THREE.MeshStandardMaterial({ roughness: 0.22, emissive: 0xc46f00, emissiveIntensity: 0.62 }) : new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), n);
  m.frustumCulled = false; m.count = n; scene.add(m);
  const items = Array.from({ length: n }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Vector3(), w: new THREE.Vector3(), life: 0, max: 1, s: 1, drag: 1, g: 1, gy: 0, rest: false, ph: 0, fw: 4, fa: 3, yaw: 0 }));
  for (let i = 0; i < n; i++) { m.setMatrixAt(i, M0.makeScale(0, 0, 0)); m.setColorAt(i, C0.set(0xffffff)); }
  return { m, items, i: 0, mode };
}
function emitDebris(D, pos, n, col, speed, size, life, drag, grav) {
  const gy = groundH(pos.x, pos.z) + 0.05;
  for (let k = 0; k < n; k++) {
    const it = D.items[D.i]; it.p.copy(pos);
    it.v.set(rnd(-1, 1), rnd(-0.4, 1.1), rnd(-1, 1)).normalize().multiplyScalar(speed * rnd(0.3, 1));
    it.r.set(rnd(0, 6), rnd(0, 6), rnd(0, 6)); it.w.set(rnd(-7, 7), rnd(-7, 7), rnd(-7, 7));
    it.life = it.max = life * rnd(0.7, 1.2); it.s = size * rnd(0.6, 1.2); it.drag = drag; it.g = grav;
    it.gy = gy; it.rest = false; it.ph = rnd(0, 6.28); it.fw = rnd(3.2, 5.6); it.fa = rnd(2.2, 4.4); it.yaw = rnd(0, 6.28);
    D.m.setColorAt(D.i, C0.set(Array.isArray(col) ? pick(col) : col));
    D.i = (D.i + 1) % D.items.length;
  }
  D.m.instanceColor.needsUpdate = true;
}
function updateDebris(D, dt) {
  const flutter = D.mode === 'flutter', goo = D.mode === 'goo';
  let any = false;
  for (let i = 0; i < D.items.length; i++) {
    const it = D.items[i]; if (it.life <= 0) continue;
    any = true; it.life -= dt;
    if (it.life <= 0) { D.m.setMatrixAt(i, M0.makeScale(0, 0, 0)); continue; }
    if (!it.rest) {
      it.v.multiplyScalar(Math.exp(-it.drag * dt)); it.v.y -= it.g * dt;
      if (flutter) {                                // air catches a feather and slides it side to side as it sinks
        it.ph += it.fw * dt; const sw = Math.sin(it.ph);
        it.v.x += (Math.cos(it.yaw) * sw * it.fa + wind.x) * dt; it.v.z += (Math.sin(it.yaw) * sw * it.fa + wind.z) * dt;
      }
      it.p.addScaledVector(it.v, dt); it.r.addScaledVector(it.w, dt);
      if (it.p.y < it.gy) {
        it.p.y = it.gy; if (it.v.y < 0) it.v.y *= goo || flutter ? 0 : -0.34;
        it.v.x *= 0.55; it.v.z *= 0.55; it.w.multiplyScalar(0.5);
        if (Math.abs(it.v.y) < 0.6) { it.rest = true; it.v.set(0, 0, 0); it.life = Math.min(it.life, rnd(0.8, 1.5)); }
      }
    }
    const size = it.s * Math.min(1, it.life / 0.32);
    if (goo) {
      if (it.rest) M0.compose(it.p, Q0.identity(), V.set(size * 1.7, size * 0.1, size * 1.7));
      else {
        const l = it.v.length(), k = 1 + Math.min(l * 0.035, 0.5), wd = size / Math.sqrt(k);
        if (l > 0.01) Q0.setFromUnitVectors(UP, V.copy(it.v).divideScalar(l)); else Q0.identity();
        M0.compose(it.p, Q0, V.set(wd, size * k, wd));
      }
    } else if (flutter && !it.rest) {
      const k = sstep(2.2, 6, it.v.length());       // tumbles while thrown, rocks flat once the air has it
      Q0.setFromEuler(E1.set(lerp(-Math.PI / 2 + Math.cos(it.ph) * 0.7, it.r.x, k), lerp(it.yaw + Math.sin(it.ph * 0.5) * 0.5, it.r.y, k), lerp(Math.sin(it.ph) * 0.62, it.r.z, k)));
      M0.compose(it.p, Q0, V.setScalar(size));
    } else {
      Q0.setFromEuler(it.rest ? E0.set(-Math.PI / 2, 0, it.r.z) : E0.set(it.r.x, it.r.y, it.r.z));
      M0.compose(it.p, Q0, V.setScalar(size));
    }
    D.m.setMatrixAt(i, M0);
  }
  if (any) D.m.instanceMatrix.needsUpdate = true;
}
function puff(pos, n, col, speed, size, life, rise, alpha) {
  C0.set(col);
  for (let k = 0; k < n; k++) {
    const i = sm.i; sm.i = (i + 1) % SMOKE;
    sm.p[i * 3] = pos.x + rnd(-0.3, 0.3); sm.p[i * 3 + 1] = pos.y + rnd(-0.2, 0.3); sm.p[i * 3 + 2] = pos.z + rnd(-0.3, 0.3);
    V.set(rnd(-1, 1), rnd(-0.2, 1), rnd(-1, 1)).normalize().multiplyScalar(speed * rnd(0.3, 1));
    sm.v[i * 3] = V.x; sm.v[i * 3 + 1] = V.y; sm.v[i * 3 + 2] = V.z;
    sm.c[i * 3] = C0.r; sm.c[i * 3 + 1] = C0.g; sm.c[i * 3 + 2] = C0.b;
    sm.life[i] = sm.max[i] = life * rnd(0.7, 1.2); sm.base[i] = size * rnd(0.7, 1.25); sm.rise[i] = rise; sm.peak[i] = alpha * rnd(0.7, 1);
  }
}
function updateSmoke(dt) {
  const drag = Math.exp(-2.6 * dt);
  for (let i = 0; i < SMOKE; i++) {
    if (sm.life[i] <= 0) { sm.s[i] = 0; sm.a[i] = 0; continue; }
    sm.life[i] -= dt; const f = Math.max(0, sm.life[i] / sm.max[i]);
    sm.v[i * 3] = sm.v[i * 3] * drag + wind.x * dt * 2; sm.v[i * 3 + 1] = sm.v[i * 3 + 1] * drag + sm.rise[i] * dt; sm.v[i * 3 + 2] = sm.v[i * 3 + 2] * drag + wind.z * dt * 2;
    sm.p[i * 3] += sm.v[i * 3] * dt; sm.p[i * 3 + 1] += sm.v[i * 3 + 1] * dt; sm.p[i * 3 + 2] += sm.v[i * 3 + 2] * dt;
    sm.s[i] = sm.base[i] * (0.35 + 0.95 * Math.sqrt(1 - f)); sm.a[i] = sm.peak[i] * f * sstep(1, 0.86, f);
  }
  const a = smokePts.geometry.attributes; a.position.needsUpdate = a.aC.needsUpdate = a.aS.needsUpdate = a.aA.needsUpdate = true;
}
function spark(pos, n, col, speed, size, life, grav = 5, spread = 1) {
  C0.set(col); const r = C0.r * 2.4, g = C0.g * 2.4, b = C0.b * 2.4;
  for (let k = 0; k < n; k++) {
    const i = sp.i; sp.i = (i + 1) % SPARKS;
    sp.p[i * 3] = pos.x; sp.p[i * 3 + 1] = pos.y; sp.p[i * 3 + 2] = pos.z;
    V.set(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).normalize().multiplyScalar(speed * rnd(0.2, 1) * spread);
    sp.v[i * 3] = V.x; sp.v[i * 3 + 1] = V.y; sp.v[i * 3 + 2] = V.z;
    sp.c[i * 3] = r; sp.c[i * 3 + 1] = g; sp.c[i * 3 + 2] = b;
    sp.life[i] = sp.max[i] = life * rnd(0.6, 1.1); sp.base[i] = size * rnd(0.6, 1.2); sp.g[i] = grav;
  }
}
function updateSparks(dt) {
  for (let i = 0; i < SPARKS; i++) {
    if (sp.life[i] <= 0) { sp.s[i] = 0; continue; }
    sp.life[i] -= dt; const f = Math.max(0, sp.life[i] / sp.max[i]);
    sp.v[i * 3 + 1] -= sp.g[i] * dt;
    sp.p[i * 3] += sp.v[i * 3] * dt; sp.p[i * 3 + 1] += sp.v[i * 3 + 1] * dt; sp.p[i * 3 + 2] += sp.v[i * 3 + 2] * dt;
    sp.s[i] = sp.base[i] * f;
  }
  const a = sparkPts.geometry.attributes; a.position.needsUpdate = a.aC.needsUpdate = a.aS.needsUpdate = true;
}
const pops = Array.from({ length: 14 }, () => { const s = document.createElement('span'); $('pops').appendChild(s); return s; });
let popI = 0;
function popup(pos, str, cls) {
  V.copy(pos).project(camera); if (V.z > 1) return;
  const x = clamp((V.x + 1) / 2 * W, 34, W - 34), y = clamp((1 - V.y) / 2 * H, 80, H - 60), el = pops[popI]; popI = (popI + 1) % pops.length;
  el.textContent = str; el.className = cls || '';
  el.getAnimations().forEach(a => a.cancel());
  el.animate([
    { transform: `translate(${x}px,${y}px) translate(-50%,-50%) scale(.7)`, opacity: 0 },
    { transform: `translate(${x}px,${y - 16}px) translate(-50%,-50%) scale(1.08)`, opacity: 1, offset: 0.16 },
    { transform: `translate(${x}px,${y - 56}px) translate(-50%,-50%) scale(1)`, opacity: 0 },
  ], { duration: 820, easing: 'ease-out' });
}
function banner(str) {
  const el = $('banner'); el.textContent = str; el.getAnimations().forEach(a => a.cancel());
  el.animate([{ opacity: 0, transform: 'scale(.94)' }, { opacity: 1, transform: 'scale(1)', offset: 0.14 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }], { duration: 1500, easing: 'ease-out' });
}

/* ---------- sound, all synthesised ---------- */
let ac = null, master = null, muted = store.get('klak.forest.muted') === '1', noiseBuf = null, ambient = null, chirpT = 2;
function audioInit() {
  try {
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      ac = new AC(); master = ac.createGain(); master.gain.value = muted ? 0 : 0.9; master.connect(ac.destination);
      noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain(); src.buffer = noiseBuf; src.loop = true; f.type = 'bandpass'; f.frequency.value = 520; f.Q.value = 0.5; g.gain.value = 0.018;
      src.connect(f); f.connect(g); g.connect(master); src.start(); ambient = { f };
    }
    if (ac.state === 'suspended') ac.resume();
  } catch (e) {}
}
function tone(f, dur, vol, type = 'sine', f2 = 0, at = 0) {
  if (!ac || muted) return;
  const t = ac.currentTime + at, o = ac.createOscillator(), g = ac.createGain(); o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
}
function hiss(dur, vol, type, f, q = 1, f2 = 0) {
  if (!ac || muted) return;
  const t = ac.currentTime, s = ac.createBufferSource(), b = ac.createBiquadFilter(), g = ac.createGain(); s.buffer = noiseBuf; s.loop = true; b.type = type; b.frequency.setValueAtTime(f, t); b.Q.value = q; if (f2) b.frequency.exponentialRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(b); b.connect(g); g.connect(master); s.start(t, Math.random()); s.stop(t + dur + 0.02);
}
const sfx = {
  shot(p) { tone(180 + p * 220, 0.13, 0.1, 'triangle', 70); hiss(0.14, 0.05 + p * 0.05, 'highpass', 1400); },
  feather() { hiss(0.16, 0.13, 'bandpass', 2300, 0.8, 900); tone(1500, 0.08, 0.05, 'sine', 2400); },
  crack() { hiss(0.08, 0.2, 'highpass', 2600); tone(620, 0.07, 0.07, 'square', 240); },
  gold() { [988, 1319, 1760].forEach((f, i) => tone(f, 0.3, 0.075, 'triangle', 0, i * 0.06)); },
  bank() { tone(190, 0.1, 0.13, 'triangle', 96); hiss(0.05, 0.1, 'bandpass', 1500, 1.4); },
  dud() { tone(150, 0.08, 0.08, 'triangle', 80); },
  fire() { hiss(0.34, 0.15, 'bandpass', 500, 0.8, 1800); },
  boom() { tone(120, 0.5, 0.28, 'sine', 32); hiss(0.48, 0.28, 'lowpass', 2400, 0.6, 180); },
  level() { [523, 659, 784].forEach((f, i) => tone(f, 0.2, 0.06, 'triangle', 0, i * 0.08)); },
  end() { [392, 311, 233].forEach((f, i) => tone(f, 0.36, 0.08, 'triangle', 0, i * 0.15)); },
  chirp() { const b = rnd(2300, 3900), n = 2 + Math.floor(Math.random() * 3); for (let i = 0; i < n; i++) tone(b, 0.07, 0.012, 'sine', b * rnd(0.72, 1.28), i * 0.1); },
};
const buzz = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} };
let wake = null;
function wakeOn() { try { if (navigator.wakeLock && !wake) navigator.wakeLock.request('screen').then(w => { wake = w; w.addEventListener('release', () => { wake = null; }); }).catch(() => {}); } catch (e) {} }
function wakeOff() { try { if (wake) wake.release(); } catch (e) {} wake = null; }

/* ---------- game state ---------- */
const FIRE_AT = 8, G = 15.5;
let state = 'load', score = 0, level = 1, hits = 0, combo = 1, charge = 0, fireLoaded = false, reload = 0, spawnT = 0.7, best = +store.get('klak.forest.best') || 0, shake = 0, kick = 0, hurt = 0, kickV = 0, baseFov = 58, stride = 0, camLean = 0, hintMove = true, hintPull = true;
const targets = [], shots = [], stonePool = [], tumbling = [], props = [], halfPools = { top: [], bot: [] }, spentPool = [], trailPool = [], TAU = Math.PI * 2;
const trailGeo = new THREE.CylinderGeometry(0.5, 0, 1, 6, 1, true); trailGeo.translate(0, -0.5, 0);
const streak = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide });
const trailMat = streak(0xfff4dc, 0.2), fireTrailMat = streak(0xff8a2a, 0.72);
const fireGeo = new THREE.SphereGeometry(1, 18, 12), stoneMat = new THREE.MeshStandardMaterial({ color: 0xa8a498, roughness: 0.68 }), fireStoneMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(5.5, 2.3, 0.5), fog: false });
const halfWidthAt = z => (camera.position.z - z) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect;
const heat = () => clamp((level - 1) / 11, 0, 1);

function spawnBird(kind) {
  const K = KINDS[kind], obj = pools[kind].pop() || makeBird(kind), dir = Math.random() < 0.5 ? 1 : -1;
  const near = Math.random() < 0.45, z = near ? rnd(-19, -13) : rnd(-36, -30), hw = halfWidthAt(z), edge = Math.max(hw + 3.5, 8) + (fpsMode() ? FPS_EDGE : 0);
  const x = camera.position.x - dir * edge, y0 = rnd(4.6, 14.5), speed = rnd(K.speed[0], K.speed[1]) * lerp(1, 1.4, heat());
  const b = {
    type: 'bird', kind, obj, g: obj.g, K, hp: K.hp, r: K.r, pts: K.pts, dir, p: new THREE.Vector3(x, y0, z), v: new THREE.Vector3(dir * speed, 0, 0), face: new THREE.Vector3(dir * speed, 0, 0), omega: new THREE.Vector3(), z0: z, y0,
    speed, t: rnd(0, 6), seed: rnd(0, 6.28), yTo: y0, zTo: z, wp: rnd(0.3, 0.9), surge: 1, beat: rnd(0, TAU), power: 1, gliding: false, gaitT: rnd(K.flapFor[0], K.flapFor[1]), roll: 0, aoa: 0, panic: 0,
    dropT: kind !== 'swift' && Math.random() < 0.42 ? rnd(0.7, 2.4) : -1,
  };
  b.g.position.copy(b.p); b.g.scale.setScalar(K.scale); b.g.visible = true; scene.add(b.g); targets.push(b);
  return b;
}
function spawnEgg(mode, kind, at) {
  const obj = pools[kind].pop() || makeEgg(kind), gold = kind === 'gold';
  const e = {
    type: 'egg', kind, mode, obj, g: obj.g, hp: 1, r: gold ? 0.82 : 0.98, pts: gold ? 60 : mode === 'nest' ? 20 : 15, p: new THREE.Vector3(), v: new THREE.Vector3(),
    omega: new THREE.Vector3(rnd(-4, 4), rnd(-3, 3), rnd(-4, 4)), t: 0, life: 9, nest: null, scale: gold ? 0.92 : 1.08, h: 0, vh: 0, rock: 0, rockV: 0, baseX: 0, baseY: 0,
  };
  if (mode === 'nest') {                            // falls out of the canopy and settles into the nest
    const free = nests.filter(n => !n.egg && Math.abs(n.x - camera.position.x) < halfWidthAt(n.z) + 9); if (!free.length) { pools[kind].push(obj); return null; }
    const n = pick(free); n.egg = e; e.nest = n; e.baseX = n.x; e.baseY = n.y + 0.34; e.h = rnd(4.6, 6); e.vh = -1; e.p.set(n.x, e.baseY + e.h, n.z); e.life = rnd(5.2, 7) * lerp(1, 0.72, heat());
  } else if (mode === 'drop') {
    e.p.copy(at); e.v.set(rnd(-1.4, 1.4), -0.5, rnd(-0.4, 0.4));
  } else {                                          // tossed up out of the undergrowth, across the view
    const z = rnd(-30, -12), hw = halfWidthAt(z), dir = Math.random() < 0.5 ? 1 : -1, flight = rnd(2, 2.9) * lerp(1, 0.8, heat()), g = 9.5;
    const x0 = camera.position.x - dir * hw * rnd(0.7, 1.05), x1 = camera.position.x + dir * hw * rnd(0.3, 1.05);
    e.p.set(x0, Math.max(groundH(x0, z), 0) + 0.4, z); e.v.set((x1 - x0) / flight, g * flight * 0.5 + rnd(-0.6, 0.6), rnd(-0.6, 0.6));
  }
  e.g.position.copy(e.p); e.g.scale.setScalar(mode === 'nest' ? 0.001 : e.scale); e.g.rotation.set(rnd(0, 3), rnd(0, 3), rnd(0, 3)); e.g.visible = true;
  if (mode === 'nest') e.g.rotation.set(0, rnd(0, 6), 0);
  scene.add(e.g); targets.push(e);
  return e;
}
function removeTarget(t) {
  const i = targets.indexOf(t); if (i >= 0) targets.splice(i, 1);
  if (t.nest) { t.nest.egg = null; t.nest = null; }
  scene.remove(t.g); pools[t.type === 'bird' ? t.kind : t.kind].push(t.obj);
}
function spawnWave() {
  const d = heat(), r = Math.random();
  if (r < 0.2) spawnEgg('arc', Math.random() < 0.13 ? 'gold' : 'egg');
  else if (r < 0.38) { if (!spawnEgg('nest', Math.random() < 0.1 ? 'gold' : 'egg')) spawnBird('finch'); }
  else {
    const q = Math.random(), kind = q < lerp(0.56, 0.3, d) ? 'finch' : q < lerp(0.86, 0.68, d) || level < 2 ? 'swift' : 'raven';
    spawnBird(kind);
    if (Math.random() < 0.14 + d * 0.3) spawnBird(Math.random() < 0.6 ? 'finch' : 'swift');   // a pair
  }
}
function poseWings(t, dt) {                         // the model's own flap clip, sped up on the climb and nearly stopped in a glide
  const K = t.K, wantP = t.gliding ? 0 : 1;
  t.power += (wantP - t.power) * (1 - Math.exp(-(wantP ? 15 : 8) * dt));
  t.panic = Math.max(0, t.panic - dt * 0.8);
  t.beat += dt * K.beat * TAU * (1 + t.panic * 0.5) * (reduceMotion ? 0.45 : 1);
  t.obj.act.timeScale = lerp(0.08, K.anim, t.power) * (1 + t.panic * 0.6) * (reduceMotion ? 0.5 : 1);
  t.obj.mixer.update(dt);
}
function flyBird(t, dt) {
  const K = t.K, hot = heat();
  t.wp -= dt;
  if (t.wp <= 0) {                                  // picks the next point in the air; swifts change their mind fast
    const swift = t.kind === 'swift', reach = swift ? 3 : 2 + hot * 1.2;
    t.wp = swift ? rnd(0.8, 1.6) * lerp(1, 0.8, hot) : rnd(1.1, 2.2);
    t.yTo = clamp(t.y0 + rnd(-reach, reach), 3.9, 16.6); t.zTo = t.z0 + rnd(-1, 1) * (swift ? 3 : 1.9);
    t.surge = swift ? rnd(0.88, 1.25) : level >= 3 ? rnd(0.88, 1.22) : rnd(0.94, 1.08);
    if (swift) t.roll += rnd(-0.55, 0.55);
  }
  t.gaitT -= dt;
  if (t.gaitT <= 0) { t.gliding = !t.gliding; const [a, b] = t.gliding ? K.glideFor : K.flapFor; t.gaitT = rnd(a, b); }
  const bound = K.gait === 'bound', wantVx = t.dir * t.speed * t.surge, wantVy = clamp((t.yTo - t.p.y) * K.climb, -K.vyMax, K.vyMax), wantVz = clamp((t.zTo - t.p.z) * 1.6, -4.5, 4.5);
  const pulse = Math.max(0, Math.sin(t.beat)) * t.power;      // each downstroke is a shove forward and up
  const ax = (wantVx - t.v.x) * K.resp * 0.7 + t.dir * pulse * t.speed * 0.22, az = (wantVz - t.v.z) * K.resp * 0.6;
  const ay = t.gliding && bound ? -9.5 : (wantVy + (bound ? 2.3 : 0) - t.v.y) * K.resp + pulse * 2.4 - (t.gliding ? 1 : 0);   // a finch shuts its wings and coasts on a falling arc
  t.v.x += ax * dt; t.v.y += ay * dt; t.v.z += az * dt;
  t.p.addScaledVector(t.v, dt);
  if (t.p.y < 3.2) { t.p.y = 3.2; t.v.y = Math.max(t.v.y, 0); } else if (t.p.y > 17.6) { t.p.y = 17.6; t.v.y = Math.min(t.v.y, 0); }
  t.face.lerp(t.v, 1 - Math.exp(-13 * dt));
  const h2 = t.v.x * t.v.x + t.v.z * t.v.z, yawRate = h2 > 1 ? (t.v.z * ax - t.v.x * az) / h2 : 0;
  t.roll += (clamp(-yawRate * K.bank * 1.9, -1.05, 1.05) - t.roll) * (1 - Math.exp(-7 * dt));      // leans into every turn
  t.aoa += (clamp(ay * 0.016, -0.16, 0.3) - t.aoa) * (1 - Math.exp(-10 * dt));
  poseWings(t, dt);
  t.g.position.copy(t.p);
  t.g.lookAt(V.copy(t.p).add(t.face));
  t.g.rotateZ(t.roll); t.g.rotateX(-t.aoa);
  t.g.translateY(-Math.cos(t.beat) * 0.05 * K.scale * t.power);     // the body heaves against the wings
  const climb = Math.atan2(t.face.y, Math.hypot(t.face.x, t.face.z));
  t.obj.head.rotation.set(clamp(climb * 0.7 + t.aoa * 0.6, -0.6, 0.6), Math.sin(t.t * 0.83 + t.seed) * 0.2, -t.roll * 0.72);     // the head stays level while the body works
  t.obj.tail.rotation.set(clamp(ay * 0.02, -0.35, 0.35), clamp(-yawRate * 0.22, -0.4, 0.4), t.roll * 0.18);
  t.obj.tail.scale.x = 1 + 0.42 * sstep(0, 8, Math.abs(ay));
}
function retireBird(t) {
  const i = tumbling.indexOf(t); if (i >= 0) tumbling.splice(i, 1);
  scene.remove(t.g); t.obj.tail.scale.x = 1; pools[t.kind].push(t.obj);
}
function knockBird(t, s, viaBlast) {                // knocked out of the air, tumbles, then catches itself and flees
  const i = targets.indexOf(t); if (i >= 0) targets.splice(i, 1);
  if (viaBlast) V2.copy(t.p).sub(s.p).normalize().multiplyScalar(13); else V2.copy(s.v).multiplyScalar(0.14);
  t.v.multiplyScalar(0.36).add(V2); t.v.y += rnd(2, 4.5);
  t.omega.set(rnd(-1, 1), rnd(-0.5, 0.5), rnd(-1, 1)).normalize().multiplyScalar(rnd(7, 13) * (reduceMotion ? 0.15 : 1));
  t.tm = 0; t.out = rnd(0.62, 0.95); t.awake = false; t.shed = 0; t.panic = 1; t.gliding = false; t.power = 1;
  tumbling.push(t);
}
function updateTumbling(dt) {
  for (const t of tumbling.slice()) {
    t.tm += dt; t.t += dt;
    const gy = groundH(t.p.x, t.p.z);
    if (!t.awake && (t.tm > t.out || t.p.y < gy + 2)) t.awake = true;
    if (!t.awake) {
      t.v.multiplyScalar(Math.exp(-0.85 * dt)); t.v.y -= 14 * dt;
      const wl = t.omega.length();
      if (wl > 0.01) t.g.quaternion.premultiply(Q0.setFromAxisAngle(V.copy(t.omega).divideScalar(wl), wl * dt));
      t.obj.act.timeScale = 3.4; t.obj.mixer.update(dt);     // wings thrashing as it falls
      t.shed -= dt;
      if (t.shed <= 0) { t.shed = 0.08; emitDebris(feathers, t.p, 1, [t.K.body, t.K.belly, t.K.wing], 2.4, t.K.scale * 0.34, 3, 2.4, 1.7); }
    } else {
      V.set(t.dir * t.speed * 1.25, 7.5, t.v.z * 0.4);
      t.v.lerp(V, 1 - Math.exp(-3.2 * dt));
      M0.lookAt(V2.copy(t.p).add(t.v), t.p, UP); Q0.setFromRotationMatrix(M0);
      t.g.quaternion.slerp(Q0, 1 - Math.exp(-9 * dt));
      t.gliding = false; poseWings(t, dt);
    }
    t.p.addScaledVector(t.v, dt); t.p.y = Math.max(t.p.y, gy + 0.6); t.g.position.copy(t.p);
    if (t.tm > 4.2 || t.p.y > 34 || t.dir * (t.p.x - camera.position.x) > halfWidthAt(t.p.z) + 9) retireBird(t);
  }
}
function updateTarget(t, dt) {
  t.t += dt;
  if (t.type === 'bird') {
    flyBird(t, dt);
    if (t.dropT > 0) { t.dropT -= dt; if (t.dropT <= 0 && state !== 'load') { spawnEgg('drop', Math.random() < 0.1 ? 'gold' : 'egg', V.copy(t.p).setY(t.p.y - 0.8)); t.dropT = -1; } }
    if (t.dir * (t.p.x - camera.position.x) > halfWidthAt(t.p.z) + 7.5 + (fpsMode() ? FPS_EDGE : 0) || Math.abs(t.p.x) > 95) removeTarget(t);
    return;
  }
  if (t.mode === 'nest') {
    t.life -= dt;
    if (t.h > 0 || t.vh !== 0) {
      t.vh -= 17 * dt; t.h += t.vh * dt;
      if (t.h <= 0) {
        const hit = -t.vh; t.h = 0; t.vh = hit > 1.5 ? hit * 0.32 : 0; t.rockV += (Math.random() < 0.5 ? -1 : 1) * hit * 0.3;
        if (hit > 3) { V3.set(t.baseX, t.baseY - 0.2, t.p.z); puff(V3, 3, '#a58a60', 1.4, 0.8, 0.5, 0.6, 0.32); emitDebris(shells, V3, 3, ['#8a6a3e', '#6b5230'], 2.6, 0.14, 0.7, 1.4, 9); }
      }
    }
    if (t.life < 1.7) t.rockV += Math.sin(t.t * 9.5) * (1.7 - t.life) * 7.5 * dt;      // works loose before it tips out
    t.rockV += (-52 * t.rock - 3.6 * t.rockV) * dt; t.rock += t.rockV * dt;
    t.p.set(t.baseX + t.rock * 0.52, t.baseY + t.h, t.p.z);
    t.g.position.copy(t.p); t.g.rotation.z = -t.rock; t.g.scale.setScalar(t.scale * sstep(0, 0.12, t.t) + 0.001);
    if (t.life <= 0) {
      const side = t.rock >= 0 ? 1 : -1;
      t.nest.egg = null; t.nest = null; t.mode = 'drop'; t.g.scale.setScalar(t.scale);
      t.v.set(side * rnd(1.8, 3), 2.4, rnd(-0.6, 0.6)); t.omega.set(rnd(-2, 2), rnd(-1, 1), -side * rnd(3.5, 6));
    }
    return;
  }
  t.v.y -= (t.mode === 'arc' ? 9.5 : 7) * dt;
  t.p.addScaledVector(t.v, dt);
  t.g.position.copy(t.p);
  t.omega.applyAxisAngle(UP, 0.7 * dt);             // an egg's lopsided weight makes its spin wander
  const wl = t.omega.length();
  if (wl > 0.01) t.g.quaternion.premultiply(Q0.setFromAxisAngle(V.copy(t.omega).divideScalar(wl), wl * dt));
  if (t.p.y < groundH(t.p.x, t.p.z) + 0.55) {
    if (Math.abs(t.p.x - camera.position.x) < 34) breakEgg(t, new THREE.Vector3(t.v.x * 0.2, -t.v.y * 0.18, t.v.z * 0.2));
    removeTarget(t);
  }
}
function addProp(g, pool, p, v, omega, life, lift, base) {
  g.position.copy(p); g.scale.setScalar(base); g.visible = true; scene.add(g);
  props.push({ g, pool, p: p.clone(), v: v.clone(), omega: omega.clone(), life, lift, base, gy: groundH(p.x, p.z), rest: false, hit: 0 });
  while (props.length > 18) retireProp(props[0]);
}
function retireProp(pr) { const i = props.indexOf(pr); if (i >= 0) props.splice(i, 1); scene.remove(pr.g); pr.pool.push(pr.g); }
function updateProps(dt) {                          // spent stones and shell halves bounce, settle, and sink into the grass
  for (const pr of props.slice()) {
    pr.life -= dt; if (pr.life <= 0) { retireProp(pr); continue; }
    if (!pr.rest) {
      pr.v.y -= 13.5 * dt; pr.v.multiplyScalar(Math.exp(-0.25 * dt)); pr.p.addScaledVector(pr.v, dt);
      const wl = pr.omega.length();
      if (wl > 0.01) pr.g.quaternion.premultiply(Q0.setFromAxisAngle(V.copy(pr.omega).divideScalar(wl), wl * dt));
      if (pr.p.y < pr.gy + pr.lift) {
        const hard = -pr.v.y; pr.p.y = pr.gy + pr.lift; if (pr.v.y < 0) pr.v.y *= -0.36;
        pr.v.x *= 0.6; pr.v.z *= 0.6; pr.omega.multiplyScalar(0.5);
        if (hard > 2.4 && pr.hit++ < 1) puff(pr.p, 2, '#a58f6c', 1, 0.7, 0.45, 0.5, 0.28);
        if (Math.abs(pr.v.y) < 0.9) pr.rest = true;
      }
    }
    pr.g.position.copy(pr.p);
    if (pr.life < 0.35) pr.g.scale.setScalar(pr.base * pr.life / 0.35);
  }
}
function breakEgg(t, push) {                        // the shell splits in two, the yolk comes out in one heavy stretch of drops
  const gold = t.kind === 'gold';
  for (const top of [true, false]) {
    const pool = top ? halfPools.top : halfPools.bot, g = pool.pop() || makeHalf(top);
    g.userData.outer.material = t.obj.mesh.material; g.quaternion.copy(t.g.quaternion);
    const axis = new THREE.Vector3(0, top ? 1 : -1, 0).applyQuaternion(t.g.quaternion);
    const at = t.p.clone().addScaledVector(axis, 0.46 * t.scale), v = t.v.clone().multiplyScalar(0.3).add(push).addScaledVector(axis, rnd(2.6, 4.6));
    v.x += rnd(-1, 1); v.y += rnd(0.5, 2); v.z += rnd(-1, 1);
    addProp(g, pool, at, v, new THREE.Vector3(rnd(-9, 9), rnd(-6, 6), rnd(-9, 9)), rnd(1.9, 2.6), 0.26, t.scale);
  }
  if (gold) { emitDebris(shells, t.p, 14, ['#ffd24a', '#ffb31f', '#fff0b0'], 7.5, 0.3, 1.2, 1.3, 10); return; }
  emitDebris(shells, t.p, 11, ['#f6edd9', '#e4d8bb', '#a6dcd6'], 6, 0.24, 1.3, 1.3, 11);
  emitDebris(yolks, t.p, 1, '#ffc21f', 1.4, 0.72, 1.9, 0.4, 13);      // one heavy yolk and a few thin drops
  emitDebris(yolks, t.p, 6, ['#ffd24a', '#ffc933'], 4.2, 0.15, 1.5, 0.4, 13);
}
function hitTarget(t, s, viaBlast) {
  t.hp -= viaBlast ? 2 : 1;
  if (t.hp > 0) {                                   // a raven takes the first hit: thrown off line, then beating hard to recover
    V2.copy(s.v).normalize(); t.v.addScaledVector(V2, 8); t.v.y += 2.6;
    t.roll += (Math.random() < 0.5 ? -1 : 1) * rnd(0.6, 1); t.panic = 1; t.gliding = false; t.gaitT = 0.9;
    spark(t.p, 8, '#d9d7ff', 6, 0.42, 0.24); emitDebris(feathers, t.p, 9, [t.K.body, t.K.wing], 6.5, 0.55, 3, 2.3, 1.8);
    t.speed *= 1.34; sfx.bank(); buzz(10); popup(t.p, 'Hit');
    registerHit(s, 0);
    return false;
  }
  const bank = s && s.bounces > 0 && !viaBlast, gained = t.pts * combo * (bank ? 2 : 1);
  score += gained;
  registerHit(s);
  popup(t.p, '+' + gained + (bank ? ' bank' : ''), t.kind === 'gold' ? 'gold' : bank ? 'bank' : '');
  if (t.type === 'bird') {
    emitDebris(feathers, t.p, 18, [t.K.body, t.K.belly, t.K.wing, t.K.tip], 9, t.K.scale * 0.42, 3.4, 2.5, 1.7);
    spark(t.p, 6, '#fff1cf', 7, 0.4, 0.22); puff(t.p, 2, t.K.belly, 1.8, 1.1, 0.45, 0.3, 0.3); sfx.feather(); buzz(14);
    knockBird(t, s, viaBlast);
    return true;
  }
  const push = viaBlast ? t.p.clone().sub(s.p).normalize().multiplyScalar(6) : s.v.clone().multiplyScalar(0.08);
  breakEgg(t, push);
  if (t.kind === 'gold') { spark(t.p, 46, '#ffd24a', 11, 0.85, 0.7, 3.5); sfx.gold(); buzz(24); shake = Math.max(shake, 0.5); }
  else { spark(t.p, 6, '#ffe08a', 4.5, 0.36, 0.26); sfx.crack(); buzz(14); }
  removeTarget(t);
  return true;
}
function registerHit(s) {
  hits++; if (s) s.scored = true;
  combo = Math.min(5, combo + (hits % 2 === 0 ? 1 : 0));
  if (score > best) { best = score; store.set('klak.forest.best', best); }
  if (!fireLoaded) { charge++; if (charge >= FIRE_AT) { fireLoaded = true; charge = FIRE_AT; sfx.level(); banner('Fire ready'); } }
  const lv = 1 + Math.floor(hits / 9);
  if (lv !== level) { level = lv; banner('Level ' + lv); sfx.level(); }
  renderHud();
}
function explode(pos, s) {
  s.p.copy(pos);
  spark(pos, 3, '#fff3c8', 0.5, 9, 0.16, 0); spark(pos, 70, '#ff9a32', 19, 1.4, 0.7, 4); spark(pos, 34, '#ffe08a', 12, 0.9, 0.46, 3);
  puff(pos, 12, '#ff8a34', 8, 5, 0.55, 2, 0.72); puff(pos, 18, '#a39686', 10, 6, 1.5, 3.2, 0.26);
  emitDebris(shells, pos, 12, ['#3a2416', '#7a4a22'], 12, 0.3, 1.2, 1.3, 12);
  sfx.boom(); buzz(40);
  if (!reduceMotion) { shake = 1.2; blast.x = pos.x; blast.z = pos.z; blast.r = 0.5; blast.a = 2.4; }
  for (const t of targets.slice()) if (t.p.distanceTo(pos) < 7.4) hitTarget(t, s, true);
}

/* ---------- shots ---------- */
const hitScale = () => lerp(1.9, 1.45, clamp((level - 1) / 8, 0, 1));         // generous at first, still forgiving later
function segDist(a, b, c) {
  V.copy(b).sub(a); const l = V.lengthSq(); if (l < 1e-6) return a.distanceTo(c);
  const t = clamp(V2.copy(c).sub(a).dot(V) / l, 0, 1);
  return V2.copy(a).addScaledVector(V, t).distanceTo(c);
}
const launch = { o: new THREE.Vector3(), d: new THREE.Vector3(), speed: 0 };
function computeLaunch() {
  const n = pullNorm(), fp = fpsMode(), ndcX = fp ? 0 : clamp(-n.x * 1.04, -1, 1), ndcY = fp ? 0 : lerp(-0.2, 1, clamp(n.y, 0, 1));      // first person shoots at the crosshair
  rig.updateWorldMatrix(true, false);
  launch.o.copy(REST).applyMatrix4(rig.matrixWorld);
  V3.set(ndcX, ndcY, 0.5).unproject(camera).sub(camera.position).normalize();
  V2.copy(camera.position).addScaledVector(V3, 62);
  launch.d.copy(V2).sub(launch.o).normalize();
  launch.speed = lerp(fp ? 58 : 50, fp ? 90 : 86, clamp(n.len, 0, 1)) * (fireLoaded ? 1.05 : 1);
}
const pullNorm = () => {
  const mx = Math.min(W * 0.42, H * 0.36), my = H * 0.36; let x = aim.px / mx, y = aim.py / my; const l = Math.hypot(x, y);
  if (l > 1) { x /= l; y /= l; }
  return { x, y, len: Math.min(1, l) };
};
function fire() {
  computeLaunch();
  const pw = pullNorm().len, isFire = fireLoaded;
  if (isFire) { fireLoaded = false; charge = 0; renderHud(); }
  rig.updateWorldMatrix(true, false);
  const off = new THREE.Vector3(REST.x + pouch.x, REST.y + pouch.y, REST.z + pouch.z).applyMatrix4(rig.matrixWorld).sub(launch.o);    // the stone leaves from where the pouch really is
  const m = stonePool.pop() || new THREE.Mesh(stoneGeo(), stoneMat), tr = trailPool.pop() || new THREE.Mesh(trailGeo, trailMat);
  m.geometry = isFire ? fireGeo : stoneGeo(); m.material = isFire ? fireStoneMat : stoneMat; m.scale.setScalar(0.1); m.castShadow = !isFire; m.visible = true; m.position.copy(launch.o).add(off); scene.add(m);
  tr.material = isFire ? fireTrailMat : trailMat; tr.frustumCulled = false; tr.scale.setScalar(0.001); scene.add(tr);
  shots.push({ p: launch.o.clone(), prev: launch.o.clone(), v: launch.d.clone().multiplyScalar(launch.speed), r: isFire ? 0.5 : 0.36, fire: isFire, pierce: !isFire && pw > 0.93 ? 1 : 0, bounces: 0, scored: false, t: 0, m, tr, off, axis: new THREE.Vector3(1, rnd(-0.3, 0.3), rnd(-0.3, 0.3)).normalize(), seen: new Set(), noTree: 0 });
  reload = isFire ? 0.42 : 0.26; loadAge = -reload; kickV = 0.7 + pw * 1.2; fork.v -= 0.8 + pw * 3.6; hintPull = false; updateHint();
  if (isFire) { sfx.fire(); buzz(26); } else { sfx.shot(pw); buzz(pw > 0.93 ? 16 : 8); }
}
function endShot(s) {
  const i = shots.indexOf(s); if (i >= 0) shots.splice(i, 1);
  scene.remove(s.m); stonePool.push(s.m); scene.remove(s.tr); trailPool.push(s.tr);
  if (!s.scored && state === 'play' && combo !== 1) { combo = 1; renderHud(); }
}
function spendStone(s, k) {                         // what's left of a shot keeps moving: glances off and drops into the grass
  if (s.fire) return;
  const m = spentPool.pop() || new THREE.Mesh(stoneGeo(), stoneMat); m.castShadow = true; m.quaternion.copy(s.m.quaternion);
  const v = s.v.clone().multiplyScalar(k); v.x += rnd(-2, 2); v.y = Math.abs(v.y) * 0.4 + rnd(2, 4.5); v.z += rnd(-2, 2);
  addProp(m, spentPool, s.p, v, new THREE.Vector3(rnd(-12, 12), rnd(-8, 8), rnd(-12, 12)), rnd(1.6, 2.2), 0.24, 0.3);
}
function updateShots(dt) {
  for (const s of shots.slice()) {
    s.t += dt; s.prev.copy(s.p); s.v.y -= G * dt; s.p.addScaledVector(s.v, dt);
    const lag = Math.max(0, 1 - s.t / 0.07);
    s.m.position.copy(s.p).addScaledVector(s.off, lag * lag); s.m.rotateOnAxis(s.axis, 34 * dt);
    s.m.scale.setScalar(lerp(0.1, s.fire ? 0.5 : 0.3, sstep(0, 0.2, s.t)));          // starts small, it's right under the lens
    const sp_ = s.v.length();                       // a streak the length of the blur a fast stone leaves
    s.tr.position.copy(s.m.position); s.tr.quaternion.setFromUnitVectors(UP, V.copy(s.v).divideScalar(sp_ || 1));
    const tw = s.m.scale.x * 0.8, tl = Math.min(sp_ * (s.fire ? 0.07 : 0.045), s.fire ? 5 : 3.2) * sstep(0, 0.08, s.t); s.tr.scale.set(tw, Math.max(tl, 0.001), tw);
    if (s.noTree > 0) s.noTree -= dt;
    if (s.fire) { spark(s.p, 3, '#ff9a32', 2.4, 0.9, 0.34, 1); spark(s.p, 1, '#fff0b0', 1, 0.6, 0.18, 0); if (Math.random() < 0.5) puff(s.p, 1, '#4a3d30', 0.8, 1.1, 0.6, 1.4, 0.3); }
    else if (s.pierce && s.t > 0.14) spark(s.p, 1, '#ffe7a8', 0.5, 0.22, 0.16, 0);

    if (s.t < 1.6) {                                // a gentle pull toward whatever the shot was nearly going to hit
      let best = null, bd = 0, bt = 0;
      for (const t of targets) {
        if (s.seen.has(t) || t.p.z > s.p.z - 0.5) continue;
        const tt = (s.p.z - t.p.z) / Math.max(-s.v.z, 1); if (tt > 1.4) continue;
        V.copy(s.p).addScaledVector(s.v, tt); V.y -= 0.5 * G * tt * tt;
        V2.copy(t.p).addScaledVector(t.v, tt);
        const d = V.distanceTo(V2); if (d < 2.6 + t.r * 1.4 && (!best || d < bd)) { best = t; bd = d; bt = tt; }
      }
      if (best) {
        V.copy(s.p).addScaledVector(s.v, bt); V.y -= 0.5 * G * bt * bt;
        V3.copy(best.p).addScaledVector(best.v, bt).sub(V).divideScalar(Math.max(bt, 0.12));
        s.v.addScaledVector(V3, 1 - Math.exp(-6 * dt));
      }
    }
    let done = false;
    const scale = hitScale();
    for (const t of targets.slice()) {
      if (s.seen.has(t) || t.p.z < s.p.z - 6) continue;
      if (segDist(s.prev, s.p, t.p) > t.r * scale + s.r) continue;
      if (s.fire) { explode(t.p.clone(), s); done = true; break; }
      s.seen.add(t); hitTarget(t, s, false);
      if (s.pierce > 0) { s.pierce--; continue; }
      spendStone(s, -0.16); done = true; break;
    }
    if (done) { endShot(s); continue; }

    if (s.noTree <= 0) for (const c of trunks) {     // trunks turn a shot back: that's the bank
      if (s.p.y > c.top) continue;
      const dx = s.p.x - c.x, dz = s.p.z - c.z, d = Math.hypot(dx, dz);
      if (d > c.r + s.r) continue;
      if (s.fire) { explode(s.p.clone(), s); done = true; break; }
      if (s.bounces >= 2) { done = true; spark(s.p, 8, '#c9a878', 4, 0.32, 0.25); sfx.dud(); spendStone(s, -0.14); break; }
      const nx = dx / d, nz = dz / d, vn = s.v.x * nx + s.v.z * nz;
      if (vn < 0) { s.v.x -= 1.72 * vn * nx; s.v.z -= 1.72 * vn * nz; s.v.multiplyScalar(0.82); }
      s.p.x = c.x + nx * (c.r + s.r + 0.02); s.p.z = c.z + nz * (c.r + s.r + 0.02);
      s.bounces++; s.noTree = 0.08; s.seen.clear();
      spark(s.p, 8, '#e9cf9e', 6, 0.36, 0.26); puff(s.p, 2, '#8a7355', 1.6, 0.8, 0.4, 0.4, 0.3); emitDebris(shells, s.p, 5, ['#5f4630', '#3f2d1d'], 5, 0.17, 0.9, 1.4, 11); sfx.bank(); buzz(8);
      emitDebris(feathers, new THREE.Vector3(c.x + rnd(-2, 2), Math.min(c.top, s.p.y + rnd(4, 8)), c.z + rnd(-2, 2)), 5, ['#3f9440', '#5aa53a', '#2f7d32'], 1.6, 0.55, 3, 2.4, 1.5);     // the knock shakes leaves loose overhead
      break;
    }
    if (done) { endShot(s); continue; }

    if (s.p.y <= groundH(s.p.x, s.p.z) + s.r) {
      if (s.fire) explode(s.p.clone(), s);
      else { puff(s.p, 3, '#9a8560', 2, 0.9, 0.5, 0.5, 0.34); emitDebris(shells, s.p, 4, ['#4a3a24', '#6a5636'], 3.4, 0.14, 0.7, 1.4, 11); spendStone(s, 0.34); }
      endShot(s); continue;
    }
    if (s.t > 3.4 || s.p.z < -92 || s.p.z > 24 || Math.abs(s.p.x - camera.position.x) > 90) { if (s.fire) explode(s.p.clone(), s); endShot(s); }
  }
}
function updateGuide() {
  if (!aim.on || aim.len < 14) { guide.count = 0; return; }
  computeLaunch();
  const dt = 0.017, n = guide.instanceMatrix.count;                    // only the first stretch is drawn: judging the drop is the game
  V.copy(launch.o); V2.copy(launch.d).multiplyScalar(launch.speed);
  const px = V.x, py = V.y, pz = V.z; let x = px, y = py, z = pz, vy = V2.y; const vx = V2.x, vz = V2.z;
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 1; k++) { vy -= G * dt; x += vx * dt; y += vy * dt; z += vz * dt; }
    const dist = Math.hypot(x - camera.position.x, y - camera.position.y, z - camera.position.z);
    guide.setMatrixAt(i, M0.compose(V3.set(x, y, z), Q0.identity(), V.setScalar((1 - i / n) * 0.62 * (0.42 + dist * 0.045))));
  }
  guide.count = n; guide.instanceMatrix.needsUpdate = true;
}

/* ---------- settings: view, quality, frame counter ---------- */
const opts = { mode: store.get('klak.forest.mode') === 'fps' ? 'fps' : 'classic', fps: store.get('klak.forest.fpsmeter') !== '0' };
const fpsMode = () => opts.mode === 'fps';
const look = { yaw: 0, pitch: 0.13, id: null, lx: 0, ly: 0 }, YAW_MAX = 0.85, FPS_EDGE = 16;
const locked = () => document.pointerLockElement === cv;
let setFrom = 'menuCard';
function setLabels() {
  const cur = { mode: opts.mode, q: String(store.get('klak.forest.q') ?? tier), fps: opts.fps ? '1' : '0' };
  document.querySelectorAll('.seg').forEach(g => g.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === cur[g.dataset.set]))));
  $('fps').hidden = !opts.fps;
}
function settingsOpen() { setFrom = state === 'pause' ? 'pauseCard' : 'menuCard'; $('setNote').textContent = ''; setLabels(); show('setCard'); }
document.querySelectorAll('.set-open').forEach(b => b.addEventListener('click', settingsOpen));
$('setDone').addEventListener('click', () => { if ($('setNote').dataset.reload) location.reload(); else show(setFrom); });
document.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => {
  const k = b.parentElement.dataset.set, v = b.dataset.v;
  if (k === 'mode') { opts.mode = v; store.set('klak.forest.mode', v); look.yaw = 0; look.pitch = 0.13; }
  else if (k === 'fps') { opts.fps = v === '1'; store.set('klak.forest.fpsmeter', v); meter.t = meter.n = 0; }
  else if (k === 'q' && v !== String(store.get('klak.forest.q') ?? tier)) {
    store.set('klak.forest.q', v);
    $('setNote').textContent = state === 'pause' ? 'Done restarts the game with the new quality. This round ends.' : 'Done reloads the forest at the new quality.';
    $('setNote').dataset.reload = '1';
  }
  setLabels();
}));
document.addEventListener('pointerlockchange', () => { if (!locked() && fpsMode() && state === 'play') pause(); updateHint(); });

/* ---------- tilt ---------- */
const tilt = { can: !!window.DeviceOrientationEvent && coarse, on: store.get('klak.tilt') !== '0', ok: false, zero: null, to: 0, a: 0 };
tilt.on = tilt.can && tilt.on;
function onTilt(ev) {
  if (ev.beta === null || ev.gamma === null) return;
  const rad = Math.PI / 180, angle = (screen.orientation && screen.orientation.angle) ?? window.orientation ?? 0;
  const portrait = Math.asin(clamp(Math.cos(ev.beta * rad) * Math.sin(ev.gamma * rad), -1, 1)) / rad;
  const roll = angle === 90 ? ev.beta : angle === 270 || angle === -90 ? -ev.beta : angle === 180 ? -portrait : portrait;
  if (tilt.zero === null) { tilt.zero = roll; tilt.to = tilt.a = 0; return; }   // however the phone is held at the start is centre
  tilt.to = clamp(roll - tilt.zero, -60, 60);
}
async function askTilt() {                          // iPhones only offer the prompt from inside a tap
  if (!tilt.on || tilt.ok) return;
  const D = window.DeviceOrientationEvent;
  try { if (D.requestPermission && await D.requestPermission() !== 'granted') throw 0; }
  catch (e) { tilt.on = false; tiltLabel(); return; }
  tilt.ok = true; window.addEventListener('deviceorientation', onTilt);
}
function tiltLabel() { document.querySelectorAll('.tilt-toggle').forEach(b => { b.hidden = !tilt.can; b.textContent = tilt.on ? 'Tilt on' : 'Tilt off'; b.setAttribute('aria-pressed', String(tilt.on)); }); }

/* ---------- touch, mouse and keys ---------- */
const keys = { l: false, r: false }, TRACK_H = 64;
function trackTo(x) { const w = Math.min(W * 0.72, 420), u = clamp((x - (W - w) / 2) / w, 0, 1); sling.tx = lerp(-RAIL, RAIL, u); if (hintMove) { hintMove = false; updateHint(); } }
function startDraw(id) { if (aim.on) return; aim.on = true; aim.id = id; aim.charge = 0; aim.px = aim.py = aim.len = 0; }
function onDown(ev) {
  audioInit();
  if (state !== 'play') return;
  ev.preventDefault();
  if (fpsMode()) {                                  // mouse: lock it and hold to draw; touch: drag to look, the Fire button draws
    if (ev.pointerType === 'mouse') { if (!locked()) { try { cv.requestPointerLock(); } catch (e) {} } else if (ev.button === 0) startDraw(ev.pointerId); return; }
    if (look.id === null) { look.id = ev.pointerId; look.lx = ev.clientX; look.ly = ev.clientY; }
    try { cv.setPointerCapture(ev.pointerId); } catch (e) {}
    return;
  }
  if (ev.clientY >= H - TRACK_H) { if (move.id !== null) return; move.id = ev.pointerId; trackTo(ev.clientX); }
  else { if (aim.on) return; aim.on = true; aim.id = ev.pointerId; aim.sx = ev.clientX; aim.sy = ev.clientY; aim.px = aim.py = aim.len = 0; }
  try { cv.setPointerCapture(ev.pointerId); } catch (e) {}
}
function turn(dx, dy) { look.yaw = clamp(look.yaw - dx, -YAW_MAX, YAW_MAX); look.pitch = clamp(look.pitch - dy, -0.12, 0.62); }
function onMove(ev) {
  if (fpsMode()) {
    if (locked()) turn(ev.movementX * 0.0022, ev.movementY * 0.0022);
    else if (ev.pointerId === look.id) { turn((ev.clientX - look.lx) * 0.0042, (ev.clientY - look.ly) * 0.0042); look.lx = ev.clientX; look.ly = ev.clientY; }
    return;
  }
  if (ev.pointerId === move.id) trackTo(ev.clientX);
  else if (aim.on && ev.pointerId === aim.id) {
    ev.preventDefault();
    const px = ev.clientX - aim.sx, py = Math.max(ev.clientY - aim.sy, Math.abs(ev.clientX - aim.sx) * 0.3, 0);
    aim.px = px; aim.py = py; aim.len = Math.hypot(px, py);
  }
}
function onUp(ev, cancel) {
  audioInit();                                      // iPhones only unlock sound on a finished touch
  if (ev.pointerId === look.id) look.id = null;
  if (ev.pointerId === move.id) move.id = null;
  else if (aim.on && ev.pointerId === aim.id) {
    aim.on = false;
    if (!cancel && state === 'play' && aim.len > 14) fire();
    aim.len = aim.px = aim.py = 0;
  }
}
cv.addEventListener('pointerdown', onDown); cv.addEventListener('pointermove', onMove);
cv.addEventListener('pointerup', ev => onUp(ev, false)); cv.addEventListener('pointercancel', ev => onUp(ev, true));
cv.addEventListener('touchmove', ev => ev.preventDefault(), { passive: false });
cv.addEventListener('contextmenu', ev => ev.preventDefault());
const fireBtn = $('fireBtn');
fireBtn.addEventListener('pointerdown', ev => { ev.preventDefault(); audioInit(); if (state === 'play') { startDraw(ev.pointerId); try { fireBtn.setPointerCapture(ev.pointerId); } catch (e) {} } });
fireBtn.addEventListener('pointerup', ev => onUp(ev, false)); fireBtn.addEventListener('pointercancel', ev => onUp(ev, true));
fireBtn.addEventListener('contextmenu', ev => ev.preventDefault());
document.addEventListener('gesturestart', ev => ev.preventDefault());       // no pinch-zoom mid game on iPhone
window.addEventListener('keydown', ev => {
  if (ev.key === 'ArrowLeft' || ev.key === 'a') { keys.l = true; if (hintMove) { hintMove = false; updateHint(); } }
  else if (ev.key === 'ArrowRight' || ev.key === 'd') { keys.r = true; if (hintMove) { hintMove = false; updateHint(); } }
  else if (ev.key === 'Escape' || ev.key === 'p') (state === 'pause' ? resume() : pause());
});
window.addEventListener('keyup', ev => { if (ev.key === 'ArrowLeft' || ev.key === 'a') keys.l = false; else if (ev.key === 'ArrowRight' || ev.key === 'd') keys.r = false; });

/* ---------- update ---------- */
function updateSling(dt) {
  if (keys.l) sling.tx -= 15 * dt; if (keys.r) sling.tx += 15 * dt;
  if (state === 'play' && tilt.on && tilt.zero !== null && move.id === null && !fpsMode()) {     // past a small dead zone, more tilt is a faster slide
    tilt.a += (tilt.to - tilt.a) * Math.min(1, 20 * dt);
    const m = Math.max(0, Math.abs(tilt.a) - 2.5);
    if (m > 0) { sling.tx += Math.sign(tilt.a) * Math.min(26, 0.85 * m + 0.05 * m * m) * dt; if (hintMove) { hintMove = false; updateHint(); } }
  }
  sling.tx = clamp(sling.tx, -RAIL, RAIL);
  sling.v = clamp(sling.v + (169 * (sling.tx - sling.x) - 26 * sling.v) * dt, -34, 34);      // the player has weight: eases into a step and out of it
  sling.x = clamp(sling.x + sling.v * dt, -RAIL - 0.4, RAIL + 0.4);
  if (aim.on && fpsMode()) {                        // first person: the draw builds while the button is held
    aim.charge = Math.min(1, aim.charge + dt / 0.7); aim.px = 0; aim.py = aim.charge * H * 0.36; aim.len = aim.py;
  }
  const n = aim.on ? pullNorm() : null, time = shared.time.value;
  if (n) {
    const f = 1 - Math.exp(-34 * dt), strain = !reduceMotion && n.len > 0.8 ? (n.len - 0.8) / 0.2 : 0;     // the hand starts to shake at full draw
    pouch.x += (n.x * 0.5 + (vnoise(time * 31, 3.3) - 0.5) * 0.012 * strain - pouch.x) * f;
    pouch.y += (-n.y * 0.62 - n.len * 0.04 + (vnoise(time * 29, 7.7) - 0.5) * 0.012 * strain - pouch.y) * f;
    pouch.z += (n.len * 0.95 - pouch.z) * f;
    pouch.vx = pouch.vy = pouch.vz = 0;
  } else {                                          // let go: the bands fire the pouch through the fork and it rings out
    const h = dt / 3;
    for (let i = 0; i < 3; i++) {
      pouch.vx += (-520 * pouch.x - 21 * pouch.vx) * h; pouch.vy += (-520 * pouch.y - 21 * pouch.vy) * h; pouch.vz += (-520 * pouch.z - 21 * pouch.vz) * h;
      pouch.x += pouch.vx * h; pouch.y += pouch.vy * h; pouch.z += pouch.vz * h;
    }
  }
  const pull = n ? n.len : 0, calm = reduceMotion;
  fork.v += ((pull * 0.15 - fork.a) * 300 - 11 * fork.v) * dt; fork.a += fork.v * dt;     // the fork bends to the draw and shivers after the shot
  fork.y += ((n ? -n.x * 0.2 : 0) - fork.y) * (1 - Math.exp(-11 * dt));
  rig.rotation.set(fork.a, fork.y, calm ? 0 : -sling.v * 0.0035);
  rig.position.set(rigBase.x - (calm ? 0 : sling.v * 0.005), rigBase.y + (calm ? 0 : Math.sin(time * 1.1) * 0.006) - pull * 0.012, rigBase.z + pull * 0.05);
}
const camTarget = new THREE.Vector3();
function updateCamera(dt) {
  const n = aim.on ? pullNorm() : { x: 0, y: 0, len: 0 }, calm = reduceMotion, time = shared.time.value, idle = calm ? 0 : time;
  kickV += (-280 * kick - 24 * kickV) * dt; kick += kickV * dt;
  shake = Math.max(0, shake - dt * 2.4);
  const speed = Math.abs(sling.v), stepK = calm ? 0 : Math.min(1, speed / 11), amt = calm ? 0 : shake * shake;
  stride += speed * dt * 1.05;                      // footsteps while sidestepping
  const sx = (vnoise(time * 19, 3.1) - 0.5) * 2 * amt * 0.34, sy = (vnoise(time * 21, 8.7) - 0.5) * 2 * amt * 0.26, sr = (vnoise(time * 17, 5.3) - 0.5) * 2 * amt * 0.035;
  camera.position.set(sling.x + sx + Math.cos(stride) * stepK * 0.035, 3.05 + Math.sin(idle * 0.7) * 0.05 + Math.abs(Math.sin(stride)) * stepK * 0.1 - stepK * 0.04 + sy - kick * 0.04, 13 + kick * 0.14);
  camLean += ((calm ? 0 : -sling.v * 0.0042) - camLean) * (1 - Math.exp(-8 * dt));
  if (fpsMode() && state !== 'menu') camera.rotation.set(look.pitch + sy * 0.02 + Math.sin(idle * 0.7) * 0.004, look.yaw + sx * 0.02, camLean + sr, 'YXZ');
  else {
    camTarget.set(sling.x * 0.84 - n.x * 1.6 + Math.sin(idle * 0.42) * 0.14, 8.6 + n.y * 0.8, -30);
    camera.lookAt(camTarget);
    camera.rotateZ(camLean + sr);
  }
  const fovTo = baseFov - (calm ? 0 : n.len * 1.7);  // leans in at full draw
  if (Math.abs(fovTo - camera.fov) > 0.01) { camera.fov += (fovTo - camera.fov) * (1 - Math.exp(-9 * dt)); camera.updateProjectionMatrix(); }
  camera.updateMatrixWorld();
}
function update(dt) {
  shared.time.value += reduceMotion ? dt * 0.35 : dt;
  skyMat.uniforms.uTime.value = shared.time.value;
  applySky(dt);
  if (reload > 0) reload -= dt;
  if (hurt > 0) { hurt = Math.max(0, hurt - dt * 1.4); }
  updateWind(dt); updateSling(dt); updateCamera(dt);
  shared.sunView.value.copy(sky.dir).transformDirection(camera.matrixWorldInverse);

  if (state === 'play' || state === 'menu') {
    const play = state === 'play', d = heat();
    spawnT -= dt;
    const cap = play ? 4 + Math.min(6, Math.floor(level / 1.5)) : 4;
    if (spawnT <= 0) { spawnT = play ? rnd(0.75, 1.3) * lerp(1, 0.46, d) : rnd(1.1, 1.8); if (targets.length < cap) spawnWave(); }
  }
  for (const t of targets.slice()) updateTarget(t, dt);
  updateTumbling(dt); updateShots(dt); updateProps(dt); updateGuide();
  updateDebris(feathers, dt); updateDebris(shells, dt); updateDebris(yolks, dt); updateSparks(dt); updateSmoke(dt); updateAir(dt); updateSlingMesh(dt);
  $('hurt').style.opacity = hurt;
  chirpT -= dt; if (chirpT <= 0) { chirpT = rnd(1.4, 4.8); if (state === 'play' || state === 'menu') sfx.chirp(); }
  if (state === 'play') $('thumb').style.left = ((sling.x + RAIL) / (RAIL * 2) * 100) + '%';
}

/* ---------- HUD and flow ---------- */
function renderHud() {
  $('score').textContent = score; $('level').textContent = level;
  $('combo').hidden = combo < 2; $('combo').textContent = '×' + combo;
  $('fireFill').style.width = (charge / FIRE_AT * 100) + '%';
  $('fireMeter').setAttribute('aria-valuenow', charge);
  $('fireStat').classList.toggle('ready', fireLoaded);
  $('fireLabel').textContent = fireLoaded ? 'Ready' : 'Fire';
}
function updateHint() {
  const el = $('hint'); if (state !== 'play') { el.hidden = true; return; }
  const msg = fpsMode() ? (coarse ? (hintPull ? 'Drag to look, hold Fire to draw' : '') : !locked() ? 'Click to aim with the mouse' : hintPull ? 'Hold the button to draw, let go to shoot' : '')
    : hintPull ? 'Drag back and let go' : hintMove ? (tilt.on ? 'Tilt your phone to move' : coarse ? 'Slide here to move' : 'Arrow keys or slide here to move') : '';
  el.hidden = !msg; el.textContent = msg;
}
function show(card) {
  $('overlay').hidden = !card;
  for (const id of ['menuCard', 'pauseCard', 'overCard', 'setCard']) $(id).hidden = id !== card;
  const inGame = state === 'play' || state === 'pause', fp = fpsMode();
  $('hud').hidden = !inGame; $('track').hidden = !inGame || fp; $('crosshair').hidden = !(inGame && fp && !card); fireBtn.hidden = !(inGame && fp && coarse && !card); updateHint();
  if (card && locked()) document.exitPointerLock();
}
function newGame() {
  audioInit();
  for (const t of targets.slice()) removeTarget(t);
  for (const s of shots.slice()) endShot(s);
  for (const t of tumbling.slice()) retireBird(t);
  for (const pr of props.slice()) retireProp(pr);
  score = 0; level = 1; hits = 0; combo = 1; charge = 0; fireLoaded = false; reload = 0; loadAge = 1; spawnT = 0.5; shake = kick = kickV = hurt = 0;
  sling.x = sling.tx = sling.v = 0; look.yaw = 0; look.pitch = 0.13; look.id = null; aim.on = false; aim.len = aim.px = aim.py = 0; move.id = null; tilt.zero = null;
  hintPull = hintMove = store.get('klak.forest.seen') !== '1'; store.set('klak.forest.seen', '1');
  state = 'play'; show(null); renderHud(); wakeOn(); perf.t = perf.n = 0; perf.skip = 90;
  for (let i = 0; i < 2; i++) spawnWave();
}
function gameOver() {
  state = 'over'; aim.on = false; aim.len = 0; move.id = null; wakeOff(); sfx.end();
  const isBest = score > 0 && score >= best;
  if (score > best) { best = score; store.set('klak.forest.best', best); }
  $('finalScore').textContent = score; $('finalLevel').textContent = level; $('finalBest').textContent = best;
  $('overNote').textContent = isBest && score > 0 ? 'A new best.' : 'Lead the flamingos and save the fireball for a crowd.';
  show('overCard');
}
function pause() { if (state === 'play') { state = 'pause'; aim.on = false; aim.len = 0; move.id = null; keys.l = keys.r = false; show('pauseCard'); wakeOff(); if (ac) ac.suspend(); } }
function resume() { if (state === 'pause') { state = 'play'; show(null); if (fpsMode() && !coarse) try { cv.requestPointerLock(); } catch (e) {} perf.t = perf.n = 0; perf.skip = 60; tilt.zero = null; audioInit(); wakeOn(); last = 0; } }
function soundLabel() { document.querySelectorAll('.sound-toggle').forEach(b => { b.textContent = muted ? 'Sound off' : 'Sound on'; b.setAttribute('aria-pressed', String(!muted)); }); }

const play = async () => { audioInit(); if (!fpsMode()) await askTilt(); newGame(); if (fpsMode() && !coarse) try { cv.requestPointerLock(); } catch (e) {} };
$('playBtn').addEventListener('click', play);
$('againBtn').addEventListener('click', play);
$('resumeBtn').addEventListener('click', resume);
$('endBtn').addEventListener('click', () => { if (state === 'pause') { if (ac) ac.resume(); gameOver(); } });
$('pauseBtn').addEventListener('click', () => state === 'pause' ? resume() : pause());
document.querySelectorAll('.sound-toggle').forEach(b => b.addEventListener('click', () => {
  muted = !muted; audioInit(); if (master) master.gain.value = muted ? 0 : 0.9; soundLabel(); store.set('klak.forest.muted', muted ? '1' : '0');
  if (!muted) tone(660, 0.1, 0.07);
}));
document.querySelectorAll('.tilt-toggle').forEach(b => b.addEventListener('click', async () => {
  tilt.on = !tilt.on; tilt.zero = null; store.set('klak.tilt', tilt.on ? '1' : '0');
  await askTilt(); tiltLabel(); updateHint();
}));
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
window.addEventListener('pagehide', pause);
window.addEventListener('blur', pause);
cv.addEventListener('webglcontextlost', ev => { ev.preventDefault(); pause(); });

/* ---------- sizing and adaptive quality ---------- */
let rzT = 0;
function resize() {
  W = window.innerWidth; H = window.innerHeight;
  const a = W / H;
  camera.aspect = a; baseFov = camera.fov = a < 0.8 ? 66 : a < 1.3 ? 58 : 50; camera.updateProjectionMatrix();
  const dpr = Math.min(window.devicePixelRatio || 1, perf.dpr);
  renderer.setPixelRatio(dpr); renderer.setSize(W, H, false);
  if (composer) { composer.setPixelRatio(dpr); composer.setSize(W, H); }
  const hh = SLING_D * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  rigBase.set(0, -hh * 0.72, -SLING_D); rig.position.copy(rigBase); rig.scale.setScalar(clamp(hh * 0.62, 0.72, 1.05) * Math.min(1, 0.62 + a * 0.62));
  const pointScale = H * dpr / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
  sparkPts.material.uniforms.uScale.value = pointScale; smokePts.material.uniforms.uScale.value = pointScale; fireflies.material.uniforms.uScale.value = pointScale;
  layoutFrame();
}
window.addEventListener('resize', () => { clearTimeout(rzT); rzT = setTimeout(() => { if (state !== 'load') resize(); }, 120); });     // boot sizes everything itself once it's built
async function buildPost() {                        // only the top tier draws through a composer, for ambient occlusion
  if (!Q.post) return;
  const target = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: Q.samples });
  composer = new EffectComposer(renderer, target);
  let ao = null;
  if (tier === 2) try {                             // soft contact shade where trunks, bushes and ground meet; only fetched on strong machines
    const { N8AOPass } = await import('./vendor/N8AO.js');
    ao = new N8AOPass(scene, camera, W, H);
    Object.assign(ao.configuration, { aoRadius: 2.4, distanceFalloff: 1.2, intensity: 2.6, aoSamples: 12, denoiseSamples: 6, denoiseRadius: 10, gammaCorrection: false, halfRes: true });
  } catch (e) { ao = null; }
  composer.addPass(ao || new RenderPass(scene, camera));
  composer.addPass(new OutputPass());
}
const perf = { t: 0, n: 0, skip: 120, step: 0, locked: false, dpr: Q.dpr };
function stepDown() {                               // once resolution is at its floor: ambient occlusion, then shadows, then leaves
  perf.step++;
  if (perf.step === 1 && composer) { composer.dispose(); composer = null; Q.post = false; }
  else if (perf.step === 2 && renderer.shadowMap.enabled) { sun.castShadow = false; renderer.shadowMap.enabled = false; scene.traverse(o => { if (o.material) o.material.needsUpdate = true; }); }
  else if (perf.step === 3) { if (meadowMesh) meadowMesh.count = Math.floor(meadowMesh.instanceMatrix.count * 0.55); grassMesh.count = Math.floor(grassMesh.instanceMatrix.count * 0.5); }
  else if (perf.step >= 4) { perf.locked = true; store.set('klak.forest.q', Math.max(0, tier - 1)); }
  perf.skip = 50;
}
function watchPerf(raw) {
  if (perf.locked || state !== 'play' || raw <= 0 || raw > 0.25) return;
  if (perf.skip > 0) { perf.skip--; return; }
  perf.t += raw; perf.n++;
  if (perf.n < 45) return;
  const avg = perf.t / perf.n; perf.t = perf.n = 0;
  if (avg > 1 / 50) { if (perf.dpr > 1) { perf.dpr = Math.max(1, perf.dpr - 0.2); resize(); } else stepDown(); }
  else if (avg < 1 / 58.5 && perf.dpr < Q.dpr) { perf.dpr = Math.min(Q.dpr, perf.dpr + 0.1); resize(); }
}
const meter = { t: 0, n: 0 };
function countFrame(raw) {                          // the corner readout, refreshed twice a second
  if (!opts.fps || raw <= 0 || raw > 1) return;
  meter.t += raw; meter.n++;
  if (meter.t < 0.5) return;
  $('fps').textContent = Math.round(meter.n / meter.t) + ' FPS'; meter.t = meter.n = 0;
}

let last = 0, frameN = 0;
function draw() {
  frameN++;
  if (renderer.shadowMap.enabled) { renderer.shadowMap.autoUpdate = false; if (frameN % 3 === 0) renderer.shadowMap.needsUpdate = true; }
  if (composer) composer.render(); else renderer.render(scene, camera);
}
function frame(t) {
  const raw = (t - last) / 1000 || 0; last = t;
  if (state !== 'pause') { update(Math.min(0.034, raw)); draw(); watchPerf(raw); countFrame(raw); }
  requestAnimationFrame(frame);
}
function renderIcons() {                            // the menu's little portraits are rendered from the real models
  const s = new THREE.Scene(), c = new THREE.PerspectiveCamera(30, 1, 0.1, 30);
  renderer.setClearColor(0x000000, 0); s.add(new THREE.HemisphereLight(0xfff4d8, 0x304028, 2.2));
  const l = new THREE.DirectionalLight(0xffffff, 2.4); l.position.set(2, 4, 5); s.add(l);
  shared.rim.value.setRGB(0.12, 0.12, 0.12);
  renderer.setPixelRatio(1); renderer.setSize(128, 128, false);
  document.querySelectorAll('.legend canvas').forEach(el => {
    const k = el.dataset.icon; let o, dist = 5.4;
    if (k === 'gold') { o = makeEgg('gold'); o.g.rotation.z = -0.4; dist = 4.4; }
    else {
      o = makeBird(k); o.g.rotation.set(0.3, 0.7, 0); o.act.time = 0; o.mixer.update(0.25 * o.act.getClip().duration); dist = 4.8;
    }
    s.add(o.g); c.position.set(0, 0.3, dist); c.lookAt(0, 0.12, 0);
    renderer.render(s, c);
    el.getContext('2d').drawImage(renderer.domElement, 0, 0, 128, 128);
    s.remove(o.g);
  });
  renderer.setClearColor(0x0a1710, 1);
}
async function boot() {
  W = window.innerWidth; H = window.innerHeight;
  applySky(0);
  await loadWorld(); buildGround(); await nap(); buildTrees(); await nap(); await loadFlora(); buildMeadow(); buildGrass(); buildFrame(); await nap(); buildAir(); buildFx();
  await loadBirds(); buildEggs(); buildShell(); buildSling();
  renderIcons();
  await buildPost(); resize();
  applySky(0); updateCamera(0);
  renderHud(); soundLabel(); tiltLabel(); setLabels();
  $('menuBest').textContent = best ? 'Best score ' + best : '';
  state = 'menu'; spawnBird('finch'); spawnBird('swift'); spawnEgg('nest', 'egg');
  $('playBtn').disabled = false; $('playBtn').textContent = 'Play';
  requestAnimationFrame(frame);
}
boot();

