# Reference vehicle data and provenance

Every preset records `sourceReference`, `sourceEdition`, `provenance` and free-text `notes` that are
shown in the Vehicle Library and written into the generated file header.

**Primary source:** IRC:6-2017 — *Standard Specifications and Code of Practice for Road Bridges,
Section II: Loads and Load Combinations*, Clause 204 (Live Loads), Tables 1–3 and Figs. 1–3.

```
IRC Class A train  —  Cl. 204.3, Fig. 2, Table 2
IRC Class 70R (wheeled / tracked) — Cl. 204.1, Fig. 1
IRC Class 70R bogie — Cl. 204.1, Note 3
```

## 1. Class A train of vehicles — 554 kN

| Axle | Load (kN) | Offset from axle 1 (m) | Wheel load each (kN) | Contact patch (m, w × l) |
|---|---|---|---|---|
| A1 | 27 | 0.00 | 13.5 | 0.15 × 0.20 |
| A2 | 27 | 1.10 | 13.5 | 0.15 × 0.20 |
| A3 | 114 | 4.30 | 57.0 | 0.50 × 0.25 |
| A4 | 114 | 5.50 | 57.0 | 0.50 × 0.25 |
| A5 | 68 | 9.80 | 34.0 | 0.38 × 0.20 |
| A6 | 68 | 12.80 | 34.0 | 0.38 × 0.20 |
| A7 | 68 | 15.80 | 34.0 | 0.38 × 0.20 |
| A8 | 68 | 18.80 | 34.0 | 0.38 × 0.20 |

* Wheel gauge 1.80 m centre-to-centre; transverse occupancy 2.30 m (1.80 m gauge + 0.50 m contact).
* Axle loads, spacings and contact patches from IRC:6-2017; the 18.80 m train length follows from the
  spacings.
* Kerb clearance requirement used by validation: `f ≥ 0.15 m` (Table 3).

## 2. Class 70R wheeled vehicle — 1000 kN

| Axle | Load (kN) | Offset from axle 1 (m) | Wheel load each (kN) |
|---|---|---|---|
| A1 | 80 | 0.00 | 40 |
| A2 | 120 | 3.96 | 60 |
| A3 | 120 | 5.48 | 60 |
| A4 | 170 | 7.61 | 85 |
| A5 | 170 | 8.98 | 85 |
| A6 | 170 | 12.03 | 85 |
| A7 | 170 | 13.40 | 85 |

* Axle train 13.40 m (IRC figure overall length ≈ 15.4 m).
* Verified transverse occupancy 2.90 m — IRC:6-2017 Cl. 204.1 note 4 uses `1.2 × 2 + 2.9 = 5.3 m`.
* **Contact patches are nominal.** IRC:6-2017 does not tabulate an equivalent wheel-contact table for
  this vehicle in the provisions used here. The app uses a 0.84 m transverse spread per side and a
  0.25 m longitudinal patch, derived from the verified 2.90 m occupancy. These affect drawing,
  edge-clearance geometry and load distribution only — **never the axle loads or spacings**.
  Confirm the contact patch against your project specification before relying on clearance geometry.
* Kerb clearance requirement used by validation: `C ≥ 1.20 m` (Cl. 204.1 note 4).

## 3. Class 70R tracked vehicle — 700 kN

| Attribute | Value |
|---|---|
| Total load | 700 kN (350 kN per track) |
| Track contact length | 4.57 m |
| Track width | 0.84 m |
| Track centres | 2.06 m (transverse occupancy 2.90 m) |
| Overall vehicle length | 7.92 m (only the contact area carries load) |

For generation and load transfer the track load is discretised into equal longitudinal slices
(`trackSlices`), each slice carrying `350 / n` kN.

## 4. Class 70R bogie — 400 kN

Two axles at 1.22 m centres, 200 kN per axle (Cl. 204.1 note 3), using the same nominal contact spread
as the wheeled vehicle. Intended for local deck-slab checks.

## 5. What the application will not do

* It does not infer loads or spacings from an illustration.
* It does not combine materially different permitted arrangements into one definition; those are
  separate presets (wheeled, tracked, bogie).
* It does not claim a modified definition is code data: any edit clears the verified flag.
* It does not derive IRC impact factors. A user multiplier is recorded as an assumption in the output.

## 6. Verification checklist for users

Before using a preset in a design submission:

1. Compare the loads and spacings in the Vehicle Library table with the code text for the edition your
   project adopts (IRC:6-2017 or an earlier edition if the contract specifies it).
2. Confirm the contact patch values you intend to use for clearance and local effects.
3. Confirm the lane/transverse occupancy rules for the carriageway width (Cl. 204.1 notes 2–5).
4. Record the confirmation in the project JSON (`sourceReference`, notes) so reviewers can see it.
