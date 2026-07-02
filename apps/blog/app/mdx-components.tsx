import type { ComponentProps } from "react";

// Bold "boulangerie moderne" MDX element map — this is what makes a rendered post feel
// ALIVE instead of default-Markdown-grey. Fraunces display headings with a jam section
// index (see .blog-prose counter in globals.css), Buttr blockquotes as speech bubbles,
// espresso code blocks, gold-header tables, bold-framed images, jam links.
//
// jsx-a11y note: these are MDX element *overrides* — MDX passes heading/anchor text in as
// `children` via `{...props}`, which the static rule can't see, so it false-positives on
// has-content. Rendered output always has content; the targeted disables keep the gate
// strict everywhere else.

// Hard-offset bold surface — the landing's signature (thick espresso border + solid
// warm shadow), the antidote to the "1px border + soft blur" AI-slop card.
const BOLD = "border-2 border-espresso shadow-[6px_6px_0_0_var(--espresso)]";

export const mdxComponents = {
  h2: (props: ComponentProps<"h2">) => (
    // oxlint-disable-next-line jsx-a11y/heading-has-content
    <h2
      className="mt-16 mb-5 font-display text-3xl font-black leading-[1.05] tracking-tight text-espresso sm:text-4xl"
      {...props}
    />
  ),
  h3: (props: ComponentProps<"h3">) => (
    // oxlint-disable-next-line jsx-a11y/heading-has-content
    <h3
      className="mt-10 mb-3 font-display text-xl font-bold tracking-tight text-espresso sm:text-2xl [&::before]:mr-2 [&::before]:font-mono [&::before]:text-gold [&::before]:content-['//']"
      {...props}
    />
  ),
  p: (props: ComponentProps<"p">) => (
    <p className="my-5 text-[1.075rem] leading-[1.75] text-foreground/90" {...props} />
  ),
  a: (props: ComponentProps<"a">) => (
    // oxlint-disable-next-line jsx-a11y/anchor-has-content
    <a
      className="font-medium text-jam underline decoration-jam/40 decoration-2 underline-offset-[3px] transition-colors hover:decoration-jam"
      {...props}
    />
  ),
  ul: (props: ComponentProps<"ul">) => (
    <ul
      className="my-5 space-y-2 pl-1 text-[1.075rem] leading-[1.7] text-foreground/90 [&>li]:relative [&>li]:pl-6 [&>li]:before:absolute [&>li]:before:left-0 [&>li]:before:font-black [&>li]:before:text-jam [&>li]:before:content-['—']"
      {...props}
    />
  ),
  ol: (props: ComponentProps<"ol">) => (
    <ol
      className="my-5 list-decimal space-y-2 pl-6 text-[1.075rem] leading-[1.7] text-foreground/90 marker:font-mono marker:font-bold marker:text-crust"
      {...props}
    />
  ),
  li: (props: ComponentProps<"li">) => <li className="leading-[1.7]" {...props} />,
  // Every blockquote in this blog is a `> 🥐 **Buttr:** …` aside (verified 107/107), so
  // render them all as Buttr speech bubbles. A <div> wrapper (not ButtrSays, which wraps
  // in <p>) — a <blockquote>'s child is already a <p>, and <p> inside <p> is invalid.
  blockquote: (props: ComponentProps<"blockquote">) => (
    <div className="my-8 flex items-start gap-3 sm:gap-4">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/blog/buttr-typing.png"
        alt="Buttr the croissant mascot"
        className="size-16 shrink-0 object-contain sm:size-20"
      />
      <div
        className={`flex-1 rounded-2xl rounded-tl-none bg-butter/60 px-5 py-2.5 font-mono text-[0.95rem] font-medium text-espresso ${BOLD} [&_strong]:font-bold [&_strong]:text-jam [&>p]:my-1.5`}
      >
        {props.children}
      </div>
    </div>
  ),
  code: (props: ComponentProps<"code">) => (
    <code
      className="rounded bg-butter px-1.5 py-0.5 font-mono text-[0.85em] font-medium text-crust"
      {...props}
    />
  ),
  pre: (props: ComponentProps<"pre">) => (
    <pre
      className={`my-8 overflow-x-auto rounded-[14px] bg-espresso p-5 font-mono text-sm leading-relaxed text-cream ${BOLD} [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-cream`}
      {...props}
    />
  ),
  img: (props: ComponentProps<"img">) => (
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img className={`my-8 w-full rounded-[14px] ${BOLD}`} {...props} />
  ),
  // `---` section rules become the croissant divider — a real bakery flourish.
  hr: () => (
    <div className="my-12 flex justify-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/blog/divider-croissants.png"
        alt=""
        aria-hidden
        className="h-7 object-contain opacity-70"
      />
    </div>
  ),
  em: (props: ComponentProps<"em">) => <em className="italic text-muted-foreground" {...props} />,
  table: (props: ComponentProps<"table">) => (
    <div className={`my-8 overflow-x-auto rounded-[14px] bg-card ${BOLD}`}>
      <table className="w-full border-collapse text-sm" {...props} />
    </div>
  ),
  thead: (props: ComponentProps<"thead">) => (
    <thead className="border-b-2 border-espresso bg-butter/60" {...props} />
  ),
  th: (props: ComponentProps<"th">) => (
    <th
      className="p-3.5 text-left font-display text-base font-black text-espresso [&:first-child]:text-crust"
      {...props}
    />
  ),
  td: (props: ComponentProps<"td">) => (
    <td
      className="border-b border-border p-3.5 align-top text-foreground/90 [&:first-child]:font-medium [&:first-child]:text-foreground"
      {...props}
    />
  ),
};
