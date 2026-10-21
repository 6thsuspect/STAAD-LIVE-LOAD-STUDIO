import type {
  CoordMapping,
  DeckGeometry,
  MovingLoadSettings,
  ProjectFile,
  ProjectSettings,
  StructuralModel,
  VehiclePlacement,
} from "../types";
import { colorForIndex } from "./ids";
import { presetVehicles } from "./vehicles";

export interface ProjectData {
  name: string;
  deck: DeckGeometry;
  vehicles: ProjectFile["vehicles"];
  placements: VehiclePlacement[];
  model: StructuralModel;
  moving: MovingLoadSettings;
  settings: ProjectSettings;
}

export const DEFAULT_MAPPING: CoordMapping = {
  longitudinalAxis: "X",
  transverseAxis: "Z",
  verticalAxis: "Y",
  longitudinalSign: 1,
  transverseSign: 1,
  verticalSign: 1,
  originXM: 0,
  originYM: 0,
  originZM: 0,
  rotationDeg: 0,
};

export function defaultDeck(): DeckGeometry {
  return {
    spanM: 30,
    totalWidthM: 12,
    carriagewayWidthM: 9,
    leftBarrierWidthM: 0.5,
    rightBarrierWidthM: 0.5,
    leftFootpathWidthM: 1,
    rightFootpathWidthM: 1,
    leftKerbWidthM: 0,
    rightKerbWidthM: 0,
    laneCount: 2,
    laneWidthMode: "equal",
    laneWidthsM: [4.5, 4.5],
    longitudinalOrigin: "left-end",
    transverseOrigin: "centreline",
    kerbHeightM: 0.15,
  };
}

export function defaultMoving(): MovingLoadSettings {
  return {
    typeNumber: 1,
    positionCount: 20,
    startLongitudinalM: 0,
    direction: 1,
    incrementM: 1,
    representation: "axle-load-width",
    trackSlices: 8,
    impactEnabled: false,
    impactFactor: 0,
    impactNote: "",
    emitLoadCaseAnchor: true,
    anchorLoadCaseNumber: 100,
    anchorTitle: "IRC MOVING LOAD",
    emitUnitCommand: true,
  };
}

export function defaultSettings(): ProjectSettings {
  return {
    projectName: "Untitled bridge",
    projectNumber: "",
    engineer: "",
    staadVersion: "2022",
    workflow: "moving",
    coordMapping: { ...DEFAULT_MAPPING },
    deckLevelNote: "",
    emitComments: true,
    maxLineLength: 120,
    emitUnitCommand: true,
    snapStepM: 0.5,
    showModelNodes: true,
    staticCaseStart: 301,
    staticLoadType: "LIVE",
  };
}

export function defaultModel(): StructuralModel {
  return {
    nodes: [],
    members: [],
    quads: [],
    sourceLabel: "Not supplied",
    loadTransfer: "nearest-node",
    nodeToleranceM: 0.02,
    gridToleranceM: 0.02,
    trackTrackPoints: 8,
  };
}

export function newProject(): ProjectData {
  const vehicles = presetVehicles();
  const wheeled = vehicles.find((v) => v.id === "preset-irc-70r-wheeled")!;
  const placements: VehiclePlacement[] = [
    {
      id: "placement-1",
      vehicleId: wheeled.id,
      label: "V1",
      longitudinalM: 8,
      transverseM: -2.25,
      rotationDeg: 0,
      referencePoint: "vehicle-centre",
      mode: "lane",
      lane: { laneIndex: 1 },
      locked: false,
      visible: true,
      color: colorForIndex(0),
    },
  ];
  return {
    name: "Untitled bridge",
    deck: defaultDeck(),
    vehicles,
    placements,
    model: defaultModel(),
    moving: defaultMoving(),
    settings: defaultSettings(),
  };
}

/** Quadrilateral grillage of shell elements — a valid target for bilinear load transfer. */
export function sampleModel(): StructuralModel {
  const xs = Array.from({ length: 17 }, (_, i) => i * 2.5);
  const zs = [-5.4, -3.6, -1.8, 0, 1.8, 3.6, 5.4];
  const nodes = [];
  for (let row = 0; row < xs.length; row += 1) {
    for (let col = 0; col < zs.length; col += 1) {
      nodes.push({ id: row * zs.length + col + 1, x: xs[row], y: 0, z: zs[col] });
    }
  }
  const quads = [];
  let quadId = 1;
  for (let row = 0; row < xs.length - 1; row += 1) {
    for (let col = 0; col < zs.length - 1; col += 1) {
      const a = row * zs.length + col + 1;
      const b = a + zs.length;
      const c = b + 1;
      const d = a + 1;
      quads.push({ id: quadId, nodes: [a, b, c, d] });
      quadId += 1;
    }
  }
  const members = [];
  let memberId = 1;
  for (let row = 0; row < xs.length; row += 1) {
    for (let col = 0; col < zs.length - 1; col += 1) {
      const startNode = row * zs.length + col + 1;
      members.push({ id: memberId, startNode, endNode: startNode + 1 });
      memberId += 1;
    }
  }
  for (let col = 0; col < zs.length; col += 1) {
    for (let row = 0; row < xs.length - 1; row += 1) {
      const startNode = row * zs.length + col + 1;
      members.push({ id: memberId, startNode, endNode: startNode + zs.length });
      memberId += 1;
    }
  }
  return {
    nodes,
    members,
    quads,
    sourceLabel: "Sample: 17 × 7 joint quad grillage, 40 m × 10.8 m",
    loadTransfer: "four-node-bilinear",
    nodeToleranceM: 0.02,
    gridToleranceM: 0.05,
    trackTrackPoints: 8,
  };
}

export function sampleProject(): ProjectData {
  const base = newProject();
  const classA = base.vehicles.find((v) => v.id === "preset-irc-class-a")!;
  const wheeled = base.vehicles.find((v) => v.id === "preset-irc-70r-wheeled")!;
  const tracked = base.vehicles.find((v) => v.id === "preset-irc-70r-tracked")!;
  const placements: VehiclePlacement[] = [
    {
      id: "placement-1",
      vehicleId: classA.id,
      label: "V1",
      longitudinalM: 13,
      transverseM: 2.25,
      rotationDeg: 0,
      referencePoint: "vehicle-centre",
      mode: "lane",
      lane: { laneIndex: 0 },
      locked: false,
      visible: true,
      color: colorForIndex(0),
    },
    {
      id: "placement-2",
      vehicleId: wheeled.id,
      label: "V2",
      longitudinalM: 10,
      transverseM: -2.25,
      rotationDeg: 0,
      referencePoint: "vehicle-centre",
      mode: "lane",
      lane: { laneIndex: 1 },
      locked: false,
      visible: true,
      color: colorForIndex(1),
      loadCaseNumber: 302,
    },
    {
      id: "placement-3",
      vehicleId: tracked.id,
      label: "V3",
      longitudinalM: 26,
      transverseM: 2.25,
      rotationDeg: 0,
      referencePoint: "vehicle-front",
      mode: "edge",
      edge: { side: "left", clearanceM: 1.2, datum: "carriageway" },
      locked: false,
      visible: true,
      color: colorForIndex(2),
    },
  ];
  return {
    ...base,
    name: "Sample: 40 m two-lane bridge",
    deck: { ...base.deck, spanM: 40, laneWidthMode: "equal", laneWidthsM: [4.5, 4.5] },
    placements,
    model: sampleModel(),
    settings: {
      ...base.settings,
      projectName: "Sample: 40 m two-lane bridge",
      projectNumber: "SAMPLE-001",
      engineer: "Verification set",
      workflow: "static",
      showModelNodes: true,
    },
    moving: { ...base.moving, positionCount: 30, startLongitudinalM: 0, incrementM: 1 },
  };
}

export function toProjectFile(project: ProjectData): ProjectFile {
  return {
    schemaVersion: 1,
    savedAt: new Date().toISOString(),
    name: project.name,
    deck: project.deck,
    vehicles: project.vehicles,
    placements: project.placements,
    model: project.model,
    moving: project.moving,
    settings: project.settings,
  };
}

/** Accepts both the current schema and reasonably shaped legacy objects. */
export function fromProjectFile(file: ProjectFile): ProjectData {
  return {
    name: file.name || "Imported project",
    deck: { ...defaultDeck(), ...file.deck },
    vehicles: file.vehicles?.length ? file.vehicles : presetVehicles(),
    placements: file.placements ?? [],
    model: { ...defaultModel(), ...(file.model ?? {}) },
    moving: { ...defaultMoving(), ...(file.moving ?? {}) },
    settings: {
      ...defaultSettings(),
      ...(file.settings ?? {}),
      coordMapping: { ...DEFAULT_MAPPING, ...(file.settings?.coordMapping ?? {}) },
    },
  };
}

export function emptyProject(): ProjectData {
  return {
    name: "New project",
    deck: defaultDeck(),
    vehicles: presetVehicles(),
    placements: [],
    model: defaultModel(),
    moving: defaultMoving(),
    settings: defaultSettings(),
  };
}
