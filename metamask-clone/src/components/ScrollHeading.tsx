"use client";

import { useEffect, useRef } from "react";

export default function ScrollHeading({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onScroll = () => {
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const start = vh * 0.85;
      const end = vh * 0.3;
      const progress = Math.min(1, Math.max(0, (start - rect.top) / (start - end)));
      el.style.setProperty("--reso", progress.toFixed(3));
      el.style.transform = `scale(${0.9 + progress * 0.1})`;
      el.style.transformOrigin = "left center";
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <h2
      ref={ref}
      className={`font-poly font-black tracking-tight ${className}`}
      style={{ ["--reso" as string]: 0 }}
    >
      {children}
    </h2>
  );
}