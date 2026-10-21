# Test plan and status

## Automated suites (run with `npm test`)

| Suite | Tests | Focus |
|---|---|---|
| `tests/geometry.test.ts` | 26 | deck derivation, lane splitting, reference points, IRC load data, wheel-load splitting, track slicing, edge-clearance solving, clearance reporting, rotations, deck ↔ global round trips, force directions |
| `tests/syntax.test.ts` | 43 | moving-load plans and generation starts, direction reversal, mapping permutations, rotation blocking, deterministic documents, parser robustness, transfer methods, static emission and rejection, reconstruction, project round trips |
| `tests/theme.test.tsx` | 18 | theme resolution, persistence, system-preference changes, light/dark canvas palettes, contrast guarantees, the header switch and the settings control |
| `tests/project-schema.test.ts` | 12 | project-file validation: malformed JSON, field paths, schema version gate, cross-field checks, duplicate ids |
| `tests/app.test.tsx` | 20 | tab rendering, plan rendering, shared model → syntax, undo/redo, library provenance, persistence, import flow, syntax editor behaviour |

Command:

```bash
npm test
```

Current status: **120 passing, 1 skipped** (the sample writer runs only with `WRITE_SAMPLES=1`).

## PRD acceptance matrix — application-side evidence

| ID | Test | Application-side evidence | STAAD execution |
|---|---|---|---|
| T-01 | Moving-load definition | Class A and 70R load/distance arrays asserted against the library | not run |
| T-02 | Moving-load generation | position count, increment, direction and start coordinate asserted | not run |
| T-03 | Static placement | joint loads re-parsed and summed to the vehicle load; case rejected when a wheel cannot be placed | not run |
| T-04 | Edge placement | requested clearance reproduced to 1e-9 at placement and to 0.1 mm after geometry edits | not run |
| T-05 | Coordinate conversion | forward/reverse mapping round trip across rotations, sign flips and origin offsets | not run |
| T-06 | Syntax import | library match, imported definition, reconstruction of a generation position | not run |
| T-07 | Partial syntax | definition-only and generation-only inputs produce no invented placement | not run |
| T-08 | Unsupported syntax | unknown command preserved verbatim with line number and reason | not run |
| T-09 | Version compatibility | adapters share one grammar; both marked unverified | not run |
| T-10 | Analysis verification | not an application responsibility | not run |

## Moving-load specific cases from the PRD

| Case | Covered by |
|---|---|
| Two-axle vehicle, one spacing | bogie preset, distance count assertions |
| Multi-axle with unequal spacings | Class A / 70R spacing assertions |
| Vehicle with a supported transverse width | `WIDTH` emitted for the load-line representation |
| Known start reference and increment | generation start assertion (centre reference, first load line) |
| Reverse movement | negative increment assertion |
| Reference elevation inconsistent with the model | reconstruction elevation warning |
| Plate-dominant model | guidance in `docs/limitations.md`; bilinear transfer available for static |

## Static specific cases from the PRD

| Case | Covered by |
|---|---|
| Wheels on valid nodes | exact-joint transfer test |
| Wheel between nodes needing transfer | lever and bilinear transfer tests; rejected when off-axis |
| Vehicle near a barrier | placement diagnostics and clearance tests |
| Wheel outside the deck | off-deck warning test |
| Rotated global coordinate system | mapping tests; generation blocked, static still emitted |
| Multiple vehicles as separate cases | sample project (three placements) |
| Force totals match the vehicle load | applied/emitted reconciliation test |

## Appearance

| Check | Covered by |
|---|---|
| Dark mode applies the `dark` class and `color-scheme` | `theme.test.tsx` |
| Light mode paints the plan with the light palette | `theme.test.tsx` |
| `System` follows the OS and reacts to a change while open | `theme.test.tsx` |
| Preference persists and survives blocked storage | `theme.test.tsx` |
| Appearance is not written into the project file or history | `theme.test.tsx` |
| Vehicle colours stay legible on white paper (contrast ≥ 3.1) | `theme.test.tsx` |

Both plans are rendered to `artifacts/plan.png` (dark) and `artifacts/plan-light.png` (light) with
`SNAPSHOT_THEME`, so the two drawings can be compared side by side.

## Manual checks still required

1. Open generated files in STAAD.Pro 2022 and 2025 and confirm acceptance and load counts.
2. Compare a static case against a hand calculation for total force and individual joint forces.
3. Confirm joint force directions under a non-default mapping with a simple cantilever.
4. Confirm clearance geometry against the project's own IRC contact-patch requirements.
