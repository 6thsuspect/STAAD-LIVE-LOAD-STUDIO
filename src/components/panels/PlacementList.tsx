import { useStudio } from "../../store/studio";
import { computeClearance, deckLayout, resolvePlacement, vehicleFootprint, vehicleTotalLoadKN } from "../../lib/geometry";
import { fmt } from "../../lib/units";
import { Button, EmptyState, Panel } from "../ui";

export function PlacementList() {
  const placements = useStudio((s) => s.placements);
  const vehicles = useStudio((s) => s.vehicles);
  const deck = useStudio((s) => s.deck);
  const model = useStudio((s) => s.model);
  const selectedId = useStudio((s) => s.selectedPlacementId);
  const selectPlacement = useStudio((s) => s.selectPlacement);
  const updatePlacement = useStudio((s) => s.updatePlacement);
  const removePlacement = useStudio((s) => s.removePlacement);
  const duplicatePlacement = useStudio((s) => s.duplicatePlacement);
  const layout = deckLayout(deck);

  return (
    <Panel
      title="Placed vehicles"
      subtitle={`${placements.length} placement${placements.length === 1 ? "" : "s"}`}
      actions={
        <span className="text-[10px] text-slate-500">Del · Ctrl+D</span>
      }
    >
      {placements.length === 0 ? (
        <EmptyState title="No vehicles placed">
          Pick a vehicle in the library, then use the Place tool on the plan, or add one from the vehicle inspector.
        </EmptyState>
      ) : (
        <ul className="space-y-1">
          {placements.map((placement) => {
            const vehicle = vehicles.find((v) => v.id === placement.vehicleId);
            const selected = placement.id === selectedId;
            let note = "no vehicle";
            let clearance = "";
            if (vehicle) {
              const fp = vehicleFootprint(vehicle, placement, layout, model.trackTrackPoints);
              const resolved = resolvePlacement(vehicle, placement, layout, model.trackTrackPoints);
              const report = computeClearance(fp, layout);
              note = `Xd ${fmt(resolved.longitudinalM, 2)} · Zd ${fmt(resolved.transverseM, 2)}`;
              clearance =
                report.toLeftBarrierM < -1e-6 || report.toRightBarrierM < -1e-6
                  ? "barrier interference"
                  : !report.insideCarriageway
                    ? "off carriageway"
                    : `clearance ${fmt(Math.min(report.toLeftBarrierM, report.toRightBarrierM), 2)} m`;
            }
            return (
              <li
                key={placement.id}
                className={`group rounded border px-2 py-1.5 transition ${
                  selected ? "border-cyan-400/40 bg-cyan-500/[0.07]" : "border-white/[0.06] bg-ink-950/30 hover:border-white/15"
                }`}
              >
                <button type="button" className="flex w-full items-start gap-2 text-left" onClick={() => selectPlacement(placement.id)}>
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-sm" style={{ background: placement.color }} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="text-[12px] font-semibold text-slate-200">{placement.label}</span>
                      <span className="truncate text-[11px] text-slate-400">{vehicle?.shortName ?? "—"}</span>
                      {placement.locked && <span className="text-[9px] text-slate-500">LOCKED</span>}
                      {!placement.visible && <span className="text-[9px] text-slate-500">HIDDEN</span>}
                    </span>
                    <span className="mono mt-0.5 block text-[10.5px] text-slate-500">{note}</span>
                    <span
                      className={`mt-0.5 block text-[10px] ${
                        clearance === "barrier interference" ? "text-signal-red" : clearance === "off carriageway" ? "text-signal-amber" : "text-slate-500"
                      }`}
                    >
                      {clearance}
                      {vehicle ? ` · ${fmt(vehicleTotalLoadKN(vehicle), 0)} kN` : ""}
                    </span>
                  </span>
                </button>
                <div className="mt-1 flex items-center gap-1 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                  <Button size="xs" variant="ghost" onClick={() => updatePlacement(placement.id, { visible: !placement.visible })}>
                    {placement.visible ? "Hide" : "Show"}
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => updatePlacement(placement.id, { locked: !placement.locked })}>
                    {placement.locked ? "Unlock" : "Lock"}
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => duplicatePlacement(placement.id)}>
                    Duplicate
                  </Button>
                  <Button size="xs" variant="ghost" className="ml-auto text-signal-red/80" onClick={() => removePlacement(placement.id)}>
                    Delete
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
