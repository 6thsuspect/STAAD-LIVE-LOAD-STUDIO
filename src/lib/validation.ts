import type { Diagnostic } from "../types";
import type { ProjectData } from "./project";
import { computeClearance, deckLayout, resolvePlacement, vehicleFootprint, vehicleTotalLoadKN } from "./geometry";
import { mappingIssues } from "./coords";
import { fmt, sum } from "./units";
import { validateVehicle } from "./vehicles";
import { generateDocument } from "./syntax/document";
import { parseSyntax } from "./syntax/parse";
import { TRANSFER_METHOD_LABELS } from "./syntax/transfer";

/**
 * Cross-cutting validation.
 * Every check is advisory with respect to engineering judgement: the app reports
 * what it can verify and never claims that a placement is a valid load case.
 */

function dedupe(diagnostics: Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>();
  const out: Diagnostic[] = [];
  for (const diagnostic of diagnostics) {
    const key = `${diagnostic.severity}|${diagnostic.code}|${diagnostic.message}|${diagnostic.refs?.placementId ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(diagnostic);
  }
  return out;
}

export function geometryDiagnostics(project: ProjectData): Diagnostic[] {
  const { deck } = project;
  const layout = deckLayout(deck);
  const diagnostics: Diagnostic[] = [];
  const add = (severity: Diagnostic["severity"], code: string, message: string, field?: string) =>
    diagnostics.push({
      id: `geom-${code}`,
      severity,
      category: "geometry",
      code,
      message,
      refs: field ? { field } : undefined,
    });

  if (deck.spanM <= 0) add("error", "span-invalid", "Bridge span must be greater than zero.", "spanM");
  if (deck.totalWidthM <= 0) add("error", "width-invalid", "Total deck width must be greater than zero.", "totalWidthM");

  ["leftBarrierWidthM", "rightBarrierWidthM", "leftFootpathWidthM", "rightFootpathWidthM", "leftKerbWidthM", "rightKerbWidthM"].forEach(
    (key) => {
      const value = deck[key as keyof typeof deck] as number;
      if (value < 0) add("error", `negative-${key}`, `${key} cannot be negative.`, key);
    },
  );

  const componentSum =
    deck.carriagewayWidthM +
    2 * 0 +
    deck.leftBarrierWidthM +
    deck.rightBarrierWidthM +
    deck.leftFootpathWidthM +
    deck.rightFootpathWidthM +
    deck.leftKerbWidthM +
    deck.rightKerbWidthM;
  if (Math.abs(componentSum - deck.totalWidthM) > 0.005) {
    add(
      "error",
      "width-inconsistent",
      `Barriers + footpaths + kerbs + carriageway = ${fmt(componentSum)} m but the total deck width is ${fmt(
        deck.totalWidthM,
      )} m. Adjust the component widths or the total width.`,
      "totalWidthM",
    );
  }
  if (Math.abs(layout.carriagewayWidthM - deck.carriagewayWidthM) > 0.005) {
    add(
      "warning",
      "carriageway-derived",
      `Effective carriageway between kerb faces is ${fmt(layout.carriagewayWidthM)} m but ${fmt(
        deck.carriagewayWidthM,
      )} m was entered. The derived value governs placement and clearance checks.`,
      "carriagewayWidthM",
    );
  }
  if (layout.carriagewayWidthM <= 0) {
    add("error", "carriageway-invalid", "Barriers, footpaths and kerbs leave no usable carriageway.", "carriagewayWidthM");
  }
  if (deck.laneCount < 1 || !Number.isInteger(deck.laneCount)) {
    add("error", "lane-count", "Lane count must be at least 1.", "laneCount");
  }
  const laneSum = sum(layout.laneWidthsM);
  if (Math.abs(laneSum - layout.carriagewayWidthM) > 0.005) {
    add(
      "warning",
      "lane-widths",
      `Lane widths total ${fmt(laneSum)} m against a ${fmt(layout.carriagewayWidthM)} m carriageway.`,
      "laneWidthsM",
    );
  }
  if (deck.laneCount >= 2 && layout.carriagewayWidthM > 0) {
    const narrowest = Math.min(...layout.laneWidthsM);
    if (narrowest < 2.5) {
      add(
        "info",
        "lane-narrow",
        `The narrowest lane is ${fmt(narrowest)} m. Confirm the lane configuration against the project road geometry.`,
        "laneWidthsM",
      );
    }
  }
  return diagnostics;
}

export function placementDiagnostics(project: ProjectData): Diagnostic[] {
  const layout = deckLayout(project.deck);
  const diagnostics: Diagnostic[] = [];
  project.placements.forEach((placement) => {
    const vehicle = project.vehicles.find((v) => v.id === placement.vehicleId);
    if (!vehicle) {
      diagnostics.push({
        id: `placement-${placement.id}-vehicle`,
        severity: "error",
        category: "vehicle",
        code: "placement-vehicle-missing",
        message: `Placement ${placement.label} has no valid vehicle definition.`,
        refs: { placementId: placement.id },
      });
      return;
    }
    const footprint = vehicleFootprint(vehicle, placement, layout, project.model.trackTrackPoints);
    const clearance = computeClearance(footprint, layout);
    const refs = { placementId: placement.id, vehicleId: vehicle.id };

    if (!clearance.insideDeck) {
      diagnostics.push({
        id: `placement-${placement.id}-outside`,
        severity: "warning",
        category: "placement",
        code: "outside-deck",
        message: `${placement.label} extends outside the deck boundary by ${fmt(
          Math.max(0, -clearance.beyondStartM, -clearance.beyondEndM, -clearance.toLeftDeckEdgeM, -clearance.toRightDeckEdgeM),
        )} m.`,
        detail: "Off-deck positions are preserved for checking but are not a valid design position.",
        refs,
      });
    }
    if (clearance.toLeftBarrierM < -1e-6 || clearance.toRightBarrierM < -1e-6) {
      diagnostics.push({
        id: `placement-${placement.id}-barrier`,
        severity: "warning",
        category: "placement",
        code: "barrier-interference",
        message: `${placement.label} interferes with a barrier: clearance ${fmt(clearance.toLeftBarrierM)} m to the left barrier inner face and ${fmt(
          clearance.toRightBarrierM,
        )} m to the right.`,
        refs,
      });
    }
    if (!clearance.insideCarriageway && clearance.insideDeck) {
      diagnostics.push({
        id: `placement-${placement.id}-verge`,
        severity: "warning",
        category: "placement",
        code: "outside-carriageway",
        message: `${placement.label} is at least partly on the footpath, kerb or barrier strip rather than the carriageway.`,
        refs,
      });
    }

    const kerbClearance = Math.min(
      layout.leftCarriagewayEdgeZd - footprint.bounds.maxZd,
      footprint.bounds.minZd - layout.rightCarriagewayEdgeZd,
    );
    const is70R = /70\s*R/i.test(vehicle.classification);
    const isClassA = /Class\s*A/i.test(vehicle.classification);
    if (is70R && kerbClearance < 1.2 - 1e-6) {
      diagnostics.push({
        id: `placement-${placement.id}-irc-70r`,
        severity: "warning",
        category: "placement",
        code: "irc-70r-clearance",
        message: `${placement.label}: nearest wheel/track edge is ${fmt(kerbClearance)} m from the kerb road face. IRC:6-2017 Cl. 204.1 note 4 requires C ≥ 1.20 m for Class 70R.`,
        refs,
      });
    }
    if (isClassA && kerbClearance < 0.15 - 1e-6) {
      diagnostics.push({
        id: `placement-${placement.id}-irc-classa`,
        severity: "warning",
        category: "placement",
        code: "irc-classa-clearance",
        message: `${placement.label}: nearest wheel edge is ${fmt(kerbClearance)} m from the kerb road face. IRC:6-2017 Table 3 requires f ≥ 0.15 m for a Class A train.`,
        refs,
      });
    }

    if (placement.mode === "edge" && placement.edge) {
      const resolved = resolvePlacement(vehicle, placement, layout, project.model.trackTrackPoints);
      const boundary =
        placement.edge.datum === "carriageway"
          ? placement.edge.side === "left"
            ? layout.leftCarriagewayEdgeZd
            : layout.rightCarriagewayEdgeZd
          : placement.edge.datum === "barrier"
            ? placement.edge.side === "left"
              ? layout.leftBarrierInnerZd
              : layout.rightBarrierInnerZd
            : placement.edge.side === "left"
              ? layout.leftDeckEdgeZd
              : layout.rightDeckEdgeZd;
      const outer =
        placement.edge.side === "left" ? footprint.bounds.maxZd : footprint.bounds.minZd;
      const actual = placement.edge.side === "left" ? boundary - outer : outer - boundary;
      if (Math.abs(actual - placement.edge.clearanceM) > 1e-4) {
        diagnostics.push({
          id: `placement-${placement.id}-edge`,
          severity: "error",
          category: "placement",
          code: "edge-clearance-mismatch",
          message: `Requested clearance ${fmt(placement.edge.clearanceM)} m is reproduced as ${fmt(actual)} m at ${fmt(
            resolved.longitudinalM,
          )} m station.`,
          refs,
        });
      }
    }

    if (placement.mode === "lane" && placement.lane) {
      if (placement.lane.laneIndex < 0 || placement.lane.laneIndex >= layout.lanes.length) {
        diagnostics.push({
          id: `placement-${placement.id}-lane`,
          severity: "error",
          category: "placement",
          code: "lane-index-invalid",
          message: `${placement.label} is assigned to lane ${placement.lane.laneIndex + 1}, which does not exist.`,
          refs,
        });
      }
    }

    const total = vehicleTotalLoadKN(vehicle);
    if (total <= 0) {
      diagnostics.push({
        id: `placement-${placement.id}-load`,
        severity: "error",
        category: "load",
        code: "zero-load",
        message: `${placement.label} carries no load.`,
        refs,
      });
    }
  });

  const caseNumbers = project.placements
    .map((p) => p.loadCaseNumber)
    .filter((n): n is number => typeof n === "number");
  const duplicates = caseNumbers.filter((n, i) => caseNumbers.indexOf(n) !== i);
  if (duplicates.length) {
    diagnostics.push({
      id: "placement-duplicate-cases",
      severity: "error",
      category: "syntax",
      code: "duplicate-load-case",
      message: `More than one placement uses load case ${[...new Set(duplicates)].join(", ")}.`,
    });
  }
  return diagnostics;
}

export function workflowDiagnostics(project: ProjectData): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const { settings, model, vehicles, placements, moving } = project;
  const issues = mappingIssues(settings.coordMapping);
  issues.forEach((issue, index) => {
    diagnostics.push({
      id: `mapping-${index}`,
      severity: "error",
      category: "model",
      code: "coordinate-mapping",
      message: issue,
    });
  });

  if (model.nodes.length) {
    const ids = new Set<number>();
    const duplicateIds = model.nodes.filter((n) => {
      if (ids.has(n.id)) return true;
      ids.add(n.id);
      return false;
    });
    if (duplicateIds.length) {
      diagnostics.push({
        id: "model-duplicate-joints",
        severity: "error",
        category: "model",
        code: "duplicate-joints",
        message: `Joint ids must be unique; ${duplicateIds.length} duplicate id(s) found.`,
      });
    }
    const nodeIds = new Set(model.nodes.map((n) => n.id));
    const badMembers = model.members.filter((m) => !nodeIds.has(m.startNode) || !nodeIds.has(m.endNode));
    if (badMembers.length) {
      diagnostics.push({
        id: "model-bad-members",
        severity: "warning",
        category: "model",
        code: "dangling-members",
        message: `${badMembers.length} member(s) reference joints that are not in the model and are ignored for load transfer.`,
      });
    }
    const badQuads = model.quads.filter((q) => q.nodes.some((n) => !nodeIds.has(n)));
    if (badQuads.length) {
      diagnostics.push({
        id: "model-bad-quads",
        severity: "warning",
        category: "model",
        code: "dangling-elements",
        message: `${badQuads.length} quad element(s) reference joints that are not in the model and are ignored for load transfer.`,
      });
    }
  }

  if (settings.workflow === "static") {
    if (!model.nodes.length) {
      diagnostics.push({
        id: "workflow-static-no-model",
        severity: "error",
        category: "model",
        code: "static-needs-model",
        message:
          "The static-placement workflow needs actual structural joints. Import the model or load the sample grillage before generating load cases.",
        detail: "The canvas still shows the intended physical placement; no load case is claimed to be valid.",
      });
    } else {
      if (model.loadTransfer === "two-node-lever" && !model.members.length) {
        diagnostics.push({
          id: "workflow-lever-no-members",
          severity: "error",
          category: "model",
          code: "lever-needs-members",
          message: "Two-joint lever transfer needs MEMBER INCIDENCES, which have not been supplied.",
        });
      }
      if (model.loadTransfer === "four-node-bilinear" && !model.quads.length) {
        diagnostics.push({
          id: "workflow-bilinear-no-quads",
          severity: "error",
          category: "model",
          code: "bilinear-needs-elements",
          message: "Bilinear quad transfer needs ELEMENT INCIDENCES SHELL, which have not been supplied.",
        });
      }
      if (model.loadTransfer === "nearest-node") {
        diagnostics.push({
          id: "workflow-nearest-node",
          severity: "warning",
          category: "model",
          code: "nearest-node-snap",
          message: `Nearest-joint transfer is active: wheel loads snap up to ${fmt(model.nodeToleranceM)} m or more to the closest joint. Use lever or bilinear transfer for a defensible load path.`,
        });
      }
    }
  }

  if (settings.workflow === "moving") {
    const trackedInUse = placements.some((p) => {
      const v = vehicles.find((x) => x.id === p.vehicleId);
      return v?.vehicleType === "tracked";
    });
    if (trackedInUse) {
      diagnostics.push({
        id: "workflow-tracked-moving",
        severity: "info",
        category: "syntax",
        code: "tracked-moving",
        message: `A tracked vehicle is represented by ${moving.trackSlices} longitudinal slices per track (separate moving-load definitions per track). Confirm the discretisation is adequate for the responses of interest.`,
      });
    }
    if (moving.impactEnabled && moving.impactFactor > 0) {
      diagnostics.push({
        id: "workflow-impact",
        severity: "warning",
        category: "load",
        code: "impact-applied",
        message: `A user impact/dynamic multiplier of ${fmt(1 + moving.impactFactor, 4)} is applied to the library loads. IRC impact provisions depend on span, class and location; this factor is not code-derived by the app.`,
      });
    }
    const sweepEnd = moving.startLongitudinalM + moving.direction * moving.incrementM * (moving.positionCount - 1);
    if (moving.positionCount > 0) {
      if (Math.min(moving.startLongitudinalM, sweepEnd) < -1e-6 || Math.max(moving.startLongitudinalM, sweepEnd) > project.deck.spanM + 1e-6) {
        diagnostics.push({
          id: "workflow-sweep-outside",
          severity: "warning",
          category: "syntax",
          code: "sweep-outside-span",
          message: `The generation sweep runs from ${fmt(Math.min(moving.startLongitudinalM, sweepEnd))} m to ${fmt(
            Math.max(moving.startLongitudinalM, sweepEnd),
          )} m while the deck spans 0 to ${fmt(project.deck.spanM)} m. Positions beyond the span are still generated.`,
        });
      }
    }
  }

  project.vehicles.forEach((vehicle) => {
    if (!project.placements.some((p) => p.vehicleId === vehicle.id)) return;
    validateVehicle(vehicle).forEach((issue, index) => {
      diagnostics.push({
        id: `vehicle-${vehicle.id}-${index}`,
        severity: issue.level,
        category: "vehicle",
        code: `vehicle-${issue.level}`,
        message: `${vehicle.shortName}: ${issue.message}`,
        refs: { vehicleId: vehicle.id },
      });
    });
  });

  // The generator's own output is re-parsed. Any error here is a generator bug and
  // is surfaced rather than shipped silently.
  const generated = generateDocument(project);
  diagnostics.push(...generated.diagnostics.filter((d) => d.severity !== "info"));
  const parsed = parseSyntax(generated.text);
  parsed.document.diagnostics
    .filter((d) => d.severity === "error")
    .forEach((diagnostic) => {
      diagnostics.push({
        id: `selfcheck-${diagnostic.code}-${diagnostic.line ?? 0}`,
        severity: "error",
        category: "syntax",
        code: "self-check",
        message: `Generated syntax failed the built-in parser check: ${diagnostic.message}`,
        line: diagnostic.line,
      });
    });

  if (settings.workflow === "static" && model.nodes.length) {
    const label = TRANSFER_METHOD_LABELS[model.loadTransfer];
    if (generated.staticPlan) {
      diagnostics.push({
        id: "workflow-transfer-label",
        severity: "info",
        category: "model",
        code: "transfer-method",
        message: `Static load transfer: ${label}.`,
      });
    }
  }

  return diagnostics;
}

export function computeDiagnostics(project: ProjectData): Diagnostic[] {
  const all = [...geometryDiagnostics(project), ...placementDiagnostics(project), ...workflowDiagnostics(project)];
  const order: Record<Diagnostic["severity"], number> = { error: 0, warning: 1, info: 2 };
  return dedupe(all).sort((a, b) => order[a.severity] - order[b.severity]);
}

export function countBySeverity(diagnostics: Diagnostic[]): { errors: number; warnings: number; infos: number } {
  return {
    errors: diagnostics.filter((d) => d.severity === "error").length,
    warnings: diagnostics.filter((d) => d.severity === "warning").length,
    infos: diagnostics.filter((d) => d.severity === "info").length,
  };
}
