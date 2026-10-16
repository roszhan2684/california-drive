# ADR-001 — Rendering engine and physics approach

Status: **Accepted** · Date: 2026-10-14 · Owner: Lead Architect

## Context
California Drive is a static-hosted browser game. Constraints: free/open dependencies only, no backend, 60 FPS target at 1080p on mid-range desktop GPUs, streamed open-geodata districts, a believable sports-car model, and an automated test suite that can exercise the physics headlessly.

## Decision

| Concern | Choice | License |
|---|---|---|
| Rendering | **Three.js r186** (WebGL2 renderer) + three/addons (Sky, EffectComposer, UnrealBloom, SMAA, OutputPass) | MIT |
| Physics | **Rapier 0.21 (`@dimforge/rapier3d-compat`, WASM inlined)** for rigid bodies, colliders, ray casts and CCD | Apache-2.0 |
| Vehicle model | **Custom raycast-suspension vehicle** written in TypeScript on top of a Rapier chassis body | project (MIT) |
| Build | Vite 8 + TypeScript (strict, erasable-syntax only so tools run under `node --experimental-strip-types`) | MIT / Apache-2.0 |
| Tests | Vitest (unit, integration, deterministic physics) + Playwright (browser flows, privacy network audit) | MIT / Apache-2.0 |
| Tuning UI | lil-gui | MIT |

### Why Three.js over Babylon.js
* Smaller core and tree-shakable addons; we write our own game framework conventions anyway (the brief requires typed, data-driven subsystems with no god classes).
* `onBeforeCompile`/ShaderChunk access lets us implement global height fog ("Karl the Fog"), wet-road response and building window lighting without forking the engine.
* Babylon's editor and built-in physics plugins would be valuable for a team using its inspector, but we need a custom tire model and Rapier directly, so those conveniences give us little. **We do not maintain both engines.**

### Why a custom vehicle on Rapier instead of `DynamicRayCastVehicleController`
Rapier's controller uses a simplified friction model without slip-ratio/slip-angle tire curves, torque curves, differentials or assists. The brief requires all of those plus deterministic tuning tests. We therefore:
* use a Rapier **dynamic rigid body** for the chassis (mass, inertia tensor, CCD, collisions with buildings, traffic and walls);
* cast **one ray per wheel** against the world (excluding the chassis and filtered by collision groups so tunnels can ignore terrain);
* compute **spring/damper suspension**, anti-roll bars, **combined-slip tire forces** (simplified Pacejka "magic formula" with friction circle), engine torque curve, gearbox, LSD differential, brake bias, handbrake, ABS/TCS/ESC and steering assist in plain TypeScript;
* apply forces with `addForceAtPoint` at a **fixed 120 Hz substep** with an accumulator, so behavior is independent of display frame rate.

All vehicle math lives in `src/physics/vehicle/*` with no DOM/Three dependencies, so Vitest runs the real model headlessly against Rapier in Node.

## Consequences
* We own tire tuning. Mitigation: debug tuning panel (lil-gui) + deterministic proving-ground tests with numeric acceptance bands.
* WebGPU is not used in the MVP; Three's WebGPURenderer can be evaluated later behind the same render interfaces.
* Terrain and road collisions are **triangle meshes** generated from the same data as the visuals (no Rapier heightfield) so visual and physical surfaces always agree, including tunnel cut-outs.
