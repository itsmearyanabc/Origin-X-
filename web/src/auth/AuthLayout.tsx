import { useEffect, useState } from "react";
import { Link, Outlet } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { BadgeCheck, Blocks, Handshake, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/ui";

const SLIDES = [
  { icon: BadgeCheck, title: "Every scan tells the truth", text: "Consumers see verified, recalled or counterfeit — never a misleading green tick." },
  { icon: Handshake, title: "Custody that both sides sign", text: "Ownership only moves when the receiving company accepts it." },
  { icon: Blocks, title: "Proof no one can rewrite", text: "Original hashes are anchored on a blockchain — even a full database rewrite gets caught." },
  { icon: ShieldCheck, title: "Your data stays yours", text: "Strict tenant isolation, and nothing private ever goes on-chain." },
];

export function AuthCard({ title, description, children, footer }: { title: string; description?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode }) {
  useEffect(() => {
    document.title = `${title} — ORIGINX`;
  }, [title]);
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }} className="w-full max-w-md">
      <h1 className="text-[1.75rem] font-extrabold text-ink-900">{title}</h1>
      {description && <p className="mt-2 text-sm leading-relaxed text-ink-600">{description}</p>}
      <div className="mt-8">{children}</div>
      {footer && <div className="mt-8 text-center text-sm text-ink-600">{footer}</div>}
    </motion.div>
  );
}

export default function AuthLayout() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % SLIDES.length), 4500);
    return () => clearInterval(t);
  }, []);
  const slide = SLIDES[i];
  return (
    <div className="grid min-h-screen bg-ink-50 lg:grid-cols-[1fr_minmax(440px,0.85fr)]">
      <div className="flex flex-col px-5 py-6 sm:px-10">
        <div className="flex items-center justify-between">
          <Logo />
          <Link to="/verify" className="text-sm font-semibold text-ink-600 hover:text-brand-600">
            Verify a product →
          </Link>
        </div>
        <div className="flex flex-1 items-center justify-center py-12">
          <Outlet />
        </div>
        <p className="text-center text-xs text-ink-500">
          Protected by tenant isolation and httpOnly sessions ·{" "}
          <Link to="/privacy" className="hover:text-brand-600">
            Privacy
          </Link>{" "}
          ·{" "}
          <Link to="/terms" className="hover:text-brand-600">
            Terms
          </Link>
        </p>
      </div>

      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-brand-500 via-brand-600 to-brand-800 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div aria-hidden className="absolute inset-0 opacity-20 [background-image:radial-gradient(white_1px,transparent_1px)] [background-size:24px_24px]" />
        <motion.div animate={{ x: [0, 40, -20, 0], y: [0, -50, 20, 0] }} transition={{ duration: 15, repeat: Infinity, ease: "linear" }} aria-hidden className="absolute -right-32 -top-32 h-[30rem] w-[30rem] rounded-full bg-white/20 blur-3xl" />
        <motion.div animate={{ x: [0, -40, 30, 0], y: [0, 60, -40, 0] }} transition={{ duration: 18, repeat: Infinity, ease: "linear" }} aria-hidden className="absolute -bottom-40 -left-20 h-[30rem] w-[30rem] rounded-full bg-amber-300/30 blur-3xl" />
        <motion.div animate={{ x: [0, 30, -50, 0], y: [0, -30, 50, 0], scale: [1, 1.2, 1] }} transition={{ duration: 20, repeat: Infinity, ease: "easeInOut" }} aria-hidden className="absolute left-1/4 top-1/3 h-[25rem] w-[25rem] rounded-full bg-orange-400/20 blur-3xl" />

        <div className="relative">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-white/70">ORIGINX</p>
          <p className="mt-4 max-w-sm font-display text-4xl font-extrabold leading-tight">Trust the product history. Then verify it.</p>
        </div>

        {/* Animated chain */}
        <div className="relative my-10 flex items-center justify-center gap-3" aria-hidden>
          {[0, 1, 2, 3, 4].map((n) => (
            <div key={n} className="flex items-center gap-3">
              <motion.div
                className="grid h-14 w-14 place-items-center rounded-2xl bg-white/15 font-mono text-xs font-semibold ring-1 ring-white/30 backdrop-blur"
                animate={{ y: [0, -8, 0], backgroundColor: ["rgba(255,255,255,0.15)", "rgba(255,255,255,0.32)", "rgba(255,255,255,0.15)"] }}
                transition={{ duration: 2.6, repeat: Infinity, delay: n * 0.35, ease: "easeInOut" }}
              >
                #{n + 1}
              </motion.div>
              {n < 4 && <div className="h-0.5 w-4 bg-white/40" />}
            </div>
          ))}
        </div>

        <div className="relative min-h-[140px]">
          <AnimatePresence mode="wait">
            <motion.div key={i} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.5 }} className="rounded-3xl bg-white/10 p-6 ring-1 ring-white/20 backdrop-blur">
              <slide.icon className="h-6 w-6" />
              <p className="mt-3 text-lg font-bold">{slide.title}</p>
              <p className="mt-1 text-sm text-white/80">{slide.text}</p>
            </motion.div>
          </AnimatePresence>
          <div className="mt-5 flex gap-2">
            {SLIDES.map((_, n) => (
              <button key={n} aria-label={`Show slide ${n + 1}`} onClick={() => setI(n)} className={`h-1.5 rounded-full transition-all duration-500 ${n === i ? "w-8 bg-white" : "w-3 bg-white/40"}`} />
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}
