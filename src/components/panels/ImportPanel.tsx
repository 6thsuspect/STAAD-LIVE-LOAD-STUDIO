import { useMemo } from "react";
import { currentProject, useStudio } from "../../store/studio";
import { parseSyntax, summariseParsed, totalOfCase } from "../../lib/syntax/parse";
import { reconstructScene, definitionRows } from "../../lib/syntax/import";
import { getAdapter } from "../../lib/syntax/adapters";
import { fmt } from "../../lib/units";
import { CodeEditor } from "../CodeEditor";
import { Button, CopyButton, Hint, Panel, SeverityBadge } from "../ui";

const EXAMPLES: Record<string, { label: string; description: string; text: string }> = {
  moving: {
    label: "Moving load, two lanes",
    description: "DEFINE MOVING LOAD + LOAD GENERATION for the library Class A and 70R wheeled vehicles.",
    text: `STAAD SPACE
UNIT METER KN

* IRC Class A train — 554 kN, 8 axles
DEFINE MOVING LOAD
TYPE 1 LOAD 27 27 114 114 68 68 68 68 DISTANCE 1.1 3.2 1.2 4.3 3.0 3.0 3.0 WIDTH 2.3

* IRC Class 70R wheeled — 1000 kN, 7 axles
TYPE 2 LOAD 80 120 120 170 170 170 170 DISTANCE 3.96 1.52 2.13 1.37 3.05 1.37 WIDTH 2.9

LOAD GENERATION 24
TYPE 1 2.0 0.0 2.25 XINC 1.0

LOAD GENERATION 18
TYPE 2 4.0 0.0 -2.25 XINC 0.75
`,
  },
  static: {
    label: "Static case with model",
    description: "JOINT COORDINATES, members, and one explicit vehicle load case with joint forces.",
    text: `STAAD SPACE
UNIT METER KN
JOINT COORDINATES
1 0 0 -2.5 2 0 0 0 3 0 0 2.5
4 2.5 0 -2.5 5 2.5 0 0 6 2.5 0 2.5
7 5 0 -2.5 8 5 0 0 9 5 0 2.5
MEMBER INCIDENCES
1 1 2 2 2 3 3 4 5 4 5 6
5 7 8 6 8 9 7 1 4 8 4 7 9 2 5 10 5 8 11 3 6 12 6 9

LOAD 301 LOADTYPE LIVE TITLE 70R WHEELED V1
JOINT LOAD
8 FY -500
5 FY -500
`,
  },
  hostile: {
    label: "Partial and unsupported",
    description: "Mixed content: unknown keywords, wrong counts and an unresolvable generation.",
    text: `STAAD SPACE
UNIT METER KN
DEFINE MOVING LOAD
TYPE 5 LOAD 100 100 100 DISTANCE 2.0 2.0 WIDTH 2.0
TYPE 6 LOAD 60 60 DISTANCE 3.0

DEFINE LANE WIDTH 3.0
LOAD GENERATION 10
TYPE 9 0 0 0 ZINC 1.0

LOAD 410 LOADTYPE LIVE TITLE FIELD TEST
JOINT LOAD
14 FY -250 MX 12.5
15 MY 3.0

LOAD COMB 1
1 1.0 2 1.0
`,
  },
};

export function ImportPanel() {
  const state = useStudio();
  const project = currentProject(state);
  const source = state.importSource;
  const parsed = useMemo(() => (source.trim() ? parseSyntax(source) : null), [source]);
  const adapter = getAdapter(state.settings.staadVersion);

  const reconstruction = useMemo(() => {
    if (!parsed) return null;
    return reconstructScene(parsed.document, parsed.model, project);
  }, [parsed, project]);

  const errors = parsed?.document.diagnostics.filter((d) => d.severity === "error") ?? [];

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-auto p-3 xl:grid-cols-2">
      <div className="flex min-h-0 flex-col gap-3">
        <Panel
          title="Paste STAAD.Pro syntax"
          subtitle="supported command families are parsed; everything else is preserved verbatim"
          actions={
            <>
              <CopyButton text={source} label="Copy source" />
              <Button
                size="xs"
                variant="primary"
                onClick={() =>
                  parsed && reconstruction ? useStudio.getState().applyImport(parsed.document, reconstruction) : null
                }
                disabled={!parsed || errors.length > 0}
              >
                Reconstruct scene
              </Button>
            </>
          }
          className="flex min-h-0 flex-col"
          bodyClassName="flex min-h-0 flex-1 flex-col"
        >
          <div className="mb-2 flex flex-wrap gap-1.5">
            {Object.entries(EXAMPLES).map(([key, example]) => (
              <Button
                key={key}
                size="xs"
                onClick={() => useStudio.getState().setImportSource(example.text)}
                title={example.description}
              >
                {example.label}
              </Button>
            ))}
            <Button size="xs" variant="ghost" onClick={() => useStudio.getState().clearImport()} disabled={!source}>
              Clear
            </Button>
          </div>

          {source.trim() ? (
            <CodeEditor
              value={source}
              onChange={(text) => useStudio.getState().setImportSource(text)}
              diagnostics={parsed?.document.diagnostics ?? []}
              minLines={16}
              ariaLabel="Pasted STAAD.Pro syntax"
            />
          ) : (
            <textarea
              className="input min-h-[300px] flex-1 resize-y font-mono text-[11.5px] leading-[18px]"
              placeholder="Paste STAAD.Pro input here — DEFINE MOVING LOAD, LOAD GENERATION, JOINT COORDINATES, MEMBER INCIDENCES, ELEMENT INCIDENCES SHELL, LOAD / JOINT LOAD …"
              value={source}
              onChange={(event) => useStudio.getState().setImportSource(event.target.value)}
              spellCheck={false}
            />
          )}

          <div className="mt-2 flex flex-wrap items-center gap-2 text-[10.5px] text-slate-500">
            {parsed ? (
              <>
                <span
                  className={`chip ${
                    parsed.document.status === "valid"
                      ? "border-signal-green/40 bg-signal-green/10 text-signal-green"
                      : parsed.document.status === "partial"
                        ? "border-signal-amber/40 bg-signal-amber/10 text-signal-amber"
                        : "border-signal-red/40 bg-signal-red/10 text-signal-red"
                  }`}
                >
                  {parsed.document.status}
                </span>
                <span>{summariseParsed(parsed.document)}</span>
                <span className="text-slate-600">·</span>
                <span>{parsed.document.comments.length} comment line(s)</span>
              </>
            ) : (
              <span>No source pasted.</span>
            )}
          </div>
          <Hint>
            The parser never invents coordinates. A DEFINE MOVING LOAD on its own is not a placement, so nothing is put on the deck
            until a generation or load case supplies a position. Lines outside the supported grammar stay in the source and are
            listed below with their line numbers.
          </Hint>
        </Panel>
      </div>

      <div className="space-y-3">
        {parsed && (
          <>
            <Panel
              title="Parse report"
              subtitle={`${adapter.label} adapter · grammar status ${adapter.status}`}
              actions={
                <div className="flex items-center gap-1">
                  {(Object.keys({ error: 1, warning: 1, info: 1 }) as Array<"error" | "warning" | "info">).map((severity) => {
                    const count = parsed.document.diagnostics.filter((d) => d.severity === severity).length;
                    if (!count) return null;
                    return <span key={severity} className="chip border-white/10 bg-ink-950/60 text-slate-400">{count} {severity}</span>;
                  })}
                </div>
              }
            >
              {parsed.document.diagnostics.length === 0 ? (
                <p className="text-[11px] text-signal-green">No parser diagnostics.</p>
              ) : (
                <ul className="max-h-[220px] space-y-1 overflow-auto pr-1">
                  {parsed.document.diagnostics.map((diagnostic) => (
                    <li key={diagnostic.id} className="flex items-start gap-2 rounded border border-white/[0.05] bg-ink-950/40 px-2 py-1">
                      <SeverityBadge severity={diagnostic.severity} />
                      <div className="min-w-0">
                        <p className="text-[11px] leading-snug text-slate-300">{diagnostic.message}</p>
                        <p className="mono text-[9.5px] text-slate-600">
                          {diagnostic.code}
                          {diagnostic.line ? ` · line ${diagnostic.line}` : ""}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="Recognised content" subtitle="everything below is present in the source text">
              <div className="space-y-2">
                {parsed.document.movingDefinitions.map((definition) => (
                  <div key={definition.sourceLineNumber} className="rounded border border-white/[0.06] px-2 py-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-slate-200">TYPE {definition.typeNumber} · moving-load definition</span>
                      <span className="mono text-[9.5px] text-slate-500">line {definition.sourceLineNumber}</span>
                    </div>
                    <table className="mono mt-1 w-full text-[10px] text-slate-400">
                      <thead>
                        <tr className="text-slate-600">
                          <th className="text-left font-normal">axle</th>
                          <th className="text-right font-normal">load kN</th>
                          <th className="text-right font-normal">offset m</th>
                        </tr>
                      </thead>
                      <tbody>
                        {definitionRows(definition).map((row) => (
                          <tr key={row[0]}>
                            <td>{row[0]}</td>
                            <td className="text-right">{row[1]}</td>
                            <td className="text-right">{row[2]}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="mt-1 text-[9.5px] text-slate-500">
                      {definition.loadsKN.length} loads, {definition.distancesM.length} distances
                      {definition.widthM !== undefined ? `, WIDTH ${fmt(definition.widthM, 3)} m` : ", no WIDTH"}
                    </p>
                  </div>
                ))}

                {parsed.document.generations.map((generation, index) => (
                  <div key={`gen-${index}`} className="rounded border border-white/[0.06] px-2 py-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-slate-200">
                        TYPE {generation.typeNumber} · {generation.positionCount} positions
                      </span>
                      <span className="mono text-[9.5px] text-slate-500">line {generation.sourceLineNumber}</span>
                    </div>
                    <p className="mono mt-0.5 text-[10px] text-slate-400">
                      start {fmt(generation.start.x, 3)}, {fmt(generation.start.y, 3)}, {fmt(generation.start.z, 3)} · {generation.incrementAxis}INC{" "}
                      {fmt(generation.incrementM, 3)}
                    </p>
                  </div>
                ))}

                {parsed.document.staticCases.map((loadCase) => {
                  const totals = totalOfCase(loadCase);
                  return (
                    <div key={loadCase.caseNumber} className="rounded border border-white/[0.06] px-2 py-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-slate-200">
                          LOAD {loadCase.caseNumber} · {loadCase.loadType}
                        </span>
                        <span className="mono text-[9.5px] text-slate-500">line {loadCase.sourceLineNumber}</span>
                      </div>
                      <p className="mt-0.5 text-[10px] text-slate-500">
                        {loadCase.nodeLoads.length} joint load item(s) · Σ FY {fmt(totals.fy, 2)} kN
                        {loadCase.title ? ` · “${loadCase.title}”` : ""}
                      </p>
                    </div>
                  );
                })}

                {parsed.model.nodes.length > 0 && (
                  <div className="rounded border border-signal-blue/20 bg-signal-blue/[0.06] px-2 py-1.5 text-[10.5px] text-signal-blue">
                    Model: {parsed.model.nodes.length} joints · {parsed.model.members.length} members · {parsed.model.quads.length} quads
                    {parsed.model.diagnostics.length > 0 && ` · ${parsed.model.diagnostics.length} model note(s)`}
                  </div>
                )}

                {parsed.document.movingDefinitions.length === 0 &&
                  parsed.document.generations.length === 0 &&
                  parsed.document.staticCases.length === 0 &&
                  parsed.model.nodes.length === 0 && (
                    <p className="text-[11px] text-slate-500">No supported content recognised yet.</p>
                  )}
              </div>
            </Panel>

            {parsed.document.unsupported.length > 0 && (
              <Panel title="Preserved unsupported lines" subtitle="kept verbatim, never discarded">
                <ul className="max-h-[160px] space-y-1 overflow-auto pr-1">
                  {parsed.document.unsupported.map((line) => (
                    <li key={line.line} className="rounded border border-white/[0.05] bg-ink-950/40 px-2 py-1">
                      <div className="flex items-start gap-2">
                        <span className="mono w-8 shrink-0 text-[9.5px] text-slate-600">{line.line}</span>
                        <div className="min-w-0">
                          <p className="mono truncate text-[10.5px] text-slate-400">{line.text || " "}</p>
                          <p className="text-[9.5px] text-slate-600">{line.reason}</p>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}

            {reconstruction && (
              <Panel title="Reconstruction plan" subtitle={reconstruction.partial ? "partial — review limitations" : "complete"}>
                <ul className="space-y-1">
                  {reconstruction.summary.map((line, index) => (
                    <li key={index} className="flex items-start gap-1.5 text-[10.5px] leading-relaxed text-slate-400">
                      <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-slate-600" />
                      {line}
                    </li>
                  ))}
                </ul>
                {reconstruction.diagnostics.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {reconstruction.diagnostics.map((diagnostic) => (
                      <li key={diagnostic.id} className="rounded border border-white/[0.05] bg-ink-950/40 px-2 py-1 text-[10.5px] text-slate-400">
                        {diagnostic.message}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-2 flex items-center gap-2">
                  <Button
                    size="xs"
                    variant="primary"
                    onClick={() => useStudio.getState().applyImport(parsed.document, reconstruction)}
                    disabled={errors.length > 0}
                  >
                    Apply to scene
                  </Button>
                  <span className="text-[10px] text-slate-500">
                    {errors.length > 0
                      ? "Fix the blocking parse errors first — applying an invalid source would misrepresent the deck."
                      : "Applying adds the recovered placements and adopts the parsed structural model."}
                  </span>
                </div>
              </Panel>
            )}
          </>
        )}

        {!parsed && (
          <Panel title="How import works">
            <ol className="list-decimal space-y-1.5 pl-4 text-[11px] leading-relaxed text-slate-400">
              <li>The source is tokenised line by line; line numbers are preserved exactly.</li>
              <li>Supported families are recognised: DEFINE MOVING LOAD, LOAD GENERATION, JOINT COORDINATES, MEMBER INCIDENCES, ELEMENT INCIDENCES SHELL, LOAD / JOINT LOAD, UNIT.</li>
              <li>Vehicle definitions are matched to the library by load magnitudes and spacings; unmatched definitions become imported vehicles with unknown transverse geometry.</li>
              <li>Placements are only created from positions actually encoded in the source.</li>
              <li>Unsupported lines stay in the source and are listed with a reason, never silently dropped.</li>
            </ol>
            <Hint>
              A definition alone is not a placement, and a LOAD GENERATION alone has no vehicle geometry. The panel shows each piece
              separately instead of pretending a position exists.
            </Hint>
          </Panel>
        )}
      </div>
    </div>
  );
}
