import type { ModelNode, StructuralModel } from "../../types";
import { isNumericToken, toNumber, type SourceLine } from "./tokenize";

/**
 * Structural model text import.
 *
 * Only the commands needed to make static load placement structurally meaningful
 * are read: JOINT COORDINATES, MEMBER INCIDENCES and ELEMENT INCIDENCES SHELL.
 * Nothing is inferred: a joint that is not listed does not exist, and a member or
 * plate that is not listed cannot be used for load transfer.
 */

export interface ModelFragment {
  nodes: ModelNode[];
  members: Array<{ id: number; startNode: number; endNode: number }>;
  quads: Array<{ id: number; nodes: number[] }>;
  consumedLines: number[];
  diagnostics: Array<{ line: number; severity: "error" | "warning"; message: string }>;
}

const COMMAND_STARTS = new Set([
  "JOINT",
  "MEMBER",
  "ELEMENT",
  "UNIT",
  "LOAD",
  "DEFINE",
  "PERFORM",
  "FINISH",
  "STAAD",
  "CONSTANTS",
  "SUPPORTS",
  "SELFWEIGHT",
  "PLATE",
  "SHELL",
  "PRINT",
  "PARAMETER",
  "START",
  "CHANGE",
  "SELECT",
  "SET",
  "ANALYSIS",
  "CUT",
  "STORY",
  "DEFINE",
  "MEMBER",
  "ELEMENT",
  "REPEAT",
]);

function isCommandLine(line: SourceLine): boolean {
  const first = line.tokens[0]?.toUpperCase();
  return !first ? false : COMMAND_STARTS.has(first) && !isNumericToken(first);
}

function isContinuation(line: SourceLine): boolean {
  return !line.isBlank && !line.isComment && !isCommandLine(line) && isNumericToken(line.tokens[0]);
}

export function parseStructuralModel(lines: SourceLine[]): ModelFragment {
  const fragment: ModelFragment = { nodes: [], members: [], quads: [], consumedLines: [], diagnostics: [] };
  const nodeIds = new Set<number>();

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.isBlank || line.isComment) continue;
    const upper = line.upper.replace(/\s+/g, " ");

    if (upper.startsWith("JOINT COORDINATE")) {
      fragment.consumedLines.push(line.number);
      let j = i + 1;
      while (j < lines.length && isContinuation(lines[j])) {
        const tokens = lines[j].tokens;
        fragment.consumedLines.push(lines[j].number);
        if (tokens.length % 4 !== 0) {
          fragment.diagnostics.push({
            line: lines[j].number,
            severity: "error",
            message: `Joint coordinate line must contain groups of 4 values (id x y z); found ${tokens.length} tokens.`,
          });
        }
        for (let k = 0; k + 3 < tokens.length; k += 4) {
          const id = toNumber(tokens[k]);
          const x = toNumber(tokens[k + 1]);
          const y = toNumber(tokens[k + 2]);
          const z = toNumber(tokens[k + 3]);
          if (id === null || x === null || y === null || z === null || !Number.isInteger(id)) {
            fragment.diagnostics.push({
              line: lines[j].number,
              severity: "error",
              message: `Could not read joint coordinates near "${tokens.slice(k, k + 4).join(" ")}".`,
            });
            continue;
          }
          if (nodeIds.has(id)) {
            fragment.diagnostics.push({
              line: lines[j].number,
              severity: "warning",
              message: `Duplicate joint ${id}; the later definition replaces the earlier one.`,
            });
            fragment.nodes = fragment.nodes.filter((n) => n.id !== id);
          }
          nodeIds.add(id);
          fragment.nodes.push({ id, x, y, z });
        }
        j += 1;
      }
      i = j - 1;
      continue;
    }

    if (upper.startsWith("MEMBER INCIDENCE")) {
      fragment.consumedLines.push(line.number);
      let j = i + 1;
      while (j < lines.length && isContinuation(lines[j])) {
        const tokens = lines[j].tokens;
        fragment.consumedLines.push(lines[j].number);
        if (tokens.length < 3 || tokens.length % 3 !== 0) {
          fragment.diagnostics.push({
            line: lines[j].number,
            severity: "error",
            message: "Member incidence line must contain groups of 3 integers (member joint1 joint2).",
          });
        }
        for (let k = 0; k + 2 < tokens.length; k += 3) {
          const id = toNumber(tokens[k]);
          const startNode = toNumber(tokens[k + 1]);
          const endNode = toNumber(tokens[k + 2]);
          if (id === null || startNode === null || endNode === null) continue;
          fragment.members.push({ id, startNode, endNode });
        }
        j += 1;
      }
      i = j - 1;
      continue;
    }

    if (upper.startsWith("ELEMENT INCIDENCE") || upper.startsWith("PLATE INCIDENCE") || upper.startsWith("SHELL INCIDENCE")) {
      fragment.consumedLines.push(line.number);
      const isShell = upper.includes("SHELL") || upper.startsWith("PLATE") || upper.startsWith("ELEMENT");
      let j = i + 1;
      while (j < lines.length && isContinuation(lines[j])) {
        const tokens = lines[j].tokens;
        fragment.consumedLines.push(lines[j].number);
        if (!isShell) {
          j += 1;
          continue;
        }
        if (tokens.length < 5 || (tokens.length - 1) % 4 !== 0) {
          fragment.diagnostics.push({
            line: lines[j].number,
            severity: "error",
            message: "Quad element incidence line must contain groups of 5 integers (element n1 n2 n3 n4).",
          });
          j += 1;
          continue;
        }
        for (let k = 0; k + 4 < tokens.length; k += 5) {
          const id = toNumber(tokens[k]);
          const a = toNumber(tokens[k + 1]);
          const b = toNumber(tokens[k + 2]);
          const c = toNumber(tokens[k + 3]);
          const d = toNumber(tokens[k + 4]);
          if (id === null || a === null || b === null || c === null || d === null) continue;
          fragment.quads.push({ id, nodes: [a, b, c, d] });
        }
        j += 1;
      }
      i = j - 1;
      continue;
    }
  }

  const known = new Set(fragment.nodes.map((n) => n.id));
  const missingMember = fragment.members.filter((m) => !known.has(m.startNode) || !known.has(m.endNode));
  if (missingMember.length) {
    fragment.diagnostics.push({
      line: 0,
      severity: "warning",
      message: `${missingMember.length} member(s) reference joints that are not defined in JOINT COORDINATES and cannot be used for load transfer.`,
    });
  }
  const missingQuad = fragment.quads.filter((q) => q.nodes.some((n) => !known.has(n)));
  if (missingQuad.length) {
    fragment.diagnostics.push({
      line: 0,
      severity: "warning",
      message: `${missingQuad.length} quad element(s) reference joints that are not defined and cannot be used for load transfer.`,
    });
  }

  return fragment;
}

export function mergeModel(fragment: ModelFragment, base: StructuralModel): StructuralModel {
  return {
    ...base,
    nodes: fragment.nodes.length ? fragment.nodes : base.nodes,
    members: fragment.members.length ? fragment.members : base.members,
    quads: fragment.quads.length ? fragment.quads : base.quads,
    sourceLabel: fragment.nodes.length ? "Imported from STAAD.Pro text" : base.sourceLabel,
  };
}
