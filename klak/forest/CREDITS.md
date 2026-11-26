# Klak Forest credits

Third-party assets and libraries bundled with the 3D game.

| What | Where in this folder | Source | License |
| --- | --- | --- | --- |
| three.js r187 | `three.bundle.js`, `vendor/GLTFLoader.js`, `vendor/HDRLoader.js`, `vendor/BufferGeometryUtils.js`, `vendor/SkeletonUtils.js`, `vendor/Pass.js` | https://threejs.org | MIT |
| N8AO 2.0.2 (ambient occlusion, top quality tier only) | `vendor/N8AO.js` | https://github.com/N8python/n8ao | ISC |
| Parrot, Flamingo, Stork models | `models/` | mirada / ro.me, via the three.js examples | MIT (three.js repository) |
| Sky HDRI "Kloofendal 48d Partly Cloudy (Pure Sky)" | `tex/sky.hdr` | Poly Haven | CC0 |
| Forest ground, bark, rock textures (`forrest_ground_01`, `bark_brown_02`, `rock_boulder_dry`) | `tex/ground_*`, `tex/bark_*`, `tex/rock_*` | Poly Haven | CC0 |
| Slingshot wood (`ash_veneer`) and pouch leather normal map (`brown_leather`) | `tex/wood_*`, `tex/leather_nor.webp` | Poly Haven | CC0 |
| Leaf photos (LeafSet024 beech, LeafSet010 maple), arranged into `tex/leaves.webp` | `tex/leaves.webp` | ambientCG | CC0 |

`vendor/postprocessing-stub.js` is ours: it stands in for the pmndrs `postprocessing` package that N8AO imports but this game doesn't use.
