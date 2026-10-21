import type {
  CoordMapping,
  Diagnostic,
  ProjectSettings,
  StructuralModel,
  VehicleDefinition,
  VehiclePlacement,
} from "../../types";
import { deckToGlobal, downwardForceComponents, globalToDeck } from "../coords";
import { resolvePlacement, vehicleFootprint, vehicleTotalLoadKN, type DeckLayout } from "../geometry";
import { fmt, round, sum } from "../units";
import { getAdapter } from "./adapters";
import { buildTransferContext, transferLoad, type Contribution, type TransferContext } from "./transfer";

/**
 * Explicit static-placement workflow
 * ==================================
 * A static placement is one specific vehicle position expressed as a primary load
 * case. A load case is only produced when every wheel (or track slice) can be
 * transferred to the supplied structural model by the selected method. If any
 * load cannot be placed, the case is marked invalid and is not emitted.
 */

export interface WheelTransfer {
  wheelId: string;
  axleLabel: string;
  xd: number;
  zd: number;
  loadKN: number;
  global: { x: number; y: number; z: number };
  contributions: Contribution[];
  method: string;
  warning?: string;
  error?: { code: string; message: string };
}

export interface StaticCasePlan {
  placementId: string;
  vehicleId: string;
  vehicleName: string;
  placementLabel: string;
  caseNumber: number;
  title: string;
  nodeLoads: Array<{ node: number; fx: number; fy: number; fz: number }>;
  transfers: WheelTransfer[];
  totalAppliedKN: number;
  totalEmittedKN: number;
  valid: boolean;
  lines: string[];
  diagnostics: Diagnostic[];
}

export interface StaticPlan {
  cases: StaticCasePlan[];
  context: TransferContext;
  diagnostics: Diagnostic[];
  valid: boolean;
}

function titleFor(vehicle: VehicleDefinition, placement: VehiclePlacement, limit: number): string {
  const base = `${vehicle.shortName} ${placement.label} POS`.toUpperCase().replace(/\s+/g, " ").trim();
  return base.slice(0, Math.max(8, limit));
}

export function planStaticCases(args: {
  vehicles: VehicleDefinition[];
  placements: VehiclePlacement[];
  model: StructuralModel;
  mapping: CoordMapping;
  layout: DeckLayout;
  settings: ProjectSettings;
  movingImpact: { enabled: boolean; factor: number; note: string };
}): StaticPlan {
  const { vehicles, placements, model, mapping, layout, settings, movingImpact } = args;
  const adapter = getAdapter(settings.staadVersion);
  const context = buildTransferContext(model, mapping);
  const diagnostics: Diagnostic[] = [];
  const cases: StaticCasePlan[] = [];
  const factor = movingImpact.enabled ? 1 + Math.max(0, movingImpact.factor) : 1;

  if (!model.nodes.length) {
    diagnostics.push({
      id: "static-no-model",
      severity: "error",
      category: "model",
      code: "static-no-model",
      message:
        "Static placement needs a structural model. Import JOINT COORDINATES (and MEMBER or ELEMENT INCIDENCES for distributed transfer) before a load case can be generated.",
      detail:
        "Without a model the app still shows the intended physical placement, but no load case is claimed to be structurally valid.",
    });
    return { cases: [], context, diagnostics, valid: false };
  }

  const visible = placements.filter((p) => p.visible);
  if (!visible.length) {
    diagnostics.push({
      id: "static-no-placements",
      severity: "warning",
      category: "syntax",
      code: "static-no-placements",
      message: "No visible vehicle placement; no static load case was generated.",
    });
  }

  visible.forEach((placement, index) => {
    const vehicle = vehicles.find((v) => v.id === placement.vehicleId);
    if (!vehicle) {
      diagnostics.push({
        id: `static-${placement.id}-vehicle`,
        severity: "error",
        category: "vehicle",
        code: "static-missing-vehicle",
        message: `Placement ${placement.label} references a vehicle that no longer exists.`,
        refs: { placementId: placement.id },
      });
      return;
    }
    const caseNumber = placement.loadCaseNumber ?? settings.staticCaseStart + index;
    const title = titleFor(vehicle, placement, adapter.titleLimit);
    const resolved = resolvePlacement(vehicle, placement, layout, model.trackTrackPoints);
    const footprint = vehicleFootprint(vehicle, placement, layout, model.trackTrackPoints);
    const transfers: WheelTransfer[] = [];
    const nodeTotals = new Map<number, { fx: number; fy: number; fz: number }>();
    const caseDiagnostics: Diagnostic[] = [];

    for (const wheel of footprint.wheels) {
      const loadKN = wheel.loadKN * factor;
      const point = { xd: wheel.xd, zd: wheel.zd };
      const global = deckToGlobal({ xd: point.xd, zd: point.zd, yd: 0 }, mapping);
      const result = transferLoad(context, point, loadKN);
      if (result.error) {
        caseDiagnostics.push({
          id: `static-${placement.id}-${wheel.id}-error`,
          severity: "error",
          category: "model",
          code: `transfer-${result.error.code}`,
          message: `${wheel.axleLabel}: ${result.error.message}`,
          detail: `Wheel/track slice at Xd = ${fmt(wheel.xd)} m, Zd = ${fmt(wheel.zd)} m, ${fmt(loadKN)} kN.`,
          refs: { placementId: placement.id, vehicleId: vehicle.id },
        });
      }
      if (result.warning) {
        caseDiagnostics.push({
          id: `static-${placement.id}-${wheel.id}-warning`,
          severity: "warning",
          category: "model",
          code: "transfer-snap",
          message: `${wheel.axleLabel}: ${result.warning}`,
          refs: { placementId: placement.id },
        });
      }
      const force = downwardForceComponents(loadKN, mapping);
      for (const contribution of result.contributions) {
        const existing = nodeTotals.get(contribution.node) ?? { fx: 0, fy: 0, fz: 0 };
        // The load magnitude is split between joints; direction comes from the mapping.
        const share = contribution.loadKN / (loadKN || 1);
        nodeTotals.set(contribution.node, {
          fx: existing.fx + force.fx * share,
          fy: existing.fy + force.fy * share,
          fz: existing.fz + force.fz * share,
        });
      }
      transfers.push({
        wheelId: wheel.id,
        axleLabel: wheel.axleLabel,
        xd: wheel.xd,
        zd: wheel.zd,
        loadKN,
        global,
        contributions: result.contributions,
        method: result.usedMethod,
        warning: result.warning,
        error: result.error,
      });
    }

    const nodeLoads = [...nodeTotals.entries()]
      .map(([node, force]) => ({
        node,
        fx: round(force.fx, 4),
        fy: round(force.fy, 4),
        fz: round(force.fz, 4),
      }))
      .filter((n) => Math.abs(n.fx) + Math.abs(n.fy) + Math.abs(n.fz) > 1e-6)
      .sort((a, b) => a.node - b.node);

    const totalAppliedKN = round(
      footprint.wheels.reduce((acc, w) => acc + w.loadKN * factor, 0),
      3,
    );
    const totalEmittedKN = round(
      transfers.reduce((acc, t) => acc + t.contributions.reduce((a, c) => a + c.loadKN, 0), 0),
      3,
    );
    const failed = transfers.filter((t) => t.error);
    const valid = failed.length === 0 && nodeLoads.length > 0;

    if (valid && Math.abs(totalEmittedKN - totalAppliedKN) > 0.05) {
      caseDiagnostics.push({
        id: `static-${placement.id}-sum`,
        severity: "error",
        category: "load",
        code: "static-load-sum",
        message: `Transferred load ${fmt(totalEmittedKN)} kN does not match the applied vehicle load ${fmt(totalAppliedKN)} kN.`,
        refs: { placementId: placement.id },
      });
    }

    const forceAxis = mapping.verticalAxis;
    const lines: string[] = [];
    const vehicleLoad = round(vehicleTotalLoadKN(vehicle) * factor, 3);
    if (settings.emitComments) {
      lines.push(
        `* ${placement.label}: ${vehicle.classification} | ${fmt(vehicleLoad, 0)} kN | reference point: ${placement.referencePoint}`,
      );
      lines.push(
        `* Mapping: Xd→${mapping.longitudinalSign > 0 ? "+" : "−"}${mapping.longitudinalAxis}, Zd→${
          mapping.transverseSign > 0 ? "+" : "−"
        }${mapping.transverseAxis}, Yd→${mapping.verticalSign > 0 ? "+" : "−"}${mapping.verticalAxis}; ` +
          `origin (${fmt(mapping.originXM)}, ${fmt(mapping.originYM)}, ${fmt(mapping.originZM)}) m.`,
      );
      lines.push(
        `* Transfer method: ${transfers[0]?.method ?? context.method}; ${transfers.length} wheel/track load points → ${nodeLoads.length} joints; applied ${fmt(
          totalAppliedKN,
        )} kN, emitted ${fmt(totalEmittedKN)} kN.`,
      );
      if (resolved.clearanceM !== null) {
        lines.push(`* Edge clearance constraint: ${fmt(resolved.clearanceM)} m.`);
      }
      if (movingImpact.enabled) {
        lines.push(`* Impact/dynamic multiplier ${fmt(1 + movingImpact.factor, 4)}. ${movingImpact.note}`);
      }
    }

    if (valid) {
      lines.push(`LOAD ${caseNumber} LOADTYPE ${settings.staticLoadType} TITLE ${title}`);
      lines.push("JOINT LOAD");
      for (const load of nodeLoads) {
        const parts: string[] = [];
        if (Math.abs(load.fx) > 1e-6) parts.push(`FX ${fmt(load.fx, 4)}`);
        if (Math.abs(load.fy) > 1e-6) parts.push(`FY ${fmt(load.fy, 4)}`);
        if (Math.abs(load.fz) > 1e-6) parts.push(`FZ ${fmt(load.fz, 4)}`);
        lines.push(`${load.node} ${parts.join(" ")}`);
      }
      void forceAxis;
    } else {
      lines.push(`* CASE NOT EMITTED — ${failed.length} load point(s) could not be transferred to the model.`);
      failed.slice(0, 8).forEach((t) => {
        lines.push(`*   ${t.axleLabel} at (${fmt(t.xd)}, ${fmt(t.zd)}) m: ${t.error?.message ?? "unknown error"}`);
      });
      if (failed.length > 8) lines.push(`*   … and ${failed.length - 8} more.`);
      diagnostics.push({
        id: `static-${placement.id}-invalid`,
        severity: "error",
        category: "model",
        code: "static-case-incomplete",
        message: `Load case for ${placement.label} was not emitted: ${failed.length} of ${transfers.length} load points could not be transferred.`,
        detail:
          "A partially loaded vehicle would misrepresent the structure. Choose a different transfer method, refine the model, or reposition the vehicle.",
        refs: { placementId: placement.id },
      });
    }

    cases.push({
      placementId: placement.id,
      vehicleId: vehicle.id,
      vehicleName: vehicle.name,
      placementLabel: placement.label,
      caseNumber,
      title,
      nodeLoads,
      transfers,
      totalAppliedKN,
      totalEmittedKN,
      valid,
      lines,
      diagnostics: caseDiagnostics,
    });
    diagnostics.push(...caseDiagnostics);
  });

  const caseNumbers = cases.filter((c) => c.valid).map((c) => c.caseNumber);
  const duplicates = caseNumbers.filter((n, i) => caseNumbers.indexOf(n) !== i);
  if (duplicates.length) {
    diagnostics.push({
      id: "static-duplicate-cases",
      severity: "error",
      category: "syntax",
      code: "duplicate-case-number",
      message: `Load case numbers must be unique. Duplicated: ${[...new Set(duplicates)].join(", ")}.`,
    });
  }

  const valid = cases.some((c) => c.valid) && !diagnostics.some((d) => d.severity === "error");
  return { cases, context, diagnostics, valid };
}

/** Returns the deck-plane positions of joints that received load, for canvas overlays. */
export function transferredNodePoints(plan: StaticPlan): Array<{ node: number; xd: number; zd: number; loadKN: number }> {
  const out = new Map<number, { node: number; xd: number; zd: number; loadKN: number }>();
  for (const planCase of plan.cases) {
    if (!planCase.valid) continue;
    for (const transfer of planCase.transfers) {
      for (const contribution of transfer.contributions) {
        const node = plan.context.nodeById.get(contribution.node);
        if (!node) continue;
        const existing = out.get(contribution.node);
        out.set(contribution.node, {
          node: contribution.node,
          xd: node.xd,
          zd: node.zd,
          loadKN: (existing?.loadKN ?? 0) + contribution.loadKN,
        });
      }
    }
  }
  return [...out.values()];
}

/** Total vertical load of a planned case, used by the validation panel. */
export function caseVerticalSum(planCase: StaticCasePlan, mapping: CoordMapping): number {
  const sign = -mapping.verticalSign;
  const magnitude = planCase.nodeLoads.reduce((acc, n) => {
    const component = mapping.verticalAxis === "X" ? n.fx : mapping.verticalAxis === "Y" ? n.fy : n.fz;
    return acc + component * sign;
  }, 0);
  return round(magnitude, 3);
}

export function nodeDeckPosition(node: { x: number; y: number; z: number }, mapping: CoordMapping) {
  return globalToDeck(node, mapping);
}

export function totalOf(contributions: Contribution[]): number {
  return round(sum(contributions.map((c) => c.loadKN)), 4);
}
