import { useMemo } from "react";
import { useStudio } from "../../store/studio";
import type { PlacementMode, VehicleReference } from "../../types";
import {
  REFERENCE_LABELS,
  computeClearance,
  deckLayout,
  edgeBoundaryZd,
  laneCentreZd,
  relativeExtents,
  resolvePlacement,
  vehicleFootprint,
  vehicleTotalLoadKN,
} from "../../lib/geometry";
import type { EdgeDatum } from "../../types";
import { fmt, round } from "../../lib/units";
import { Button, EmptyState, Field, Hint, NumberField, Panel, Select, TextField } from "../ui";

const MODE_OPTIONS: Array<{ value: PlacementMode; label: string }> = [
  { value: "free", label: "Free placement" },
  { value: "edge", label: "Edge clearance" },
  { value: "lane", label: "Lane alignment" },
  { value: "centreline", label: "Deck centreline" },
  { value: "coordinate", label: "Exact coordinates" },
];

const REFERENCE_OPTIONS = (Object.keys(REFERENCE_LABELS) as VehicleReference[]).map((value) => ({
  value,
  label: REFERENCE_LABELS[value],
}));

const DATUM_OPTIONS: Array<{ value: EdgeDatum; label: string }> = [
  { value: "carriageway", label: "Carriageway / kerb face" },
  { value: "barrier", label: "Barrier inner face" },
  { value: "deck-edge", label: "Deck edge" },
];

export function VehicleInspector() {
  const placements = useStudio((s) => s.placements);
  const vehicles = useStudio((s) => s.vehicles);
  const deck = useStudio((s) => s.deck);
  const model = useStudio((s) => s.model);
  const selectedId = useStudio((s) => s.selectedPlacementId);
  const selectVehicle = useStudio((s) => s.selectVehicle);
  const updatePlacement = useStudio((s) => s.updatePlacement);
  const addPlacement = useStudio((s) => s.addPlacement);
  const removePlacement = useStudio((s) => s.removePlacement);
  const duplicatePlacement = useStudio((s) => s.duplicatePlacement);
  const layout = deckLayout(deck);

  const placement = placements.find((p) => p.id === selectedId);
  const vehicle = placement ? vehicles.find((v) => v.id === placement.vehicleId) : undefined;

  const derived = useMemo(() => {
    if (!placement || !vehicle) return null;
    const resolved = resolvePlacement(vehicle, placement, layout, model.trackTrackPoints);
    const fp = vehicleFootprint(vehicle, placement, layout, model.trackTrackPoints);
    const clearance = computeClearance(fp, layout);
    const ext = relativeExtents(vehicle, placement, model.trackTrackPoints);
    return { resolved, fp, clearance, ext };
  }, [placement, vehicle, layout, model.trackTrackPoints]);

  const addFromLibrary = () => {
    const chosen = useStudio.getState().selectedVehicleId ?? vehicles[0]?.id;
    if (!chosen) return;
    addPlacement(chosen, deck.spanM / 2, layout.lanes[0]?.centreZd ?? 0, {
      mode: "lane",
      lane: { laneIndex: 0 },
      referencePoint: "vehicle-centre",
    });
  };

  return (
    <Panel
      title="Vehicle inspector"
      subtitle={placement ? `${placement.label} · ${vehicle?.shortName ?? "unknown vehicle"}` : "no selection"}
      actions={
        <div className="flex items-center gap-1">
          <Button size="xs" onClick={addFromLibrary} title="Place the vehicle selected in the library">
            Add
          </Button>
          <Button size="xs" variant="ghost" onClick={() => duplicatePlacement(placement?.id ?? "")} disabled={!placement}>
            Copy
          </Button>
          <Button size="xs" variant="ghost" className="text-signal-red/80" onClick={() => removePlacement(placement?.id ?? "")} disabled={!placement}>
            Del
          </Button>
        </div>
      }
    >
      {!placement || !vehicle || !derived ? (
        <EmptyState title="Select a vehicle on the plan">
          Click a vehicle to inspect its geometry, loads, reference point and clearances. Select a library vehicle and use the
          place tool to add a new one.
        </EmptyState>
      ) : (
        <div className="space-y-2.5">
          <div className="grid grid-cols-[1fr_58px] gap-2">
            <Field label="Vehicle definition">
              <Select
                value={vehicle.id}
                onChange={(value) => {
                  updatePlacement(placement.id, { vehicleId: value });
                  selectVehicle(value);
                }}
                options={vehicles.map((v) => ({ value: v.id, label: v.name }))}
              />
            </Field>
            <Field label="Label">
              <TextField value={placement.label} onChange={(value) => updatePlacement(placement.id, { label: value.toUpperCase().slice(0, 6) })} />
            </Field>
          </div>

          <Field label="Reference point used for coordinates">
            <Select
              value={placement.referencePoint}
              onChange={(value) => updatePlacement(placement.id, { referencePoint: value })}
              options={REFERENCE_OPTIONS}
            />
          </Field>
          <Hint>
            {vehicle.shortName}: datum is {vehicle.datumDescription}. The selected reference point is what the coordinates and the
            edge-clearance constraint are measured to — it is not necessarily the vehicle centre.
          </Hint>

          <Field label="Placement mode">
            <Select
              value={placement.mode}
              onChange={(value) => {
                if (value === "edge") {
                  updatePlacement(placement.id, {
                    mode: "edge",
                    edge: placement.edge ?? { side: "left", datum: "carriageway", clearanceM: 1.2 },
                  });
                } else if (value === "lane") {
                  updatePlacement(placement.id, { mode: "lane", lane: placement.lane ?? { laneIndex: 0 } });
                } else {
                  updatePlacement(placement.id, { mode: value });
                }
              }}
              options={MODE_OPTIONS}
            />
          </Field>

          {placement.mode === "edge" && placement.edge && (
            <div className="rounded border border-white/[0.06] bg-ink-950/40 p-2">
              <div className="grid grid-cols-2 gap-2">
                <Field label="Edge">
                  <Select
                    value={placement.edge.side}
                    onChange={(side) => updatePlacement(placement.id, { edge: { ...placement.edge!, side } })}
                    options={[
                      { value: "left", label: "+Zd (left)" },
                      { value: "right", label: "−Zd (right)" },
                    ]}
                  />
                </Field>
                <Field label="Measured from">
                  <Select
                    value={placement.edge.datum}
                    onChange={(datum) => updatePlacement(placement.id, { edge: { ...placement.edge!, datum } })}
                    options={DATUM_OPTIONS}
                  />
                </Field>
              </div>
              <Field label="Clearance to wheel/track outer edge" className="mt-2">
                <NumberField
                  value={placement.edge.clearanceM}
                  min={-10}
                  max={50}
                  step={0.05}
                  onChange={(clearanceM) => updatePlacement(placement.id, { edge: { ...placement.edge!, clearanceM } })}
                  suffix="m"
                />
              </Field>
              <p className="mt-1 text-[10px] text-slate-500">
                Outer edge of the nearest wheel/track, including the contact-patch width: derived Zd ={" "}
                <span className="mono text-slate-300">{fmt(derived.resolved.transverseM, 3)} m</span>
              </p>
            </div>
          )}

          {placement.mode === "lane" && (
            <Field label="Lane">
              <Select
                value={placement.lane?.laneIndex ?? 0}
                onChange={(laneIndex) => updatePlacement(placement.id, { lane: { laneIndex } })}
                options={layout.lanes.map((lane) => ({
                  value: lane.index,
                  label: `Lane ${lane.index + 1} · centre Zd ${fmt(lane.centreZd, 2)} m · ${fmt(lane.widthM, 2)} m`,
                }))}
              />
            </Field>
          )}

          {(placement.mode === "free" || placement.mode === "coordinate" || placement.mode === "lane" || placement.mode === "centreline") && (
            <div className="grid grid-cols-2 gap-2">
              <Field label="Longitudinal Xd">
                <NumberField
                  value={derived.resolved.longitudinalM}
                  step={0.05}
                  onChange={(value) => updatePlacement(placement.id, { longitudinalM: value })}
                  suffix="m"
                />
              </Field>
              <Field label="Transverse Zd">
                <NumberField
                  value={derived.resolved.transverseM}
                  step={0.05}
                  disabled={placement.mode !== "free" && placement.mode !== "coordinate"}
                  onChange={(value) => updatePlacement(placement.id, { transverseM: value, mode: "coordinate" })}
                  suffix="m"
                />
              </Field>
            </div>
          )}

          {placement.mode === "edge" && (
            <div className="grid grid-cols-2 gap-2">
              <Field label="Longitudinal Xd">
                <NumberField
                  value={derived.resolved.longitudinalM}
                  step={0.05}
                  onChange={(value) => updatePlacement(placement.id, { longitudinalM: value })}
                  suffix="m"
                />
              </Field>
              <div className="flex items-end pb-1.5 text-[10px] text-slate-500">transverse is solved from the clearance</div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <Field label="Rotation">
              <NumberField
                value={placement.rotationDeg}
                min={-180}
                max={180}
                step={1}
                precision={2}
                onChange={(value) => updatePlacement(placement.id, { rotationDeg: value })}
                suffix="°"
              />
            </Field>
            <Field label="Load case no." hint="Blank = auto">
              <NumberField
                value={placement.loadCaseNumber ?? 0}
                min={0}
                max={99999}
                step={1}
                precision={0}
                onChange={(value) => updatePlacement(placement.id, { loadCaseNumber: value > 0 ? Math.round(value) : undefined })}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <ToggleRow label="Locked" active={placement.locked} onClick={() => updatePlacement(placement.id, { locked: !placement.locked })} />
            <ToggleRow label="Visible" active={placement.visible} onClick={() => updatePlacement(placement.id, { visible: !placement.visible })} />
          </div>

          <div className="divider" />

          <div className="grid grid-cols-3 gap-1.5">
            <div className="stat">
              <div className="stat-label">Total load</div>
              <div className="stat-value">{fmt(vehicleTotalLoadKN(vehicle), 0)} kN</div>
            </div>
            <div className="stat">
              <div className="stat-label">{vehicle.vehicleType === "tracked" ? "Track c/c" : "Gauge"}</div>
              <div className="stat-value">
                {vehicle.vehicleType === "tracked"
                  ? fmt(Math.abs((vehicle.tracks[0]?.transverseCentreM ?? 0) - (vehicle.tracks[1]?.transverseCentreM ?? 0)), 2)
                  : fmt(vehicle.axles[0]?.trackSpacingM ?? 0, 2)}{" "}
                m
              </div>
            </div>
            <div className="stat">
              <div className="stat-label">Vehicle width</div>
              <div className="stat-value">{fmt(vehicle.widthM, 2)} m</div>
            </div>
          </div>

          <div className="space-y-1 rounded border border-white/[0.06] bg-ink-950/40 px-2 py-1.5 text-[10.5px]">
            <Readout label="Clearance +Zd barrier" value={`${fmt(derived.clearance.toLeftBarrierM, 3)} m`} tone={derived.clearance.toLeftBarrierM < 0 ? "bad" : derived.clearance.toLeftBarrierM < 0.15 ? "warn" : "ok"} />
            <Readout label="Clearance −Zd barrier" value={`${fmt(derived.clearance.toRightBarrierM, 3)} m`} tone={derived.clearance.toRightBarrierM < 0 ? "bad" : derived.clearance.toRightBarrierM < 0.15 ? "warn" : "ok"} />
            <Readout label="Beyond start / end" value={`${fmt(derived.clearance.beyondStartM, 3)} / ${fmt(derived.clearance.beyondEndM, 3)} m`} tone={derived.clearance.beyondStartM < 0 || derived.clearance.beyondEndM < 0 ? "bad" : "ok"} />
            <Readout label="Occupy carriageway" value={derived.clearance.insideCarriageway ? "yes" : "no"} tone={derived.clearance.insideCarriageway ? "ok" : "warn"} />
            <Readout
              label="Longitudinal extent"
              value={`${fmt(derived.fp.bounds.minXd, 2)} … ${fmt(derived.fp.bounds.maxXd, 2)} m`}
              tone="neutral"
            />
            <Readout
              label="Transverse extent"
              value={`${fmt(derived.fp.bounds.minZd, 2)} … ${fmt(derived.fp.bounds.maxZd, 2)} m`}
              tone="neutral"
            />
          </div>

          <WheelTable
            rows={derived.fp.wheels.map((wheel) => ({
              id: wheel.id,
              label: wheel.axleLabel,
              side: wheel.side,
              localU: wheel.localU,
              localV: wheel.localV,
              xd: wheel.xd,
              zd: wheel.zd,
              loadKN: wheel.loadKN,
            }))}
            totalKN={derived.fp.wheels.reduce((acc, w) => acc + w.loadKN, 0)}
            points={derived.fp.wheels.length}
          />

          {placement.mode === "lane" && placement.lane && (
            <p className="text-[10px] text-slate-500">
              Lane centre Zd = {fmt(laneCentreZd(layout, placement.lane.laneIndex), 3)} m; vehicle centreline is aligned to it and the
              reference point is offset by {fmt(round(relativeExtents(vehicle, placement).relZdMax, 3))} m of envelope.
            </p>
          )}
          {placement.mode === "edge" && placement.edge && (
            <p className="text-[10px] text-slate-500">
              Boundary at {fmt(edgeBoundaryZd(layout, placement.edge.side, placement.edge.datum), 3)} m; outer wheel/track edge sits at{" "}
              {fmt(placement.edge.side === "left" ? derived.fp.bounds.maxZd : derived.fp.bounds.minZd, 3)} m.
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}

function WheelTable({
  rows,
  totalKN,
  points,
}: {
  rows: Array<{ id: string; label: string; side: 1 | -1 | 0; localU: number; localV: number; xd: number; zd: number; loadKN: number }>;
  totalKN: number;
  points: number;
}) {
  return (
    <details className="rounded border border-white/[0.06] bg-ink-950/40">
      <summary className="cursor-pointer select-none px-2 py-1 text-[10.5px] text-slate-400">
        Load application points · {points} × wheel/track slice · Σ {fmt(totalKN, 2)} kN
      </summary>
      <div className="max-h-44 overflow-auto px-1 pb-1">
        <table className="mono w-full text-[9.5px]">
          <thead className="sticky top-0 bg-ink-950/95 text-slate-600">
            <tr>
              <th className="px-1 py-0.5 text-left font-normal">point</th>
              <th className="px-1 py-0.5 text-right font-normal">u</th>
              <th className="px-1 py-0.5 text-right font-normal">v</th>
              <th className="px-1 py-0.5 text-right font-normal">Xd</th>
              <th className="px-1 py-0.5 text-right font-normal">Zd</th>
              <th className="px-1 py-0.5 text-right font-normal">kN</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-white/[0.04] text-slate-400">
                <td className="px-1 py-0.5 text-left text-slate-300">
                  {row.label}
                  {row.side !== 0 ? (row.side > 0 ? " +" : " −") : ""}
                </td>
                <td className="px-1 py-0.5 text-right">{fmt(row.localU, 2)}</td>
                <td className="px-1 py-0.5 text-right">{fmt(row.localV, 2)}</td>
                <td className="px-1 py-0.5 text-right">{fmt(row.xd, 3)}</td>
                <td className="px-1 py-0.5 text-right">{fmt(row.zd, 3)}</td>
                <td className="px-1 py-0.5 text-right text-signal-amber/90">{fmt(row.loadKN, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-white/[0.05] px-2 py-1 text-[9.5px] leading-relaxed text-slate-600">
        Local u/v are measured from the vehicle datum and centreline. Xd/Zd are the deck coordinates in metres that the static
        generator transfers to joints.
      </p>
    </details>
  );
}

function ToggleRow({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center justify-between rounded border px-2 py-1 text-[11px] transition ${
        active ? "border-cyan-400/40 bg-cyan-500/10 text-cyan-200" : "border-white/10 bg-ink-950/40 text-slate-400 hover:text-slate-200"
      }`}
    >
      {label}
      <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-cyan-300" : "bg-slate-600"}`} />
    </button>
  );
}

function Readout({ label, value, tone }: { label: string; value: string; tone: "ok" | "warn" | "bad" | "neutral" }) {
  const color = tone === "bad" ? "text-signal-red" : tone === "warn" ? "text-signal-amber" : tone === "ok" ? "text-signal-green" : "text-slate-300";
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-slate-500">{label}</span>
      <span className={`mono ${color}`}>{value}</span>
    </div>
  );
}
