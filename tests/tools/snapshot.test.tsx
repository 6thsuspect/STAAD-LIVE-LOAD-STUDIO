/**
 * Developer utility (not part of the CI surface): renders the deck plan to an
 * SVG/PNG so the drawing can be inspected without a browser.
 * Run with: npx vitest run tests/tools/snapshot.test.tsx
 */
import { beforeEach, describe, it, vi } from "vitest";
import { render } from "@testing-library/react";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { writeFileSync, mkdirSync } = await import("node:fs" as any);
import { Resvg } from "@resvg/resvg-js";
import App from "../../src/App";
import { sampleProject } from "../../src/lib/project";
import { useStudio } from "../../src/store/studio";

// Geometry-related rules from src/index.css. Colours arrive as element
// attributes from the canvas palette, so nothing here may override them.
const STYLE = `
.vehicle-body { stroke-linejoin: round; }
.plan-text, text { font-family: "DejaVu Sans Mono", monospace; }
`;

const THEME = process.env.SNAPSHOT_THEME === "light" ? "light" : "dark";
const BACKGROUND = THEME === "light" ? "#e9edf3" : "#081019";

const SIZE = { width: 1280, height: 620 };

describe("visual snapshot", () => {
  beforeEach(() => {
    // jsdom has no layout engine; give the canvas container a realistic box.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      () =>
        ({
          width: SIZE.width,
          height: SIZE.height,
          top: 0,
          left: 0,
          right: SIZE.width,
          bottom: SIZE.height,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }) as DOMRect,
    );
    class RO {
      constructor(private cb: ResizeObserverCallback) {}
      observe(target: Element) {
        this.cb([{ contentRect: { width: SIZE.width, height: SIZE.height } } as ResizeObserverEntry], this as unknown as ResizeObserver);
        void target;
      }
      unobserve() {}
      disconnect() {}
    }
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = RO;
  });

  it("writes the deck plan to artifacts/", () => {
    useStudio.getState().loadProject(sampleProject());
    useStudio.getState().setTab("placement");
    useStudio.getState().setThemeMode(THEME);
    const { container } = render(<App />);
    const svg = container.querySelector("svg[role='application']");
    if (!svg) throw new Error("plan svg not found");
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    svg.setAttribute("width", "1280");
    svg.setAttribute("height", "620");
    svg.setAttribute("style", `background:${BACKGROUND}`);
    const style = document.createElement("style");
    style.textContent = STYLE;
    svg.insertBefore(style, svg.firstChild);
    const markup = svg.outerHTML;
    mkdirSync("artifacts", { recursive: true });
    writeFileSync(THEME === "light" ? "artifacts/plan-light.svg" : "artifacts/plan.svg", markup);
    const png = new Resvg(markup, { fitTo: { mode: "width", value: 1280 }, background: BACKGROUND }).render().asPng();
    writeFileSync(process.env.SNAPSHOT_OUT ?? "artifacts/plan.png", png);
  });
});
