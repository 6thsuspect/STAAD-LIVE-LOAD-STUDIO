import type { Diagnostic, GeneratedSyntaxBlock, ProjectSettings } from "../../types";
import type { ProjectData } from "../project";
import { deckLayout } from "../geometry";
import { fmt } from "../units";
import { describeMapping } from "../coords";
import { getAdapter } from "./adapters";
import { generateMovingBlocks } from "./moving";
import { planStaticCases, type StaticPlan } from "./static";

/**
 * Full STAAD.Pro document generation.
 *
 * Output is deterministic: no timestamps, no random ids, no locale-dependent
 * number formatting. Identical inputs always produce identical text (PRD §10).
 */

export interface SyntaxDocumentResult {
  text: string;
  blocks: GeneratedSyntaxBlock[];
  diagnostics: Diagnostic[];
  staticPlan?: StaticPlan;
  lineCount: number;
}

function header(project: ProjectData, settings: ProjectSettings): string[] {
  const adapter = getAdapter(settings.staadVersion);
  const workflowLabel =
    settings.workflow === "moving"
      ? "MOVING-LOAD GENERATION"
      : "EXPLICIT STATIC VEHICLE PLACEMENT";
  const lines: string[] = [
    "STAAD SPACE",
    "* ============================================================",
    "* STAAD.Pro IRC Live Load Studio — generated input",
    `* Project : ${settings.projectName || project.name}${settings.projectNumber ? ` (${settings.projectNumber})` : ""}`,
    `* Workflow: ${workflowLabel}`,
    `* Target  : ${adapter.label} — adapter status: ${adapter.status}`,
    `* Mapping : ${describeMapping(settings.coordMapping)}`,
    "* Units   : metres and kilonewtons",
    "* ------------------------------------------------------------",
  ];
  if (adapter.status !== "verified") {
    lines.push(
      "* NOTICE  : generated syntax has not been executed in a licensed STAAD.Pro",
      "*           installation. Verify before design use. See README release gates.",
    );
  }
  if (settings.deckLevelNote) {
    lines.push(`* Deck level: ${settings.deckLevelNote}`);
  }
  if (settings.workflow === "static") {
    lines.push(
      "* Static case: vehicle wheel/track loads transferred to the supplied",
      "* structural model. Verify the transfer method and joint forces.",
    );
  }
  lines.push("* ============================================================");
  return lines;
}

export function generateDocument(project: ProjectData): SyntaxDocumentResult {
  const { settings, moving, placements, vehicles, model, deck } = project;
  const layout = deckLayout(deck);
  const adapter = getAdapter(settings.staadVersion);
  const diagnostics: Diagnostic[] = [];
  const lines: string[] = header(project, settings);
  const blocks: GeneratedSyntaxBlock[] = [];
  let staticPlan: StaticPlan | undefined;

  const cursor = () => lines.length + 1;

  if (moving.emitUnitCommand && settings.emitUnitCommand) {
    lines.push("UNIT METER KN");
    lines.push("");
  } else if (settings.emitUnitCommand) {
    lines.push("UNIT METER KN");
    lines.push("");
  }

  if (settings.workflow === "moving") {
    const start = cursor();
    const generated = generateMovingBlocks({
      vehicles,
      placements,
      moving,
      mapping: settings.coordMapping,
      layout,
      version: settings.staadVersion,
      emitComments: settings.emitComments,
      titleLimit: adapter.titleLimit,
    });
    diagnostics.push(...generated.diagnostics);
    let blockStart = start;
    generated.blocks.forEach((block) => {
      blockStart = cursor();
      lines.push(...block.lines, "");
      if (block.placementId) {
        blocks.push({
          id: `moving-${block.placementId}`,
          heading: `Moving-load ${block.definitions.map((d) => `TYPE ${d.typeNumber}`).join(", ")}`,
          placementId: block.placementId,
          vehicleId: block.vehicleId,
          text: block.lines.join("\n"),
          lineStart: blockStart,
          lineEnd: cursor() - 2,
        });
      }
    });
  } else {
    staticPlan = planStaticCases({
      vehicles,
      placements,
      model,
      mapping: settings.coordMapping,
      layout,
      settings,
      movingImpact: { enabled: moving.impactEnabled, factor: moving.impactFactor, note: moving.impactNote },
    });
    diagnostics.push(...staticPlan.diagnostics);
    if (settings.emitComments) {
      lines.push(
        `* Structural model: ${model.nodes.length} joints, ${model.members.length} members, ${model.quads.length} quads (${model.sourceLabel})`,
      );
      lines.push(`* Load transfer : ${staticPlan.cases[0]?.transfers[0]?.method ?? model.loadTransfer}`);
      lines.push(`* Vehicle cases : ${staticPlan.cases.filter((c) => c.valid).length} emitted, ${staticPlan.cases.filter((c) => !c.valid).length} rejected`);
      lines.push("");
    }
    staticPlan.cases.forEach((planCase) => {
      const blockStart = cursor();
      lines.push(...planCase.lines, "");
      blocks.push({
        id: `static-${planCase.placementId}`,
        heading: `Case ${planCase.caseNumber} · ${planCase.placementLabel}`,
        placementId: planCase.placementId,
        vehicleId: planCase.vehicleId,
        text: planCase.lines.join("\n"),
        lineStart: blockStart,
        lineEnd: cursor() - 2,
      });
    });
  }

  lines.push("* ------------------------------------------------------------");
  lines.push("* End of generated vehicle load input.");
  lines.push("* Independent engineering verification is required before use.");

  // Long-line report — informational only. Lines are never wrapped, because a
  // wrapped command is not guaranteed to be valid STAAD.Pro input.
  lines.forEach((line, index) => {
    if (line.length > settings.maxLineLength) {
      diagnostics.push({
        id: `long-line-${index}`,
        severity: "info",
        category: "syntax",
        code: "long-line",
        message: `Line ${index + 1} is ${line.length} characters long (limit ${settings.maxLineLength}). Long commands are not wrapped automatically.`,
        line: index + 1,
      });
    }
  });

  const text = lines.join("\n");
  return {
    text,
    blocks,
    diagnostics,
    staticPlan,
    lineCount: lines.length,
  };
}

export function syntaxStats(text: string): { lines: number; characters: number } {
  const lines = text.split("\n").length;
  return { lines, characters: text.length };
}

export function formatDiagnosticCounts(diagnostics: Diagnostic[]): string {
  const errors = diagnostics.filter((d) => d.severity === "error").length;
  const warnings = diagnostics.filter((d) => d.severity === "warning").length;
  return `${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}`;
}

export function vehicleBlockText(blocks: GeneratedSyntaxBlock[], placementId: string): string {
  const block = blocks.find((b) => b.placementId === placementId);
  return block?.text ?? "";
}

export function firstLoadSummary(project: ProjectData): string {
  const layout = deckLayout(project.deck);
  return `Carriageway ${fmt(layout.carriagewayWidthM)} m over ${fmt(layout.spanM)} m span`;
}
