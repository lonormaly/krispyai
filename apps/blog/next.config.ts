import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Compile these workspace libs from TS/JSX source — no separate build step (mirrors
  // apps/landing). @krispy/analytics is a "use client" provider; @krispy/ui is the design
  // system. next-mdx-remote runs at build time (SSG) so no MDX webpack loader needed.
  transpilePackages: ["@krispy/ui", "@krispy/analytics"],

  // Pin the workspace root so Next doesn't guess it from a stray lockfile higher up
  // (which resolves a second React copy and crashes prerendering).
  outputFileTracingRoot: path.join(import.meta.dirname, "..", ".."),

  // Skip Next's redundant build-time ESLint pass (it lacks the @next/next/* rule defs
  // this monorepo doesn't install, so it errors on our eslint-disable directives).
  // The real lint gate is `bunx oxlint` — mirrors apps/landing.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
