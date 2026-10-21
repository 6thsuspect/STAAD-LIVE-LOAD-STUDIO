import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Diagnostic } from "../types";

/**
 * Line-oriented code view / editor.
 * The highlighted layer and the textarea share identical typography so the caret
 * lines up with the rendered glyphs. Line numbers and diagnostic gutters stay in
 * sync with the source line numbers reported by the parser.
 */

const KEYWORDS = new Set([
  "STAAD",
  "SPACE",
  "UNIT",
  "METER",
  "METRE",
  "KN",
  "KNS",
  "DEFINE",
  "MOVING",
  "LOAD",
  "TYPE",
  "DISTANCE",
  "WIDTH",
  "GENERATION",
  "JOINT",
  "MEMBER",
  "ELEMENT",
  "PLATE",
  "SHELL",
  "FLOOR",
  "TITLE",
  "LOADTYPE",
  "LIVE",
  "NONE",
  "DEAD",
  "XINC",
  "YINC",
  "ZINC",
  "INC",
  "FX",
  "FY",
  "FZ",
  "MX",
  "MY",
  "MZ",
  "SUPPORTS",
  "SELFWEIGHT",
  "CONSTANTS",
  "PERFORM",
  "ANALYSIS",
  "FINISH",
  "PRINT",
  "COMB",
  "LIST",
]);

interface Token {
  text: string;
  kind: "comment" | "keyword" | "number" | "punct" | "plain" | "notice";
}

function highlightLine(line: string): Token[] {
  if (line.trimStart().startsWith("*")) {
    return [{ text: line, kind: line.toUpperCase().includes("NOTICE") ? "notice" : "comment" }];
  }
  const parts = line.split(/(\s+|,)/);
  return parts.map((part) => {
    if (!part) return { text: part, kind: "plain" };
    if (/^\s+$/.test(part)) return { text: part, kind: "plain" };
    if (part === ",") return { text: part, kind: "punct" };
    if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(part)) return { text: part, kind: "number" };
    if (KEYWORDS.has(part.toUpperCase())) return { text: part, kind: "keyword" };
    return { text: part, kind: "plain" };
  });
}

const TOKEN_CLASS: Record<Token["kind"], string> = {
  comment: "text-slate-600 italic",
  notice: "text-signal-amber/70 italic",
  keyword: "text-cyan-300",
  number: "text-signal-amber",
  punct: "text-slate-500",
  plain: "text-slate-300",
};

const LINE_HEIGHT = 18;
const PADDING_Y = 8;

export function CodeEditor({
  value,
  onChange,
  readOnly,
  diagnostics = [],
  activeLine,
  placeholder,
  minLines = 12,
  maxHeight,
  ariaLabel,
}: {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  diagnostics?: Diagnostic[];
  activeLine?: number | null;
  placeholder?: string;
  minLines?: number;
  maxHeight?: number;
  ariaLabel?: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const preRef = useRef<HTMLPreElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);
  const [focused, setFocused] = useState(false);

  const lines = useMemo(() => value.split("\n"), [value]);
  const highlighted = useMemo(() => lines.map(highlightLine), [lines]);

  const lineIssues = useMemo(() => {
    const map = new Map<number, { severity: Diagnostic["severity"]; messages: string[] }>();
    diagnostics.forEach((diagnostic) => {
      if (!diagnostic.line) return;
      const existing = map.get(diagnostic.line) ?? { severity: diagnostic.severity, messages: [] };
      const rank = { error: 0, warning: 1, info: 2 } as const;
      if (rank[diagnostic.severity] < rank[existing.severity]) existing.severity = diagnostic.severity;
      existing.messages.push(diagnostic.message);
      map.set(diagnostic.line, existing);
    });
    return map;
  }, [diagnostics]);

  const height = Math.max(minLines, lines.length) * LINE_HEIGHT + PADDING_Y * 2;

  // Keep the highlighted layer and the gutter aligned with the textarea scroll.
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const sync = () => {
      if (preRef.current) {
        preRef.current.style.transform = `translate(${-textarea.scrollLeft}px, ${-textarea.scrollTop}px)`;
      }
      if (gutterRef.current) {
        gutterRef.current.style.transform = `translateY(${-textarea.scrollTop}px)`;
      }
    };
    textarea.addEventListener("scroll", sync);
    sync();
    return () => textarea.removeEventListener("scroll", sync);
  }, [value]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Tab") {
      event.preventDefault();
      const target = event.currentTarget;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const next = `${value.slice(0, start)}  ${value.slice(end)}`;
      onChange?.(next);
      requestAnimationFrame(() => {
        target.selectionStart = start + 2;
        target.selectionEnd = start + 2;
      });
    }
  };

  return (
    <div
      className={`relative flex overflow-hidden rounded border ${
        focused ? "border-cyan-500/40" : "border-white/[0.07]"
      } bg-ink-950/70`}
      style={{ maxHeight }}
    >
      {/* gutter */}
      <div className="relative w-11 shrink-0 overflow-hidden border-r border-white/[0.06] bg-ink-950/80">
        <div ref={gutterRef} className="syntax-code py-2" aria-hidden>
          {lines.map((_, index) => {
            const issue = lineIssues.get(index + 1);
            const isActive = activeLine === index + 1;
            return (
              <div
                key={index}
                className={`flex items-center justify-end gap-1 px-1.5 text-[10.5px] ${
                  isActive ? "bg-cyan-500/10 text-cyan-300" : "text-slate-600"
                }`}
                style={{ height: LINE_HEIGHT }}
              >
                {issue && (
                  <span
                    className={
                      issue.severity === "error"
                        ? "text-signal-red"
                        : issue.severity === "warning"
                          ? "text-signal-amber"
                          : "text-signal-blue"
                    }
                    title={issue.messages.join("\n")}
                  >
                    ●
                  </span>
                )}
                <span className="mono tabular-nums">{index + 1}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="relative min-w-0 flex-1 overflow-hidden">
        <pre
          ref={preRef}
          className="syntax-code pointer-events-none absolute left-0 top-0 m-0 min-w-full px-2 py-2"
          aria-hidden
          style={{ paddingTop: PADDING_Y, paddingBottom: PADDING_Y }}
        >
          {highlighted.map((tokens, index) => {
            const issue = lineIssues.get(index + 1);
            const isActive = activeLine === index + 1;
            return (
              <div
                key={index}
                style={{ height: LINE_HEIGHT }}
                className={`${issue?.severity === "error" ? "syntax-error-line" : issue?.severity === "warning" ? "syntax-warning-line" : ""} ${
                  isActive ? "bg-cyan-500/10" : ""
                }`}
              >
                {tokens.length === 0 ? (
                  <span>&nbsp;</span>
                ) : (
                  tokens.map((token, tokenIndex) => (
                    <span key={tokenIndex} className={TOKEN_CLASS[token.kind]}>
                      {token.text}
                    </span>
                  ))
                )}
              </div>
            );
          })}
        </pre>

        <textarea
          ref={textareaRef}
          aria-label={ariaLabel ?? "STAAD.Pro syntax"}
          className="syntax-code relative m-0 w-full resize-none bg-transparent px-2 py-2 text-transparent caret-cyan-300 outline-none"
          style={{ height, minHeight: minLines * LINE_HEIGHT + PADDING_Y * 2 }}
          value={value}
          readOnly={readOnly}
          placeholder={placeholder}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          wrap="off"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(event) => onChange?.(event.target.value)}
          onKeyDown={handleKeyDown}
        />
      </div>
    </div>
  );
}
