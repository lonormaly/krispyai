// This app's canonical origin, for robots.ts + sitemap.ts + absolute JSON-LD URLs.
// Env-driven — NEVER hardcode a production domain. The blog is deployed to its own
// subdomain (blog.<yourdomain>), so it gets its OWN NEXT_PUBLIC_SITE_URL, distinct
// from the app/landing origin. Falls back to the local portless URL for dev.
//
// The AI-crawler roster + robots rules live in @krispy/seo (`aiCrawlerRules()`); page
// metadata + JSON-LD also come from @krispy/seo — one door, no hand-rolling.
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://blog.krispy.localhost:1355";

export const BLOG_NAME = "The Krispy Blog";
export const BLOG_DESCRIPTION =
  "Field notes on AI live chat, human handoff, self-hosting, and the open tools indie builders actually use. Honest comparisons, real setup guides, first-hand from the team building Krispy.";
