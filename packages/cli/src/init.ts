// krispy init — the guided first-run wizard. Terminal-native counterpart to Krispy
// Cloud's dashboard onboarding: same four steps (Connect Telegram → Train → Embed →
// Next steps), self-host register. It captures creds/prompt step-by-step and persists
// each via the shared tenant-config POST (single-tenant "self").
//
// ponytail: no state file / resume machinery — the wizard IS the resume story (re-run it;
// mergeTenantConfig on the Worker never clobbers unset fields, so re-running is safe and
// each step is independently skippable). Add a checkpoint file only if users ask for it.

import { readFile } from "node:fs/promises";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { API, TENANT, postTenantConfig, telegramGetMe } from "./index.ts";

const BOTFATHER = "https://t.me/botfather";

// A default starter prompt for the "accept a template" path — deliberately generic so a
// self-hoster gets a working bot before writing their own kbase. set-kbase overwrites it.
const STARTER_PROMPT =
  "You are a friendly, concise support assistant for this website. Answer visitor " +
  "questions helpfully. If you don't know something or the visitor asks for a human, " +
  "say so plainly and offer to pass the message on to the team.";

// clack returns a cancel symbol on Ctrl-C; treat it as "abort the wizard" everywhere.
function bail<T>(v: T | symbol): T {
  if (p.isCancel(v)) {
    p.cancel("Setup cancelled. Re-run `krispy init` any time — nothing was lost.");
    process.exit(0);
  }
  return v;
}

// Step 1 — Connect Telegram: BotFather guide → token (validate-on-paste via getMe) →
// supergroup+topics guide → chat id. Persists botToken + chatId.
async function connectTelegram(): Promise<void> {
  p.note(
    `1. Open ${pc.cyan(BOTFATHER)} in Telegram\n` +
      `2. Send ${pc.bold("/newbot")} and follow the prompts (name + @username)\n` +
      `3. BotFather replies with a token like ${pc.dim("123456:ABC-DEF...")}`,
    pc.bold("① Connect Telegram — create your bot"),
  );

  // Validate-on-paste: loop until getMe accepts the token (or the user cancels).
  let username = "";
  for (;;) {
    const token = bail(
      await p.password({
        message: "Paste your bot token",
        validate: (v) => (v?.trim() ? undefined : "Token can't be empty"),
      }),
    ).trim();
    const s = p.spinner();
    s.start("Validating with Telegram…");
    const name = await telegramGetMe(token);
    if (name) {
      s.stop(pc.green(`✓ Connected to @${name}`));
      username = name;
      await postTenantConfig({ botToken: token });
      break;
    }
    s.stop(pc.red("✗ Telegram rejected that token — check it and try again."));
  }

  p.note(
    `1. Create a Telegram ${pc.bold("supergroup")} and enable ${pc.bold("Topics")} ` +
      `(Group → Edit → Topics)\n` +
      `2. Add ${pc.cyan("@" + username)} to the group and make it an ${pc.bold("admin")} ` +
      `(it needs "Manage Topics")\n` +
      `3. Get the group's chat id — e.g. add @RawDataBot briefly, or read it from the ` +
      `bot's updates. It looks like ${pc.dim("-1001234567890")}`,
    pc.bold("① Connect Telegram — link your group"),
  );

  const chatId = bail(
    await p.text({
      message: "Group chat id",
      placeholder: "-1001234567890",
      validate: (v) => (v?.trim() ? undefined : "Chat id can't be empty"),
    }),
  ).trim();
  await postTenantConfig({ chatId });
  p.log.success(pc.green("✓ Telegram connected."));
}

// Step 2 — Train your bot: kbase file | starter template | skip. Persists systemPrompt.
async function trainBot(): Promise<void> {
  const choice = bail(
    await p.select({
      message: "How do you want to train your bot?",
      options: [
        { value: "file", label: "Use a knowledge-base file", hint: "path to a .md/.txt" },
        { value: "starter", label: "Accept a starter template", hint: "generic support prompt" },
        { value: "skip", label: "Skip for now", hint: "run `krispy set-kbase` later" },
      ],
    }),
  );

  if (choice === "skip") {
    p.log.info("Skipped — set a prompt later with `krispy set-kbase <file>`.");
    return;
  }

  let systemPrompt = STARTER_PROMPT;
  if (choice === "file") {
    for (;;) {
      const path = bail(
        await p.text({
          message: "Path to your knowledge-base file",
          placeholder: "./kbase.md",
          validate: (v) => (v?.trim() ? undefined : "Path can't be empty"),
        }),
      ).trim();
      try {
        systemPrompt = (await readFile(path, "utf8")).trim();
        break;
      } catch {
        p.log.error(pc.red(`Couldn't read ${path} — check the path and try again.`));
      }
    }
  }

  await postTenantConfig({ systemPrompt });
  p.log.success(pc.green(`✓ Bot trained (${systemPrompt.length} chars).`));
}

// Step 3 — Embed: print the copy-paste widget snippet with tenant + api baked in.
function embedWidget(): void {
  const snippet =
    `<script src="https://YOUR-HOST/widget.js"\n` +
    `        data-api="${API}"\n` +
    `        data-tenant="${TENANT}" async></script>`;
  p.note(
    `${pc.cyan(snippet)}\n\n` +
      `Host ${pc.bold("widget.js")} anywhere static, then paste this ${pc.bold("before </body>")}\n` +
      `on any page. Swap ${pc.dim("YOUR-HOST")} for wherever you serve widget.js.`,
    pc.bold("③ Embed the widget"),
  );
}

// Step 4 — Next steps: run + test-the-loop instructions.
function nextSteps(): void {
  p.note(
    `Run locally:   ${pc.bold("krispy dev")}\n` +
      `Deploy:        ${pc.bold("bunx wrangler deploy")} ${pc.dim("(from services/edge)")}\n\n` +
      `Test the loop: open a page with the widget, send a message — it appears in your\n` +
      `Telegram group as a new topic. Reply from your phone and the AI goes silent.`,
    pc.bold("④ Next steps"),
  );
}

export async function init(): Promise<number> {
  // Guided prompts need a real terminal; refuse cleanly in CI / piped input.
  if (!process.stdin.isTTY) {
    console.error(
      "krispy init is interactive and needs a TTY.\n" +
        "For scripted setup, POST botToken/chatId/systemPrompt to /api/tenant/config, " +
        "or use `krispy set-kbase <file>`.",
    );
    return 1;
  }

  p.intro(pc.bgCyan(pc.black(" krispy init ")));
  p.log.message(`Configuring tenant ${pc.bold(TENANT)} → ${pc.dim(API)}`);

  try {
    await connectTelegram();
    await trainBot();
    embedWidget();
    nextSteps();
  } catch (err) {
    p.log.error(pc.red(`✗ ${(err as Error).message}`));
    p.outro("Setup stopped. Fix the above and re-run `krispy init`.");
    return 1;
  }

  p.outro(pc.green("You're set. Run `krispy dev` to try it locally."));
  return 0;
}
