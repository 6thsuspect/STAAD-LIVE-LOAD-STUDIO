import type { CoordMapping, LoadTransferMethod, ModelNode, StructuralModel } from "../../types";
import { globalToDeck } from "../coords";

/**
 * Vehicle load → structural model transfer
 * ========================================
 * A graphical position is not a load application point. Every wheel (or track
 * slice) must be transferred to the structural model by an explicit, documented
 * method. If the method cannot place the load, the app reports an error and emits
 * no load for that point — it never silently snaps a load to a different position.
 */

export interface ModelNodeDeck {
  id: number;
  xd: number;
  zd: number;
  yd: number;
  global: { x: number; y: number; z: number };
}

export interface TransferContext {
  nodes: ModelNodeDeck[];
  nodeById: Map<number, ModelNodeDeck>;
  members: Array<{ id: number; a: ModelNodeDeck; b: ModelNodeDeck }>;
  quads: Array<{ id: number; nodeIds: number[]; points: Array<{ xd: number; zd: number }> }>;
  method: LoadTransferMethod;
  nodeToleranceM: number;
  gridToleranceM: number;
}

export interface Contribution {
  node: number;
  loadKN: number;
  weight: number;
}

export interface TransferResult {
  contributions: Contribution[];
  usedMethod: LoadTransferMethod;
  fallback: boolean;
  warning?: string;
  error?: { code: string; message: string };
}

export const TRANSFER_METHOD_LABELS: Record<LoadTransferMethod, string> = {
  "exact-node": "Exact joint (no tolerance snap)",
  "nearest-node": "Nearest joint (documented snap)",
  "two-node-lever": "Two-joint lever along member",
  "four-node-bilinear": "Four-joint bilinear (quad element)",
};

export const TRANSFER_METHOD_HELP: Record<LoadTransferMethod, string> = {
  "exact-node": "Loads are only accepted where a joint lies within the tolerance of the load point. No load is emitted anywhere else.",
  "nearest-node": "Each load point is snapped to the nearest joint. The app reports every snap distance so the idealisation is auditable.",
  "two-node-lever": "The load point must lie on a defined member. The load is split between its two end joints by linear interpolation along the member axis.",
  "four-node-bilinear": "The load point must lie inside a defined quad element. The load is split to its four joints using bilinear shape functions.",
};

export function buildTransferContext(model: StructuralModel, mapping: CoordMapping): TransferContext {
  const nodes: ModelNodeDeck[] = model.nodes.map((n) => {
    const deck = globalToDeck({ x: n.x, y: n.y, z: n.z }, mapping);
    return { id: n.id, xd: deck.xd, zd: deck.zd, yd: deck.yd, global: { x: n.x, y: n.y, z: n.z } };
  });
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const members = model.members
    .map((m) => {
      const a = nodeById.get(m.startNode);
      const b = nodeById.get(m.endNode);
      return a && b ? { id: m.id, a, b } : null;
    })
    .filter((m): m is { id: number; a: ModelNodeDeck; b: ModelNodeDeck } => m !== null);
  const quads = model.quads
    .map((q) => {
      const nodes = q.nodes.map((id) => nodeById.get(id));
      if (nodes.some((n) => !n)) return null;
      const resolved = nodes as ModelNodeDeck[];
      return {
        id: q.id,
        nodeIds: q.nodes,
        points: resolved.map((p) => ({ xd: p.xd, zd: p.zd })),
      };
    })
    .filter((q): q is { id: number; nodeIds: number[]; points: Array<{ xd: number; zd: number }> } => q !== null);

  return {
    nodes,
    nodeById,
    members,
    quads,
    method: model.loadTransfer,
    nodeToleranceM: Math.max(model.nodeToleranceM, 1e-4),
    gridToleranceM: Math.max(model.gridToleranceM, 1e-4),
  };
}

function distance(ax: number, az: number, bx: number, bz: number): number {
  return Math.hypot(ax - bx, az - bz);
}

function nearestNode(ctx: TransferContext, xd: number, zd: number): { node: ModelNodeDeck; distance: number } | null {
  let best: { node: ModelNodeDeck; distance: number } | null = null;
  for (const node of ctx.nodes) {
    const d = distance(node.xd, node.zd, xd, zd);
    if (!best || d < best.distance) best = { node, distance: d };
  }
  return best;
}

function leverOnSegment(
  ctx: TransferContext,
  xd: number,
  zd: number,
): { a: ModelNodeDeck; b: ModelNodeDeck; t: number; offset: number } | null {
  let best: { a: ModelNodeDeck; b: ModelNodeDeck; t: number; offset: number } | null = null;
  for (const member of ctx.members) {
    const dx = member.b.xd - member.a.xd;
    const dz = member.b.zd - member.a.zd;
    const lengthSq = dx * dx + dz * dz;
    if (lengthSq < 1e-12) continue;
    const t = ((xd - member.a.xd) * dx + (zd - member.a.zd) * dz) / lengthSq;
    if (t < -1e-9 || t > 1 + 1e-9) continue;
    const px = member.a.xd + t * dx;
    const pz = member.a.zd + t * dz;
    const offset = distance(px, pz, xd, zd);
    if (offset > ctx.gridToleranceM) continue;
    if (!best || offset < best.offset) best = { a: member.a, b: member.b, t: Math.min(1, Math.max(0, t)), offset };
  }
  return best;
}

function shapeFunctions(xi: number, eta: number): number[] {
  return [
    0.25 * (1 - xi) * (1 - eta),
    0.25 * (1 + xi) * (1 - eta),
    0.25 * (1 + xi) * (1 + eta),
    0.25 * (1 - xi) * (1 + eta),
  ];
}

function bilinearPoint(points: Array<{ xd: number; zd: number }>, xi: number, eta: number): { xd: number; zd: number } {
  const N = shapeFunctions(xi, eta);
  return points.reduce(
    (acc, p, i) => ({ xd: acc.xd + N[i] * p.xd, zd: acc.zd + N[i] * p.zd }),
    { xd: 0, zd: 0 },
  );
}

/** Invert the bilinear map of a quad in the deck plane. Returns natural coordinates or null. */
export function invertQuad(
  points: Array<{ xd: number; zd: number }>,
  target: { xd: number; zd: number },
): { xi: number; eta: number } | null {
  const seeds = [
    { xi: 0, eta: 0 },
    { xi: 0.7, eta: 0.7 },
    { xi: -0.7, eta: 0.7 },
    { xi: 0.7, eta: -0.7 },
    { xi: -0.7, eta: -0.7 },
  ];
  for (const seed of seeds) {
    let xi = seed.xi;
    let eta = seed.eta;
    for (let iteration = 0; iteration < 40; iteration += 1) {
      const N = shapeFunctions(xi, eta);
      let x = 0;
      let z = 0;
      let dxdxi = 0;
      let dxdeta = 0;
      let dzdxi = 0;
      let dzdeta = 0;
      for (let i = 0; i < 4; i += 1) {
        const p = points[i];
        const dN_dxi = 0.25 * (i === 1 || i === 2 ? 1 : -1) * (1 + (i >= 2 ? 1 : -1) * eta);
        const dN_deta = 0.25 * (1 + (i === 1 || i === 2 ? 1 : -1) * xi) * (i >= 2 ? 1 : -1);
        x += N[i] * p.xd;
        z += N[i] * p.zd;
        dxdxi += dN_dxi * p.xd;
        dxdeta += dN_deta * p.xd;
        dzdxi += dN_dxi * p.zd;
        dzdeta += dN_deta * p.zd;
      }
      const r1 = x - target.xd;
      const r2 = z - target.zd;
      if (Math.hypot(r1, r2) < 1e-9) {
        if (Math.abs(xi) <= 1.001 && Math.abs(eta) <= 1.001) return { xi, eta };
        break;
      }
      const det = dxdxi * dzdeta - dxdeta * dzdxi;
      if (Math.abs(det) < 1e-12) break;
      const dxi = (r1 * dzdeta - r2 * dxdeta) / det;
      const deta = (dxdxi * r2 - dzdxi * r1) / det;
      xi -= dxi;
      eta -= deta;
      if (Math.abs(dxi) + Math.abs(deta) < 1e-12) break;
    }
  }
  return null;
}

export function transferLoad(
  ctx: TransferContext,
  point: { xd: number; zd: number },
  loadKN: number,
): TransferResult {
  const { method } = ctx;
  if (!ctx.nodes.length) {
    return {
      contributions: [],
      usedMethod: method,
      fallback: false,
      error: { code: "no-model", message: "No structural joints are defined; a load cannot be transferred." },
    };
  }

  if (method === "exact-node") {
    const nearest = nearestNode(ctx, point.xd, point.zd);
    if (!nearest || nearest.distance > ctx.nodeToleranceM) {
      return {
        contributions: [],
        usedMethod: method,
        fallback: false,
        error: {
          code: "no-joint-at-position",
          message: `No joint within ${ctx.nodeToleranceM} m of the load point (nearest joint ${nearest?.node.id ?? "—"} at ${
            nearest ? nearest.distance.toFixed(3) : "—"
          } m). Choose a load-transfer method or adjust the placement.`,
        },
      };
    }
    return { contributions: [{ node: nearest.node.id, loadKN, weight: 1 }], usedMethod: method, fallback: false };
  }

  if (method === "nearest-node") {
    const nearest = nearestNode(ctx, point.xd, point.zd);
    if (!nearest) {
      return {
        contributions: [],
        usedMethod: method,
        fallback: false,
        error: { code: "no-joint", message: "No joints are available for nearest-joint transfer." },
      };
    }
    return {
      contributions: [{ node: nearest.node.id, loadKN, weight: 1 }],
      usedMethod: method,
      fallback: nearest.distance > ctx.nodeToleranceM,
      warning:
        nearest.distance > ctx.nodeToleranceM
          ? `Load snapped ${nearest.distance.toFixed(3)} m to joint ${nearest.node.id} by the nearest-joint method.`
          : undefined,
    };
  }

  if (method === "two-node-lever") {
    if (!ctx.members.length) {
      return {
        contributions: [],
        usedMethod: method,
        fallback: false,
        error: {
          code: "no-members",
          message: "MEMBER INCIDENCES was not supplied, so two-joint lever transfer is not possible.",
        },
      };
    }
    const hit = leverOnSegment(ctx, point.xd, point.zd);
    if (!hit) {
      return {
        contributions: [],
        usedMethod: method,
        fallback: false,
        error: {
          code: "off-member",
          message: `Load point is not within ${ctx.gridToleranceM} m of a defined member axis, so it cannot be distributed by lever transfer.`,
        },
      };
    }
    if (hit.a.id === hit.b.id) {
      return { contributions: [{ node: hit.a.id, loadKN, weight: 1 }], usedMethod: method, fallback: false };
    }
    const contributions = [
      { node: hit.a.id, loadKN: loadKN * (1 - hit.t), weight: 1 - hit.t },
      { node: hit.b.id, loadKN: loadKN * hit.t, weight: hit.t },
    ].filter((c) => Math.abs(c.loadKN) > 1e-9);
    return { contributions, usedMethod: method, fallback: false };
  }

  // four-node-bilinear
  if (!ctx.quads.length) {
    return {
      contributions: [],
      usedMethod: method,
      fallback: false,
      error: {
        code: "no-elements",
        message: "ELEMENT INCIDENCES SHELL was not supplied, so bilinear quad transfer is not possible.",
      },
    };
  }
  for (const quad of ctx.quads) {
    const natural = invertQuad(quad.points, point);
    if (!natural) continue;
    const N = shapeFunctions(natural.xi, natural.eta);
    const contributions = quad.nodeIds
      .map((node, index) => ({ node, loadKN: loadKN * N[index], weight: N[index] }))
      .filter((c) => c.weight > 1e-9);
    return { contributions, usedMethod: method, fallback: false };
  }

  return {
    contributions: [],
    usedMethod: method,
    fallback: false,
    error: {
      code: "outside-elements",
      message: `Load point is not inside any defined quad element (grid tolerance ${ctx.gridToleranceM} m).`,
    },
  };
}
