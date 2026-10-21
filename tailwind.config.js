/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: ["class", ".dark"],
  theme: {
    extend: {
      colors: {
        /**
         * Every colour resolves through a CSS variable so the same utility
         * class renders correctly in both themes. `white` is themed too: the
         * panels use `border-white/[0.06]` and `bg-white/5` as tint and hover
         * overlays, which must become dark overlays on a light page.
         */
        ink: {
          950: "rgb(var(--ink-950) / <alpha-value>)",
          900: "rgb(var(--ink-900) / <alpha-value>)",
          850: "rgb(var(--ink-850) / <alpha-value>)",
          800: "rgb(var(--ink-800) / <alpha-value>)",
          700: "rgb(var(--ink-700) / <alpha-value>)",
          600: "rgb(var(--ink-600) / <alpha-value>)",
          500: "rgb(var(--ink-500) / <alpha-value>)",
        },
        slate: {
          100: "rgb(var(--slate-100) / <alpha-value>)",
          200: "rgb(var(--slate-200) / <alpha-value>)",
          300: "rgb(var(--slate-300) / <alpha-value>)",
          400: "rgb(var(--slate-400) / <alpha-value>)",
          500: "rgb(var(--slate-500) / <alpha-value>)",
          600: "rgb(var(--slate-600) / <alpha-value>)",
        },
        white: "rgb(var(--white) / <alpha-value>)",
        cyan: {
          200: "rgb(var(--cyan-200) / <alpha-value>)",
          300: "rgb(var(--cyan-300) / <alpha-value>)",
          400: "rgb(var(--cyan-400) / <alpha-value>)",
          500: "rgb(var(--cyan-500) / <alpha-value>)",
          600: "rgb(var(--cyan-600) / <alpha-value>)",
        },
        signal: {
          amber: "rgb(var(--signal-amber) / <alpha-value>)",
          red: "rgb(var(--signal-red) / <alpha-value>)",
          green: "rgb(var(--signal-green) / <alpha-value>)",
          blue: "rgb(var(--signal-blue) / <alpha-value>)",
        },
        canvas: "var(--plan-canvas)",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "Liberation Mono", "monospace"],
      },
      boxShadow: {
        panel: "var(--panel-shadow)",
      },
    },
  },
  plugins: [],
};
