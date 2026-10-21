import { useEffect, useMemo, useRef, useState } from "react";
import { currentProject, useStudio, type TabId } from "../store/studio";
import { computeDiagnostics, countBySeverity } from "../lib/validation";
import { getAdapter } from "../lib/syntax/adapters";
import { downloadText, slugify } from "../lib/download";
import { generateDocument } from "../lib/syntax/document";
import { DeckCanvas } from "./DeckCanvas";
import { GeometryPanel } from "./panels/GeometryPanel";
import { PlacementList } from "./panels/PlacementList";
import { VehicleInspector } from "./panels/VehicleInspector";
import { SyntaxPanel } from "./panels/SyntaxPanel";
import { VehicleLibraryPanel } from "./panels/VehicleLibraryPanel";
import { ImportPanel } from "./panels/ImportPanel";
import { LoadConfigPanel } from "./panels/LoadConfigPanel";
import { ValidationPanel } from "./panels/ValidationPanel";
import { SettingsPanel } from "./panels/SettingsPanel";
import { Button, Segmented, Splitter, StatusDot } from "./ui";
import { ThemeToggle } from "./ThemeToggle";
import { useResolvedTheme } from "../lib/useTheme";

const TABS: Array<{ id: TabId; label: string; hint: string }> = [
  { id: "placement", label: "Vehicle Placement", hint: "Deck plan, placement and syntax preview" },
  { id: "library", label: "Vehicle Library", hint: "IRC presets and custom definitions" },
  { id: "import", label: "Syntax Import", hint: "Paste and reconstruct" },
  { id: "loads", label: "Load Configuration", hint: "Moving-load and static settings" },
  { id: "validation", label: "Validation", hint: "Geometry, load and syntax findings" },
  { id: "settings", label: "Project Settings", hint: "Version, mapping, persistence" },
];

export function AppShell() {
  // Applying the theme here means it is correct on every tab, not only where
  // the plan canvas is mounted.
  useResolvedTheme();
  const state = useStudio();
  const project = currentProject(state);
  const diagnostics = useMemo(() => computeDiagnostics(project), [project]);
  const counts = countBySeverity(diagnostics);
  const adapter = getAdapter(state.settings.staadVersion);
  const [leftWidth, setLeftWidth] = useState(306);
  const [rightWidth, setRightWidth] = useState(320);
  const [syntaxHeight, setSyntaxHeight] = useState(230);
  const [showSyntax, setShowSyntax] = useState(true);
  const [showLeft, setShowLeft] = useState(true);
  const [showRight, setShowRight] = useState(true);
  const restored = useRef(false);

  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const saved = useStudio.getState().restoreLocal();
    if (saved) useStudio.getState().notify("info", "Restored the last project saved in this browser.");
  }, []);

  useEffect(() => {
    if (!state.toast) return;
    const timer = window.setTimeout(() => useStudio.getState().dismissToast(), 4200);
    return () => window.clearTimeout(timer);
  }, [state.toast]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && !typing) {
        event.preventDefault();
        if (event.shiftKey) useStudio.getState().redo();
        else useStudio.getState().undo();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        useStudio.getState().saveLocal();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const exportStaad = () => {
    const doc = generateDocument(project);
    downloadText(`${slugify(state.settings.projectName)}-${state.settings.workflow}.std`, doc.text);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-ink-950">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-white/[0.07] bg-ink-900/90 px-3 py-2">
        <div className="flex items-center gap-2">
          <Logo />
          <div className="leading-tight">
            <h1 className="text-[13px] font-semibold tracking-tight text-slate-100">
              LIVE LOAD <span className="text-cyan-400">STUDIO</span>
            </h1>
            <p className="text-[9.5px] uppercase tracking-[0.16em] text-slate-500">STAAD.Pro · IRC vehicle placement</p>
          </div>
        </div>

        <div className="mx-1 hidden h-7 w-px bg-white/[0.08] sm:block" />

        <input
          className="w-[170px] rounded border border-white/10 bg-ink-950/60 px-2 py-1 text-[12px] font-medium text-slate-200 outline-none focus:border-cyan-500/50"
          value={state.settings.projectName}
          onChange={(event) => useStudio.getState().setSettings({ projectName: event.target.value })}
          aria-label="Project name"
        />

        <div className="hidden items-center gap-1.5 md:flex">
          <Segmented
            value={state.settings.workflow}
            onChange={(workflow) => useStudio.getState().setSettings({ workflow })}
            options={[
              { value: "moving", label: "Moving load" },
              { value: "static", label: "Static placement" },
            ]}
          />
          <Segmented
            value={state.settings.staadVersion}
            onChange={(staadVersion) => useStudio.getState().setSettings({ staadVersion })}
            options={[
              { value: "2022", label: "2022" },
              { value: "2025", label: "2025" },
            ]}
          />
        </div>

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => useStudio.getState().setTab("validation")}
            className="flex items-center gap-1.5 rounded border border-white/10 bg-ink-800 px-2 py-1 text-[11px] text-slate-300 transition hover:border-white/20"
            title="Open validation"
          >
            <StatusDot tone={counts.errors ? "error" : counts.warnings ? "warn" : "ok"} />
            <span className="mono">
              {counts.errors}E · {counts.warnings}W
            </span>
          </button>
          <Button size="xs" variant="ghost" onClick={state.undo} disabled={!state.past.length} title="Undo (Ctrl+Z)">Undo</Button>
          <Button size="xs" variant="ghost" onClick={state.redo} disabled={!state.future.length} title="Redo (Ctrl+Shift+Z)">Redo</Button>
          <Button size="xs" onClick={() => setShowLeft((v) => !v)} title="Toggle left panels" className="hidden lg:inline-flex">
            {showLeft ? "◧" : "◨"}
          </Button>
          <Button size="xs" onClick={() => setShowRight((v) => !v)} title="Toggle inspector" className="hidden lg:inline-flex">
            {showRight ? "◨" : "◧"}
          </Button>
          <ThemeToggle />
          <Button size="xs" onClick={exportStaad}>Export .std</Button>
          <Button size="xs" variant="ghost" onClick={state.loadSample}>Sample</Button>
          <Button size="xs" variant="primary" onClick={state.saveLocal} title="Save to browser (Ctrl+S)">Save</Button>
        </div>
      </header>

      <nav className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-white/[0.07] bg-ink-900/60 px-2">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            title={tab.hint}
            className={`tab ${state.activeTab === tab.id ? "tab-active" : ""}`}
            onClick={() => useStudio.getState().setTab(tab.id)}
          >
            {tab.label}
            {tab.id === "validation" && diagnostics.length > 0 && (
              <span
                className={`mono rounded px-1 text-[9.5px] ${
                  counts.errors
                    ? "bg-signal-red/20 text-signal-red"
                    : counts.warnings
                      ? "bg-signal-amber/20 text-signal-amber"
                      : "bg-white/10 text-slate-400"
                }`}
              >
                {diagnostics.length}
              </span>
            )}
            {tab.id === "library" && (
              <span className="mono rounded bg-white/[0.06] px-1 text-[9.5px] text-slate-500">{state.vehicles.length}</span>
            )}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2 py-1 pr-1 text-[10px] text-slate-600">
          <span className={`chip ${adapter.status === "verified" ? "border-signal-green/30 text-signal-green" : "border-signal-amber/30 text-signal-amber"}`}>
            {adapter.label} adapter · {adapter.status}
          </span>
          <span className="hidden xl:inline">click plan to place · drag to move · space+drag to pan · F to fit</span>
        </div>
      </nav>

      <main className="min-h-0 flex-1 overflow-hidden">
        {state.activeTab === "placement" && (
          <div className="flex h-full min-h-0">
            {showLeft && (
              <>
                <aside className="scroll-area hidden shrink-0 space-y-3 border-r border-white/[0.06] p-2.5 lg:block" style={{ width: leftWidth }}>
                  <GeometryPanel />
                  <PlacementList />
                </aside>
                <div className="hidden lg:block">
                  <Splitter
                    direction="horizontal"
                    onDelta={(delta) => setLeftWidth((w) => Math.min(460, Math.max(240, w + delta)))}
                  />
                </div>
              </>
            )}

            <div className="flex min-w-0 flex-1 flex-col">
              <div className="min-h-0 flex-1">
                <DeckCanvas />
              </div>
              {showSyntax && (
                <>
                  <Splitter direction="vertical" onDelta={(delta) => setSyntaxHeight((h) => Math.min(520, Math.max(120, h - delta)))} />
                  <div className="shrink-0" style={{ height: syntaxHeight }}>
                    <SyntaxPanel />
                  </div>
                </>
              )}
              <button
                type="button"
                className="shrink-0 border-t border-white/[0.06] bg-ink-900/80 py-0.5 text-[10px] text-slate-500 transition hover:text-cyan-300"
                onClick={() => setShowSyntax((v) => !v)}
              >
                {showSyntax ? "▾ hide syntax panel" : "▴ show syntax panel"}
              </button>
            </div>

            {showRight && (
              <>
                <div className="hidden lg:block">
                  <Splitter
                    direction="horizontal"
                    onDelta={(delta) => setRightWidth((w) => Math.min(440, Math.max(260, w - delta)))}
                  />
                </div>
                <aside className="scroll-area hidden shrink-0 border-l border-white/[0.06] p-2.5 lg:block" style={{ width: rightWidth }}>
                  <VehicleInspector />
                </aside>
              </>
            )}
          </div>
        )}

        {state.activeTab === "library" && (
          <div className="flex h-full min-h-0 flex-col">
            <VehicleLibraryPanel />
          </div>
        )}
        {state.activeTab === "import" && (
          <div className="flex h-full min-h-0 flex-col">
            <ImportPanel />
          </div>
        )}
        {state.activeTab === "loads" && (
          <div className="flex h-full min-h-0 flex-col">
            <LoadConfigPanel />
          </div>
        )}
        {state.activeTab === "validation" && (
          <div className="flex h-full min-h-0 flex-col">
            <ValidationPanel />
          </div>
        )}
        {state.activeTab === "settings" && (
          <div className="flex h-full min-h-0 flex-col">
            <SettingsPanel />
          </div>
        )}
      </main>

      <footer className="flex shrink-0 items-center gap-3 border-t border-white/[0.07] bg-ink-900/80 px-3 py-1 text-[10px] text-slate-600">
        <span>metres · kilonewtons</span>
        <span className="hidden sm:inline">·</span>
        <span className="hidden sm:inline">origin {state.deck.totalWidthM} m deck, Zd = 0 at centreline</span>
        <span className="ml-auto flex items-center gap-2">
          <span className="hidden md:inline">Undo stack {state.past.length}</span>
          <span className={`chip ${state.savedAt ? "border-signal-green/25 text-signal-green/80" : "border-white/10 text-slate-500"}`}>
            {state.savedAt ? "saved locally" : "unsaved"}
          </span>
        </span>
      </footer>

      {state.toast && (
        <div className="pointer-events-none fixed bottom-10 left-1/2 z-50 -translate-x-1/2">
          <div
            className={`pointer-events-auto flex items-center gap-2 rounded-md border px-3 py-1.5 text-[11.5px] shadow-lg backdrop-blur ${
              state.toast.kind === "error"
                ? "border-signal-red/40 bg-signal-red/15 text-signal-red"
                : state.toast.kind === "warning"
                  ? "border-signal-amber/40 bg-signal-amber/15 text-signal-amber"
                  : state.toast.kind === "success"
                    ? "border-signal-green/40 bg-signal-green/15 text-signal-green"
                    : "border-white/15 bg-ink-800/95 text-slate-300"
            }`}
          >
            <span>{state.toast.message}</span>
            <button type="button" className="text-[10px] opacity-60 hover:opacity-100" onClick={state.dismissToast}>
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Logo() {
  return (
    <svg viewBox="0 0 28 28" className="h-7 w-7" aria-hidden>
      <rect x="1" y="1" width="26" height="26" rx="5" className="fill-ink-850 stroke-ink-600" />
      <path d="M5 20h18" className="stroke-cyan-400" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M5 20 8 12h12l3 8" className="stroke-cyan-400" strokeWidth="1.2" strokeLinejoin="round" opacity="0.55" />
      <rect x="11" y="8" width="6" height="4" rx="1" className="fill-signal-amber" opacity="0.9" />
      <path d="M14 8V4" className="stroke-signal-amber" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}
