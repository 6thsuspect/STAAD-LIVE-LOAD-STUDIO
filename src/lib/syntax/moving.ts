import type {
  CoordMapping,
  Diagnostic,
  MovingLoadRepresentation,
  MovingLoadSettings,
  VehicleDefinition,
  VehiclePlacement,
} from "../../types";
import { deckToGlobal, describeMapping, mappingIssues } from "../coords";
import {
  localToDeck,
  referenceOffset,
  resolvePlacement,
  vehicleTotalLoadKN,
  type DeckLayout,
} from "../geometry";
import { fmt, round, sum } from "../units";
import { getAdapter } from "./adapters";
import type { StaadVersion } from "../../types";

/**
 * Moving-load workflow
 * ====================
 * A moving-load definition is a *definition*, not a placement. It contains loads
 * along one longitudinal line and the spacings between them. A LOAD GENERATION
 * command then sweeps that definition through a series of reference positions.
 *
 * Two representations are supported for wheeled vehicles:
 *   • "axle-load-width": axle totals along one line, with WIDTH = vehicle width.
 *     This is the single-lane load-line idealisation used for global analysis.
 *   • "explicit-wheel-lines": one definition per wheel line carrying half-axle
 *     loads, so the transverse position of each wheel line is explicit.
 * Tracked vehicles are always emitted as explicit track lines because a single
 * WIDTH would smear the track loads across the full 2.90 m gauge.
 */

export interface MovingDefinitionPlan {
  typeNumber: number;
  loadsKN: number[];
  distancesM: number[];
  widthM?: number;
  representation: MovingLoadRepresentation;
  firstLoadLocal: { u: number; v: number };
  vehicleId: string;
  vehicleName: string;
  vehicleShortName: string;
  placementId: string;
  placementLabel: string;
  lineLabel: string;
  totalKN: number;
}

export interface MovingDefinitionResult {
  definitions: MovingDefinitionPlan[];
  diagnostics: Diagnostic[];
}

function impactFactor(moving: MovingLoadSettings): number {
  return moving.impactEnabled ? 1 + Math.max(0, moving.impactFactor) : 1;
}

function spacingsFrom(offsets: number[]): number[] {
  return offsets.slice(1).map((offset, index) => round(offset - offsets[index], 6));
}

export function planMovingDefinitions(
  vehicle: VehicleDefinition,
  placement: VehiclePlacement,
  moving: MovingLoadSettings,
): MovingDefinitionResult {
  const diagnostics: Diagnostic[] = [];
  const factor = impactFactor(moving);
  const base = {
    vehicleId: vehicle.id,
    vehicleName: vehicle.name,
    vehicleShortName: vehicle.shortName,
    placementId: placement.id,
    placementLabel: placement.label,
    totalKN: vehicleTotalLoadKN(vehicle) * factor,
  };

  if (vehicle.vehicleType === "tracked") {
    const slices = Math.max(1, Math.round(moving.trackSlices));
    if (moving.representation === "axle-load-width") {
      diagnostics.push({
        id: `mv-${placement.id}-tracked-width`,
        severity: "warning",
        category: "syntax",
        code: "tracked-forced-wheel-lines",
        message:
          "A tracked vehicle cannot be represented as a single width-distributed line. The generator emitted one moving-load definition per track instead.",
        refs: { vehicleId: vehicle.id, placementId: placement.id },
      });
    }
    const definitions: MovingDefinitionPlan[] = vehicle.tracks.map((track, index) => {
      const start = Math.min(track.longitudinalStartM, track.longitudinalEndM);
      const length = Math.abs(track.longitudinalEndM - track.longitudinalStartM);
      const sliceLength = length / slices;
      const loadsKN = Array.from({ length: slices }, () => round((track.loadKN * factor) / slices, 3));
      const distancesM = Array.from({ length: Math.max(0, slices - 1) }, () => round(sliceLength, 5));
      if (slices === 1) {
        diagnostics.push({
          id: `mv-${placement.id}-${track.id}-single`,
          severity: "warning",
          category: "syntax",
          code: "track-single-slice",
          message: `${track.label}: a track discretised into a single load cannot carry a DISTANCE list. Increase the number of track slices.`,
          refs: { vehicleId: vehicle.id, placementId: placement.id },
        });
      }
      const sumSlices = sum(loadsKN);
      diagnostics.push({
        id: `mv-${placement.id}-${track.id}-sum`,
        severity: Math.abs(sumSlices - track.loadKN * factor) > 0.01 ? "error" : "info",
        category: "load",
        code: "track-slice-sum",
        message: `${track.label}: ${slices} slice loads sum to ${fmt(sumSlices)} kN (target ${fmt(track.loadKN * factor)} kN).`,
        refs: { vehicleId: vehicle.id, placementId: placement.id },
      });
      return {
        ...base,
        typeNumber: moving.typeNumber + index,
        loadsKN,
        distancesM,
        widthM: track.widthM,
        representation: "explicit-wheel-lines",
        firstLoadLocal: { u: start + sliceLength / 2, v: track.transverseCentreM },
        lineLabel: track.label,
      };
    });
    return { definitions, diagnostics };
  }

  const axles = [...vehicle.axles].sort((a, b) => a.longitudinalOffsetM - b.longitudinalOffsetM);
  if (axles.length === 0) {
    return {
      definitions: [],
      diagnostics: [
        {
          id: `mv-${placement.id}-no-axles`,
          severity: "error",
          category: "vehicle",
          code: "vehicle-no-axles",
          message: `Vehicle ${vehicle.name} has no axles; a moving-load definition cannot be generated.`,
          refs: { vehicleId: vehicle.id, placementId: placement.id },
        },
      ],
    };
  }
  if (axles.length === 1) {
    diagnostics.push({
      id: `mv-${placement.id}-single-axle`,
      severity: "warning",
      category: "syntax",
      code: "single-axle-no-distance",
      message:
        "A single-axle vehicle produces a DEFINE MOVING LOAD without a DISTANCE list. Confirm this is accepted for the selected version and load representation.",
      refs: { vehicleId: vehicle.id, placementId: placement.id },
    });
  }

  const offsets = axles.map((a) => a.longitudinalOffsetM);
  const axisLoads = axles.map((a) => round(a.loadKN * factor, 3));
  const distancesM = spacingsFrom(offsets).map((d) => round(d, 5));
  const firstOffset = Math.min(...offsets);

  if (moving.representation === "explicit-wheel-lines") {
    const lineWidths = axles.map((a) => a.trackSpacingM);
    const maxSpacing = Math.max(...lineWidths);
    const minSpacing = Math.min(...lineWidths);
    if (Math.abs(maxSpacing - minSpacing) > 1e-6) {
      diagnostics.push({
        id: `mv-${placement.id}-varying-gauge`,
        severity: "warning",
        category: "syntax",
        code: "varying-wheel-gauge",
        message:
          "Axle gauge varies between axles. A single moving-load line is straight, so the transverse offset of the first axle is used for every load in the line.",
        refs: { vehicleId: vehicle.id, placementId: placement.id },
      });
    }
    const gauge = axles[0].trackSpacingM;
    const hasTwoLines = axles.every((a) => a.wheelLoadsKN.length >= 2);
    if (!hasTwoLines) {
      diagnostics.push({
        id: `mv-${placement.id}-wheel-loads`,
        severity: "error",
        category: "load",
        code: "missing-wheel-loads",
        message:
          "At least one axle does not define separate wheel loads, so explicit wheel-line definitions cannot be built.",
        refs: { vehicleId: vehicle.id, placementId: placement.id },
      });
      return { definitions: [], diagnostics };
    }
    const definitions: MovingDefinitionPlan[] = [0, 1].map((lineIndex) => {
      const side = lineIndex === 0 ? 1 : -1;
      const loadsKN = axles.map((a) => round((a.wheelLoadsKN[lineIndex] ?? a.loadKN / 2) * factor, 3));
      return {
        ...base,
        typeNumber: moving.typeNumber + lineIndex,
        loadsKN,
        distancesM,
        widthM: undefined,
        representation: "explicit-wheel-lines",
        firstLoadLocal: { u: firstOffset, v: (side * gauge) / 2 },
        lineLabel: `${side > 0 ? "+Zd" : "−Zd"} wheel line (gauge ${fmt(gauge)} m)`,
      };
    });
    const totalEmitted = sum(definitions.map((d) => sum(d.loadsKN)));
    if (Math.abs(totalEmitted - base.totalKN) > 0.01) {
      diagnostics.push({
        id: `mv-${placement.id}-total-mismatch`,
        severity: "error",
        category: "load",
        code: "moving-total-mismatch",
        message: `Emitted wheel-line loads total ${fmt(totalEmitted)} kN but the vehicle load is ${fmt(base.totalKN)} kN.`,
        refs: { vehicleId: vehicle.id, placementId: placement.id },
      });
    }
    return { definitions, diagnostics };
  }

  const width = moving.representation === "axle-load-width" ? vehicle.widthM : undefined;
  if (moving.representation === "axle-load-width") {
    diagnostics.push({
      id: `mv-${placement.id}-width-idealisation`,
      severity: "info",
      category: "syntax",
      code: "width-idealisation",
      message: `Axle loads are emitted as one longitudinal line of ${fmt(vehicle.widthM)} m width (WIDTH). This is the single-lane load-line idealisation — transverse wheel positions are not individually represented. Use explicit wheel lines or the static workflow when they matter.`,
      refs: { vehicleId: vehicle.id, placementId: placement.id },
    });
  }
  return {
    definitions: [
      {
        ...base,
        typeNumber: moving.typeNumber,
        loadsKN: axisLoads,
        distancesM,
        widthM: width,
        representation: moving.representation,
        firstLoadLocal: { u: firstOffset, v: 0 },
        lineLabel: "vehicle centreline",
      },
    ],
    diagnostics,
  };
}

export interface MovingGenerationPlan {
  positionCount: number;
  typeNumber: number;
  incrementAxis: "X" | "Y" | "Z";
  increment: number;
  startGlobal: { x: number; y: number; z: number };
  definition: MovingDefinitionPlan;
}

export function planGeneration(
  definition: MovingDefinitionPlan,
  vehicle: VehicleDefinition,
  placement: VehiclePlacement,
  moving: MovingLoadSettings,
  mapping: CoordMapping,
  layout: DeckLayout,
): { plan: MovingGenerationPlan | null; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const resolved = resolvePlacement(vehicle, placement, layout, moving.trackSlices);
  const ref = referenceOffset(vehicle, placement.referencePoint);
  const deckPoint = localToDeck(
    { xd: definition.firstLoadLocal.u, zd: definition.firstLoadLocal.v },
    ref,
    {
    longitudinalM: resolved.longitudinalM,
    transverseM: resolved.transverseM,
    rotationDeg: resolved.rotationDeg,
  });
  const startGlobal = deckToGlobal({ xd: deckPoint.xd, zd: deckPoint.zd, yd: 0 }, mapping);

  const issues = mappingIssues(mapping);
  const rotationIssue = Math.abs(((mapping.rotationDeg % 360) + 360) % 360);
  if (rotationIssue > 1e-9 && rotationIssue < 360 - 1e-9) {
    diagnostics.push({
      id: `gen-${placement.id}-rotation`,
      severity: "error",
      category: "syntax",
      code: "generation-rotation",
      message:
        "LOAD GENERATION sweeps along a single global axis. The deck mapping is rotated, so the sweep direction cannot be expressed with XINC/ZINC alone. Set the mapping rotation to 0° or use the static workflow.",
      refs: { placementId: placement.id },
    });
    return { plan: null, diagnostics };
  }
  if (issues.some((i) => i.includes("vertical axis"))) {
    diagnostics.push({
      id: `gen-${placement.id}-axis`,
      severity: "error",
      category: "syntax",
      code: "generation-axis",
      message: issues.join(" "),
      refs: { placementId: placement.id },
    });
    return { plan: null, diagnostics };
  }

  if (moving.positionCount < 1) {
    diagnostics.push({
      id: `gen-${placement.id}-count`,
      severity: "error",
      category: "syntax",
      code: "generation-count",
      message: "The number of generated positions must be at least 1.",
      refs: { placementId: placement.id },
    });
    return { plan: null, diagnostics };
  }
  if (moving.incrementM <= 0) {
    diagnostics.push({
      id: `gen-${placement.id}-increment`,
      severity: "error",
      category: "syntax",
      code: "generation-increment",
      message: "The movement increment must be greater than zero.",
      refs: { placementId: placement.id },
    });
    return { plan: null, diagnostics };
  }

  const increment = moving.direction * moving.incrementM * mapping.longitudinalSign;
  const plan: MovingGenerationPlan = {
    positionCount: Math.round(moving.positionCount),
    typeNumber: definition.typeNumber,
    incrementAxis: mapping.longitudinalAxis,
    increment: round(increment, 6),
    startGlobal: {
      x: round(startGlobal.x, 4),
      y: round(startGlobal.y, 4),
      z: round(startGlobal.z, 4),
    },
    definition,
  };

  const lastPosition = moving.startLongitudinalM + moving.direction * moving.incrementM * (plan.positionCount - 1);
  diagnostics.push({
    id: `gen-${placement.id}-span`,
    severity: "info",
    category: "syntax",
    code: "generation-envelope",
    message: `Sweep covers deck stations ${fmt(Math.min(moving.startLongitudinalM, lastPosition))} m to ${fmt(
      Math.max(moving.startLongitudinalM, lastPosition),
    )} m along Xd (${plan.positionCount} positions at ${fmt(moving.incrementM)} m). The first load of the definition is placed at the start coordinates.`,
    refs: { placementId: placement.id },
  });

  return { plan, diagnostics };
}

export function formatMovingDefinition(definition: MovingDefinitionPlan): string {
  const loads = definition.loadsKN.map((v) => fmt(v, 3)).join(" ");
  const distances = definition.distancesM.map((v) => fmt(v, 5)).join(" ");
  const width = definition.widthM !== undefined ? ` WIDTH ${fmt(definition.widthM, 3)}` : "";
  return `TYPE ${definition.typeNumber} LOAD ${loads}${distances ? ` DISTANCE ${distances}` : ""}${width}`;
}

export function formatGeneration(plan: MovingGenerationPlan): string {
  const { startGlobal } = plan;
  const incrementKey = `${plan.incrementAxis}INC`;
  return `TYPE ${plan.typeNumber} ${fmt(startGlobal.x, 4)} ${fmt(startGlobal.y, 4)} ${fmt(startGlobal.z, 4)} ${incrementKey} ${fmt(
    plan.increment,
    4,
  )}`;
}

export interface GeneratedMovingBlock {
  placementId: string;
  vehicleId: string;
  lines: string[];
  definitions: MovingDefinitionPlan[];
  generations: MovingGenerationPlan[];
  diagnostics: Diagnostic[];
}

export function generateMovingBlocks(args: {
  vehicles: VehicleDefinition[];
  placements: VehiclePlacement[];
  moving: MovingLoadSettings;
  mapping: CoordMapping;
  layout: DeckLayout;
  version: StaadVersion;
  emitComments: boolean;
  titleLimit: number;
}): { blocks: GeneratedMovingBlock[]; diagnostics: Diagnostic[] } {
  const { vehicles, placements, moving, mapping, layout, emitComments, titleLimit, version } = args;
  const blocks: GeneratedMovingBlock[] = [];
  const diagnostics: Diagnostic[] = [];
  const adapter = getAdapter(version);

  placements.forEach((placement, placementIndex) => {
    const vehicle = vehicles.find((v) => v.id === placement.vehicleId);
    if (!vehicle) {
      diagnostics.push({
        id: `mv-${placement.id}-missing-vehicle`,
        severity: "error",
        category: "vehicle",
        code: "placement-missing-vehicle",
        message: `Placement ${placement.label} references a vehicle that no longer exists.`,
        refs: { placementId: placement.id },
      });
      return;
    }
    const planned = planMovingDefinitions(vehicle, placement, {
      ...moving,
      typeNumber: moving.typeNumber + placementIndex * Math.max(1, vehicle.tracks.length || 2),
    });
    diagnostics.push(...planned.diagnostics);

    const lines: string[] = [];
    const generations: MovingGenerationPlan[] = [];
    if (emitComments) {
      lines.push(
        `* ${placement.label} | ${vehicle.classification} | ${fmt(vehicleTotalLoadKN(vehicle), 0)} kN | ${vehicle.sourceReference}`,
      );
      if (moving.impactEnabled) {
        lines.push(
          `* Impact/dynamic multiplier ${fmt(1 + moving.impactFactor, 4)} applied to the library loads by user setting. ${
            moving.impactNote || "No note recorded."
          }`,
        );
      }
    }

    for (const definition of planned.definitions) {
      if (emitComments) {
        lines.push(
          `* Definition ${definition.typeNumber} — ${definition.lineLabel}; datum ${vehicle.datumDescription}.`,
        );
        lines.push(`* ${definition.loadsKN.length} loads, ${definition.distancesM.length} inter-load distances.`);
      }
      lines.push("DEFINE MOVING LOAD");
      lines.push(formatMovingDefinition(definition));

      const generated = planGeneration(definition, vehicle, placement, moving, mapping, layout);
      diagnostics.push(...generated.diagnostics);
      if (!generated.plan) continue;
      generations.push(generated.plan);
      if (moving.emitLoadCaseAnchor) {
        const caseNumber = moving.anchorLoadCaseNumber + placementIndex;
        const title = `${moving.anchorTitle} ${placement.label}`.slice(0, titleLimit);
        lines.push(`LOAD ${caseNumber} LOADTYPE LIVE TITLE ${title}`);
      }
      if (emitComments) {
        lines.push(
          `* ${generated.plan.positionCount} positions, ${fmt(moving.incrementM)} m increments, ${
            moving.direction > 0 ? "+Xd" : "−Xd"
          }, reference = first load of definition ${definition.typeNumber}.`,
        );
      }
      lines.push(`LOAD GENERATION ${generated.plan.positionCount}`);
      lines.push(formatGeneration(generated.plan));
    }

    if (planned.definitions.length) {
      blocks.push({
        placementId: placement.id,
        vehicleId: vehicle.id,
        lines,
        definitions: planned.definitions,
        generations,
        diagnostics: planned.diagnostics,
      });
    }
  });

  if (!placements.length) {
    diagnostics.push({
      id: "mv-no-placements",
      severity: "warning",
      category: "syntax",
      code: "no-placements",
      message: "No vehicle is placed on the deck, so no moving-load definition can be generated.",
    });
  }

  // Type-number uniqueness is a hard STAAD requirement.
  const typeNumbers = blocks.flatMap((b) => b.definitions.map((d) => d.typeNumber));
  const duplicates = typeNumbers.filter((n, i) => typeNumbers.indexOf(n) !== i);
  if (duplicates.length) {
    diagnostics.push({
      id: "mv-duplicate-types",
      severity: "error",
      category: "syntax",
      code: "duplicate-type-number",
      message: `Moving-load TYPE numbers must be unique. Duplicated: ${[...new Set(duplicates)].join(", ")}. Increase the base type number or reduce the number of generated lines.`,
    });
  }

  if (emitComments) {
    const header = `* Moving-load grammar: ${adapter.movingLoadDefinition.note}; ${adapter.loadGeneration.note}`;
    blocks.unshift({
      placementId: "",
      vehicleId: "",
      lines: [header, `* Mapping: ${describeMapping(mapping)}`],
      definitions: [],
      generations: [],
      diagnostics: [],
    });
  }

  return { blocks, diagnostics };
}
