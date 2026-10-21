import { useStudio } from "../store/studio";
import { useResolvedTheme } from "../lib/useTheme";
import { THEME_LABELS, type ThemeMode } from "../lib/theme";

const NEXT: Record<ThemeMode, ThemeMode> = {
  dark: "light",
  light: "dark",
  system: "light",
};

function SunIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="3.1" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M8 1.4v1.6M8 13v1.6M1.4 8h1.6M13 8h1.6M3.3 3.3l1.2 1.2M11.5 11.5l1.2 1.2M12.7 3.3l-1.2 1.2M4.5 11.5l-1.2 1.2"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" aria-hidden>
      <path
        d="M13.2 9.6A5.6 5.6 0 016.4 2.8a5.6 5.6 0 106.8 6.8z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * One-click appearance switch.
 *
 * The icon shows the appearance you will get, not the current one, so the
 * action is unambiguous. The three-way choice (including "System") lives in
 * Project Settings.
 */
export function ThemeToggle() {
  const { mode, theme } = useResolvedTheme();
  const next = NEXT[mode];
  const label = `Switch to ${THEME_LABELS[next].toLowerCase()} appearance`;

  return (
    <button
      type="button"
      onClick={() => useStudio.getState().setThemeMode(next)}
      className="flex items-center gap-1.5 rounded border border-white/10 bg-ink-800 px-2 py-1 text-[11px] text-slate-300 transition hover:border-white/20 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/40"
      title={`${label} (currently ${THEME_LABELS[mode].toLowerCase()})`}
      aria-label={label}
      data-theme-toggle="true"
      data-theme={theme}
    >
      {theme === "dark" ? <SunIcon /> : <MoonIcon />}
      <span className="hidden md:inline">{THEME_LABELS[next]}</span>
    </button>
  );
}
