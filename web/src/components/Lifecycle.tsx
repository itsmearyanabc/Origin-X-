import { motion } from "motion/react";
import { AlertTriangle, BadgeCheck, Blocks, ExternalLink, XCircle } from "lucide-react";
import { cn, formatDateTime, humanize, shortHash } from "@/lib/format";

export type LifecycleItem = {
  key: string;
  sequence: number;
  eventType: string;
  timestamp: string;
  location: string | null;
  organization?: { name: string; role?: string; verified?: boolean } | null;
  eventHash: string;
  integrity: string; // VALID | TAMPERED | BROKEN_LINK | AFFECTED
  chain?: { result: string; transactionHash: string | null; explorerUrl?: string | null } | null;
  extra?: React.ReactNode;
};

const integrityStyle: Record<string, { ring: string; dot: string; label: string }> = {
  VALID: { ring: "ring-ok-100", dot: "bg-ok-500", label: "Hash verified" },
  TAMPERED: { ring: "ring-bad-200", dot: "bg-bad-600", label: "Tampered" },
  BROKEN_LINK: { ring: "ring-bad-200", dot: "bg-bad-600", label: "Broken link" },
  AFFECTED: { ring: "ring-warn-100", dot: "bg-warn-500", label: "After tampering" },
};

export function Lifecycle({ items, compact }: { items: LifecycleItem[]; compact?: boolean }) {
  return (
    <ol className="relative">
      {items.map((e, i) => {
        const style = integrityStyle[e.integrity] ?? integrityStyle.VALID;
        const bad = e.integrity !== "VALID";
        const chainOk = e.chain?.result === "VERIFIED";
        return (
          <motion.li
            key={e.key}
            initial={{ opacity: 0, x: -10 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-20px" }}
            transition={{ duration: 0.5, delay: Math.min(i * 0.05, 0.4), ease: [0.16, 1, 0.3, 1] }}
            className="relative flex gap-4 pb-6 last:pb-0"
          >
            {i < items.length - 1 && <span className={cn("absolute left-[15px] top-8 h-[calc(100%-1.5rem)] w-0.5", bad ? "bg-bad-200 dark:bg-bad-500/40" : "bg-line")} />}
            <span className={cn("relative z-[1] grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface ring-4", style.ring)}>
              {e.integrity === "VALID" ? <BadgeCheck className="h-4 w-4 text-ok-600" /> : e.integrity === "AFFECTED" ? <AlertTriangle className="h-4 w-4 text-warn-600" /> : <XCircle className="h-4 w-4 text-bad-600" />}
            </span>
            <div className={cn("min-w-0 flex-1 rounded-2xl border px-4 py-3", bad ? "border-bad-200 bg-bad-50/60 dark:border-bad-500/30 dark:bg-bad-500/5" : "border-line bg-surface")}>
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <p className="font-semibold text-fg">
                  <span className="hash mr-2 text-muted">#{String(e.sequence).padStart(2, "0")}</span>
                  {humanize(e.eventType)}
                </p>
                <time className="text-xs text-muted" dateTime={e.timestamp}>
                  {formatDateTime(e.timestamp)}
                </time>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
                {e.organization && (
                  <span className="inline-flex items-center gap-1">
                    {e.organization.name}
                    {e.organization.verified && <BadgeCheck className="h-3.5 w-3.5 text-ok-600" aria-label="Verified organization" />}
                  </span>
                )}
                {e.location && <span>· {e.location}</span>}
              </div>
              {!compact && (
                <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[11px]">
                  <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-semibold", bad ? "bg-bad-100 text-bad-700 dark:bg-bad-500/15 dark:text-bad-500" : "bg-ok-50 text-ok-700 dark:bg-ok-500/10 dark:text-ok-500")}>
                    <span className={cn("h-1.5 w-1.5 rounded-full", style.dot)} />
                    {style.label}
                  </span>
                  <span className="hash text-muted" title={e.eventHash}>
                    {shortHash(e.eventHash, 8)}
                  </span>
                  {e.chain && (
                    <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-semibold", chainOk ? "bg-surface-2 text-fg" : e.chain.result === "PENDING" ? "bg-warn-50 text-warn-700" : "bg-bad-100 text-bad-700")}>
                      <Blocks className="h-3 w-3" />
                      {chainOk ? "On-chain" : humanize(e.chain.result)}
                      {e.chain.transactionHash &&
                        (e.chain.explorerUrl ? (
                          <a href={e.chain.explorerUrl} target="_blank" rel="noreferrer" className="hash inline-flex items-center gap-0.5 font-normal text-brand-600 hover:underline">
                            {shortHash(e.chain.transactionHash, 4)} <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : (
                          <span className="hash font-normal text-muted" title={e.chain.transactionHash}>
                            {shortHash(e.chain.transactionHash, 4)}
                          </span>
                        ))}
                    </span>
                  )}
                </div>
              )}
              {e.extra}
            </div>
          </motion.li>
        );
      })}
    </ol>
  );
}
