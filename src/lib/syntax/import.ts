import type {
  AxleDefinition,
  Diagnostic,
  MovingLoadDefinition,
  MovingLoadSettings,
  ParsedDocument,
  StructuralModel,
  VehicleDefinition,
  VehiclePlacement,
} from "../../types";
import { globalToDeck } from "../coords";
import { colorForIndex, nextVehicleLabel } from "../ids";
import type { ProjectData } from "../project";
import { fmt, round } from "../units";
import { vehicleLocalLoads } from "../geometry";
import type { ModelFragment } from "./model";

/**
 * Scene reconstruction from parsed syntax.
 *
 * Reconstruction only uses information present in the source:
 *  • a DEFINE MOVING LOAD supplies load magnitudes, spacings and optionally width;
 *  • a LOAD GENERATION supplies the sweep start coordinates and increment, which
 *    is the only placement information in a moving-load file;
 *  • JOINT COORDINATES supplies the structural model.
 * Where transverse gauge, wheel loads or a vehicle identity are absent, the
 * reconstructed definition records that they are unknown. Nothing is invented.
 */

export interface Reconstruction {
  vehicles: VehicleDefinition[];
  placements: VehiclePlacement[];
  moving: MovingLoadSettings;
  model: StructuralModel | null;
  summary: string[];
  diagnostics: Diagnostic[];
  /** True when some source content could not be applied to the scene. */
  partial: boolean;
}

function matchesDefinition(vehicle: VehicleDefinition, definition: MovingLoadDefinition): boolean {
  if (vehicle.vehicleType === "tracked") return false;
  const axles = [...vehicle.axles].sort((a, b) => a.longitudinalOffsetM - b.longitudinalOffsetM);
  if (axles.length !== definition.loadsKN.length) return false;
  const spacings = axles.slice(1).map((a, i) => round(a.longitudinalOffsetM - axles[i].longitudinalOffsetM, 3));
  if (spacings.length !== definition.distancesM.length) return false;
  const tolerance = 0.005;
  const loadsMatch = axles.every((a, i) => Math.abs(a.loadKN - definition.loadsKN[i]) <= tolerance);
  const spacingMatch = spacings.every((s, i) => Math.abs(s - definition.distancesM[i]) <= tolerance);
  if (!loadsMatch || !spacingMatch) return false;
  if (definition.widthM !== undefined && Math.abs(vehicle.widthM - definition.widthM) > 0.02) return false;
  return true;
}

/**
 * Build a vehicle definition from a moving-load definition. Transverse geometry is
 * NOT known from the source: wheel gauge is set to zero and flagged.
 */
function vehicleFromDefinition(
  definition: MovingLoadDefinition,
  existingIds: Set<string>,
): VehicleDefinition {
  let offset = 0;
  const axles: AxleDefinition[] = definition.loadsKN.map((load, index) => {
    if (index > 0) offset += definition.distancesM[index - 1] ?? 0;
    return {
      id: `imported-axle-${definition.typeNumber}-${index + 1}`,
      label: `A${index + 1}`,
      loadKN: load,
      longitudinalOffsetM: offset,
      wheelLoadsKN: [],
      trackSpacingM: 0,
      wheelWidthM: 0,
      wheelLengthM: 0,
    };
  });
  const id = `imported-type-${definition.typeNumber}${existingIds.has(`imported-type-${definition.typeNumber}`) ? `-${Math.random().toString(36).slice(2, 6)}` : ""}`;
  existingIds.add(id);
  return {
    id,
    name: `Imported TYPE ${definition.typeNumber}`,
    shortName: `TYPE ${definition.typeNumber}`,
    classification: "Imported moving-load definition",
    vehicleType: "wheeled",
    axles,
    tracks: [],
    widthM: definition.widthM ?? 0,
    lengthM: offset,
    datumDescription: "First load of the DEFINE MOVING LOAD (axle 1)",
    sourceReference: `Imported from source line ${definition.sourceLineNumber}`,
    sourceEdition: "—",
    provenance: "imported",
    notes:
      "Reconstructed from DEFINE MOVING LOAD. Transverse wheel gauge and individual wheel loads are not encoded in that command and are therefore NOT known. " +
      "Add the transverse geometry in the Vehicle Library before using this definition for design.",
    isBuiltIn: false,
  };
}

export function reconstructScene(
  parsed: ParsedDocument,
  fragment: ModelFragment | null,
  project: ProjectData,
  options?: { adoptModel?: boolean },
): Reconstruction {
  const diagnostics: Diagnostic[] = [];
  const summary: string[] = [];
  const vehicles = [...project.vehicles];
  const placements: VehiclePlacement[] = [];
  const moving: MovingLoadSettings = { ...project.moving };
  const existingIds = new Set(vehicles.map((v) => v.id));
  let partial = false;

  const typeToVehicle = new Map<number, VehicleDefinition>();
  parsed.movingDefinitions.forEach((definition) => {
    const matched = vehicles.find((v) => matchesDefinition(v, definition));
    if (matched) {
      typeToVehicle.set(definition.typeNumber, matched);
      summary.push(`TYPE ${definition.typeNumber} matched library vehicle “${matched.shortName}” from loads and spacings.`);
      return;
    }
    const created = vehicleFromDefinition(definition, existingIds);
    vehicles.push(created);
    typeToVehicle.set(definition.typeNumber, created);
    summary.push(`TYPE ${definition.typeNumber} reconstructed as a new imported vehicle (transverse geometry unknown).`);
    partial = true;
  });

  if (parsed.movingDefinitions.length && !parsed.generations.length) {
    const knownPlacements = new Set(project.placements.map((p) => p.referencePoint));
    void knownPlacements;
    summary.push("No LOAD GENERATION was found, so no moving-load position was created.");
    partial = true;
    diagnostics.push({
      id: "recon-no-generation",
      severity: "info",
      category: "syntax",
      code: "recon-no-generation",
      message:
        "Moving-load definitions were imported without a generated position. The definitions are available in the library; no vehicle has been placed on the deck because the source contains no position.",
    });
  }

  const mapping = project.settings.coordMapping;
  let placementIndex = 0;
  parsed.generations.forEach((generation) => {
    const vehicle = typeToVehicle.get(generation.typeNumber);
    if (!vehicle) {
      diagnostics.push({
        id: `recon-missing-type-${generation.typeNumber}`,
        severity: "warning",
        category: "syntax",
        code: "recon-missing-definition",
        message: `LOAD GENERATION references TYPE ${generation.typeNumber}, which is not defined in the source. No position was created for it.`,
        line: generation.sourceLineNumber,
      });
      partial = true;
      return;
    }
    const deck = globalToDeck(generation.start, mapping);
    if (Math.abs(deck.yd) > 1e-6) {
      diagnostics.push({
        id: `recon-elevation-${generation.sourceLineNumber}`,
        severity: "warning",
        category: "model",
        code: "recon-elevation",
        message: `Generation start elevation differs from the deck datum by ${fmt(deck.yd, 3)} m. Vehicle loads are applied at the deck surface; confirm the structural model level.`,
        line: generation.sourceLineNumber,
      });
    }
    const label = nextVehicleLabel([...project.placements, ...placements]);
    const placement: VehiclePlacement = {
      id: `imported-placement-${placementIndex + 1}`,
      vehicleId: vehicle.id,
      label,
      longitudinalM: round(deck.xd, 4),
      transverseM: round(deck.zd, 4),
      rotationDeg: 0,
      referencePoint: "vehicle-front",
      mode: "free",
      locked: false,
      visible: true,
      color: colorForIndex(project.placements.length + placementIndex),
    };
    placements.push(placement);
    placementIndex += 1;

    if (vehicle.axles.some((a) => a.trackSpacingM === 0)) {
      diagnostics.push({
        id: `recon-gauge-${vehicle.id}`,
        severity: "warning",
        category: "vehicle",
        code: "recon-missing-gauge",
        message: `“${vehicle.name}” has no transverse wheel gauge. The reconstructed position assumes the first load line lies on the vehicle centreline.`,
        refs: { vehicleId: vehicle.id, placementId: placement.id },
      });
    }

    const mappedAxis = mapping.longitudinalAxis;
    if (generation.incrementAxis === mappedAxis) {
      const signed = generation.incrementM * mapping.longitudinalSign;
      moving.direction = signed >= 0 ? 1 : -1;
      moving.incrementM = Math.abs(generation.incrementM);
      moving.positionCount = generation.positionCount;
      moving.typeNumber = generation.typeNumber;
      moving.startLongitudinalM = round(deck.xd, 4);
      summary.push(
        `Position ${label} reconstructed at Xd = ${fmt(deck.xd)} m, Zd = ${fmt(deck.zd)} m with ${generation.positionCount} positions at ${fmt(
          Math.abs(generation.incrementM),
        )} m increments.`,
      );
    } else {
      diagnostics.push({
        id: `recon-axis-${generation.sourceLineNumber}`,
        severity: "warning",
        category: "syntax",
        code: "recon-increment-axis",
        message: `LOAD GENERATION increments along ${generation.incrementAxis}, but the deck longitudinal axis maps to ${mappedAxis}. The increment was preserved in the description but cannot be applied to the deck sweep.`,
        line: generation.sourceLineNumber,
      });
      partial = true;
    }
  });

  let model: StructuralModel | null = null;
  if (options?.adoptModel !== false && fragment && fragment.nodes.length) {
    const transfer = fragment.quads.length ? "four-node-bilinear" : fragment.members.length ? "two-node-lever" : "nearest-node";
    model = {
      ...project.model,
      nodes: fragment.nodes,
      members: fragment.members,
      quads: fragment.quads,
      sourceLabel: "Imported from STAAD.Pro text",
      loadTransfer: transfer,
    };
    summary.push(
      `Structural model adopted: ${fragment.nodes.length} joints, ${fragment.members.length} members, ${fragment.quads.length} quads; load transfer set to ${transfer}.`,
    );
  }

  if (parsed.staticCases.length) {
    const valid = parsed.staticCases.filter((c) => c.nodeLoads.length);
    summary.push(
      `${valid.length} static load case(s) recognised with ${valid.reduce((acc, c) => acc + c.nodeLoads.length, 0)} joint load items.`,
    );
    diagnostics.push({
      id: "recon-static-cases",
      severity: "info",
      category: "syntax",
      code: "recon-static-inverse",
      message:
        "Joint forces in a static load case cannot be turned back into vehicle geometry without inventing a position, so the cases are listed for review rather than placed on the deck. Import the source model joints to inspect them against the deck.",
    });
    partial = partial || true;
  }

  if (parsed.unsupported.length) {
    diagnostics.push({
      id: "recon-unsupported",
      severity: "warning",
      category: "syntax",
      code: "recon-unsupported",
      message: `${parsed.unsupported.length} source line(s) were preserved but not applied to the scene. See the parsed source panel for line numbers and reasons.`,
    });
    partial = true;
  }

  if (!parsed.movingDefinitions.length && !parsed.staticCases.length && !(fragment && fragment.nodes.length)) {
    diagnostics.push({
      id: "recon-nothing",
      severity: "error",
      category: "syntax",
      code: "recon-nothing",
      message: "No supported content was recognised in the pasted text. The source is preserved unchanged.",
    });
  }

  return { vehicles, placements, moving, model, summary, diagnostics, partial };
}

/** Human-readable axle table for an imported definition, used by the import panel. */
export function definitionRows(definition: MovingLoadDefinition): string[][] {
  let offset = 0;
  return definition.loadsKN.map((load, index) => {
    if (index > 0) offset += definition.distancesM[index - 1] ?? 0;
    return [`A${index + 1}`, fmt(load, 1), fmt(offset, 3)];
  });
}

export function importedSize(vehicles: VehicleDefinition[]): string {
  const imported = vehicles.filter((v) => v.provenance === "imported");
  if (!imported.length) return "No imported vehicles";
  const last = imported[imported.length - 1];
  return `${imported.length} imported definition(s); last: ${last.name} (${vehicleLocalLoads(last).length} load points)`;
}
