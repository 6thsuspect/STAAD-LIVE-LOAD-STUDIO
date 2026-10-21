import { useRef, useState } from "react";
import { currentProject, useStudio } from "../../store/studio";
import type { Axis } from "../../types";
import { describeMapping, mappingIssues } from "../../lib/coords";
import { getAdapter } from "../../lib/syntax/adapters";
import { parseStructuralModel } from "../../lib/syntax/model";
import { tokenizeSource } from "../../lib/syntax/tokenize";
import { fmt } from "../../lib/units";
import { generateDocument } from "../../lib/syntax/document";
import { downloadText, slugify } from "../../lib/download";
import { Button, CopyButton, Field, Hint, NumberField, Panel, Select, TextField, Toggle } from "../ui";

export function SettingsPanel() {
  const state = useStudio();
  const project = currentProject(state);
  const settings = state.settings;
  const mapping = settings.coordMapping;
  const [modelText, setModelText] = useState("");
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const adapter = getAdapter(settings.staadVersion);
  const issues = mappingIssues(mapping);

  const importModel = () => {
    const fragment = parseStructuralModel(tokenizeSource(modelText));
    if (!fragment.nodes.length) {
      setImportMessage("No JOINT COORDINATES block was found in the pasted text.");
      return;
    }
    state.setModel({
      nodes: fragment.nodes,
      members: fragment.members,
      quads: fragment.quads,
      sourceLabel: "Imported from pasted STAAD.Pro text",
      loadTransfer: fragment.quads.length ? "four-node-bilinear" : fragment.members.length ? "two-node-lever" : "nearest-node",
    });
    setImportMessage(
      `Imported ${fragment.nodes.length} joints, ${fragment.members.length} members and ${fragment.quads.length} quads.` +
        (fragment.diagnostics.length ? ` ${fragment.diagnostics.length} note(s).` : ""),
    );
  };

  const slug = slugify(settings.projectName);
  const downloadStaad = () => {
    const doc = generateDocument(project);
    downloadText(`${slug}-${settings.workflow}-loads.std`, doc.text, "text/plain;charset=utf-8");
  };

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-auto p-3 xl:grid-cols-2">
      <div className="space-y-3">
        <Panel title="Project" subtitle="identity and target release">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Project name" className="col-span-2">
              <TextField value={settings.projectName} onChange={(value) => state.setSettings({ projectName: value })} />
            </Field>
            <Field label="Project number">
              <TextField value={settings.projectNumber} onChange={(value) => state.setSettings({ projectNumber: value })} />
            </Field>
            <Field label="Engineer">
              <TextField value={settings.engineer} onChange={(value) => state.setSettings({ engineer: value })} />
            </Field>
            <Field label="STAAD.Pro version">
              <Select
                value={settings.staadVersion}
                onChange={(staadVersion) => state.setSettings({ staadVersion })}
                options={[
                  { value: "2022", label: "STAAD.Pro 2022" },
                  { value: "2025", label: "STAAD.Pro 2025" },
                ]}
              />
            </Field>
            <Field label="Workflow">
              <Select
                value={settings.workflow}
                onChange={(workflow) => state.setSettings({ workflow })}
                options={[
                  { value: "moving", label: "Moving-load generation" },
                  { value: "static", label: "Explicit static placement" },
                ]}
              />
            </Field>
          </div>
          <div className="mt-2 rounded border border-white/[0.06] bg-ink-950/40 px-2 py-1.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-400">{adapter.label}</span>
              <span className={adapter.status === "verified" ? "text-signal-green" : "text-signal-amber"}>{adapter.status}</span>
            </div>
            <p className="mt-1 text-[10px] leading-relaxed text-slate-500">{adapter.statusNote}</p>
            <p className="mt-1 text-[10px] leading-relaxed text-slate-600">
              Both adapters share one grammar. No verified difference between 2022 and 2025 has been established for these commands,
              so none is simulated.
            </p>
          </div>
        </Panel>

        <Panel title="Coordinate mapping" subtitle="deck coordinates → STAAD.Pro global coordinates">
          <div className="grid grid-cols-3 gap-2">
            <Field label="Longitudinal Xd">
              <Select
                value={mapping.longitudinalAxis}
                onChange={(axis: Axis) => state.setSettings({ coordMapping: { ...mapping, longitudinalAxis: axis } })}
                options={[{ value: "X", label: "X" }, { value: "Y", label: "Y" }, { value: "Z", label: "Z" }]}
              />
            </Field>
            <Field label="Transverse Zd">
              <Select
                value={mapping.transverseAxis}
                onChange={(axis: Axis) => state.setSettings({ coordMapping: { ...mapping, transverseAxis: axis } })}
                options={[{ value: "X", label: "X" }, { value: "Y", label: "Y" }, { value: "Z", label: "Z" }]}
              />
            </Field>
            <Field label="Vertical Yd">
              <Select
                value={mapping.verticalAxis}
                onChange={(axis: Axis) => state.setSettings({ coordMapping: { ...mapping, verticalAxis: axis } })}
                options={[{ value: "Y", label: "Y" }, { value: "Z", label: "Z" }, { value: "X", label: "X" }]}
              />
            </Field>
          </div>

          <div className="mt-2 grid grid-cols-3 gap-2">
            <Field label="Xd sign">
              <Select
                value={mapping.longitudinalSign}
                onChange={(value) => state.setSettings({ coordMapping: { ...mapping, longitudinalSign: value } })}
                options={[{ value: 1, label: "+1" }, { value: -1, label: "−1" }]}
              />
            </Field>
            <Field label="Zd sign">
              <Select
                value={mapping.transverseSign}
                onChange={(value) => state.setSettings({ coordMapping: { ...mapping, transverseSign: value } })}
                options={[{ value: 1, label: "+1" }, { value: -1, label: "−1" }]}
              />
            </Field>
            <Field label="Yd sign">
              <Select
                value={mapping.verticalSign}
                onChange={(value) => state.setSettings({ coordMapping: { ...mapping, verticalSign: value } })}
                options={[{ value: 1, label: "+1 (up)" }, { value: -1, label: "−1 (down)" }]}
              />
            </Field>
          </div>

          <div className="mt-2 grid grid-cols-4 gap-2">
            <Field label="Origin X">
              <NumberField value={mapping.originXM} step={0.5} onChange={(value) => state.setSettings({ coordMapping: { ...mapping, originXM: value } })} />
            </Field>
            <Field label="Origin Y">
              <NumberField value={mapping.originYM} step={0.1} onChange={(value) => state.setSettings({ coordMapping: { ...mapping, originYM: value } })} />
            </Field>
            <Field label="Origin Z">
              <NumberField value={mapping.originZM} step={0.5} onChange={(value) => state.setSettings({ coordMapping: { ...mapping, originZM: value } })} />
            </Field>
            <Field label="Rotation">
              <NumberField
                value={mapping.rotationDeg}
                min={-180}
                max={180}
                step={5}
                onChange={(value) => state.setSettings({ coordMapping: { ...mapping, rotationDeg: value } })}
                suffix="°"
              />
            </Field>
          </div>

          <div className={`mt-2 rounded border px-2 py-1.5 text-[10.5px] ${issues.length ? "border-signal-red/40 bg-signal-red/10 text-signal-red" : "border-white/[0.06] bg-ink-950/40 text-slate-400"}`}>
            <p className="mono">{describeMapping(mapping)}</p>
            {issues.map((issue, index) => (
              <p key={index} className="mt-0.5">{issue}</p>
            ))}
          </div>
          <Hint>
            The mapping is applied through one transformation used by the canvas readout, the generation start coordinates and the
            static joint forces. A non-zero rotation cannot be expressed by XINC/ZINC alone, so moving-load generation is blocked
            while a rotation is active.
          </Hint>
        </Panel>

        <Panel title="Output" subtitle="what is written into the generated document">
          <Toggle
            checked={settings.emitComments}
            onChange={(emitComments) => state.setSettings({ emitComments })}
            label="Emit comment lines"
            hint="Assumptions, mapping, reference points and load-transfer notes are written as STAAD comment lines."
          />
          <Toggle
            checked={settings.emitUnitCommand}
            onChange={(emitUnitCommand) => state.setSettings({ emitUnitCommand })}
            label="Emit UNIT METER KN"
            hint="The generated file declares its units explicitly. Internal values are always metres and kilonewtons."
          />
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Field label="Long-line report limit">
              <NumberField value={settings.maxLineLength} min={40} max={400} step={10} precision={0} onChange={(value) => state.setSettings({ maxLineLength: Math.round(value) })} />
            </Field>
            <Field label="Snap step">
              <NumberField value={settings.snapStepM} min={0} max={5} step={0.05} onChange={(value) => state.setSettings({ snapStepM: value })} suffix="m" />
            </Field>
          </div>
          <Field label="Deck level note">
            <TextField
              value={settings.deckLevelNote}
              onChange={(value) => state.setSettings({ deckLevelNote: value })}
              placeholder="e.g. deck surface at global Y = 0.000 (road level)"
            />
          </Field>
          <Hint>
            Commands are never wrapped: a line break in the middle of a STAAD command is not guaranteed to be valid input, so long
            lines are reported in the validation panel instead.
          </Hint>
        </Panel>
      </div>

      <div className="space-y-3">
        <Panel
          title="Structural model"
          subtitle={`${state.model.nodes.length} joints · ${state.model.members.length} members · ${state.model.quads.length} quads`}
          actions={
            <Button size="xs" onClick={state.loadPresetSampleModel}>Sample grillage</Button>
          }
        >
          <div className="grid grid-cols-2 gap-2">
            <Field label="Transfer method">
              <Select
                value={state.model.loadTransfer}
                onChange={(loadTransfer) => state.setModel({ loadTransfer })}
                options={[
                  { value: "exact-node", label: "Exact joint only" },
                  { value: "nearest-node", label: "Nearest joint" },
                  { value: "two-node-lever", label: "Two-joint lever" },
                  { value: "four-node-bilinear", label: "Four-joint bilinear" },
                ]}
              />
            </Field>
            <Field label="Joint tolerance">
              <NumberField value={state.model.nodeToleranceM} min={0.001} max={2} step={0.005} onChange={(value) => state.setModel({ nodeToleranceM: value })} suffix="m" />
            </Field>
            <Field label="Member/element tolerance">
              <NumberField value={state.model.gridToleranceM} min={0.001} max={2} step={0.005} onChange={(value) => state.setModel({ gridToleranceM: value })} suffix="m" />
            </Field>
            <Field label="Track slices">
              <NumberField value={state.model.trackTrackPoints} min={1} max={40} step={1} precision={0} onChange={(value) => state.setModel({ trackTrackPoints: Math.round(value) })} />
            </Field>
          </div>

          <Field label="Paste model text" className="mt-2" hint="JOINT COORDINATES, MEMBER INCIDENCES and ELEMENT INCIDENCES SHELL are read. Other commands are ignored without altering the source you paste here.">
            <textarea
              className="input min-h-[110px] resize-y font-mono text-[11px] leading-[17px]"
              placeholder={"JOINT COORDINATES\n1 0 0 0 2 2.5 0 0 3 5 0 0\nMEMBER INCIDENCES\n1 1 2 2 2 3"}
              value={modelText}
              onChange={(event) => setModelText(event.target.value)}
              spellCheck={false}
            />
          </Field>
          <div className="mt-1.5 flex items-center gap-2">
            <Button size="xs" variant="primary" onClick={importModel} disabled={!modelText.trim()}>Import model</Button>
            <Button size="xs" variant="ghost" onClick={() => state.setModel({ nodes: [], members: [], quads: [], sourceLabel: "Not supplied" })}>
              Clear model
            </Button>
            {importMessage && <span className="text-[10px] text-slate-500">{importMessage}</span>}
          </div>
          <p className="mt-1.5 text-[10px] text-slate-500">Source: {state.model.sourceLabel}</p>
        </Panel>

        <Panel title="Project file" subtitle="JSON project format, browser storage and STAAD input export">
          <div className="flex flex-wrap gap-1.5">
            <Button size="xs" variant="primary" onClick={state.saveLocal}>Save to browser</Button>
            <Button
              size="xs"
              onClick={() => {
                if (!state.restoreLocal()) state.notify("warning", "No saved project found in this browser.");
                else state.notify("success", "Saved project restored.");
              }}
            >
              Restore saved
            </Button>
            <Button
              size="xs"
              onClick={() => downloadText(`${slug}.staad-project.json`, JSON.stringify(state.exportProjectFile(), null, 2), "application/json")}
            >
              Export JSON
            </Button>
            <Button size="xs" onClick={() => fileRef.current?.click()}>Import JSON</Button>
            <CopyButton text={JSON.stringify(state.exportProjectFile(), null, 2)} label="Copy JSON" />
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              const text = await file.text();
              const result = state.importProjectFile(text);
              state.notify(result.ok ? "success" : "error", result.message);
              event.target.value = "";
            }}
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Button size="xs" onClick={downloadStaad}>Export .std</Button>
            <Button size="xs" onClick={() => state.loadSample()}>Load sample project</Button>
            <Button size="xs" variant="ghost" onClick={state.resetProject}>Clear project</Button>
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
            The STAAD input export contains the same deterministic text as the syntax panel. The JSON format keeps geometry,
            vehicle definitions, placements, structural model, moving-load settings and the coordinate mapping so a review can be
            reproduced exactly.
          </p>
          {state.savedAt && <p className="mt-1 text-[10px] text-slate-600">Last browser save: {new Date(state.savedAt).toLocaleString()}</p>}
        </Panel>

        <Panel title="Units and conventions">
          <ul className="space-y-1 text-[10.5px] leading-relaxed text-slate-400">
            <li>Internal length: metres. Internal force: kilonewtons. Display rounding only at presentation and output.</li>
            <li>Xd runs from the start abutment (0) to the end abutment. Zd is signed with +Zd at the left deck edge. Yd is up.</li>
            <li>The deck plan is never mirrored: screen y is −Zd so +Zd appears at the top of the plan.</li>
            <li>Vehicle datum: {state.vehicles[0]?.datumDescription ?? "—"}. Each definition states its own datum.</li>
            <li>Clearance is measured from the configured datum line to the outer edge of the nearest wheel or track, including the contact patch width.</li>
            <li>Applied forces are vertical: F(vertical) = −P kN for the default mapping, and every other component is zero.</li>
          </ul>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <div className="stat">
              <div className="stat-label">Selected version</div>
              <div className="stat-value">{settings.staadVersion}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Mapping</div>
              <div className="stat-value text-[10.5px]">
                Xd→{mapping.longitudinalAxis} · Zd→{mapping.transverseAxis} · Yd→{mapping.verticalAxis}
              </div>
            </div>
          </div>
          <p className="mt-2 text-[10px] text-slate-600">
            Deck extents: {fmt(state.deck.spanM)} m × {fmt(state.deck.totalWidthM)} m. Loads on the deck:{" "}
            {state.placements.length} placement(s).
          </p>
        </Panel>
      </div>
    </div>
  );
}
