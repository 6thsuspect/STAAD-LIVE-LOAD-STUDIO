import type { AxleDefinition, VehicleDefinition } from "../types";
import { fmt, round } from "./units";

/**
 * Reference vehicle library.
 *
 * Data provenance is recorded per definition. Load magnitudes and longitudinal
 * spacings are transcribed from IRC:6-2017 (Standard Specifications and Code of
 * Practice for Road Bridges, Section II — Loads and Load Combinations):
 *   • Class A train of vehicles — Cl. 204.3, Fig. 2, Table 2.
 *   • Class 70R wheeled and tracked vehicles — Cl. 204.1, Fig. 1.
 *   • Class 70R bogie — Cl. 204.1, Note 3.
 *
 * Ground-contact patches for the Class A train are the IRC:6-2017 Table 2 values.
 * IRC:6 does not tabulate an equivalent wheel-contact table for the 70R wheeled
 * vehicle in the provisions used here, so the 70R transverse contact spread is
 * derived from the verified 2.90 m Class 70R transverse occupancy (2.06 m track
 * centres + 0.84 m track width, the tracked-vehicle figures) and the longitudinal
 * contact is a nominal 0.25 m. Those two numbers affect drawing, edge-clearance
 * geometry and load distribution only — never the axle loads or spacings.
 * Every definition is editable, and the app marks any edited copy as user-modified.
 */

const IRC_EDITION = "IRC:6-2017";

function axle(
  n: number,
  loadKN: number,
  offsetM: number,
  trackSpacingM: number,
  wheelWidthM: number,
  wheelLengthM: number,
  wheels = 2,
): AxleDefinition {
  const wheelLoadsKN =
    wheels === 2 ? [loadKN / 2, loadKN / 2] : Array.from({ length: wheels }, () => loadKN / wheels);
  return {
    id: `axle-${n}`,
    label: `A${n}`,
    loadKN,
    longitudinalOffsetM: offsetM,
    wheelLoadsKN,
    trackSpacingM,
    wheelWidthM,
    wheelLengthM,
  };
}

/** IRC Class A train: 8 axles, 554 kN, transverse wheel gauge 1.80 m. */
function classA(): VehicleDefinition {
  const loads = [27, 27, 114, 114, 68, 68, 68, 68];
  const spacings = [1.1, 3.2, 1.2, 4.3, 3.0, 3.0, 3.0];
  const patches: Array<[number, number]> = [
    [0.15, 0.2],
    [0.15, 0.2],
    [0.5, 0.25],
    [0.5, 0.25],
    [0.38, 0.2],
    [0.38, 0.2],
    [0.38, 0.2],
    [0.38, 0.2],
  ];
  let offset = 0;
  const axles = loads.map((load, index) => {
    if (index > 0) offset = round(offset + spacings[index - 1], 6);
    const [width, length] = patches[index];
    return axle(index + 1, load, offset, 1.8, width, length);
  });

  return {
    id: "preset-irc-class-a",
    name: "IRC Class A train of vehicles",
    shortName: "Class A",
    classification: "IRC Class A",
    vehicleType: "wheeled",
    axles,
    tracks: [],
    widthM: 2.3,
    lengthM: 18.8,
    datumDescription: "Axle 1 (27 kN) line, vehicle centreline",
    sourceReference: "IRC:6-2017 Cl. 204.3, Fig. 2, Table 2",
    sourceEdition: IRC_EDITION,
    provenance: "reference-preset",
    notes:
      "8-axle train, total 554 kN. Axle loads 27/27/114/114/68/68/68/68 kN at 1.10/3.20/1.20/4.30/3.00/3.00/3.00 m. " +
      "Wheel gauge 1.80 m c/c. Ground contact 0.50 × 0.25 m (114 kN), 0.38 × 0.20 m (68 kN), 0.15 × 0.20 m (27 kN) per Table 2 " +
      "(transverse × longitudinal). 2.30 m transverse occupancy = 1.80 m gauge + 0.50 m contact.",
    isBuiltIn: true,
  };
}

/** IRC Class 70R wheeled: 7 axles, 1000 kN. */
function class70RWheeled(): VehicleDefinition {
  const loads = [80, 120, 120, 170, 170, 170, 170];
  const spacings = [3.96, 1.52, 2.13, 1.37, 3.05, 1.37];
  let offset = 0;
  const axles = loads.map((load, index) => {
    if (index > 0) offset = round(offset + spacings[index - 1], 6);
    return axle(index + 1, load, offset, 2.06, 0.84, 0.25);
  });
  return {
    id: "preset-irc-70r-wheeled",
    name: "IRC Class 70R wheeled vehicle",
    shortName: "70R wheeled",
    classification: "IRC Class 70R (wheeled)",
    vehicleType: "wheeled",
    axles,
    tracks: [],
    widthM: 2.9,
    lengthM: 13.4,
    datumDescription: "Axle 1 (80 kN) line, vehicle centreline",
    sourceReference: "IRC:6-2017 Cl. 204.1, Fig. 1",
    sourceEdition: IRC_EDITION,
    provenance: "reference-preset",
    notes:
      "7-axle wheeled vehicle, total 1000 kN. Axle loads 80/120/120/170/170/170/170 kN at 3.96/1.52/2.13/1.37/3.05/1.37 m " +
      "(13.40 m axle train; IRC figure overall length ≈ 15.4 m). Verified 2.90 m transverse occupancy. " +
      "Transverse contact spread 0.84 m per side and 0.25 m longitudinal contact are nominal footprint values used for drawing " +
      "and clearance geometry only — verify contact patch against your project specification.",
    isBuiltIn: true,
  };
}

/** IRC Class 70R tracked: 700 kN over two 4.57 m × 0.84 m tracks at 2.06 m centres. */
function class70RTracked(): VehicleDefinition {
  return {
    id: "preset-irc-70r-tracked",
    name: "IRC Class 70R tracked vehicle",
    shortName: "70R tracked",
    classification: "IRC Class 70R (tracked)",
    vehicleType: "tracked",
    axles: [],
    tracks: [
      {
        id: "track-plus",
        label: "Track +Zd",
        loadKN: 350,
        longitudinalStartM: 0,
        longitudinalEndM: 4.57,
        transverseCentreM: 1.03,
        widthM: 0.84,
      },
      {
        id: "track-minus",
        label: "Track −Zd",
        loadKN: 350,
        longitudinalStartM: 0,
        longitudinalEndM: 4.57,
        transverseCentreM: -1.03,
        widthM: 0.84,
      },
    ],
    widthM: 2.9,
    lengthM: 4.57,
    datumDescription: "Front edge of track contact area, vehicle centreline",
    sourceReference: "IRC:6-2017 Cl. 204.1, Fig. 1",
    sourceEdition: IRC_EDITION,
    provenance: "reference-preset",
    notes:
      "Tracked vehicle, total 700 kN (350 kN per track). Contact length 4.57 m, track width 0.84 m, track centres 2.06 m " +
      "(2.90 m transverse occupancy). Overall vehicle length 7.92 m; only the 4.57 m contact area carries load. " +
      "Track load is discretised into longitudinal slices for generation and load transfer.",
    isBuiltIn: true,
  };
}

/** IRC Class 70R bogie: two 200 kN axles at 1.22 m centres. */
function class70RBogie(): VehicleDefinition {
  return {
    id: "preset-irc-70r-bogie",
    name: "IRC Class 70R bogie (400 kN)",
    shortName: "70R bogie",
    classification: "IRC Class 70R (bogie)",
    vehicleType: "wheeled",
    axles: [axle(1, 200, 0, 2.06, 0.84, 0.25), axle(2, 200, 1.22, 2.06, 0.84, 0.25)],
    tracks: [],
    widthM: 2.9,
    lengthM: 1.22,
    datumDescription: "Bogie axle 1 line, vehicle centreline",
    sourceReference: "IRC:6-2017 Cl. 204.1, Note 3",
    sourceEdition: IRC_EDITION,
    provenance: "reference-preset",
    notes:
      "40 t bogie: two axles at 1.22 m centres, 200 kN per axle (400 kN total). Footprint values are the same nominal " +
      "spread used for the 70R wheeled vehicle. Commonly used for local deck-slab checks.",
    isBuiltIn: true,
  };
}

export function customTemplate(): VehicleDefinition {
  return {
    id: `custom-${Date.now().toString(36)}`,
    name: "Custom vehicle",
    shortName: "Custom",
    classification: "Custom",
    vehicleType: "wheeled",
    axles: [
      axle(1, 100, 0, 1.8, 0.4, 0.25),
      axle(2, 200, 4, 1.8, 0.4, 0.25),
    ],
    tracks: [],
    widthM: 2.2,
    lengthM: 4,
    datumDescription: "Axle 1 line, vehicle centreline",
    sourceReference: "User-defined — not an IRC load class",
    sourceEdition: "—",
    provenance: "user-custom",
    notes:
      "User-defined vehicle. Loads, spacings and footprints are not verified against any code and must be confirmed by the user.",
    isBuiltIn: false,
  };
}

export function presetVehicles(): VehicleDefinition[] {
  return [classA(), class70RWheeled(), class70RTracked(), class70RBogie()];
}

export function cloneVehicle(vehicle: VehicleDefinition, options?: { id?: string; suffix?: string }): VehicleDefinition {
  const id = options?.id ?? `vehicle-${Math.random().toString(36).slice(2, 9)}`;
  const suffix = options?.suffix ?? "copy";
  return {
    ...vehicle,
    id,
    name: `${vehicle.name} (${suffix})`,
    isBuiltIn: false,
    provenance: "user-verified",
    axles: vehicle.axles.map((a) => ({ ...a, wheelLoadsKN: [...a.wheelLoadsKN] })),
    tracks: vehicle.tracks.map((t) => ({ ...t })),
  };
}

export interface VehicleIssue {
  level: "error" | "warning" | "info";
  message: string;
}

export function validateVehicle(vehicle: VehicleDefinition): VehicleIssue[] {
  const issues: VehicleIssue[] = [];
  if (!vehicle.name.trim()) issues.push({ level: "error", message: "Vehicle name is required." });
  if (vehicle.widthM <= 0) issues.push({ level: "error", message: "Vehicle width must be positive." });

  if (vehicle.vehicleType === "tracked") {
    if (vehicle.tracks.length === 0) issues.push({ level: "error", message: "A tracked vehicle needs at least one track." });
    vehicle.tracks.forEach((track) => {
      if (track.loadKN <= 0) issues.push({ level: "error", message: `${track.label}: load must be positive.` });
      if (track.widthM <= 0) issues.push({ level: "error", message: `${track.label}: width must be positive.` });
      if (Math.abs(track.longitudinalEndM - track.longitudinalStartM) <= 0) {
        issues.push({ level: "error", message: `${track.label}: contact length must be positive.` });
      }
    });
    const computed = Math.max(
      ...vehicle.tracks.map((t) => Math.max(Math.abs(t.transverseCentreM) + t.widthM / 2, 0)),
      0,
    );
    if (computed > vehicle.widthM / 2 + 1e-6) {
      issues.push({
        level: "warning",
        message: `Track outer edge (${fmt(computed)} m from centreline) exceeds the declared vehicle width ${fmt(vehicle.widthM)} m.`,
      });
    }
    return issues;
  }

  if (vehicle.axles.length === 0) issues.push({ level: "error", message: "A wheeled vehicle needs at least one axle." });
  const sorted = [...vehicle.axles].sort((a, b) => a.longitudinalOffsetM - b.longitudinalOffsetM);
  sorted.forEach((axleDef, index) => {
    if (axleDef.loadKN <= 0) issues.push({ level: "error", message: `${axleDef.label}: axle load must be positive.` });
    const wheelSum = axleDef.wheelLoadsKN.reduce((a, b) => a + b, 0);
    if (Math.abs(wheelSum - axleDef.loadKN) > 0.01) {
      issues.push({
        level: "error",
        message: `${axleDef.label}: wheel loads sum to ${fmt(wheelSum)} kN but the axle load is ${fmt(axleDef.loadKN)} kN.`,
      });
    }
    if (axleDef.trackSpacingM <= 0) {
      issues.push({ level: "warning", message: `${axleDef.label}: transverse wheel spacing is zero or negative.` });
    }
    if (axleDef.wheelWidthM <= 0 || axleDef.wheelLengthM <= 0) {
      issues.push({
        level: "warning",
        message: `${axleDef.label}: no wheel contact patch defined — edge clearance is measured to the wheel line centre.`,
      });
    }
    if (index > 0 && axleDef.longitudinalOffsetM === sorted[index - 1].longitudinalOffsetM) {
      issues.push({ level: "error", message: `${axleDef.label}: two axles share the same longitudinal offset.` });
    }
  });
  const computedWidth = Math.max(
    ...vehicle.axles.map((a) => (a.wheelLoadsKN.length > 1 ? a.trackSpacingM / 2 + a.wheelWidthM / 2 : a.wheelWidthM / 2)),
    0,
  ) * 2;
  if (Math.abs(computedWidth - vehicle.widthM) > 0.02) {
    issues.push({
      level: "info",
      message: `Computed transverse extents (${fmt(computedWidth)} m) differ from the declared vehicle width (${fmt(vehicle.widthM)} m).`,
    });
  }
  return issues;
}

export function vehicleSummary(vehicle: VehicleDefinition): string {
  if (vehicle.vehicleType === "tracked") {
    return `${vehicle.tracks.length} tracks · ${fmt(vehicle.tracks.reduce((a, t) => a + t.loadKN, 0), 0)} kN`;
  }
  return `${vehicle.axles.length} axles · ${fmt(vehicle.axles.reduce((a, x) => a + x.loadKN, 0), 0)} kN`;
}
