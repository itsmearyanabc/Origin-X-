import { useRef, useState } from "react";
import { AnimatePresence, motion, useMotionValueEvent, useScroll, useSpring } from "motion/react";
import {
  AlertTriangle,
  BadgeCheck,
  Blocks,
  Building2,
  Check,
  Factory,
  Fingerprint,
  Gauge,
  History,
  QrCode,
  Repeat,
  ScanLine,
  ShieldCheck,
  Siren,
  Store,
  Truck,
  Warehouse,
} from "lucide-react";
import { cn } from "@/lib/format";
import { easeOutExpo, Reveal, SectionHeading, TrustRing } from "../shared";

const STEPS = [
  { icon: Building2, title: "Organizations join and get verified", text: "Manufacturers, logistics, warehouses and retailers each get their own isolated workspace. ORIGINX verifies who they are before their records carry trust." },
  { icon: QrCode, title: "Every product gets a passport, identity and QR", text: "A global identity hash is registered on-chain. Origin, batch and dates are sealed into the first event, and a unique QR token is issued." },
  { icon: Factory, title: "Manufactured, quality approved, shipped", text: "Each lifecycle step becomes an event linked by SHA-256 to the one before it, so history can only grow, never be quietly rewritten." },
  { icon: Repeat, title: "Transfer → Accept → Record. Repeat.", text: "Custody only moves when the receiving company accepts it. Every handoff is recorded by both sides, anchored, and repeated until the retailer receives it." },
  { icon: ScanLine, title: "The customer scans the QR", text: "No app, no account. The scan opens a public, privacy-safe passport." },
  { icon: ShieldCheck, title: "Identity, history and proof are checked", text: "Is the identity genuine? Does every hash recompute and link? Do the on-chain anchors match? All three, on every scan." },
  { icon: Gauge, title: "The trust engine decides", text: "A deterministic score from 0–100 with every factor and penalty explained. No black box." },
  { icon: Siren, title: "Verified — or incident, and recall", text: "Problems raise incidents automatically. Recalls reach every affected unit, and every scan shows RECALLED instantly." },
];

function StepVisual({ index }: { index: number }) {
  const card = "rounded-2xl bg-white p-4 shadow-soft ring-1 ring-ink-200/70";
  switch (index) {
    case 0:
      return (
        <div className="grid gap-3">
          {[
            ["ABC Pharma", "Manufacturer", Factory],
            ["SwiftLogix", "Logistics", Truck],
            ["MetroCare", "Warehouse", Warehouse],
            ["HealthPlus", "Retailer", Store],
          ].map(([name, role, Icon], i) => (
            <motion.div key={name as string} className={cn(card, "flex items-center gap-3")} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.08 }}>
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-600">
                {(() => {
                  const I = Icon as typeof Factory;
                  return <I className="h-5 w-5" />;
                })()}
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-ink-900">{name as string}</p>
                <p className="text-xs text-ink-500">{role as string}</p>
              </div>
              <span className="inline-flex items-center gap-1 rounded-full bg-ok-50 px-2 py-0.5 text-[11px] font-semibold text-ok-700">
                <BadgeCheck className="h-3.5 w-3.5" /> Verified
              </span>
            </motion.div>
          ))}
        </div>
      );
    case 1:
      return (
        <div className={cn(card, "p-6")}>
          <div className="flex items-start gap-5">
            <div className="grid h-28 w-28 shrink-0 place-items-center rounded-2xl bg-ink-900 text-white">
              <QrCode className="h-16 w-16" strokeWidth={1.4} />
            </div>
            <div className="min-w-0 space-y-2 text-sm">
              <p className="font-display text-lg font-bold text-ink-900">OrigiVax Influenza</p>
              <p className="text-ink-500">RX-29481 · Serial A92-000417</p>
              <p className="text-ink-500">Origin: Delhi, India</p>
              <p className="hash truncate rounded-md bg-ink-100 px-2 py-1 text-ink-600">identity 7f3a…c09e</p>
            </div>
          </div>
          <div className="mt-5 flex items-center gap-2 rounded-xl bg-ok-50 px-3 py-2 text-xs font-semibold text-ok-700">
            <Blocks className="h-4 w-4" /> Identity registered on-chain · write-once
          </div>
        </div>
      );
    case 2:
      return (
        <div className="space-y-3">
          {["PRODUCT_REGISTERED", "MANUFACTURED", "QUALITY_APPROVED", "SHIPMENT_CREATED"].map((e, i) => (
            <motion.div key={e} className={cn(card, "flex items-center gap-3 py-3")} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }}>
              <span className="hash grid h-8 w-8 place-items-center rounded-lg bg-brand-50 font-semibold text-brand-700">{String(i + 1).padStart(2, "0")}</span>
              <span className="flex-1 text-sm font-semibold text-ink-900">{e.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}</span>
              <span className="hash text-[11px] text-ink-400">prev → {["0000", "a91c", "4be2", "d07f"][i]}…</span>
            </motion.div>
          ))}
        </div>
      );
    case 3:
      return (
        <div className={cn(card, "p-6")}>
          <div className="flex items-center justify-between gap-2">
            {[Factory, Truck, Warehouse, Store].map((Icon, i) => (
              <div key={i} className="flex items-center gap-2">
                <motion.div className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-50 text-brand-600 ring-1 ring-brand-200" initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: i * 0.25 }}>
                  <Icon className="h-5 w-5" />
                </motion.div>
                {i < 3 && <motion.div className="h-0.5 w-6 bg-brand-300 sm:w-10" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ delay: i * 0.25 + 0.15 }} style={{ originX: 0 }} />}
              </div>
            ))}
          </div>
          <div className="mt-6 grid grid-cols-3 gap-2 text-center text-xs font-semibold">
            {["Transfer requested", "Receiver accepts", "Custody recorded"].map((s, i) => (
              <motion.div key={s} className="rounded-xl bg-ink-50 px-2 py-3 text-ink-700 ring-1 ring-ink-200" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.8 + i * 0.15 }}>
                <Check className="mx-auto mb-1 h-4 w-4 text-ok-600" />
                {s}
              </motion.div>
            ))}
          </div>
        </div>
      );
    case 4:
      return (
        <div className={cn(card, "grid place-items-center p-10")}>
          <div className="relative grid h-40 w-40 place-items-center rounded-3xl bg-ink-900">
            <QrCode className="h-24 w-24 text-white" strokeWidth={1.2} />
            <motion.div className="absolute inset-x-5 h-0.5 rounded-full bg-brand-500 shadow-[0_0_18px_4px_rgb(242_92_5/0.6)]" animate={{ top: ["18%", "82%", "18%"] }} transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }} />
          </div>
          <p className="mt-5 text-sm font-semibold text-ink-700">No app. No account. One scan.</p>
        </div>
      );
    case 5:
      return (
        <div className="space-y-3">
          {[
            [Fingerprint, "Identity", "Original registration · not a clone"],
            [History, "History", "8 / 8 hashes recompute and link"],
            [Blocks, "Proof", "8 / 8 anchors match the blockchain"],
          ].map(([Icon, title, detail], i) => {
            const I = Icon as typeof Fingerprint;
            return (
              <motion.div key={title as string} className={cn(card, "flex items-center gap-4")} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.15 }}>
                <div className="grid h-11 w-11 place-items-center rounded-xl bg-brand-50 text-brand-600">
                  <I className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-ink-900">{title as string} check</p>
                  <p className="text-xs text-ink-500">{detail as string}</p>
                </div>
                <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.4 + i * 0.15, type: "spring" }} className="grid h-7 w-7 place-items-center rounded-full bg-ok-500 text-white">
                  <Check className="h-4 w-4" strokeWidth={3} />
                </motion.span>
              </motion.div>
            );
          })}
        </div>
      );
    case 6:
      return (
        <div className={cn(card, "flex flex-col items-center gap-5 p-8 sm:flex-row")}>
          <TrustRing score={94} size={130} stroke={11} />
          <ul className="w-full space-y-1.5 text-sm">
            {[
              ["+20", "Valid cryptographic chain", true],
              ["+15", "Complete custody chain", true],
              ["+15", "Valid blockchain proofs", true],
              ["+10", "Verified organization", true],
              ["−40", "Tampered event", false],
            ].map(([pts, label, good]) => (
              <li key={label as string} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1">
                <span className="text-ink-600">{label as string}</span>
                <span className={cn("hash font-semibold", good ? "text-ok-600" : "text-ink-300 line-through")}>{pts as string}</span>
              </li>
            ))}
          </ul>
        </div>
      );
    default:
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className={cn(card, "border-t-4 border-t-ok-500")}>
            <BadgeCheck className="h-6 w-6 text-ok-600" />
            <p className="mt-3 font-display text-lg font-bold text-ink-900">Verified</p>
            <p className="mt-1 text-sm text-ink-500">History intact. Trust shown with every reason.</p>
          </div>
          <div className={cn(card, "border-t-4 border-t-bad-500")}>
            <AlertTriangle className="h-6 w-6 text-bad-600" />
            <p className="mt-3 font-display text-lg font-bold text-ink-900">Incident → Recall</p>
            <p className="mt-1 text-sm text-ink-500">Affected products and organizations alerted; scans show RECALLED.</p>
          </div>
        </div>
      );
  }
}

export function Journey() {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 30 });
  useMotionValueEvent(scrollYProgress, "change", (v) => setActive(Math.min(STEPS.length - 1, Math.max(0, Math.floor(v * STEPS.length)))));

  return (
    <section id="journey" className="relative bg-white py-24">
      <div className="container-x">
        <SectionHeading eyebrow="How ORIGINX works" title={<>From factory to customer — <span className="text-gradient">every handoff provable.</span></>} description="One network for every company that touches a product, and one scan that lets anyone check the whole story." />
      </div>

      {/* Desktop: pinned, scroll-driven */}
      <div ref={ref} className="relative mt-10 hidden lg:block" style={{ height: `${STEPS.length * 65}vh` }}>
        <div className="sticky top-0 flex h-screen items-center">
          <div className="container-x grid grid-cols-[1fr_1.05fr] items-center gap-16">
            <div className="relative pl-8">
              <div className="absolute bottom-2 left-[11px] top-2 w-0.5 rounded-full bg-ink-100" />
              <motion.div className="absolute left-[11px] top-2 w-0.5 origin-top rounded-full bg-brand-500" style={{ scaleY: progress, bottom: "0.5rem" }} />
              <ol className="space-y-1">
                {STEPS.map((s, i) => (
                  <li key={s.title} className="relative">
                    <span className={cn("absolute -left-8 top-3 grid h-6 w-6 place-items-center rounded-full border-2 bg-white transition-all duration-500", i <= active ? "border-brand-500" : "border-ink-200")}>
                      <span className={cn("h-2 w-2 rounded-full transition-all duration-500", i <= active ? "bg-brand-500" : "bg-transparent")} />
                    </span>
                    <div className={cn("rounded-2xl px-4 py-2.5 transition-all duration-500", i === active ? "bg-brand-50/70" : "")}>
                      <p className={cn("font-display text-[1.05rem] font-bold transition-colors duration-500", i === active ? "text-ink-900" : "text-ink-400")}>{s.title}</p>
                      <motion.div initial={false} animate={{ height: i === active ? "auto" : 0, opacity: i === active ? 1 : 0 }} transition={{ duration: 0.5, ease: easeOutExpo }} className="overflow-hidden">
                        <p className="pt-1.5 text-sm leading-relaxed text-ink-600">{s.text}</p>
                      </motion.div>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
            <div className="relative">
              <div className="absolute -inset-8 -z-10 rounded-[3rem] bg-gradient-to-br from-brand-100/70 via-ink-50 to-white" />
              <div className="mb-4 flex items-center gap-3">
                <span className="hash rounded-full bg-ink-900 px-3 py-1 text-xs text-white">
                  {String(active + 1).padStart(2, "0")} / {String(STEPS.length).padStart(2, "0")}
                </span>
                <span className="text-sm font-semibold text-ink-500">{STEPS[active].title}</span>
              </div>
              <AnimatePresence mode="wait">
                <motion.div key={active} initial={{ opacity: 0, y: 24, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -16, scale: 0.98 }} transition={{ duration: 0.5, ease: easeOutExpo }}>
                  <StepVisual index={active} />
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile / tablet: vertical timeline */}
      <ol className="container-x mt-12 space-y-10 lg:hidden">
        {STEPS.map((s, i) => (
          <Reveal key={s.title} as="li" className="relative pl-12">
            <span className="absolute left-0 top-0 grid h-9 w-9 place-items-center rounded-xl bg-brand-500 text-white shadow-glow">
              <s.icon className="h-4 w-4" />
            </span>
            {i < STEPS.length - 1 && <span className="absolute left-[17px] top-11 h-[calc(100%+0.5rem)] w-0.5 bg-brand-100" />}
            <p className="font-display text-lg font-bold text-ink-900">{s.title}</p>
            <p className="mt-1 text-sm leading-relaxed text-ink-600">{s.text}</p>
            <div className="mt-4">
              <StepVisual index={i} />
            </div>
          </Reveal>
        ))}
      </ol>
    </section>
  );
}
