import Link from "next/link";

// Minimal landing — Krispy neo-brutalist. Sends people straight into the docs.
export default function HomePage() {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "1.25rem",
        textAlign: "center",
        padding: "2rem",
      }}
    >
      <p data-eyebrow>self-host docs</p>
      <h1 style={{ fontSize: "2.5rem", fontWeight: 800, letterSpacing: "-0.02em", margin: 0 }}>
        Krispy AI <span aria-hidden>🥐</span>
      </h1>
      <p style={{ maxWidth: 520, color: "var(--color-fd-muted-foreground)", margin: 0 }}>
        open-source live chat with an AI answerer and a human handoff to Telegram. the AI answers.
        you tag in.
      </p>
      <Link href="/docs" className="krispy-cta">
        read the docs →
      </Link>
    </main>
  );
}
