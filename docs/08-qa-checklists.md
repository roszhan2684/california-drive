# Manual QA checklists

Automated coverage lives in `tests/` (see [06-test-strategy.md](06-test-strategy.md)). These checklists cover what automation cannot judge: feel, comfort, look and sound. **Verified** items were checked in this build through automated screenshots in headless Chrome (SwiftShader software rendering), unit tests or code review. **Pending** items need a human on a real GPU, controller and speakers before release.

## Driving feel (Gameplay QA)
| Check | Status |
|---|---|
| 0–100 km/h, top speed, braking, stability, handbrake and landing within bands | Verified (tests A1–A11) |
| Launch wheelspin controlled by TCS | Verified (unit test, slip ≤ 0.45) |
| Car turns in crisply at 30–60 km/h; no snap oversteer with assists on | Pending: real-time play on GPU |
| Assists off: controllable power oversteer; handbrake drift sustainable with throttle | Pending |
| Car holds on SF hills with brake/handbrake; no creeping | Verified (slope-hold test) / Pending visual |
| Curbs and intersections crests on SF hills do not launch the car unexpectedly | Pending |
| Reset (R) always lands on a road, facing a sensible direction | Verified (code + e2e) |
| Gamepad: triggers, stick deadzone, buttons per the README table | Pending (hardware) |

## Cameras & comfort
| Check | Status |
|---|---|
| All 9 camera modes reachable; chase ↔ close blend smoothly | Verified (e2e cycles chase → close → hood → cockpit) |
| Cockpit: readable gauges, steering wheel animates, A-pillars not obstructive | Verified (screenshot) |
| Reduced motion disables roll, shake, FOV kick and speed blur | Verified (code path) / Pending visual |
| No camera clipping into buildings in narrow streets | Pending |

## World
| Check | Status |
|---|---|
| No road gaps / chunk seams / NaN geometry for all 9 regions | Verified (world tests) |
| Spawn on a road, not inside buildings, for all 9 regions | Verified |
| Bridges above terrain, tunnels below the surface | Verified (data tests) |
| Broadway Tunnel drivable end to end, exposure adapts, reverb kicks in | Pending (real-time play) |
| Landmarks visible and discoverable (toast) | Verified (SF screenshot shows the Telegraph Hill tower) |

## Traffic
| Check | Status |
|---|---|
| Signals: no red-running, no axis conflicts, coordinated clusters | Verified (10-minute headless soak) |
| No permanent deadlocks; caps respected | Verified |
| Cars stop for the player; hazards when startled | Verified (unit) / Pending visual |

## Look & sound
| Check | Status |
|---|---|
| Golden hour, day, dusk, night, fog, rain and snow looks | Verified (gallery screenshots) |
| Wet roads darken and reflect after rain starts | Pending (GPU) |
| Engine pitch follows RPM; shifts dip; overrun crackle; tyre squeal at the limit | Pending (speakers) |
| Interior camera muffles exterior sound; tunnels add reverb | Pending (speakers) |

## Realism pass (opt-in captures: `CD_PLACES`, `CD_UISHOTS`, `CD_PREVIEWS`)
| Check | Status |
|---|---|
| Facade atlas: brick/stucco/concrete/siding keep their tint; SF Victorian bays and cornices; neon at night | Verified (qa-shots/places) |
| Night: lamp pools + real point lights, toned window emission, wet streaks in rain | Verified (LA Little Tokyo night shot) |
| Golden hour: shadowed facades not crushed to black | Verified after hemisphere fill boost |
| Traffic turn signals before turning, wheels spin and steer | Verified (unit test) / Pending visual on GPU |
| Pedestrians stay on sidewalks, turn corners, cross with the lights, dodge the player | Verified (unit tests) |
| Garage: drag to orbit, paints, vehicle switch, radar | Verified (qa-shots/ui) |
| City select relief: pins, jump chips, preview image | Verified (qa-shots/ui) |
| HUD: shift LEDs, rolling digits, boost (M3 only), G-meter | Verified (qa-shots/ui) |
| Photo: lens presets keep the framing, DOF, letterbox, four postcard templates | Verified DOF/letterbox; Pending manual postcard download check |
| Sun lens dirt only when the sun is unobstructed; heat haze subtle | Tuned after the first capture (was too strong); Pending GPU look |
| Gear whine, seal whistle, cabin boom | Pending (speakers) |

## UI / accessibility
| Check | Status |
|---|---|
| Keyboard-only: title menu, city select (Tab/Enter), pause tabs (↑/↓) | Verified (e2e uses keyboard for the title) |
| Remap a key, persists after refresh in the same tab, gone in a new tab | Verified (session tests) / Pending manual |
| Layout at 1280×720 and narrow widths | Verified 1280×720; Pending mobile widths |

## Privacy & release
| Check | Status |
|---|---|
| Zero cross-origin requests, zero non-GET requests during a full session | Verified (e2e network audit) |
| No localStorage / IndexedDB / cookies / beacons in source | Verified (unit scan) |
| Reset Session clears sessionStorage immediately | Verified (e2e + unit) |
| License guardrail passes; credits page lists all data/software | Verified |
| 60 FPS at 1080p High on a mid-range discrete GPU | **Pending: no GPU was available in the build environment** |
| Repeated teleport loop + weather cycling + city switch release GPU resources | Verified (`tests/e2e/memory.spec.ts`) |
| 30-minute memory soak on real hardware | Pending |
