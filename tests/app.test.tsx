import { beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import App from "../src/App";
import { emptyProject, newProject, sampleProject, toProjectFile } from "../src/lib/project";
import { currentProject, useStudio } from "../src/store/studio";
import { generateDocument } from "../src/lib/syntax/document";
import { colorForIndex } from "../src/lib/ids";

/**
 * Integration coverage for the parts of the flow that do not need a real browser
 * event pipeline: state changes must flow through the shared model into the
 * generated syntax, and every tab must render without errors.
 */

function resetStore() {
  useStudio.getState().loadProject(newProject());
  useStudio.setState({
    activeTab: "placement",
    selectedPlacementId: null,
    selectedVehicleId: "preset-irc-class-a",
    syntaxMode: "generated",
    syntaxDraft: "",
    importSource: "",
    importParsed: null,
    importReconstruction: null,
    past: [],
    future: [],
    savedAt: null,
    toast: null,
  });
  localStorage.clear();
}

beforeEach(() => {
  resetStore();
});

describe("application shell", () => {
  it("renders every main tab", () => {
    render(<App />);
    ["Vehicle Placement", "Vehicle Library", "Syntax Import", "Load Configuration", "Validation", "Project Settings"].forEach(
      (label) => {
        expect(screen.getByRole("button", { name: new RegExp(label) })).toBeInTheDocument();
      },
    );
  });

  it("renders the scaled deck plan with dimension annotations", () => {
    const { container } = render(<App />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(container.textContent).toContain("span 30 m");
    expect(container.textContent).toContain("carriageway 9 m");
  });

  it("shows the generated syntax for the default project", () => {
    const { container } = render(<App />);
    expect(container.textContent).toContain("DEFINE MOVING LOAD");
    expect(container.textContent).toContain("LOAD GENERATION");
  });

  it("switches tabs without losing the project", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Vehicle Library/ }));
    expect(screen.getByRole("button", { name: /New custom/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Project Settings/ }));
    expect(screen.getAllByLabelText("Project name").length).toBeGreaterThan(0);
  });
});

describe("shared model → syntax", () => {
  it("updates the generated coordinates when a placement is dragged", () => {
    render(<App />);
    const before = generateDocument(currentProject(useStudio.getState())).text;
    act(() => {
      const placement = useStudio.getState().placements[0];
      useStudio.getState().beginHistory();
      useStudio.getState().updatePlacement(placement.id, { longitudinalM: placement.longitudinalM + 4, mode: "free" }, { record: false });
    });
    const after = generateDocument(currentProject(useStudio.getState())).text;
    expect(after).not.toBe(before);
    expect(after).toMatch(/LOAD GENERATION/);
  });

  it("preserves an exact edge clearance through geometry edits", () => {
    act(() => {
      const state = useStudio.getState();
      state.addPlacement("preset-irc-70r-tracked", 6, 0, {
        mode: "edge",
        edge: { side: "left", datum: "carriageway", clearanceM: 1.2 },
      });
    });
    const project = currentProject(useStudio.getState());
    const placement = project.placements[project.placements.length - 1];
    act(() => {
      useStudio.getState().setDeck({ totalWidthM: 14 });
    });
    const updated = currentProject(useStudio.getState());
    const fp = generateDocument(updated);
    expect(fp.diagnostics.some((d) => d.code === "edge-clearance-mismatch")).toBe(false);
    expect(updated.placements.find((p) => p.id === placement.id)?.edge?.clearanceM).toBe(1.2);
  });

  it("generates a static case only after a model exists", () => {
    act(() => {
      useStudio.getState().setSettings({ workflow: "static" });
    });
    let doc = generateDocument(currentProject(useStudio.getState()));
    expect(doc.text).not.toContain("JOINT LOAD");
    act(() => {
      useStudio.getState().loadPresetSampleModel();
      useStudio.getState().addPlacement("preset-irc-class-a", 12, 2.25, {
        mode: "lane",
        lane: { laneIndex: 0 },
        referencePoint: "vehicle-centre",
      });
    });
    doc = generateDocument(currentProject(useStudio.getState()));
    expect(doc.text).toContain("JOINT LOAD");
    expect(doc.staticPlan?.cases.some((c) => c.valid)).toBe(true);
  });
});

describe("history", () => {
  it("undoes and redoes a placement change", () => {
    render(<App />);
    const original = useStudio.getState().placements[0].longitudinalM;
    act(() => {
      useStudio.getState().updatePlacement(useStudio.getState().placements[0].id, { longitudinalM: 21 });
    });
    expect(useStudio.getState().placements[0].longitudinalM).toBe(21);
    act(() => useStudio.getState().undo());
    expect(useStudio.getState().placements[0].longitudinalM).toBe(original);
    act(() => useStudio.getState().redo());
    expect(useStudio.getState().placements[0].longitudinalM).toBe(21);
  });

  it("duplicates and deletes placements", () => {
    act(() => {
      const state = useStudio.getState();
      state.duplicatePlacement(state.placements[0].id);
    });
    expect(useStudio.getState().placements).toHaveLength(2);
    const copy = useStudio.getState().placements[1];
    expect(copy.label).not.toBe(useStudio.getState().placements[0].label);
    act(() => useStudio.getState().removePlacement(copy.id));
    expect(useStudio.getState().placements).toHaveLength(1);
  });
});

describe("library", () => {
  it("marks an edited preset as user-modified", () => {
    act(() => {
      const state = useStudio.getState();
      state.updateVehicle("preset-irc-class-a", { name: "Class A modified" });
    });
    const vehicle = useStudio.getState().vehicles.find((v) => v.id === "preset-irc-class-a")!;
    expect(vehicle.isBuiltIn).toBe(false);
    expect(vehicle.provenance).toBe("user-verified");
  });

  it("restores the reference preset", () => {
    act(() => {
      const state = useStudio.getState();
      state.updateVehicle("preset-irc-70r-wheeled", { widthM: 4 });
      state.restorePreset("preset-irc-70r-wheeled");
    });
    const vehicle = useStudio.getState().vehicles.find((v) => v.id === "preset-irc-70r-wheeled")!;
    expect(vehicle.widthM).toBeCloseTo(2.9, 6);
    expect(vehicle.provenance).toBe("reference-preset");
  });

  it("refuses to delete a definition that is placed", () => {
    act(() => {
      useStudio.getState().removeVehicle("preset-irc-70r-wheeled");
    });
    expect(useStudio.getState().vehicles.some((v) => v.id === "preset-irc-70r-wheeled")).toBe(true);
  });
});

describe("persistence", () => {
  it("round-trips a project through the JSON format, including coordinates", () => {
    act(() => {
      useStudio.getState().loadProject(sampleProject());
    });
    const file = toProjectFile(currentProject(useStudio.getState()));
    const json = JSON.stringify(file);
    act(() => {
      useStudio.getState().loadProject(emptyProject());
    });
    let result;
    act(() => {
      result = useStudio.getState().importProjectFile(json);
    });
    expect(result!.ok).toBe(true);
    const restored = useStudio.getState();
    expect(restored.placements).toHaveLength(file.placements.length);
    expect(restored.model.nodes).toHaveLength(file.model.nodes.length);
    expect(restored.settings.coordMapping).toEqual(file.settings.coordMapping);
    const regenerated = generateDocument(currentProject(restored));
    expect(regenerated.text).toBe(generateDocument(file as unknown as ReturnType<typeof currentProject>).text);
  });

  it("rejects a malformed project file", () => {
    let result;
    act(() => {
      result = useStudio.getState().importProjectFile("{\"nope\":true}");
    });
    expect(result!.ok).toBe(false);
  });

  it("saves and restores from browser storage", () => {
    act(() => {
      useStudio.getState().setSettings({ projectName: "Storage test" });
      useStudio.getState().saveLocal();
    });
    act(() => {
      useStudio.getState().loadProject(emptyProject());
    });
    let restored = false;
    act(() => {
      restored = useStudio.getState().restoreLocal();
    });
    expect(restored).toBe(true);
    expect(useStudio.getState().settings.projectName).toBe("Storage test");
  });
});

describe("import flow", () => {
  it("reconstructs a scene from pasted syntax and shows the result", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Syntax Import/ }));
    const example = screen.getByRole("button", { name: /Moving load, two lanes/ });
    fireEvent.click(example);
    const apply = screen.getByRole("button", { name: /Apply to scene/ });
    fireEvent.click(apply);
    const placements = useStudio.getState().placements;
    expect(placements.length).toBeGreaterThan(1);
    expect(useStudio.getState().importParsed?.movingDefinitions).toHaveLength(2);
  });

  it("blocks applying a source with blocking parse errors", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Syntax Import/ }));
    fireEvent.click(screen.getByRole("button", { name: /Partial and unsupported/ }));
    // Partial-but-valid sources are importable; a malformed definition is not.
    expect(screen.getByRole("button", { name: /Apply to scene/ })).toBeEnabled();
    const editor = screen.getByLabelText("Pasted STAAD.Pro syntax");
    fireEvent.change(editor, { target: { value: "DEFINE MOVING LOAD\nTYPE 1 LOAD 100 100 DISTANCE 2.0 2.0 2.0\n" } });
    expect(screen.getByRole("button", { name: /Apply to scene/ })).toBeDisabled();
  });
});

describe("validation surface", () => {
  it("lists the missing-model error for the static workflow", () => {
    act(() => {
      useStudio.getState().setSettings({ workflow: "static" });
      useStudio.getState().setTab("validation");
    });
    render(<App />);
    expect(screen.getByText(/static-placement workflow needs actual structural joints/i)).toBeInTheDocument();
  });

  it("reports barrier interference for an off-deck placement", () => {
    act(() => {
      const state = useStudio.getState();
      state.addPlacement("preset-irc-70r-wheeled", 10, 5.6, { mode: "free", color: colorForIndex(3) });
    });
    act(() => {
      useStudio.getState().setTab("validation");
    });
    render(<App />);
    expect(screen.getAllByText(/interferes with a barrier|extends outside the deck/i).length).toBeGreaterThan(0);
  });
});

describe("syntax editor", () => {
  it("preserves manual edits and marks the document out of sync", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const editor = screen.getByLabelText("Syntax draft editor");
    fireEvent.change(editor, { target: { value: "STAAD SPACE\n* hand written\nDEFINE MOVING LOAD\nTYPE 1 LOAD 1 2 3 DISTANCE 2\n" } });
    expect(useStudio.getState().syntaxMode).toBe("edited");
    expect(screen.getByText(/out of sync|edited — not in sync/i)).toBeInTheDocument();
    // The invalid count (3 loads, 1 distance) must be reported, not silently fixed.
    expect(within(document.body).getAllByText(/require 2 inter-load distances/i).length).toBeGreaterThan(0);
  });
});
