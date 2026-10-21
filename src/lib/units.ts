/** Numeric helpers. Internal precision is full float; rounding happens only at render/output. */

export const EPS = 1e-9;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Round half away from zero, avoiding binary drift like 2.675 -> 2.67. */
export function round(value: number, decimals = 3): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  const scaled = Math.round((value + Number.EPSILON * Math.sign(value)) * factor) / factor;
  return Object.is(scaled, -0) ? 0 : scaled;
}

/** Deterministic fixed-decimal output; strips trailing zeros but always keeps the integer part. */
export function fmt(value: number, decimals = 3): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = round(value, decimals);
  if (rounded === 0) return "0";
  const text = rounded.toFixed(decimals);
  return text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text;
}

/** Presentation rounding to 3 significant-ish decimals for dimensions. */
export function fmtM(value: number, decimals = 3): string {
  return `${fmt(value, decimals)} m`;
}

export function fmtKN(value: number, decimals = 2): string {
  return `${fmt(value, decimals)} kN`;
}

export function sum(values: number[]): number {
  return values.reduce((acc, v) => acc + v, 0);
}

export function nearlyEqual(a: number, b: number, tol = 1e-6): boolean {
  return Math.abs(a - b) <= tol;
}

export function parseNumeric(text: string): number | null {
  const cleaned = text.trim().replace(/,/g, ".");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/** Parse a dimension that may carry a unit suffix; always returns metres. */
export function parseLengthM(text: string): number | null {
  const match = text.trim().match(/^(-?\d*\.?\d+(?:[eE][-+]?\d+)?)\s*(mm|cm|m)?$/i);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const unit = (match[2] ?? "m").toLowerCase();
  if (unit === "mm") return value / 1000;
  if (unit === "cm") return value / 100;
  return value;
}

/** Parse a force that may carry a unit suffix; always returns kN. */
export function parseForceKN(text: string): number | null {
  const match = text.trim().match(/^(-?\d*\.?\d+(?:[eE][-+]?\d+)?)\s*(kn|n|t|tf)?$/i);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const unit = (match[2] ?? "kn").toLowerCase();
  if (unit === "n") return value / 1000;
  if (unit === "t") return value * 9.80665;
  if (unit === "tf") return value * 9.80665;
  return value;
}
