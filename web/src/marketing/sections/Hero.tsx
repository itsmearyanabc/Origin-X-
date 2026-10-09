import { useEffect, useState } from "react";
import { Link } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, BadgeCheck, Blocks, Check, Fingerprint, History, Link2, Loader2, ScanLine, ShieldCheck, Truck } from "lucide-react";
import { buttonClass } from "@/components/ui";
import { easeOutExpo, TrustRing } from "../shared";

const HEADLINE = ["The", "verifiable", "identity", "layer", "for", "physical", "products."];
const HIGHLIGHT = new Set(["verifiable", "identity"]);

type Phase = "scan" | "checks" | "result";

function QrGlyph() {
  // Deterministic decorative QR-like pattern (not a real code).
  const cells = Array.from({ length: 21 * 21 }, (_, i) => {
    const x = i % 21;
    const y = Math.floor(i / 21);
    const finder = (cx: number, cy: number) => x >= cx && x < cx + 7 && y >= cy && y < cy + 7;
    if (finder(0, 0) || finder(14, 0) || finder(0, 14)) {
      const lx = x % 14 === x ? x : x - 14;
      const ly = y % 14 === y ? y : y - 14;
      const ring = lx === 0 || lx === 6 || ly === 0 || ly === 6;
      const core = lx >= 2 && lx <= 4 && ly >= 2 && ly <= 4;
      return ring || core;
    }
    return ((x * 7 + y * 13 + x * y) % 5) < 2;
  });
  return (
    <svg viewBox="0 0 21 21" className="h-full w-full" shapeRendering="crispEdges">
      {cells.map((on, i) => (on ? <rect key={i} x={i % 21} y={Math.floor(i / 21)} width="1" height="1" fill="#1c1917" /> : null))}
    </svg>
  );
}

const CHECKS = [
  { icon: Fingerprint, label: "Identity check", detail: "Registered by Example Pharma" },
  { icon: History, label: "History check", detail: "8 / 8 events hash-verified" },
  { icon: Blocks, label: "Proof check", detail: "Anchors match the chain" },
];

const TIMELINE = [
  { label: "Manufactured", place: "Delhi, India" },
  { label: "Quality approved", place: "QC Lab" },
  { label: "Custody → Example Logistics", place: "Delhi Hub" },
  { label: "Retailer received", place: "Example Pharmacy" },
];

function PhoneDemo() {
  const [phase, setPhase] = useState<Phase>("scan");
  const [checked, setChecked] = useState(0);

  useEffect(() => {
    const timers: number[] = [];
    const run = () => {
      setPhase("scan");
      setChecked(0);
      timers.push(window.setTimeout(() => setPhase("checks"), 2200));
      [1, 2, 3].forEach((n) => timers.push(window.setTimeout(() => setChecked(n), 2200 + n * 650)));
      timers.push(window.setTimeout(() => setPhase("result"), 4700));
      timers.push(window.setTimeout(run, 10_500));
    };
    run();
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <div className="relative mx-auto w-[300px] sm:w-[320px]">
      <div className="absolute -inset-10 -z-10 rounded-full bg-brand-400/30 blur-3xl" />
      <div className="rounded-[2.75rem] bg-ink-900 p-2.5 shadow-[0_40px_80px_-30px_rgb(28_25_23/0.6)] ring-1 ring-white/10">
        <div className="relative h-[600px] overflow-hidden rounded-[2.2rem] bg-ink-50">
          <div className="absolute left-1/2 top-2.5 z-10 h-6 w-24 -translate-x-1/2 rounded-full bg-ink-900" />
          <div className="flex items-center justify-between px-6 pt-12 text-[11px] font-semibold text-ink-500">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-brand-500" /> originx.app/verify
            </span>
            <span>Secure</span>
          </div>

          <AnimatePresence mode="wait">
            {phase !== "result" ? (
              <motion.div key="scan" className="px-6 pt-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.4 }}>
                <p className="text-center font-display text-lg font-bold text-ink-900">{phase === "scan" ? "Scanning product…" : "Verifying"}</p>
                <p className="mt-1 text-center text-xs text-ink-500">Influenza Vaccine (example) · Batch A92</p>
                <div className="relative mx-auto mt-6 aspect-square w-48 rounded-2xl bg-white p-4 shadow-soft ring-1 ring-ink-200">
                  <QrGlyph />
                  {["left-2 top-2 border-l-4 border-t-4", "right-2 top-2 border-r-4 border-t-4", "left-2 bottom-2 border-b-4 border-l-4", "right-2 bottom-2 border-b-4 border-r-4"].map((c) => (
                    <span key={c} className={`absolute h-7 w-7 rounded-md border-brand-500 ${c}`} />
                  ))}
                  {phase === "scan" && (
                    <motion.div
                      className="absolute inset-x-4 h-0.5 rounded-full bg-brand-500 shadow-[0_0_18px_4px_rgb(242_92_5/0.55)]"
                      initial={{ top: "12%" }}
                      animate={{ top: ["12%", "88%", "12%"] }}
                      transition={{ duration: 2, ease: "easeInOut", repeat: Infinity }}
                    />
                  )}
                </div>
                <div className="mt-6 space-y-2.5">
                  {CHECKS.map((c, i) => {
                    const done = checked > i;
                    const active = phase === "checks" && checked === i;
                    return (
                      <motion.div
                        key={c.label}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: phase === "checks" ? 1 : 0.35, x: 0 }}
                        transition={{ delay: i * 0.08 }}
                        className="flex items-center gap-3 rounded-xl bg-white px-3 py-2.5 shadow-soft ring-1 ring-ink-200/70"
                      >
                        <div className={`grid h-8 w-8 place-items-center rounded-lg ${done ? "bg-ok-50 text-ok-600" : "bg-brand-50 text-brand-600"}`}>
                          {done ? <Check className="h-4 w-4" /> : active ? <Loader2 className="h-4 w-4 animate-spin" /> : <c.icon className="h-4 w-4" />}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-ink-900">{c.label}</p>
                          <p className="truncate text-[11px] text-ink-500">{done ? c.detail : "Checking…"}</p>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </motion.div>
            ) : (
              <motion.div key="result" className="px-5 pt-5" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.6, ease: easeOutExpo }}>
                <div className="rounded-2xl bg-gradient-to-br from-ok-600 to-ok-500 p-4 text-white shadow-[0_18px_40px_-18px_rgb(5_150_105/0.8)]">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-white/80">
                    <BadgeCheck className="h-4 w-4" /> History verified
                  </div>
                  <p className="mt-1.5 font-display text-[1.05rem] font-bold leading-snug">Lifecycle cryptographically verified.</p>
                </div>
                <div className="mt-4 flex items-center gap-4 rounded-2xl bg-white p-4 shadow-soft ring-1 ring-ink-200/70">
                  <TrustRing score={100} size={78} stroke={8} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-ink-900">Influenza Vaccine</p>
                    <p className="text-xs text-ink-500">Example Pharma · Batch A92</p>
                    <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-ok-50 px-2 py-0.5 text-[10px] font-bold text-ok-700">
                      <Check className="h-3 w-3" /> 8/8 on-chain
                    </p>
                  </div>
                </div>
                <div className="mt-4 rounded-2xl bg-white p-4 shadow-soft ring-1 ring-ink-200/70">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Journey</p>
                  <ol className="mt-3 space-y-3">
                    {TIMELINE.map((t, i) => (
                      <motion.li key={t.label} className="relative flex items-start gap-3 pl-1" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.25 + i * 0.12, ease: easeOutExpo, duration: 0.6 }}>
                        <span className="relative mt-1 grid h-3 w-3 place-items-center rounded-full bg-brand-500 ring-4 ring-brand-100">
                          {i < TIMELINE.length - 1 && <span className="absolute left-1/2 top-3 h-6 w-0.5 -translate-x-1/2 bg-brand-200" />}
                        </span>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-ink-900">{t.label}</p>
                          <p className="text-[11px] text-ink-500">{t.place}</p>
                        </div>
                        <span className="hash ml-auto text-[10px] text-ink-400">0x{(0x6ba3 + i * 911).toString(16)}…</span>
                      </motion.li>
                    ))}
                  </ol>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function FloatingCard({ className, delay, children }: { className: string; delay: number; children: React.ReactNode }) {
  return (
    <motion.div
      className={`absolute hidden rounded-2xl border border-ink-200/80 bg-white/90 p-3.5 shadow-lift backdrop-blur xl:block ${className}`}
      initial={{ opacity: 0, scale: 0.9, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: [0, -10, 0] }}
      transition={{ opacity: { delay, duration: 0.6 }, scale: { delay, duration: 0.6 }, y: { delay, duration: 6, repeat: Infinity, ease: "easeInOut" } }}
    >
      {children}
    </motion.div>
  );
}

export function Hero() {
  return (
    <section className="relative overflow-hidden pb-20 pt-28 sm:pt-32 lg:pb-28">
      <div aria-hidden className="grid-bg absolute inset-0 [mask-image:radial-gradient(ellipse_at_top,black_30%,transparent_75%)]" />
      <div aria-hidden className="absolute -top-40 right-[-10%] h-[520px] w-[520px] rounded-full bg-brand-300/40 blur-[120px]" />
      <div aria-hidden className="absolute bottom-0 left-[-10%] h-[380px] w-[380px] rounded-full bg-amber-200/40 blur-[110px]" />

      <div className="container-x relative grid items-center gap-16 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: easeOutExpo }}
            className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-white/80 py-1 pl-1 pr-3 text-xs font-semibold text-ink-700 shadow-soft backdrop-blur"
          >
            <span className="rounded-full bg-brand-500 px-2 py-0.5 text-[10px] uppercase tracking-wider text-white">New</span>
            Digital Product Passports, anchored on-chain
          </motion.div>

          <h1 className="mt-6 text-[2.6rem] font-extrabold leading-[1.02] tracking-tight text-ink-900 sm:text-6xl lg:text-[4.2rem]">
            {HEADLINE.map((word, i) => (
              <span key={i} className="inline-block overflow-hidden pb-1 align-top">
                <motion.span
                  className={`inline-block ${HIGHLIGHT.has(word) ? "text-gradient" : ""}`}
                  initial={{ y: "110%" }}
                  animate={{ y: 0 }}
                  transition={{ duration: 0.9, ease: easeOutExpo, delay: 0.1 + i * 0.07 }}
                >
                  {word}
                </motion.span>
                {i < HEADLINE.length - 1 && " "}
              </span>
            ))}
          </h1>

          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, ease: easeOutExpo, delay: 0.6 }}
            className="mt-6 max-w-xl text-lg leading-relaxed text-ink-600"
          >
            ORIGINX gives every product and batch a Digital Product Passport, a tamper-evident custody history across every company that touches it, and blockchain proof anyone can check with a single scan.
          </motion.p>

          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, ease: easeOutExpo, delay: 0.75 }} className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Link to="/sign-up" className={buttonClass("primary", "lg", "group")}>
              Start as an organization
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
            <Link to="/verify" className={buttonClass("secondary", "lg")}>
              <ScanLine className="h-4 w-4 text-brand-500" /> Verify a product
            </Link>
          </motion.div>

          <motion.ul
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1, duration: 0.8 }}
            className="mt-10 grid max-w-xl grid-cols-1 gap-3 text-sm text-ink-600 sm:grid-cols-3"
          >
            {["No IoT hardware needed", "Only hashes on-chain", "Free for consumers"].map((t) => (
              <li key={t} className="flex items-center gap-2">
                <span className="grid h-5 w-5 place-items-center rounded-full bg-brand-100 text-brand-700">
                  <Check className="h-3 w-3" strokeWidth={3} />
                </span>
                {t}
              </li>
            ))}
          </motion.ul>
        </div>

        <motion.div className="relative" initial={{ opacity: 0, y: 40, rotate: 2 }} animate={{ opacity: 1, y: 0, rotate: 0 }} transition={{ duration: 1.2, ease: easeOutExpo, delay: 0.3 }}>
          <PhoneDemo />
          <p className="mt-4 text-center text-xs text-ink-400">Illustration · example product and partners</p>
          <FloatingCard className="-left-14 top-20" delay={1.2}>
            <div className="flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-brand-50 text-brand-600">
                <Truck className="h-4 w-4" />
              </div>
              <div>
                <p className="text-xs font-semibold text-ink-900">Custody accepted</p>
                <p className="text-[11px] text-ink-500">Example Logistics → Example Distributor</p>
              </div>
            </div>
          </FloatingCard>
          <FloatingCard className="-right-8 top-1/2" delay={1.6}>
            <div className="flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-ok-50 text-ok-600">
                <Link2 className="h-4 w-4" />
              </div>
              <div>
                <p className="text-xs font-semibold text-ink-900">Anchored on-chain</p>
                <p className="hash text-[11px] text-ink-500">tx 0x6ba3a33b…b2c3</p>
              </div>
            </div>
          </FloatingCard>
          <FloatingCard className="-left-20 -bottom-4" delay={2}>
            <div className="flex items-center gap-2">
              <span className="hash rounded-md bg-ink-100 px-1.5 py-0.5 text-[10px] text-ink-600">#05</span>
              <span className="text-xs text-ink-400">→</span>
              <span className="hash rounded-md bg-ink-100 px-1.5 py-0.5 text-[10px] text-ink-600">#06</span>
              <span className="text-xs text-ink-400">→</span>
              <span className="hash rounded-md bg-brand-100 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700">#07</span>
            </div>
            <p className="mt-1.5 text-[11px] text-ink-500">SHA-256 linked history</p>
          </FloatingCard>
        </motion.div>
      </div>
    </section>
  );
}
