import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { compileMDX } from "next-mdx-remote/rsc";
import remarkGfm from "remark-gfm";
import { JsonLd, pageMetadata } from "@krispy/seo";
import { AwningStripe, Badge, ButtrSays } from "@krispy/ui";
import { postJsonLd } from "../../lib/blog-jsonld";
import { getPost, getPostSlugs, type Post } from "../../lib/posts";
import { BlogFooter, BlogNav } from "../chrome";
import { mdxComponents } from "../mdx-components";
import { SITE_URL } from "../seo";

// Fully static: one page per post, prerendered at build. No runtime data fetching.
export function generateStaticParams(): { slug: string }[] {
  return getPostSlugs().map((slug) => ({ slug }));
}

// Per-post canonical metadata via the one door — title/description/canonical/OG per post.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) return {};
  return pageMetadata({
    title: post.title,
    description: post.description,
    path: `/${post.slug}`,
    ...(post.ogImage ? { image: post.ogImage } : {}),
  });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

// Freshness signal — a visible "Updated: <Month YYYY>" line on every post (GEO: AI answers
// favor recency, and readers trust a dated page). Month-precision, not the full day.
function formatMonthYear(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long" });
}

// Colored mono eyebrow keyed off the post's content shape — the editorial "kicker".
const EYEBROW: Record<NonNullable<Post["type"]>, string> = {
  comparison: "the honest comparison",
  howto: "how-to · fait maison",
  category: "the landscape",
  story: "field notes",
};

export default async function PostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) notFound();

  const { content } = await compileMDX({
    source: post.content,
    components: mdxComponents,
    // remark-gfm: render GFM tables (the comparison side-by-sides), strikethrough and
    // autolinks — without it Markdown tables fall through as raw `| … |` pipe text.
    options: { mdxOptions: { remarkPlugins: [remarkGfm] } },
  });

  // One schema.org @graph per post: BlogPosting + BreadcrumbList + FAQPage (+ conditional
  // SoftwareApplication/HowTo by frontmatter `type`). See lib/blog-jsonld.ts.
  const structuredData = postJsonLd(post, SITE_URL);
  const eyebrow = post.type ? EYEBROW[post.type] : "from the blog";

  return (
    <div className="overflow-x-clip bg-cream">
      <JsonLd data={structuredData} />
      <BlogNav />

      <article className="mx-auto max-w-3xl px-6 pb-8 pt-12">
        <Link
          href="/"
          className="font-mono text-sm font-medium text-muted-foreground transition-colors hover:text-jam"
        >
          ← all posts
        </Link>

        <header className="mt-8 flex flex-col gap-5">
          <span className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-jam">
            {eyebrow}
          </span>
          <h1 className="font-display font-black leading-[0.92] tracking-[-0.02em] text-balance text-[clamp(2.25rem,6vw,4rem)] text-espresso">
            {post.title}
          </h1>
          <p className="text-lg font-medium text-muted-foreground">{post.description}</p>
          <div className="flex flex-wrap items-center gap-2 font-mono text-[13px] text-muted-foreground">
            <time dateTime={post.date}>{formatDate(post.date)}</time>
            <span aria-hidden>·</span>
            <span>{post.author}</span>
            <span aria-hidden>·</span>
            <time dateTime={post.updatedAt} className="font-semibold text-crust">
              {`Updated ${formatMonthYear(post.updatedAt)}`}
            </time>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {post.tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="font-mono text-[10px]">
                {tag}
              </Badge>
            ))}
          </div>
        </header>

        <AwningStripe className="mt-8 rounded-full" />

        {/* The MDX body — the hero image, Buttr asides, tables and code are all styled by
            mdxComponents. .blog-prose drives the running <h2> section index (globals.css). */}
        <div className="blog-prose mt-2">{content}</div>
      </article>

      {/* ── Buttr sign-off + back to the index ───────────────── */}
      <section className="bg-cream px-6 pb-16 pt-4">
        <div className="mx-auto max-w-3xl">
          <ButtrSays img="/blog/buttr-typing.png">
            that&apos;s the whole thing. want me to answer your visitors like this? i self-host in
            one command. 🥐
          </ButtrSays>
          <div className="mt-8">
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-md border-2 border-espresso bg-gold px-5 py-2.5 font-mono text-sm font-semibold text-espresso shadow-[4px_4px_0_0_var(--espresso)] transition-transform hover:translate-x-px hover:translate-y-px hover:shadow-[2px_2px_0_0_var(--espresso)]"
            >
              ← more field notes
            </Link>
          </div>
        </div>
      </section>

      <BlogFooter />
    </div>
  );
}
