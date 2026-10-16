# Repository structure and ownership map

```
california-drive/
├─ docs/                      ADRs, plans, budgets, test strategy, risk register, QA checklists
├─ tools/                     Node (strip-types) tooling — no runtime code
│  ├─ import-city.ts          OSM (Overpass, one-time bounded extract) + open DEM -> district JSON
│  ├─ check-licenses.ts       no-paid-dependency / license allow-list guardrail (CI)
│  └─ lib/fetchers.ts         cached Overpass + terrain tile fetchers
├─ public/cities/<id>/        generated district.json per region (ODbL-attributed)
├─ src/
│  ├─ core/                   loop (fixed step), event bus, session store, settings, quality presets
│  ├─ input/                  action map, keyboard, gamepad, remapping
│  ├─ physics/                Rapier world wrapper, collision groups
│  │  └─ vehicle/             tire, engine, gearbox, differential, assists, vehicle sim (pure TS)
│  ├─ vehicle/                procedural coupe + traffic car meshes, vehicle view (lights, wheels, cockpit)
│  ├─ render/                 renderer, sky/sun, environment, post FX, Karl-the-Fog height fog, weather, materials
│  ├─ camera/                 spring rig and camera modes, blending, collision avoidance
│  ├─ world/                  data types, projection, heightfield, road graph, chunk generator (worker), streaming, landmarks, validation
│  ├─ traffic/                lane network, signals, IDM driver, spawn bubble, deadlock recovery, traffic view
│  ├─ vfx/                    skid marks, tire smoke, spray, rain, sparks, exhaust
│  ├─ audio/                  WebAudio graph, engine synthesis, ambience, tunnel reverb
│  ├─ activities/             scenic route, time trial (+ghost), drift, speed trap, parking, slalom, photo spots, discovery
│  ├─ ui/                     title, city select (CA map), loading, HUD, minimap, pause, settings, postcard, credits
│  ├─ debug/                  perf overlay (CPU sim vs GPU), tuning panel
│  └─ game/                   composition root wiring subsystems through typed interfaces
└─ tests/
   ├─ unit/                   Vitest: physics proving ground, world validation, traffic, session/privacy, input
   └─ e2e/                    Playwright: boot, city select, drive, pause, reset session, network privacy audit
```

## Rules
* Subsystems communicate through typed interfaces and the event bus (`src/core/events.ts`), never by reaching into each other's internals.
* Simulation modules (`physics/vehicle`, `traffic/sim`, `world/roadGraph`, `activities/*` logic) import no DOM APIs so they run in Node tests.
* Subjective values (tire curves, camera springs, grading) live in typed config objects exposed through the tuning panel.

## Multi-agent ownership map

| Workstream / agent | Owned modules | Depends on | Key tests |
|---|---|---|---|
| Executive Producer / Lead Architect | `docs/`, `src/game/`, `src/core/events.ts` | all | build + e2e gates |
| Game Design | `src/activities/`, `src/world/cities.ts` (activity data) | world, ui | activities.test |
| Vehicle Physics | `src/physics/` | core | vehicle.test (0–100, braking, stability, handbrake, landing, reset, frame pacing) |
| Rendering / Lighting / Cameras | `src/render/`, `src/camera/`, `src/vehicle/carModel.ts` | world, physics | camera.test, smoke screenshots |
| World / GIS | `tools/import-city.ts`, `src/world/` | — | world.test (continuity, intersections, seams, clearance, grade) |
| Traffic AI | `src/traffic/` | world | traffic.test (signals, deadlock, spawn/despawn, avoidance) |
| VFX | `src/vfx/` | render, physics | vfx pool caps test |
| Audio | `src/audio/` | physics, camera | audio mapping test |
| UI/UX & Accessibility | `src/ui/`, `src/input/` | core | input.test, e2e keyboard nav |
| Performance | `src/core/quality.ts`, `src/debug/overlay.ts`, `docs/04-performance-budgets.md` | all | e2e frame-time sample |
| Asset & Licensing | `ASSET_LICENSES.md`, `THIRD_PARTY_NOTICES.md`, `tools/check-licenses.ts` | — | check:licenses |
| QA Automation | `tests/`, `vitest.config.ts`, `playwright.config.ts` | all | — |
| Gameplay QA | `docs/08-qa-checklists.md` | all | manual checklist |
| Build / Release | `vite.config.ts`, `.github/workflows/ci.yml` | QA | CI |
| Security / Privacy | `src/core/session.ts`, CSP in `index.html`, privacy e2e | core | session.test, privacy e2e |

Each workstream records owned files, current tasks, dependencies, risks, tests, acceptance criteria and handoff notes in `docs/workstreams.md`. Cross-subsystem changes go through an interface change in the owning module, not edits to another owner's internals.
