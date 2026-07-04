import { source } from "@/lib/source";
import { createFromSource } from "fumadocs-core/search/server";

// Built-in static search (Orama) over the docs content — no external service, no telemetry.
export const { GET } = createFromSource(source);
