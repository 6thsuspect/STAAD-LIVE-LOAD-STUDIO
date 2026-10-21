import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import App from "../src/App";
import { newProject, toProjectFile } from "../src/lib/project";
import { useStudio } from "../src/store/studio";
import {
  applyTheme,
  canvasPalette,
  darkenColor,
  DEFAULT_THEME_MODE,
  readStoredThemeMode,
  resolveTheme,
  storeThemeMode,
  contrastRatio,
  ensureContrast,
  THEME_STORAGE_KEY,
  type ThemeMode,
} from "../src/lib/theme";
import { ThemeToggle } from "../src/components/ThemeToggle";

const root = () => document.documentElement;

function reset() {
  useStudio.getState().loadProject(newProject());
  useStudio.setState({ themeMode: DEFAULT_THEME_MODE, past: [], future: [], toast: null });
  applyTheme("dark");
  localStorage.clear();
}

beforeEach(reset);
afterEach(() => {
  vi.restoreAllMocks();
});

describe("theme resolution", () => {
  it("honours an explicit choice regardless of the system preference", () => {
    expect(resolveTheme("dark", "light")).toBe("dark");
    expect(resolveTheme("light", "dark")).toBe("light");
  });

  it("follows the system preference in system mode", () => {
    expect(resolveTheme("system", "light")).toBe("light");
    expect(resolveTheme("system", "dark")).toBe("dark");
  });

  it("applies the class, the data attribute and color-scheme together", () => {
    applyTheme("light");
    expect(root().classList.contains("light")).toBe(true);
    expect(root().classList.contains("dark")).toBe(false);
    expect(root().dataset.theme).toBe("light");
    expect(root().style.colorScheme).toBe("light");

    applyTheme("dark");
    expect(root().classList.contains("dark")).toBe(true);
    expect(root().classList.contains("light")).toBe(false);
    expect(root().style.colorScheme).toBe("dark");
  });

  it("persists the preference separately from the project", () => {
    storeThemeMode("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(readStoredThemeMode()).toBe("light");

    storeThemeMode("system");
    expect(readStoredThemeMode()).toBe("system");
  });

  it("falls back to the default for missing or invalid stored values", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "neon");
    expect(readStoredThemeMode()).toBe(DEFAULT_THEME_MODE);
    localStorage.removeItem(THEME_STORAGE_KEY);
    expect(readStoredThemeMode()).toBe(DEFAULT_THEME_MODE);
  });

  it("survives an unavailable localStorage", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readStoredThemeMode()).toBe(DEFAULT_THEME_MODE);
    getItem.mockRestore();

    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => storeThemeMode("light")).not.toThrow();
    setItem.mockRestore();
  });
});

describe("canvas palette", () => {
  it("gives each theme a distinct drawing surface", () => {
    const dark = canvasPalette("dark");
    const light = canvasPalette("light");
    expect(dark.theme).toBe("dark");
    expect(light.theme).toBe("light");
    expect(dark.deckFill).not.toBe(light.deckFill);
    expect(dark.canvas).not.toBe(light.canvas);
  });

  it("keeps annotation colours distinct from the deck in both themes", () => {
    for (const theme of ["dark", "light"] as const) {
      const palette = canvasPalette(theme);
      expect(palette.dimText).not.toBe(palette.deckFill);
      expect(palette.clearance).not.toBe(palette.surfaceFill);
      expect(palette.axisX).not.toBe(palette.axisZ);
    }
  });

  it("keeps a vehicle recognisable but readable on light paper", () => {
    const dark = canvasPalette("dark");
    const light = canvasPalette("light");

    // Dark mode draws the stored colour untouched.
    expect(dark.vehicle("#38bdf8")).toBe("#38bdf8");

    // Light mode keeps the hue but steps the value down until it clears the deck.
    const adjusted = light.vehicle("#38bdf8");
    expect(adjusted).not.toBe("#38bdf8");
    expect(contrastRatio(adjusted, light.deckFill)).toBeGreaterThanOrEqual(3.1);
  });

  it("makes every vehicle colour legible on the light deck", () => {
    const light = canvasPalette("light");
    const palette = ["#38bdf8", "#f5b544", "#4ade80", "#c084fc", "#fb7185", "#22d3ee", "#a3e635", "#f97316"];
    for (const color of palette) {
      const ratio = contrastRatio(light.vehicle(color), light.deckFill);
      expect(ratio, color).not.toBeNull();
      expect(ratio as number, color).toBeGreaterThanOrEqual(3.1);
    }
  });

  it("never mangles a colour it cannot parse", () => {
    expect(darkenColor("rgb(1,2,3)")).toBe("rgb(1,2,3)");
    expect(darkenColor("not-a-colour")).toBe("not-a-colour");
    expect(darkenColor("#fff", 0)).toBe("#ffffff");
    expect(darkenColor("#ffffff", 1)).toBe("#000000");
    expect(ensureContrast("not-a-colour", "#ffffff")).toBe("not-a-colour");
    // Already legible: returned unchanged rather than darkened for no reason.
    expect(ensureContrast("#000000", "#ffffff")).toBe("#000000");
  });
});

describe("appearance in the shell", () => {
  it("switches the whole document between light and dark", () => {
    render(<App />);
    expect(root().classList.contains("dark")).toBe(true);

    const toggle = screen.getAllByRole("button", { name: /switch to light appearance/i })[0];
    act(() => {
      fireEvent.click(toggle);
    });

    expect(root().classList.contains("light")).toBe(true);
    expect(useStudio.getState().themeMode).toBe("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  it("offers the opposite appearance and describes itself for assistive tech", () => {
    render(<App />);
    const toggle = screen.getAllByRole("button", { name: /switch to light appearance/i })[0];
    expect(toggle).toHaveAttribute("title", expect.stringContaining("currently dark"));

    act(() => {
      fireEvent.click(toggle);
    });
    expect(screen.getAllByRole("button", { name: /switch to dark appearance/i }).length).toBeGreaterThan(0);
  });

  it("keeps the theme out of the project and out of the undo history", () => {
    const { rerender } = render(<ThemeToggle />);
    const before = useStudio.getState().past.length;

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /switch to light appearance/i }));
    });

    expect(useStudio.getState().past.length).toBe(before);
    const file = toProjectFile(useStudio.getState());
    expect(JSON.stringify(file)).not.toContain("themeMode");
    expect(useStudio.getState().themeMode).toBe("light");

    act(() => {
      useStudio.getState().setThemeMode("dark");
    });
    rerender(<ThemeToggle />);
    expect(root().classList.contains("dark")).toBe(true);
  });

  it("draws the plan with the light palette when light mode is active", () => {
    const { container, rerender } = render(<App />);
    const deck = () => container.querySelector("polygon.plan-deck");
    expect(deck()).toHaveAttribute("fill", canvasPalette("dark").deckFill);

    act(() => {
      useStudio.getState().setThemeMode("light");
    });
    rerender(<App />);
    expect(deck()).toHaveAttribute("fill", canvasPalette("light").deckFill);
    expect(deck()).toHaveAttribute("stroke", canvasPalette("light").deckStroke);
  });

  it("resolves system mode from the media query and reacts to changes", () => {
    let listener: (() => void) | null = null;
    const query = {
      matches: true,
      addEventListener: (_: string, callback: () => void) => {
        listener = callback;
      },
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    };
    vi.spyOn(window, "matchMedia").mockReturnValue(query as unknown as MediaQueryList);

    render(<App />);
    act(() => {
      useStudio.getState().setThemeMode("system");
    });
    expect(root().classList.contains("light")).toBe(true);

    // The operating system flips to dark while the app is open.
    query.matches = false;
    act(() => {
      listener?.();
    });
    expect(root().classList.contains("dark")).toBe(true);
  });
});

describe("theme control in settings", () => {
  it("offers dark, light and system", () => {
    render(<App />);
    act(() => {
      useStudio.getState().setTab("settings");
    });
    for (const label of ["Dark", "Light", "System"]) {
      expect(screen.getAllByRole("button", { name: label }).length).toBeGreaterThan(0);
    }
    // The current choice is exposed, not only coloured.
    expect(screen.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Light" })).toHaveAttribute("aria-pressed", "false");
  });

  it("selects the appearance from the settings control", () => {
    render(<App />);
    act(() => {
      useStudio.getState().setTab("settings");
    });
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Light" }));
    });
    expect((useStudio.getState().themeMode as ThemeMode)).toBe("light");
    expect(root().classList.contains("light")).toBe(true);
    expect(screen.getByRole("button", { name: "Light" })).toHaveAttribute("aria-pressed", "true");
  });
});
