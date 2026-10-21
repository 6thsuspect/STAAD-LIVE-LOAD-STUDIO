import { useState } from "react";
import { useStudio } from "../../store/studio";
import type { AxleDefinition, TrackDefinition, VehicleDefinition } from "../../types";
import { validateVehicle, vehicleSummary } from "../../lib/vehicles";
import { vehicleTotalLoadKN } from "../../lib/geometry";
import { fmt, round, sum } from "../../lib/units";
import { Button, Field, Hint, NumberField, Panel, Panel as _Panel, Select, TextField } from "../ui";

export function VehicleLibraryPanel() {
  const vehicles = useStudio((s) => s.vehicles);
  const placements = useStudio((s) => s.placements);
  const selectedVehicleId = useStudio((s) => s.selectedVehicleId);
  const selectVehicle = useStudio((s) => s.selectVehicle);
  const addVehicle = useStudio((s) => s.addVehicle);
  const addCustomVehicle = useStudio((s) => s.addCustomVehicle);
  const updateVehicle = useStudio((s) => s.updateVehicle);
  const removeVehicle = useStudio((s) => s.removeVehicle);
  const restorePreset = useStudio((s) => s.restorePreset);
  const addPlacement = useStudio((s) => s.addPlacement);
  const notify = useStudio((s) => s.notify);

  const selected = vehicles.find((v) => v.id === selectedVehicleId) ?? vehicles[0];
  const usedCount = (id: string) => placements.filter((p) => p.vehicleId === id).length;

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-auto p-3 lg:grid-cols-[320px_minmax(0,1fr)]">
      <div className="space-y-3">
        <Panel
          title="Vehicle library"
          subtitle={`${vehicles.length} definitions`}
          actions={
            <Button size="xs" variant="primary" onClick={addCustomVehicle}>
              New custom
            </Button>
          }
        >
          <ul className="space-y-1.5">
            {vehicles.map((vehicle) => {
              const active = vehicle.id === selected?.id;
              const issues = validateVehicle(vehicle);
              return (
                <li key={vehicle.id}>
                  <button
                    type="button"
                    onClick={() => selectVehicle(vehicle.id)}
                    className={`w-full rounded border px-2 py-1.5 text-left transition ${
                      active ? "border-cyan-400/40 bg-cyan-500/[0.07]" : "border-white/[0.06] bg-ink-950/30 hover:border-white/15"
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[12px] font-semibold text-slate-200">{vehicle.shortName}</span>
                      <span
                        className={`chip ml-auto ${
                          vehicle.provenance === "reference-preset"
                            ? "border-signal-green/30 bg-signal-green/10 text-signal-green"
                            : vehicle.provenance === "imported"
                              ? "border-signal-blue/30 bg-signal-blue/10 text-signal-blue"
                              : "border-signal-amber/30 bg-signal-amber/10 text-signal-amber"
                        }`}
                      >
                        {vehicle.provenance.replace(/-/g, " ")}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-[10.5px] text-slate-500">{vehicle.name}</div>
                    <div className="mono mt-0.5 flex items-center gap-2 text-[10px] text-slate-500">
                      <span>{vehicleSummary(vehicle)}</span>
                      <span>·</span>
                      <span>{fmt(vehicleTotalLoadKN(vehicle), 0)} kN</span>
                      {usedCount(vehicle.id) > 0 && <span className="text-cyan-400/80">· {usedCount(vehicle.id)} placed</span>}
                      {issues.some((i) => i.level === "error") && <span className="text-signal-red">· invalid</span>}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
          <Hint>
            Green definitions are unmodified reference presets. Any edit marks a definition as user-modified, and imported
            definitions carry only the geometry actually present in the source text.
          </Hint>
        </Panel>
      </div>

      {selected ? (
        <VehicleEditor
          vehicle={selected}
          onChange={(patch) => updateVehicle(selected.id, patch)}
          onDuplicate={() => {
            const id = useStudio.getState().duplicateVehicle(selected.id);
            if (id) notify("success", "Definition duplicated. Use it for a materially different permitted arrangement.");
          }}
          onDelete={() => removeVehicle(selected.id)}
          onRestore={() => restorePreset(selected.id)}
          onPlace={() => {
            const state = useStudio.getState();
            const lane = state.deck.laneCount > 0 ? 0 : 0;
            addPlacement(selected.id, state.deck.spanM / 2, 0, { mode: "lane", lane: { laneIndex: lane }, referencePoint: "vehicle-centre" });
            useStudio.getState().setTab("placement");
          }}
          usedCount={usedCount(selected.id)}
        />
      ) : null}
    </div>
  );
}

function VehicleEditor({
  vehicle,
  onChange,
  onDuplicate,
  onDelete,
  onRestore,
  onPlace,
  usedCount,
}: {
  vehicle: VehicleDefinition;
  onChange: (patch: Partial<VehicleDefinition>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onRestore: () => void;
  onPlace: () => void;
  usedCount: number;
}) {
  const [showProvenance, setShowProvenance] = useState(false);
  const issues = validateVehicle(vehicle);
  const totalLoad = vehicleTotalLoadKN(vehicle);

  const updateAxle = (id: string, patch: Partial<AxleDefinition>) => {
    const axles = vehicle.axles.map((axle) => {
      if (axle.id !== id) return axle;
      const next = { ...axle, ...patch };
      if (patch.loadKN !== undefined && patch.wheelLoadsKN === undefined) {
        const count = next.wheelLoadsKN.length || 2;
        next.wheelLoadsKN = Array.from({ length: count }, () => round(next.loadKN / count, 4));
      }
      return next;
    });
    onChange({ axles });
  };

  const updateTrack = (id: string, patch: Partial<TrackDefinition>) => {
    onChange({ tracks: vehicle.tracks.map((track) => (track.id === id ? { ...track, ...patch } : track)) });
  };

  const axleTrain = vehicle.axles.length
    ? Math.max(...vehicle.axles.map((a) => a.longitudinalOffsetM)) - Math.min(...vehicle.axles.map((a) => a.longitudinalOffsetM))
    : 0;

  return (
    <div className="space-y-3">
      <Panel
        title="Definition"
        subtitle={vehicle.isBuiltIn ? "reference preset" : "user definition"}
        actions={
          <div className="flex items-center gap-1">
            <Button size="xs" onClick={onDuplicate}>Duplicate</Button>
            {!vehicle.isBuiltIn && vehicle.provenance !== "imported" && (
              <Button size="xs" variant="ghost" onClick={onRestore}>Restore preset</Button>
            )}
            <Button size="xs" variant="ghost" onClick={() => setShowProvenance((v) => !v)}>Source</Button>
            <Button size="xs" variant="danger" onClick={onDelete} disabled={usedCount > 0}>Delete</Button>
          </div>
        }
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Name" className="lg:col-span-2">
            <TextField value={vehicle.name} onChange={(value) => onChange({ name: value })} />
          </Field>
          <Field label="Short name">
            <TextField value={vehicle.shortName} onChange={(value) => onChange({ shortName: value })} maxLength={16} />
          </Field>
          <Field label="Classification">
            <TextField value={vehicle.classification} onChange={(value) => onChange({ classification: value })} />
          </Field>
          <Field label="Type">
            <Select
              value={vehicle.vehicleType}
              onChange={(value) => onChange({ vehicleType: value })}
              options={[
                { value: "wheeled", label: "Wheeled — axles" },
                { value: "tracked", label: "Tracked — track patches" },
                { value: "custom", label: "Custom" },
              ]}
            />
          </Field>
          <Field label="Overall width">
            <NumberField value={vehicle.widthM} min={0.5} max={20} step={0.05} onChange={(value) => onChange({ widthM: value })} suffix="m" />
          </Field>
          <Field label="Overall length">
            <NumberField value={vehicle.lengthM} min={0} max={80} step={0.1} onChange={(value) => onChange({ lengthM: value })} suffix="m" />
          </Field>
          <Field label="Datum description">
            <TextField value={vehicle.datumDescription} onChange={(value) => onChange({ datumDescription: value })} />
          </Field>
        </div>

        {showProvenance && (
          <div className="mt-2 grid grid-cols-1 gap-2 rounded border border-white/[0.06] bg-ink-950/40 p-2 sm:grid-cols-2">
            <Field label="Source reference">
              <TextField value={vehicle.sourceReference} onChange={(value) => onChange({ sourceReference: value })} />
            </Field>
            <Field label="Code edition">
              <TextField value={vehicle.sourceEdition} onChange={(value) => onChange({ sourceEdition: value })} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Notes / limitations">
                <textarea
                  className="input min-h-[56px] resize-y"
                  value={vehicle.notes}
                  onChange={(event) => onChange({ notes: event.target.value })}
                />
              </Field>
            </div>
          </div>
        )}

        {issues.length > 0 && (
          <ul className="mt-2 space-y-1">
            {issues.map((issue, index) => (
              <li
                key={index}
                className={`rounded border px-2 py-1 text-[10.5px] ${
                  issue.level === "error"
                    ? "border-signal-red/30 bg-signal-red/10 text-signal-red"
                    : issue.level === "warning"
                      ? "border-signal-amber/30 bg-signal-amber/10 text-signal-amber"
                      : "border-white/[0.06] bg-ink-950/40 text-slate-500"
                }`}
              >
                {issue.message}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-2 flex items-center gap-2">
          <Button size="xs" variant="primary" onClick={onPlace}>Place on deck</Button>
          <span className="mono text-[10.5px] text-slate-500">
            {vehicle.vehicleType === "tracked"
              ? `${vehicle.tracks.length} tracks · ${fmt(totalLoad, 1)} kN`
              : `${vehicle.axles.length} axles · train ${fmt(axleTrain, 2)} m · ${fmt(totalLoad, 1)} kN`}
          </span>
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-slate-500">{vehicle.notes}</p>
      </Panel>

      {vehicle.vehicleType === "tracked" ? (
        <Panel title="Tracks" subtitle="contact patches, loads and transverse positions">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] border-separate border-spacing-0 text-[11px]">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-slate-500">
                  <th className="pb-1 pr-2 font-medium">Track</th>
                  <th className="pb-1 pr-2 font-medium">Load kN</th>
                  <th className="pb-1 pr-2 font-medium">Start u</th>
                  <th className="pb-1 pr-2 font-medium">End u</th>
                  <th className="pb-1 pr-2 font-medium">Centre v</th>
                  <th className="pb-1 pr-2 font-medium">Width</th>
                  <th className="pb-1 font-medium">Length</th>
                </tr>
              </thead>
              <tbody>
                {vehicle.tracks.map((track) => (
                  <tr key={track.id} className="border-t border-white/[0.05]">
                    <td className="py-1 pr-2">
                      <input
                        className="input-sm w-full min-w-[70px]"
                        value={track.label}
                        onChange={(event) => updateTrack(track.id, { label: event.target.value })}
                      />
                    </td>
                    <td className="py-1 pr-2"><NumberField value={track.loadKN} min={0} max={5000} step={5} onChange={(v) => updateTrack(track.id, { loadKN: v })} /></td>
                    <td className="py-1 pr-2"><NumberField value={track.longitudinalStartM} min={0} max={80} step={0.01} onChange={(v) => updateTrack(track.id, { longitudinalStartM: v })} /></td>
                    <td className="py-1 pr-2"><NumberField value={track.longitudinalEndM} min={0} max={80} step={0.01} onChange={(v) => updateTrack(track.id, { longitudinalEndM: v })} /></td>
                    <td className="py-1 pr-2"><NumberField value={track.transverseCentreM} min={-10} max={10} step={0.01} onChange={(v) => updateTrack(track.id, { transverseCentreM: v })} /></td>
                    <td className="py-1 pr-2"><NumberField value={track.widthM} min={0.05} max={5} step={0.01} onChange={(v) => updateTrack(track.id, { widthM: v })} /></td>
                    <td className="py-1 mono text-slate-400">{fmt(Math.abs(track.longitudinalEndM - track.longitudinalStartM), 3)} m</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Button
              size="xs"
              onClick={() =>
                onChange({
                  tracks: [
                    ...vehicle.tracks,
                    {
                      id: `track-${vehicle.tracks.length + 1}`,
                      label: `Track ${vehicle.tracks.length + 1}`,
                      loadKN: 100,
                      longitudinalStartM: 0,
                      longitudinalEndM: 4,
                      transverseCentreM: 0,
                      widthM: 0.5,
                    },
                  ],
                })
              }
            >
              Add track
            </Button>
            <span className="text-[10px] text-slate-500">Track loads are split into slices for moving-load and static transfer.</span>
          </div>
        </Panel>
      ) : (
        <Panel
          title="Axles and wheels"
          subtitle="loads, longitudinal offsets from the datum, transverse gauge and contact patches"
          actions={
            <Button
              size="xs"
              onClick={() => {
                const last = vehicle.axles[vehicle.axles.length - 1];
                onChange({
                  axles: [
                    ...vehicle.axles,
                    {
                      id: `axle-${vehicle.axles.length + 1}-${Math.random().toString(36).slice(2, 6)}`,
                      label: `A${vehicle.axles.length + 1}`,
                      loadKN: last?.loadKN ?? 100,
                      longitudinalOffsetM: (last?.longitudinalOffsetM ?? 0) + 3,
                      wheelLoadsKN: [(last?.loadKN ?? 100) / 2, (last?.loadKN ?? 100) / 2],
                      trackSpacingM: last?.trackSpacingM ?? 1.8,
                      wheelWidthM: last?.wheelWidthM ?? 0.4,
                      wheelLengthM: last?.wheelLengthM ?? 0.25,
                    },
                  ],
                });
              }}
            >
              Add axle
            </Button>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[780px] border-separate border-spacing-0 text-[11px]">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-slate-500">
                  <th className="pb-1 pr-2 font-medium">Axle</th>
                  <th className="pb-1 pr-2 font-medium">Load kN</th>
                  <th className="pb-1 pr-2 font-medium">Offset u</th>
                  <th className="pb-1 pr-2 font-medium">Gauge c/c</th>
                  <th className="pb-1 pr-2 font-medium">Contact w</th>
                  <th className="pb-1 pr-2 font-medium">Contact l</th>
                  <th className="pb-1 pr-2 font-medium">Wheel loads kN</th>
                  <th className="pb-1 font-medium" />
                </tr>
              </thead>
              <tbody>
                {vehicle.axles.map((axle) => (
                  <tr key={axle.id} className="border-t border-white/[0.05]">
                    <td className="py-1 pr-2">
                      <input className="input-sm w-12" value={axle.label} onChange={(event) => updateAxle(axle.id, { label: event.target.value })} />
                    </td>
                    <td className="py-1 pr-2"><NumberField value={axle.loadKN} min={0} max={5000} step={5} onChange={(v) => updateAxle(axle.id, { loadKN: v })} /></td>
                    <td className="py-1 pr-2"><NumberField value={axle.longitudinalOffsetM} min={-20} max={80} step={0.01} onChange={(v) => updateAxle(axle.id, { longitudinalOffsetM: v })} /></td>
                    <td className="py-1 pr-2"><NumberField value={axle.trackSpacingM} min={0} max={10} step={0.01} onChange={(v) => updateAxle(axle.id, { trackSpacingM: v })} /></td>
                    <td className="py-1 pr-2"><NumberField value={axle.wheelWidthM} min={0} max={2} step={0.01} onChange={(v) => updateAxle(axle.id, { wheelWidthM: v })} /></td>
                    <td className="py-1 pr-2"><NumberField value={axle.wheelLengthM} min={0} max={2} step={0.01} onChange={(v) => updateAxle(axle.id, { wheelLengthM: v })} /></td>
                    <td className="py-1 pr-2">
                      <div className="flex items-center gap-1">
                        <input
                          className="input-sm w-14 mono"
                          value={axle.wheelLoadsKN.map((w) => fmt(w, 3)).join(" ")}
                          onChange={(event) => {
                            const values = event.target.value
                              .split(/[\s,]+/)
                              .map((t) => Number(t))
                              .filter((n) => Number.isFinite(n));
                            updateAxle(axle.id, { wheelLoadsKN: values, loadKN: round(sum(values), 4) });
                          }}
                        />
                        <span className="text-[9px] text-slate-600">Σ {fmt(sum(axle.wheelLoadsKN), 2)}</span>
                      </div>
                    </td>
                    <td className="py-1 text-right">
                      <button
                        type="button"
                        className="text-[10px] text-slate-500 hover:text-signal-red"
                        onClick={() => onChange({ axles: vehicle.axles.filter((a) => a.id !== axle.id) })}
                      >
                        remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="stat">
              <div className="stat-label">Total load</div>
              <div className="stat-value">{fmt(totalLoad, 1)} kN</div>
            </div>
            <div className="stat">
              <div className="stat-label">Axle train</div>
              <div className="stat-value">{fmt(axleTrain, 2)} m</div>
            </div>
            <div className="stat">
              <div className="stat-label">Wheel gauge</div>
              <div className="stat-value">{fmt(vehicle.axles[0]?.trackSpacingM ?? 0, 2)} m</div>
            </div>
            <div className="stat">
              <div className="stat-label">Provenance</div>
              <div className="stat-value text-[11px]">{vehicle.provenance.replace(/-/g, " ")}</div>
            </div>
          </div>
          <Hint>
            Editing a reference preset marks it as user-modified so it can never be mistaken for verified IRC data. Wheel loads must
            sum to the axle load; the validation panel enforces this before any syntax is emitted.
          </Hint>
        </Panel>
      )}
    </div>
  );
}
