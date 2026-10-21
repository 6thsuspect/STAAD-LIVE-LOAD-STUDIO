/** Monotonic id helper — deterministic within a session, no crypto dependency. */

let counter = 0;

export function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

export function resetIdCounter(): void {
  counter = 0;
}

export function colorForIndex(index: number): string {
  const palette = ["#38bdf8", "#f5b544", "#4ade80", "#c084fc", "#fb7185", "#22d3ee", "#a3e635", "#f97316"];
  return palette[index % palette.length];
}

export function nextVehicleLabel(placements: Array<{ label: string }>): string {
  const used = new Set(placements.map((p) => p.label.toUpperCase()));
  for (let i = 1; i < 500; i += 1) {
    const candidate = `V${i}`;
    if (!used.has(candidate)) return candidate;
  }
  return `V${placements.length + 1}`;
}
