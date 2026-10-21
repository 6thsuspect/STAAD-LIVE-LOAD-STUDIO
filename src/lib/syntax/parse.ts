import type {
  LoadGeneration,
  MovingLoadDefinition,
  ParsedDocument,
  ParseDiagnostic,
  StaticLoadCase,
  StaticNodeLoad,
} from "../../types";
import { round } from "../units";
import { parseStructuralModel, type ModelFragment } from "./model";
import { createSink, emptyParsedDocument, isNumericToken, toNumber, tokenizeSource, type SourceLine } from "./tokenize";

/**
 * Parser for supported STAAD.Pro syntax.
 *
 * Design rules (PRD §10):
 *  • Nothing is invented. A definition without a placement produces no placement.
 *  • Unsupported lines are preserved verbatim and reported with their line number.
 *  • Every recognised line is recorded so the UI can distinguish parsed content
 *    from preserved source.
 */

export interface ParseOutcome {
  document: ParsedDocument;
  model: ModelFragment;
}

const MOVING_START = /^DEFINE\s+MOVING\s+LOAD\b/;
const GENERATION_START = /^LOAD\s+GENERATION\b/;
const LOAD_CASE_START = /^LOAD\s+(\d+)\b/;
const JOINT_LOAD_START = /^JOINT\s+LOAD\b/;
const MEMBER_LOAD_START = /^(MEMBER|PLATE|ELEMENT|SHELL|FLOOR)\s+LOAD\b/;

function nextMeaningful(lines: SourceLine[], from: number): number {
  for (let i = from; i < lines.length; i += 1) {
    if (!lines[i].isBlank && !lines[i].isComment) return i;
  }
  return -1;
}

function parseMovingTypeLine(
  line: SourceLine,
  tokens: string[],
  sink: ReturnType<typeof createSink>,
): MovingLoadDefinition | null {
  const upper = tokens.map((t) => t.toUpperCase());
  if (upper[0] !== "TYPE") {
    sink.push({
      severity: "error",
      category: "syntax",
      code: "moving-missing-type",
      message: "A moving-load definition must start with TYPE.",
      line: line.number,
    });
    return null;
  }
  const typeNumber = toNumber(tokens[1]);
  if (typeNumber === null || !Number.isInteger(typeNumber) || typeNumber < 1) {
    sink.push({
      severity: "error",
      category: "syntax",
      code: "moving-bad-type-number",
      message: "TYPE must be a positive integer moving-load type number.",
      line: line.number,
    });
    return null;
  }
  const loadIndex = upper.indexOf("LOAD");
  if (loadIndex < 0) {
    sink.push({
      severity: "error",
      category: "syntax",
      code: "moving-missing-load",
      message: "TYPE line has no LOAD keyword.",
      line: line.number,
    });
    return null;
  }
  const distanceIndex = upper.indexOf("DISTANCE");
  const widthIndex = upper.indexOf("WIDTH");

  // Reject keywords we do not understand rather than guessing their meaning.
  const known = new Set(["TYPE", "LOAD", "DISTANCE", "WIDTH"]);
  const unknownKeyword = upper.find((token, index) => index > 1 && /^[A-Z_]+$/.test(token) && !known.has(token));
  if (unknownKeyword) {
    sink.push({
      severity: "error",
      category: "syntax",
      code: "moving-unknown-keyword",
      message: `Unknown keyword "${unknownKeyword}" in moving-load definition. The block was preserved but not interpreted.`,
      line: line.number,
    });
    return null;
  }

  const loadsEnd = [distanceIndex, widthIndex].filter((i) => i > loadIndex).sort((a, b) => a - b)[0] ?? tokens.length;
  const loads: number[] = [];
  for (let i = loadIndex + 1; i < loadsEnd; i += 1) {
    const value = toNumber(tokens[i]);
    if (value === null) {
      sink.push({
        severity: "error",
        category: "syntax",
        code: "moving-bad-load",
        message: `"${tokens[i]}" is not a numeric load value.`,
        line: line.number,
      });
      return null;
    }
    loads.push(value);
  }

  let distances: number[] = [];
  if (distanceIndex >= 0) {
    const end = widthIndex > distanceIndex ? widthIndex : tokens.length;
    for (let i = distanceIndex + 1; i < end; i += 1) {
      const value = toNumber(tokens[i]);
      if (value === null) {
        sink.push({
          severity: "error",
          category: "syntax",
          code: "moving-bad-distance",
          message: `"${tokens[i]}" is not a numeric distance value.`,
          line: line.number,
        });
        return null;
      }
      distances.push(value);
    }
  }

  let width: number | undefined;
  if (widthIndex >= 0) {
    if (widthIndex + 1 >= tokens.length) {
      sink.push({
        severity: "error",
        category: "syntax",
        code: "moving-missing-width",
        message: "WIDTH is present without a value.",
        line: line.number,
      });
      return null;
    }
    const value = toNumber(tokens[widthIndex + 1]);
    if (value === null) {
      sink.push({
        severity: "error",
        category: "syntax",
        code: "moving-bad-width",
        message: "WIDTH value is not numeric.",
        line: line.number,
      });
      return null;
    }
    width = value;
    if (widthIndex + 2 < tokens.length) {
      sink.push({
        severity: "warning",
        category: "syntax",
        code: "moving-trailing-tokens",
        message: `Unexpected tokens after WIDTH: "${tokens.slice(widthIndex + 2).join(" ")}". They were preserved but ignored.`,
        line: line.number,
      });
    }
  }

  if (!loads.length) {
    sink.push({
      severity: "error",
      category: "syntax",
      code: "moving-no-loads",
      message: "Moving-load definition contains no loads.",
      line: line.number,
    });
    return null;
  }
  if (distances.length !== loads.length - 1) {
    sink.push({
      severity: "error",
      category: "syntax",
      code: "moving-count-mismatch",
      message: `${loads.length} loads require ${loads.length - 1} inter-load distances; ${distances.length} were supplied.`,
      line: line.number,
    });
  }
  if (loads.some((l) => l <= 0)) {
    sink.push({
      severity: "warning",
      category: "load",
      code: "moving-nonpositive-load",
      message: "One or more moving loads are zero or negative. Check the direction convention of the source file.",
      line: line.number,
    });
  }

  return {
    typeNumber,
    loadsKN: loads,
    distancesM: distances,
    widthM: width,
    sourceLine: line.raw.trim(),
    sourceLineNumber: line.number,
  };
}

function parseGenerationLine(
  line: SourceLine,
  tokens: string[],
  count: number,
  sink: ReturnType<typeof createSink>,
): LoadGeneration | null {
  const upper = tokens.map((t) => t.toUpperCase());
  if (upper[0] !== "TYPE") {
    sink.push({
      severity: "error",
      category: "syntax",
      code: "generation-missing-type",
      message: "LOAD GENERATION must be followed by a TYPE line.",
      line: line.number,
    });
    return null;
  }
  const typeNumber = toNumber(tokens[1]);
  if (typeNumber === null) {
    sink.push({
      severity: "error",
      category: "syntax",
      code: "generation-bad-type",
      message: "LOAD GENERATION TYPE must be a number.",
      line: line.number,
    });
    return null;
  }
  const coords: number[] = [];
  let index = 2;
  while (index < tokens.length && coords.length < 3) {
    const value = toNumber(tokens[index]);
    if (value === null) break;
    coords.push(value);
    index += 1;
  }
  if (coords.length < 3) {
    sink.push({
      severity: "error",
      category: "syntax",
      code: "generation-missing-coords",
      message: "LOAD GENERATION TYPE requires three start coordinates (x y z).",
      line: line.number,
    });
    return null;
  }

  let incrementAxis: "X" | "Y" | "Z" = "X";
  let incrementM = 0;
  let hasIncrement = false;
  for (let i = index; i < tokens.length; i += 1) {
    const key = tokens[i].toUpperCase();
    if (["XINC", "YINC", "ZINC", "INC"].includes(key)) {
      const value = toNumber(tokens[i + 1]);
      if (value === null) {
        sink.push({
          severity: "error",
          category: "syntax",
          code: "generation-bad-increment",
          message: `${key} requires a numeric value.`,
          line: line.number,
        });
        return null;
      }
      incrementAxis = key === "ZINC" ? "Z" : key === "YINC" ? "Y" : "X";
      incrementM = value;
      hasIncrement = true;
      i += 1;
    } else if (key === "TOLERANCE") {
      i += 1;
    } else {
      sink.push({
        severity: "warning",
        category: "syntax",
        code: "generation-extra-token",
        message: `Unrecognised token "${tokens[i]}" in LOAD GENERATION; preserved but not interpreted.`,
        line: line.number,
      });
    }
  }
  if (!hasIncrement) {
    sink.push({
      severity: "warning",
      category: "syntax",
      code: "generation-no-increment",
      message: "LOAD GENERATION has no increment keyword; the sweep length cannot be reconstructed.",
      line: line.number,
    });
  }
  if (incrementM === 0 && hasIncrement) {
    sink.push({
      severity: "warning",
      category: "syntax",
      code: "generation-zero-increment",
      message: "LOAD GENERATION increment is zero.",
      line: line.number,
    });
  }

  return {
    positionCount: count,
    typeNumber,
    start: { x: coords[0], y: coords[1], z: coords[2] },
    incrementAxis,
    incrementM,
    sourceLine: line.raw.trim(),
    sourceLineNumber: line.number,
  };
}

function parseJointLoadLine(
  line: SourceLine,
  sink: ReturnType<typeof createSink>,
): StaticNodeLoad[] | null {
  const tokens = line.tokens;
  const nodes: number[] = [];
  let index = 0;
  while (index < tokens.length && isNumericToken(tokens[index])) {
    const value = toNumber(tokens[index]);
    if (value === null || !Number.isInteger(value)) break;
    nodes.push(value);
    index += 1;
  }
  if (!nodes.length) {
    sink.push({
      severity: "error",
      category: "syntax",
      code: "joint-load-no-node",
      message: "JOINT LOAD line does not start with a joint number.",
      line: line.number,
    });
    return null;
  }
  const forces: Record<string, number> = {};
  while (index < tokens.length) {
    const key = tokens[index].toUpperCase();
    if (!["FX", "FY", "FZ"].includes(key)) {
      sink.push({
        severity: "warning",
        category: "syntax",
        code: "joint-load-unsupported-component",
        message: `Joint load component "${tokens[index]}" is not reconstructed. FX/FY/FZ are supported.`,
        line: line.number,
      });
      return null;
    }
    const value = toNumber(tokens[index + 1]);
    if (value === null) {
      sink.push({
        severity: "error",
        category: "syntax",
        code: "joint-load-bad-value",
        message: `${key} requires a numeric value.`,
        line: line.number,
      });
      return null;
    }
    forces[key] = value;
    index += 2;
  }
  if (!Object.keys(forces).length) {
    sink.push({
      severity: "error",
      category: "syntax",
      code: "joint-load-no-component",
      message: "Joint load line has no FX/FY/FZ component.",
      line: line.number,
    });
    return null;
  }
  return nodes.map((node) => ({
    node,
    fx: forces.FX ?? 0,
    fy: forces.FY ?? 0,
    fz: forces.FZ ?? 0,
  }));
}

export function parseSyntax(source: string): ParseOutcome {
  const lines = tokenizeSource(source);
  const sink = createSink();
  const document = emptyParsedDocument(source);
  const model = parseStructuralModel(lines);
  const recognised = new Set<number>(model.consumedLines);
  let sawLoadItems = false;

  // A LOAD case immediately preceding a moving-load block is the anchor case for
  // LOAD GENERATION, not a static vehicle case.
  const movingAnchorHeaders = new Set<number>();
  for (let index = 0; index < lines.length; index += 1) {
    const candidate = lines[index];
    if (candidate.isBlank || candidate.isComment) continue;
    if (!GENERATION_START.test(candidate.upper.replace(/\s+/g, " "))) continue;
    for (let back = index - 1; back >= 0; back -= 1) {
      const previous = lines[back];
      if (previous.isBlank || previous.isComment) continue;
      const previousUpper = previous.upper.replace(/\s+/g, " ");
      if (previousUpper.startsWith("TYPE ") || MOVING_START.test(previousUpper)) continue;
      if (LOAD_CASE_START.test(previousUpper)) movingAnchorHeaders.add(previous.number);
      break;
    }
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.isBlank) continue;
    if (line.isComment) {
      document.comments.push({ line: line.number, text: line.raw });
      continue;
    }
    const upper = line.upper.replace(/\s+/g, " ");

    if (recognised.has(line.number)) continue;

    if (upper === "STAAD SPACE" || upper.startsWith("STAAD SPACE") || upper === "FINISH" || upper.startsWith("PERFORM ")) {
      recognised.add(line.number);
      continue;
    }

    if (upper.startsWith("UNIT ")) {
      recognised.add(line.number);
      const parts = upper.split(" ");
      const lengthUnit = parts[1];
      const forceUnit = parts.find((p) => ["KN", "KNS", "N", "KIP", "KG", "TON", "TNE"].includes(p));
      document.units = { length: lengthUnit, force: forceUnit };
      const supported =
        ["METER", "METRE", "M"].includes(lengthUnit ?? "") && ["KN", "KNS"].includes(forceUnit ?? "");
      if (!supported) {
        sink.push({
          severity: "warning",
          category: "syntax",
          code: "unsupported-units",
          message: `UNIT ${lengthUnit} ${forceUnit ?? ""} — only METER and KN are converted. Source values are preserved verbatim and interpreted as metres/kilonewtons.`,
          line: line.number,
        });
      }
      continue;
    }

    if (MOVING_START.test(upper)) {
      recognised.add(line.number);
      // One DEFINE MOVING LOAD block may hold several TYPE lines; consume them
      // until the next non-TYPE command.
      let cursor = i + 1;
      let sawType = false;
      while (true) {
        const next = nextMeaningful(lines, cursor);
        if (next < 0) break;
        if (!/^TYPE\b/.test(lines[next].upper)) break;
        recognised.add(lines[next].number);
        sawType = true;
        const parsed = parseMovingTypeLine(lines[next], lines[next].tokens, sink);
        if (parsed) document.movingDefinitions.push(parsed);
        cursor = next + 1;
      }
      if (!sawType) {
        // Inline form: DEFINE MOVING LOAD TYPE 1 LOAD …
        const inline = line.tokens.slice(3);
        if (inline.length && /^TYPE$/i.test(inline[0])) {
          const parsed = parseMovingTypeLine(line, inline, sink);
          if (parsed) document.movingDefinitions.push(parsed);
          sawType = true;
        }
      }
      if (!sawType) {
        sink.push({
          severity: "error",
          category: "syntax",
          code: "moving-missing-type-line",
          message: "DEFINE MOVING LOAD is not followed by a TYPE line. The block was preserved but not interpreted.",
          line: line.number,
        });
      }
      i = Math.max(i, cursor - 1);
      continue;
    }

    if (GENERATION_START.test(upper)) {
      recognised.add(line.number);
      const count = toNumber(line.tokens[2]);
      if (count === null || !Number.isInteger(count) || count < 1) {
        sink.push({
          severity: "error",
          category: "syntax",
          code: "generation-bad-count",
          message: "LOAD GENERATION requires a positive integer number of positions.",
          line: line.number,
        });
        continue;
      }
      const inline = line.tokens.slice(3);
      let genLine = line;
      let tokens = inline;
      if (!inline.length) {
        const next = nextMeaningful(lines, i + 1);
        if (next < 0 || !/^TYPE\b/.test(lines[next].upper)) {
          sink.push({
            severity: "error",
            category: "syntax",
            code: "generation-missing-type-line",
            message: "LOAD GENERATION is not followed by a TYPE line.",
            line: line.number,
          });
          continue;
        }
        genLine = lines[next];
        recognised.add(genLine.number);
        tokens = genLine.tokens;
        i = next;
      }
      const parsed = parseGenerationLine(genLine, tokens, count, sink);
      if (parsed) document.generations.push(parsed);
      continue;
    }

    const loadCaseMatch = upper.match(LOAD_CASE_START);
    if (loadCaseMatch && !upper.startsWith("LOAD COMB") && !upper.startsWith("LOAD LIST")) {
      recognised.add(line.number);
      const caseNumber = Number(loadCaseMatch[1]);
      const loadTypeMatch = upper.match(/LOADTYPE\s+([A-Z]+)/);
      const titleIndex = upper.indexOf("TITLE");
      const title = titleIndex >= 0 ? line.raw.trim().slice(line.raw.toUpperCase().indexOf("TITLE") + 5).trim() : "";
      if (movingAnchorHeaders.has(line.number)) {
        // Moving-load anchor case: it carries no joint-load items of its own.
        continue;
      }

      const current: StaticLoadCase = {
        caseNumber,
        title,
        loadType: loadTypeMatch?.[1] ?? "NONE",
        nodeLoads: [],
        sourceLine: line.raw.trim(),
        sourceLineNumber: line.number,
      };
      // Look ahead for a JOINT LOAD block belonging to this case.
      let j = i + 1;
      let sawJointLoadKeyword = false;
      while (j < lines.length) {
        const candidate = lines[j];
        if (candidate.isBlank || candidate.isComment) {
          j += 1;
          continue;
        }
        const candidateUpper = candidate.upper.replace(/\s+/g, " ");
        if (JOINT_LOAD_START.test(candidateUpper)) {
          sawJointLoadKeyword = true;
          recognised.add(candidate.number);
          j += 1;
          continue;
        }
        if (MEMBER_LOAD_START.test(candidateUpper)) {
          sawLoadItems = true;
          recognised.add(candidate.number);
          sink.push({
            severity: "warning",
            category: "syntax",
            code: "load-items-not-reconstructed",
            message: "Member/plate/shell load items are recognised but not reconstructed into vehicle geometry.",
            line: candidate.number,
          });
          j += 1;
          continue;
        }
        if (LOAD_CASE_START.test(candidateUpper) || GENERATION_START.test(candidateUpper) || MOVING_START.test(candidateUpper)) {
          break;
        }
        if (isNumericToken(candidate.tokens[0]) && sawJointLoadKeyword) {
          const parsed = parseJointLoadLine(candidate, sink);
          if (parsed) {
            current.nodeLoads.push(...parsed);
            recognised.add(candidate.number);
          }
          j += 1;
          continue;
        }
        break;
      }
      if (!current.nodeLoads.length) {
        sink.push({
          severity: "warning",
          category: "syntax",
          code: "case-without-joint-loads",
          message: `Load case ${caseNumber} was recognised but contains no reconstructable JOINT LOAD items.`,
          line: line.number,
        });
      }
      document.staticCases.push(current);
      if (j > i + 1) i = j - 1;
      continue;
    }

    if (upper.startsWith("LOAD COMB") || upper.startsWith("LOAD LIST")) {
      recognised.add(line.number);
      document.unsupported.push({
        line: line.number,
        text: line.raw,
        reason: "Load combinations and load lists are outside the supported reconstruction scope.",
      });
      continue;
    }

    if (
      ["SELFWEIGHT", "CONSTANTS", "SUPPORTS", "MEMBER PROPERTY", "ELEMENT PROPERTY", "PRINT", "PERFORM", "SET", "START"].some(
        (keyword) => upper.startsWith(keyword),
      )
    ) {
      recognised.add(line.number);
      continue;
    }

    document.unsupported.push({
      line: line.number,
      text: line.raw,
      reason: "Command is not part of the supported moving-load, static-placement or model-mapping grammar.",
    });
  }

  if (document.unsupported.length) {
    sink.push({
      severity: "warning",
      category: "syntax",
      code: "unsupported-lines",
      message: `${document.unsupported.length} line(s) are outside the supported grammar. They are preserved verbatim and listed with line numbers.`,
    });
  }

  void sawLoadItems;

  const generationsWithoutDefinition = document.generations.filter(
    (generation) => !document.movingDefinitions.some((definition) => definition.typeNumber === generation.typeNumber),
  );
  generationsWithoutDefinition.forEach((g) => {
    sink.push({
      severity: "warning",
      category: "syntax",
      code: "generation-without-definition",
      message: `LOAD GENERATION references moving-load TYPE ${g.typeNumber}, which is not defined in this source. The sweep cannot be reconstructed.`,
      line: g.sourceLineNumber,
    });
  });

  if (document.movingDefinitions.length && !document.generations.length && !document.staticCases.length) {
    sink.push({
      severity: "info",
      category: "syntax",
      code: "definition-without-placement",
      message:
        "The source defines moving-load vehicles but contains no LOAD GENERATION or static load case, so no vehicle position can be reconstructed. The definition is shown without inventing a placement.",
    });
  }

  document.recognisedLines = [...recognised].sort((a, b) => a - b);
  document.diagnostics = sink.diagnostics;
  document.status = sink.diagnostics.some((d) => d.severity === "error")
    ? "invalid"
    : document.unsupported.length || sink.diagnostics.some((d) => d.severity === "warning")
      ? "partial"
      : "valid";

  return { document, model };
}

export function summariseParsed(document: ParsedDocument): string {
  return [
    `${document.movingDefinitions.length} moving-load definition(s)`,
    `${document.generations.length} load generation(s)`,
    `${document.staticCases.length} static load case(s)`,
    `${document.unsupported.length} unsupported line(s)`,
  ].join(" · ");
}

export function totalOfCase(loadCase: StaticLoadCase): { fx: number; fy: number; fz: number } {
  return loadCase.nodeLoads.reduce(
    (acc, load) => ({
      fx: round(acc.fx + load.fx, 4),
      fy: round(acc.fy + load.fy, 4),
      fz: round(acc.fz + load.fz, 4),
    }),
    { fx: 0, fy: 0, fz: 0 },
  );
}
