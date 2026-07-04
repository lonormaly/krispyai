import { createPreset } from "fumadocs-ui/tailwind-plugin";
import type { Config } from "tailwindcss";

// Fumadocs 14 uses Tailwind v3 + its own preset. We scan the fumadocs-ui components
// so its utility classes are emitted, plus our own app/content.
export default {
  content: [
    "./app/**/*.{ts,tsx}",
    "./content/**/*.{md,mdx}",
    "./node_modules/fumadocs-ui/dist/**/*.js",
  ],
  presets: [createPreset()],
} satisfies Config;
