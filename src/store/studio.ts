import { create } from "zustand";
import type {
  DeckGeometry,
  Diagnostic,
  MovingLoadSettings,
  ParsedDocument,
  ProjectFile,
  ProjectSettings,
  StructuralModel,
  VehicleDefinition,
  VehiclePlacement,
} from "../types";
import {
  defaultDeck,
  defaultModel,
  defaultMoving,
  defaultSettings,
  emptyProject,
  fromProjectFile,
  newProject,
  sampleModel,
  sampleProject,
  toProjectFile,
  type ProjectData,
} from "../lib/project";
import { colorForIndex, nextId, nextVehicleLabel } from "../lib/ids";
import { parseProjectFile } from "../lib/projectSchema";
import { deckLayout } from "../lib/geometry";
import { reconstructScene, type Reconstruction } from "../lib/syntax/import";
import { cloneVehicle, customTemplate, presetVehicles } from "../lib/vehicles";
import { applyTheme, readStoredThemeMode, resolveTheme, storeThemeMode, type ThemeMode } from "../lib/theme";

export type TabId = "placement" | "library" | "import" | "loads" | "validation" | "settings";

export type SyntaxMode = "generated" | "edited" | "imported";

interface Snapshot {
  deck: DeckGeometry;
  vehicles: VehicleDefinition[];
  placements: VehiclePlacement[];
  model: StructuralModel;
  moving: MovingLoadSettings;
  settings: ProjectSettings;
}

export interface Toast {
  id: string;
  kind: "info" | "success" | "warning" | "error";
  message: string;
}

const STORAGE_KEY = "staad-irc-studio:project:v1";
const HISTORY_LIMIT = 60;

function snapshotOf(state: ProjectData): Snapshot {
  return {
    deck: state.deck,
    vehicles: state.vehicles,
    placements: state.placements,
    model: state.model,
    moving: state.moving,
    settings: state.settings,
  };
}

export interface StudioState extends ProjectData {
  activeTab: TabId;
  /** Appearance preference; not part of the project file or the undo history. */
  themeMode: ThemeMode;
  selectedPlacementId: string | null;
  selectedVehicleId: string | null;
  syntaxMode: SyntaxMode;
  syntaxDraft: string;
  importSource: string;
  importParsed: ParsedDocument | null;
  importReconstruction: Reconstruction | null;
  past: Snapshot[];
  future: Snapshot[];
  toast: Toast | null;
  savedAt: string | null;
  hydrated: boolean;

  setTab: (tab: TabId) => void;
  setThemeMode: (mode: ThemeMode) => void;
  notify: (kind: Toast["kind"], message: string) => void;
  dismissToast: () => void;

  setDeck: (patch: Partial<DeckGeometry>, options?: { record?: boolean }) => void;
  setSettings: (patch: Partial<ProjectSettings>) => void;
  setMoving: (patch: Partial<MovingLoadSettings>) => void;
  setModel: (patch: Partial<StructuralModel>) => void;

  selectPlacement: (id: string | null) => void;
  selectVehicle: (id: string | null) => void;

  beginHistory: () => void;
  undo: () => void;
  redo: () => void;

  addPlacement: (vehicleId: string, longitudinalM: number, transverseM: number, options?: Partial<VehiclePlacement>) => void;
  updatePlacement: (id: string, patch: Partial<VehiclePlacement>, options?: { record?: boolean }) => void;
  removePlacement: (id: string) => void;
  duplicatePlacement: (id: string) => void;
  setPlacementClearance: (id: string, clearanceM: number) => void;

  addVehicle: (vehicle: VehicleDefinition) => void;
  addCustomVehicle: () => void;
  updateVehicle: (id: string, patch: Partial<VehicleDefinition>) => void;
  removeVehicle: (id: string) => void;
  duplicateVehicle: (id: string) => string | null;
  restorePreset: (id: string) => void;

  setSyntaxMode: (mode: SyntaxMode) => void;
  setSyntaxDraft: (text: string) => void;
  setImportSource: (text: string) => void;
  applyImport: (parsed: ParsedDocument, reconstruction: Reconstruction) => void;
  clearImport: () => void;

  loadProject: (project: ProjectData, options?: { keepHistory?: boolean }) => void;
  loadSample: () => void;
  resetProject: () => void;
  loadPresetSampleModel: () => void;
  addDemoPlacement: () => void;

  saveLocal: () => void;
  restoreLocal: () => boolean;
  exportProjectFile: () => ProjectFile;
  importProjectFile: (text: string) => { ok: boolean; message: string };
}

let toastCounter = 0;

export const useStudio = create<StudioState>((set, get) => {
  const initial = newProject();

  const pushHistory = (state: StudioState, snap: Snapshot) => {
    const past = [...state.past, snap].slice(-HISTORY_LIMIT);
    return { past, future: [] };
  };

  return {
    ...initial,
    activeTab: "placement",
    themeMode: readStoredThemeMode(),
    selectedPlacementId: initial.placements[0]?.id ?? null,
    selectedVehicleId: initial.vehicles[0]?.id ?? null,
    syntaxMode: "generated",
    syntaxDraft: "",
    importSource: "",
    importParsed: null,
    importReconstruction: null,
    past: [],
    future: [],
    toast: null,
    savedAt: null,
    hydrated: false,

    setTab: (tab) => set({ activeTab: tab }),

    setThemeMode: (mode) => {
      set({ themeMode: mode });
      storeThemeMode(mode);
      applyTheme(resolveTheme(mode));
    },

    notify: (kind, message) => {
      toastCounter += 1;
      set({ toast: { id: `toast-${toastCounter}`, kind, message } });
    },

    dismissToast: () => set({ toast: null }),

    beginHistory: () => {
      set((state) => pushHistory(state, snapshotOf(state)));
    },

    setDeck: (patch, options) => {
      set((state) => ({
        deck: { ...state.deck, ...patch },
        ...(options?.record === false ? {} : pushHistory(state, snapshotOf(state))),
      }));
    },

    setSettings: (patch) => {
      set((state) => ({
        settings: { ...state.settings, ...patch },
        ...pushHistory(state, snapshotOf(state)),
      }));
    },

    setMoving: (patch) => {
      set((state) => ({
        moving: { ...state.moving, ...patch },
        ...pushHistory(state, snapshotOf(state)),
      }));
    },

    setModel: (patch) => {
      set((state) => ({
        model: { ...state.model, ...patch },
        ...pushHistory(state, snapshotOf(state)),
      }));
    },

    selectPlacement: (id) => set({ selectedPlacementId: id }),
    selectVehicle: (id) => set({ selectedVehicleId: id }),

    undo: () => {
      set((state) => {
        const previous = state.past[state.past.length - 1];
        if (!previous) return state;
        return {
          ...previous,
          past: state.past.slice(0, -1),
          future: [snapshotOf(state), ...state.future].slice(0, HISTORY_LIMIT),
        };
      });
    },

    redo: () => {
      set((state) => {
        const next = state.future[0];
        if (!next) return state;
        return {
          ...next,
          past: [...state.past, snapshotOf(state)].slice(-HISTORY_LIMIT),
          future: state.future.slice(1),
        };
      });
    },

    addPlacement: (vehicleId, longitudinalM, transverseM, options) => {
      set((state) => {
        const id = nextId("placement");
        const label = nextVehicleLabel(state.placements);
        const placement: VehiclePlacement = {
          id,
          vehicleId,
          label,
          longitudinalM,
          transverseM,
          rotationDeg: 0,
          referencePoint: "vehicle-centre",
          mode: "free",
          locked: false,
          visible: true,
          color: colorForIndex(state.placements.length),
          ...options,
        };
        return {
          placements: [...state.placements, placement],
          selectedPlacementId: id,
          ...pushHistory(state, snapshotOf(state)),
        };
      });
    },

    updatePlacement: (id, patch, options) => {
      set((state) => ({
        placements: state.placements.map((p) => (p.id === id ? { ...p, ...patch } : p)),
        ...(options?.record === false ? {} : pushHistory(state, snapshotOf(state))),
      }));
    },

    removePlacement: (id) => {
      set((state) => {
        const placements = state.placements.filter((p) => p.id !== id);
        return {
          placements,
          selectedPlacementId: state.selectedPlacementId === id ? placements[0]?.id ?? null : state.selectedPlacementId,
          ...pushHistory(state, snapshotOf(state)),
        };
      });
    },

    duplicatePlacement: (id) => {
      set((state) => {
        const source = state.placements.find((p) => p.id === id);
        if (!source) return state;
        const copy: VehiclePlacement = {
          ...source,
          id: nextId("placement"),
          label: nextVehicleLabel(state.placements),
          locked: false,
          loadCaseNumber: undefined,
          color: colorForIndex(state.placements.length),
          longitudinalM: source.longitudinalM + 1,
        };
        return {
          placements: [...state.placements, copy],
          selectedPlacementId: copy.id,
          ...pushHistory(state, snapshotOf(state)),
        };
      });
    },

    setPlacementClearance: (id, clearanceM) => {
      set((state) => ({
        placements: state.placements.map((p) =>
          p.id === id && p.edge ? { ...p, edge: { ...p.edge, clearanceM } } : p,
        ),
        ...pushHistory(state, snapshotOf(state)),
      }));
    },

    addVehicle: (vehicle) => {
      set((state) => ({
        vehicles: [...state.vehicles, vehicle],
        selectedVehicleId: vehicle.id,
        ...pushHistory(state, snapshotOf(state)),
      }));
    },

    addCustomVehicle: () => {
      const template = customTemplate();
      get().addVehicle({ ...template, id: nextId("custom"), provenance: "user-custom" });
      set({ activeTab: "library" });
    },

    updateVehicle: (id, patch) => {
      set((state) => ({
        vehicles: state.vehicles.map((v) =>
          v.id === id ? { ...v, ...patch, isBuiltIn: false, provenance: v.provenance === "reference-preset" ? "user-verified" : v.provenance } : v,
        ),
        ...pushHistory(state, snapshotOf(state)),
      }));
    },

    removeVehicle: (id) => {
      set((state) => {
        const used = state.placements.some((p) => p.vehicleId === id);
        if (used) {
          get().notify("warning", "Remove or reassign the vehicle placements before deleting this definition.");
          return state;
        }
        return {
          vehicles: state.vehicles.filter((v) => v.id !== id),
          ...pushHistory(state, snapshotOf(state)),
        };
      });
    },

    duplicateVehicle: (id) => {
      const source = get().vehicles.find((v) => v.id === id);
      if (!source) return null;
      const copy = cloneVehicle(source);
      set((state) => ({
        vehicles: [...state.vehicles, copy],
        selectedVehicleId: copy.id,
        ...pushHistory(state, snapshotOf(state)),
      }));
      return copy.id;
    },

    restorePreset: (id) => {
      const preset = presetVehicles().find((v) => v.id === id);
      if (!preset) {
        get().notify("warning", "This definition has no reference preset to restore.");
        return;
      }
      set((state) => ({
        vehicles: state.vehicles.map((v) => (v.id === id ? preset : v)),
        ...pushHistory(state, snapshotOf(state)),
      }));
      get().notify("success", "Reference values restored from the IRC library.");
    },

    setSyntaxMode: (mode) => set({ syntaxMode: mode }),
    setSyntaxDraft: (text) => set({ syntaxDraft: text, syntaxMode: "edited" }),
    setImportSource: (text) => set({ importSource: text }),

    applyImport: (parsed, reconstruction) => {
      set((state) => ({
        vehicles: reconstruction.vehicles,
        placements: [...state.placements, ...reconstruction.placements],
        moving: reconstruction.moving,
        model: reconstruction.model ?? state.model,
        importParsed: parsed,
        importReconstruction: reconstruction,
        selectedPlacementId: reconstruction.placements[0]?.id ?? state.selectedPlacementId,
        ...pushHistory(state, snapshotOf(state)),
      }));
      get().notify(
        reconstruction.partial ? "warning" : "success",
        reconstruction.partial
          ? "Source imported partially — review the reported limitations."
          : "Source imported and the scene was reconstructed.",
      );
    },

    clearImport: () => set({ importSource: "", importParsed: null, importReconstruction: null }),

    loadProject: (project, options) => {
      set((state) => ({
        ...project,
        selectedPlacementId: project.placements[0]?.id ?? null,
        selectedVehicleId: project.vehicles[0]?.id ?? null,
        syntaxMode: "generated",
        syntaxDraft: "",
        past: options?.keepHistory ? pushHistory(state, snapshotOf(state)).past : [],
        future: [],
      }));
    },

    loadSample: () => {
      get().loadProject(sampleProject());
      get().notify("success", "Sample 30 m two-lane bridge loaded with a quad grillage and three placed vehicles.");
      set({ activeTab: "placement" });
    },

    resetProject: () => {
      get().loadProject({ ...emptyProject(), name: "New project" });
      set({ selectedPlacementId: null, activeTab: "placement" });
      get().notify("info", "Project cleared. The IRC vehicle library has been restored.");
    },

    loadPresetSampleModel: () => {
      const model = sampleModel();
      set((state) => ({
        model,
        ...pushHistory(state, snapshotOf(state)),
      }));
      get().notify("success", `Sample grillage loaded: ${model.nodes.length} joints, ${model.quads.length} quads.`);
    },

    addDemoPlacement: () => {
      const state = get();
      const vehicle = state.vehicles.find((v) => v.vehicleType === "wheeled") ?? state.vehicles[0];
      if (!vehicle) return;
      const layout = deckLayout(state.deck);
      state.addPlacement(vehicle.id, state.deck.spanM / 2, layout.lanes[0]?.centreZd ?? 0, {
        mode: "lane",
        lane: { laneIndex: 0 },
      });
    },

    saveLocal: () => {
      try {
        const file = toProjectFile(get());
        localStorage.setItem(STORAGE_KEY, JSON.stringify(file));
        set({ savedAt: new Date().toISOString() });
        get().notify("success", "Project saved to this browser.");
      } catch (error) {
        get().notify("error", `Could not save to local storage: ${(error as Error).message}`);
      }
    },

    restoreLocal: () => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return false;
        const file = JSON.parse(raw) as ProjectFile;
        if (!file || file.schemaVersion !== 1) return false;
        get().loadProject(fromProjectFile(file));
        set({ savedAt: file.savedAt ?? null, hydrated: true });
        return true;
      } catch {
        return false;
      }
    },

    exportProjectFile: () => toProjectFile(get()),

    importProjectFile: (text) => {
      try {
        const result = parseProjectFile(text);
        if (!result.ok) {
          const [first, ...rest] = result.issues;
          return { ok: false, message: `Project not loaded — ${first}${rest.length ? ` (+${rest.length} more issue${rest.length === 1 ? "" : "s"})` : ""}` };
        }
        get().loadProject(fromProjectFile(result.file), { keepHistory: true });
        return { ok: true, message: `Project “${result.file.name}” loaded.` };
      } catch (error) {
        return { ok: false, message: `JSON could not be read: ${(error as Error).message}` };
      }
    },
  };
});

export function currentProject(state: StudioState): ProjectData {
  return {
    name: state.name,
    deck: state.deck,
    vehicles: state.vehicles,
    placements: state.placements,
    model: state.model,
    moving: state.moving,
    settings: state.settings,
  };
}

export const DEFAULT_DECK = defaultDeck();
export const DEFAULT_MODEL = defaultModel();
export const DEFAULT_MOVING = defaultMoving();
export const DEFAULT_SETTINGS = defaultSettings();

export type { Diagnostic };
