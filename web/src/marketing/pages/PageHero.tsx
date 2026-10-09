import { useEffect, type ReactNode } from "react";
import { motion } from "motion/react";
import { easeOutExpo } from "../shared";

export function PageHero({ eyebrow, title, description, docTitle, children }: { eyebrow: string; title: ReactNode; description?: ReactNode; docTitle: string; children?: ReactNode }) {
  useEffect(() => {
    document.title = `${docTitle} — ORIGINX`;
  }, [docTitle]);
  return (
    <section className="relative overflow-hidden pb-14 pt-32 sm:pt-40">
      <div aria-hidden className="grid-bg absolute inset-0 [mask-image:radial-gradient(ellipse_at_top,black_25%,transparent_70%)]" />
      <div aria-hidden className="absolute -top-40 left-1/2 h-96 w-[48rem] -translate-x-1/2 rounded-full bg-brand-200/50 blur-[110px]" />
      <div className="container-x relative text-center">
        <motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: easeOutExpo }} className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-600">
          {eyebrow}
        </motion.p>
        <motion.h1 initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease: easeOutExpo, delay: 0.05 }} className="mx-auto mt-4 max-w-4xl text-4xl font-extrabold leading-[1.05] text-ink-900 sm:text-6xl">
          {title}
        </motion.h1>
        {description && (
          <motion.p initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease: easeOutExpo, delay: 0.15 }} className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-ink-600">
            {description}
          </motion.p>
        )}
        {children && (
          <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease: easeOutExpo, delay: 0.25 }} className="mt-8">
            {children}
          </motion.div>
        )}
      </div>
    </section>
  );
}
