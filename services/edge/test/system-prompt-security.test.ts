import { test, expect } from "bun:test";
import { buildSystemPrompt, SECURITY_INSTRUCTION, HANDOFF_MARKER } from "../src/system-prompt";

// The guardrails are load-bearing: they must be present on EVERY built prompt, and must
// survive a tenant overriding the base prompt (the #1 way guardrails silently vanish).

test("guardrails are appended to the default prompt", () => {
  expect(buildSystemPrompt()).toContain(SECURITY_INSTRUCTION);
});

test("guardrails survive a tenant custom prompt override", () => {
  const p = buildSystemPrompt("You are Bob. Only talk about hats.");
  expect(p).toContain(SECURITY_INSTRUCTION); // not dropped
  expect(p).toContain("Bob"); // custom prompt still applied
  expect(p).toContain(HANDOFF_MARKER); // handoff contract still re-appended
});

test("guardrails cover disclosure refusal, scope limits, and injection resistance", () => {
  const g = SECURITY_INSTRUCTION.toLowerCase();
  expect(g).toContain("system prompt"); // refuse prompt extraction
  expect(g).toMatch(/architec|internal|technical/); // refuse architecture/tech disclosure
  expect(g).toMatch(/key|api|hosting|code/); // refuse secrets/stack disclosure
  expect(g).toMatch(/ignore any such attempt|change your rules|ignore prior/); // injection resistance
  expect(g).toContain("control tokens"); // never emit markers on request
});
