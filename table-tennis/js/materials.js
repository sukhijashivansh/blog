import * as THREE from '../vendor/three.module.js';

// the scene's materials, all made here in code: wood grain is drawn onto canvases, so there's nothing to download
const seeded = seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const hex = c => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
const mix = (a, b, t) => { const p = hex(a), q = hex(b); return `rgb(${p.map((v, i) => Math.round(v + (q[i] - v) * t)).join(',')})`; };

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function texture(c, repeat = [1, 1], aniso = 8) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.anisotropy = aniso;
  return t;
}

// sawn wood: long wavy lines running with the board, darker and lighter, as its growth rings show at the surface
function grain(g, x, y, w, h, { light, dark, lines, sway, r }) {
  g.fillStyle = mix(light, dark, 0.1 + r() * 0.2);
  g.fillRect(x, y, w, h);
  for (let i = 0; i < lines; i++) {
    const at = x + r() * w, bend = (r() - 0.5) * sway, wave = 1 + r() * 2;
    g.strokeStyle = mix(light, dark, 0.35 + r() * 0.65);
    g.globalAlpha = 0.04 + r() * 0.18;
    g.lineWidth = 0.4 + r() * (r() < 0.12 ? 3 : 1.2);
    g.beginPath();
    g.moveTo(at, y);
    for (let s = 1; s <= 8; s++) {
      const v = s / 8;
      g.lineTo(at + bend * Math.sin(v * Math.PI * wave + i), y + v * h);
    }
    g.stroke();
  }
  g.globalAlpha = 1;
}

// a pale maple sports floor: narrow boards of slightly different shades, laid end to end
export function maple(aniso) {
  const [c, g] = canvas(512, 1024), r = seeded(11), boards = 8, bw = 512 / boards;
  for (let i = 0; i < boards; i++) {
    const cut = 200 + r() * 600;
    for (const [y, h] of [[0, cut], [cut, 1024 - cut]]) {
      grain(g, i * bw, y, bw, h, { light: 0xf5ebdd, dark: 0xd6c0a0, lines: 46, sway: 10, r });
      g.fillStyle = 'rgba(120, 90, 60, .16)';
      g.fillRect(i * bw, y, bw, 1.5);
    }
    g.fillStyle = 'rgba(120, 90, 60, .14)';
    g.fillRect(i * bw, 0, 1.2, 1024);
  }
  return texture(c, [10, 5], aniso);
}

// dark walnut for the table's frame, and a warmer oak for its legs
export function walnut(aniso) {
  const [c, g] = canvas(256, 512), r = seeded(7);
  grain(g, 0, 0, 256, 512, { light: 0x8a5e3c, dark: 0x3e2716, lines: 140, sway: 14, r });
  return texture(c, [1, 1], aniso);
}

export function oak(aniso) {
  const [c, g] = canvas(256, 512), r = seeded(23);
  grain(g, 0, 0, 256, 512, { light: 0xe0bb87, dark: 0x9a6b3c, lines: 120, sway: 12, r });
  return texture(c, [1, 1], aniso);
}

// a pale ash handle with a thin walnut strip down the middle, the way flared handles are glued up
export function ash(aniso) {
  const [c, g] = canvas(256, 512), r = seeded(5);
  grain(g, 0, 0, 256, 512, { light: 0xf2dcb8, dark: 0xc19468, lines: 90, sway: 6, r });
  g.fillStyle = mix(0x5b3b22, 0x3a2414, 0.4);
  g.fillRect(118, 0, 20, 512);
  return texture(c, [12, 6], aniso);
}

// a blade's edge shows its plies: thin layers of light and dark wood stacked through its thickness
export function plies(thickness) {
  const [c, g] = canvas(4, 64), layers = [0xe9cfa3, 0x8f6238, 0xd8b483, 0x6f4a2a, 0xd8b483, 0x8f6238, 0xe9cfa3];
  layers.forEach((col, i) => { g.fillStyle = `#${col.toString(16).padStart(6, '0')}`; g.fillRect(0, (i * 64) / layers.length, 4, 64 / layers.length + 1); });
  const t = texture(c, [1, 1 / thickness], 1);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

// inverted rubber is smooth and slightly tacky: a low sheen over a faintly mottled surface, so a face tilted towards the sun
// brightens a little but stays red, rather than washing out pink the way a glossy coat would
let mottle = null;
function rubberSurface() {
  if (mottle) return mottle;
  const [c, g] = canvas(128, 128), r = seeded(3), img = g.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 232 + r() * 23;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return (mottle = texture(c, [9, 9], 4));
}
export const rubber = color => new THREE.MeshPhysicalMaterial({ color, map: rubberSurface(), roughness: 0.68, clearcoat: 0.1, clearcoatRoughness: 0.55, specularIntensity: 0.45, envMapIntensity: 0.6 });
// the sponge under it shows only as a thin band at the edge
export const sponge = color => new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
export const wood = map => new THREE.MeshStandardMaterial({ map, roughness: 0.62 });
// brushed aluminium for the net posts
export const metal = () => new THREE.MeshStandardMaterial({ color: 0xd8dce2, metalness: 1, roughness: 0.32 });
