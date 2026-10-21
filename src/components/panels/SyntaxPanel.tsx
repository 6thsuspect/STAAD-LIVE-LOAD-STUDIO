import { useEffect, useMemo, useState } from "react";
import { currentProject, useStudio } from "../../store/studio";
import { generateDocument } from "../../lib/syntax/document";
import { parseSyntax, summariseParsed } from "../../lib/syntax/parse";
import { reconstructScene } from "../../lib/syntax/import";
import { getAdapter } from "../../lib/syntax/adapters";
import { syntaxStats } from "../../lib/syntax/document";
import { fmt } from "../../lib/units";
import { CodeEditor } from "../CodeEditor";
import { Button, CopyButton, Segmented, StatusDot } from "../ui";

export function SyntaxPanel({ compact }: { compact?: boolean }) {
  const state = useStudio();
  const project = currentProject(state);
  const [view, setView] = useState<"generated" | "draft">("generated");
  const [dirty, setDirty] = useState(false);

  const generated = useMemo(() => generateDocument(project), [project]);
  const adapter = getAdapter(project.settings.staadVersion);

  const draftParsed = useMemo(() => (state.syntaxMode === "edited" ? parseSyntax(state.syntaxDraft) : null), [state.syntaxMode, state.syntaxDraft]);

  const generatedStats = syntaxStats(generated.text);
  const outOfSync = dirty || (state.syntaxMode === "edited" && state.syntaxDraft !== generated.text);

  useEffect(() => {
    if (view === "draft" && !state.syntaxDraft) {
      useStudio.getState().setSyntaxDraft(generated.text);
    }
  }, [view, state.syntaxDraft, generated.text]);

  const selectedBlock = state.selectedPlacementId ? generated.blocks.find((b) => b.placementId === state.selectedPlacementId) : undefined;

  const applyDraft = () => {
    if (!draftParsed) return;
    const reconstruction = reconstructScene(draftParsed.document, draftParsed.model, project);
    useStudio.getState().applyImport(draftParsed.document, reconstruction);
    setDirty(false);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-ink-900/60">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-white/[0.06] px-2 py-1.5">
        <Segmented
          value={view}
          onChange={(value) => {
            setView(value);
            if (value === "draft" && !state.syntaxDraft) useStudio.getState().setSyntaxDraft(generated.text);
          }}
          options={[
            { value: "generated", label: "Generated syntax" },
            { value: "draft", label: "Draft editor" },
          ]}
        />
        <span className="ml-1 flex items-center gap-1.5 text-[10.5px] text-slate-500">
          <StatusDot tone={outOfSync ? "warn" : "ok"} />
          {outOfSync ? "edited — not in sync with the scene" : "in sync with the shared model"}
        </span>
        <span className="mono hidden text-[10px] text-slate-600 sm:inline">
          {generatedStats.lines} lines · {fmt(generatedStats.characters, 0)} chars
        </span>
        <div className="ml-auto flex items-center gap-1">
          {view === "generated" ? (
            <>
              <CopyButton text={generated.text} label="Copy all" />
              <CopyButton
                text={selectedBlock?.text ?? ""}
                label="Copy vehicle"
                disabled={!selectedBlock}
              />
              <Button
                size="xs"
                variant="ghost"
                onClick={() => {
                  setView("draft");
                  useStudio.getState().setSyntaxDraft(generated.text);
                }}
                title="Edit the syntax manually. Edits are preserved and parsed, never silently overwritten."
              >
                Edit
              </Button>
            </>
          ) : (
            <>
              <Button size="xs" variant="primary" onClick={applyDraft} disabled={!draftParsed || draftParsed.document.status === "invalid"}>
                Apply to scene
              </Button>
              <Button
                size="xs"
                onClick={() => {
                  useStudio.getState().setSyntaxDraft(generated.text);
                  setDirty(false);
                }}
              >
                Revert
              </Button>
              <CopyButton text={state.syntaxDraft} label="Copy draft" />
            </>
          )}
        </div>
      </div>

      {view === "generated" ? (
        <div className="min-h-0 flex-1 overflow-auto p-2">
          {generated.diagnostics.filter((d) => d.severity === "error").length > 0 && (
            <div className="mb-2 rounded border border-signal-red/40 bg-signal-red/10 px-2 py-1.5 text-[11px] text-signal-red">
              {generated.diagnostics.filter((d) => d.severity === "error").length} blocking issue(s) — the generated text is not a valid
              vehicle load case. See the validation panel.
            </div>
          )}
          <CodeEditor value={generated.text} readOnly diagnostics={generated.diagnostics.filter((d) => d.line)} minLines={compact ? 8 : 14} ariaLabel="Generated STAAD.Pro syntax" />
          <p className="mt-1.5 text-[10px] leading-relaxed text-slate-600">
            {adapter.label} adapter · {adapter.statusNote}
          </p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto p-2">
          <CodeEditor
            value={state.syntaxDraft}
            onChange={(text) => {
              useStudio.getState().setSyntaxDraft(text);
              setDirty(text !== generated.text);
            }}
            diagnostics={draftParsed?.document.diagnostics ?? []}
            minLines={compact ? 8 : 14}
            ariaLabel="Syntax draft editor"
          />
          {draftParsed && draftParsed.document.diagnostics.length > 0 && (
            <ul className="mt-1.5 max-h-24 space-y-1 overflow-auto">
              {draftParsed.document.diagnostics.map((diagnostic) => (
                <li
                  key={diagnostic.id}
                  className={`rounded border px-2 py-1 text-[10px] leading-snug ${
                    diagnostic.severity === "error"
                      ? "border-signal-red/30 bg-signal-red/10 text-signal-red"
                      : diagnostic.severity === "warning"
                        ? "border-signal-amber/30 bg-signal-amber/10 text-signal-amber"
                        : "border-white/[0.06] bg-ink-950/40 text-slate-500"
                  }`}
                >
                  {diagnostic.line ? `line ${diagnostic.line}: ` : ""}
                  {diagnostic.message}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
            {draftParsed && (
              <>
                <span
                  className={
                    draftParsed.document.status === "valid"
                      ? "text-signal-green"
                      : draftParsed.document.status === "partial"
                        ? "text-signal-amber"
                        : "text-signal-red"
                  }
                >
                  {draftParsed.document.status}
                </span>
                <span>{summariseParsed(draftParsed.document)}</span>
                <span>·</span>
                <span>{draftParsed.document.unsupported.length} preserved line(s)</span>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
