import { useStudio } from "../../store/studio";
import { deckLayout } from "../../lib/geometry";
import { fmt, round } from "../../lib/units";
import { Button, Field, Hint, NumberField, Panel, Segmented, Select } from "../ui";

export function GeometryPanel() {
  const deck = useStudio((s) => s.deck);
  const setDeck = useStudio((s) => s.setDeck);
  const layout = deckLayout(deck);

  const updateLaneWidth = (index: number, width: number) => {
    const next = deck.laneWidthsM.length === deck.laneCount ? [...deck.laneWidthsM] : [...layout.laneWidthsM];
    next[index] = width;
    setDeck({ laneWidthsM: next, laneWidthMode: "custom" });
  };

  const distributeLanes = () => {
    setDeck({ laneWidthMode: "equal", laneWidthsM: Array.from({ length: deck.laneCount }, () => round(layout.carriagewayWidthM / deck.laneCount, 4)) });
  };

  const autoCarriageway = () => {
    const derived =
      deck.totalWidthM -
      deck.leftBarrierWidthM -
      deck.rightBarrierWidthM -
      deck.leftFootpathWidthM -
      deck.rightFootpathWidthM -
      deck.leftKerbWidthM -
      deck.rightKerbWidthM;
    setDeck({ carriagewayWidthM: round(Math.max(0, derived), 4), laneWidthMode: "equal", laneWidthsM: [] });
  };

  const componentSum =
    deck.carriagewayWidthM +
    deck.leftBarrierWidthM +
    deck.rightBarrierWidthM +
    deck.leftFootpathWidthM +
    deck.rightFootpathWidthM +
    deck.leftKerbWidthM +
    deck.rightKerbWidthM;
  const consistent = Math.abs(componentSum - deck.totalWidthM) <= 0.005;

  return (
    <Panel
      title="Bridge & deck geometry"
      subtitle={`${fmt(layout.spanM)} m span · ${fmt(layout.carriagewayWidthM)} m carriageway`}
      actions={<span className="text-[10px] text-slate-500">metres</span>}
    >
      <div className="grid grid-cols-2 gap-2">
        <Field label="Bridge span" htmlFor="geo-span">
          <NumberField id="geo-span" value={deck.spanM} min={0.5} max={2000} step={0.5} onChange={(v) => setDeck({ spanM: v })} suffix="m" />
        </Field>
        <Field label="Total deck width" htmlFor="geo-width">
          <NumberField id="geo-width" value={deck.totalWidthM} min={1} max={200} step={0.25} onChange={(v) => setDeck({ totalWidthM: v })} suffix="m" />
        </Field>
        <Field label="Carriageway" htmlFor="geo-cw">
          <NumberField id="geo-cw" value={deck.carriagewayWidthM} min={0} max={200} step={0.25} onChange={(v) => setDeck({ carriagewayWidthM: v })} suffix="m" />
        </Field>
        <Field label="Lanes" htmlFor="geo-lanes">
          <NumberField
            id="geo-lanes"
            value={deck.laneCount}
            min={1}
            max={12}
            step={1}
            precision={0}
            onChange={(v) => setDeck({ laneCount: Math.round(v), laneWidthMode: "equal", laneWidthsM: [] })}
          />
        </Field>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <Field label="Left barrier" htmlFor="geo-lb">
          <NumberField id="geo-lb" value={deck.leftBarrierWidthM} min={0} max={5} step={0.05} onChange={(v) => setDeck({ leftBarrierWidthM: v })} suffix="m" />
        </Field>
        <Field label="Right barrier" htmlFor="geo-rb">
          <NumberField id="geo-rb" value={deck.rightBarrierWidthM} min={0} max={5} step={0.05} onChange={(v) => setDeck({ rightBarrierWidthM: v })} suffix="m" />
        </Field>
        <Field label="Left footpath" htmlFor="geo-lf">
          <NumberField id="geo-lf" value={deck.leftFootpathWidthM} min={0} max={5} step={0.05} onChange={(v) => setDeck({ leftFootpathWidthM: v })} suffix="m" />
        </Field>
        <Field label="Right footpath" htmlFor="geo-rf">
          <NumberField id="geo-rf" value={deck.rightFootpathWidthM} min={0} max={5} step={0.05} onChange={(v) => setDeck({ rightFootpathWidthM: v })} suffix="m" />
        </Field>
        <Field label="Left kerb" htmlFor="geo-lk">
          <NumberField id="geo-lk" value={deck.leftKerbWidthM} min={0} max={3} step={0.05} onChange={(v) => setDeck({ leftKerbWidthM: v })} suffix="m" />
        </Field>
        <Field label="Right kerb" htmlFor="geo-rk">
          <NumberField id="geo-rk" value={deck.rightKerbWidthM} min={0} max={3} step={0.05} onChange={(v) => setDeck({ rightKerbWidthM: v })} suffix="m" />
        </Field>
      </div>

      <div className={`mt-2 rounded border px-2 py-1.5 text-[10.5px] ${consistent ? "border-white/[0.06] bg-ink-950/40 text-slate-500" : "border-signal-red/40 bg-signal-red/10 text-signal-red"}`}>
        <div className="flex items-center justify-between">
          <span>barriers + footpaths + kerbs + carriageway</span>
          <span className="mono">
            {fmt(componentSum)} / {fmt(deck.totalWidthM)} m
          </span>
        </div>
        {!consistent && <p className="mt-1">Widths are inconsistent. Adjust a component or the total width.</p>}
      </div>

      <div className="mt-2 flex items-center gap-2">
        <Button size="xs" onClick={autoCarriageway} title="Carriageway = total width − barriers − footpaths − kerbs">
          Recompute carriageway
        </Button>
        <Button size="xs" onClick={distributeLanes}>
          Equal lanes
        </Button>
        <span className="ml-auto text-[10px] text-slate-500">
          {layout.lanes.length} lane{layout.lanes.length === 1 ? "" : "s"} · {fmt(layout.laneWidthsM[0] ?? 0)} m
        </span>
      </div>

      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between">
          <span className="field-label">Lane widths (from +Zd / left edge)</span>
          <Segmented
            size="sm"
            value={deck.laneWidthMode}
            onChange={(value) => {
              if (value === "equal") distributeLanes();
              else setDeck({ laneWidthMode: "custom", laneWidthsM: [...layout.laneWidthsM] });
            }}
            options={[
              { value: "equal", label: "equal" },
              { value: "custom", label: "custom" },
            ]}
          />
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {layout.lanes.map((lane) => (
            <div key={lane.index} className="flex items-center gap-1.5">
              <span className="w-5 text-[10px] text-slate-500">L{lane.index + 1}</span>
              <NumberField
                value={lane.widthM}
                min={0.5}
                max={30}
                step={0.05}
                onChange={(value) => updateLaneWidth(lane.index, value)}
                className="flex-1"
                ariaLabel={`Lane ${lane.index + 1} width`}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Field label="Longitudinal origin">
          <Select
            value={deck.longitudinalOrigin}
            onChange={(value) => setDeck({ longitudinalOrigin: value })}
            options={[
              { value: "left-end", label: "Start abutment" },
              { value: "centre", label: "Span centre" },
            ]}
          />
        </Field>
        <Field label="Transverse origin">
          <Select
            value={deck.transverseOrigin}
            onChange={(value) => setDeck({ transverseOrigin: value })}
            options={[
              { value: "centreline", label: "Deck centreline" },
              { value: "left-edge", label: "Left deck edge" },
            ]}
          />
        </Field>
      </div>

      <Hint>
        Internal coordinates always run from the start abutment (Xd = 0) with Zd = 0 on the deck centreline, +Zd towards the
        left edge. The origin settings change display labels only, so stored engineering values never move.
      </Hint>

      <div className="mt-2 grid grid-cols-3 gap-1.5">
        <div className="stat">
          <div className="stat-label">+Zd kerb face</div>
          <div className="stat-value">{fmt(layout.leftCarriagewayEdgeZd)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">−Zd kerb face</div>
          <div className="stat-value">{fmt(layout.rightCarriagewayEdgeZd)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Kerb height</div>
          <div className="stat-value">{fmt(deck.kerbHeightM)}</div>
        </div>
      </div>
    </Panel>
  );
}
