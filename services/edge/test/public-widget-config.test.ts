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

  test("new theme knobs (glow/tagline/sparkle/direction/popup/timing) project through", () => {
    const out = publicWidgetConfig({
      botToken: "x",
      theme: {
        glowColor: "#c4956a",
        tagline: "usually replies in minutes",
        sparkle: true,
        direction: "rtl",
        popupText: "need a hand?",
        timing: { launcherDelayMs: 1000, sparkleAfterMs: 10000, autoOpenMs: 0 },
      },
    });
    expect(out.theme.glowColor).toBe("#c4956a");
    expect(out.theme.tagline).toBe("usually replies in minutes");
    expect(out.theme.sparkle).toBe(true);
    expect(out.theme.direction).toBe("rtl");
    expect(out.theme.popupText).toBe("need a hand?");
    expect(out.theme.timing).toEqual({
      launcherDelayMs: 1000,
      sparkleAfterMs: 10000,
      autoOpenMs: 0,
    });
    expect(JSON.stringify(out)).not.toContain("botToken");
  });

  test("kbSources / kbVersion never reach the public projection", () => {
    const out = publicWidgetConfig({
      botToken: "x",
      kbSources: [{ id: "1", name: "Secret pricing sheet", text: "internal costs", updatedAt: 0 }],
      kbVersion: 3,
    });
    const flat = JSON.stringify(out);
    expect(flat).not.toContain("kbSources");
    expect(flat).not.toContain("kbVersion");
    expect(flat).not.toContain("Secret pricing sheet");
    expect(flat).not.toContain("internal costs");
    expect((out as Record<string, unknown>).kbSources).toBeUndefined();
  });

  test("null config → all-undefined theme (graceful fallback)", () => {
    const out = publicWidgetConfig(null);
    expect(out.theme.primaryColor).toBeUndefined();
    expect((out as Record<string, unknown>).botToken).toBeUndefined();
  });

  test("script (opening/starters) projects, capped 5/4; persona NEVER leaks", () => {
    const out = publicWidgetConfig({
      botToken: "x",
      persona: { toneOfVoice: "warm baker", styleRules: ["no exclamation marks"] },
      script: {
        opening: ["hi", "welcome", "a", "b", "c", "overflow"],
        starters: ["pricing?", "hours?", "book?", "menu?", "overflow"],
      },
    });
    expect(out.script.opening).toEqual(["hi", "welcome", "a", "b", "c"]); // sliced to 5
    expect(out.script.starters).toEqual(["pricing?", "hours?", "book?", "menu?"]); // sliced to 4
    // persona (instruction text) is server-only — must never reach the boot config
    const flat = JSON.stringify(out);
    expect(flat).not.toContain("persona");
    expect(flat).not.toContain("warm baker");
    expect(flat).not.toContain("exclamation");
    expect((out as Record<string, unknown>).persona).toBeUndefined();
  });

  test("ctas: CTA-capable connectors project with server-built href + default label", () => {
    const out = publicWidgetConfig({
      botToken: "x",
      connectors: [
        { id: "wa", type: "whatsapp", phone: "15551234" },
        { id: "ig", type: "instagram", profileUrl: "https://instagram.com/shop", label: "Say hi" },
        { id: "ph", type: "phone", phone: "15559999", caption: "or call", showAfterMs: 4000 },
        { id: "em", type: "email", toAddress: "leads@shop.com" }, // delivery-only, excluded
        { id: "wa2", type: "whatsapp", phone: "15550000", cta: false }, // opt-out, excluded
        { id: "wa3", type: "whatsapp" }, // no phone → no href → dropped
      ],
    });
    expect(out.ctas).toEqual([
      {
        id: "wa",
        type: "whatsapp",
        label: "Chat on WhatsApp",
        caption: undefined,
        url: "https://wa.me/15551234",
        showAfterMs: undefined,
      },
      {
        id: "ig",
        type: "instagram",
        label: "Say hi",
        caption: undefined,
        url: "https://instagram.com/shop",
        showAfterMs: undefined,
      },
      {
        id: "ph",
        type: "phone",
        label: "Call us",
        caption: "or call",
        url: "tel:+15559999",
        showAfterMs: 4000,
      },
    ]);
    // email address (delivery channel) must never surface in the public CTA projection
    expect(JSON.stringify(out)).not.toContain("leads@shop.com");
  });

  test("popups: explicit list wins; theme.popupText desugars to one timer popup", () => {
    // explicit popups[] pass through
    const explicit = publicWidgetConfig({
      botToken: "x",
      popups: [{ trigger: { kind: "near", selector: "#pricing" }, text: "questions on pricing?" }],
    });
    expect(explicit.popups).toEqual([
      { trigger: { kind: "near", selector: "#pricing" }, text: "questions on pricing?" },
    ]);
    // no popups[] but popupText set → sugar to a single timer popup with timing defaults
    const sugar = publicWidgetConfig({
      botToken: "x",
      theme: { popupText: "need a hand?", timing: { popupDelayMs: 5000, popupCooldownHrs: 12 } },
    });
    expect(sugar.popups).toEqual([
      { trigger: { kind: "timer", delayMs: 5000 }, text: "need a hand?", cooldownHours: 12 },
    ]);
    // neither → empty
    expect(publicWidgetConfig({ botToken: "x" }).popups).toEqual([]);
  });
});
