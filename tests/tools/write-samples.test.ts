/**
 * Developer utility: regenerates the sample files in samples/ from the shared
 * model so the checked-in files can never drift from the generators.
 * Run with: npx vitest run tests/tools/write-samples.test.ts
 */
import { describe, it } from "vitest";
import { writeFileSync } from "node:fs";
import { generateDocument } from "../../src/lib/syntax/document";
import { sampleProject, toProjectFile, newProject } from "../../src/lib/project";
import { parseStructuralModel } from "../../src/lib/syntax/model";
import { tokenizeSource } from "../../src/lib/syntax/tokenize";
import { presetVehicles } from "../../src/lib/vehicles";

const modelText = `JOINT COORDINATES
1 0 0 -5.4 2 0 0 -3.6 3 0 0 -1.8 4 0 0 0 5 0 0 1.8 6 0 0 3.6 7 0 0 5.4
8 2.5 0 -5.4 9 2.5 0 -3.6 10 2.5 0 -1.8 11 2.5 0 0 12 2.5 0 1.8 13 2.5 0 3.6 14 2.5 0 5.4
15 5 0 -5.4 16 5 0 -3.6 17 5 0 -1.8 18 5 0 0 19 5 0 1.8 20 5 0 3.6 21 5 0 5.4
MEMBER INCIDENCES
1 1 2 2 2 3 3 3 4 4 4 5 5 5 6 6 6 7
7 8 9 8 9 10 9 10 11 10 11 12 11 12 13 12 13 14
13 15 16 14 16 17 15 17 18 16 18 19 17 19 20 18 20 21
`;

describe("sample files", () => {
  it.skipIf(process.env.WRITE_SAMPLES !== "1")("writes deterministic sample output", () => {
    const moving = { ...newProject(), settings: { ...newProject().settings, projectName: "Moving-load sample: 40 m two-lane bridge" } };
    moving.placements = [
      { ...sampleProject().placements[0] },
      { ...sampleProject().placements[1] },
    ];
    moving.vehicles = presetVehicles();
    const movingDoc = generateDocument(moving);
    writeFileSync("samples/irc-moving-load-sample.std", movingDoc.text + "\n");

    const staticProject = sampleProject();
    const staticDoc = generateDocument(staticProject);
    writeFileSync("samples/irc-static-placement-sample.std", staticDoc.text + "\n");

    const parsedModel = parseStructuralModel(tokenizeSource(modelText));
    writeFileSync(
      "samples/model-fragment.txt",
      modelText +
        `\n* Parsed: ${parsedModel.nodes.length} joints, ${parsedModel.members.length} members\n`,
    );

    const file = toProjectFile(staticProject);
    file.savedAt = "2026-01-01T00:00:00.000Z";
    writeFileSync("samples/sample-project.json", JSON.stringify(file, null, 2) + "\n");
  });
});
