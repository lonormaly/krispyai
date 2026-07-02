"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Reveal — effortless scroll-in: fade + 12px rise, IntersectionObserver-driven.
 * NOT framer `whileInView` (back-nav blank bug, per design-lock §4). Reduced-motion
 * is honored by the global rule in globals.css (transition collapses to ~0ms, so the
 * content simply appears). Reserve for a hero moment or two — never wrap load-bearing
 * SEO copy, since it starts at opacity 0.
 */
export function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: shown ? 1 : 0,
        transform: shown ? "none" : "translateY(12px)",
        transition: "opacity 500ms var(--ease-quart), transform 500ms var(--ease-quart)",
        transitionDelay: `${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}
