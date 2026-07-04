import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

// Shared nav config (title, links) for the docs + home layouts.
export const baseOptions: BaseLayoutProps = {
  nav: {
    title: (
      <>
        <span style={{ fontWeight: 800, letterSpacing: "-0.01em" }}>Krispy AI</span>
        <span aria-hidden> 🥐</span>
      </>
    ),
  },
  links: [
    { text: "docs", url: "/docs", active: "nested-url" },
    // TODO: real GitHub org/repo once public.
    { text: "github", url: "https://github.com/krispyhq/krispyai" },
  ],
};
