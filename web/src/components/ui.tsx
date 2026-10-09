import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from "lucide-react";
import { Link } from "react-router";
import { cn } from "@/lib/format";

/* ---------------------------------------------------------------- Logo */

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn("h-8 w-8", className)} aria-hidden>
      <rect width="64" height="64" rx="16" fill="#F25C05" />
      <circle cx="32" cy="32" r="15" fill="none" stroke="#fff" strokeWidth="6" />
      <path d="M32 17v30M17 32h30" stroke="#fff" strokeWidth="3" strokeLinecap="round" opacity=".55" />
      <circle cx="32" cy="32" r="5" fill="#fff" />
    </svg>
  );
}

export function Logo({ className, to = "/", inverted }: { className?: string; to?: string; inverted?: boolean }) {
  return (
    <Link to={to} className={cn("group inline-flex items-center gap-2.5", className)} aria-label="ORIGINX home">
      <LogoMark className="transition-transform duration-500 ease-[var(--ease-out-expo)] group-hover:rotate-90" />
      <span className={cn("font-display text-[1.15rem] font-extrabold tracking-tight", inverted ? "text-white" : "text-fg")}>
        ORIGIN<span className="text-brand-500">X</span>
      </span>
    </Link>
  );
}

/* -------------------------------------------------------------- Button */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "dark";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  icon?: ReactNode;
};

const buttonBase =
  "relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-xl font-semibold transition-all duration-200 ease-[var(--ease-out-expo)] disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]";
const buttonVariants = {
  primary: "bg-brand-500 text-white shadow-[0_8px_20px_-8px_rgb(242_92_5/0.65)] hover:bg-brand-600 hover:shadow-[0_12px_28px_-10px_rgb(242_92_5/0.75)]",
  secondary: "border border-line bg-surface text-fg shadow-soft hover:border-ink-300 hover:bg-surface-2",
  ghost: "text-fg hover:bg-surface-2",
  danger: "bg-bad-600 text-white hover:bg-bad-700",
  dark: "bg-ink-900 text-white hover:bg-ink-800",
};
const buttonSizes = { sm: "h-8 px-3 text-sm", md: "h-10 px-4 text-sm", lg: "h-12 px-6 text-[0.95rem]" };

export const buttonClass = (variant: ButtonProps["variant"] = "primary", size: ButtonProps["size"] = "md", className?: string) =>
  cn(buttonBase, buttonVariants[variant], buttonSizes[size], className);

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, icon, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} className={buttonClass(variant, size, className)} disabled={disabled || loading} {...rest}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

/* -------------------------------------------------------------- Inputs */

const fieldBase =
  "w-full rounded-xl border border-line bg-surface px-3.5 text-sm text-fg placeholder:text-muted/70 shadow-[inset_0_1px_0_rgb(0_0_0/0.02)] transition focus:border-brand-400 focus:outline-none focus:ring-4 focus:ring-brand-500/15 disabled:opacity-60 aria-[invalid=true]:border-bad-500 aria-[invalid=true]:ring-bad-500/10";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cn(fieldBase, "h-11", className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cn(fieldBase, "min-h-24 py-3", className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <select ref={ref} className={cn(fieldBase, "h-11 appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%237a6d61%22 stroke-width=%222.5%22><path d=%22m6 9 6 6 6-6%22/></svg>')] bg-[right_0.9rem_center] bg-no-repeat pr-9", className)} {...rest}>
      {children}
    </select>
  );
});

export function Field({ label, error, hint, children, className, required }: { label: string; error?: string; hint?: string; children: (id: string) => ReactNode; className?: string; required?: boolean }) {
  const id = useId();
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-sm font-medium text-fg">
        {label}
        {required && <span className="ml-0.5 text-brand-500">*</span>}
      </label>
      {children(id)}
      {error ? <p className="text-xs font-medium text-bad-600">{error}</p> : hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

/* --------------------------------------------------------------- Card */

export function Card({ className, children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("rounded-2xl border border-line bg-surface shadow-soft", className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ title, description, action, className }: { title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-start justify-between gap-4 border-b border-line px-5 py-4", className)}>
      <div className="min-w-0">
        <h3 className="text-[0.95rem] font-semibold text-fg">{title}</h3>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/* -------------------------------------------------------------- Badges */

export type Tone = "neutral" | "brand" | "ok" | "warn" | "bad" | "info";
const toneClass: Record<Tone, string> = {
  neutral: "bg-surface-2 text-muted ring-line",
  brand: "bg-brand-50 text-brand-700 ring-brand-200 dark:bg-brand-500/10 dark:text-brand-300 dark:ring-brand-500/30",
  ok: "bg-ok-50 text-ok-700 ring-ok-100 dark:bg-ok-500/10 dark:text-ok-500 dark:ring-ok-500/30",
  warn: "bg-warn-50 text-warn-700 ring-warn-100 dark:bg-warn-500/10 dark:text-warn-500 dark:ring-warn-500/30",
  bad: "bg-bad-50 text-bad-700 ring-bad-100 dark:bg-bad-500/10 dark:text-bad-500 dark:ring-bad-500/30",
  info: "bg-sky-50 text-sky-700 ring-sky-100 dark:bg-sky-500/10 dark:text-sky-400 dark:ring-sky-500/30",
};

export function Badge({ tone = "neutral", children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset", toneClass[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

/** Maps every status string used by the API to a tone. */
export function toneFor(value: string | null | undefined): Tone {
  const v = (value ?? "").toUpperCase();
  if (["VERIFIED", "ACTIVE", "AUTHENTIC", "HISTORY_VERIFIED", "CONFIRMED", "EXCELLENT", "TRUSTED", "VALID", "ACCEPTED", "TRANSFER_ACCEPTED", "RESOLVED", "COMPLETED", "LOW", "DELIVERED", "ANCHORED", "CLOSED"].includes(v)) return "ok";
  if (["PENDING", "SUSPICIOUS", "CAUTION", "REQUESTED", "TRANSFER_REQUESTED", "INVESTIGATING", "MEDIUM", "PARTIALLY_ANCHORED", "PENDING_ANCHOR", "DRAFT", "IN_PROGRESS", "NEW", "UNAVAILABLE"].includes(v)) return "warn";
  if (["RECALLED", "COUNTERFEIT", "HISTORY_COMPROMISED", "SUSPENDED", "REJECTED", "HIGH_RISK", "TAMPERED", "BROKEN_LINK", "AFFECTED", "FAILED", "MISMATCH", "CRITICAL", "HIGH", "QUARANTINED", "OPEN", "TRANSFER_REJECTED", "REVOKED", "INITIATED", "HASH_MISMATCH", "CONTENT_MISMATCH", "NOT_ON_CHAIN", "COMPROMISED", "POTENTIAL_COUNTERFEIT"].includes(v)) return "bad";
  if (["ARCHIVED", "CANCELLED", "TRANSFER_CANCELLED", "DISMISSED", "UNKNOWN", "NOT_ANCHORED", "UNANCHORED"].includes(v)) return "neutral";
  return "info";
}

export function StatusBadge({ value, className }: { value: string | null | undefined; className?: string }) {
  return (
    <Badge tone={toneFor(value)} dot className={className}>
      {(value ?? "—").replace(/^TRANSFER_/, "").replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}
    </Badge>
  );
}

/* --------------------------------------------------------- Feedback UI */

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("h-5 w-5 animate-spin text-brand-500", className)} aria-label="Loading" />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton h-4", className)} />;
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon && <div className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-500/10">{icon}</div>}
      <h3 className="text-base font-semibold text-fg">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <XCircle className="h-8 w-8 text-bad-500" />
      <p className="max-w-md text-sm text-muted">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function Alert({ tone = "info", title, children, className }: { tone?: "info" | "ok" | "warn" | "bad"; title?: string; children?: ReactNode; className?: string }) {
  const Icon = tone === "ok" ? CheckCircle2 : tone === "bad" ? XCircle : tone === "warn" ? AlertTriangle : Info;
  return (
    <div className={cn("flex gap-3 rounded-xl px-4 py-3 text-sm ring-1 ring-inset", toneClass[tone], className)} role={tone === "bad" ? "alert" : "status"}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(title && "mt-0.5", "opacity-90")}>{children}</div>}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- Modal */

export function Modal({ open, onClose, title, description, children, footer, size = "md" }: { open: boolean; onClose: () => void; title: string; description?: string; children: ReactNode; footer?: ReactNode; size?: "md" | "lg" }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const previous = document.activeElement as HTMLElement | null;
    setTimeout(() => panel.current?.querySelector<HTMLElement>("input,select,textarea,button")?.focus(), 50);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-ink-950/45 backdrop-blur-[2px]" onClick={onClose} />
          <motion.div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className={cn("relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-3xl border border-line bg-surface shadow-lift sm:rounded-2xl", size === "lg" ? "sm:max-w-2xl" : "sm:max-w-lg")}
            initial={{ y: 40, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 30, opacity: 0, scale: 0.98 }}
            transition={{ type: "spring", damping: 28, stiffness: 320 }}
          >
            <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold text-fg">{title}</h2>
                {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
              </div>
              <button onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-fg" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="overflow-y-auto px-5 py-5">{children}</div>
            {footer && <div className="flex justify-end gap-2 border-t border-line bg-surface-2/50 px-5 py-3.5">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ---------------------------------------------------------------- Tabs */

export function Tabs<T extends string>({ value, onChange, tabs, className }: { value: T; onChange: (v: T) => void; tabs: Array<{ value: T; label: ReactNode }>; className?: string }) {
  const layoutId = useId();
  return (
    <div role="tablist" className={cn("flex gap-1 overflow-x-auto rounded-xl bg-surface-2 p-1", className)}>
      {tabs.map((t) => (
        <button key={t.value} role="tab" aria-selected={value === t.value} onClick={() => onChange(t.value)} className={cn("relative whitespace-nowrap rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors", value === t.value ? "text-fg" : "text-muted hover:text-fg")}>
          {value === t.value && <motion.span layoutId={layoutId} className="absolute inset-0 rounded-lg bg-surface shadow-soft" transition={{ type: "spring", damping: 30, stiffness: 400 }} />}
          <span className="relative">{t.label}</span>
        </button>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------- Table */

export function Table({ head, children, className }: { head: ReactNode[]; children: ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead>
          <tr className="border-b border-line text-xs font-semibold uppercase tracking-wide text-muted">
            {head.map((h, i) => (
              <th key={i} className="px-5 py-3 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({ children, className, colSpan }: { children?: ReactNode; className?: string; colSpan?: number }) {
  return (
    <td colSpan={colSpan} className={cn("px-5 py-3.5 align-middle text-fg", className)}>
      {children}
    </td>
  );
}

export function Pagination({ page, pageCount, onPage }: { page: number; pageCount: number; onPage: (p: number) => void }) {
  if (pageCount <= 1) return null;
  return (
    <div className="flex items-center justify-between border-t border-line px-5 py-3 text-sm text-muted">
      <span>
        Page {page} of {pageCount}
      </span>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button variant="secondary" size="sm" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- Page header */

export function PageHeader({ title, description, actions, eyebrow }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-brand-600">{eyebrow}</div>}
        <h1 className="text-2xl font-bold text-fg sm:text-[1.7rem]">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, hint, icon, tone = "neutral" }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode; tone?: Tone }) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <p className="text-sm font-medium text-muted">{label}</p>
        {icon && <div className={cn("grid h-9 w-9 place-items-center rounded-xl ring-1 ring-inset", toneClass[tone])}>{icon}</div>}
      </div>
      <p className="mt-2 font-display text-3xl font-bold tracking-tight text-fg">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </Card>
  );
}

/* --------------------------------------------------------------- Toast */

type ToastItem = { id: number; tone: "ok" | "bad" | "info"; message: string };
const ToastContext = createContext<(tone: ToastItem["tone"], message: string) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((tone: ToastItem["tone"], message: string) => {
    const id = Date.now() + Math.random();
    setItems((list) => [...list, { id, tone, message }]);
    setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), 4500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:right-4 sm:items-end" aria-live="polite">
        <AnimatePresence>
          {items.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40 }}
              className="pointer-events-auto flex max-w-sm items-start gap-2.5 rounded-xl border border-line bg-surface px-4 py-3 text-sm text-fg shadow-lift"
            >
              {t.tone === "ok" ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-ok-600" /> : t.tone === "bad" ? <XCircle className="mt-0.5 h-4 w-4 text-bad-600" /> : <Info className="mt-0.5 h-4 w-4 text-brand-500" />}
              <span>{t.message}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

/* ------------------------------------------------------------ Copy hash */

export function CopyText({ value, display, className }: { value: string; display?: ReactNode; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={value}
      onClick={() => {
        navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        });
      }}
      className={cn("hash inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-muted transition hover:bg-surface-2 hover:text-fg", className)}
    >
      {copied ? <span className="text-ok-600">copied</span> : (display ?? value)}
    </button>
  );
}
