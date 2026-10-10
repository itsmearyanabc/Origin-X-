"use client";

import { useEffect, useRef } from "react";
import PhoneMockup from "./PhoneMockup";
import HoverButton from "./HoverButton";

export default function Hero() {
  const sectionRef = useRef<HTMLElement>(null);
  const stickyRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const visualRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const section = sectionRef.current;
    const sticky = stickyRef.current;
    const title = titleRef.current;
    const visual = visualRef.current;
    if (!section || !sticky || !title || !visual) return;

    const onScroll = () => {
      const rect = section.getBoundingClientRect();
      const total = section.offsetHeight - window.innerHeight;
      const p = Math.min(1, Math.max(0, -rect.top / total));
      sticky.style.setProperty("--hero-p", p.toFixed(3));
      title.style.transform = `translateY(${-p * 80}px) scale(${1 + p * 0.08})`;
      title.style.opacity = `${1 - p * 0.85}`;
      visual.style.transform = `translateY(${p * -60}px)`;
      visual.style.opacity = `${p > 0.7 ? (1 - (p - 0.7) / 0.3).toFixed(2) : 1}`;
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <section ref={sectionRef} className="relative h-[220vh]" id="download">
      <div
        ref={stickyRef}
        className="sticky top-0 h-screen overflow-hidden"
        style={{ ["--hero-p" as string]: 0 }}
      >
        {/* animated gradient background */}
        <div
          className="absolute inset-0"
          aria-hidden
        >
          <div
            className="absolute inset-0 scale-110"
            style={{
              background:
                "radial-gradient(60% 60% at 20% 30%, #f3edfc 0%, transparent 60%), radial-gradient(50% 50% at 80% 20%, #ffe1c4 0%, transparent 55%), radial-gradient(70% 70% at 60% 90%, #c4f0d8 0%, transparent 60%), linear-gradient(135deg, #101010, #1a1a1a)",
              animation: "fox-float 14s ease-in-out infinite",
            }}
          />
          <div
            className="absolute -inset-40 opacity-[0.35]"
            style={{
              background:
                "conic-gradient(from 180deg at 50% 50%, #f6851b22, #5a2bb822, #0b57d022, #f6851b22)",
              filter: "blur(80px)",
            }}
          />
        </div>

        <div className="relative h-full max-w-7xl mx-auto px-4 md:px-8 grid lg:grid-cols-2 items-center gap-10 pt-24">
          <div>
            <p className="type-label-eyebrow text-cream/50 build-up" style={{ animationDelay: "1.1s" }}>
              Crypto wallet
            </p>
            <h1
              ref={titleRef}
              className="font-poly font-black type-display-xl mt-4 build-up"
              style={{ animationDelay: "1.2s" }}
            >
              Where your{" "}
              <span className="relative inline-block">
                <span className="italic text-brand">m</span>
                <span
                  className="absolute inset-0 bg-brand/40 mix-blend-multiply rounded"
                  aria-hidden
                />
              </span>
              oney lives
            </h1>
            <p
              className="mt-6 type-body-l text-cream/70 max-w-md leading-relaxed build-up"
              style={{ animationDelay: "1.35s" }}
            >
              The trusted wallet for millions — swap, send, and store your
              crypto with total control over your keys.
            </p>
            <div className="mt-8 flex flex-wrap gap-3 build-up" style={{ animationDelay: "1.5s" }}>
              <HoverButton variant="brand">Download MetaMask</HoverButton>
              <HoverButton variant="light" href="#trade">
                Explore products
              </HoverButton>
            </div>
          </div>

          <div ref={visualRef} className="hidden lg:flex justify-end build-up" style={{ animationDelay: "1.45s" }}>
            <PhoneMockup />
          </div>
        </div>
      </div>
    </section>
  );
}