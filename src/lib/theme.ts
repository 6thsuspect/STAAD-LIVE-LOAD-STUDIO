/**
 * Appearance: theme resolution, persistence and the canvas palette.
 *
 * The application chrome is themed with CSS custom properties consumed by
 * Tailwind (see `src/index.css`), so a component never names a theme colour.
 * The SVG deck plan cannot use those variables portably — not every SVG
 * renderer resolves `var()` in presentation attributes — so it uses the
 * explicit palettes below. Both palettes are exported so the light and dark
 * drawings can be rendered and compared in tests.
 */

export type ThemeMode = "dark" | "light" | "system";
export type ResolvedTheme = "dark" | "light";

export const THEME_STORAGE_KEY = "staad-irc-studio:theme:v1";
export const DEFAULT_THEME_MODE: ThemeMode = "dark";

const MEDIA_QUERY = "(prefers-color-scheme: light)";

export function systemTheme(): ResolvedTheme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "dark";
  try {
    return window.matchMedia(MEDIA_QUERY).matches ? "light" : "dark";
  } catch {
    return "dark";
  }
}

/** Resolve a mode against the operating-system preference. */
export function resolveTheme(mode: ThemeMode, system: ResolvedTheme = systemTheme()): ResolvedTheme {
  if (mode === "system") return system;
  return mode;
}

export function getSystemTheme(): ResolvedTheme {
  return systemTheme();
}

export function subscribeSystemTheme(listener: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(MEDIA_QUERY);
  if (typeof query.addEventListener === "function") {
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }
  // Safari < 14
  query.addListener?.(listener);
  return () => query.removeListener?.(listener);
}

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === "dark" || value === "light" || value === "system";
}

export function readStoredThemeMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeMode(stored) ? stored : DEFAULT_THEME_MODE;
  } catch {
    return DEFAULT_THEME_MODE;
  }
}

export function storeThemeMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    /* private mode: the theme still applies for this session */
  }
}

/**
 * Apply a resolved theme to the document.
 *
 * `color-scheme` makes native controls (scrollbars, number spinners, form
 * widgets) follow the theme instead of staying dark on a light page.
 */
export function applyTheme(theme: ResolvedTheme, root: HTMLElement | null = typeof document === "undefined" ? null : document.documentElement): void {
  if (!root) return;
  root.classList.toggle("light", theme === "light");
  root.classList.toggle("dark", theme === "dark");
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  // Keep the browser chrome (mobile address bar, PWA title bar) in step.
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute("content", theme === "light" ? "#eef2f7" : "#070b12");
}

/** Label shown on the appearance control. */
export const THEME_LABELS: Record<ThemeMode, string> = {
  dark: "Dark",
  light: "Light",
  system: "System",
};

/* -------------------------------------------------------------------------- */
/* Canvas palette                                                             */
/* -------------------------------------------------------------------------- */

export interface CanvasPalette {
  theme: ResolvedTheme;
  /** Area around the drawing. */
  canvas: string;
  grid: string;
  deckFill: string;
  deckStroke: string;
  surfaceFill: string;
  surfaceStroke: string;
  footpathFill: string;
  footpathStroke: string;
  kerbFill: string;
  barrierHatchFill: string;
  barrierHatchLine: string;
  barrierStroke: string;
  laneDash: string;
  edgeLine: string;
  centreline: string;
  laneLabel: string;
  text: string;
  dim: string;
  dimTick: string;
  dimExt: string;
  dimText: string;
  axisX: string;
  axisZ: string;
  originText: string;
  scaleStroke: string;
  scaleFill: string;
  scaleText: string;
  hover: string;
  clearance: string;
  clearanceSoft: string;
  station: string;
  stationSoft: string;
  wheelStroke: string;
  labelPlate: string;
  lockPlate: string;
  trackHatchFill: string;
  trackHatchLine: string;
  modelFill: string;
  modelStroke: string;
  modelMember: string;
  modelNode: string;
  modelLoadedNode: string;
  modelLabel: string;
  /** Vehicle colours are stored on the placement; light mode darkens them for contrast. */
  vehicle: (color: string) => string;
  /** Body fill opacity: outlines carry the identity, so the fill stays light. */
  vehicleFillOpacity: number;
  selectedBodyStrokeWidth: number;
  bodyStrokeWidth: number;
}

const DARK_PALETTE: Omit<CanvasPalette, "theme" | "vehicle" | "vehicleFillOpacity" | "bodyStrokeWidth" | "selectedBodyStrokeWidth"> = {
  canvas: "#081019",
  grid: "rgba(120,165,210,0.07)",
  deckFill: "#0b1521",
  deckStroke: "rgba(120,165,210,0.4)",
  surfaceFill: "#132030",
  surfaceStroke: "rgba(120,165,210,0.28)",
  footpathFill: "#1a2836",
  footpathStroke: "rgba(120,165,210,0.16)",
  kerbFill: "#22303f",
  barrierHatchFill: "#1b2735",
  barrierHatchLine: "#3a4f68",
  barrierStroke: "rgba(120,165,210,0.45)",
  laneDash: "rgba(148,180,214,0.16)",
  edgeLine: "rgba(160,196,232,0.55)",
  centreline: "rgba(56,214,230,0.4)",
  laneLabel: "#4a6a86",
  text: "#7f95ad",
  dim: "#475569",
  dimTick: "#64748b",
  dimExt: "#334155",
  dimText: "#7f95ad",
  axisX: "#38d6e6",
  axisZ: "#f5b544",
  originText: "#475569",
  scaleStroke: "#334155",
  scaleFill: "#475569",
  scaleText: "#64748b",
  hover: "#f5b544",
  clearance: "#f5b544",
  clearanceSoft: "#a37528",
  station: "#38d6e6",
  stationSoft: "#2a7f8c",
  wheelStroke: "#04121b",
  labelPlate: "#050c14",
  lockPlate: "#0b111b",
  trackHatchFill: "rgba(56,214,230,0.16)",
  trackHatchLine: "rgba(56,214,230,0.5)",
  modelFill: "rgba(111,168,255,0.035)",
  modelStroke: "rgba(111,168,255,0.18)",
  modelMember: "rgba(111,168,255,0.22)",
  modelNode: "#6fa8ff",
  modelLoadedNode: "#f5b544",
  modelLabel: "#5b7b98",
};

/**
 * Light plan: a paper drawing. The deck is white, the carriageway a very light
 * grey, and every annotation is a dark ink so the plan stays readable when
 * printed or viewed in daylight.
 */
const LIGHT_PALETTE: Omit<CanvasPalette, "theme" | "vehicle" | "vehicleFillOpacity" | "bodyStrokeWidth" | "selectedBodyStrokeWidth"> = {
  canvas: "#e9edf3",
  grid: "rgba(30,64,110,0.12)",
  deckFill: "#ffffff",
  deckStroke: "rgba(30,64,110,0.45)",
  surfaceFill: "#f4f7fa",
  surfaceStroke: "rgba(30,64,110,0.25)",
  footpathFill: "#eef2f6",
  footpathStroke: "rgba(30,64,110,0.18)",
  kerbFill: "#e2e8f0",
  barrierHatchFill: "#e8edf3",
  barrierHatchLine: "#b6c4d4",
  barrierStroke: "rgba(30,64,110,0.4)",
  laneDash: "rgba(51,65,85,0.3)",
  edgeLine: "rgba(30,64,110,0.7)",
  centreline: "rgba(8,145,178,0.7)",
  laneLabel: "#64748b",
  text: "#475569",
  dim: "#94a3b8",
  dimTick: "#64748b",
  dimExt: "#cbd5e1",
  dimText: "#475569",
  axisX: "#0e7490",
  axisZ: "#b45309",
  originText: "#64748b",
  scaleStroke: "#cbd5e1",
  scaleFill: "#94a3b8",
  scaleText: "#64748b",
  hover: "#b45309",
  clearance: "#b45309",
  clearanceSoft: "#d97706",
  station: "#0e7490",
  stationSoft: "#0891b2",
  wheelStroke: "#ffffff",
  labelPlate: "#ffffff",
  lockPlate: "#ffffff",
  trackHatchFill: "rgba(8,145,178,0.12)",
  trackHatchLine: "rgba(8,145,178,0.45)",
  modelFill: "rgba(37,99,235,0.04)",
  modelStroke: "rgba(37,99,235,0.22)",
  modelMember: "rgba(37,99,235,0.28)",
  modelNode: "#2563eb",
  modelLoadedNode: "#b45309",
  modelLabel: "#64748b",
};

/* -------------------------------------------------------------------------- */
/* Colour maths                                                               */
/* -------------------------------------------------------------------------- */

function channels(color: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return null;
  const hex = match[1];
  const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

function toHex(rgb: [number, number, number]): string {
  return `#${rgb.map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`;
}

/** WCAG relative luminance. */
export function relativeLuminance(color: string): number | null {
  const rgb = channels(color);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((value) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two opaque colours; null if either cannot be parsed. */
export function contrastRatio(a: string, b: string): number | null {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la === null || lb === null) return null;
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Parse `#rgb` / `#rrggbb`; anything else is returned unchanged. */
export function darkenColor(color: string, factor = 0.45): string {
  const rgb = channels(color);
  if (!rgb) return color;
  return toHex(rgb.map((channel) => channel * (1 - factor)) as [number, number, number]);
}

/**
 * Darken a colour only as far as needed to stay readable on a background.
 *
 * The vehicle palette is shared by both themes and must remain identifiable:
 * the same hue is kept, but a mid-tone that would vanish on white paper is
 * stepped down until it reaches `minRatio`.
 */
export function ensureContrast(color: string, background: string, minRatio = 3.1): string {
  const rgb = channels(color);
  if (!rgb) return color;
  if ((contrastRatio(color, background) ?? 0) >= minRatio) return color;
  let current: [number, number, number] = rgb;
  for (let step = 0; step < 60; step += 1) {
    current = current.map((channel) => channel * 0.94) as [number, number, number];
    if ((contrastRatio(toHex(current), background) ?? 0) >= minRatio) return toHex(current);
  }
  return toHex(current);
}

const DARK: CanvasPalette = {
  ...DARK_PALETTE,
  theme: "dark",
  vehicle: (color) => color,
  vehicleFillOpacity: 0.06,
  bodyStrokeWidth: 1.4,
  selectedBodyStrokeWidth: 1.9,
};
const LIGHT: CanvasPalette = {
  ...LIGHT_PALETTE,
  theme: "light",
  // The deck is white paper, so every vehicle outline must clear it.
  vehicle: (color) => ensureContrast(color, LIGHT_PALETTE.deckFill),
  // A 6 % wash on white is invisible; on paper the hatch and text carry the
  // shape, so the fill only needs to hint at the extent.
  vehicleFillOpacity: 0.1,
  bodyStrokeWidth: 1.5,
  selectedBodyStrokeWidth: 2,
};

export function canvasPalette(theme: ResolvedTheme): CanvasPalette {
  return theme === "light" ? LIGHT : DARK;
}
