import { useEffect } from "react";
import { Link, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import {
  AlertOctagon,
  AlertTriangle,
  BadgeCheck,
  Blocks,
  Calendar,
  CheckCircle2,
  ExternalLink,
  Fingerprint,
  HelpCircle,
  History,
  MapPin,
  Package,
  RefreshCw,
  ScanLine,
  ShieldAlert,
  ShieldCheck,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { Button, ErrorState, Logo, Skeleton, buttonClass } from "@/components/ui";
import { Lifecycle } from "@/components/Lifecycle";
import { TrustRing } from "@/marketing/shared";
import { api, errorMessage } from "@/lib/api";
import { cn, formatDate, formatDateTime, humanize, shortHash } from "@/lib/format";
import type { PublicState, PublicVerification } from "@/lib/types";

const STATE_UI: Record<PublicState, { icon: LucideIcon; title: string; bg: string; text: string; ring: string }> = {
  HISTORY_VERIFIED: { icon: BadgeCheck, title: "History verified", bg: "from-ok-600 to-ok-500", text: "text-white", ring: "shadow-[0_24px_60px_-24px_rgb(5_150_105/0.75)]" },
  AUTHENTIC: { icon: CheckCircle2, title: "Authentic product", bg: "from-ok-600 to-ok-500", text: "text-white", ring: "shadow-[0_24px_60px_-24px_rgb(5_150_105/0.75)]" },
  RECALLED: { icon: AlertOctagon, title: "⚠ Recalled — do not use", bg: "from-bad-700 to-bad-600", text: "text-white", ring: "shadow-[0_24px_60px_-24px_rgb(220_38_38/0.8)]" },
  COUNTERFEIT: { icon: ShieldAlert, title: "Potential counterfeit", bg: "from-bad-700 to-bad-600", text: "text-white", ring: "shadow-[0_24px_60px_-24px_rgb(220_38_38/0.8)]" },
  HISTORY_COMPROMISED: { icon: XCircle, title: "History compromised", bg: "from-bad-700 to-bad-600", text: "text-white", ring: "shadow-[0_24px_60px_-24px_rgb(220_38_38/0.8)]" },
  SUSPICIOUS: { icon: AlertTriangle, title: "Could not fully verify", bg: "from-warn-500 to-amber-400", text: "text-ink-900", ring: "shadow-[0_24px_60px_-24px_rgb(202_138_4/0.7)]" },
  UNKNOWN: { icon: HelpCircle, title: "Not found", bg: "from-ink-700 to-ink-600", text: "text-white", ring: "shadow-lift" },
};

function Check({ ok, label, detail, icon: Icon }: { ok: boolean | undefined; label: string; detail: string; icon: LucideIcon }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-ink-200 bg-white px-4 py-3">
      <span className={cn("grid h-9 w-9 place-items-center rounded-xl", ok ? "bg-ok-50 text-ok-600" : "bg-bad-50 text-bad-600")}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink-900">{label}</p>
        <p className="truncate text-xs text-ink-500">{detail}</p>
      </div>
      {ok ? <CheckCircle2 className="h-5 w-5 text-ok-600" /> : <XCircle className="h-5 w-5 text-bad-600" />}
    </div>
  );
}

function Section({ title, icon: Icon, children, delay = 0 }: { title: string; icon: LucideIcon; children: React.ReactNode; delay?: number }) {
  return (
    <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay, ease: [0.16, 1, 0.3, 1] }} className="rounded-3xl border border-ink-200 bg-white p-5 shadow-soft sm:p-6">
      <h2 className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-ink-500">
        <Icon className="h-4 w-4 text-brand-500" /> {title}
      </h2>
      {children}
    </motion.section>
  );
}

function ResultView({ v }: { v: PublicVerification }) {
  const ui = STATE_UI[v.state];
  const p = v.passport;
  return (
    <div className="space-y-5">
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        className={cn("relative overflow-hidden rounded-3xl bg-gradient-to-br p-6 sm:p-7", ui.bg, ui.text, ui.ring)}
        role={v.tone === "danger" ? "alert" : "status"}
      >
        <div aria-hidden className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/15 blur-2xl" />
        <div className="relative flex items-start gap-4">
          <motion.div initial={{ scale: 0, rotate: -20 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", delay: 0.2, damping: 12 }} className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white/20 ring-1 ring-white/30">
            <ui.icon className="h-7 w-7" />
          </motion.div>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] opacity-80">{ui.title}</p>
            <p className="mt-1 font-display text-xl font-extrabold leading-snug sm:text-2xl">{v.headline}</p>
            <p className="mt-2 text-sm opacity-90">{v.detail}</p>
          </div>
        </div>
      </motion.div>

      {v.warnings && v.warnings.length > 0 && (
        <div className="space-y-2">
          {v.warnings.map((w) => (
            <div key={w} className="flex gap-3 rounded-2xl border border-warn-100 bg-warn-50 px-4 py-3 text-sm text-warn-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {w}
            </div>
          ))}
        </div>
      )}

      {p?.recall && (
        <Section title="Recall notice" icon={AlertOctagon}>
          <p className="text-sm font-semibold text-bad-700">{humanize(p.recall.status)} · since {formatDate(p.recall.initiatedAt)}</p>
          <p className="mt-2 text-ink-800">{p.recall.reason}</p>
          {p.recall.affectedBatch && <p className="mt-2 text-sm text-ink-500">Affected batch: {p.recall.affectedBatch}</p>}
          <p className="mt-3 text-sm text-ink-600">Stop using this product and contact the seller or {p.brand.name} for instructions.</p>
        </Section>
      )}

      {p && (
        <>
          <Section title="Product" icon={Package} delay={0.05}>
            <div className="flex items-start gap-5">
              <div className="min-w-0 flex-1">
                <h1 className="font-display text-2xl font-extrabold text-ink-900">{p.productName}</h1>
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-ink-600">
                  {p.brand.name}
                  {p.brand.verified ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-ok-50 px-2 py-0.5 text-xs font-semibold text-ok-700">
                      <BadgeCheck className="h-3.5 w-3.5" /> Verified brand
                    </span>
                  ) : (
                    <span className="rounded-full bg-warn-50 px-2 py-0.5 text-xs font-semibold text-warn-700">Unverified organization</span>
                  )}
                </p>
                {p.description && <p className="mt-3 text-sm leading-relaxed text-ink-600">{p.description}</p>}
              </div>
              <TrustRing score={p.trust.score} size={92} stroke={8} className="shrink-0" />
            </div>
            <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
              {[
                ["Product ID", p.productCode],
                ["Batch", p.batch ?? "—"],
                ["Serial", p.serialNumber ?? "—"],
                ["Status", humanize(p.currentStatus)],
              ].map(([k, val]) => (
                <div key={k} className="rounded-xl bg-ink-50 px-3 py-2.5">
                  <dt className="text-xs text-ink-500">{k}</dt>
                  <dd className="mt-0.5 truncate font-semibold text-ink-900">{val}</dd>
                </div>
              ))}
              <div className="col-span-2 flex items-center gap-2 rounded-xl bg-ink-50 px-3 py-2.5">
                <MapPin className="h-4 w-4 text-brand-500" />
                <span className="text-ink-500">Origin</span>
                <span className="ml-auto font-semibold text-ink-900">{[p.origin.location, p.origin.country].filter(Boolean).join(", ") || "—"}</span>
              </div>
              <div className="col-span-2 flex items-center gap-2 rounded-xl bg-ink-50 px-3 py-2.5">
                <Calendar className="h-4 w-4 text-brand-500" />
                <span className="text-ink-500">Made / Expires</span>
                <span className="ml-auto font-semibold text-ink-900">
                  {formatDate(p.manufacturingDate)} / {formatDate(p.expiryDate)}
                </span>
              </div>
            </dl>
            {p.trust.note && <p className="mt-4 rounded-xl bg-bad-50 px-3 py-2.5 text-xs font-medium text-bad-700">{p.trust.note}</p>}
          </Section>

          <Section title="Verification checks" icon={ShieldCheck} delay={0.1}>
            <div className="grid gap-2.5">
              <Check ok={v.identityVerified} icon={Fingerprint} label="Identity" detail={v.identityVerified ? "Matches the original registration" : "Conflicts with an existing product"} />
              <Check ok={v.historyVerified} icon={History} label="History" detail={`${p.integrity.eventsVerified} of ${p.integrity.eventCount} events verified${p.integrity.firstCompromisedEvent ? ` · broken at #${p.integrity.firstCompromisedEvent}` : ""}`} />
              <Check ok={v.blockchainVerified} icon={Blocks} label="Blockchain proof" detail={v.blockchainVerified ? `${p.blockchain.verifiedEvents} anchors match the chain` : humanize(p.blockchain.status)} />
            </div>
          </Section>

          {p.lifecycle.length > 0 && (
            <Section title="Journey" icon={History} delay={0.15}>
              <Lifecycle
                items={p.lifecycle.map((e) => ({
                  key: String(e.sequence),
                  sequence: e.sequence,
                  eventType: e.eventType,
                  timestamp: e.timestamp,
                  location: e.location,
                  organization: e.organization,
                  eventHash: e.eventHash,
                  integrity: e.integrity,
                  chain: e.blockchain,
                }))}
              />
            </Section>
          )}

          <Section title="Blockchain" icon={Blocks} delay={0.2}>
            <dl className="space-y-2 text-sm">
              {[
                ["Network", `${p.blockchain.network}${p.blockchain.chainId ? ` (chain ${p.blockchain.chainId})` : ""}`],
                ["Contract", p.blockchain.contractAddress ? shortHash(p.blockchain.contractAddress, 6) : "—"],
                ["Status", humanize(p.blockchain.status)],
              ].map(([k, val]) => (
                <div key={k} className="flex justify-between gap-4">
                  <dt className="text-ink-500">{k}</dt>
                  <dd className="hash font-medium text-ink-900">{val}</dd>
                </div>
              ))}
              {p.blockchain.identity?.transactionHash && (
                <div className="flex justify-between gap-4">
                  <dt className="text-ink-500">Identity registration</dt>
                  <dd>
                    {p.blockchain.identity.explorerUrl ? (
                      <a className="hash inline-flex items-center gap-1 text-brand-600 hover:underline" href={p.blockchain.identity.explorerUrl} target="_blank" rel="noreferrer">
                        {shortHash(p.blockchain.identity.transactionHash, 6)} <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : (
                      <span className="hash text-ink-900">{shortHash(p.blockchain.identity.transactionHash, 6)}</span>
                    )}
                  </dd>
                </div>
              )}
            </dl>
            <p className="mt-4 text-xs leading-relaxed text-ink-500">Only cryptographic hashes are stored on the blockchain. ORIGINX re-read them for this check.</p>
          </Section>
        </>
      )}

      {v.state === "UNKNOWN" && (
        <div className="rounded-3xl border border-ink-200 bg-white p-6 text-center shadow-soft">
          <p className="text-ink-600">This code doesn't match any ORIGINX product passport. Check that you scanned the ORIGINX QR code, or try entering the code again.</p>
          <Link to="/verify" className={buttonClass("primary", "lg", "mt-5")}>
            <ScanLine className="h-4 w-4" /> Scan again
          </Link>
        </div>
      )}

      <p className="text-center text-xs text-ink-500">
        Checked {formatDateTime(v.verifiedAt)} · <Link to="/contact" className="font-semibold hover:text-brand-600">Report a problem</Link>
      </p>
    </div>
  );
}

export default function VerifyResult() {
  const { token = "" } = useParams();
  const q = useQuery({ queryKey: ["verify", token], queryFn: () => api.public<PublicVerification>("GET", `/verify/${encodeURIComponent(token)}`), staleTime: 0, retry: false });

  useEffect(() => {
    document.title = q.data?.passport ? `${q.data.passport.productName} — ORIGINX verification` : "Product verification — ORIGINX";
  }, [q.data]);

  return (
    <div className="min-h-screen bg-ink-50">
      <div aria-hidden className="fixed -top-40 left-1/2 h-96 w-[40rem] -translate-x-1/2 rounded-full bg-brand-200/40 blur-[100px]" />
      <header className="relative mx-auto flex max-w-2xl items-center justify-between px-5 py-5">
        <Logo />
        <Link to="/verify" className={buttonClass("secondary", "sm")}>
          <ScanLine className="h-4 w-4 text-brand-500" /> Scan another
        </Link>
      </header>
      <main className="relative mx-auto max-w-2xl px-5 pb-16">
        {q.isLoading ? (
          <div className="space-y-4" aria-busy="true" aria-label="Verifying product">
            <div className="rounded-3xl bg-white p-6 shadow-soft">
              <div className="flex items-center gap-4">
                <div className="skeleton h-14 w-14 rounded-2xl" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="w-32" />
                  <Skeleton className="h-6 w-3/4" />
                </div>
              </div>
              <p className="mt-5 text-center text-sm font-medium text-ink-500">Checking identity, history and blockchain proofs…</p>
            </div>
            <Skeleton className="h-40 rounded-3xl" />
            <Skeleton className="h-56 rounded-3xl" />
          </div>
        ) : q.isError ? (
          <div className="rounded-3xl border border-ink-200 bg-white shadow-soft">
            <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
          </div>
        ) : q.data ? (
          <ResultView v={q.data} />
        ) : null}
        {q.isFetched && !q.isError && (
          <div className="mt-6 flex justify-center">
            <Button variant="ghost" size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => q.refetch()} loading={q.isRefetching}>
              Re-verify now
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}
