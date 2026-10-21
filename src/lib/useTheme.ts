import { useEffect, useSyncExternalStore } from "react";
import { useStudio } from "../store/studio";
import {
  applyTheme,
  canvasPalette,
  getSystemTheme,
  resolveTheme,
  subscribeSystemTheme,
  type CanvasPalette,
  type ResolvedTheme,
  type ThemeMode,
} from "./theme";

/**
 * Resolved appearance for rendering.
 *
 * The selected mode lives in the store (persisted separately from the project),
 * the operating-system preference is read through an external store so every
 * consumer re-renders when the user changes it while in `system` mode.
 */
export function useResolvedTheme(): { mode: ThemeMode; theme: ResolvedTheme } {
  const mode = useStudio((state) => state.themeMode);
  const system = useSyncExternalStore(subscribeSystemTheme, getSystemTheme, () => "dark" as const);
  const theme = resolveTheme(mode, system);

  // One place applies the class: every mounted consumer would set the same
  // value, and `applyTheme` is idempotent.
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  return { mode, theme };
}

/** Palette for the SVG deck plan. */
export function useCanvasPalette(): CanvasPalette {
  const { theme } = useResolvedTheme();
  return canvasPalette(theme);
}
