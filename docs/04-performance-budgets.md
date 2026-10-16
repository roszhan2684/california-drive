# Performance budgets

Reference target: 1920×1080, mid-range discrete GPU (GTX 1660 / RX 6600 class), quad-core desktop CPU. **60 FPS at Medium/High**, 30 FPS floor on integrated GPUs at Low.

## Frame (16.7 ms @ 60 FPS)
| Slice | Budget |
|---|---|
| Physics (Rapier step ×1–2 substeps at 120 Hz + vehicle forces) | ≤ 2.0 ms |
| Traffic sim (≤ 40 agents) + signals | ≤ 0.8 ms |
| Camera, audio params, activities, HUD | ≤ 0.7 ms |
| Streaming (main-thread mesh upload, time-sliced) | ≤ 2.0 ms per frame, max 1 chunk finalize per frame |
| Render submission (CPU) | ≤ 4.0 ms |
| GPU | ≤ 12 ms (Medium) |

## Scene
| Item | Low | Medium | High | Cinematic |
|---|---|---|---|---|
| Pixel ratio cap | 0.75 | 1.0 | 1.0–1.5 | device (≤2) |
| Draw calls | ≤ 250 | ≤ 400 | ≤ 600 | ≤ 800 |
| Triangles | ≤ 0.8 M | ≤ 1.5 M | ≤ 2.5 M | ≤ 4 M |
| Shadow map | off / 1024 | 2048 | 2048 | 4096 |
| Chunk load radius | 1 ring (≈ 480 m) | 2 rings | 2 rings | 3 rings |
| Traffic cap | 8 | 18 | 28 | 40 |
| Bloom / grade | grade only | bloom + grade | bloom + grade + SMAA | all + speed blur |
| Particles (smoke/rain) | 300 / 2k | 800 / 6k | 1.5k / 10k | 2k / 16k |

## Memory & loading
* District JSON ≤ 5 MB uncompressed per city (≈ 1 MB gzip/brotli on static hosts).
* JS bundle ≤ 1.5 MB minified (three + rapier wasm inline is the bulk; Rapier ≈ 1.4 MB base64 — loaded lazily on first drive).
* Heap growth over a 30-minute session ≤ 50 MB after the first 2 minutes; all chunk geometries/materials are disposed on unload (verified by `tests/e2e/memory.spec.ts`: uploaded geometries never exceed those still in the scene after a teleport/weather loop, and leaving a city returns to the title-screen baseline).
* Cold load to drivable (cached wasm, broadband) ≤ 8 s; warm ≤ 4 s.

## Measured (this build)
| Item | Value |
|---|---|
| Title bundle | 926 KB (277 KB gzip): three.js + UI (garage, relief, photo templates) |
| World chunk (lazy) | 4.4 MB (1.7 MB gzip): Rapier WASM (inlined) + world systems |
| Chunk worker | 117 KB |
| District data | SF 2.4 MB (0.83 MB gzip); others 0.5–2.0 MB |
| Media (CC0 textures + HDRI + OFL fonts) | ≈ 3.6 MB, cached 7 days; procedural fallbacks render until loaded |
| Relief + city previews | 204 KB + ≈ 0.1 MB per city |
| Chunk generation (Node, M-series CPU) | 0.7–13.5 ms per 320 m chunk (SF 11.7 ms, LA 13.5 ms) |
| Static triangles per district (all chunks) | 0.31 M (Tahoe) to 1.0 M (LA), excluding instanced props |
| Traffic sim, 30 agents, 10 simulated minutes | ≈ 1.4 s wall time (≈ 0.08 ms per frame) |
| Vehicle physics, 4,800 steps | ≈ 0.12 s wall time (≈ 0.025 ms per step) |

The JS-bundle budget (≤ 1.5 MB) is exceeded by the lazily loaded world chunk because Rapier's compat build inlines its WASM as base64. Switching to `@dimforge/rapier3d` with a separately served `.wasm` would save about 30%. This is tracked as a Phase 7 follow-up. The title screen stays within budget.

GPU frame times could not be measured in the build environment (software rendering only). The F3 overlay reports CPU sim, render and GPU timings (`EXT_disjoint_timer_query_webgl2`) for the manual pass.

## Realism pass: additions and their cost controls
| Feature | Cost | Control |
|---|---|---|
| Ambient occlusion | Baked: facade base darkening in the building shader plus vertex AO on terrain/sidewalks at chunk build (≈ +2–6 ms per chunk in the worker). No per-frame pass | `uAO` uniform (Graphics → Ambient occlusion; off on Low) |
| Street-lamp point lights | N real `PointLight`s re-assigned to the nearest lamps each 0.25 s | `pointLights`: 0 / 4 / 6 / 10 by preset |
| Lamp/headlight beams, wet streaks, splashes, birds | ≈ 6 instanced draws, additive | Hidden when not night/rain |
| Traffic wheels, indicators, contact shadows | +3 instanced draws per variant (+12) and 1 shadow draw | Bound by the traffic cap |
| Pedestrians | 5 instanced draws (torso, head, legs, arms, shadow); sim ≈ 0.02 ms per frame for 40 | `pedestrians`: 10 / 24 / 40 / 60, scaled down by rain/snow/night |
| Facade/asphalt textures | 1 facade albedo atlas (2048²), 1 normal atlas (1024²), asphalt 1k | Shared by all chunks |
| Photo-mode DOF (`BokehPass`) | Extra depth render | Only enabled in photo mode with an f-stop selected |
| Lens: chroma, heat haze, sun dirt | A few ALU ops in the grade pass; one physics ray every 0.12 s | Off with Reduced motion (chroma/haze) |
| City-select relief | 101 k-vertex mesh, only rendered on the select screen | Lazy: 204 KB fetch |

The screen-space GTAO pass was removed. Its normal pre-pass rendered from the wrong view and flipped the image, and it cost a full extra scene render. Baked AO gives contact darkening at zero per-frame cost.

Headless SwiftShader reference (1280×720, High): title ≈ 5 FPS, proving ground ≈ 8 FPS, San Francisco ≈ 3.5 FPS. These numbers only compare builds against each other. They are not real-GPU numbers.

## Adaptive behavior
* `QualityGovernor` samples frame time over 3 s windows; if p90 > 22 ms at a preset it lowers traffic cap and pixel ratio first, then shadow size. Never changes physics rate.
