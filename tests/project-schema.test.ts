import { describe, expect, it } from "vitest";
import { newProject, sampleProject, toProjectFile } from "../src/lib/project";
import { parseProjectFile } from "../src/lib/projectSchema";

const exported = () => JSON.parse(JSON.stringify(toProjectFile(sampleProject())));

describe("project file validation", () => {
  it("round-trips the sample project", () => {
    const result = parseProjectFile(JSON.stringify(toProjectFile(sampleProject())));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.file.placements).toHaveLength(3);
    expect(result.file.vehicles.map((v) => v.shortName)).toContain("70R tracked");
  });

  it("rejects text that is not JSON", () => {
    const result = parseProjectFile("JOINT COORDINATES");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]).toContain("not valid JSON");
  });

  it("reports the path of a malformed field", () => {
    const file = exported();
    file.deck.spanM = "thirty";
    const result = parseProjectFile(JSON.stringify(file));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]).toContain("deck.spanM");
  });

  it("rejects a non-positive span", () => {
    const file = exported();
    file.deck.spanM = 0;
    expect(parseProjectFile(JSON.stringify(file)).ok).toBe(false);
  });

  it("rejects an unknown schema version before field validation", () => {
    const file = exported();
    file.schemaVersion = 2;
    const result = parseProjectFile(JSON.stringify(file));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]).toContain("schema version 2");
  });

  it("rejects a placement pointing at a missing vehicle", () => {
    const file = exported();
    file.placements[0].vehicleId = "vehicle-that-does-not-exist";
    const result = parseProjectFile(JSON.stringify(file));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]).toContain("missing vehicle");
  });

  it("rejects an axle whose wheel loads do not sum to the axle load", () => {
    const file = exported();
    file.vehicles[0].axles[0].wheelLoadsKN = [10, 10];
    file.vehicles[0].axles[0].loadKN = 27;
    const result = parseProjectFile(JSON.stringify(file));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]).toContain("wheel loads sum");
  });

  it("rejects a repeated global axis in the mapping", () => {
    const file = exported();
    file.settings.coordMapping.transverseAxis = "X";
    const result = parseProjectFile(JSON.stringify(file));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]).toContain("same global axis twice");
  });

  it("rejects a member referencing a missing joint", () => {
    const file = exported();
    file.model.members[0].endNode = 99999;
    const result = parseProjectFile(JSON.stringify(file));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]).toContain("missing joint");
  });

  it("accepts a fresh project with no placements", () => {
    const file = toProjectFile(newProject());
    file.placements = [];
    expect(parseProjectFile(JSON.stringify(file)).ok).toBe(true);
  });

  it("rejects duplicate placement ids", () => {
    const file = exported();
    file.placements[1].id = file.placements[0].id;
    const result = parseProjectFile(JSON.stringify(file));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]).toContain("duplicate placement id");
  });

  it("limits the issue list so the message stays readable", () => {
    const file = exported();
    for (const vehicle of file.vehicles) {
      for (const axle of vehicle.axles) axle.loadKN = "not a number";
    }
    const result = parseProjectFile(JSON.stringify(file));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.length).toBeLessThanOrEqual(9);
    expect(result.issues[result.issues.length - 1]).toMatch(/more$/);
  });
});
