import type { Axis, CoordMapping } from "../types";
import { EPS } from "./units";

/**
 * Deck ↔ STAAD.Pro global coordinate mapping
 * ==========================================
 * Step 1. Deck plan vector (Xd, Zd) is rotated about the vertical axis by
 *         mapping.rotationDeg using the same convention as the canvas:
 *             X' = Xd·cosφ − Zd·sinφ
 *             Z' = Xd·sinφ + Zd·cosφ
 * Step 2. X' is assigned to the global axis `longitudinalAxis` scaled by
 *         `longitudinalSign`, Z' to `transverseAxis` scaled by `transverseSign`.
 * Step 3. The vertical (deck Yd) components are assigned to `verticalAxis`
 *         scaled by `verticalSign`.
 * Step 4. The configured global origin is added.
 *
 * The vertical axis is never used for plan geometry. Axis permutations that
 * would place the deck in a vertical plane are rejected by validation.
 */

export interface GlobalPoint {
  x: number;
  y: number;
  z: number;
}

export interface DeckPoint {
  xd: number;
  zd: number;
  yd: number;
}

const AXIS_INDEX: Record<Axis, 0 | 1 | 2> = { X: 0, Y: 1, Z: 2 };

export function axisIndex(axis: Axis): 0 | 1 | 2 {
  return AXIS_INDEX[axis];
}

export function mappingIssues(mapping: CoordMapping): string[] {
  const issues: string[] = [];
  const axes = [mapping.longitudinalAxis, mapping.transverseAxis, mapping.verticalAxis];
  if (new Set(axes).size !== 3) {
    issues.push("Longitudinal, transverse and vertical axes must be three different global axes.");
  }
  if (mapping.verticalAxis !== "Y" && mapping.verticalAxis !== "Z") {
    issues.push("Vertical axis must be Y or Z for a gravity load model.");
  }
  if (mapping.longitudinalAxis === mapping.verticalAxis) {
    issues.push("The deck longitudinal axis cannot be the vertical axis.");
  }
  if (mapping.rotationDeg % 360 !== 0) {
    issues.push("Deck rotation about the vertical axis is non-zero; moving-load generation requires 0°.");
  }
  return issues;
}

export function deckToGlobal(point: DeckPoint, mapping: CoordMapping): GlobalPoint {
  const phi = (mapping.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const xr = point.xd * cos - point.zd * sin;
  const zr = point.xd * sin + point.zd * cos;

  const out: [number, number, number] = [0, 0, 0];
  out[axisIndex(mapping.longitudinalAxis)] += mapping.longitudinalSign * xr;
  out[axisIndex(mapping.transverseAxis)] += mapping.transverseSign * zr;
  out[axisIndex(mapping.verticalAxis)] += mapping.verticalSign * point.yd;

  return {
    x: mapping.originXM + out[0],
    y: mapping.originYM + out[1],
    z: mapping.originZM + out[2],
  };
}

export function globalToDeck(point: GlobalPoint, mapping: CoordMapping): DeckPoint {
  const local: [number, number, number] = [
    point.x - mapping.originXM,
    point.y - mapping.originYM,
    point.z - mapping.originZM,
  ];
  const xr = mapping.longitudinalSign * local[axisIndex(mapping.longitudinalAxis)];
  const zr = mapping.transverseSign * local[axisIndex(mapping.transverseAxis)];
  const yd = mapping.verticalSign * local[axisIndex(mapping.verticalAxis)];

  const phi = (mapping.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);

  return {
    xd: xr * cos + zr * sin,
    zd: -xr * sin + zr * cos,
    yd,
  };
}

/** Global force components for a downward vehicle load of magnitude P kN. */
export function downwardForceComponents(
  magnitudeKN: number,
  mapping: CoordMapping,
): { fx: number; fy: number; fz: number } {
  const force: [number, number, number] = [0, 0, 0];
  // Downward in deck coordinates is −Yd, so the global vertical component is
  // −sV·P. With the usual sV = +1 and vertical axis Y this yields FY = −P.
  force[axisIndex(mapping.verticalAxis)] = -mapping.verticalSign * magnitudeKN;
  return {
    fx: force[0],
    fy: force[1],
    fz: force[2],
  };
}

export function verticalAxisLetter(mapping: CoordMapping): Axis {
  return mapping.verticalAxis;
}

/** Global displacement produced by moving `distanceM` along +Xd on the deck. */
export function longitudinalDelta(mapping: CoordMapping, distanceM: number): GlobalPoint {
  const phi = (mapping.rotationDeg * Math.PI) / 180;
  return deckToGlobal({ xd: distanceM * Math.cos(phi), zd: distanceM * Math.sin(phi), yd: 0 }, {
    ...mapping,
    originXM: 0,
    originYM: 0,
    originZM: 0,
  });
}

export function describeMapping(mapping: CoordMapping): string {
  const sign = (s: number) => (s >= 0 ? "+" : "−");
  return (
    `Xd → ${sign(mapping.longitudinalSign)}${mapping.longitudinalAxis}, ` +
    `Zd → ${sign(mapping.transverseSign)}${mapping.transverseAxis}, ` +
    `Yd → ${sign(mapping.verticalSign)}${mapping.verticalAxis}, ` +
    `origin (${mapping.originXM}, ${mapping.originYM}, ${mapping.originZM}) m, ` +
    `rotation ${mapping.rotationDeg}°`
  );
}

export function isAxisAligned(mapping: CoordMapping): boolean {
  const rotationAligned = Math.abs(((mapping.rotationDeg % 90) + 90) % 90) < EPS;
  return rotationAligned;
}
