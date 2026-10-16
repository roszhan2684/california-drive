# Phase 0 & Phase 1 task graph

```
P0.1 repo + TS/Vite ──┬─> P0.2 coding standards (tsconfig strict, erasable syntax)
                      ├─> P0.3 test harness (Vitest, Playwright) ──> P0.6 CI workflow
                      ├─> P0.4 asset/license manifests ──> P0.7 license guardrail script
                      ├─> P0.5 performance budgets doc
                      └─> P0.8 debug overlay + event bus + fixed-step loop
                                   │
P1.1 Rapier world wrapper <────────┘
   ├─> P1.2 tire model (pure)      ─┐
   ├─> P1.3 engine/gearbox/diff    ─┼─> P1.5 vehicle sim (suspension, forces, assists) ──> P1.9 physics tests
   └─> P1.4 input actions + gamepad ┘             │
                                                  ├─> P1.6 procedural coupe mesh + wheel/light view
                                                  ├─> P1.7 camera rig (chase/close/cockpit/hood/bumper/dash/wheel/orbit)
                                                  ├─> P1.8 engine audio synth
                                                  ├─> P1.10 skid marks + tire smoke
                                                  ├─> P1.11 HUD (speed, rpm, gear, assists)
                                                  ├─> P1.12 reset/flip recovery
                                                  └─> P1.13 tuning panel (lil-gui)
P1.14 proving ground scene (flat pad, slalom cones, ramp, banked turn) <── P1.1
P1.15 driving-feel QA checklist sign-off <── P1.5..P1.13
```

Phase 2+ depends on P1.15. World pipeline (P2) can begin data import in parallel since `tools/import-city.ts` has no runtime dependencies.

## Phase 0 deliverables
* `package.json` scripts: `dev`, `build`, `typecheck`, `test`, `test:e2e`, `import:city`, `check:licenses`.
* `ASSET_LICENSES.md`, `THIRD_PARTY_NOTICES.md`, `docs/05-asset-intake-template.md`.
* `docs/04-performance-budgets.md`.
* Debug overlay toggled with **F3** (FPS, CPU sim ms, render ms, GPU ms when `EXT_disjoint_timer_query_webgl2` is available, draw calls, triangles, chunk count, traffic count).

## Phase 1 deliverables
See `docs/07-acceptance-criteria.md` for the measurable criteria.
