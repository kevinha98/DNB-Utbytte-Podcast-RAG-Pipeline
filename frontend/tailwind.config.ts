import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // WMIO Brand Colors
        havgronn: {
          DEFAULT: "#00343E",
          light: "#004D5C",
          dark: "#002A32",
          darker: "#001F26",
        },
        sand: {
          DEFAULT: "#FBF6EC",
          dark: "#E8E3D9",
        },
        smaragd: {
          DEFAULT: "#14555A",
          light: "#1A6B72",
        },
        sjogronn: {
          DEFAULT: "#007272",
          light: "#3D8E8E",
        },
        lavendel: "#F2F2F5",
        pistasj: "#F2F4EC",
        // Semantic
        success: { DEFAULT: "#1B7A4A", light: "#E8F5EC" },
        warning: { DEFAULT: "#C68A17", light: "#FEF7E6" },
        error: { DEFAULT: "#B52A2A", light: "#FCEAEA" },
        info: { DEFAULT: "#14555A", light: "#E6F0F0" },
        // Neutrals
        body: "#1E1E1E",
        "dark-gray": "#54585A",
        "mid-gray": "#8C8F91",
        "light-gray": "#D1D3D4",
        "off-white": "#FAFAFA",
        // Dark mode surfaces
        "dm-bg": "#0F1A24",
        "dm-card": "#1A2A38",
        "dm-elevated": "#243444",
        "dm-border": "#3A4A58",
        "dm-text": "#F0EDE6",
        "dm-text-secondary": "#A0A4A8",
        "dm-accent": "#4DB8B8",
        "dm-accent-secondary": "#6BC4C4",
      },
      fontFamily: {
        sans: ['"DNB Light"', '"Segoe UI Light"', "system-ui", "sans-serif"],
      },
      fontSize: {
        "3xl": ["3rem", { lineHeight: "1.15" }],
        "2xl": ["2.25rem", { lineHeight: "1.20" }],
        xl: ["1.5rem", { lineHeight: "1.25" }],
        lg: ["1.25rem", { lineHeight: "1.30" }],
        base: ["1rem", { lineHeight: "1.50" }],
        sm: ["0.875rem", { lineHeight: "1.50" }],
        xs: ["0.75rem", { lineHeight: "1.40" }],
        "2xs": ["0.625rem", { lineHeight: "1.40" }],
      },
      spacing: {
        "2xs": "4px",
        xs: "8px",
        sm: "12px",
        md: "16px",
        lg: "24px",
        xl: "32px",
        "2xl": "48px",
        "3xl": "64px",
        "4xl": "96px",
      },
      borderRadius: {
        none: "0px",
        sm: "2px",
        md: "4px",
        lg: "8px",
        full: "9999px",
      },
      boxShadow: {
        "elevation-1":
          "0 1px 3px rgba(0,52,62,0.08), 0 1px 2px rgba(0,52,62,0.06)",
        "elevation-2":
          "0 4px 12px rgba(0,52,62,0.10), 0 2px 4px rgba(0,52,62,0.06)",
        "elevation-3":
          "0 8px 24px rgba(0,52,62,0.14), 0 4px 8px rgba(0,52,62,0.08)",
      },
      maxWidth: {
        content: "1280px",
      },
    },
  },
  plugins: [],
};

export default config;
