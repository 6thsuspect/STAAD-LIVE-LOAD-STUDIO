import { useMemo, useState } from "react";
import { currentProject, useStudio } from "../../store/studio";
import { generateDocument } from "../../lib/syntax/document";
import { planMovingDefinitions } from "../../lib/syntax/moving";
import { deckLayout, vehicleTotalLoadKN } from "../../lib/geometry";
import { fmt } from "../../lib/units";
import { getAdapter } from "../../lib/syntax/adapters";
import { Button, Field, Hint, NumberField, Panel, Segmented, Select, TextField, Toggle } from "../ui";
import { CodeEditor } from "../CodeEditor";

export function LoadConfigPanel() {
  const state = useStudio();
  const project = currentProject(state);
  const moving = state.moving;
  const setMoving = state.setMoving;
  const settings = state.settings;
  const setSettings = state.setSettings;
  const setModel = state.setModel;
  const layout = deckLayout(state.deck);
  const [preview, setPreview] = useState<string | null>(null);
  const adapter = getAdapter(settings.staadVersion);

  const movingPreview = useMemo(() => {
    const placement = state.placements.find((p) => p.id === state.selectedPlacementId) ?? state.placements[0];
    if (!placement) return null;
    const vehicle = state.vehicles.find((v) => v.id === placement.vehicleId);
    if (!vehicle) return null;
    return planMovingDefinitions(vehicle, placement, moving);
  }, [state.placements, state.selectedPlacementId, state.vehicles, moving]);

  const staticPreview = useMemo(() => {
    if (settings.workflow !== "static") return null;
    const doc = generateDocument(project);
    return doc.staticPlan ?? null;
  }, [project, settings.workflow]);

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-auto p-3 xl:grid-cols-2">
      <div className="space-y-3">
        <Panel title="Workflow" subtitle="the two workflows share one vehicle model but never share output">
          <Segmented
            value={settings.workflow}
            onChange={(workflow) => setSettings({ workflow })}
            options={[
              { value: "moving", label: "Moving-load generation" },
              { value: "static", label: "Explicit static placement" },
            ]}
            className="w-full"
          />
          <div className="mt-2 grid grid-cols-2 gap-2 text-[10.5px] leading-relaxed">
            <div className={`rounded border p-2 ${settings.workflow === "moving" ? "border-cyan-400/30 bg-cyan-500/[0.06] text-slate-300" : "border-white/[0.06] text-slate-500"}`}>
              <p className="mb-1 font-semibold text-slate-200">Moving</p>
              DEFINE MOVING LOAD plus LOAD GENERATION. Runs share one reference position and a fixed increment; interior gauge and
              arbitrary wheel coordinates can only be approximated.
            </div>
            <div className={`rounded border p-2 ${settings.workflow === "static" ? "border-cyan-400/30 bg-cyan-500/[0.06] text-slate-300" : "border-white/[0.06] text-slate-500"}`}>
              <p className="mb-1 font-semibold text-slate-200">Static</p>
              One explicit primary load case per placement. Requires joints (and members or quads for transfer) so each wheel load
              maps to the structural model.
            </div>
          </div>
        </Panel>

        <Panel title="Moving-load generation" subtitle={`${adapter.movingLoadDefinition.note}`}>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Base TYPE number" hint="increments per moving-load line">
              <NumberField value={moving.typeNumber} min={1} max={999} step={1} precision={0} onChange={(value) => setMoving({ typeNumber: Math.round(value) })} />
            </Field>
            <Field label="Generated positions">
              <NumberField value={moving.positionCount} min={1} max={500} step={1} precision={0} onChange={(value) => setMoving({ positionCount: Math.round(value) })} />
            </Field>
            <Field label="Start Xd (reference)">
              <NumberField value={moving.startLongitudinalM} step={0.25} onChange={(value) => setMoving({ startLongitudinalM: value })} suffix="m" />
            </Field>
            <Field label="Increment">
              <NumberField value={moving.incrementM} min={0.01} max={20} step={0.05} onChange={(value) => setMoving({ incrementM: value })} suffix="m" />
            </Field>
            <Field label="Direction">
              <Select
                value={moving.direction}
                onChange={(direction) => setMoving({ direction })}
                options={[
                  { value: 1, label: "+Xd (start → end)" },
                  { value: -1, label: "−Xd (end → start)" },
                ]}
              />
            </Field>
            <Field label="Representation">
              <Select
                value={moving.representation}
                onChange={(representation) => setMoving({ representation })}
                options={[
                  { value: "axle-load-width", label: "Axle loads + WIDTH" },
                  { value: "explicit-wheel-lines", label: "Explicit wheel lines" },
                  { value: "wheel-line-no-width", label: "Axle loads, no WIDTH" },
                ]}
              />
            </Field>
            <Field label="Track slices per track">
              <NumberField value={moving.trackSlices} min={1} max={40} step={1} precision={0} onChange={(value) => setMoving({ trackSlices: Math.round(value) })} />
            </Field>
            <Field label="Sweep envelope">
              <div className="input mono flex items-center text-slate-400">
                {fmt(moving.startLongitudinalM, 2)} → {fmt(moving.startLongitudinalM + moving.direction * moving.incrementM * Math.max(0, moving.positionCount - 1), 2)} m
              </div>
            </Field>
          </div>

          <div className="mt-2 rounded border border-white/[0.06] bg-ink-950/40 p-2">
            <Toggle
              checked={moving.emitLoadCaseAnchor}
              onChange={(emitLoadCaseAnchor) => setMoving({ emitLoadCaseAnchor })}
              label="Emit a LOAD case anchor before each LOAD GENERATION"
              hint="Some workflows expect an existing load case to receive the generated positions."
            />
            {moving.emitLoadCaseAnchor && (
              <div className="mt-1 grid grid-cols-2 gap-2">
                <Field label="Anchor case number">
                  <NumberField value={moving.anchorLoadCaseNumber} min={1} max={9999} step={1} precision={0} onChange={(value) => setMoving({ anchorLoadCaseNumber: Math.round(value) })} />
                </Field>
                <Field label="Anchor title">
                  <TextField value={moving.anchorTitle} onChange={(value) => setMoving({ anchorTitle: value })} maxLength={24} />
                </Field>
              </div>
            )}
          </div>

          <div className="mt-2 rounded border border-white/[0.06] bg-ink-950/40 p-2">
            <Toggle
              checked={moving.impactEnabled}
              onChange={(impactEnabled) => setMoving({ impactEnabled })}
              label="Apply a user impact/dynamic multiplier"
              hint="The app does not derive IRC impact factors. Any factor you enter is reported as a user assumption."
            />
            {moving.impactEnabled && (
              <div className="mt-1 grid grid-cols-2 gap-2">
                <Field label="Impact factor">
                  <NumberField value={moving.impactFactor} min={0} max={2} step={0.025} onChange={(value) => setMoving({ impactFactor: value })} />
                </Field>
                <Field label="Note recorded in output">
                  <TextField value={moving.impactNote} onChange={(value) => setMoving({ impactNote: value })} placeholder="e.g. per project spec" />
                </Field>
              </div>
            )}
          </div>

          <Hint>{adapter.widthParameter.note}</Hint>

          <div className="mt-2 flex items-center gap-2">
            <Button size="xs" onClick={() => setPreview(preview ? null : "moving")}>Preview definitions</Button>
            <span className="text-[10px] text-slate-500">
              {movingPreview ? `${movingPreview.definitions.length} definition(s), ${movingPreview.diagnostics.filter((d) => d.severity === "error").length} error(s)` : "no vehicle placed"}
            </span>
          </div>
          {preview === "moving" && movingPreview && (
            <div className="mt-2">
              <CodeEditor
                value={movingPreview.definitions
                  .map((definition, index) => {
                    const loads = definition.loadsKN.map((v) => fmt(v, 3)).join(" ");
                    const distances = definition.distancesM.map((v) => fmt(v, 3)).join(" ");
                    const width = definition.widthM !== undefined ? ` WIDTH ${fmt(definition.widthM, 3)}` : "";
                    return `* ${definition.lineLabel}\nTYPE ${definition.typeNumber} LOAD ${loads}${distances ? ` DISTANCE ${distances}` : ""}${width}`;
                  })
                  .join("\n\n")}
                readOnly
                minLines={4}
                ariaLabel="Moving-load definition preview"
              />
            </div>
          )}
        </Panel>
      </div>

      <div className="space-y-3">
        <Panel title="Static placement" subtitle="explicit load cases from the structural model">
          <div className="grid grid-cols-2 gap-2">
            <Field label="First case number">
              <NumberField value={settings.staticCaseStart} min={1} max={9999} step={1} precision={0} onChange={(value) => setSettings({ staticCaseStart: Math.round(value) })} />
            </Field>
            <Field label="LOADTYPE keyword">
              <Select
                value={settings.staticLoadType}
                onChange={(staticLoadType) => setSettings({ staticLoadType })}
                options={[
                  { value: "LIVE", label: "LIVE" },
                  { value: "NONE", label: "NONE" },
                ]}
              />
            </Field>
            <Field label="Load transfer method">
              <Select
                value={state.model.loadTransfer}
                onChange={(loadTransfer) => setModel({ loadTransfer })}
                options={[
                  { value: "exact-node", label: "Exact joint only" },
                  { value: "nearest-node", label: "Nearest joint" },
                  { value: "two-node-lever", label: "Two-joint lever" },
                  { value: "four-node-bilinear", label: "Four-joint bilinear" },
                ]}
              />
            </Field>
            <Field label="Joint tolerance">
              <NumberField value={state.model.nodeToleranceM} min={0.001} max={2} step={0.005} onChange={(value) => setModel({ nodeToleranceM: value })} suffix="m" />
            </Field>
            <Field label="Member/element tolerance">
              <NumberField value={state.model.gridToleranceM} min={0.001} max={2} step={0.005} onChange={(value) => setModel({ gridToleranceM: value })} suffix="m" />
            </Field>
            <Field label="Track slices">
              <NumberField value={state.model.trackTrackPoints} min={1} max={40} step={1} precision={0} onChange={(value) => setModel({ trackTrackPoints: Math.round(value) })} />
            </Field>
          </div>

          <div className="mt-2 grid grid-cols-3 gap-1.5">
            <div className="stat">
              <div className="stat-label">Joints</div>
              <div className="stat-value">{state.model.nodes.length}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Members</div>
              <div className="stat-value">{state.model.members.length}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Quads</div>
              <div className="stat-value">{state.model.quads.length}</div>
            </div>
          </div>

          {staticPreview ? (
            <div className="mt-2 space-y-2">
              {staticPreview.cases.map((planCase) => (
                <div key={planCase.placementId} className={`rounded border px-2 py-1.5 ${planCase.valid ? "border-white/[0.07] bg-ink-950/40" : "border-signal-red/30 bg-signal-red/[0.07]"}`}>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-semibold text-slate-200">
                      Case {planCase.caseNumber} · {planCase.placementLabel}
                    </span>
                    <span className={planCase.valid ? "text-signal-green" : "text-signal-red"}>
                      {planCase.valid ? "emittable" : `${planCase.transfers.filter((t) => t.error).length} point(s) unresolved`}
                    </span>
                  </div>
                  <div className="mono mt-0.5 text-[10.5px] text-slate-500">
                    applied {fmt(planCase.totalAppliedKN, 2)} kN → {planCase.nodeLoads.length} joints · emitted {fmt(planCase.totalEmittedKN, 2)} kN
                  </div>
                </div>
              ))}
              {staticPreview.cases.length === 0 && (
                <p className="text-[10.5px] text-slate-500">No static cases yet. Import a model or load the sample grillage.</p>
              )}
            </div>
          ) : (
            <Hint>Switch the workflow to static placement to inspect explicit load cases.</Hint>
          )}

          <div className="mt-2 flex items-center gap-2">
            <Button size="xs" onClick={state.loadPresetSampleModel}>Load sample grillage</Button>
            <Button size="xs" variant="ghost" onClick={() => useStudio.getState().setTab("settings")}>Import model</Button>
          </div>
        </Panel>

        <Panel title="Vehicle load summary" subtitle="applied loads per placed vehicle">
          <div className="space-y-1">
            {state.placements.map((placement) => {
              const vehicle = state.vehicles.find((v) => v.id === placement.vehicleId);
              if (!vehicle) return null;
              const total = vehicleTotalLoadKN(vehicle) * (moving.impactEnabled ? 1 + Math.max(0, moving.impactFactor) : 1);
              return (
                <div key={placement.id} className="flex items-center justify-between rounded border border-white/[0.05] px-2 py-1 text-[11px]">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-sm" style={{ background: placement.color }} />
                    <span className="text-slate-300">{placement.label}</span>
                    <span className="text-slate-500">{vehicle.shortName}</span>
                  </span>
                  <span className="mono text-slate-300">{fmt(total, 1)} kN</span>
                </div>
              );
            })}
            {state.placements.length === 0 && <p className="text-[10.5px] text-slate-500">No vehicles placed.</p>}
          </div>
          <div className="mt-2 flex items-center justify-between rounded border border-white/[0.06] bg-ink-950/40 px-2 py-1 text-[11px]">
            <span className="text-slate-500">Total placed load</span>
            <span className="mono font-semibold text-slate-200">
              {fmt(
                state.placements.reduce((acc, p) => {
                  const vehicle = state.vehicles.find((v) => v.id === p.vehicleId);
                  return acc + (vehicle ? vehicleTotalLoadKN(vehicle) : 0);
                }, 0) * (moving.impactEnabled ? 1 + Math.max(0, moving.impactFactor) : 1),
                1,
              )}{" "}
              kN
            </span>
          </div>
          <p className="mt-1.5 text-[10px] text-slate-500">
            Carriageway {fmt(layout.carriagewayWidthM)} m · {layout.lanes.length} lanes · deck {fmt(state.deck.totalWidthM)} m.
          </p>
        </Panel>
      </div>
    </div>
  );
}
