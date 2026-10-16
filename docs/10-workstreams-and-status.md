# Workstreams & phase status

Status as of this build. "Done" means implemented with automated tests. Items needing human/GPU verification are tracked in [08-qa-checklists.md](08-qa-checklists.md).

## Phases

| Phase | Scope | Status |
|---|---|---|
| 0 Foundation | TS/Vite, strict TS, Vitest + Playwright, license guardrail, manifests, budgets, debug overlay (F3, CPU/GPU timings) | Done |
| 1 Driving vertical slice | Vireo S6, custom vehicle physics, keyboard + gamepad, 9 cameras, engine audio, skid/smoke, HUD, reset, tuning panel (F4), proving ground | Done; feel sign-off pending on real hardware |
| 2 San Francisco district | OSM + DEM import, hills, buildings, roads, collisions, traffic graph, fog/day/night, scenic route, 3 landmark overrides, chunk streaming, tunnels | Done |
| 3 World toolkit | Reusable importer/chunker (`tools/import-city.ts`, `src/world/chunkGen.ts`), worker generation, landmark kit, validation tests | Done |
| 4 Cinematic layer | Weather (5 kinds), wet roads, VFX, camera blends, grading, tunnel exposure, photo mode + postcard, audio mix | Done |
| 5 Activities | Time trial + ghost, scenic route, drift, speed trap, parking, slalom, photo spots, landmark discovery | Done |
| 6 City expansion | LA, San Diego, San Jose, Oakland, Sacramento, Santa Monica, Lake Tahoe, Yosemite | Done (data imported for all 9 regions) |
| 7 Optimization | Worker generation, instancing, chunk streaming + disposal, adaptive resolution, quality presets, code splitting | Done; KTX2/meshopt not applicable (no binary assets) |
| 8 Release | License/privacy audits, credits page, README, CSP/headers, static build | Done; deploy + GPU performance pass pending (needs the owner's hosting account) |

## Workstreams

| Workstream | Owned modules | Current state | Risks / handoff notes |
|---|---|---|---|
| Lead Architect | `src/game/*`, `docs/` | Composition root with lazy-loaded world | Keep subsystems behind interfaces; `game.ts` is the only cross-cutting module |
| Game Design | `src/activities/*`, `src/world/cities.ts` | 7 activity types; per-city configs | Activity coordinates are approximate and snap to the nearest road |
| Vehicle Physics | `src/physics/*` | 14 deterministic tests passing | Tune on real hardware with F4; keep the test bands green |
| Rendering/Cameras | `src/render/*`, `src/camera/*`, `src/vehicle/carModel.ts` | Sky scale patch tames Preetham HDR | Revisit exposure on HDR displays |
| World/GIS | `tools/import-city.ts`, `src/world/*` | 9 districts, all validation tests passing | Overpass is rate-limited: importer retries and caches |
| Traffic AI | `src/traffic/*` | Coordinated signal clusters, IDM, reservations | Complex multi-level interchanges (LA) use simplified turn connectors |
| VFX | `src/vfx/*` | Pooled particles, ring-buffer skid marks | — |
| Audio | `src/audio/*` | Fully synthesized | Mix needs a listening pass on speakers |
| UI/UX | `src/ui/*`, `src/input/*` | Title, map select, HUD, pause sheet, photo mode | Touch controls intentionally unsupported |
| Performance | `src/core/quality.ts`, `src/debug/*` | Presets + governor | Needs GPU profiling pass |
| Asset & Licensing | `ASSET_LICENSES.md`, `THIRD_PARTY_NOTICES.md`, `tools/check-licenses.ts`, `tools/fetch-assets.ts` | CC0 Poly Haven textures/HDRI + OFL font, all recorded; guardrail in CI | Any future asset must use the intake template |
| QA Automation | `tests/*` | 140 unit tests, e2e smoke + privacy audit, memory/teleport + two-visit leak e2e, opt-in visual/places/UI/preview captures | e2e uses SwiftShader, so it asserts behavior, not FPS |
| Security/Privacy | `src/core/session.ts`, CSP | No persistent storage, no third-party requests | Keep the CSP `connect-src 'self'` |

## Realism pass ("build all"): substitutions
A few brainstorm items were swapped for equivalents that keep the project free, open and code-generated:

| Brainstormed | Built instead | Why |
|---|---|---|
| Blender-modelled hero car | Deeper procedural detail on the code-built M3/Vireo (flake paint, drilled discs, sidewall lettering, wheel blur) | No ripped or paid models; the car stays generated in code |
| WebGPU renderer | WebGL2 with a real point-light pool, volumetric beams and neon | WebGPU support is still uneven; this keeps one renderer path |
| CC0 engine recordings | Better synthesis (turbo, blow-off, gear whine, seal whistle, cabin mix) | Recordings were not sourced; synthesis follows rpm/load continuously and needs no sample licensing |
| Mixamo pedestrians | Code-animated instanced pedestrians | Mixamo content sits under Adobe account terms, not an open license, so it fails the free/open asset rule |
| Screen-space GTAO | Baked facade/ground AO + contact shadows | The GTAO pass flipped the view and cost a full extra render |

## Bugs found and fixed while verifying the realism pass
| Bug | Symptom | Fix | Guard |
|---|---|---|---|
| LSD coupling overshoot | Launch ~6× slower at any heading except due north: the explicit `dOmega × 350` locking torque overcorrected ≈4× per 120 Hz step, so rear wheels oscillated against each other once left/right were not bit-for-bit symmetric | Gain capped at `0.4·I/dt` (`src/physics/vehicle/vehicle.ts`) | `heading independence` unit test (5 headings within 2 km/h) |
| Camera fly-in through the ground | After a skipped reveal or a far teleport the camera blended from the world origin (LA spawn is 474 m away) under the terrain | Blends that start > 60 m from the target cut instead | Preview captures for all 9 cities |
| Per-world GPU leaks | Each city visit left the sky's reflection-scene meshes, the sun shadow map/depth texture and a noise texture (shared uniform pointed at a disposed texture) | `SkySystem.dispose`, `Materials.dispose` (restores the shared noise uniform) | Memory e2e now compares two title visits |
| Invisible shafts still rasterized | Day-time headlight/lamp cones were drawn with zero strength | Beam materials hidden below a visibility threshold | — |
| First-seconds shader stalls | Dozens of programs compiled on the first driving frames | `renderer.compileAsync` during loading ("Warming up shaders…") | FPS probe (debug spec) |
| Point-light count churn | Lamp lights toggling `visible` changed the light count and recompiled every lit material | Constant count at night; unused lights stay at zero intensity | — |

## Free-asset pass (2026-10-15): what was used from the brief, and what wasn't
| Suggested source | Outcome | Why |
|---|---|---|
| Kenney (CC0): Car Kit, Input Prompts, Crosshair Pack | **Used.** Traffic fleet + parked civilians, crash debris, keyboard/gamepad glyphs, lock-on reticle | CC0 with direct downloads; the GLBs are baked at load time into the existing instanced traffic format (`src/vehicle/kenneyFleet.ts`) |
| Google Fonts (OFL): Bebas Neue, Rajdhani, Share Tech Mono, Inter | **Used** (self-hosted woff2) | The CSP only allows fonts from `'self'`. Orbitron was skipped because Rajdhani covers the "industrial instrument" role with better legibility |
| Spring / tween libraries (DOTween, Godot Tween) | **Ported the idea:** `src/ui/motion.ts` implements Godot's `TRANS_*` × `EASE_*` curves, parallel/chain steps and a damped spring | Those libraries are engine-specific; ~250 lines of TS give the same overshoot-and-settle feel with no dependency |
| Rive (state machines) | **Pattern used, runtime not added:** `src/ui/targetLock.ts` is a 4-state machine (idle → acquiring → locked → lost) with tweened transitions | `.riv` files must be authored in the Rive editor; the coded version needs no extra 300 KB runtime and can be swapped for a `.riv` later |
| Game UI Database | Reference only | Used for the boot log / bulb check / radar sweep conventions |
| Godot Engine / Unreal Engine (UMG, Common UI) | **Not used** | Porting would mean throwing away the working Three.js + Rapier game (physics, streaming, 9 districts, 150 tests). The useful ideas (Godot Tween curves, Control-style anchoring) were brought over instead |
| Unreal "City Sample" (Matrix Awakens), Synty / Unity Asset Store samples | **Not used** | Their EULAs restrict them to those engines, so they cannot ship in a WebGL game |
| Sketchfab / TurboSquid / CGTrader / Free3D / Open3DModel / Blender 3D Architect | **Not used** | Account-gated downloads with mixed per-model licenses (CC-BY, editorial, personal-only). Each model would need its own intake review (docs/05). The pier Ferris wheel is built procedurally instead |
| ITHappy "Cartoon City Free" | **Not used** | Asset-store terms vary by store; our buildings come from real OSM footprints, which a generic modular city would replace with less accurate shapes |

### Verification
- `tests/unit/upgrades.test.ts`: easing endpoints and Back overshoot, spring convergence, lock state machine and target choice, glyph mapping, palette sampling, parked-variant spread, weighted spawn.
- `tests/e2e/upgrades.spec.ts` (opt-in, `CD_UPGRADES=1`): HUD boot, fleet in LA traffic, crash debris, lock-on, Ferris wheel at dusk and night.
