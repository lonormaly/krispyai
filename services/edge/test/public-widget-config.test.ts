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
      operators: [{ id: 424242, name: "Shai", username: "shaisnir" }],
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
    // operators (Telegram user ids) must NEVER reach the public widget config
    expect(flat).not.toContain("operators");
    expect(flat).not.toContain("424242");
    expect(flat).not.toContain("shaisnir");
    expect((out as Record<string, unknown>).botToken).toBeUndefined();
    expect((out as Record<string, unknown>).chatId).toBeUndefined();
    expect((out as Record<string, unknown>).systemPrompt).toBeUndefined();
    expect((out as Record<string, unknown>).operators).toBeUndefined();
  });

  test("null config → all-undefined theme (graceful fallback)", () => {
    const out = publicWidgetConfig(null);
    expect(out.theme.primaryColor).toBeUndefined();
    expect((out as Record<string, unknown>).botToken).toBeUndefined();
  });
});
