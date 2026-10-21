/**
 * Core engineering data model.
 *
 * Canonical internal units: metres and kilonewtons.
 * Deck plan axes: Xd (longitudinal, 0 at the left abutment), Zd (transverse,
 * signed, 0 at the deck centreline, +Zd towards the "left" deck edge when
 * looking along +Xd), Yd (vertical, up).
 *
 * Display origins never change the canonical values stored in this model.
 */

export type Axis = "X" | "Y" | "Z";

export type StaadVersion = "2022" | "2025";

export type Workflow = "moving" | "static";

export type Severity = "error" | "warning" | "info";

export type DiagnosticCategory =
  | "geometry"
  | "vehicle"
  | "placement"
  | "load"
  | "syntax"
  | "model";

export interface Diagnostic {
  id: string;
  severity: Severity;
  category: DiagnosticCategory;
  code: string;
  message: string;
  detail?: string;
  /** Optional 1-based source line for syntax diagnostics. */
  line?: number;
  refs?: {
    vehicleId?: string;
    placementId?: string;
    loadCaseId?: string;
    field?: string;
  };
}

export type VehicleProvenance =
  | "reference-preset"
  | "user-verified"
  | "user-custom"
  | "imported";

export interface AxleDefinition {
  id: string;
  label: string;
  /** Axle load in kN (sum of all wheel loads on this axle). */
  loadKN: number;
  /** Offset of the axle from the vehicle datum (u axis, 0 at the datum line). */
  longitudinalOffsetM: number;
  /**
   * Individual wheel loads in kN. Order is wheel line 1 (+Zd), wheel line 2 (-Zd).
   * The sum must equal loadKN (validated).
   */
  wheelLoadsKN: number[];
  /** Centre-to-centre distance between wheel lines in metres. 0 for a single line. */
  trackSpacingM: number;
  /** Transverse footprint of one wheel, metres. */
  wheelWidthM: number;
  /** Longitudinal footprint of one wheel, metres. */
  wheelLengthM: number;
}

export interface TrackDefinition {
  id: string;
  label: string;
  /** Total load carried by this track, kN. */
  loadKN: number;
  /** Longitudinal start of the track, measured from the vehicle datum. */
  longitudinalStartM: number;
  /** Longitudinal end of the track, measured from the vehicle datum. */
  longitudinalEndM: number;
  /** Transverse centre of the track, measured from the vehicle centreline. */
  transverseCentreM: number;
  /** Track width (transverse), metres. */
  widthM: number;
}

export interface VehicleDefinition {
  id: string;
  name: string;
  shortName: string;
  classification: string;
  vehicleType: "wheeled" | "tracked" | "custom";
  axles: AxleDefinition[];
  tracks: TrackDefinition[];
  /** Overall vehicle width in metres (outermost wheel / track edge). */
  widthM: number;
  /** Overall vehicle length in metres, datum at the front line. */
  lengthM: number;
  /** Human-readable definition of where u = 0 is located. */
  datumDescription: string;
  sourceReference: string;
  sourceEdition: string;
  provenance: VehicleProvenance;
  notes: string;
  isBuiltIn: boolean;
}

export type VehicleReference =
  | "vehicle-centre"
  | "vehicle-front"
  | "reference-axle"
  | "outer-wheel-plus"
  | "outer-wheel-minus";

export type PlacementMode = "free" | "edge" | "centreline" | "lane" | "coordinate";

export type EdgeDatum = "carriageway" | "barrier" | "deck-edge";

export interface EdgeConstraint {
  side: "left" | "right";
  /** Reference line the clearance is measured from. */
  datum: EdgeDatum;
  /** Clearance from the datum to the nearest wheel/track outer edge, metres. */
  clearanceM: number;
}

export interface LaneConstraint {
  /** 0-based lane index counted from the left carriageway edge (highest +Zd). */
  laneIndex: number;
}

export interface VehiclePlacement {
  id: string;
  vehicleId: string;
  label: string;
  /** Deck coordinate of the placement reference point, metres. */
  longitudinalM: number;
  transverseM: number;
  rotationDeg: number;
  referencePoint: VehicleReference;
  mode: PlacementMode;
  /** Only meaningful while mode === "edge" / "lane". */
  edge?: EdgeConstraint;
  lane?: LaneConstraint;
  locked: boolean;
  visible: boolean;
  color: string;
  /** Static workflow only: existing STAAD load case number, if any. */
  loadCaseNumber?: number;
}

export type TransverseOrigin = "centreline" | "left-edge";
export type LongitudinalOrigin = "left-end" | "centre";

export interface DeckGeometry {
  /** Bridge span, metres. */
  spanM: number;
  totalWidthM: number;
  carriagewayWidthM: number;
  /** Barrier widths, outermost transverse strips. */
  leftBarrierWidthM: number;
  rightBarrierWidthM: number;
  leftFootpathWidthM: number;
  rightFootpathWidthM: number;
  leftKerbWidthM: number;
  rightKerbWidthM: number;
  laneCount: number;
  /** Equal lane widths unless laneWidthMode === "custom". */
  laneWidthMode: "equal" | "custom";
  laneWidthsM: number[];
  longitudinalOrigin: LongitudinalOrigin;
  transverseOrigin: TransverseOrigin;
  /** Height of the footpath/kerb above the carriageway, metres (visual only). */
  kerbHeightM: number;
}

export type LoadTransferMethod =
  | "exact-node"
  | "nearest-node"
  | "two-node-lever"
  | "four-node-bilinear";

export interface ModelNode {
  id: number;
  x: number;
  y: number;
  z: number;
}

export interface CoordMapping {
  longitudinalAxis: Axis;
  transverseAxis: Axis;
  /** Vertical axis is the remaining axis; stored explicitly for validation. */
  verticalAxis: Axis;
  longitudinalSign: 1 | -1;
  transverseSign: 1 | -1;
  verticalSign: 1 | -1;
  /** Global coordinates of deck (Xd = 0, Zd = 0, Yd = 0). */
  originXM: number;
  originYM: number;
  originZM: number;
  /** Rotation of the deck's local axes about the vertical axis, degrees. */
  rotationDeg: number;
}

export interface ModelMember {
  id: number;
  startNode: number;
  endNode: number;
}

export interface ModelQuad {
  id: number;
  /** Four node ids in STAAD plate order (anti-clockwise or clockwise, planar). */
  nodes: number[];
}

export interface StructuralModel {
  nodes: ModelNode[];
  members: ModelMember[];
  quads: ModelQuad[];
  sourceLabel: string;
  loadTransfer: LoadTransferMethod;
  /** Distance tolerance for exact/nearest node matching, metres. */
  nodeToleranceM: number;
  /** Grid tolerance for lever / bilinear interpolation, metres. */
  gridToleranceM: number;
  /** Number of load points used to discretise each track for static transfer. */
  trackTrackPoints: number;
}

export type MovingLoadRepresentation =
  | "axle-load-width"
  | "wheel-line-no-width"
  | "explicit-wheel-lines";

export interface MovingLoadSettings {
  /** STAAD moving-load TYPE number. */
  typeNumber: number;
  positionCount: number;
  /** Deck longitudinal coordinate of the placement reference point at step 0. */
  startLongitudinalM: number;
  /** Movement direction along the deck longitudinal axis. */
  direction: 1 | -1;
  incrementM: number;
  representation: MovingLoadRepresentation;
  /** Number of longitudinal slices used to discretise a tracked vehicle. */
  trackSlices: number;
  /** Apply a user-specified impact/dynamic multiplier to emitted loads. */
  impactEnabled: boolean;
  impactFactor: number;
  impactNote: string;
  /** Emit a LOAD n LOADTYPE LIVE anchor before LOAD GENERATION. */
  emitLoadCaseAnchor: boolean;
  anchorLoadCaseNumber: number;
  anchorTitle: string;
  /** Emit a UNIT METER KN statement at the top of the document. */
  emitUnitCommand: boolean;
}

export interface ProjectSettings {
  projectName: string;
  projectNumber: string;
  engineer: string;
  staadVersion: StaadVersion;
  workflow: Workflow;
  coordMapping: CoordMapping;
  /** Global joint-load elevation note; application elevation is governed by model nodes. */
  deckLevelNote: string;
  /** Emit STAAD comment lines describing assumptions. */
  emitComments: boolean;
  /** Warn when a generated line exceeds this length. */
  maxLineLength: number;
  /** Emit the UNIT METER KN statement. */
  emitUnitCommand: boolean;
  snapStepM: number;
  showModelNodes: boolean;
  /** First load case number used for generated static vehicle cases. */
  staticCaseStart: number;
  /** LOADTYPE keyword used on generated static cases. */
  staticLoadType: "LIVE" | "NONE";
}

export interface ProjectFile {
  schemaVersion: 1;
  savedAt: string;
  name: string;
  deck: DeckGeometry;
  vehicles: VehicleDefinition[];
  placements: VehiclePlacement[];
  model: StructuralModel;
  moving: MovingLoadSettings;
  settings: ProjectSettings;
}

/** Wheel/track load application point in deck coordinates. */
export interface WheelLoad {
  id: string;
  axleId: string;
  axleLabel: string;
  /** +1 for the +Zd wheel line, -1 for the -Zd wheel line, 0 for a single line. */
  side: 1 | -1 | 0;
  localU: number;
  localV: number;
  xd: number;
  zd: number;
  loadKN: number;
  footprintLengthM: number;
  footprintWidthM: number;
  rotationDeg: number;
  /** Footprint corners in deck coordinates (clockwise from the -u/-v corner). */
  corners: Array<{ xd: number; zd: number }>;
}

export interface VehicleFootprint {
  vehicleId: string;
  placementId: string;
  wheels: WheelLoad[];
  /** Track polygons in deck coordinates (corners, clockwise). */
  tracks: Array<{ trackId: string; label: string; loadKN: number; corners: Array<{ xd: number; zd: number }> }>;
  /** Body outline corners in deck coordinates. */
  bodyCorners: Array<{ xd: number; zd: number }>;
  /** Extent of all geometry in deck coordinates. */
  bounds: { minXd: number; maxXd: number; minZd: number; maxZd: number };
  /** Reference point position in deck coordinates. */
  reference: { xd: number; zd: number };
}

export interface ClearanceReport {
  /** Signed clearance to the +Zd barrier inner face (positive = inside carriageway). */
  toLeftBarrierM: number;
  toRightBarrierM: number;
  toLeftDeckEdgeM: number;
  toRightDeckEdgeM: number;
  /** Road overhang at the start / end of the span (negative = outside the deck). */
  beyondStartM: number;
  beyondEndM: number;
  insideCarriageway: boolean;
  insideDeck: boolean;
  interferesWithBarrier: boolean;
}

export interface ParseDiagnostic extends Diagnostic {
  line?: number;
}

export interface MovingLoadDefinition {
  typeNumber: number;
  loadsKN: number[];
  distancesM: number[];
  widthM?: number;
  /** Human-readable line from the source, preserved verbatim. */
  sourceLine: string;
  sourceLineNumber: number;
}

export interface LoadGeneration {
  positionCount: number;
  typeNumber: number;
  start: { x: number; y: number; z: number };
  incrementAxis: "X" | "Y" | "Z";
  incrementM: number;
  sourceLine: string;
  sourceLineNumber: number;
}

export interface StaticNodeLoad {
  node: number;
  fx: number;
  fy: number;
  fz: number;
}

export interface StaticLoadCase {
  caseNumber: number;
  title: string;
  loadType: string;
  nodeLoads: StaticNodeLoad[];
  sourceLine?: string;
  sourceLineNumber?: number;
}

export interface ParsedDocument {
  status: "valid" | "partial" | "invalid";
  movingDefinitions: MovingLoadDefinition[];
  generations: LoadGeneration[];
  staticCases: StaticLoadCase[];
  /** Source lines that were recognised and consumed, keyed by 1-based line number. */
  recognisedLines: number[];
  unsupported: Array<{ line: number; text: string; reason: string }>;
  comments: Array<{ line: number; text: string }>;
  diagnostics: ParseDiagnostic[];
  /** Original source is always preserved verbatim. */
  source: string;
  units?: { length?: string; force?: string };
}

export type SyntaxDocumentMode = "generated" | "edited" | "imported";

export interface GeneratedSyntaxBlock {
  id: string;
  heading: string;
  /** Which placement or definition owns the block, for "copy this vehicle only". */
  placementId?: string;
  vehicleId?: string;
  text: string;
  lineStart: number;
  lineEnd: number;
}
