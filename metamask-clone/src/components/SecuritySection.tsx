"use client";

import { useEffect, useRef } from "react";
import GlobeCanvas from "./GlobeCanvas";
import FoxHead from "./FoxHead";

const FEATURES = [
  {
    title: "Your keys, your crypto",
    body: "Private keys never leave your device. You are the only one who can approve a transaction.",
  },
  {
    title: "Scam detection",
    body: "Warning screens flag risky signatures and known phishing sites before you sign.",
  },
  {
    title: "Hardware wallets",
    body: "Pair a Ledger, Trezor, or other hardware wallet for cold-storage-grade security.",
  },
  {
    title: "Open source",
    body: "Millions of eyes on the code. The extension is fully open source and battle-tested since 2016.",
  },
];

export default function SecuritySection() {
  const ref = useRef<HTMLElement>(null);
  const ringRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const p = Math.min(1, Math.max(0, (vh - rect.top) / (vh + rect.height) / 0.5));
      ringRefs.current.forEach((ring, i) => {
        if (!ring) return;
        const lag = Math.min(1, Math.max(0, p * 1.4 - i * 0.15));
        ring.style.transform = `scale(${0.4 + lag * (0.75 + i * 0.12)})`;
        ring.style.opacity = `${lag}`;
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const rings = [
    { size: 320, color: "border-green/30" },
    { size: 240, color: "border-blue/30" },
    { size: 160, color: "border-purple/30" },
  ];

  return (
    <section ref={ref} className="bg-green-light py-24 md:py-32" id="security">
      <div className="max-w-7xl mx-auto px-4 md:px-8 grid lg:grid-cols-2 gap-16 items-center">
        <div>
          <p className="type-label-eyebrow text-green-dark">Maximum security</p>
          <h2 className="font-poly font-black type-display-m mt-4">
            Security that stays out of your way
          </h2>
          <div className="mt-10 space-y-8">
            {FEATURES.map((f, i) => (
              <div key={f.title} className="flex gap-4">
                <span className="shrink-0 w-10 h-10 rounded-full bg-white flex items-center justify-center shadow-sm">
                  <FoxHead className="w-6 h-6" size={120} />
                </span>
                <div>
                  <h3 className="font-bold text-lg text-ink">{f.title}</h3>
                  <p className="text-sm text-ink/65 mt-1 leading-relaxed max-w-md">{f.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative aspect-square max-w-lg mx-auto w-full">
          {rings.map((ring, i) => (
            <div
              key={ring.size}
              ref={(el) => { ringRefs.current[i] = el; }}
              className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 ${ring.color}`}
              style={{ width: ring.size, height: ring.size, opacity: 0 }}
            >
              <div
                className="absolute inset-0 rounded-full border currentColor opacity-40 pulse-ring"
                style={{ animationDelay: `${i * 0.6}s` }}
              />
            </div>
          ))}
          <div className="absolute inset-0 flex items-center justify-center">
            <GlobeCanvas className="w-full h-full" />
          </div>
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <FoxHead className="w-24 h-24 fox-float" size={480} />
          </div>
        </div>
      </div>
    </section>
  );
}