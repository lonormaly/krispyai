import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // Pure-content docs → full static export. No Node server, no next-on-pages,
  // no per-route `runtime = 'edge'`. `deploy.sh docs` just uploads `out/` to CF Pages.
  output: "export",
};

export default withMDX(config);
