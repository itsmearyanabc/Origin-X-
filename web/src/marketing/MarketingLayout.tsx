import ChatWidget from "./ChatWidget";
import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { AnimatePresence, motion, useScroll, useMotionValueEvent } from "motion/react";
import Lenis from "lenis";
import { ArrowRight, Menu, ScanLine, X } from "lucide-react";
import { Logo, buttonClass } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { homeFor } from "@/components/guards";
import { cn } from "@/lib/format";

const NAV = [
  { to: "/features", label: "Features" },
  { to: "/how-it-works", label: "How it works" },
  { to: "/why-originx", label: "Why ORIGINX" },
  { to: "/pricing", label: "Pricing" },
  { to: "/security", label: "Security" },
];

function useSmoothScroll() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const lenis = new Lenis({ duration: 1.1, easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)), smoothWheel: true });
    let frame = 0;
    const raf = (time: number) => {
      lenis.raf(time);
      frame = requestAnimationFrame(raf);
    };
    frame = requestAnimationFrame(raf);
    return () => {
      cancelAnimationFrame(frame);
      lenis.destroy();
    };
  }, []);
}

function Navbar() {
  const { scrollY } = useScroll();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const { status, me } = useAuth();
  const location = useLocation();
  useMotionValueEvent(scrollY, "change", (y) => setScrolled(y > 12));
  useEffect(() => setOpen(false), [location.pathname]);

  return (
    <header className="fixed inset-x-0 top-0 z-40">
      <motion.div
        className={cn(
          "transition-[background,box-shadow,border-color] duration-500",
          scrolled || open ? "border-b border-ink-200/70 bg-white/80 shadow-[0_8px_30px_-18px_rgb(28_25_23/0.25)] backdrop-blur-xl" : "border-b border-transparent bg-transparent",
        )}
      >
        <nav className="container-x flex h-16 items-center justify-between gap-6" aria-label="Main">
          <Logo />
          <div className="hidden items-center gap-1 lg:flex">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => cn("relative rounded-lg px-3 py-2 text-sm font-medium transition-colors", isActive ? "text-ink-900" : "text-ink-600 hover:text-ink-900")}
              >
                {({ isActive }) => (
                  <>
                    {item.label}
                    {isActive && <motion.span layoutId="nav-underline" className="absolute inset-x-3 -bottom-0.5 h-0.5 rounded-full bg-brand-500" />}
                  </>
                )}
              </NavLink>
            ))}
          </div>
          <div className="hidden items-center gap-2 lg:flex">
            <Link to="/verify" className={buttonClass("ghost", "md", "text-ink-700")}>
              <ScanLine className="h-4 w-4 text-brand-500" /> Verify a product
            </Link>
            {status === "authenticated" ? (
              <Link to={homeFor(me)} className={buttonClass("primary", "md")}>
                Open dashboard <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
              </Link>
            ) : (
              <>
                <Link to="/sign-in" className={buttonClass("secondary", "md")}>
                  Sign-in
                </Link>
                <Link to="/sign-up" className={buttonClass("primary", "md")}>
                  Sign-up <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
                </Link>
              </>
            )}
          </div>
          <button className="rounded-xl p-2 text-ink-800 lg:hidden" onClick={() => setOpen((o) => !o)} aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open}>
            {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </nav>
        <AnimatePresence>
          {open && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }} className="overflow-hidden lg:hidden">
              <div className="container-x flex flex-col gap-1 pb-6 pt-2">
                {NAV.map((item, i) => (
                  <motion.div key={item.to} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.04 * i }}>
                    <Link to={item.to} className="block rounded-xl px-3 py-3 text-base font-medium text-ink-800 hover:bg-ink-100">
                      {item.label}
                    </Link>
                  </motion.div>
                ))}
                <div className="mt-3 grid gap-2">
                  <Link to="/verify" className={buttonClass("secondary", "lg")}>
                    <ScanLine className="h-4 w-4 text-brand-500" /> Verify a product
                  </Link>
                  {status === "authenticated" ? (
                    <Link to={homeFor(me)} className={buttonClass("primary", "lg")}>
                      Open dashboard
                    </Link>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <Link to="/sign-in" className={buttonClass("secondary", "lg")}>
                        Sign-in
                      </Link>
                      <Link to="/sign-up" className={buttonClass("primary", "lg")}>
                        Sign-up
                      </Link>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </header>
  );
}

function Footer() {
  const cols = [
    { title: "Product", links: [["Features", "/features"], ["How it works", "/how-it-works"], ["Pricing", "/pricing"], ["Verify a product", "/verify"]] },
    { title: "Company", links: [["Why ORIGINX", "/why-originx"], ["Security", "/security"], ["Contact", "/contact"]] },
    { title: "Legal", links: [["Privacy policy", "/privacy"], ["Terms of service", "/terms"], ["Cookie policy", "/cookies"]] },
    { title: "Account", links: [["Sign in", "/sign-in"], ["Create organization", "/sign-up"]] },
  ];
  return (
    <footer className="relative overflow-hidden border-t border-ink-200 bg-white">
      <div className="container-x grid gap-12 py-16 md:grid-cols-[1.4fr_repeat(4,1fr)]">
        <div className="max-w-xs">
          <Logo />
          <p className="mt-4 text-sm leading-relaxed text-ink-600">The verifiable identity layer for physical products. Every handoff provable, every scan honest.</p>
          <div className="mt-5 inline-flex items-center gap-2 rounded-full bg-ok-50 px-3 py-1 text-xs font-semibold text-ok-700 ring-1 ring-ok-100">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok-500 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-ok-500" />
            </span>
            Proofs anchored on-chain
          </div>
        </div>
        {cols.map((col) => (
          <div key={col.title}>
            <h4 className="text-sm font-semibold text-ink-900">{col.title}</h4>
            <ul className="mt-4 space-y-2.5">
              {col.links.map(([label, to]) => (
                <li key={to}>
                  <Link to={to} className="text-sm text-ink-600 transition-colors hover:text-brand-600">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-ink-200">
        <div className="container-x flex flex-col items-center justify-between gap-3 py-6 text-xs text-ink-500 sm:flex-row">
          <p>© {new Date().getFullYear()} [COMPANY NAME]. All rights reserved.</p>
          <p>ORIGINX never stores personal data on a blockchain — only cryptographic proofs.</p>
        </div>
      </div>
      <div aria-hidden className="pointer-events-none select-none text-center font-display text-[18vw] font-extrabold leading-[0.8] tracking-tighter text-ink-100">
        ORIGINX
      </div>
    </footer>
  );
}

export default function MarketingLayout() {
  useSmoothScroll();
  const location = useLocation();
  return (
    <div className="min-h-screen bg-ink-50 text-ink-900">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2">
        Skip to content
      </a>
      <Navbar />
      <main id="main">
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
        <ChatWidget />
      </main>
      <Footer />
    </div>
  );
}
