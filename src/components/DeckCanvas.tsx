import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStudio } from "../store/studio";
import type { VehicleDefinition, VehiclePlacement, WheelLoad } from "../types";
import {
  deckLayout,
  edgeBoundaryZd,
  laneCentreZd,
  localToDeck,
  referenceOffset,
  resolvePlacement,
  snapCandidates,
  vehicleFootprint,
  vehicleTotalLoadKN,
  type DeckLayout,
  type Point2,
} from "../lib/geometry";
import { buildTransferContext } from "../lib/syntax/transfer";
import { fmt } from "../lib/units";
import { NodeOverlay } from "./NodeOverlay";
import { useCanvasPalette } from "../lib/useTheme";

/**
 * Scaled SVG deck plan.
 *
 * Screen mapping: x_screen = Xd, y_screen = −Zd, so +Zd (the left deck edge) is
 * drawn upwards and the deck plan is never mirrored in the longitudinal direction.
 * All geometry is computed in metres and converted to the SVG viewBox, which is
 * also in metres. Text and line weights are compensated so they stay legible at
 * every zoom level.
 */

interface View {
  cx: number;
  cz: number;
  spanM: number;
}

type Tool = "select" | "pan" | "place";

interface DragState {
  id: string;
  pointerId: number;
  startWorld: Point2;
  startLongitudinal: number;
  startTransverse: number;
  moved: boolean;
  edgeClearance: number | null;
  edgeSide: "left" | "right" | null;
  boundary: number;
  relMax: number;
  relMin: number;
}

const MARGIN_M = 2.2;

function screen(p: Point2): { x: number; y: number } {
  return { x: p.xd, y: -p.zd };
}

export function DeckCanvas() {
  const palette = useCanvasPalette();
  const deck = useStudio((s) => s.deck);
  const vehicles = useStudio((s) => s.vehicles);
  const placements = useStudio((s) => s.placements);
  const model = useStudio((s) => s.model);
  const settings = useStudio((s) => s.settings);
  const moving = useStudio((s) => s.moving);
  const selectedPlacementId = useStudio((s) => s.selectedPlacementId);
  const selectPlacement = useStudio((s) => s.selectPlacement);
  const addPlacement = useStudio((s) => s.addPlacement);
  const updatePlacement = useStudio((s) => s.updatePlacement);
  const beginHistory = useStudio((s) => s.beginHistory);
  const removePlacement = useStudio((s) => s.removePlacement);
  const duplicatePlacement = useStudio((s) => s.duplicatePlacement);
  const notify = useStudio((s) => s.notify);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [size, setSize] = useState({ width: 900, height: 520 });
  const [view, setView] = useState<View>({ cx: deck.spanM / 2, cz: 0, spanM: Math.max(deck.spanM * 1.25, 20) });
  const [tool, setTool] = useState<Tool>("select");
  const [showSweep, setShowSweep] = useState(true);
  const [showDims, setShowDims] = useState(true);
  const [showNodes, setShowNodes] = useState(true);
  const [snapLabel, setSnapLabel] = useState<string | null>(null);
  const [hoverDeck, setHoverDeck] = useState<Point2 | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);

  const dragRef = useRef<DragState | null>(null);
  const panRef = useRef<{ pointerId: number; startX: number; startY: number; cx: number; cz: number; moved: number } | null>(null);
  const fittedRef = useRef(false);

  const layout = useMemo(() => deckLayout(deck), [deck]);
  const aspect = size.width / Math.max(1, size.height);
  const heightM = view.spanM / aspect;
  const pxPerM = size.width / view.spanM;
  const px = useCallback((value: number) => value / Math.max(0.2, pxPerM), [pxPerM]);

  /* ---------------------------------------------------------------- sizing */
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    if (typeof ResizeObserver === "undefined") {
      // Environments without ResizeObserver (older browsers, test runners) fall
      // back to the element's layout box measured once.
      const rect = element.getBoundingClientRect();
      setSize({ width: Math.max(200, rect.width || 900), height: Math.max(160, rect.height || 520) });
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      setSize({ width: Math.max(200, rect.width), height: Math.max(160, rect.height) });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const fit = useCallback(() => {
    const widthM = deck.totalWidthM + 2 * MARGIN_M;
    const spanM = deck.spanM + 2 * MARGIN_M;
    const needed = Math.max(spanM, widthM * aspect);
    setView({ cx: deck.spanM / 2, cz: 0, spanM: needed });
  }, [deck.spanM, deck.totalWidthM, aspect]);

  useEffect(() => {
    if (fittedRef.current) return;
    if (size.width > 0) {
      fittedRef.current = true;
      fit();
    }
  }, [fit, size.width]);

  // Refit when the span changes materially (keeps the plan usable after edits).
  const lastSpan = useRef(deck.spanM);
  useEffect(() => {
    if (Math.abs(lastSpan.current - deck.spanM) > 0.01) {
      lastSpan.current = deck.spanM;
      fit();
    }
  }, [deck.spanM, fit]);

  const label = (value: number) => fmt(value, 3);

  const viewBox = {
    x: view.cx - view.spanM / 2,
    y: -(view.cz + heightM / 2),
    width: view.spanM,
    height: heightM,
  };

  const toWorld = useCallback((event: { clientX: number; clientY: number }): Point2 => {
    const svg = svgRef.current;
    if (!svg) return { xd: 0, zd: 0 };
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { xd: 0, zd: 0 };
    const world = point.matrixTransform(ctm.inverse());
    return { xd: world.x, zd: -world.y };
  }, []);

  const zoomAt = useCallback(
    (factor: number, anchor?: Point2) => {
      setView((current) => {
        const nextSpan = Math.min(600, Math.max(3, current.spanM / factor));
        if (!anchor) return { ...current, spanM: nextSpan };
        const ratio = nextSpan / current.spanM;
        return {
          cx: anchor.xd + (current.cx - anchor.xd) * ratio,
          cz: anchor.zd + (current.cz - anchor.zd) * ratio,
          spanM: nextSpan,
        };
      });
    },
    [],
  );

  /* ------------------------------------------------------------- selection */
  const selected = placements.find((p) => p.id === selectedPlacementId) ?? null;
  const selectedVehicle = selected ? vehicles.find((v) => v.id === selected.vehicleId) : undefined;
  const footprints = useMemo(() => {
    const map = new Map<string, ReturnType<typeof vehicleFootprint>>();
    placements.forEach((placement) => {
      const vehicle = vehicles.find((v) => v.id === placement.vehicleId);
      if (vehicle) map.set(placement.id, vehicleFootprint(vehicle, placement, layout, model.trackTrackPoints));
    });
    return map;
  }, [placements, vehicles, layout, model.trackTrackPoints]);

  const candidates = useMemo(() => snapCandidates(layout, settings.snapStepM), [layout, settings.snapStepM]);
  const snapTolerance = 10 / Math.max(1, pxPerM);

  /* -------------------------------------------------------------- dragging */
  const onVehiclePointerDown = (event: React.PointerEvent, placement: VehiclePlacement, vehicle: VehicleDefinition) => {
    event.stopPropagation();
    selectPlacement(placement.id);
    if (tool === "pan" || spaceDown) return;
    if (placement.locked) {
      notify("info", `${placement.label} is locked. Unlock it in the inspector to move it.`);
      return;
    }
    const start = toWorld(event);
    const resolved = resolvePlacement(vehicle, placement, layout, model.trackTrackPoints);
    const fp = footprints.get(placement.id);
    let edgeSide: "left" | "right" | null = null;
    let boundary = 0;
    let relMax = 0;
    let relMin = 0;
    if (placement.mode === "edge" && placement.edge && fp) {
      edgeSide = placement.edge.side;
      boundary = edgeBoundaryZd(layout, placement.edge.side, placement.edge.datum);
      relMax = fp.bounds.maxZd - resolved.transverseM;
      relMin = fp.bounds.minZd - resolved.transverseM;
    }
    dragRef.current = {
      id: placement.id,
      pointerId: event.pointerId,
      startWorld: start,
      startLongitudinal: resolved.longitudinalM,
      startTransverse: resolved.transverseM,
      moved: false,
      edgeClearance: placement.edge?.clearanceM ?? null,
      edgeSide,
      boundary,
      relMax,
      relMin,
    };
    (event.target as Element).setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    const world = toWorld(event);
    if (!drag) {
      if (tool === "place") setHoverDeck(world);
      return;
    }
    const dx = world.xd - drag.startWorld.xd;
    const dz = world.zd - drag.startWorld.zd;
    if (!drag.moved && Math.abs(dx) * pxPerM + Math.abs(dz) * pxPerM > 2) {
      drag.moved = true;
      // One history entry per drag gesture, taken before the first change.
      beginHistory();
    }
    if (!drag.moved) return;

    const placement = placements.find((p) => p.id === drag.id);
    const vehicle = placement ? vehicles.find((v) => v.id === placement.vehicleId) : undefined;
    if (!placement || !vehicle) return;

    let longitudinal = drag.startLongitudinal + dx;
    let snapText: string | null = null;

    candidates.forEach((candidate) => {
      if (candidate.xd !== null && Math.abs(candidate.xd - longitudinal) < snapTolerance) {
        longitudinal = candidate.xd;
        snapText = candidate.label;
      }
    });
    if (settings.snapStepM > 0) {
      const stepped = Math.round(longitudinal / settings.snapStepM) * settings.snapStepM;
      if (Math.abs(stepped - longitudinal) < snapTolerance * 0.4 && snapText === null) {
        longitudinal = stepped;
      }
    }

    const patch: Partial<VehiclePlacement> = { longitudinalM: longitudinal };

    if (placement.mode === "edge" && placement.edge && drag.edgeSide) {
      const newTransverse = drag.startTransverse + dz;
      const maxZd = newTransverse + drag.relMax;
      const minZd = newTransverse + drag.relMin;
      const clearance =
        drag.edgeSide === "left" ? drag.boundary - maxZd : minZd - drag.boundary;
      patch.edge = { ...placement.edge, clearanceM: Math.round(clearance * 1000) / 1000 };
    } else if (placement.mode === "lane") {
      let bestLane = placement.lane?.laneIndex ?? 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      layout.lanes.forEach((lane) => {
        const distance = Math.abs(lane.centreZd - (drag.startTransverse + dz));
        if (distance < bestDistance) {
          bestDistance = distance;
          bestLane = lane.index;
        }
      });
      patch.lane = { laneIndex: bestLane };
      snapText = `Lane ${bestLane + 1} centre`;
    } else if (placement.mode === "centreline") {
      snapText = "Deck centreline";
    } else {
      let transverse = drag.startTransverse + dz;
      candidates.forEach((candidate) => {
        if (candidate.zd !== null && Math.abs(candidate.zd - transverse) < snapTolerance) {
          transverse = candidate.zd;
          snapText = candidate.label;
        }
      });
      patch.transverseM = transverse;
    }

    setSnapLabel(snapText);
    updatePlacement(placement.id, patch, { record: false });
  };

  const endDrag = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (drag) {
      (event.target as Element).releasePointerCapture?.(event.pointerId);
      dragRef.current = null;
      setSnapLabel(null);
    }
    const pan = panRef.current;
    if (pan) {
      panRef.current = null;
      if (pan.moved < 4) {
        if (tool === "place") {
          placeAt(toWorld(event));
        } else {
          selectPlacement(null);
        }
      }
    }
  };

  const placeAt = (point: Point2) => {
    const state = useStudio.getState();
    const vehicleId = state.selectedVehicleId ?? state.vehicles[0]?.id;
    if (!vehicleId) return;
    const vehicle = state.vehicles.find((v) => v.id === vehicleId);
    if (!vehicle) return;
    // Choose the closest lane centre so the new vehicle starts inside a lane.
    let laneIndex = 0;
    let best = Number.POSITIVE_INFINITY;
    layout.lanes.forEach((lane) => {
      const distance = Math.abs(lane.centreZd - point.zd);
      if (distance < best) {
        best = distance;
        laneIndex = lane.index;
      }
    });
    addPlacement(vehicleId, Math.max(0, Math.min(deck.spanM, point.xd)), point.zd, {
      mode: "lane",
      lane: { laneIndex },
      referencePoint: "vehicle-centre",
    });
    notify("success", `${vehicle.shortName} placed in lane ${laneIndex + 1}.`);
  };

  /* --------------------------------------------------------------- viewport */
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    // React registers wheel handlers as passive; zoom must be able to prevent the
    // page from scrolling, so the listener is attached natively.
    const handler = (event: WheelEvent) => {
      event.preventDefault();
      zoomAt(Math.exp(-event.deltaY * 0.0015), toWorld(event));
    };
    svg.addEventListener("wheel", handler, { passive: false });
    return () => svg.removeEventListener("wheel", handler);
  }, [zoomAt, toWorld]);

  const onBackgroundPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0 && event.button !== 1) return;
    panRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      cx: view.cx,
      cz: view.cz,
      moved: 0,
    };
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
  };

  const onBackgroundPointerMove = (event: React.PointerEvent) => {
    const pan = panRef.current;
    if (!pan) return;
    const dx = event.clientX - pan.startX;
    const dy = event.clientY - pan.startY;
    pan.moved = Math.max(pan.moved, Math.abs(dx) + Math.abs(dy));
    setView((current) => ({
      ...current,
      cx: pan.cx - dx / pxPerM,
      cz: pan.cz + dy / pxPerM,
    }));
  };

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (event.key === "Escape") {
        setTool("select");
        selectPlacement(null);
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        if (!selectedPlacementId) return;
        event.preventDefault();
        removePlacement(selectedPlacementId);
        return;
      }
      const keyHandlers: Record<string, () => void> = {
        " ": () => setSpaceDown(true),
        v: () => setTool("select"),
        V: () => setTool("select"),
        h: () => setTool("pan"),
        H: () => setTool("pan"),
        p: () => setTool("place"),
        P: () => setTool("place"),
        f: fit,
        F: fit,
        "+": () => zoomAt(1.25),
        "=": () => zoomAt(1.25),
        "-": () => zoomAt(0.8),
        _: () => zoomAt(0.8),
      };

      if ((event.ctrlKey || event.metaKey) && (event.key === "d" || event.key === "D") && selectedPlacementId) {
        event.preventDefault();
        duplicatePlacement(selectedPlacementId);
        return;
      }

      // Nudge the selected vehicle with the arrow keys.
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key) && selectedPlacementId && !event.ctrlKey && !event.metaKey) {
        const placement = useStudio.getState().placements.find((p) => p.id === selectedPlacementId);
        const step = event.shiftKey ? settings.snapStepM * 10 : settings.snapStepM;
        if (!placement || placement.locked || step <= 0) return;
        event.preventDefault();
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          const delta = event.key === "ArrowLeft" ? -step : step;
          updatePlacement(placement.id, { longitudinalM: placement.longitudinalM + delta });
        } else if (placement.mode !== "edge" && placement.mode !== "lane" && placement.mode !== "centreline") {
          const delta = event.key === "ArrowUp" ? step : -step;
          updatePlacement(placement.id, { transverseM: placement.transverseM + delta, mode: "free" });
        }
        return;
      }

      const handler = keyHandlers[event.key];
      if (handler) {
        event.preventDefault();
        handler();
      }
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === "Space") setSpaceDown(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [fit, zoomAt, selectedPlacementId, removePlacement, duplicatePlacement, updatePlacement, settings.snapStepM, selectPlacement]);

  useEffect(() => {
    if (tool !== "place") setHoverDeck(null);
  }, [tool]);

  /* --------------------------------------------------------------- geometry */
  const selectedFootprint = selected ? footprints.get(selected.id) : undefined;

  const deckCorners = [
    screen({ xd: 0, zd: layout.leftDeckEdgeZd }),
    screen({ xd: deck.spanM, zd: layout.leftDeckEdgeZd }),
    screen({ xd: deck.spanM, zd: layout.rightDeckEdgeZd }),
    screen({ xd: 0, zd: layout.rightDeckEdgeZd }),
  ];

  const bandRect = (fromZd: number, toZd: number) => {
    const a = screen({ xd: 0, zd: fromZd });
    const b = screen({ xd: deck.spanM, zd: toZd });
    return {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      width: Math.abs(b.x - a.x),
      height: Math.abs(b.y - a.y),
    };
  };

  const gridStep = pxPerM > 45 ? 1 : pxPerM > 18 ? 2.5 : pxPerM > 8 ? 5 : 10;
  const gridLines = useMemo(() => {
    const verticals: number[] = [];
    const horizontals: number[] = [];
    for (let x = Math.floor(viewBox.x / gridStep) * gridStep; x <= viewBox.x + viewBox.width; x += gridStep) {
      verticals.push(x);
    }
    for (let y = Math.floor(viewBox.y / gridStep) * gridStep; y <= viewBox.y + viewBox.height; y += gridStep) {
      horizontals.push(y);
    }
    return { verticals, horizontals };
  }, [viewBox.x, viewBox.y, viewBox.width, viewBox.height, gridStep]);

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-white/[0.06] bg-ink-900/70 px-2 py-1.5">
        <div className="mr-1 flex items-center gap-1">
          <ToolButton active={tool === "select"} onClick={() => setTool("select")} title="Select and drag (V)">
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none"><path d="M3 2l9 5.5-4 .8-1.6 3.9L3 2z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg>
          </ToolButton>
          <ToolButton active={tool === "pan"} onClick={() => setTool("pan")} title="Pan (or hold Space)">
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none"><path d="M5 7V4.2a1.1 1.1 0 012.2 0V7m0-1.6a1.1 1.1 0 012.2 0V8m0-1.4a1.1 1.1 0 012.2 0v3.1c0 2-1.4 3.6-3.6 3.6H8.4A3.4 3.4 0 015 10V7.4a1.1 1.1 0 012.2 0" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" /></svg>
          </ToolButton>
          <ToolButton active={tool === "place"} onClick={() => setTool("place")} title="Place the selected library vehicle">
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none"><path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="1.3" /><rect x="5.5" y="5.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.1" /></svg>
          </ToolButton>
        </div>
        <div className="h-4 w-px bg-white/10" />
        <ToolButton onClick={() => zoomAt(1.25)} title="Zoom in">+</ToolButton>
        <ToolButton onClick={() => zoomAt(0.8)} title="Zoom out">−</ToolButton>
        <ToolButton onClick={fit} title="Fit deck to view (F)">Fit</ToolButton>
        <ToolButton
          onClick={() => {
            fittedRef.current = false;
            setView({ cx: deck.spanM / 2, cz: 0, spanM: Math.max(deck.spanM * 1.25, 20) });
            setTool("select");
            setSnapLabel(null);
          }}
          title="Reset view and tool"
        >
          Reset
        </ToolButton>
        <div className="h-4 w-px bg-white/10" />
        <ToolButton active={showSweep} onClick={() => setShowSweep((v) => !v)} title="Show moving-load sweep positions">Sweep</ToolButton>
        <ToolButton active={showNodes} onClick={() => setShowNodes((v) => !v)} title="Show structural joints and elements">Joints</ToolButton>
        <ToolButton active={showDims} onClick={() => setShowDims((v) => !v)} title="Show dimensions and clearance annotations">Dims</ToolButton>
        <div className="ml-auto flex items-center gap-1.5 text-[10.5px] text-slate-500">
          {snapLabel && <span className="rounded bg-cyan-500/10 px-1.5 py-0.5 text-cyan-300">snap: {snapLabel}</span>}
          <span className="mono hidden sm:inline">{fmt(pxPerM, 0)} px/m</span>
          {tool === "place" && <span className="rounded bg-signal-amber/15 px-1.5 py-0.5 text-signal-amber">click deck to place · Esc to cancel</span>}
        </div>
      </div>

      <div ref={containerRef} className="relative min-h-0 flex-1 overflow-hidden bg-canvas">
        <svg
          ref={svgRef}
          className="h-full w-full touch-none"
          role="application"
          aria-label="Scaled bridge deck plan. Drag vehicles to move them; use the inspector for exact coordinates."
          viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
          preserveAspectRatio="xMidYMid meet"
          style={{ cursor: tool === "place" ? "crosshair" : spaceDown || tool === "pan" ? "grab" : "default" }}
          onPointerDown={onBackgroundPointerDown}
          onPointerMove={(event) => {
            onBackgroundPointerMove(event);
            onPointerMove(event);
          }}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onPointerLeave={() => setHoverDeck(null)}
        >
          <defs>
            <pattern id="barrier-hatch" width="0.28" height="0.28" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="0.28" height="0.28" fill={palette.barrierHatchFill} />
              <line x1="0" y1="0" x2="0" y2="0.28" stroke={palette.barrierHatchLine} strokeWidth="0.09" />
            </pattern>
            <pattern id="track-hatch" width="0.22" height="0.22" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
              <rect width="0.22" height="0.22" fill={palette.trackHatchFill} />
              <line x1="0" y1="0" x2="0" y2="0.22" stroke={palette.trackHatchLine} strokeWidth="0.06" />
            </pattern>
            {/* Dimension ends are drawn as explicit screen-space ticks: marker
                rendering is inconsistent across renderers, ticks are not. */}
          </defs>

          {/* grid */}
          <g aria-hidden>
            {gridLines.verticals.map((x) => (
              <line key={`gv-${x}`} className="plan-grid" stroke={palette.grid} strokeWidth={px(1)} x1={x} y1={viewBox.y} x2={x} y2={viewBox.y + viewBox.height} />
            ))}
            {gridLines.horizontals.map((y) => (
              <line key={`gh-${y}`} className="plan-grid" stroke={palette.grid} strokeWidth={px(1)} x1={viewBox.x} y1={y} x2={viewBox.x + viewBox.width} y2={y} />
            ))}
          </g>

          {/* deck */}
          <polygon
            className="plan-deck"
            fill={palette.deckFill}
            stroke={palette.deckStroke}
            strokeWidth={px(1.2)}
            points={deckCorners.map((p) => `${p.x},${p.y}`).join(" ")}
          />

          {/* footpath bands */}
          <g aria-hidden>
            {deck.leftFootpathWidthM > 0 && (
              <rect {...bandRect(layout.leftBarrierInnerZd, layout.leftBarrierInnerZd - deck.leftFootpathWidthM)} fill={palette.footpathFill} stroke={palette.footpathStroke} strokeWidth={px(0.8)} />
            )}
            {deck.rightFootpathWidthM > 0 && (
              <rect {...bandRect(layout.rightBarrierInnerZd, layout.rightBarrierInnerZd + deck.rightFootpathWidthM)} fill={palette.footpathFill} stroke={palette.footpathStroke} strokeWidth={px(0.8)} />
            )}
            {deck.leftKerbWidthM > 0 && (
              <rect {...bandRect(layout.leftBarrierInnerZd - deck.leftFootpathWidthM, layout.leftCarriagewayEdgeZd)} fill={palette.kerbFill} />
            )}
            {deck.rightKerbWidthM > 0 && (
              <rect {...bandRect(layout.rightBarrierInnerZd + deck.rightFootpathWidthM, layout.rightCarriagewayEdgeZd)} fill={palette.kerbFill} />
            )}
          </g>

          {/* carriageway running surface */}
          <rect
            {...bandRect(layout.leftCarriagewayEdgeZd, layout.rightCarriagewayEdgeZd)}
            className="plan-surface"
            fill={palette.surfaceFill}
            stroke={palette.surfaceStroke}
            strokeWidth={px(1)}
          />

          {/* barriers */}
          {deck.leftBarrierWidthM > 0 && (
            <rect
              {...bandRect(layout.leftDeckEdgeZd, layout.leftBarrierInnerZd)}
              fill="url(#barrier-hatch)"
              stroke={palette.barrierStroke}
              strokeWidth={px(1)}
             
            />
          )}
          {deck.rightBarrierWidthM > 0 && (
            <rect
              {...bandRect(layout.rightDeckEdgeZd, layout.rightBarrierInnerZd)}
              fill="url(#barrier-hatch)"
              stroke={palette.barrierStroke}
              strokeWidth={px(1)}
             
            />
          )}

          {/* lane markings */}
          <g aria-hidden>
            {layout.lanes.map((lane) => (
              <line
                key={`lane-${lane.index}`}
                x1={0}
                y1={-lane.centreZd}
                x2={deck.spanM}
                y2={-lane.centreZd}
                stroke={palette.laneDash}
                strokeWidth={px(1)}
                strokeDasharray={`${px(10)} ${px(8)}`}
               
              />
            ))}
            <line x1={0} y1={-layout.leftCarriagewayEdgeZd} x2={deck.spanM} y2={-layout.leftCarriagewayEdgeZd} stroke={palette.edgeLine} strokeWidth={px(1.2)} />
            <line x1={0} y1={-layout.rightCarriagewayEdgeZd} x2={deck.spanM} y2={-layout.rightCarriagewayEdgeZd} stroke={palette.edgeLine} strokeWidth={px(1.2)} />
            <line
              x1={0}
              y1={0}
              x2={deck.spanM}
              y2={0}
              stroke={palette.centreline}
              strokeWidth={px(1.2)}
              strokeDasharray={`${px(18)} ${px(5)} ${px(3)} ${px(5)}`}
             
            />
          </g>

          {/* lane labels */}
          {layout.lanes.map((lane) => (
            <text
              key={`lane-label-${lane.index}`}
              x={viewBox.x + px(10)}
              y={-lane.centreZd + px(3.5)}
              fontSize={px(9)}
              className="plan-text"
              fill={palette.laneLabel}
            >
              L{lane.index + 1} · {fmt(lane.widthM)} m
            </text>
          ))}

          {/* structural model */}
          {showNodes && settings.showModelNodes && <NodeOverlay layout={layout} px={px} showNodes={showNodes} />}

          {/* moving sweep ghosts */}
          {showSweep && settings.workflow === "moving" && selected && selectedVehicle && (() => {
            const resolved = resolvePlacement(selectedVehicle, selected, layout, model.trackTrackPoints);
            const step = moving.direction * moving.incrementM;
            const count = Math.min(Math.max(1, moving.positionCount), 40);
            return Array.from({ length: count }).map((_, index) => {
              if (index === 0) return null;
              const ghost: VehiclePlacement = {
                ...selected,
                mode: "free",
                longitudinalM: moving.startLongitudinalM + index * step,
                transverseM: resolved.transverseM,
                rotationDeg: resolved.rotationDeg,
              };
              const fp = vehicleFootprint(selectedVehicle, ghost, layout, model.trackTrackPoints);
              return (
                <polygon
                  key={`ghost-${index}`}
                  points={fp.bodyCorners.map((c) => { const p = screen(c); return `${p.x},${p.y}`; }).join(" ")}
                  fill="none"
                  stroke={palette.vehicle(selected.color)}
                  strokeOpacity={0.2}
                  strokeWidth={px(1)}
                  strokeDasharray={`${px(3)} ${px(3)}`}
                 
                />
              );
            });
          })()}

          {/* vehicles */}
          {placements.map((placement) => {
            const vehicle = vehicles.find((v) => v.id === placement.vehicleId);
            const fp = footprints.get(placement.id);
            if (!vehicle || !fp || !placement.visible) return null;
            return (
              <VehicleGlyph
                key={placement.id}
                vehicle={vehicle}
                placement={placement}
                footprint={fp}
                layout={layout}
                selected={placement.id === selectedPlacementId}
                px={px}
                onPointerDown={(event) => onVehiclePointerDown(event, placement, vehicle)}
              />
            );
          })}

          {/* selected annotations */}
          {showDims && selected && selectedVehicle && selectedFootprint && (
            <SelectionAnnotations
              vehicle={selectedVehicle}
              placement={selected}
              footprint={selectedFootprint}
              layout={layout}
              px={px}
            />
          )}

          {/* overall dimensions */}
          {showDims && (
            <g aria-hidden>
              <DimensionLine
                from={screen({ xd: 0, zd: layout.rightDeckEdgeZd })}
                to={screen({ xd: deck.spanM, zd: layout.rightDeckEdgeZd })}
                offset={px(34)}
                direction="horizontal"
                px={px}
                text={`span ${label(deck.spanM)} m`}
              />
              <DimensionLine
                from={screen({ xd: deck.spanM, zd: layout.rightDeckEdgeZd })}
                to={screen({ xd: deck.spanM, zd: layout.leftDeckEdgeZd })}
                offset={px(40)}
                direction="vertical"
                px={px}
                text={`deck ${label(deck.totalWidthM)} m`}
              />
              <DimensionLine
                from={screen({ xd: 0, zd: layout.leftCarriagewayEdgeZd })}
                to={screen({ xd: 0, zd: layout.rightCarriagewayEdgeZd })}
                offset={-px(42)}
                direction="vertical"
                px={px}
                text={`carriageway ${label(layout.carriagewayWidthM)} m`}
              />
            </g>
          )}

          {/* axis triad */}
          <g transform={`translate(${viewBox.x + px(46)}, ${viewBox.y + viewBox.height - px(46)})`} aria-hidden>
            <line x1={0} y1={0} x2={px(28)} y2={0} stroke={palette.axisX} strokeWidth={px(1.4)} />
            <path d={`M ${px(32)} 0 L ${px(25)} ${-px(3)} L ${px(25)} ${px(3)} Z`} fill={palette.axisX} />
            <line x1={0} y1={0} x2={0} y2={-px(28)} stroke={palette.axisZ} strokeWidth={px(1.4)} />
            <path d={`M 0 ${-px(32)} L ${-px(3)} ${-px(25)} L ${px(3)} ${-px(25)} Z`} fill={palette.axisZ} />
            <text x={px(34)} y={px(3.5)} fontSize={px(9.5)} fill={palette.axisX}>Xd → {settings.coordMapping.longitudinalSign > 0 ? "+" : "−"}{settings.coordMapping.longitudinalAxis}</text>
            <text x={px(5)} y={-px(34)} fontSize={px(9.5)} fill={palette.axisZ}>Zd → {settings.coordMapping.transverseSign > 0 ? "+" : "−"}{settings.coordMapping.transverseAxis}</text>
            <text x={px(5)} y={px(13)} fontSize={px(8.5)} fill={palette.originText}>deck origin (0, 0)</text>
          </g>

          {/* scale bar */}
          <g transform={`translate(${viewBox.x + viewBox.width - px(120)}, ${viewBox.y + viewBox.height - px(24)})`} aria-hidden>
            <rect x={0} y={-px(2)} width={px(100)} height={px(4)} fill="none" stroke={palette.scaleStroke} strokeWidth={px(1)} />
            <rect x={0} y={-px(2)} width={px(50)} height={px(4)} fill={palette.scaleFill} />
            <rect x={px(50)} y={-px(2)} width={px(50)} height={px(4)} fill="none" stroke={palette.scaleFill} strokeWidth={px(1)} />
            <text x={0} y={-px(6)} fontSize={px(8.5)} fill={palette.scaleText}>0</text>
            <text x={px(100)} y={-px(6)} fontSize={px(8.5)} fill={palette.scaleText} textAnchor="end">{gridStep * 5} m</text>
          </g>

          {/* hover/place indicator */}
          {tool === "place" && hoverDeck && (
            <g pointerEvents="none">
              <line x1={hoverDeck.xd} y1={viewBox.y} x2={hoverDeck.xd} y2={viewBox.y + viewBox.height} stroke={palette.hover} strokeWidth={px(1)} strokeDasharray={`${px(3)} ${px(3)}`} />
              <line x1={viewBox.x} y1={-hoverDeck.zd} x2={viewBox.x + viewBox.width} y2={-hoverDeck.zd} stroke={palette.hover} strokeWidth={px(1)} strokeDasharray={`${px(3)} ${px(3)}`} />
              <circle cx={hoverDeck.xd} cy={-hoverDeck.zd} r={px(4)} fill={palette.hover} />
              <text x={hoverDeck.xd + px(8)} y={-hoverDeck.zd - px(7)} fontSize={px(9.5)} fill={palette.hover} className="mono">
                Xd {fmt(hoverDeck.xd, 2)} · Zd {fmt(hoverDeck.zd, 2)}
              </text>
            </g>
          )}
        </svg>

        {/* legend */}
        <div className="pointer-events-none absolute bottom-2 left-2 max-w-[280px] rounded border border-white/[0.06] bg-ink-950/80 px-2 py-1.5 text-[10px] leading-relaxed text-slate-500 backdrop-blur">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 border border-cyan-400/60 bg-cyan-400/10" /> vehicle envelope</span>
            <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-cyan-300" /> wheel / axle load</span>
            <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 bg-cyan-400/25" /> track contact</span>
          </div>
          <p className="mt-1">
            Xd longitudinal · Zd transverse · +Zd = left edge. Drag to move, wheel to zoom, Space+drag to pan, arrows nudge, F to
            fit.
          </p>
        </div>
      </div>
    </div>
  );
}

function ToolButton({
  children,
  onClick,
  active,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  title: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      aria-pressed={active}
      className={`flex h-6 min-w-6 items-center justify-center rounded border px-1.5 text-[11px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/40 ${
        active
          ? "border-cyan-400/40 bg-cyan-500/15 text-cyan-200"
          : "border-white/10 bg-ink-800 text-slate-400 hover:border-white/20 hover:text-slate-200"
      }`}
    >
      {children}
    </button>
  );
}

function DimensionLine({
  from,
  to,
  offset,
  direction,
  text,
  px,
}: {
  from: { x: number; y: number };
  to: { x: number; y: number };
  offset: number;
  direction: "horizontal" | "vertical";
  text: string;
  px: (v: number) => number;
}) {
  const palette = useCanvasPalette();
  const tick = px(4);
  if (direction === "horizontal") {
    const y = from.y + offset;
    return (
      <g>
        <line x1={from.x} y1={y} x2={to.x} y2={y} stroke={palette.dim} strokeWidth={px(1)} />
        <line x1={from.x} y1={y - tick} x2={from.x} y2={y + tick} stroke={palette.dimTick} strokeWidth={px(1.2)} />
        <line x1={to.x} y1={y - tick} x2={to.x} y2={y + tick} stroke={palette.dimTick} strokeWidth={px(1.2)} />
        <line x1={from.x} y1={from.y} x2={from.x} y2={y + Math.sign(offset) * px(3)} stroke={palette.dimExt} strokeWidth={px(0.8)} />
        <line x1={to.x} y1={to.y} x2={to.x} y2={y + Math.sign(offset) * px(3)} stroke={palette.dimExt} strokeWidth={px(0.8)} />
        <text x={(from.x + to.x) / 2} y={y - px(5)} fontSize={px(9.5)} fill={palette.dimText} textAnchor="middle" className="mono">
          {text}
        </text>
      </g>
    );
  }
  const x = from.x + offset;
  return (
    <g>
      <line x1={x} y1={from.y} x2={x} y2={to.y} stroke={palette.dim} strokeWidth={px(1)} />
      <line x1={x - tick} y1={from.y} x2={x + tick} y2={from.y} stroke={palette.dimTick} strokeWidth={px(1.2)} />
      <line x1={x - tick} y1={to.y} x2={x + tick} y2={to.y} stroke={palette.dimTick} strokeWidth={px(1.2)} />
      <line x1={from.x} y1={from.y} x2={x + Math.sign(offset) * px(3)} y2={from.y} stroke={palette.dimExt} strokeWidth={px(0.8)} />
      <line x1={to.x} y1={to.y} x2={x + Math.sign(offset) * px(3)} y2={to.y} stroke={palette.dimExt} strokeWidth={px(0.8)} />
      <text
        x={x - px(5)}
        y={(from.y + to.y) / 2}
        fontSize={px(9.5)}
        fill={palette.dimText}
        textAnchor="middle"
        className="mono"
        transform={`rotate(-90 ${x - px(5)} ${(from.y + to.y) / 2})`}
      >
        {text}
      </text>
    </g>
  );
}

function VehicleGlyph({
  vehicle,
  placement,
  footprint,
  layout,
  selected,
  px,
  onPointerDown,
}: {
  vehicle: VehicleDefinition;
  placement: VehiclePlacement;
  footprint: ReturnType<typeof vehicleFootprint>;
  layout: DeckLayout;
  selected: boolean;
  px: (v: number) => number;
  onPointerDown: (event: React.PointerEvent) => void;
}) {
  const ref = referenceOffset(vehicle, placement.referencePoint);
  const resolved = resolvePlacement(vehicle, placement, layout, 8);
  const effective = {
    longitudinalM: resolved.longitudinalM,
    transverseM: resolved.transverseM,
    rotationDeg: resolved.rotationDeg,
  };
  const body = footprint.bodyCorners.map((c) => {
    const p = screen(c);
    return `${p.x},${p.y}`;
  });

  const axles = useMemo(() => {
    const groups = new Map<string, WheelLoad[]>();
    footprint.wheels.forEach((wheel) => {
      const list = groups.get(wheel.axleId) ?? [];
      list.push(wheel);
      groups.set(wheel.axleId, list);
    });
    return [...groups.entries()];
  }, [footprint]);

  const labelled = 1 / Math.max(px(1), 1e-6) > 7; // hide dense labels at low zoom
  /**
   * Label anchored past the reference-point marker so the two never collide.
   * Longitudinal placement keeps the text inside the body envelope.
   */
  const labelOffsetM = Math.min(3, Math.max(1.2, (footprint.bounds.maxXd - footprint.bounds.minXd) / 2 - 2));
  const labelPoint = screen({
    xd: (footprint.bounds.minXd + footprint.bounds.maxXd) / 2 + labelOffsetM,
    zd: (footprint.bounds.minZd + footprint.bounds.maxZd) / 2,
  });
  const palette = useCanvasPalette();
  const color = palette.vehicle(placement.color);
  const angle = -resolved.rotationDeg;
  const textAngle = Math.abs(angle) > 90 ? angle + 180 : angle;

  return (
    <g
      className={selected ? "vehicle-selected handle" : "handle"}
      onPointerDown={onPointerDown}
      opacity={placement.visible ? 1 : 0.35}
    >
      <polygon
        className="vehicle-body"
        points={body.join(" ")}
        fill={color}
        fillOpacity={palette.vehicleFillOpacity}
        stroke={color}
        strokeOpacity={selected ? 1 : 0.85}
        strokeWidth={px(selected ? palette.selectedBodyStrokeWidth : palette.bodyStrokeWidth)}
      />

      {/* track contact patches */}
      {footprint.tracks.map((track) => (
        <polygon
          key={track.trackId}
          points={track.corners
            .map((c) => {
              const p = screen(c);
              return `${p.x},${p.y}`;
            })
            .join(" ")}
          fill="url(#track-hatch)"
          stroke={color}
          strokeOpacity={0.8}
          strokeWidth={px(1)}
         
        />
      ))}

      {/* axle centre lines: number above the body, load below when the spacing allows */}
      {axles.map(([axleId, wheels], axleIndex) => {
        const centreU = wheels[0].localU;
        const halfWidth = Math.max(...wheels.map((w) => Math.abs(w.localV))) + Math.max(0.25, wheels[0].footprintWidthM / 2);
        const a = localToDeck({ xd: centreU, zd: -halfWidth - 0.2 }, ref, effective);
        const b = localToDeck({ xd: centreU, zd: halfWidth + 0.2 }, ref, effective);
        const pa = screen(a);
        const pb = screen(b);
        const topLabel = screen(localToDeck({ xd: centreU - 0.32, zd: halfWidth + 0.32 }, ref, effective));
        const loadLabel = screen(localToDeck({ xd: centreU + 0.5, zd: -halfWidth + 0.55 }, ref, effective));
        const load = wheels.reduce((acc, w) => acc + w.loadKN, 0);
        const previous = axleIndex > 0 ? axles[axleIndex - 1][1][0].localU : -Infinity;
        const roomForLoad = centreU - previous >= 2.2;
        return (
          <g key={axleId}>
            <line x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke={color} strokeOpacity={0.5} strokeWidth={px(1)} strokeDasharray={`${px(4)} ${px(3)}`} />
            {labelled && (
              <text x={topLabel.x} y={topLabel.y} fontSize={px(8.5)} fill={color} className="mono" fillOpacity={0.95} transform={`rotate(${textAngle} ${topLabel.x} ${topLabel.y})`}>
                {wheels[0].axleLabel}
              </text>
            )}
            {labelled && roomForLoad && (
              <text
                x={loadLabel.x}
                y={loadLabel.y}
                fontSize={px(8.5)}
                fill={color}
                fillOpacity={0.8}
                className="mono"
                transform={`rotate(${textAngle} ${loadLabel.x} ${loadLabel.y})`}
              >
                {fmt(load, 0)} kN
              </text>
            )}
          </g>
        );
      })}

      {/* wheels */}
      {footprint.wheels.map((wheel) => {
        const isPoint = wheel.footprintLengthM <= 0 || wheel.footprintWidthM <= 0;
        if (isPoint) {
          const p = screen({ xd: wheel.xd, zd: wheel.zd });
          return (
            <circle key={wheel.id} cx={p.x} cy={p.y} r={px(3)} fill={color} stroke={palette.wheelStroke} strokeWidth={px(1)}>
              <title>{`${wheel.axleLabel} · ${fmt(wheel.loadKN, 1)} kN · Xd ${fmt(wheel.xd, 2)} m, Zd ${fmt(wheel.zd, 2)} m`}</title>
            </circle>
          );
        }
        return (
          <polygon
            key={wheel.id}
            points={wheel.corners
              .map((c) => {
                const p = screen(c);
                return `${p.x},${p.y}`;
              })
              .join(" ")}
            fill={color}
            fillOpacity={0.85}
            stroke={palette.wheelStroke}
            strokeWidth={px(1)}
           
          >
            <title>{`${wheel.axleLabel} · ${fmt(wheel.loadKN, 1)} kN · Xd ${fmt(wheel.xd, 2)} m, Zd ${fmt(wheel.zd, 2)} m`}</title>
          </polygon>
        );
      })}

      {/* reference point */}
      <g transform={`translate(${footprint.reference.xd}, ${-footprint.reference.zd})`}>
        <circle r={px(4)} fill="none" stroke={color} strokeWidth={px(1.2)} />
        <line x1={-px(7)} y1={0} x2={px(7)} y2={0} stroke={color} strokeWidth={px(1)} />
        <line x1={0} y1={-px(7)} x2={0} y2={px(7)} stroke={color} strokeWidth={px(1)} />
      </g>

      {/* id + load label on a dark plate: no paint-order or CSS stroke needed,
          so it renders identically in every SVG engine */}
      {(() => {
        const text = `${placement.label} · ${vehicle.shortName} · ${fmt(vehicleTotalLoadKN(vehicle), 0)} kN`;
        const fontSize = px(10);
        const plateWidth = Math.min(px(240), text.length * fontSize * 0.58 + px(10));
        const plateHeight = fontSize + px(6);
        return (
          <g transform={`rotate(${textAngle} ${labelPoint.x} ${labelPoint.y})`}>
            <rect
              x={labelPoint.x - plateWidth / 2}
              y={labelPoint.y - plateHeight / 2 - px(3)}
              width={plateWidth}
              height={plateHeight}
              rx={px(2)}
              fill={palette.labelPlate}
              fillOpacity={0.78}
              stroke={color}
              strokeOpacity={0.35}
              strokeWidth={px(0.8)}
            />
            <text
              x={labelPoint.x}
              y={labelPoint.y + px(0.5)}
              fontSize={fontSize}
              fill={color}
              textAnchor="middle"
              dominantBaseline="middle"
            >
              {text}
            </text>
          </g>
        );
      })()}

      {placement.locked && (
        <g transform={`translate(${screen({ xd: footprint.bounds.maxXd, zd: footprint.bounds.maxZd }).x - px(8)}, ${screen({ xd: footprint.bounds.maxXd, zd: footprint.bounds.maxZd }).y + px(10)})`}>
          <rect x={-px(4)} y={-px(4)} width={px(8)} height={px(7)} rx={px(1)} fill={palette.lockPlate} stroke={color} strokeWidth={px(1)} />
          <path d={`M ${-px(2)} ${-px(4)} v ${-px(2)} a ${px(2)} ${px(2)} 0 0 1 ${px(4)} 0 v ${px(2)}`} fill="none" stroke={color} strokeWidth={px(1)} />
        </g>
      )}
    </g>
  );
}

function SelectionAnnotations({
  vehicle,
  placement,
  footprint,
  layout,
  px,
}: {
  vehicle: VehicleDefinition;
  placement: VehiclePlacement;
  footprint: ReturnType<typeof vehicleFootprint>;
  layout: DeckLayout;
  px: (v: number) => number;
}) {
  const palette = useCanvasPalette();
  const resolved = resolvePlacement(vehicle, placement, layout, 8);
  const ref = screen({ xd: footprint.reference.xd, zd: footprint.reference.zd });
  const leftClearance = layout.leftCarriagewayEdgeZd - footprint.bounds.maxZd;
  const rightClearance = footprint.bounds.minZd - layout.rightCarriagewayEdgeZd;
  const nearestLeft = leftClearance <= rightClearance;
  const clearance = nearestLeft ? leftClearance : rightClearance;
  const boundaryZd = nearestLeft ? layout.leftCarriagewayEdgeZd : layout.rightCarriagewayEdgeZd;
  const outerZd = nearestLeft ? footprint.bounds.maxZd : footprint.bounds.minZd;

  const clearX = footprint.bounds.maxXd + px(16);
  const stationY = -footprint.bounds.maxZd - px(13);

  return (
    <g pointerEvents="none">
      {/* transverse clearance from kerb face to outer wheel edge */}
      <line x1={clearX} y1={-boundaryZd} x2={clearX} y2={-outerZd} stroke={palette.clearance} strokeWidth={px(1)} />
      <line x1={clearX - px(3)} y1={-boundaryZd} x2={clearX + px(3)} y2={-boundaryZd} stroke={palette.clearance} strokeWidth={px(1.2)} />
      <line x1={clearX - px(3)} y1={-outerZd} x2={clearX + px(3)} y2={-outerZd} stroke={palette.clearance} strokeWidth={px(1.2)} />
      <line x1={footprint.bounds.maxXd} y1={-boundaryZd} x2={clearX + px(4)} y2={-boundaryZd} stroke={palette.clearanceSoft} strokeWidth={px(0.8)} strokeDasharray={`${px(2)} ${px(3)}`} />
      <line x1={footprint.bounds.maxXd} y1={-outerZd} x2={clearX + px(4)} y2={-outerZd} stroke={palette.clearanceSoft} strokeWidth={px(0.8)} strokeDasharray={`${px(2)} ${px(3)}`} />
      <text
        x={clearX + px(5)}
        y={(-boundaryZd - outerZd) / 2}
        fontSize={px(9)}
        fill={palette.clearance}
        className="mono"
        dominantBaseline="middle"
      >
        {fmt(clearance, 3)} m to kerb
      </text>

      {/* longitudinal station to the reference point */}
      <line x1={0} y1={stationY} x2={Math.max(0, ref.x)} y2={stationY} stroke={palette.station} strokeOpacity={0.75} strokeWidth={px(1)} />
      <line x1={0} y1={stationY - px(3)} x2={0} y2={stationY + px(3)} stroke={palette.station} strokeWidth={px(1.2)} />
      <line x1={Math.max(0, ref.x)} y1={stationY - px(3)} x2={Math.max(0, ref.x)} y2={stationY + px(3)} stroke={palette.station} strokeWidth={px(1.2)} />
      <line x1={0} y1={stationY - px(4)} x2={0} y2={-footprint.bounds.maxZd} stroke={palette.stationSoft} strokeWidth={px(0.8)} strokeDasharray={`${px(2)} ${px(3)}`} />
      <line x1={Math.max(0, ref.x)} y1={stationY - px(4)} x2={Math.max(0, ref.x)} y2={-footprint.bounds.maxZd} stroke={palette.stationSoft} strokeWidth={px(0.8)} strokeDasharray={`${px(2)} ${px(3)}`} />
      <text x={Math.max(0, ref.x) / 2} y={stationY - px(5)} fontSize={px(9)} fill={palette.station} textAnchor="middle" className="mono">
        Xd {fmt(Math.max(0, ref.x), 3)} m
      </text>

      {/* mode badge under the reference point */}
      <text
        x={ref.x}
        y={-footprint.bounds.minZd + px(14)}
        fontSize={px(8.5)}
        fill={palette.text}
        textAnchor="middle"
        className="mono"
      >
        {placement.label} · {placement.referencePoint.replace(/-/g, " ")} · {placement.mode}
        {placement.mode === "lane" && placement.lane ? ` L${placement.lane.laneIndex + 1}` : ""}
        {resolved.clearanceM !== null ? ` · c = ${fmt(resolved.clearanceM)} m` : ""}
      </text>
    </g>
  );
}
