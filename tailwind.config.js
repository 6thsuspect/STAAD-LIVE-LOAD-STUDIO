/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#070b12",
          900: "#0b111b",
          850: "#0e1622",
          800: "#121c2a",
          700: "#1a2738",
          600: "#26374c",
          500: "#3a4f68",
        },
        cyan: {
          400: "#38d6e6",
          500: "#14b8c9",
        },
        signal: {
          amber: "#f5b544",
          red: "#ff6b6b",
          green: "#4ade80",
          blue: "#6fa8ff",
        },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "Liberation Mono", "monospace"],
      },
      boxShadow: {
        panel: "0 1px 0 0 rgba(255,255,255,0.04) inset, 0 10px 30px -18px rgba(0,0,0,0.9)",
      },
    },
  },
  plugins: [],
};
