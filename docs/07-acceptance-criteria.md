# Acceptance criteria — Driving vertical slice (Phase 1)

All numbers are measured by `tests/unit/vehicle.test.ts` on the proving ground with default tuning, assists ON unless stated.

| # | Criterion | Pass band |
|---|---|---|
| A1 | 0–100 km/h (auto gearbox, full throttle, TCS on) | 3.3 s – 5.0 s |
| A2 | Top speed after 40 s full throttle | 250 – 320 km/h |
| A3 | 100–0 km/h braking distance (ABS on) | 30 m – 42 m |
| A4 | ABS: no wheel locked (slip ratio > −0.35) for more than 0.15 s during A3 | true |
| A5 | Straight-line stability at 200 km/h, zero input, 5 s | lateral drift < 1.0 m, |yaw rate| < 0.05 rad/s |
| A6 | Steady circle, 50 % steer at 60 km/h with ESC on, 8 s | no spin (|body slip| < 15°) |
| A7 | Handbrake at 60 km/h with 60 % steer | yaw rate peak > 0.8 rad/s; car remains upright |
| A8 | Drop from 2 m / ramp jump at 80 km/h | no NaN; settles (|v_y| < 0.2 m/s) within 2.5 s of landing; upright |
| A9 | Reset from upside-down | upright, speed 0, above ground within 1 frame |
| A10 | Frame pacing | final position after identical 6 s input at 30/60/144 Hz render rate differs < 0.5 m |
| A11 | Gear shifts (auto) | upshift ≥ 4 times during A2 run, never downshift while accelerating at full throttle above 30 km/h |
| A12 | Controls | keyboard + standard gamepad mapped; every driving action in the brief has a binding (Controls screen lists them) |
| A13 | Cameras | chase, close chase, bumper, hood, cockpit, dashboard, wheel, side, orbit — switching blends smoothly (≥ 0.35 s) except into interior views |
| A14 | Feedback | engine audio follows RPM/load; skid marks and smoke appear when |slip| exceeds threshold |
| A15 | HUD | speed, gear, RPM, assists, camera name; updates at ≥ 20 Hz |
| A16 | Tuning panel | lil-gui panel exposes tire, suspension, engine, assist and camera parameters live (F4) |
| A17 | Performance | proving ground ≥ 60 FPS on reference GPU at High (manual) |

The phase is complete only when A1–A11 pass in CI, A12–A17 are checked in the manual checklist, and driving "feels convincing and stable" per Gameplay QA sign-off.
