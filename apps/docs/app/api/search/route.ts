import { source } from "@/lib/source";
import { createFromSource } from "fumadocs-core/search/server";

// Built-in static search (Orama) over the docs content — no external service, no telemetry.
// `staticGET` emits the Orama index as a static file at build (works under `output: 'export'`);
// the client fetches it and searches in-browser. `revalidate = false` keeps the route static.
export const revalidate = false;
export const { staticGET: GET } = createFromSource(source);
