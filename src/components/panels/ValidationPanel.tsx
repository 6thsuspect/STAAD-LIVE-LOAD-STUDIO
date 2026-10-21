import { useMemo, useState } from "react";
import { currentProject, useStudio } from "../../store/studio";
import { computeDiagnostics, countBySeverity } from "../../lib/validation";
import type { DiagnosticCategory, Severity } from "../../types";
import { Button, Panel, SeverityBadge, StatusDot } from "../ui";

const CATEGORY_LABELS: Record<DiagnosticCategory, string> = {
  geometry: "Geometry",
  vehicle: "Vehicles",
  placement: "Placements",
  load: "Loads",
  syntax: "Syntax",
  model: "Structural model",
};

const SEVERITY_ORDER: Severity[] = ["error", "warning", "info"];

export function ValidationPanel() {
  const state = useStudio();
  const project = currentProject(state);
  const diagnostics = useMemo(() => computeDiagnostics(project), [project]);
  const counts = countBySeverity(diagnostics);
  const [filter, setFilter] = useState<Severity | "all">("all");
  const [category, setCategory] = useState<DiagnosticCategory | "all">("all");

  const filtered = diagnostics.filter((d) => (filter === "all" || d.severity === filter) && (category === "all" || d.category === category));

  const byCategory = (Object.keys(CATEGORY_LABELS) as DiagnosticCategory[]).map((key) => ({
    key,
    label: CATEGORY_LABELS[key],
    diagnostics: diagnostics.filter((d) => d.category === key),
  }));

  const select = (diagnostic: import("../../types").Diagnostic) => {
    if (diagnostic.refs?.placementId) {
      useStudio.getState().selectPlacement(diagnostic.refs.placementId);
      useStudio.getState().setTab("placement");
    } else if (diagnostic.refs?.vehicleId) {
      useStudio.getState().selectVehicle(diagnostic.refs.vehicleId);
      useStudio.getState().setTab("library");
    }
  };

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-auto p-3 xl:grid-cols-[minmax(0,1fr)_320px]">
      <Panel
        title="Validation"
        subtitle={`${diagnostics.length} finding(s) across geometry, loads, syntax and the structural model`}
        actions={
          <div className="flex items-center gap-1">
            <Button size="xs" variant={filter === "all" ? "primary" : "ghost"} onClick={() => setFilter("all")}>All</Button>
            {SEVERITY_ORDER.map((severity) => (
              <Button
                key={severity}
                size="xs"
                variant={filter === severity ? "primary" : "ghost"}
                onClick={() => setFilter(severity)}
                disabled={!diagnostics.some((d) => d.severity === severity)}
              >
                {severity} {diagnostics.filter((d) => d.severity === severity).length}
              </Button>
            ))}
          </div>
        }
        className="min-h-0"
      >
        <div className="mb-2 flex flex-wrap gap-1">
          <button
            type="button"
            onClick={() => setCategory("all")}
            className={`chip border-white/10 ${category === "all" ? "bg-cyan-500/15 text-cyan-200" : "bg-ink-950/40 text-slate-500"}`}
          >
            all categories
          </button>
          {byCategory.map((entry) => (
            <button
              key={entry.key}
              type="button"
              onClick={() => setCategory(entry.key)}
              className={`chip border-white/10 ${category === entry.key ? "bg-cyan-500/15 text-cyan-200" : "bg-ink-950/40 text-slate-500"}`}
            >
              {entry.label} {entry.diagnostics.length}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="rounded border border-dashed border-white/10 px-3 py-8 text-center">
            <p className="text-[12px] text-slate-400">Nothing reported for this filter.</p>
            <p className="mx-auto mt-1 max-w-[420px] text-[11px] leading-relaxed text-slate-500">
              A clean list does not mean the load case is correct. These checks cover what the application can verify about
              geometry, units and supported grammar — not code compliance or structural adequacy.
            </p>
          </div>
        ) : (
          <ul className="space-y-1.5">
            {filtered.map((diagnostic) => (
              <li
                key={diagnostic.id}
                className={`rounded border px-2 py-1.5 ${
                  diagnostic.severity === "error"
                    ? "border-signal-red/25 bg-signal-red/[0.05]"
                    : diagnostic.severity === "warning"
                      ? "border-signal-amber/20 bg-signal-amber/[0.04]"
                      : "border-white/[0.06] bg-ink-950/30"
                }`}
              >
                <div className="flex items-start gap-2">
                  <SeverityBadge severity={diagnostic.severity} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[11.5px] leading-snug text-slate-200">{diagnostic.message}</p>
                    {diagnostic.detail && <p className="mt-0.5 text-[10.5px] leading-relaxed text-slate-500">{diagnostic.detail}</p>}
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[9.5px] text-slate-600">
                      <span className="chip border-white/[0.07] bg-transparent text-slate-500">{CATEGORY_LABELS[diagnostic.category]}</span>
                      <span className="mono">{diagnostic.code}</span>
                      {diagnostic.line && <span className="mono">line {diagnostic.line}</span>}
                      {diagnostic.refs?.placementId && (
                        <button type="button" className="text-cyan-400 hover:underline" onClick={() => select(diagnostic)}>
                          show placement
                        </button>
                      )}
                      {diagnostic.refs?.vehicleId && !diagnostic.refs?.placementId && (
                        <button type="button" className="text-cyan-400 hover:underline" onClick={() => select(diagnostic)}>
                          open definition
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="space-y-3">
        <Panel title="Summary">
          <div className="grid grid-cols-3 gap-1.5">
            <div className="stat">
              <div className="stat-label">Errors</div>
              <div className={`stat-value ${counts.errors ? "text-signal-red" : ""}`}>{counts.errors}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Warnings</div>
              <div className={`stat-value ${counts.warnings ? "text-signal-amber" : ""}`}>{counts.warnings}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Notes</div>
              <div className="stat-value">{counts.infos}</div>
            </div>
          </div>
          <ul className="mt-2 space-y-1">
            {byCategory.map((entry) => {
              const errors = entry.diagnostics.filter((d) => d.severity === "error").length;
              const warnings = entry.diagnostics.filter((d) => d.severity === "warning").length;
              return (
                <li key={entry.key} className="flex items-center justify-between gap-2 rounded border border-white/[0.05] px-2 py-1 text-[11px]">
                  <span className="flex items-center gap-1.5 text-slate-400">
                    <StatusDot tone={errors ? "error" : warnings ? "warn" : entry.diagnostics.length ? "idle" : "ok"} />
                    {entry.label}
                  </span>
                  <span className="mono text-slate-500">
                    {errors}E · {warnings}W · {entry.diagnostics.length - errors - warnings}N
                  </span>
                </li>
              );
            })}
          </ul>
        </Panel>

        <Panel title="What is checked">
          <ul className="space-y-1.5 text-[10.5px] leading-relaxed text-slate-400">
            <li><span className="text-slate-300">Geometry:</span> component width consistency, lane continuity, span and width limits.</li>
            <li><span className="text-slate-300">Placement:</span> barrier interference, deck and carriageway extents, IRC 70R and Class A kerb clearances, edge-clearance reproduction to 0.1 mm.</li>
            <li><span className="text-slate-300">Loads:</span> wheel-load sums against axle loads, positive loads, applied-versus-emitted totals in static cases.</li>
            <li><span className="text-slate-300">Syntax:</span> load/distance counts, required parameters, unique TYPE and case numbers, generator round-trip through the parser.</li>
            <li><span className="text-slate-300">Model:</span> unique joints, dangling members and quads, mapping axis conflicts, transfer-method prerequisites.</li>
          </ul>
          <p className="mt-2 rounded border border-white/[0.05] bg-ink-950/40 px-2 py-1.5 text-[10px] leading-relaxed text-slate-500">
            These checks do not replace engineering judgement, code review or independent structural verification.
          </p>
        </Panel>
      </div>
    </div>
  );
}
