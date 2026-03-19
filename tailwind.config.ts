import type { Config } from "tailwindcss";

/*
 * Theme-aware color palette.
 *
 * Each entry references a CSS custom property defined in globals.css.
 * The property stores RGB triplets (e.g. "239 246 255") so Tailwind's
 * opacity modifier syntax works: bg-blue-50/30 → rgb(239 246 255 / 0.3).
 *
 * :root sets light-mode values; .dark overrides them for dark mode.
 * Components just use standard Tailwind classes — no dark: prefix needed
 * for any shade listed here.
 *
 * Shades NOT listed here (e.g. blue-400, green-500) keep Tailwind's
 * built-in defaults, which work well in both light and dark modes.
 */
const c = (name: string) =>
  `rgb(var(--c-${name}) / <alpha-value>)` as const;

const themeColors = {
  gray: {
    50: c("gray-50"),
    100: c("gray-100"),
    200: c("gray-200"),
    300: c("gray-300"),
    400: c("gray-400"),
    500: c("gray-500"),
    600: c("gray-600"),
    700: c("gray-700"),
    800: c("gray-800"),
    900: c("gray-900"),
  },
  blue: {
    50: c("blue-50"),
    100: c("blue-100"),
    200: c("blue-200"),
    300: c("blue-300"),
    500: c("blue-500"),
    600: c("blue-600"),
    700: c("blue-700"),
    800: c("blue-800"),
  },
  indigo: {
    50: c("indigo-50"),
    100: c("indigo-100"),
    400: c("indigo-400"),
    500: c("indigo-500"),
    600: c("indigo-600"),
    700: c("indigo-700"),
    800: c("indigo-800"),
  },
  amber: {
    50: c("amber-50"),
    100: c("amber-100"),
    200: c("amber-200"),
    300: c("amber-300"),
    500: c("amber-500"),
    600: c("amber-600"),
    700: c("amber-700"),
    800: c("amber-800"),
  },
  yellow: {
    50: c("yellow-50"),
    100: c("yellow-100"),
    200: c("yellow-200"),
    600: c("yellow-600"),
    700: c("yellow-700"),
    800: c("yellow-800"),
  },
  green: {
    50: c("green-50"),
    100: c("green-100"),
    200: c("green-200"),
    300: c("green-300"),
    600: c("green-600"),
    700: c("green-700"),
    800: c("green-800"),
  },
  emerald: {
    50: c("emerald-50"),
    100: c("emerald-100"),
    200: c("emerald-200"),
    400: c("emerald-400"),
    500: c("emerald-500"),
    600: c("emerald-600"),
    700: c("emerald-700"),
    800: c("emerald-800"),
  },
  red: {
    50: c("red-50"),
    100: c("red-100"),
    200: c("red-200"),
    300: c("red-300"),
    400: c("red-400"),
    500: c("red-500"),
    600: c("red-600"),
    700: c("red-700"),
    800: c("red-800"),
  },
  purple: {
    50: c("purple-50"),
    100: c("purple-100"),
    200: c("purple-200"),
    400: c("purple-400"),
    600: c("purple-600"),
    700: c("purple-700"),
  },
  orange: {
    50: c("orange-50"),
    100: c("orange-100"),
    200: c("orange-200"),
    600: c("orange-600"),
    700: c("orange-700"),
    800: c("orange-800"),
  },
  violet: {
    50: c("violet-50"),
    100: c("violet-100"),
    500: c("violet-500"),
    600: c("violet-600"),
    700: c("violet-700"),
  },
  teal: {
    100: c("teal-100"),
    700: c("teal-700"),
  },
  cyan: {
    50: c("cyan-50"),
    200: c("cyan-200"),
    600: c("cyan-600"),
  },
};

const config: Config = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/lib/**/*.{js,ts}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "var(--font-sans)",
          "IBM Plex Sans",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
        mono: [
          "var(--font-mono)",
          "IBM Plex Mono",
          "ui-monospace",
          "monospace",
        ],
      },
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        surface: {
          primary: "var(--surface-primary)",
          secondary: "var(--surface-secondary)",
          elevated: "var(--surface-elevated)",
          sunken: "var(--surface-sunken)",
          strong: "var(--surface-strong)",
        },
        input: {
          DEFAULT: "var(--input-bg)",
          border: "var(--input-border)",
          text: "var(--input-text)",
          placeholder: "var(--input-placeholder)",
        },
        ...themeColors,
      },
      textColor: {
        primary: "var(--text-primary)",
        secondary: "var(--text-secondary)",
        muted: "var(--text-muted)",
        faint: "var(--text-faint)",
      },
      borderColor: {
        DEFAULT: "var(--border-default)",
        subtle: "var(--border-subtle)",
        strong: "var(--border-strong)",
      },
    },
  },
  plugins: [],
};
export default config;
