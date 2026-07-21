import { docs, meta } from "@/.source/server";
import { loader } from "fumadocs-core/source";
import { toFumadocsSource } from "fumadocs-mdx/runtime/server";

// The content source the layout + pages read. Docs are served under /docs.
// fumadocs-mdx 15 emits async collections in .source/server; `toFumadocsSource`
// adapts them for the core `loader` (replaces the old `createMDXSource`).
export const source = loader({
  baseUrl: "/docs",
  source: toFumadocsSource(docs, meta),
});
