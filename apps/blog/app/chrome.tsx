import Link from "next/link";
import { AwningStripe, Button } from "@krispy/ui";
import { SITE_URL } from "./seo";

// Shared blog chrome — nav + footer, matching the landing's boulangerie register
// (Buttr logo, awning stripe, Buttr wave-off footer). DRY: the index and every post
// render the same top/bottom so the blog reads as one publication, not loose pages.

const LANDING_URL = process.env.NEXT_PUBLIC_LANDING_URL ?? "http://landing.krispy.localhost:1355";
const GITHUB_URL = process.env.NEXT_PUBLIC_GITHUB_URL ?? "https://github.com/lonormaly/krispyai";

export function BlogNav() {
  return (
    <>
      <header className="sticky top-0 z-50 border-b-2 border-espresso bg-cream/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/blog/buttr-reading.png"
              alt="Buttr, the Krispy croissant mascot, reading"
              className="size-9 object-contain"
            />
            <span className="font-display text-2xl font-black tracking-tight">
              krispy<span className="text-jam">/blog</span>
            </span>
          </Link>
          <nav className="hidden items-center gap-7 font-mono text-[13px] font-medium text-muted-foreground md:flex">
            <a href={LANDING_URL} className="transition-colors hover:text-jam">
              home
            </a>
            <a href={`${LANDING_URL}/#how`} className="transition-colors hover:text-jam">
              how it works
            </a>
            <a href={`${LANDING_URL}/#compare`} className="transition-colors hover:text-jam">
              vs intercom
            </a>
          </nav>
          <Button
            asChild
            size="sm"
            className="border-2 border-espresso bg-gold font-mono font-semibold text-espresso shadow-[3px_3px_0_0_var(--espresso)] transition-transform hover:translate-x-px hover:translate-y-px hover:bg-gold hover:shadow-[1px_1px_0_0_var(--espresso)]"
          >
            <a href={GITHUB_URL}>★ Star</a>
          </Button>
        </div>
      </header>
      <AwningStripe />
    </>
  );
}

export function BlogFooter() {
  return (
    <footer className="border-t-2 border-espresso bg-cream">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="mb-10 flex flex-col items-center gap-4 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/blog/buttr-thinking.png"
            alt="Buttr the croissant, signing off"
            className="size-24 object-contain"
          />
          <p className="font-display text-2xl font-black tracking-tight">
            à bientôt — now go ship something.
          </p>
        </div>
        <div className="flex flex-col items-center justify-between gap-4 border-t border-border pt-6 text-sm text-muted-foreground sm:flex-row">
          <span className="font-medium">krispy — the ai answers, you tag in.</span>
          <div className="flex gap-6 font-mono text-xs">
            <a href={GITHUB_URL} className="hover:text-jam">
              GitHub
            </a>
            <a href={LANDING_URL} className="hover:text-jam">
              krispyai
            </a>
            <a href={`${SITE_URL}/feed.xml`} className="hover:text-jam">
              RSS
            </a>
            <span>MIT</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
