import type {
  ClearanceReport,
  EdgeDatum,
  DeckGeometry,
  VehicleDefinition,
  VehicleFootprint,
  VehiclePlacement,
  VehicleReference,
  WheelLoad,
} from "../types";
import { clamp, round, sum } from "./units";

/**
 * Deck coordinate system
 * ----------------------
 * Xd : longitudinal, increasing from the "start" abutment to the "end" abutment.
 * Zd : transverse, signed. +Zd is towards the LEFT deck edge when looking along +Xd.
 * Yd : vertical, up. The deck surface is Yd = 0.
 *
 * The deck centreline is Zd = 0. The left barrier occupies the strip nearest +Zd.
 * Because +Zd is the left edge, lane 0 is the leftmost lane (highest Zd), which is
 * the convention used by STAAD lane/floor generation references.
 */

export interface Lane {
  index: number;
  /** Zd of the +Zd boundary of the lane. */
  fromZd: number;
  /** Zd of the -Zd boundary of the lane. */
  toZd: number;
  centreZd: number;
  widthM: number;
}

export interface DeckLayout {
  spanM: number;
  totalWidthM: number;
  leftDeckEdgeZd: number;
  rightDeckEdgeZd: number;
  leftBarrierInnerZd: number;
  rightBarrierInnerZd: number;
  leftCarriagewayEdgeZd: number;
  rightCarriagewayEdgeZd: number;
  carriagewayWidthM: number;
  laneWidthsM: number[];
  lanes: Lane[];
  /** n + 1 transverse boundaries from +Zd to -Zd. */
  laneBoundaries: number[];
}

function positive(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function deckLayout(deck: DeckGeometry): DeckLayout {
  const half = deck.totalWidthM / 2;
  const leftDeckEdgeZd = half;
  const rightDeckEdgeZd = -half;
  const leftBarrierInnerZd = half - positive(deck.leftBarrierWidthM);
  const rightBarrierInnerZd = -half + positive(deck.rightBarrierWidthM);
  const leftCarriagewayEdgeZd =
    leftBarrierInnerZd - positive(deck.leftFootpathWidthM) - positive(deck.leftKerbWidthM);
  const rightCarriagewayEdgeZd =
    rightBarrierInnerZd + positive(deck.rightFootpathWidthM) + positive(deck.rightKerbWidthM);
  const span = leftCarriagewayEdgeZd - rightCarriagewayEdgeZd;
  const laneCount = Math.max(1, Math.round(deck.laneCount));

  let laneWidthsM: number[];
  const custom = deck.laneWidthsM;
  const customValid =
    deck.laneWidthMode === "custom" &&
    custom.length === laneCount &&
    custom.every((w) => Number.isFinite(w) && w > 0);
  if (customValid) {
    laneWidthsM = custom.map((w) => w);
  } else {
    laneWidthsM = Array.from({ length: laneCount }, () => (span > 0 ? span / laneCount : 0));
  }

  const lanes: Lane[] = [];
  const boundaries: number[] = [leftCarriagewayEdgeZd];
  let cursor = leftCarriagewayEdgeZd;
  for (let i = 0; i < laneCount; i += 1) {
    const width = laneWidthsM[i] ?? 0;
    const next = cursor - width;
    lanes.push({ index: i, fromZd: cursor, toZd: next, centreZd: cursor - width / 2, widthM: width });
    boundaries.push(next);
    cursor = next;
  }

  return {
    spanM: deck.spanM,
    totalWidthM: deck.totalWidthM,
    leftDeckEdgeZd,
    rightDeckEdgeZd,
    leftBarrierInnerZd,
    rightBarrierInnerZd,
    leftCarriagewayEdgeZd,
    rightCarriagewayEdgeZd,
    carriagewayWidthM: span,
    laneWidthsM,
    lanes,
    laneBoundaries: boundaries,
  };
}

export function edgeBoundaryZd(layout: DeckLayout, side: "left" | "right", datum: EdgeDatum): number {
  const left = side === "left";
  if (datum === "deck-edge") return left ? layout.leftDeckEdgeZd : layout.rightDeckEdgeZd;
  if (datum === "barrier") return left ? layout.leftBarrierInnerZd : layout.rightBarrierInnerZd;
  return left ? layout.leftCarriagewayEdgeZd : layout.rightCarriagewayEdgeZd;
}

export function laneCentreZd(layout: DeckLayout, laneIndex: number): number {
  const lane = layout.lanes[clamp(Math.round(laneIndex), 0, layout.lanes.length - 1)];
  return lane.centreZd;
}

export interface Point2 {
  xd: number;
  zd: number;
}

export interface LocalLoadPoint {
  id: string;
  axleId: string;
  axleLabel: string;
  side: 1 | -1 | 0;
  /** Longitudinal offset from the vehicle datum, metres. */
  u: number;
  /** Transverse offset from the vehicle centreline, metres (+ towards vehicle left). */
  v: number;
  loadKN: number;
  lengthM: number;
  widthM: number;
}

export interface VehicleExtents {
  uMin: number;
  uMax: number;
  vMin: number;
  vMax: number;
}

/**
 * Vehicle-local geometry.
 * u = 0 at the vehicle datum (front axle line for wheeled presets, front of track
 * for tracked presets), increasing towards the rear.
 * v = 0 at the vehicle centreline; +v is the vehicle's left-hand wheel line.
 */
export function vehicleExtents(vehicle: VehicleDefinition): VehicleExtents {
  const halfWidth = positive(vehicle.widthM) / 2;
  if (vehicle.vehicleType === "tracked" && vehicle.tracks.length > 0) {
    const uMin = Math.min(...vehicle.tracks.map((t) => Math.min(t.longitudinalStartM, t.longitudinalEndM)));
    const uMax = Math.max(...vehicle.tracks.map((t) => Math.max(t.longitudinalStartM, t.longitudinalEndM)));
    return { uMin, uMax, vMin: -halfWidth, vMax: halfWidth };
  }
  const offsets = vehicle.axles.map((a) => a.longitudinalOffsetM);
  const uMin = offsets.length ? Math.min(...offsets) : 0;
  const uMax = offsets.length ? Math.max(...offsets) : 0;
  return { uMin, uMax, vMin: -halfWidth, vMax: halfWidth };
}

export function vehicleTotalLoadKN(vehicle: VehicleDefinition): number {
  if (vehicle.vehicleType === "tracked") return sum(vehicle.tracks.map((t) => t.loadKN));
  return sum(vehicle.axles.map((a) => a.loadKN));
}

export function axleTrainLengthM(vehicle: VehicleDefinition): number {
  if (vehicle.vehicleType === "tracked" && vehicle.tracks.length > 0) {
    return Math.max(...vehicle.tracks.map((t) => Math.abs(t.longitudinalEndM - t.longitudinalStartM)));
  }
  const offsets = vehicle.axles.map((a) => a.longitudinalOffsetM);
  return offsets.length ? Math.max(...offsets) - Math.min(...offsets) : 0;
}

export function referenceOffset(vehicle: VehicleDefinition, reference: VehicleReference): Point2 {
  const ext = vehicleExtents(vehicle);
  switch (reference) {
    case "vehicle-centre":
      return { xd: (ext.uMin + ext.uMax) / 2, zd: 0 };
    case "vehicle-front":
      return { xd: ext.uMin, zd: 0 };
    case "reference-axle": {
      const first = [...vehicle.axles].sort((a, b) => a.longitudinalOffsetM - b.longitudinalOffsetM)[0];
      return { xd: first ? first.longitudinalOffsetM : ext.uMin, zd: 0 };
    }
    case "outer-wheel-plus":
      return { xd: (ext.uMin + ext.uMax) / 2, zd: ext.vMax };
    case "outer-wheel-minus":
      return { xd: (ext.uMin + ext.uMax) / 2, zd: ext.vMin };
    default:
      return { xd: 0, zd: 0 };
  }
}

export const REFERENCE_LABELS: Record<VehicleReference, string> = {
  "vehicle-centre": "Vehicle centre",
  "vehicle-front": "Vehicle datum / front",
  "reference-axle": "Reference axle (front axle)",
  "outer-wheel-plus": "Outer edge, +Zd wheel line",
  "outer-wheel-minus": "Outer edge, -Zd wheel line",
};

/**
 * Expand a vehicle definition into discrete load application points.
 * Track loads are discretised into `trackSlices` longitudinal slices so that a
 * uniformly distributed track can be transferred to nodes or elements.
 */
export function vehicleLocalLoads(vehicle: VehicleDefinition, trackSlices = 8): LocalLoadPoint[] {
  const points: LocalLoadPoint[] = [];
  if (vehicle.vehicleType === "tracked" && vehicle.tracks.length > 0) {
    const slices = Math.max(1, Math.round(trackSlices));
    for (const track of vehicle.tracks) {
      const start = Math.min(track.longitudinalStartM, track.longitudinalEndM);
      const end = Math.max(track.longitudinalStartM, track.longitudinalEndM);
      const length = end - start;
      const sliceLength = length / slices;
      for (let i = 0; i < slices; i += 1) {
        points.push({
          id: `${track.id}-s${i}`,
          axleId: track.id,
          axleLabel: `${track.label} S${i + 1}`,
          side: track.transverseCentreM >= 0 ? 1 : -1,
          u: start + sliceLength * (i + 0.5),
          v: track.transverseCentreM,
          loadKN: track.loadKN / slices,
          lengthM: sliceLength,
          widthM: track.widthM,
        });
      }
    }
    return points;
  }

  for (const axle of vehicle.axles) {
    const wheelLoads = axle.wheelLoadsKN.length ? axle.wheelLoadsKN : [axle.loadKN];
    const lineCount = Math.max(1, wheelLoads.length);
    const spacing = axle.trackSpacingM;
    wheelLoads.forEach((load, index) => {
      const side: 1 | -1 = lineCount === 1 ? 1 : index === 0 ? 1 : -1;
      const v = lineCount === 1 ? 0 : side * (spacing / 2);
      points.push({
        id: `${axle.id}-w${index}`,
        axleId: axle.id,
        axleLabel: axle.label,
        side: lineCount === 1 ? 0 : side,
        u: axle.longitudinalOffsetM,
        v,
        loadKN: load,
        lengthM: axle.wheelLengthM,
        widthM: axle.wheelWidthM,
      });
    });
  }
  return points;
}

export interface PlacementResolved {
  longitudinalM: number;
  transverseM: number;
  rotationDeg: number;
  reference: Point2;
  /** Derived value when placement.mode is "edge". */
  clearanceM: number | null;
  laneIndex: number | null;
}

export function rotationRad(placement: Pick<VehiclePlacement, "rotationDeg">): number {
  return ((placement.rotationDeg ?? 0) * Math.PI) / 180;
}

/** Transform a vehicle-local point into deck coordinates. */
export function localToDeck(
  local: Point2,
  reference: Point2,
  placement: Pick<VehiclePlacement, "longitudinalM" | "transverseM" | "rotationDeg">,
): Point2 {
  const theta = rotationRad(placement);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const du = local.xd - reference.xd;
  const dv = local.zd - reference.zd;
  return {
    xd: placement.longitudinalM + du * cos - dv * sin,
    zd: placement.transverseM + du * sin + dv * cos,
  };
}

/** Inverse of localToDeck for a deck point. */
export function deckToLocal(
  deckPoint: Point2,
  reference: Point2,
  placement: Pick<VehiclePlacement, "longitudinalM" | "transverseM" | "rotationDeg">,
): Point2 {
  const theta = rotationRad(placement);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const dx = deckPoint.xd - placement.longitudinalM;
  const dz = deckPoint.zd - placement.transverseM;
  return {
    xd: reference.xd + dx * cos + dz * sin,
    zd: reference.zd - dx * sin + dz * cos,
  };
}

/** Relative transverse extent of the vehicle geometry around the reference point. */
export function relativeExtents(
  vehicle: VehicleDefinition,
  placement: VehiclePlacement,
  trackSlices = 8,
): { relZdMin: number; relZdMax: number; relXdMin: number; relXdMax: number } {
  const ref = referenceOffset(vehicle, placement.referencePoint);
  const theta = rotationRad(placement);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const loads = vehicleLocalLoads(vehicle, trackSlices);
  let relZdMin = Number.POSITIVE_INFINITY;
  let relZdMax = Number.NEGATIVE_INFINITY;
  let relXdMin = Number.POSITIVE_INFINITY;
  let relXdMax = Number.NEGATIVE_INFINITY;

  for (const load of loads) {
    const halfL = load.lengthM / 2;
    const halfW = load.widthM / 2;
    for (const du of [load.u - halfL, load.u + halfL]) {
      for (const dv of [load.v - halfW, load.v + halfW]) {
        const relZd = (du - ref.xd) * sin + (dv - ref.zd) * cos;
        const relXd = (du - ref.xd) * cos - (dv - ref.zd) * sin;
        relZdMin = Math.min(relZdMin, relZd);
        relZdMax = Math.max(relZdMax, relZd);
        relXdMin = Math.min(relXdMin, relXd);
        relXdMax = Math.max(relXdMax, relXd);
      }
    }
  }
  if (!Number.isFinite(relZdMin)) return { relZdMin: 0, relZdMax: 0, relXdMin: 0, relXdMax: 0 };
  return { relZdMin, relZdMax, relXdMin, relXdMax };
}

/**
 * Resolve the effective deck position of a placement, including constraints.
 * Edge and lane modes store the constraint, not a stale coordinate.
 */
export function resolvePlacement(
  vehicle: VehicleDefinition | undefined,
  placement: VehiclePlacement,
  layout: DeckLayout,
  trackSlices = 8,
): PlacementResolved {
  const base: PlacementResolved = {
    longitudinalM: placement.longitudinalM,
    transverseM: placement.transverseM,
    rotationDeg: placement.rotationDeg,
    reference: { xd: 0, zd: 0 },
    clearanceM: null,
    laneIndex: placement.lane?.laneIndex ?? null,
  };
  if (!vehicle) return base;
  const ref = referenceOffset(vehicle, placement.referencePoint);
  base.reference = ref;

  if (placement.mode === "edge" && placement.edge) {
    const ext = relativeExtents(vehicle, placement, trackSlices);
    const boundary = edgeBoundaryZd(layout, placement.edge.side, placement.edge.datum);
    const transverseM =
      placement.edge.side === "left"
        ? boundary - placement.edge.clearanceM - ext.relZdMax
        : boundary + placement.edge.clearanceM - ext.relZdMin;
    return { ...base, transverseM, clearanceM: placement.edge.clearanceM };
  }

  if ((placement.mode === "lane" || placement.mode === "centreline") && vehicle) {
    const ext = vehicleExtents(vehicle);
    const centreU = (ext.uMin + ext.uMax) / 2;
    const theta = rotationRad(placement);
    const relZdCentre = (centreU - ref.xd) * Math.sin(theta) + (0 - ref.zd) * Math.cos(theta);
    let centreZd: number;
    if (placement.mode === "lane" && placement.lane) {
      centreZd = laneCentreZd(layout, placement.lane.laneIndex);
    } else {
      centreZd = 0;
    }
    return { ...base, transverseM: centreZd - relZdCentre, laneIndex: placement.lane?.laneIndex ?? null };
  }

  return base;
}

/** Convert rotation + envelope of a placement into a wheel-level footprint. */
export function vehicleFootprint(
  vehicle: VehicleDefinition,
  placement: VehiclePlacement,
  layout: DeckLayout,
  trackSlices = 8,
): VehicleFootprint {
  const resolved = resolvePlacement(vehicle, placement, layout, trackSlices);
  const ref = resolved.reference;
  const effective = {
    longitudinalM: resolved.longitudinalM,
    transverseM: resolved.transverseM,
    rotationDeg: resolved.rotationDeg,
  };
  const loads = vehicleLocalLoads(vehicle, trackSlices);

  const wheels: WheelLoad[] = loads.map((load) => {
    const centre = localToDeck({ xd: load.u, zd: load.v }, ref, effective);
    const corners = [
      { xd: load.u - load.lengthM / 2, zd: load.v - load.widthM / 2 },
      { xd: load.u + load.lengthM / 2, zd: load.v - load.widthM / 2 },
      { xd: load.u + load.lengthM / 2, zd: load.v + load.widthM / 2 },
      { xd: load.u - load.lengthM / 2, zd: load.v + load.widthM / 2 },
    ].map((p) => localToDeck(p, ref, effective));
    return {
      id: load.id,
      axleId: load.axleId,
      axleLabel: load.axleLabel,
      side: load.side,
      localU: load.u,
      localV: load.v,
      xd: centre.xd,
      zd: centre.zd,
      loadKN: load.loadKN,
      footprintLengthM: load.lengthM,
      footprintWidthM: load.widthM,
      rotationDeg: resolved.rotationDeg,
      corners,
    };
  });

  const tracks = vehicle.tracks.map((track) => {
    const uStart = Math.min(track.longitudinalStartM, track.longitudinalEndM);
    const corners = [
      { xd: uStart, zd: track.transverseCentreM - track.widthM / 2 },
      { xd: uStart + Math.abs(track.longitudinalEndM - track.longitudinalStartM), zd: track.transverseCentreM - track.widthM / 2 },
      { xd: uStart + Math.abs(track.longitudinalEndM - track.longitudinalStartM), zd: track.transverseCentreM + track.widthM / 2 },
      { xd: uStart, zd: track.transverseCentreM + track.widthM / 2 },
    ].map((p) => localToDeck(p, ref, effective));
    return { trackId: track.id, label: track.label, loadKN: track.loadKN, corners };
  });

  const ext = vehicleExtents(vehicle);
  const bodyCorners = [
    { xd: ext.uMin, zd: -vehicle.widthM / 2 },
    { xd: ext.uMax, zd: -vehicle.widthM / 2 },
    { xd: ext.uMax, zd: vehicle.widthM / 2 },
    { xd: ext.uMin, zd: vehicle.widthM / 2 },
  ].map((p) => localToDeck(p, ref, effective));

  const allPoints: Point2[] = [
    ...wheels.flatMap((w) => w.corners),
    ...tracks.flatMap((t) => t.corners),
    ...bodyCorners,
  ];
  const xs = allPoints.map((p) => p.xd);
  const zs = allPoints.map((p) => p.zd);

  return {
    vehicleId: vehicle.id,
    placementId: placement.id,
    wheels,
    tracks,
    bodyCorners,
    bounds: {
      minXd: Math.min(...xs),
      maxXd: Math.max(...xs),
      minZd: Math.min(...zs),
      maxZd: Math.max(...zs),
    },
    reference: localToDeck(ref, ref, effective),
  };
}

export function computeClearance(
  footprint: VehicleFootprint,
  layout: DeckLayout,
  vehicle?: VehicleDefinition,
): ClearanceReport {
  const { minZd, maxZd, minXd, maxXd } = footprint.bounds;
  const tolerance = 1e-6;
  const toLeftBarrierM = layout.leftBarrierInnerZd - maxZd;
  const toRightBarrierM = minZd - layout.rightBarrierInnerZd;
  const insideDeck = minZd >= layout.rightDeckEdgeZd - tolerance && maxZd <= layout.leftDeckEdgeZd + tolerance;
  const insideCarriageway =
    minZd >= layout.rightCarriagewayEdgeZd - tolerance && maxZd <= layout.leftCarriagewayEdgeZd + tolerance;
  const interferesWithBarrier = !insideDeck || toLeftBarrierM < -tolerance || toRightBarrierM < -tolerance;
  void vehicle;
  return {
    toLeftBarrierM,
    toRightBarrierM,
    toLeftDeckEdgeM: layout.leftDeckEdgeZd - maxZd,
    toRightDeckEdgeM: minZd - layout.rightDeckEdgeZd,
    beyondStartM: minXd,
    beyondEndM: layout.spanM - maxXd,
    insideCarriageway,
    insideDeck,
    interferesWithBarrier,
  };
}

/** Snap candidates in deck coordinates, used while dragging. */
export interface SnapCandidate {
  kind: "lane-boundary" | "lane-centre" | "carriageway-edge" | "deck-edge" | "span-end" | "grid" | "centreline";
  xd: number | null;
  zd: number | null;
  label: string;
}

export function snapCandidates(layout: DeckLayout, stepM: number): SnapCandidate[] {
  const list: SnapCandidate[] = [];
  layout.laneBoundaries.forEach((zd, index) => {
    const edge = index === 0 || index === layout.laneBoundaries.length - 1;
    list.push({
      kind: edge ? "carriageway-edge" : "lane-boundary",
      xd: null,
      zd,
      label: edge
        ? index === 0
          ? "Carriageway edge (+Zd)"
          : "Carriageway edge (-Zd)"
        : `Lane boundary L${index}`,
    });
  });
  list.push({ kind: "centreline", xd: null, zd: 0, label: "Deck centreline" });
  layout.lanes.forEach((lane) => {
    list.push({ kind: "lane-centre", xd: null, zd: lane.centreZd, label: `Lane ${lane.index + 1} centre` });
  });
  list.push({ kind: "deck-edge", xd: null, zd: layout.leftDeckEdgeZd, label: "Left deck edge" });
  list.push({ kind: "deck-edge", xd: null, zd: layout.rightDeckEdgeZd, label: "Right deck edge" });
  list.push({ kind: "span-end", xd: 0, zd: null, label: "Start abutment" });
  list.push({ kind: "span-end", xd: layout.spanM, zd: null, label: "End abutment" });
  if (stepM > 0) {
    for (let x = 0; x <= layout.spanM + 1e-9; x += stepM) {
      list.push({ kind: "grid", xd: round(x, 6), zd: null, label: `Grid X ${round(x, 3)}` });
    }
  }
  return list;
}

export function nearestSnap(
  candidates: SnapCandidate[],
  point: Point2,
  toleranceM: number,
  axis: "both" | "longitudinal" | "transverse" = "both",
): { xd: number | null; zd: number | null; label: string } | null {
  let best: { distance: number; xd: number | null; zd: number | null; label: string } | null = null;
  for (const candidate of candidates) {
    const dx = candidate.xd === null ? 0 : point.xd - candidate.xd;
    const dz = candidate.zd === null ? 0 : point.zd - candidate.zd;
    if (axis === "longitudinal" && candidate.xd === null) continue;
    if (axis === "transverse" && candidate.zd === null) continue;
    if (axis === "both" && (candidate.xd === null || candidate.zd === null)) continue;
    const distance = Math.hypot(dx, dz);
    if (distance > toleranceM) continue;
    if (!best || distance < best.distance) {
      best = { distance, xd: candidate.xd, zd: candidate.zd, label: candidate.label };
    }
  }
  return best;
}
