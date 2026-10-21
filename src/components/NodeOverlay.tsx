import { useMemo } from "react";
import { useStudio } from "../store/studio";
import { deckLayout, type DeckLayout } from "../lib/geometry";
import { transferredNodePointsSafe } from "./nodeOverlayUtil";
import { buildTransferContext } from "../lib/syntax/transfer";
import { useCanvasPalette } from "../lib/useTheme";

/**
 * Structural model overlay in deck coordinates.
 * Joints are drawn where they actually are; nothing is snapped for display.
 */
export function NodeOverlay({
  layout,
  px,
  showNodes,
}: {
  layout: DeckLayout;
  px: (v: number) => number;
  showNodes: boolean;
}) {
  const palette = useCanvasPalette();
  const model = useStudio((s) => s.model);
  const mapping = useStudio((s) => s.settings.coordMapping);
  const workflow = useStudio((s) => s.settings.workflow);
  const placements = useStudio((s) => s.placements);
  const vehicles = useStudio((s) => s.vehicles);
  const deck = useStudio((s) => s.deck);

  const overlay = useMemo(() => {
    if (!model.nodes.length) return null;
    const ctx = buildTransferContext(model, mapping);
    const loaded = workflow === "static" ? transferredNodePointsSafe(model, mapping, vehicles, placements, deckLayout(deck)) : [];
    return { ctx, loaded: new Map(loaded.map((entry) => [entry.node, entry.loadKN])) };
  }, [model, mapping, workflow, vehicles, placements, deck]);

  if (!showNodes || !overlay) return null;
  const { ctx, loaded } = overlay;

  return (
    <g aria-hidden opacity={0.9}>
      {ctx.quads.map((quad) => (
        <polygon
          key={`quad-${quad.id}`}
          points={quad.points.map((p) => `${p.xd},${-p.zd}`).join(" ")}
          fill={palette.modelFill}
          stroke={palette.modelStroke}
          strokeWidth={px(1)}
         
        />
      ))}
      {ctx.members.map((member) => (
        <line
          key={`mem-${member.id}`}
          x1={member.a.xd}
          y1={-member.a.zd}
          x2={member.b.xd}
          y2={-member.b.zd}
          stroke={palette.modelMember}
          strokeWidth={px(1)}
         
        />
      ))}
      {ctx.nodes.map((node) => {
        const load = loaded.get(node.id);
        return (
          <g key={`node-${node.id}`}>
            <circle cx={node.xd} cy={-node.zd} r={px(2.2)} fill={load ? palette.modelLoadedNode : palette.modelNode} fillOpacity={load ? 1 : 0.7} />
            {load !== undefined && px(1) < 0.06 && (
              <text x={node.xd + px(3)} y={-node.zd - px(3)} fontSize={px(7)} fill={palette.modelLoadedNode} className="mono">
                {load.toFixed(1)}
              </text>
            )}
          </g>
        );
      })}
      <text
        x={layout.spanM - px(4)}
        y={-layout.leftDeckEdgeZd + px(11)}
        fontSize={px(8)}
        fill={palette.modelLabel}
        textAnchor="end"
        className="mono"
      >
        model · {ctx.nodes.length} joints · {ctx.quads.length} quads · {ctx.members.length} members
      </text>
    </g>
  );
}
