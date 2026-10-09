import { useEffect, useRef, type ReactNode } from "react";
import { animate, motion, useInView, useMotionValue, useTransform, type Variants } from "motion/react";
import { cn } from "@/lib/format";

export const easeOutExpo = [0.16, 1, 0.3, 1] as const;

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 28 },
  show: { opacity: 1, y: 0, transition: { duration: 0.8, ease: easeOutExpo } },
};

export const stagger = (delay = 0.08): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren: delay } },
});

/** Fades + lifts children into view once. */
export function Reveal({ children, className, delay = 0, as = "div" }: { children: ReactNode; className?: string; delay?: number; as?: "div" | "section" | "li" }) {
  const Component = motion[as];
  return (
    <Component
      className={className}
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.8, ease: easeOutExpo, delay }}
    >
      {children}
    </Component>
  );
}

export function SectionHeading({ eyebrow, title, description, align = "center", className }: { eyebrow: string; title: ReactNode; description?: ReactNode; align?: "center" | "left"; className?: string }) {
  return (
    <motion.div
      className={cn("max-w-3xl", align === "center" && "mx-auto text-center", className)}
      variants={stagger(0.1)}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "-80px" }}
    >
      <motion.div variants={fadeUp} className={cn("inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-brand-700")}>
        <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
        {eyebrow}
      </motion.div>
      <motion.h2 variants={fadeUp} className="mt-4 text-3xl font-extrabold leading-[1.1] text-ink-900 sm:text-[2.6rem]">
        {title}
      </motion.h2>
      {description && (
        <motion.p variants={fadeUp} className="mt-4 text-base leading-relaxed text-ink-600 sm:text-lg">
          {description}
        </motion.p>
      )}
    </motion.div>
  );
}

/** Counts up to `value` when scrolled into view. */
export function CountUp({ value, suffix = "", className, duration = 1.6 }: { value: number; suffix?: string; className?: string; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const mv = useMotionValue(0);
  const rounded = useTransform(mv, (v) => `${Math.round(v)}${suffix}`);
  useEffect(() => {
    if (!inView) return;
    const controls = animate(mv, value, { duration, ease: easeOutExpo });
    return () => controls.stop();
  }, [inView, mv, value, duration]);
  return (
    <motion.span ref={ref} className={className}>
      {rounded}
    </motion.span>
  );
}

/** Animated trust score ring. */
export function TrustRing({ score, size = 120, stroke = 10, className, label = true, animateIn = true }: { score: number; size?: number; stroke?: number; className?: string; label?: boolean; animateIn?: boolean }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const color = score >= 90 ? "#059669" : score >= 75 ? "#10b981" : score >= 50 ? "#ca8a04" : "#dc2626";
  return (
    <div className={cn("relative inline-grid place-items-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="currentColor" strokeWidth={stroke} fill="none" className="text-ink-100 dark:text-ink-800" />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          initial={animateIn ? { strokeDashoffset: c } : false}
          animate={{ strokeDashoffset: c - (c * Math.max(0, Math.min(100, score))) / 100 }}
          transition={{ duration: 1.4, ease: easeOutExpo }}
        />
      </svg>
      {label && (
        <div className="absolute inset-0 grid place-items-center text-center">
          <div>
            <div className="font-display font-extrabold leading-none text-fg" style={{ fontSize: size * 0.28 }}>
              {score}
            </div>
            <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted">trust</div>
          </div>
        </div>
      )}
    </div>
  );
}
