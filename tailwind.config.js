/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        noir: {
          canvas: "#09090B",
          surface: "#0C0C0E",
          card: "#121215",
          hover: "#18181C",
          hairline: "#1F1F23",
          border: "#27272A",
          muted: "#52525B",
          secondary: "#A1A1AA",
          primary: "#FAFAFA",
          pure: "#FFFFFF",
        },
      },
      fontFamily: {
        serif: ['"Instrument Serif"', '"Playfair Display"', "Georgia", "serif"],
        sans: ['"Inter"', "-apple-system", "BlinkMacSystemFont", "sans-serif"],
        mono: ['"JetBrains Mono"', "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};
