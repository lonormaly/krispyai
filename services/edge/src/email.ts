// Lead-email delivery via Resend — one REST call, no SDK (open-core: PUBLIC and
// self-contained, NEVER imports the cloud's libs/email). Mirrors telegram.ts: pure
// render + injectable `fetch`, silent no-op when the key/to-address is absent (degrades
// exactly like Telegram-off). Reuses the cloud's existing Resend key when present.
import type { FormSpec } from "./types";

export type FetchLike = typeof fetch;

/** A visitor's captured lead: field values + the recent chat transcript. */
export interface LeadEmail {
  subject: string;
  html: string;
}

// Minimal HTML escape — every value is visitor-controlled and lands in an email body.
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Render the lead email (pure — unit-tested). Fields are labeled by the FormSpec so
 * the owner reads "Budget: 5k" not "budget: 5k". Appends the recent transcript and,
 * when a WhatsApp phone is configured, a one-tap `wa.me` reply button (Adi's pattern).
 */
export function renderLeadEmail(
  form: FormSpec | null,
  values: Record<string, string>,
  transcript: { role: string; content: string }[],
  waPhone?: string,
): LeadEmail {
  const title = form?.title || "New lead";
  const labelFor = (name: string) => form?.fields.find((f) => f.name === name)?.label || name;

  const rows = Object.entries(values)
    .filter(([, v]) => v != null && v.trim() !== "")
    .map(
      ([name, v]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#685c53;font-weight:600">${esc(labelFor(name))}</td><td style="padding:4px 0">${esc(v)}</td></tr>`,
    )
    .join("");

  const convo = transcript.length
    ? `<h3 style="color:#241a12;font-size:14px;margin:20px 0 6px">Conversation</h3>` +
      transcript
        .map(
          (m) =>
            `<p style="margin:2px 0;color:#241a12"><strong>${esc(m.role)}:</strong> ${esc(m.content)}</p>`,
        )
        .join("")
    : "";

  // wa.me one-tap reply button — prefills a greeting toward the first captured contact-ish value.
  const cta = waPhone
    ? `<p style="margin:20px 0 0"><a href="https://wa.me/${encodeURIComponent(waPhone)}" style="display:inline-block;background:#e39a2b;color:#241a12;font-weight:700;text-decoration:none;padding:10px 18px;border-radius:6px">Reply on WhatsApp</a></p>`
    : "";

  const html =
    `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#241a12">` +
    `<h2 style="color:#241a12;font-size:18px;margin:0 0 12px">🥐 ${esc(title)}</h2>` +
    `<table style="border-collapse:collapse;font-size:14px">${rows}</table>` +
    convo +
    cta +
    `</div>`;

  return { subject: `New lead · ${title}`, html };
}

/**
 * Deliver a rendered lead email via Resend. Silent no-op if the key or a to-address is
 * missing (self-host owner may rely on Telegram only). Injectable `fetch` for tests.
 */
export async function sendLeadEmail(
  apiKey: string | undefined,
  from: string | undefined,
  to: string | undefined,
  mail: LeadEmail,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  if (!apiKey || !to) return; // degrade quietly — like Telegram-off
  await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: from || "leads@krispy.chat",
      to,
      subject: mail.subject,
      html: mail.html,
    }),
    signal: AbortSignal.timeout(10_000), // stalled Resend can't hang the Worker
  }).catch(() => {}); // email is best-effort; never block the lead response
}
