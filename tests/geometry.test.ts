import { describe, expect, it } from "vitest";
import type { VehiclePlacement } from "../src/types";
import {
  computeClearance,
  deckLayout,
  deckToLocal,
  edgeBoundaryZd,
  laneCentreZd,
  localToDeck,
  referenceOffset,
  resolvePlacement,
  vehicleExtents,
  vehicleFootprint,
  vehicleLocalLoads,
  vehicleTotalLoadKN,
} from "../src/lib/geometry";
import { defaultDeck } from "../src/lib/project";
import { presetVehicles } from "../src/lib/vehicles";
import { globalToDeck, deckToGlobal, downwardForceComponents, mappingIssues } from "../src/lib/coords";
import { DEFAULT_MAPPING } from "../src/lib/project";
import { round } from "../src/lib/units";

const deck = { ...defaultDeck() };
const layout = deckLayout(deck);
const vehicles = presetVehicles();
const classA = vehicles.find((v) => v.id === "preset-irc-class-a")!;
const wheeled = vehicles.find((v) => v.id === "preset-irc-70r-wheeled")!;
const tracked = vehicles.find((v) => v.id === "preset-irc-70r-tracked")!;

function placement(patch: Partial<VehiclePlacement>): VehiclePlacement {
  return {
    id: "p1",
    vehicleId: wheeled.id,
    label: "V1",
    longitudinalM: 8,
    transverseM: 0,
    rotationDeg: 0,
    referencePoint: "vehicle-centre",
    mode: "free",
    locked: false,
    visible: true,
    color: "#38bdf8",
    ...patch,
  };
}

describe("deck layout", () => {
  it("derives carriageway from barriers, footpaths and kerbs", () => {
    expect(layout.leftDeckEdgeZd).toBeCloseTo(6, 9);
    expect(layout.rightDeckEdgeZd).toBeCloseTo(-6, 9);
    expect(layout.leftBarrierInnerZd).toBeCloseTo(5.5, 9);
    expect(layout.leftCarriagewayEdgeZd).toBeCloseTo(4.5, 9);
    expect(layout.rightCarriagewayEdgeZd).toBeCloseTo(-4.5, 9);
    expect(layout.carriagewayWidthM).toBeCloseTo(9, 9);
  });

  it("splits the carriageway into equal lanes from the +Zd edge", () => {
    expect(layout.lanes).toHaveLength(2);
    expect(layout.lanes[0].widthM).toBeCloseTo(4.5, 9);
    expect(laneCentreZd(layout, 0)).toBeCloseTo(2.25, 9);
    expect(laneCentreZd(layout, 1)).toBeCloseTo(-2.25, 9);
  });

  it("honours a custom lane width list", () => {
    const custom = deckLayout({ ...deck, laneWidthMode: "custom", laneWidthsM: [5.5, 3.5] });
    expect(custom.lanes[0].widthM).toBeCloseTo(5.5, 9);
    expect(custom.lanes[1].widthM).toBeCloseTo(3.5, 9);
  });

  it("resolves each edge datum independently", () => {
    expect(edgeBoundaryZd(layout, "left", "carriageway")).toBeCloseTo(4.5, 9);
    expect(edgeBoundaryZd(layout, "left", "barrier")).toBeCloseTo(5.5, 9);
    expect(edgeBoundaryZd(layout, "left", "deck-edge")).toBeCloseTo(6, 9);
    expect(edgeBoundaryZd(layout, "right", "carriageway")).toBeCloseTo(-4.5, 9);
  });
});

describe("vehicle reference points", () => {
  it("uses the 70R wheeled axle train for the vehicle centre", () => {
    const ext = vehicleExtents(wheeled);
    expect(ext.uMin).toBeCloseTo(0, 9);
    expect(ext.uMax).toBeCloseTo(13.4, 9);
    const ref = referenceOffset(wheeled, "vehicle-centre");
    expect(ref.xd).toBeCloseTo(6.7, 9);
    expect(ref.zd).toBeCloseTo(0, 9);
  });

  it("measures the outer-wheel reference at the declared half width", () => {
    expect(referenceOffset(wheeled, "outer-wheel-plus").zd).toBeCloseTo(1.45, 9);
    expect(referenceOffset(wheeled, "outer-wheel-minus").zd).toBeCloseTo(-1.45, 9);
  });

  it("places the reference axle at the first axle line", () => {
    expect(referenceOffset(classA, "reference-axle").xd).toBeCloseTo(0, 9);
  });
});

describe("vehicle loads", () => {
  it("reproduces the IRC Class A train", () => {
    expect(classA.axles.map((a) => a.loadKN)).toEqual([27, 27, 114, 114, 68, 68, 68, 68]);
    expect(vehicleTotalLoadKN(classA)).toBeCloseTo(554, 6);
    const offsets = classA.axles.map((a) => a.longitudinalOffsetM);
    expect(offsets.map((o) => round(o, 6))).toEqual([0, 1.1, 4.3, 5.5, 9.8, 12.8, 15.8, 18.8]);
  });

  it("reproduces the IRC 70R wheeled vehicle", () => {
    expect(vehicleTotalLoadKN(wheeled)).toBeCloseTo(1000, 6);
    expect(wheeled.axles.map((a) => round(a.longitudinalOffsetM, 6))).toEqual([0, 3.96, 5.48, 7.61, 8.98, 12.03, 13.4]);
  });

  it("reproduces the 70R tracked vehicle", () => {
    expect(vehicleTotalLoadKN(tracked)).toBeCloseTo(700, 6);
    expect(tracked.tracks[0].widthM).toBeCloseTo(0.84, 9);
    expect(Math.abs(tracked.tracks[0].transverseCentreM - tracked.tracks[1].transverseCentreM)).toBeCloseTo(2.06, 9);
  });

  it("splits axle loads equally between the two wheel lines", () => {
    const loads = vehicleLocalLoads(wheeled);
    expect(loads).toHaveLength(14);
    const axle4 = loads.filter((l) => l.axleId === wheeled.axles[3].id);
    expect(axle4).toHaveLength(2);
    expect(axle4[0].loadKN).toBeCloseTo(85, 9);
    expect(axle4[1].loadKN).toBeCloseTo(85, 9);
    expect(axle4[0].v * axle4[1].v).toBeLessThan(0);
  });

  it("discretises tracks into equal slices whose loads sum to the track load", () => {
    const slices = vehicleLocalLoads(tracked, 7);
    expect(slices).toHaveLength(14);
    const plus = slices.filter((s) => s.axleId === "track-plus");
    expect(plus).toHaveLength(7);
    expect(plus.reduce((acc, s) => acc + s.loadKN, 0)).toBeCloseTo(350, 9);
  });
});

describe("placement solving", () => {
  it("aligns the vehicle centre to a lane centre", () => {
    const p = placement({ mode: "lane", lane: { laneIndex: 1 } });
    const resolved = resolvePlacement(wheeled, p, layout);
    expect(resolved.transverseM).toBeCloseTo(-2.25, 9);
  });

  it("reproduces an edge clearance to the outer wheel edge exactly", () => {
    const p = placement({ mode: "edge", edge: { side: "left", datum: "carriageway", clearanceM: 1.2 } });
    const resolved = resolvePlacement(wheeled, p, layout);
    const fp = vehicleFootprint(wheeled, p, layout);
    expect(layout.leftCarriagewayEdgeZd - fp.bounds.maxZd).toBeCloseTo(1.2, 9);
    expect(resolved.transverseM).toBeCloseTo(4.5 - 1.2 - 1.45, 9);
  });

  it("reproduces an edge clearance measured from the barrier inner face", () => {
    const p = placement({ mode: "edge", edge: { side: "right", datum: "barrier", clearanceM: 0.6 } });
    const fp = vehicleFootprint(wheeled, p, layout);
    expect(fp.bounds.minZd - layout.rightBarrierInnerZd).toBeCloseTo(0.6, 9);
  });

  it("includes the wheel contact-patch width in clearance geometry", () => {
    const p = placement({ mode: "edge", edge: { side: "left", datum: "carriageway", clearanceM: 1.2 } });
    const fp = vehicleFootprint(wheeled, p, layout);
    const wheelEdge = Math.max(...fp.wheels.map((w) => Math.max(...w.corners.map((c) => c.zd))));
    expect(wheelEdge).toBeCloseTo(4.5 - 1.2, 6);
    expect(fp.bounds.maxZd).toBeCloseTo(4.5 - 1.2, 6);
  });
});

describe("footprints and clearances", () => {
  it("reports an in-lane vehicle as inside the carriageway", () => {
    const p = placement({ mode: "lane", lane: { laneIndex: 1 } });
    const fp = vehicleFootprint(wheeled, p, layout);
    const report = computeClearance(fp, layout);
    expect(report.insideCarriageway).toBe(true);
    expect(report.insideDeck).toBe(true);
    // Vehicle half width 1.45 m in lane 2 (centre −2.25 m) → outer edge −3.70 m;
    // right barrier inner face is at −5.50 m, so 1.80 m to the barrier.
    expect(report.toRightBarrierM).toBeCloseTo(1.8, 6);
    expect(fp.bounds.minZd - layout.rightCarriagewayEdgeZd).toBeCloseTo(0.8, 6);
  });

  it("flags a barrier-interfering placement without moving it", () => {
    const p = placement({ mode: "free", transverseM: 5.2 });
    const fp = vehicleFootprint(wheeled, p, layout);
    const report = computeClearance(fp, layout);
    expect(report.interferesWithBarrier).toBe(true);
    expect(report.insideDeck).toBe(false);
    expect(p.transverseM).toBe(5.2);
  });

  it("flags a vehicle beyond the end abutment", () => {
    const p = placement({ longitudinalM: 29, mode: "free" });
    const fp = vehicleFootprint(wheeled, p, layout);
    expect(computeClearance(fp, layout).beyondEndM).toBeLessThan(0);
  });

  it("rotates the footprint without changing its area", () => {
    const base = vehicleFootprint(wheeled, placement({ rotationDeg: 0 }), layout);
    const rotated = vehicleFootprint(wheeled, placement({ rotationDeg: 90 }), layout);
    const area = (fp: typeof base) => {
      const xs = fp.bodyCorners.map((c) => c.xd);
      const zs = fp.bodyCorners.map((c) => c.zd);
      return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...zs) - Math.min(...zs));
    };
    expect(area(rotated)).toBeCloseTo(area(base), 6);
  });
});

describe("coordinate transforms", () => {
  it("round-trips deck coordinates through the global mapping", () => {
    const mapping = { ...DEFAULT_MAPPING, originXM: 12, originYM: 1.5, originZM: -3, rotationDeg: 28 };
    const original = { xd: 7.25, zd: -2.1, yd: 0 };
    const global = deckToGlobal(original, mapping);
    const back = globalToDeck(global, mapping);
    expect(back.xd).toBeCloseTo(original.xd, 9);
    expect(back.zd).toBeCloseTo(original.zd, 9);
    expect(back.yd).toBeCloseTo(original.yd, 9);
  });

  it("maps a 90° deck rotation onto the global axes", () => {
    const mapping = { ...DEFAULT_MAPPING, rotationDeg: 90 };
    const global = deckToGlobal({ xd: 2, zd: 0, yd: 0 }, mapping);
    expect(global.x).toBeCloseTo(0, 9);
    expect(global.z).toBeCloseTo(2, 9);
  });

  it("uses the sign conventions for a permuted mapping", () => {
    const mapping = { ...DEFAULT_MAPPING, longitudinalAxis: "Z" as const, transverseAxis: "X" as const, longitudinalSign: -1 as const };
    const global = deckToGlobal({ xd: 3, zd: 1, yd: 0 }, mapping);
    expect(global.z).toBeCloseTo(-3, 9);
    expect(global.x).toBeCloseTo(1, 9);
  });

  it("applies vertical loads downward in global space", () => {
    expect(downwardForceComponents(100, DEFAULT_MAPPING)).toEqual({ fx: 0, fy: -100, fz: 0 });
    const zVertical = { ...DEFAULT_MAPPING, verticalAxis: "Z" as const, transverseAxis: "Y" as const };
    expect(downwardForceComponents(100, zVertical)).toEqual({ fx: 0, fy: 0, fz: -100 });
  });

  it("rejects a mapping that reuses an axis", () => {
    const issues = mappingIssues({ ...DEFAULT_MAPPING, transverseAxis: "X" });
    expect(issues.join(" ")).toMatch(/three different global axes/);
  });

  it("converts deck points to local vehicle coordinates and back", () => {
    const p = placement({ longitudinalM: 10, transverseM: 1.5, rotationDeg: 15 });
    const ref = referenceOffset(wheeled, "vehicle-centre");
    const local = { xd: 3.2, zd: 0.7 };
    const deckPoint = localToDeck(local, ref, p);
    const back = deckToLocal(deckPoint, ref, p);
    expect(back.xd).toBeCloseTo(local.xd, 9);
    expect(back.zd).toBeCloseTo(local.zd, 9);
  });
});
