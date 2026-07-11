import "./global.css";
import { RootProvider } from "fumadocs-ui/provider";
import type { ReactNode } from "react";

export const metadata = {
  title: { default: "Krispy AI — docs", template: "%s · Krispy AI 🥐" },
  description:
    "self-host docs for Krispy AI — open-source live chat with an AI answerer and a human handoff to Telegram.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        {/* `search.type: 'static'` points the search dialog at the build-time Orama
            index (see app/api/search/route.ts) instead of a live `/api/search` endpoint. */}
        <RootProvider search={{ options: { type: "static" } }}>
          {children}
        </RootProvider>
      </body>
    </html>
  );
}
