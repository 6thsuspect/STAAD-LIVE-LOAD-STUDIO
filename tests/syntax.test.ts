import { describe, expect, it } from "vitest";
import type { MovingLoadSettings, ProjectSettings, StructuralModel, VehiclePlacement } from "../src/types";
import { defaultDeck, defaultModel, defaultMoving, defaultSettings, newProject, sampleModel, sampleProject } from "../src/lib/project";
import { deckLayout } from "../src/lib/geometry";
import { presetVehicles } from "../src/lib/vehicles";
import { generateDocument } from "../src/lib/syntax/document";
import { parseSyntax } from "../src/lib/syntax/parse";
import { planStaticCases } from "../src/lib/syntax/static";
import { buildTransferContext, invertQuad, transferLoad } from "../src/lib/syntax/transfer";
import { planMovingDefinitions, planGeneration } from "../src/lib/syntax/moving";
import { tokenizeSource } from "../src/lib/syntax/tokenize";
import { reconstructScene } from "../src/lib/syntax/import";
import { DEFAULT_MAPPING } from "../src/lib/project";
import { round } from "../src/lib/units";

const vehicles = presetVehicles();
const classA = vehicles.find((v) => v.id === "preset-irc-class-a")!;
const wheeled = vehicles.find((v) => v.id === "preset-irc-70r-wheeled")!;
const tracked = vehicles.find((v) => v.id === "preset-irc-70r-tracked")!;
const layout = deckLayout(defaultDeck());

function placement(patch: Partial<VehiclePlacement> = {}): VehiclePlacement {
  return {
    id: "p1",
    vehicleId: classA.id,
    label: "V1",
    longitudinalM: 6,
    transverseM: 2.25,
    rotationDeg: 0,
    referencePoint: "vehicle-centre",
    mode: "lane",
    lane: { laneIndex: 0 },
    locked: false,
    visible: true,
    color: "#38bdf8",
    ...patch,
  };
}

const movingSettings: MovingLoadSettings = { ...defaultMoving(), positionCount: 12, startLongitudinalM: 0, incrementM: 1 };

function projectWith(patch: {
  placements?: VehiclePlacement[];
  workflow?: "moving" | "static";
  model?: StructuralModel;
  moving?: Partial<MovingLoadSettings>;
  settings?: Partial<ProjectSettings>;
}) {
  const base = newProject();
  return {
    ...base,
    vehicles,
    placements: patch.placements ?? [placement()],
    model: patch.model ?? defaultModel(),
    moving: { ...movingSettings, ...(patch.moving ?? {}) },
    settings: { ...defaultSettings(), workflow: patch.workflow ?? "moving", ...(patch.settings ?? {}) },
  };
}

describe("moving-load definitions", () => {
  it("emits 8 loads and 7 distances for the Class A train", () => {
    const plan = planMovingDefinitions(classA, placement(), movingSettings);
    expect(plan.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
    expect(plan.definitions).toHaveLength(1);
    const definition = plan.definitions[0];
    expect(definition.loadsKN).toEqual([27, 27, 114, 114, 68, 68, 68, 68]);
    expect(definition.distancesM).toEqual([1.1, 3.2, 1.2, 4.3, 3, 3, 3]);
    expect(definition.loadsKN.length - 1).toBe(definition.distancesM.length);
    expect(definition.widthM).toBe(2.3);
  });

  it("rejects a mismatched distance count at parse time", () => {
    const parsed = parseSyntax("DEFINE MOVING LOAD\nTYPE 1 LOAD 100 100 100 DISTANCE 2.0\n");
    expect(parsed.document.status).toBe("invalid");
    expect(parsed.document.diagnostics.some((d) => d.code === "moving-count-mismatch")).toBe(true);
  });

  it("emits two explicit wheel lines whose loads sum to the vehicle load", () => {
    const plan = planMovingDefinitions(wheeled, placement({ vehicleId: wheeled.id }), {
      ...movingSettings,
      representation: "explicit-wheel-lines",
    });
    expect(plan.definitions).toHaveLength(2);
    const total = plan.definitions.reduce((acc, d) => acc + d.loadsKN.reduce((a, b) => a + b, 0), 0);
    expect(total).toBeCloseTo(1000, 6);
    expect(plan.definitions[0].distancesM).toEqual([3.96, 1.52, 2.13, 1.37, 3.05, 1.37]);
    expect(plan.definitions[0].widthM).toBeUndefined();
    expect(plan.definitions[0].firstLoadLocal.v).toBeCloseTo(1.03, 6);
    expect(plan.definitions[1].firstLoadLocal.v).toBeCloseTo(-1.03, 6);
  });

  it("forces explicit track lines for a tracked vehicle", () => {
    const plan = planMovingDefinitions(tracked, placement({ vehicleId: tracked.id, referencePoint: "vehicle-front" }), {
      ...movingSettings,
      trackSlices: 4,
    });
    expect(plan.definitions).toHaveLength(2);
    expect(plan.diagnostics.some((d) => d.code === "tracked-forced-wheel-lines")).toBe(true);
    expect(plan.definitions[0].loadsKN).toHaveLength(4);
    expect(plan.definitions[0].loadsKN.reduce((a, b) => a + b, 0)).toBeCloseTo(350, 6);
    expect(plan.definitions[0].distancesM[0]).toBeCloseTo(4.57 / 4, 6); // 1.1425 m per slice
  });

  it("places the generation start at the first load line, not the vehicle centre", () => {
    const p = placement({ longitudinalM: 10 });
    const plan = planMovingDefinitions(classA, p, movingSettings);
    const generation = planGeneration(plan.definitions[0], classA, p, movingSettings, DEFAULT_MAPPING, layout);
    expect(generation.plan).not.toBeNull();
    // Class A centre reference: centre u = 18.8/2 = 9.4 → first axle at 10 − 9.4 = 0.6 m.
    expect(generation.plan!.startGlobal.x).toBeCloseTo(0.6, 6);
    expect(generation.plan!.incrementAxis).toBe("X");
    expect(generation.plan!.increment).toBeCloseTo(1, 6);
  });

  it("reverses the increment when the movement direction is reversed", () => {
    const p = placement();
    const plan = planMovingDefinitions(classA, p, { ...movingSettings, direction: -1, incrementM: 0.5 });
    const generation = planGeneration(plan.definitions[0], classA, p, { ...movingSettings, direction: -1, incrementM: 0.5 }, DEFAULT_MAPPING, layout);
    expect(generation.plan!.increment).toBeCloseTo(-0.5, 6);
  });

  it("blocks generation when the coordinate mapping is rotated", () => {
    const p = placement();
    const plan = planMovingDefinitions(classA, p, movingSettings);
    const generation = planGeneration(plan.definitions[0], classA, p, movingSettings, { ...DEFAULT_MAPPING, rotationDeg: 30 }, layout);
    expect(generation.plan).toBeNull();
    expect(generation.diagnostics.some((d) => d.code === "generation-rotation")).toBe(true);
  });

  it("honours a permuted longitudinal axis and sign", () => {
    const p = placement({ longitudinalM: 10 });
    const plan = planMovingDefinitions(classA, p, movingSettings);
    const generation = planGeneration(
      plan.definitions[0],
      classA,
      p,
      movingSettings,
      { ...DEFAULT_MAPPING, longitudinalAxis: "Z", transverseAxis: "X", longitudinalSign: -1 },
      layout,
    );
    expect(generation.plan!.incrementAxis).toBe("Z");
    expect(generation.plan!.increment).toBeCloseTo(-1, 6);
    expect(generation.plan!.startGlobal.z).toBeCloseTo(-0.6, 6);
  });
});

describe("document generation", () => {
  it("produces a deterministic moving-load document", () => {
    const project = projectWith({});
    const first = generateDocument(project);
    const second = generateDocument(project);
    expect(first.text).toBe(second.text);
    expect(first.text).toContain("DEFINE MOVING LOAD");
    expect(first.text).toContain("LOAD GENERATION 12");
    expect(first.text).toContain("UNIT METER KN");
    expect(first.text).toContain("TYPE 1 LOAD 27 27 114 114 68 68 68 68 DISTANCE 1.1 3.2 1.2 4.3 3 3 3 WIDTH 2.3");
    expect(first.text).not.toMatch(/NaN|undefined|Infinity/);
  });

  it("round-trips through the parser without errors", () => {
    const project = projectWith({});
    const doc = generateDocument(project);
    const parsed = parseSyntax(doc.text);
    expect(parsed.document.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
    expect(parsed.document.movingDefinitions).toHaveLength(1);
    expect(parsed.document.movingDefinitions[0].loadsKN).toEqual([27, 27, 114, 114, 68, 68, 68, 68]);
    expect(parsed.document.generations).toHaveLength(1);
    expect(parsed.document.generations[0].positionCount).toBe(12);
    expect(parsed.document.generations[0].start.x).toBeCloseTo(6 - 9.4, 6);
    expect(parsed.document.staticCases).toHaveLength(0);
  });

  it("does not invent a load case when the static model is missing", () => {
    const project = projectWith({ workflow: "static" });
    const doc = generateDocument(project);
    expect(doc.text).not.toContain("JOINT LOAD");
    expect(doc.diagnostics.some((d) => d.code === "static-no-model")).toBe(true);
    const parsed = parseSyntax(doc.text);
    expect(parsed.document.staticCases).toHaveLength(0);
  });

  it("emits a valid static case against the sample grillage", () => {
    const project = projectWith({ workflow: "static", model: sampleModel(), placements: [placement({ longitudinalM: 12 })] });
    const doc = generateDocument(project);
    expect(doc.staticPlan).toBeDefined();
    const planCase = doc.staticPlan!.cases[0];
    expect(planCase.valid).toBe(true);
    expect(planCase.nodeLoads.length).toBeGreaterThan(4);
    const totalFy = planCase.nodeLoads.reduce((acc, n) => acc + n.fy, 0);
    expect(totalFy).toBeCloseTo(-554, 2);
    const parsed = parseSyntax(doc.text);
    const staticCase = parsed.document.staticCases[0];
    expect(staticCase).toBeDefined();
    expect(staticCase.nodeLoads.length).toBe(planCase.nodeLoads.length);
    const parsedTotal = staticCase.nodeLoads.reduce((acc, n) => acc + n.fy, 0);
    expect(parsedTotal).toBeCloseTo(-554, 2);
  });

  it("uses the vertical global axis for static joint forces", () => {
    // Model expressed in the same global frame as the mapping: deck X→global X,
    // deck Z→global Y, deck Y (elevation)→global Z.
    const base = sampleModel();
    const rotated = {
      ...base,
      nodes: base.nodes.map((node) => ({ id: node.id, x: node.x, y: node.z, z: 0 })),
    };
    const project = projectWith({
      workflow: "static",
      model: rotated,
      placements: [placement({ longitudinalM: 12 })],
      settings: { coordMapping: { ...DEFAULT_MAPPING, verticalAxis: "Z", transverseAxis: "Y" } },
    });
    const doc = generateDocument(project);
    expect(doc.text).toContain("FZ -");
    expect(doc.text).not.toMatch(/FY -/);
  });

  it("warns instead of wrapping long lines", () => {
    const project = projectWith({ settings: { maxLineLength: 40 } });
    const doc = generateDocument(project);
    expect(doc.diagnostics.some((d) => d.code === "long-line")).toBe(true);
    expect(doc.text).toContain("TYPE 1 LOAD 27 27 114 114 68 68 68 68 DISTANCE 1.1 3.2 1.2 4.3 3 3 3 WIDTH 2.3");
  });
});

describe("load transfer", () => {
  const model = sampleModel();
  const ctx = buildTransferContext(model, DEFAULT_MAPPING);

  it("maps model joints into deck coordinates", () => {
    expect(ctx.nodes).toHaveLength(17 * 7);
    const node = ctx.nodeById.get(1)!;
    expect(node.xd).toBeCloseTo(0, 9);
    expect(node.zd).toBeCloseTo(-5.4, 9);
  });

  it("accepts an exact joint inside the tolerance and rejects a point outside it", () => {
    const exact = transferLoad(ctx, { xd: 0, zd: -5.4 }, 100);
    expect(exact.contributions).toEqual([{ node: 1, loadKN: 100, weight: 1 }]);
    const miss = transferLoad({ ...ctx, method: "exact-node" }, { xd: 1.2, zd: -5.4 }, 100);
    expect(miss.error?.code).toBe("no-joint-at-position");
    expect(miss.contributions).toHaveLength(0);
  });

  it("splits a load along a member by lever rule", () => {
    // Member 1 connects joints 1 (0,−5.4) and 2 (0,−3.6) — a quarter point.
    const result = transferLoad({ ...ctx, method: "two-node-lever" }, { xd: 0, zd: -4.95 }, 100);
    expect(result.error).toBeUndefined();
    const total = result.contributions.reduce((a, c) => a + c.loadKN, 0);
    expect(total).toBeCloseTo(100, 6);
    const joint1 = result.contributions.find((c) => c.node === 1)!;
    expect(joint1.loadKN).toBeCloseTo(75, 1);
    const joint2 = result.contributions.find((c) => c.node === 2)!;
    expect(joint2.loadKN).toBeCloseTo(25, 1);
  });

  it("rejects lever transfer when the point is off the member axis", () => {
    const result = transferLoad({ ...ctx, method: "two-node-lever" }, { xd: 1.25, zd: -4.5 }, 100);
    expect(result.error?.code).toBe("off-member");
  });

  it("distributes a load by bilinear shape functions inside a quad", () => {
    const result = transferLoad({ ...ctx, method: "four-node-bilinear" }, { xd: 1.25, zd: -4.5 }, 100);
    expect(result.error).toBeUndefined();
    expect(result.contributions).toHaveLength(4);
    const total = result.contributions.reduce((a, c) => a + c.loadKN, 0);
    expect(total).toBeCloseTo(100, 6);
    result.contributions.forEach((c) => expect(c.loadKN).toBeCloseTo(25, 6));
  });

  it("preserves the applied load at a quad centre", () => {
    const result = transferLoad({ ...ctx, method: "four-node-bilinear" }, { xd: 5, zd: -2.7 }, 80);
    expect(result.contributions.reduce((a, c) => a + c.loadKN, 0)).toBeCloseTo(80, 6);
  });

  it("inverts the bilinear map consistently", () => {
    const quad = ctx.quads[0];
    const natural = invertQuad(quad.points, quad.points[1]);
    expect(natural).not.toBeNull();
    expect(natural!.xi).toBeCloseTo(1, 6);
    expect(natural!.eta).toBeCloseTo(-1, 6);
  });

  it("never snaps silently with the exact-joint method", () => {
    const result = transferLoad({ ...ctx, method: "exact-node" }, { xd: 1.25, zd: -5.4 }, 100);
    expect(result.contributions).toHaveLength(0);
    expect(result.error).toBeDefined();
  });
});

describe("static cases", () => {
  it("marks the case invalid when a wheel falls outside the model", () => {
    const plan = planStaticCases({
      vehicles,
      placements: [placement({ vehicleId: wheeled.id, longitudinalM: 60 })],
      model: sampleModel(),
      mapping: DEFAULT_MAPPING,
      layout,
      settings: { ...defaultSettings(), workflow: "static" },
      movingImpact: { enabled: false, factor: 0, note: "" },
    });
    expect(plan.cases[0].valid).toBe(false);
    expect(plan.cases[0].lines.join("\n")).not.toContain("JOINT LOAD");
  });

  it("does not silently snap when the nearest-joint tolerance is exceeded", () => {
    const plan = planStaticCases({
      vehicles,
      placements: [placement({ vehicleId: wheeled.id, longitudinalM: 60 })],
      model: { ...sampleModel(), loadTransfer: "nearest-node" },
      mapping: DEFAULT_MAPPING,
      layout,
      settings: { ...defaultSettings(), workflow: "static" },
      movingImpact: { enabled: false, factor: 0, note: "" },
    });
    expect(plan.cases[0].transfers.every((t) => !t.error)).toBe(true);
    expect(plan.cases[0].transfers.some((t) => t.warning)).toBe(true);
  });

  it("applies the user impact multiplier to every wheel load", () => {
    const plan = planStaticCases({
      vehicles,
      placements: [placement({ vehicleId: wheeled.id })],
      model: sampleModel(),
      mapping: DEFAULT_MAPPING,
      layout,
      settings: { ...defaultSettings(), workflow: "static" },
      movingImpact: { enabled: true, factor: 0.25, note: "test" },
    });
    expect(plan.cases[0].totalAppliedKN).toBeCloseTo(1250, 3);
  });
});

describe("parser robustness", () => {
  it("preserves unsupported lines and reports line numbers", () => {
    const parsed = parseSyntax("STAAD SPACE\nUNIT METER KN\nDEFINE LANE WIDTH 3\nLOAD 5 LOADTYPE LIVE TITLE X\nJOINT LOAD\n1 FY -10\n");
    expect(parsed.document.unsupported.length).toBeGreaterThanOrEqual(1);
    expect(parsed.document.unsupported[0].line).toBe(3);
    expect(parsed.document.unsupported[0].text).toContain("DEFINE LANE");
    expect(parsed.document.status).toBe("partial");
  });

  it("reports a definition without placement rather than inventing one", () => {
    const parsed = parseSyntax("DEFINE MOVING LOAD\nTYPE 1 LOAD 40 40 DISTANCE 3.0\n");
    expect(parsed.document.movingDefinitions).toHaveLength(1);
    expect(parsed.document.generations).toHaveLength(0);
    expect(parsed.document.diagnostics.some((d) => d.code === "definition-without-placement")).toBe(true);
  });

  it("reports a generation without a definition", () => {
    const parsed = parseSyntax("LOAD GENERATION 5\nTYPE 7 0 0 0 XINC 1\n");
    expect(parsed.document.generations).toHaveLength(1);
    expect(parsed.document.diagnostics.some((d) => d.code === "generation-without-definition")).toBe(true);
  });

  it("handles unknown keywords instead of guessing", () => {
    const parsed = parseSyntax("DEFINE MOVING LOAD\nTYPE 1 LOAD 40 40 DISTANCE 3.0 OFFSET 1.0\n");
    expect(parsed.document.diagnostics.some((d) => d.code === "moving-unknown-keyword")).toBe(true);
    expect(parsed.document.movingDefinitions).toHaveLength(0);
  });

  it("ignores comments and blank lines but keeps them", () => {
    const source = "* a comment\n\nDEFINE MOVING LOAD\n\nTYPE 1 LOAD 40 40 DISTANCE 3.0\n* trailing\n";
    const parsed = parseSyntax(source);
    expect(parsed.document.comments).toHaveLength(2);
    expect(parsed.document.movingDefinitions).toHaveLength(1);
    expect(parsed.document.movingDefinitions[0].sourceLineNumber).toBe(5);
    expect(parsed.document.status).toBe("valid");
  });

  it("validates that a moving anchor load case is not treated as a static case", () => {
    const source = [
      "LOAD 100 LOADTYPE LIVE TITLE IRC MOVING LOAD",
      "DEFINE MOVING LOAD",
      "TYPE 1 LOAD 40 40 DISTANCE 3.0",
      "LOAD GENERATION 6",
      "TYPE 1 0 0 0 XINC 1",
    ].join("\n");
    const parsed = parseSyntax(source);
    expect(parsed.document.staticCases).toHaveLength(0);
    expect(parsed.document.diagnostics.some((d) => d.severity === "error")).toBe(false);
  });

  it("parses UNIT statements and flags unsupported units", () => {
    const metric = parseSyntax("UNIT METER KN\n");
    expect(metric.document.units).toEqual({ length: "METER", force: "KN" });
    const imperial = parseSyntax("UNIT FEET KIP\n");
    expect(imperial.document.diagnostics.some((d) => d.code === "unsupported-units")).toBe(true);
  });

  it("reports malformed joint coordinates", () => {
    const parsed = parseSyntax("JOINT COORDINATES\n1 0 0\n");
    expect(parsed.model.diagnostics.some((d) => d.message.includes("groups of 4"))).toBe(true);
  });

  it("keeps multi-group joint lines", () => {
    const parsed = parseSyntax("JOINT COORDINATES\n1 0 0 0 2 2.5 0 0\n3 5 0 0\n");
    expect(parsed.model.nodes).toHaveLength(3);
    expect(parsed.model.nodes[2]).toEqual({ id: 3, x: 5, y: 0, z: 0 });
  });

  it("tokenises Windows line endings without shifting line numbers", () => {
    const lines = tokenizeSource("a\r\nb\r\nc");
    expect(lines.map((l) => l.number)).toEqual([1, 2, 3]);
  });
});

describe("scene reconstruction", () => {
  it("matches a library vehicle from a definition and places it from the generation", () => {
    const source = [
      "DEFINE MOVING LOAD",
      "TYPE 1 LOAD 27 27 114 114 68 68 68 68 DISTANCE 1.1 3.2 1.2 4.3 3.0 3.0 3.0 WIDTH 2.3",
      "LOAD GENERATION 20",
      "TYPE 1 2 0 2.25 XINC 1",
    ].join("\n");
    const parsed = parseSyntax(source);
    const reconstruction = reconstructScene(parsed.document, parsed.model, { ...newProject(), vehicles });
    expect(reconstruction.placements).toHaveLength(1);
    expect(reconstruction.placements[0].longitudinalM).toBeCloseTo(2, 6);
    expect(reconstruction.placements[0].transverseM).toBeCloseTo(2.25, 6);
    expect(reconstruction.vehicles.find((v) => v.id === reconstruction.placements[0].vehicleId)?.name).toBe(classA.name);
    expect(reconstruction.moving.positionCount).toBe(20);
    expect(reconstruction.partial).toBe(false);
  });

  it("creates an imported vehicle with unknown transverse geometry when nothing matches", () => {
    const source = "DEFINE MOVING LOAD\nTYPE 4 LOAD 55 90 DISTANCE 2.5\nLOAD GENERATION 3\nTYPE 4 0 0 0 XINC 1\n";
    const parsed = parseSyntax(source);
    const reconstruction = reconstructScene(parsed.document, parsed.model, { ...newProject(), vehicles });
    expect(reconstruction.placements).toHaveLength(1);
    const vehicle = reconstruction.vehicles.find((v) => v.id === reconstruction.placements[0].vehicleId)!;
    expect(vehicle.provenance).toBe("imported");
    expect(vehicle.axles.every((a) => a.trackSpacingM === 0)).toBe(true);
    expect(reconstruction.diagnostics.some((d) => d.code === "recon-missing-gauge")).toBe(true);
    expect(reconstruction.partial).toBe(true);
  });

  it("does not place anything when only a definition is supplied", () => {
    const parsed = parseSyntax("DEFINE MOVING LOAD\nTYPE 1 LOAD 40 40 DISTANCE 3.0\n");
    const reconstruction = reconstructScene(parsed.document, parsed.model, { ...newProject(), vehicles });
    expect(reconstruction.placements).toHaveLength(0);
    expect(reconstruction.summary.join(" ")).toMatch(/no LOAD GENERATION/i);
  });

  it("adopts a parsed structural model and chooses a transfer method", () => {
    const parsed = parseSyntax("JOINT COORDINATES\n1 0 0 0 2 2.5 0 0 3 2.5 0 2.5 4 0 0 2.5\nELEMENT INCIDENCES SHELL\n1 1 2 3 4\n");
    const reconstruction = reconstructScene(parsed.document, parsed.model, { ...newProject(), vehicles });
    expect(reconstruction.model?.nodes).toHaveLength(4);
    expect(reconstruction.model?.quads).toHaveLength(1);
    expect(reconstruction.model?.loadTransfer).toBe("four-node-bilinear");
  });

  it("reports partial reconstruction when unsupported lines exist", () => {
    const parsed = parseSyntax("DEFINE LANE WIDTH 3.0\nDEFINE MOVING LOAD\nTYPE 1 LOAD 40 40 DISTANCE 3.0\n");
    const reconstruction = reconstructScene(parsed.document, parsed.model, { ...newProject(), vehicles });
    expect(reconstruction.partial).toBe(true);
  });
});

describe("full project round trip", () => {
  it("regenerates identical syntax after exporting and importing the project", () => {
    const project = sampleProject();
    const doc = generateDocument(project);
    const parsed = parseSyntax(doc.text);
    if (project.settings.workflow === "static") {
      expect(parsed.document.staticCases.length).toBe(doc.staticPlan!.cases.filter((c) => c.valid).length);
      const expected = doc.staticPlan!.cases.filter((c) => c.valid).reduce((acc, c) => acc + c.nodeLoads.length, 0);
      const actual = parsed.document.staticCases.reduce((acc, c) => acc + c.nodeLoads.length, 0);
      expect(actual).toBe(expected);
    }
  });

  it("keeps generated values deterministic under float noise", () => {
    const project = sampleProject();
    const doc = generateDocument(project);
    expect(doc.text).not.toMatch(/\d\.\d{7,}/);
    expect(doc.text.split("\n").every((line) => !line.match(/\.\d{5,}$/))).toBe(true);
  });

  it("rounds values only at output", () => {
    expect(round(0.1 + 0.2, 3)).toBe(0.3);
    expect(round(-0.0004, 3)).toBe(0);
  });
});
