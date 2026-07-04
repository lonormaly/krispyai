// Load-bearing leak-guard (chat-suite §3): the ONE thing that, if it breaks, leaks a
// Telegram bot token to the public web. Run: `bun test`.
import { expect, test, describe } from "bun:test";
import { publicWidgetConfig } from "../src/store";

describe("publicWidgetConfig", () => {
  test("returns theme, NEVER secrets", () => {
    const out = publicWidgetConfig({
      botToken: "x",
      chatId: "y",
      systemPrompt: "z",
      model: "m",
      theme: { primaryColor: "#fff" },
    });
    // theme passes through
    expect(out.theme.primaryColor).toBe("#fff");
    // no secret leaks — structurally impossible, asserted anyway
    const flat = JSON.stringify(out);
    expect(flat).not.toContain("botToken");
    expect(flat).not.toContain("chatId");
    expect(flat).not.toContain("systemPrompt");
    expect(flat).not.toContain("x"); // botToken value
    expect((out as Record<string, unknown>).botToken).toBeUndefined();
    expect((out as Record<string, unknown>).chatId).toBeUndefined();
    expect((out as Record<string, unknown>).systemPrompt).toBeUndefined();
  });

  test("null config → all-undefined theme (graceful fallback)", () => {
    const out = publicWidgetConfig(null);
    expect(out.theme.primaryColor).toBeUndefined();
    expect((out as Record<string, unknown>).botToken).toBeUndefined();
  });
});
