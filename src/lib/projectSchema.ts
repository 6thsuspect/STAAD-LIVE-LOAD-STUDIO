import { z } from "zod";
import type { ProjectFile } from "../types";

/**
 * Runtime schema for the versioned project file.
 *
 * The project file is user-editable JSON, so it is untrusted input: it may come
 * from a newer build, a hand-edited copy, or a truncated download. Validation
 * here is deliberately strict about *shape* and permissive about *engineering
 * decisions* — an out-of-range deck is the validation panel's job, not the
 * schema's, because refusing to load it would hide the error from the user.
 */

const finite = z.number().finite();
const positive = finite.positive();
const nonNegative = finite.nonnegative();
const sign = z.union([z.literal(1), z.literal(-1)]);
const axis = z.enum(["X", "Y", "Z"]);

const axleSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  loadKN: finite,
  longitudinalOffsetM: finite,
  wheelLoadsKN: z.array(finite),
  trackSpacingM: nonNegative,
  wheelWidthM: nonNegative,
  wheelLengthM: nonNegative,
});

const trackSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  loadKN: finite,
  longitudinalStartM: finite,
  longitudinalEndM: finite,
  transverseCentreM: finite,
  widthM: nonNegative,
});

const vehicleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  shortName: z.string(),
  classification: z.string(),
  vehicleType: z.enum(["wheeled", "tracked", "custom"]),
  axles: z.array(axleSchema),
  tracks: z.array(trackSchema),
  widthM: positive,
  lengthM: positive,
  datumDescription: z.string(),
  sourceReference: z.string(),
  sourceEdition: z.string(),
  provenance: z.enum(["reference-preset", "user-verified", "user-custom", "imported"]),
  notes: z.string(),
  isBuiltIn: z.boolean(),
});

const edgeSchema = z.object({
  side: z.enum(["left", "right"]),
  datum: z.enum(["carriageway", "barrier", "deck-edge"]),
  clearanceM: finite,
});

const placementSchema = z.object({
  id: z.string().min(1),
  vehicleId: z.string().min(1),
  label: z.string(),
  longitudinalM: finite,
  transverseM: finite,
  rotationDeg: finite,
  referencePoint: z.enum(["vehicle-centre", "vehicle-front", "reference-axle", "outer-wheel-plus", "outer-wheel-minus"]),
  mode: z.enum(["free", "edge", "centreline", "lane", "coordinate"]),
  edge: edgeSchema.optional(),
  lane: z.object({ laneIndex: z.number().int().min(0) }).optional(),
  locked: z.boolean(),
  visible: z.boolean(),
  color: z.string(),
  loadCaseNumber: z.number().int().positive().optional(),
});

const deckSchema = z.object({
  spanM: positive,
  totalWidthM: positive,
  carriagewayWidthM: nonNegative,
  leftBarrierWidthM: nonNegative,
  rightBarrierWidthM: nonNegative,
  leftFootpathWidthM: nonNegative,
  rightFootpathWidthM: nonNegative,
  leftKerbWidthM: nonNegative,
  rightKerbWidthM: nonNegative,
  laneCount: z.number().int().min(1).max(12),
  laneWidthMode: z.enum(["equal", "custom"]),
  laneWidthsM: z.array(nonNegative),
  longitudinalOrigin: z.enum(["left-end", "centre"]),
  transverseOrigin: z.enum(["centreline", "left-edge"]),
  kerbHeightM: nonNegative,
});

const nodeSchema = z.object({ id: z.number().int(), x: finite, y: finite, z: finite });
const memberSchema = z.object({ id: z.number().int(), startNode: z.number().int(), endNode: z.number().int() });
const quadSchema = z.object({ id: z.number().int(), nodes: z.array(z.number().int()).length(4) });

const modelSchema = z.object({
  nodes: z.array(nodeSchema),
  members: z.array(memberSchema),
  quads: z.array(quadSchema),
  sourceLabel: z.string(),
  loadTransfer: z.enum(["exact-node", "nearest-node", "two-node-lever", "four-node-bilinear"]),
  nodeToleranceM: nonNegative,
  gridToleranceM: nonNegative,
  trackTrackPoints: z.number().int().min(1).max(100),
});

const movingSchema = z.object({
  typeNumber: z.number().int().positive(),
  positionCount: z.number().int().min(1).max(10000),
  startLongitudinalM: finite,
  direction: sign,
  incrementM: positive,
  representation: z.enum(["axle-load-width", "wheel-line-no-width", "explicit-wheel-lines"]),
  trackSlices: z.number().int().min(1).max(100),
  impactEnabled: z.boolean(),
  impactFactor: finite,
  impactNote: z.string(),
  emitLoadCaseAnchor: z.boolean(),
  anchorLoadCaseNumber: z.number().int().positive(),
  anchorTitle: z.string(),
  emitUnitCommand: z.boolean(),
});

const mappingSchema = z.object({
  longitudinalAxis: axis,
  transverseAxis: axis,
  verticalAxis: axis,
  longitudinalSign: sign,
  transverseSign: sign,
  verticalSign: sign,
  originXM: finite,
  originYM: finite,
  originZM: finite,
  rotationDeg: finite,
});

const settingsSchema = z.object({
  projectName: z.string(),
  projectNumber: z.string(),
  engineer: z.string(),
  staadVersion: z.enum(["2022", "2025"]),
  workflow: z.enum(["moving", "static"]),
  coordMapping: mappingSchema,
  deckLevelNote: z.string(),
  emitComments: z.boolean(),
  maxLineLength: z.number().int().min(40).max(500),
  emitUnitCommand: z.boolean(),
  snapStepM: nonNegative,
  showModelNodes: z.boolean(),
  staticCaseStart: z.number().int().positive(),
  staticLoadType: z.enum(["LIVE", "NONE"]),
});

export const projectFileSchema = z.object({
  schemaVersion: z.literal(1),
  savedAt: z.string(),
  name: z.string().min(1),
  deck: deckSchema,
  vehicles: z.array(vehicleSchema),
  placements: z.array(placementSchema),
  model: modelSchema,
  moving: movingSchema,
  settings: settingsSchema,
});

/**
 * Cross-field checks that a structural schema cannot express.
 *
 * These are reported as load errors because a project that violates them cannot
 * be rendered truthfully. Anything else is left to the validation panel.
 */
export function projectFileIssues(file: ProjectFile): string[] {
  const issues: string[] = [];
  const vehicleIds = new Set(file.vehicles.map((v) => v.id));
  const placementIds = new Set<string>();

  if (file.vehicles.length === 0) issues.push("the project contains no vehicle definitions");
  for (const vehicle of file.vehicles) {
    if (vehicle.axles.length === 0 && vehicle.tracks.length === 0) {
      issues.push(`vehicle “${vehicle.name}” has neither axles nor tracks`);
    }
    for (const axle of vehicle.axles) {
      const sum = axle.wheelLoadsKN.reduce((acc, load) => acc + load, 0);
      if (Math.abs(sum - axle.loadKN) > 1e-6) {
        issues.push(`axle “${axle.label}” of “${vehicle.name}”: wheel loads sum to ${sum} kN, axle load is ${axle.loadKN} kN`);
      }
    }
    for (const track of vehicle.tracks) {
      if (track.longitudinalEndM <= track.longitudinalStartM) {
        issues.push(`track “${track.label}” of “${vehicle.name}” ends before it starts`);
      }
    }
  }

  for (const placement of file.placements) {
    if (placementIds.has(placement.id)) issues.push(`duplicate placement id “${placement.id}”`);
    placementIds.add(placement.id);
    if (!vehicleIds.has(placement.vehicleId)) {
      issues.push(`placement “${placement.label}” refers to missing vehicle “${placement.vehicleId}”`);
    }
    if (placement.mode === "edge" && !placement.edge) issues.push(`placement “${placement.label}” is edge-positioned but has no edge constraint`);
    if (placement.mode === "lane" && !placement.lane) issues.push(`placement “${placement.label}” is lane-positioned but has no lane index`);
  }

  const axes = [file.settings.coordMapping.longitudinalAxis, file.settings.coordMapping.transverseAxis, file.settings.coordMapping.verticalAxis];
  if (new Set(axes).size !== 3) issues.push("the coordinate mapping assigns the same global axis twice");
  if (file.settings.coordMapping.verticalAxis !== "Y" && file.settings.coordMapping.verticalAxis !== "Z") {
    issues.push("the vertical axis must be global Y or Z");
  }

  if (file.model.nodes.length > 0) {
    const nodeIds = new Set(file.model.nodes.map((n) => n.id));
    for (const member of file.model.members) {
      if (!nodeIds.has(member.startNode) || !nodeIds.has(member.endNode)) {
        issues.push(`member ${member.id} references a missing joint`);
        break;
      }
    }
    for (const quad of file.model.quads) {
      if (quad.nodes.some((id) => !nodeIds.has(id))) {
        issues.push(`plate ${quad.id} references a missing joint`);
        break;
      }
    }
  }

  const caseNumbers = file.placements.map((p) => p.loadCaseNumber).filter((n): n is number => typeof n === "number");
  if (new Set(caseNumbers).size !== caseNumbers.length) issues.push("two placements share a load case number");

  return issues;
}

export type ProjectParseResult =
  | { ok: true; file: ProjectFile }
  | { ok: false; issues: string[] };

/** Parse and validate untrusted project JSON. */
export function parseProjectFile(text: string): ProjectParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { ok: false, issues: [`the file is not valid JSON (${(error as Error).message})`] };
  }

  if (raw && typeof raw === "object" && "schemaVersion" in raw && (raw as { schemaVersion: unknown }).schemaVersion !== 1) {
    return {
      ok: false,
      issues: [`unsupported project schema version ${String((raw as { schemaVersion: unknown }).schemaVersion)} (this build reads version 1)`],
    };
  }

  const parsed = projectFileSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 8).map((issue) => {
      const path = issue.path.length ? issue.path.join(".") : "(root)";
      return `${path}: ${issue.message}`;
    });
    if (parsed.error.issues.length > issues.length) {
      issues.push(`…and ${parsed.error.issues.length - issues.length} more`);
    }
    return { ok: false, issues };
  }

  const crossField = projectFileIssues(parsed.data);
  if (crossField.length > 0) return { ok: false, issues: crossField };
  return { ok: true, file: parsed.data };
}
