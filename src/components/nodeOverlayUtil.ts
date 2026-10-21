import type { DeckGeometry, StructuralModel, VehicleDefinition, VehiclePlacement } from "../types";
import { deckLayout, type DeckLayout } from "../lib/geometry";
import { planStaticCases } from "../lib/syntax/static";
import { transferredNodePoints } from "../lib/syntax/static";
import { buildTransferContext } from "../lib/syntax/transfer";

export { buildTransferContext };

/** Node ids that received load in the current static plan — computed defensively. */
export function transferredNodePointsSafe(
  model: StructuralModel,
  mapping: import("../types").CoordMapping,
  vehicles: VehicleDefinition[],
  placements: VehiclePlacement[],
  deck: DeckLayout,
): Array<{ node: number; xd: number; zd: number; loadKN: number }> {
  try {
    const plan = planStaticCases({
      vehicles,
      placements,
      model,
      mapping,
      layout: deck,
      settings: {
        projectName: "",
        projectNumber: "",
        engineer: "",
        staadVersion: "2022",
        workflow: "static",
        coordMapping: mapping,
        deckLevelNote: "",
        emitComments: false,
        maxLineLength: 120,
        emitUnitCommand: false,
        snapStepM: 0.5,
        showModelNodes: true,
        staticCaseStart: 301,
        staticLoadType: "LIVE",
      },
      movingImpact: { enabled: false, factor: 0, note: "" },
    });
    return transferredNodePoints(plan);
  } catch {
    return [];
  }
}

export function layoutFor(deck: DeckGeometry): DeckLayout {
  return deckLayout(deck);
}
