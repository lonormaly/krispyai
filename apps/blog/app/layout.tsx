import type { Metadata } from "next";
import { Bricolage_Grotesque, Fraunces, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Analytics } from "@krispy/analytics";
import { JsonLd, organizationJsonLd, pageMetadata, websiteJsonLd } from "@krispy/seo";
import { BLOG_DESCRIPTION, BLOG_NAME, SITE_URL } from "./seo";

// Fresh Baked type — same trio as the landing: Fraunces (warm display, Black/900 for
// headings) · Bricolage Grotesque (characterful UI/body) · Geist Mono (labels/code).
// Exposed as the CSS vars the @krispy/ui theme reads (--font-fraunces / --font-bricolage
// / --font-geist-mono) so bg-gold, font-display etc. resolve on this app too.
const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
  weight: ["400", "500", "600", "700", "900"],
});
const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
  display: "swap",
});
const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

// One door for metadata — pageMetadata() fills metadataBase, canonical, OG, twitter and
// the `%s — Builder's Stack Blog` title template from @krispy/config. No hand-rolled OG.
export const metadata: Metadata = pageMetadata({
  description: BLOG_DESCRIPTION,
  tagline: "field notes from an AI-native monorepo",
});

// Sitewide structured data — Organization + WebSite (schema.org) for rich results.
// Per Google's AI guide this is for rich results, not an AI ranking lever.
const structuredData = [
  organizationJsonLd({ name: "Builder's Stack", url: SITE_URL }),
  websiteJsonLd({ name: BLOG_NAME, url: SITE_URL, description: BLOG_DESCRIPTION }),
];

// PUBLIC surface — no auth, never redirects on session. Same shared <Analytics/>
// provider as the app so a reader here and the same person in the app resolve to ONE
// PostHog person (cross-subdomain identity).
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${bricolage.variable} ${geistMono.variable}`}>
      <body className="min-h-screen bg-cream font-sans antialiased">
        <JsonLd data={structuredData} />
        <Analytics>{children}</Analytics>
      </body>
    </html>
  );
}
