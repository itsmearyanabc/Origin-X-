"use client";

import { useEffect, useRef, useState } from "react";

type Card = {
  title: string;
  collapsed: string;
  expanded: string;
  bg: string;
  fg: string;
  border: string;
};

const CARDS: Card[] = [
  {
    title: "Swap in seconds",
    collapsed: "Best rates across chains",
    expanded:
      "MetaMask routes your swap across hundreds of liquidity sources to find the best price — no leaving your wallet.",
    bg: "bg-purple-light",
    fg: "text-purple-dark",
    border: "border-purple-muted",
  },
  {
    title: "mUSD",
    collapsed: "A dollar that works for you",
    expanded:
      "Hold a stablecoin that earns yield automatically, backed by short-term treasuries and onchain reserves.",
    bg: "bg-orange-light",
    fg: "text-orange-dark",
    border: "border-orange-muted",
  },
  {
    title: "Card",
    collapsed: "Spend crypto IRL",
    expanded:
      "Tap to pay anywhere Mastercard is accepted. Your crypto converts instantly at the point of sale.",
    bg: "bg-blue-light",
    fg: "text-blue-dark",
    border: "border-blue-muted",
  },
  {
    title: "Rewards",
    collapsed: "Earn on every action",
    expanded:
      "Collect cashback on swaps, bridging, and purchases — rewards land straight in your wallet.",
    bg: "bg-green-light",
    fg: "text-green-dark",
    border: "border-green-muted",
  },
  {
    title: "Portfolio",
    collapsed: "All chains, one view",
    expanded:
      "See every token across 850+ networks in a single dashboard with live prices and NFT galleries.",
    bg: "bg-ink",
    fg: "text-green-light",
    border: "border-border-strong",
  },
];

export default function BentoGrid() {
  const [active, setActive] = useState(2);
  const cardRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    const onScroll = () => {
      const rect = section.getBoundingClientRect();
      const vh = window.innerHeight;
      const p = Math.min(1, Math.max(0, (vh - rect.top) / (vh + rect.height) / 0.6));
      const next = Math.min(CARDS.length - 1, Math.floor(p * CARDS.length));
      setActive(next);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <section ref={sectionRef} className="bento-grid">
      {CARDS.map((card, i) => (
        <button
          key={card.title}
          type="button"
          ref={(el) => { cardRefs.current[i] = el; }}
          aria-pressed={i === active}
          data-selected-bento={i === active}
          data-bento-retract-active={false}
          className={`bento-card ${card.bg} ${card.border} border ${i === active ? "bento-card_expanded" : ""} rounded-3xl p-6 md:p-8 text-left flex-1 min-h-[180px] md:min-h-0 md:flex-row`}
        >
          <div className="relative h-full w-full">
            <div className="bento-content bento-collapsed absolute inset-0 flex flex-col justify-between">
              <span className={`font-poly font-black text-2xl md:text-3xl ${card.fg}`}>
                {card.title}
              </span>
              <span className="text-sm font-semibold opacity-70">{card.collapsed}</span>
            </div>
            <div className="bento-content bento-expanded absolute inset-0 flex flex-col justify-between">
              <span className={`font-poly font-black text-2xl md:text-3xl ${card.fg}`}>
                {card.title}
              </span>
              <p className="type-body-s leading-relaxed opacity-80 max-w-sm">{card.expanded}</p>
              <span className="type-caption font-bold uppercase tracking-widest opacity-50">
                Scroll to explore
              </span>
            </div>
          </div>
        </button>
      ))}
    </section>
  );
}