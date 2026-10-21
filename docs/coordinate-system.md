# Coordinate system

## 1. Deck coordinates (the source of truth)

| Axis | Meaning | Positive direction | Origin |
|---|---|---|---|
| `Xd` | longitudinal | start abutment → end abutment | start abutment |
| `Zd` | transverse | towards the **left** deck edge when looking along +Xd | deck centreline |
| `Yd` | vertical | up | deck surface |

* Units are metres (length) and kilonewtons (force). Values are stored at full float precision and
  rounded only for display or output.
* The deck occupies `0 ≤ Xd ≤ span` and `−totalWidth/2 ≤ Zd ≤ +totalWidth/2`.
* Because +Zd is the left edge, lane 0 is the leftmost lane (`Zd` closest to `+carriageway/2`). This
  matches the usual STAAD lane numbering that starts at the wider `Z` side.
* The deck plan is drawn with screen `y = −Zd`, so the plan is never mirrored longitudinally.

Transverse bands, from +Zd to −Zd:

```
deck edge (+W/2)
  └ left barrier        width leftBarrierWidthM
  └ left footpath       width leftFootpathWidthM
  └ left kerb           width leftKerbWidthM
  └ carriageway         width = W − all of the above
  └ right kerb / footpath / barrier (mirrored)
deck edge (−W/2)
```

The usable carriageway is **derived** from those components. If the entered carriageway value differs,
the derived value governs placement and clearance checks and the difference is reported.

The `longitudinalOrigin` and `transverseOrigin` settings change the labels and the displayed coordinate
values only. Stored geometry never moves, so switching an origin cannot silently translate a load.

## 2. Vehicle-local coordinates

| Axis | Meaning |
|---|---|
| `u` | along the vehicle, from its **datum**, increasing towards the rear |
| `v` | across the vehicle, `0` on the vehicle centreline, `+v` towards the vehicle's left wheel line |

Each definition states its datum (`datumDescription`). The presets use the first axle line (wheeled) or
the front of the track contact area (tracked).

A placement stores its position through a named **reference point**:

| Reference | Offset from the vehicle geometry |
|---|---|
| `vehicle-centre` | midpoint of the longitudinal extent, v = 0 |
| `vehicle-front` | datum line, v = 0 |
| `reference-axle` | first axle line, v = 0 |
| `outer-wheel-plus` | longitudinal midpoint, v = +half width |
| `outer-wheel-minus` | longitudinal midpoint, v = −half width |

```
Xd = x_ref + (u − u_ref)·cosθ − (v − v_ref)·sinθ
Zd = z_ref + (u − u_ref)·sinθ + (v − v_ref)·cosθ
```

`θ` is the placement rotation. The inverse is used when converting a picked deck point back to a
vehicle coordinate.

## 3. Edge clearance

The clearance `c` is measured from the selected datum line to the **outer edge of the nearest wheel or
track contact patch** — not to the wheel line centre and not to the vehicle body edge.

```
+Zd side: Z_ref = Z_datum − c − max(relativeZd)
−Zd side: Z_ref = Z_datum + c − min(relativeZd)
```

`relativeZd` is the signed transverse offset of every wheel/track footprint corner, including the
contact-patch width, evaluated after rotation. When the deck width, barrier widths, lane widths or the
vehicle definition change, the placement is re-solved from the stored clearance, so the requested value
is always reproduced. The validation panel checks this reproduction to 0.1 mm.

## 4. Deck → STAAD.Pro global mapping

Four settings, applied in order:

1. **Rotation** `φ` about the vertical axis, using the same convention as the canvas:
   `X′ = Xd·cosφ − Zd·sinφ`, `Z′ = Xd·sinφ + Zd·cosφ`.
2. **Axis assignment** — `X′ → longitudinalAxis × longitudinalSign`,
   `Z′ → transverseAxis × transverseSign`.
3. **Vertical assignment** — `Yd → verticalAxis × verticalSign`.
4. **Origin** — the global coordinates of deck point `(0, 0, 0)` are added.

The default mapping is `Xd → +X`, `Zd → +Z`, `Yd → +Y` with origin `(0, 0, 0)` and `φ = 0`:

```
Xd = x,  Zd = z,  Yd = y
Global point  (X, Y, Z) = (Xd, 0, Zd)
```

Vertical vehicle loads then become `FX = 0, FY = −P, FZ = 0`.

Examples:

| Mapping | Deck (Xd, Zd) | Global point | Downward force for P = 100 kN |
|---|---|---|---|
| default | (12, −2.25) | (12, 0, −2.25) | FY = −100 |
| `Xd→+Z`, `Zd→+X`, `Yd→+Y` | (12, −2.25) | (−2.25, 0, 12) | FY = −100 |
| `Xd→−X`, `Zd→+Z`, `Yd→+Y` | (12, −2.25) | (−12, 0, −2.25) | FY = −100 |
| `Yd→−Z` (a Z-up model) | (12, −2.25) | (12, −2.25, 0) | FZ = +100 |

Validation rules enforced by the app:

* the three axis letters must be different;
* the vertical axis must be `Y` or `Z`;
* moving-load generation requires `φ ≡ 0 (mod 360)`, because `XINC/YINC/ZINC` can only sweep one
  global axis — the app reports this instead of emitting a sweep that disagrees with the plan.

## 5. Elevation

Vehicle loads are applied at the deck surface (`Yd = 0`). Static cases therefore land on the supplied
joints at whatever elevation those joints have; the app does not invent a deck level. When a
`LOAD GENERATION` start point in imported text differs from the deck datum, the difference is reported
so the model level can be confirmed.

## 6. Rounding

| Output | Decimals |
|---|---|
| coordinates in generated syntax | 4 |
| loads and forces | 3 |
| inter-load distances | 5 |
| lane widths, geometry readouts | 3 |
| validation tolerances | 0.1 mm for clearance reproduction, 1 mm for count/equality checks |
