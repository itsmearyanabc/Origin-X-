"use client";

import { useEffect, useRef, useState } from "react";
import FoxHead from "./FoxHead";
import HoverButton from "./HoverButton";

type MenuItem = { label: string; desc: string };
type Menu = { id: string; label: string; items: MenuItem[] };

const MENUS: Menu[] = [
  {
    id: "trade",
    label: "Trade",
    items: [
      { label: "Swap", desc: "Trade tokens instantly" },
      { label: "Buy", desc: "Purchase crypto with card" },
      { label: "Sell", desc: "Cash out to your bank" },
      { label: "Perps", desc: "Leveraged onchain trading" },
    ],
  },
  {
    id: "money",
    label: "Money",
    items: [
      { label: "MetaMask Card", desc: "Spend crypto IRL" },
      { label: "mUSD", desc: "A dollar that earns" },
      { label: "Rewards", desc: "Earn on every swap" },
      { label: "Portfolio", desc: "Track all your assets" },
    ],
  },
  {
    id: "developer",
    label: "Developer",
    items: [
      { label: "SDK", desc: "Connect wallets to your dapp" },
      { label: "Snaps", desc: "Extend what a wallet can do" },
      { label: "Smart Accounts", desc: "Account abstraction toolkit" },
      { label: "Web3 Services", desc: "Swaps, quotes, and more" },
    ],
  },
];

export default function Header() {
  const [open, setOpen] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const [solid, setSolid] = useState(false);
  const lastY = useRef(0);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      setSolid(y > 24);
      if (y > lastY.current && y > 200 && !open) setHidden(true);
      else setHidden(false);
      lastY.current = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [open]);

  const enter = (id: string) => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(id);
  };
  const leave = () => {
    closeTimer.current = setTimeout(() => setOpen(null), 180);
  };

  return (
    <header
      className={`header fixed top-0 inset-x-0 z-50 ${hidden ? "header-hidden" : ""} ${solid ? "header-solid" : ""}`}
    >
      <div
        className="mx-auto max-w-7xl px-4 md:px-8 flex items-center justify-between h-16 md:h-20 build-up"
        style={{ animationDelay: "0.9s" }}
      >
        <a href="#" className="flex items-center gap-2" aria-label="MetaMask home">
          <FoxHead className="w-9 h-9" size={180} />
          <span className="font-poly font-black text-lg tracking-tight text-ink">MetaMask</span>
        </a>

        <nav className="hidden lg:flex items-center gap-1" aria-label="Primary">
          {MENUS.map((menu) => (
            <div
              key={menu.id}
              className="relative"
              onMouseEnter={() => enter(menu.id)}
              onMouseLeave={leave}
            >
              <button
                className={`px-4 py-2 rounded-full text-sm font-semibold transition-colors ${
                  open === menu.id ? "bg-ink/5 text-ink" : "text-ink/70 hover:bg-ink/5 hover:text-ink"
                }`}
                aria-expanded={open === menu.id}
                aria-haspopup="true"
                onFocus={() => enter(menu.id)}
              >
                {menu.label}
              </button>
              <div
                className="dropdown-panel absolute left-1/2 -translate-x-1/2 top-full pt-3"
                data-lenis-prevent="true"
              >
                <div className="w-[560px] rounded-3xl bg-cream shadow-[0_24px_60px_rgba(16,16,16,0.14)] border border-ink/5 p-6 grid grid-cols-2 gap-2">
                  {menu.items.map((item) => (
                    <a
                      key={item.label}
                      href="#"
                      className="rounded-2xl p-4 hover:bg-purple-muted transition-colors group"
                    >
                      <div className="flex items-center gap-2">
                        <span className="w-8 h-8 rounded-full bg-brand-muted flex items-center justify-center">
                          <FoxHead className="w-5 h-5" size={100} />
                        </span>
                        <span className="font-bold text-sm text-ink">{item.label}</span>
                      </div>
                      <p className="mt-2 text-xs text-ink/60 leading-relaxed">{item.desc}</p>
                    </a>
                  ))}
                </div>
              </div>
            </div>
          ))}
          <a href="#news" className="px-4 py-2 text-sm font-semibold text-ink/70 hover:bg-ink/5 hover:text-ink rounded-full transition-colors">
            News
          </a>
        </nav>

        <div className="flex items-center gap-3">
          <HoverButton href="#download" variant="dark" className="hidden sm:inline-block">
            Download
          </HoverButton>
          <button
            className="lg:hidden w-10 h-10 rounded-full border border-ink/15 flex items-center justify-center text-ink"
            aria-label="Open menu"
            onClick={() => setOpen(open ? null : "mobile")}
          >
            <div className="space-y-1.5">
              <span className="block w-5 h-0.5 bg-ink" />
              <span className="block w-5 h-0.5 bg-ink" />
            </div>
          </button>
        </div>
      </div>

      {open === "mobile" && (
        <div className="lg:hidden bg-cream border-t border-ink/5 px-6 py-8 space-y-6" data-lenis-prevent="true">
          {MENUS.map((menu) => (
            <div key={menu.id}>
              <p className="type-label-eyebrow text-ink/40 mb-3">{menu.label}</p>
              <div className="space-y-2">
                {menu.items.map((item) => (
                  <a key={item.label} href="#" className="block font-bold text-lg text-ink">
                    {item.label}
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </header>
  );
}