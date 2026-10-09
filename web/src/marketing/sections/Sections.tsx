import { useState } from "react";
import { Link } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Check, ChevronDown, Database, FileWarning, Minus, ScanLine, ShieldOff, X } from "lucide-react";
import { buttonClass } from "@/components/ui";
import { cn } from "@/lib/format";
import { COMPARISON, EXPERIENCES, FAQ, FEATURES, INDUSTRIES, PLANS, PRIVACY_POINTS } from "../content";
import { easeOutExpo, fadeUp, Reveal, SectionHeading, stagger, TrustRing } from "../shared";

/* ------------------------------------------------------------ Marquee */

export function IndustryMarquee() {
  const items = [...INDUSTRIES, ...INDUSTRIES];
  return (
    <section className="border-y border-ink-200 bg-white py-7" aria-label="Industries">
      <p className="mb-4 text-center text-xs font-semibold uppercase tracking-[0.2em] text-ink-400">Built for supply chains that can't afford doubt</p>
      <div className="relative overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]">
        <div className="flex w-max animate-marquee gap-12 hover:[animation-play-state:paused]">
          {items.map((label, i) => (
            <span key={i} className="flex items-center gap-3 whitespace-nowrap font-display text-lg font-bold text-ink-300">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-400" />
              {label}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ Problem */

export function Problem() {
  const problems = [
    { icon: FileWarning, title: "Paper trails can be forged", text: "Certificates, invoices and stamps prove very little once they leave the factory." },
    { icon: Database, title: "Databases can be quietly edited", text: "Whoever controls the records controls the story — and nobody downstream can tell." },
    { icon: ShieldOff, title: "Customers can't check anything", text: "A logo and a hologram are all a buyer gets. Counterfeits and recalled stock slip through." },
  ];
  return (
    <section className="py-24">
      <div className="container-x">
        <SectionHeading eyebrow="The problem" title={<>Product history is easy to <span className="text-gradient">claim</span> and hard to <span className="text-gradient">prove.</span></>} />
        <motion.div className="mt-14 grid gap-5 md:grid-cols-3" variants={stagger(0.12)} initial="hidden" whileInView="show" viewport={{ once: true, margin: "-60px" }}>
          {problems.map((p) => (
            <motion.div key={p.title} variants={fadeUp} className="group rounded-3xl border border-ink-200 bg-white p-7 shadow-soft transition-all duration-500 hover:-translate-y-1 hover:shadow-lift">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-ink-900 text-white transition-colors duration-500 group-hover:bg-brand-500">
                <p.icon className="h-5 w-5" />
              </div>
              <h3 className="mt-5 text-lg font-bold text-ink-900">{p.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-600">{p.text}</p>
            </motion.div>
          ))}
        </motion.div>
        <Reveal className="mx-auto mt-12 max-w-2xl text-center">
          <p className="font-display text-xl font-bold text-ink-900 sm:text-2xl">
            ORIGINX turns <span className="text-ink-400 line-through decoration-brand-500 decoration-2">"trust the product history"</span> into <span className="text-brand-600">"verify the product history."</span>
          </p>
        </Reveal>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------- Features */

export function FeatureBento({ limit }: { limit?: number }) {
  const list = limit ? FEATURES.slice(0, limit) : FEATURES;
  return (
    <section className="py-24">
      <div className="container-x">
        <SectionHeading eyebrow="Features & specialities" title={<>Everything you need to make products <span className="text-gradient">provable.</span></>} description="One platform that identifies, verifies, detects, explains and responds — across every company in your supply chain." />
        <motion.div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3" variants={stagger(0.07)} initial="hidden" whileInView="show" viewport={{ once: true, margin: "-60px" }}>
          {list.map((f, i) => (
            <motion.article
              key={f.title}
              variants={fadeUp}
              className={cn(
                "group relative overflow-hidden rounded-3xl border border-ink-200 bg-white p-7 shadow-soft transition-all duration-500 hover:-translate-y-1 hover:border-brand-200 hover:shadow-lift",
                i === 0 && "lg:col-span-2",
              )}
            >
              <div aria-hidden className="absolute -right-16 -top-16 h-40 w-40 rounded-full bg-brand-100 opacity-0 blur-2xl transition-opacity duration-700 group-hover:opacity-100" />
              <div className="relative flex items-start gap-5">
                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-brand-50 text-brand-600 ring-1 ring-brand-100 transition-transform duration-500 group-hover:scale-110 group-hover:rotate-3">
                  <f.icon className="h-5 w-5" />
                </div>
                {i === 0 && (
                  <div className="ml-auto hidden items-center gap-3 rounded-2xl bg-ink-50 px-4 py-3 ring-1 ring-ink-200 sm:flex">
                    <TrustRing score={100} size={56} stroke={6} label={false} />
                    <div className="text-xs">
                      <p className="font-semibold text-ink-900">Batch A92</p>
                      <p className="text-ink-500">8 / 8 verified</p>
                    </div>
                  </div>
                )}
              </div>
              <h3 className="relative mt-5 text-lg font-bold text-ink-900">{f.title}</h3>
              <p className="relative mt-2 text-sm leading-relaxed text-ink-600">{f.text}</p>
              <ul className="relative mt-5 space-y-2">
                {f.points.map((p) => (
                  <li key={p} className="flex items-center gap-2 text-sm text-ink-700">
                    <Check className="h-4 w-4 text-brand-500" strokeWidth={2.5} />
                    {p}
                  </li>
                ))}
              </ul>
            </motion.article>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

/* --------------------------------------------------- Three experiences */

function ExperiencePreview({ k }: { k: string }) {
  if (k === "consumer")
    return (
      <div className="mx-auto w-full max-w-xs rounded-[2rem] bg-ink-900 p-2 shadow-lift">
        <div className="rounded-[1.6rem] bg-ink-50 p-4">
          <div className="rounded-2xl bg-bad-600 p-4 text-white">
            <p className="text-[10px] font-bold uppercase tracking-wider text-white/80">⚠ Recalled</p>
            <p className="mt-1 text-sm font-bold">Identity verified, but this product has been recalled.</p>
          </div>
          <div className="mt-3 rounded-2xl bg-white p-3 ring-1 ring-ink-200">
            <p className="text-xs font-bold text-ink-900">Glucora Insulin Pen</p>
            <p className="text-[11px] text-ink-500">ABC Pharma · Batch C7</p>
            <p className="mt-2 text-[11px] text-ink-600">Potency below specification in stability testing.</p>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[10px] font-semibold">
            {["Identity ✓", "History ✓", "Proof ✓"].map((t) => (
              <div key={t} className="rounded-lg bg-white py-2 text-ink-700 ring-1 ring-ink-200">
                {t}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  if (k === "admin")
    return (
      <div className="rounded-2xl border border-ink-200 bg-white p-4 shadow-lift">
        <div className="grid grid-cols-3 gap-3">
          {[["Organizations", "128"], ["Verifications 24h", "4,812"], ["Open incidents", "3"]].map(([l, v]) => (
            <div key={l} className="rounded-xl bg-ink-50 p-3 ring-1 ring-ink-200">
              <p className="text-[10px] text-ink-500">{l}</p>
              <p className="font-display text-lg font-bold text-ink-900">{v}</p>
            </div>
          ))}
        </div>
        <div className="mt-3 space-y-2">
          {[["NovaMed Distributors", "Pending approval", "warn"], ["Shadow Pharma Traders", "Identity collision", "bad"], ["SwiftLogix", "Verified", "ok"]].map(([n, s, t]) => (
            <div key={n} className="flex items-center justify-between rounded-xl px-3 py-2 ring-1 ring-ink-200">
              <span className="text-xs font-semibold text-ink-800">{n}</span>
              <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", t === "ok" ? "bg-ok-50 text-ok-700" : t === "bad" ? "bg-bad-50 text-bad-700" : "bg-warn-50 text-warn-700")}>{s}</span>
            </div>
          ))}
        </div>
      </div>
    );
  return (
    <div className="rounded-2xl border border-ink-200 bg-white p-4 shadow-lift">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-ink-900">Incoming custody transfers</p>
        <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-bold text-brand-700">2 pending</span>
      </div>
      <div className="mt-3 space-y-2">
        {[["OrigiVax · Batch A92", "from ABC Pharma"], ["Aero X1 Earbuds", "from XYZ Electronics"]].map(([p, f]) => (
          <div key={p} className="flex items-center justify-between rounded-xl px-3 py-2.5 ring-1 ring-ink-200">
            <div>
              <p className="text-xs font-semibold text-ink-900">{p}</p>
              <p className="text-[11px] text-ink-500">{f}</p>
            </div>
            <div className="flex gap-1.5">
              <span className="rounded-lg bg-ink-100 px-2 py-1 text-[10px] font-semibold text-ink-600">Reject</span>
              <span className="rounded-lg bg-brand-500 px-2 py-1 text-[10px] font-semibold text-white">Accept</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Experiences() {
  const [active, setActive] = useState<string>("org");
  const current = EXPERIENCES.find((e) => e.key === active)!;
  return (
    <section className="bg-white py-24">
      <div className="container-x">
        <SectionHeading eyebrow="Three experiences, one network" title={<>Built for the people who <span className="text-gradient">make, move and buy</span> products.</>} />
        <div className="mt-12 grid items-center gap-10 lg:grid-cols-[1fr_1.1fr]">
          <div className="space-y-3">
            {EXPERIENCES.map((e) => (
              <button
                key={e.key}
                onClick={() => setActive(e.key)}
                className={cn("w-full rounded-3xl border p-5 text-left transition-all duration-500", active === e.key ? "border-brand-300 bg-brand-50/60 shadow-soft" : "border-ink-200 bg-white hover:border-ink-300")}
                aria-pressed={active === e.key}
              >
                <div className="flex items-center gap-4">
                  <div className={cn("grid h-11 w-11 place-items-center rounded-2xl transition-colors duration-500", active === e.key ? "bg-brand-500 text-white" : "bg-ink-100 text-ink-600")}>
                    <e.icon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="font-display text-lg font-bold text-ink-900">{e.title}</p>
                    <p className="text-sm text-ink-500">{e.who}</p>
                  </div>
                </div>
                <AnimatePresence initial={false}>
                  {active === e.key && (
                    <motion.ul initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.45, ease: easeOutExpo }} className="grid gap-2 overflow-hidden pl-[3.75rem] pt-4 sm:grid-cols-2">
                      {e.points.map((p) => (
                        <li key={p} className="flex items-center gap-2 text-sm text-ink-700">
                          <Check className="h-4 w-4 text-brand-500" /> {p}
                        </li>
                      ))}
                    </motion.ul>
                  )}
                </AnimatePresence>
              </button>
            ))}
          </div>
          <div className="relative min-h-[340px] rounded-[2rem] bg-gradient-to-br from-brand-100 via-ink-50 to-white p-6 sm:p-10">
            <AnimatePresence mode="wait">
              <motion.div key={current.key} initial={{ opacity: 0, y: 20, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -12, scale: 0.97 }} transition={{ duration: 0.5, ease: easeOutExpo }}>
                <ExperiencePreview k={current.key} />
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------- Why choose us */

function Mark({ value }: { value: boolean | "partial" }) {
  if (value === true)
    return (
      <span className="mx-auto grid h-7 w-7 place-items-center rounded-full bg-ok-500 text-white" aria-label="Yes">
        <Check className="h-4 w-4" strokeWidth={3} />
      </span>
    );
  if (value === "partial")
    return (
      <span className="mx-auto grid h-7 w-7 place-items-center rounded-full bg-warn-100 text-warn-700" aria-label="Partially">
        <Minus className="h-4 w-4" strokeWidth={3} />
      </span>
    );
  return (
    <span className="mx-auto grid h-7 w-7 place-items-center rounded-full bg-ink-100 text-ink-400" aria-label="No">
      <X className="h-4 w-4" strokeWidth={3} />
    </span>
  );
}

export function WhyChoose() {
  return (
    <section className="py-24">
      <div className="container-x">
        <SectionHeading eyebrow="Why choose ORIGINX" title={<>Not just tracking. <span className="text-gradient">Trust infrastructure.</span></>} description="Tracking tools record what someone says happened. ORIGINX proves it, detects when it's wrong, explains why — and acts." />
        <Reveal className="mt-12 overflow-hidden rounded-3xl border border-ink-200 bg-white shadow-soft">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-ink-200">
                  <th className="px-6 py-5 text-left font-semibold text-ink-500">Capability</th>
                  {COMPARISON.columns.map((c, i) => (
                    <th key={c} className={cn("px-4 py-5 text-center font-display text-base font-bold", i === 0 ? "bg-brand-50 text-brand-700" : "text-ink-700")}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {COMPARISON.rows.map(([label, a, b, c]) => (
                  <tr key={label} className="transition-colors hover:bg-ink-50/70">
                    <td className="px-6 py-4 font-medium text-ink-800">{label}</td>
                    <td className="bg-brand-50/50 px-4 py-4">
                      <Mark value={a} />
                    </td>
                    <td className="px-4 py-4">
                      <Mark value={b} />
                    </td>
                    <td className="px-4 py-4">
                      <Mark value={c} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ------------------------------------------------------- Privacy strip */

export function PrivacyStrip() {
  return (
    <section className="bg-white py-24">
      <div className="container-x grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
        <SectionHeading align="left" eyebrow="Security & privacy" title={<>Privacy by design. <span className="text-gradient">Proof by default.</span></>} description="ORIGINX proves product history without exposing your business or your customers." />
        <motion.div className="grid gap-4 sm:grid-cols-2" variants={stagger(0.08)} initial="hidden" whileInView="show" viewport={{ once: true, margin: "-60px" }}>
          {PRIVACY_POINTS.map((p) => (
            <motion.div key={p.title} variants={fadeUp} className="rounded-3xl border border-ink-200 bg-ink-50/60 p-6">
              <p.icon className="h-5 w-5 text-brand-600" />
              <h3 className="mt-4 font-bold text-ink-900">{p.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-600">{p.text}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- Pricing */

export function PricingGrid() {
  return (
    <motion.div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4" variants={stagger(0.08)} initial="hidden" whileInView="show" viewport={{ once: true, margin: "-60px" }}>
      {PLANS.map((p) => (
        <motion.div
          key={p.name}
          variants={fadeUp}
          className={cn("relative flex flex-col rounded-3xl border p-7 transition-all duration-500 hover:-translate-y-1", p.featured ? "border-brand-400 bg-ink-900 text-white shadow-glow" : "border-ink-200 bg-white shadow-soft hover:shadow-lift")}
        >
          {p.featured && <span className="absolute -top-3 left-7 rounded-full bg-brand-500 px-3 py-1 text-xs font-bold text-white">Most popular</span>}
          <p className={cn("font-display text-lg font-bold", p.featured ? "text-white" : "text-ink-900")}>{p.name}</p>
          <p className={cn("mt-1 text-sm", p.featured ? "text-ink-300" : "text-ink-500")}>{p.tagline}</p>
          <p className="mt-6 font-display text-4xl font-extrabold">
            {p.price}
            {p.period && <span className={cn("ml-1 text-sm font-medium", p.featured ? "text-ink-300" : "text-ink-500")}>/ {p.period}</span>}
          </p>
          <div className={cn("mt-5 space-y-1 border-y py-4 text-sm font-semibold", p.featured ? "border-white/10" : "border-ink-100")}>
            {p.limits.map((l) => (
              <p key={l}>{l}</p>
            ))}
          </div>
          <ul className="mt-5 flex-1 space-y-2.5">
            {p.features.map((f) => (
              <li key={f} className={cn("flex items-start gap-2 text-sm", p.featured ? "text-ink-200" : "text-ink-700")}>
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" /> {f}
              </li>
            ))}
          </ul>
          <Link to={p.name === "Free" ? "/sign-up" : "/contact"} className={buttonClass(p.featured ? "primary" : "secondary", "lg", "mt-7 w-full")}>
            {p.cta}
          </Link>
        </motion.div>
      ))}
    </motion.div>
  );
}

export function PricingTeaser() {
  return (
    <section className="py-24">
      <div className="container-x">
        <SectionHeading eyebrow="Pricing" title={<>Start free. <span className="text-gradient">Scale with your network.</span></>} description="Consumers always verify for free. Organizations pay for the products and people they manage." />
        <div className="mt-14">
          <PricingGrid />
        </div>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------- FAQ */

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section className="bg-white py-24">
      <div className="container-x grid gap-12 lg:grid-cols-[0.8fr_1.2fr]">
        <SectionHeading align="left" eyebrow="FAQ" title="Questions, answered." description={<>Still curious? <Link to="/contact" className="font-semibold text-brand-600 hover:underline">Talk to our team</Link>.</>} />
        <div className="divide-y divide-ink-200 rounded-3xl border border-ink-200 bg-ink-50/40">
          {FAQ.map(([q, a], i) => (
            <div key={q}>
              <button className="flex w-full items-center justify-between gap-6 px-6 py-5 text-left" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
                <span className="font-semibold text-ink-900">{q}</span>
                <ChevronDown className={cn("h-5 w-5 shrink-0 text-ink-400 transition-transform duration-500", open === i && "rotate-180 text-brand-500")} />
              </button>
              <AnimatePresence initial={false}>
                {open === i && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.4, ease: easeOutExpo }} className="overflow-hidden">
                    <p className="px-6 pb-6 text-sm leading-relaxed text-ink-600">{a}</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------- Final CTA */

export function FinalCta() {
  return (
    <section className="px-4 py-24">
      <Reveal className="relative mx-auto max-w-6xl overflow-hidden rounded-[2.5rem] bg-gradient-to-br from-brand-500 via-brand-600 to-brand-700 px-6 py-16 text-center text-white shadow-glow sm:px-16">
        <div aria-hidden className="absolute inset-0 opacity-20 [background-image:radial-gradient(white_1px,transparent_1px)] [background-size:22px_22px]" />
        <div aria-hidden className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-white/20 blur-3xl" />
        <div className="relative">
          <h2 className="mx-auto max-w-3xl text-3xl font-extrabold leading-tight sm:text-5xl">Give every product an identity it can prove.</h2>
          <p className="mx-auto mt-5 max-w-xl text-lg text-white/85">Set up your organization in minutes. Your first products can be verifiable today.</p>
          <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
            <Link to="/sign-up" className={buttonClass("dark", "lg", "group")}>
              Create your organization <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
            <Link to="/verify" className={buttonClass("secondary", "lg", "border-white/30 bg-white/10 text-white hover:bg-white/20")}>
              <ScanLine className="h-4 w-4" /> Verify a product
            </Link>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
