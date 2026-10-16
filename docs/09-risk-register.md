# Risk register

| ID | Risk | Likelihood | Impact | Mitigation | Owner | Status |
|---|---|---|---|---|---|---|
| R1 | Vehicle feel is floaty/arcadey; custom tire model hard to tune | High | High | Combined-slip tire model, deterministic tests with bands, live tuning panel, vertical slice before content | Vehicle Physics | Open (mitigated) |
| R2 | OSM data inconsistencies (missing heights, broken connectivity, buildings on roads) | High | Medium | Importer validation: drop buildings over road centerlines, default heights, promote signals to junctions, connectivity test | World/GIS | Open (mitigated) |
| R3 | Steep SF terrain causes road/terrain z-fighting or wheels catching on terrain | Medium | High | Road decks are separate colliders above terrain; surface offset; terrain sampled with the same triangulation in render and physics | World/GIS | Open |
| R4 | Tunnels under hills conflict with terrain collision | Medium | Medium | Collision groups: inside a tunnel zone wheel rays and chassis ignore terrain; terrain triangles over portals removed | World/GIS + Physics | Open |
| R5 | Browser perf on integrated GPUs | High | High | Quality presets, adaptive governor, chunk streaming with explicit disposal, instancing | Performance | Open |
| R6 | Trademark exposure (BMW M3 Competition model at owner's request; landmark names) | High | High | Personal-use only; badge toggle; non-affiliation notice; Vireo S6 brand-free alternative; must switch default vehicle or license before public deploy (see ASSET_LICENSES.md) | Asset & Licensing | **Open — blocks public release** |
| R7 | Overpass public API availability/rate limits | Medium | Low | One-time cached extracts committed as district.json; runtime never contacts OSM | World/GIS | Closed |
| R8 | Large static payloads exceed free hosting bandwidth | Medium | Medium | Compact JSON, procedural meshes/audio/textures (no binary assets), gzip/brotli | Build/Release | Open |
| R9 | WebAudio autoplay restrictions | High | Low | Audio context resumed on first user gesture (Drive button) | Audio | Closed |
| R10 | Traffic deadlocks at complex OSM junctions | Medium | Medium | Deadlock detector despawns/repositions stuck agents out of view; tests simulate 10 minutes | Traffic AI | Open (mitigated) |
| R11 | Rapier WASM init time in browsers | Low | Medium | `rapier3d-compat` lazy init during loading screen | Physics | Closed |
| R12 | Motion sickness from camera effects | Medium | Medium | Reduced-motion setting disables roll/shake/FOV kick/speed blur; follows `prefers-reduced-motion` by default | Rendering | Closed |
| R13 | Privacy regression (accidental analytics or persistent storage) | Low | High | No third-party scripts; strict CSP; e2e network audit; unit test asserting no localStorage writes | Security/Privacy | Closed |
