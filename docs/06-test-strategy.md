# Test strategy

## Layers
1. **Unit (Vitest, Node)** — pure modules: tire curve, engine torque/gearbox, session store, input mapping, signal state machine, IDM car-following, geometry helpers, chunk generator output.
2. **Deterministic physics integration (Vitest + Rapier WASM in Node)** — the real vehicle on a generated proving ground with scripted inputs at a fixed 120 Hz step:
   * 0–100 km/h time within band; top speed sanity
   * 100–0 km/h braking distance within band, ABS keeps wheels rolling
   * straight-line stability at 200 km/h (lateral drift and yaw rate bounded with zero input)
   * steady-state cornering (no spin with ESC on; measurable oversteer with ESC off + handbrake)
   * handbrake turn produces yaw and recovers
   * jump/landing from a ramp: no NaN, no explosion, settles within 2 s
   * reset/flip recovery from upside-down
   * frame-pacing independence: identical input traces at 30/60/144 Hz render rates converge (fixed-step accumulator)
3. **World validation (Vitest on generated district JSON)** — every imported city: no road gaps (consecutive points ≤ 8 m), intersection connectivity (largest component ≥ 90% of nodes), chunk seam continuity (shared terrain edges identical), spawn not inside building footprints, road grade sanity, bridge/tunnel clearance, landmark override removed overlapping buildings.
4. **Traffic simulation (Vitest, headless)** — run the real traffic system on the SF lane graph for 10 simulated minutes: signal compliance (no vehicle crosses a stop line on red at > 2 m/s), no permanent deadlock (recovery fires), spawn/despawn bubble respected, density cap respected, no vehicle overlap > threshold.
5. **Activities & session (Vitest)** — time trial checkpoint order, drift scoring, speed trap, parking tolerance, ghost recording memory-only; Reset Session clears `sessionStorage`; nothing written to `localStorage`/IndexedDB/cookies.
6. **Memory/stress E2E** — `tests/e2e/memory.spec.ts`: 8 district teleports with weather cycling, then city switch; asserts no GPU geometry/texture leaks.
7. **Browser E2E (Playwright, Chrome headless with SwiftShader)** — boot, title → city select → load SF → reveal → drive (throttle moves the car), camera switch, pause/resume, settings change, Reset Session, keyboard-only menu navigation, and a **network privacy audit** (every request is same-origin static assets; no request bodies).
8. **Manual QA** — `docs/08-qa-checklists.md` (driving feel, camera comfort, traffic sanity, visual seams, audio mix, accessibility).

GPU visual output is verified by screenshots for human review only; automated assertions avoid pixel-exact comparisons to tolerate renderer variance.

## Gates
`npm run typecheck && npm test && npm run build && npm run check:licenses && npm run test:e2e` must pass before a phase is marked complete.
