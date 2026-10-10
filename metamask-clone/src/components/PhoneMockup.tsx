"use client";

import { useEffect, useRef } from "react";

export default function PhoneMockup({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const p = Math.min(1, Math.max(0, (vh - rect.top) / (vh + rect.height)));
      el.style.transform = `translateY(${(1 - p) * 60}px) rotate(${(1 - p) * 6 - 3}deg)`;
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const rows = [
    { token: "ETH", name: "Ethereum", amt: "2.481", val: "$8,420", tint: "bg-blue-light" },
    { token: "USDC", name: "USD Coin", amt: "1,250", val: "$1,250", tint: "bg-blue-light" },
    { token: "SOL", name: "Solana", amt: "18.2", val: "$2,910", tint: "bg-purple-light" },
  ];

  return (
    <div ref={ref} className={className} style={{ transform: "rotate(-3deg)" }}>
      <div className="w-[280px] md:w-[320px] rounded-[2.5rem] bg-ink p-3 shadow-[0_40px_80px_rgba(16,16,16,0.35)]">
        <div className="rounded-[2rem] bg-cream overflow-hidden">
          <div className="px-5 pt-6 pb-4">
            <p className="text-xs text-ink/50 font-semibold">Account 1</p>
            <p className="font-poly text-3xl font-black mt-1 text-ink">$12,580.44</p>
            <p className="text-xs text-green font-bold mt-1">↑ $312.09 (2.5%)</p>
            <div className="flex gap-2 mt-4">
              {["Buy", "Swap", "Send"].map((a) => (
                <span
                  key={a}
                  className="flex-1 text-center text-xs font-bold py-2.5 rounded-full bg-ink text-cream"
                >
                  {a}
                </span>
              ))}
            </div>
          </div>
          <div className="overflow-hidden h-[210px]">
            <div className="phone-cycle">
              {[0, 1, 2].map((screen) => (
                <div key={screen} className="h-[210px] px-5 py-3 space-y-3">
                  {rows.map((r, i) => (
                    <div
                      key={`${screen}-${i}`}
                      className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-sm"
                    >
                      <span className={`w-10 h-10 rounded-full ${r.tint} flex items-center justify-center text-xs font-black text-blue-dark`}>
                        {r.token.slice(0, 2)}
                      </span>
                      <div className="flex-1">
                        <p className="text-sm font-bold text-ink">{r.name}</p>
                        <p className="text-xs text-ink/50">{r.amt} {r.token}</p>
                      </div>
                      <p className="text-sm font-bold text-ink">{r.val}</p>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}