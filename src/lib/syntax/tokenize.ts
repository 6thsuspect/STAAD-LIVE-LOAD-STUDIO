import type { ParsedDocument, ParseDiagnostic } from "../../types";
import { fmt } from "../units";

export interface SourceLine {
  number: number;
  raw: string;
  tokens: string[];
  isComment: boolean;
  isBlank: boolean;
  upper: string;
}

/**
 * Line-oriented tokeniser.
 *
 * STAAD.Pro input is line oriented: a `*` in the first non-blank column starts a
 * comment line, and commands are whitespace/comma separated. Nothing is dropped —
 * every source line keeps its original text and 1-based line number so unsupported
 * content can be reported and preserved verbatim.
 */
export function tokenizeSource(source: string): SourceLine[] {
  const normalised = source.replace(/\r\n?/g, "\n");
  const rawLines = normalised.split("\n");
  return rawLines.map((raw, index) => {
    const trimmed = raw.trim();
    const isComment = trimmed.startsWith("*");
    const isBlank = trimmed.length === 0;
    const body = isComment ? "" : trimmed;
    const tokens = body.length ? body.split(/[\s,]+/).filter(Boolean) : [];
    return {
      number: index + 1,
      raw,
      tokens,
      isComment,
      isBlank,
      upper: body.toUpperCase(),
    };
  });
}

export function isNumericToken(token: string | undefined): boolean {
  if (!token) return false;
  return /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(token);
}

export function toNumber(token: string | undefined): number | null {
  if (!isNumericToken(token)) return null;
  const value = Number(token);
  return Number.isFinite(value) ? value : null;
}

export const MOVE_KEYWORDS = ["XINC", "YINC", "ZINC", "INC", "TOLERANCE", "MOVE", "X", "Y", "Z"] as const;

export interface DiagnosticSink {
  push(diagnostic: Omit<ParseDiagnostic, "id">): void;
  diagnostics: ParseDiagnostic[];
}

export function createSink(): DiagnosticSink {
  let counter = 0;
  const diagnostics: ParseDiagnostic[] = [];
  return {
    diagnostics,
    push(diagnostic) {
      counter += 1;
      diagnostics.push({ ...diagnostic, id: `parse-${counter}` });
    },
  };
}

export function emptyParsedDocument(source: string): ParsedDocument {
  return {
    status: "valid",
    movingDefinitions: [],
    generations: [],
    staticCases: [],
    recognisedLines: [],
    unsupported: [],
    comments: [],
    diagnostics: [],
    source,
  };
}

export function describeTokens(tokens: string[], max = 8): string {
  const slice = tokens.slice(0, max).join(" ");
  return tokens.length > max ? `${slice} …` : slice;
}

export function formatNumber(value: number, decimals = 3): string {
  return fmt(value, decimals);
}
