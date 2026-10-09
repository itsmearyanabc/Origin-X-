import { useState } from "react";
import { Link, useParams } from "react-router";
import { motion } from "motion/react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  Archive,
  ArrowLeft,
  ArrowLeftRight,
  Blocks,
  Bot,
  CalendarPlus,
  Copy,
  Download,
  ExternalLink,
  FlaskConical,
  Fingerprint,
  QrCode,
  RefreshCw,
  Send,
  ShieldCheck,
  Siren,
} from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  CopyText,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Modal,
  Select,
  Skeleton,
  StatusBadge,
  Table,
  Tabs,
  Td,
  Textarea,
  useToast,
} from "@/components/ui";
import { Lifecycle } from "@/components/Lifecycle";
import { TrustRing } from "@/marketing/shared";
import { api, errorMessage } from "@/lib/api";
import { useAuth, useCan } from "@/lib/auth";
import { cn, formatDate, formatDateTime, humanize, shortHash } from "@/lib/format";
import type { CustodyTransfer, HistoryVerification, ProductDetail as Product, ProductEvent, Relationship, Trust, VerificationLog } from "@/lib/types";
import { CHART, useOrgMutation, useOrgQuery } from "../hooks";

const OWNER_EVENTS = ["MANUFACTURED", "QUALITY_APPROVED", "CERTIFICATE_ADDED", "STATUS_CHANGED"];
const CUSTODIAN_EVENTS = ["SHIPMENT_CREATED", "RECEIVED", "WAREHOUSE_RECEIVED", "RETAILER_RECEIVED", "DELIVERED"];
const SHARED_EVENTS = ["DOCUMENT_ADDED"];

type Tab = "passport" | "integrity" | "trust" | "custody" | "incidents" | "scans" | "ask";

/* ------------------------------------------------------------ Modals */

function RecordEventModal({ product, open, onClose }: { product: Product; open: boolean; onClose: () => void }) {
  const types = [...(product.relation.isBrandOwner ? OWNER_EVENTS : []), ...(product.relation.isCurrentCustodian ? CUSTODIAN_EVENTS : []), ...SHARED_EVENTS];
  const [eventType, setEventType] = useState(types[0] ?? "DOCUMENT_ADDED");
  const [location, setLocation] = useState(product.currentLocation ?? "");
  const [note, setNote] = useState("");
  const m = useOrgMutation(() => api.post(`/products/${product.id}/events`, { eventType, location: location || undefined, metadata: note ? { note } : undefined }), {
    success: "Event recorded, hashed and anchored",
    onSuccess: () => {
      setNote("");
      onClose();
    },
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Record lifecycle event"
      description="The server hashes this event, links it to the previous one and anchors it on-chain. It can never be edited."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={m.isPending} onClick={() => m.mutate(undefined)}>
            Record event
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Event type">
          {(id) => (
            <Select id={id} value={eventType} onChange={(e) => setEventType(e.target.value)}>
              {types.map((t) => (
                <option key={t} value={t}>
                  {humanize(t)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Location">{(id) => <Input id={id} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="City or facility" />}</Field>
        <Field label="Internal note" hint="Visible to your organization only — never shown publicly.">
          {(id) => <Textarea id={id} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>
        {!product.relation.isCurrentCustodian && <Alert tone="info">Custody events (shipment, receipt, delivery) can only be recorded by the current custodian.</Alert>}
      </div>
    </Modal>
  );
}

function TransferModal({ product, open, onClose }: { product: Product; open: boolean; onClose: () => void }) {
  const { activeOrgId } = useAuth();
  const rels = useOrgQuery(["relationships", "ACCEPTED"], () => api.get<Relationship[]>("/organizations/current/relationships", { status: "ACCEPTED" }), { enabled: open });
  const partners = Array.from(
    new Map(
      (rels.data ?? []).map((r) => {
        const other = r.sourceOrganizationId === activeOrgId ? r.target : r.source;
        return [other.id, other];
      }),
    ).values(),
  );
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const m = useOrgMutation(() => api.post("/custody-transfers", { productId: product.id, toOrganizationId: to, note: note || undefined }), {
    success: "Transfer requested — waiting for the receiver to accept",
    onSuccess: onClose,
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Transfer custody"
      description="Custody only moves when the receiving organization accepts. Until then you remain the custodian."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!to} loading={m.isPending} onClick={() => m.mutate(undefined)}>
            Request transfer
          </Button>
        </>
      }
    >
      {rels.isLoading ? (
        <Skeleton className="h-11" />
      ) : partners.length ? (
        <div className="space-y-4">
          <Field label="Receiving partner">
            {(id) => (
              <Select id={id} value={to} onChange={(e) => setTo(e.target.value)}>
                <option value="">Select a partner…</option>
                {partners.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {humanize(p.organizationType ?? "")}
                    {p.verificationStatus === "VERIFIED" ? " ✓" : ""}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Note for the receiver">{(id) => <Textarea id={id} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
        </div>
      ) : (
        <EmptyState title="No partners yet" description="You can only transfer custody to an accepted supply-chain partner." action={<Link to="/app/partners" className="font-semibold text-brand-600">Find partners →</Link>} />
      )}
    </Modal>
  );
}

function QrModal({ product, open, onClose }: { product: Product; open: boolean; onClose: () => void }) {
  const qr = useOrgQuery(["qr", product.id], () => api.get<{ token: string; url: string; pngDataUrl: string }>(`/products/${product.id}/qr`), { enabled: open });
  const toast = useToast();
  return (
    <Modal open={open} onClose={onClose} title="Verification QR code" description="Print this on the product or its packaging. Anyone can scan it — no app needed.">
      {qr.data ? (
        <div className="space-y-5 text-center">
          <div className="mx-auto inline-block rounded-3xl bg-white p-4 shadow-soft ring-1 ring-ink-200">
            <img src={qr.data.pngDataUrl} alt={`QR code for ${product.productName}`} className="h-56 w-56" />
          </div>
          <div className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2">
            <span className="hash flex-1 truncate text-left text-muted">{qr.data.url}</span>
            <Button
              size="sm"
              variant="ghost"
              icon={<Copy className="h-3.5 w-3.5" />}
              onClick={() => navigator.clipboard?.writeText(qr.data!.url).then(() => toast("ok", "Link copied"))}
            >
              Copy
            </Button>
          </div>
          <div className="flex justify-center gap-2">
            <a href={qr.data.pngDataUrl} download={`originx-${product.productCode}.png`} className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand-500 px-4 text-sm font-semibold text-white hover:bg-brand-600">
              <Download className="h-4 w-4" /> Download PNG
            </a>
            <a href={qr.data.url} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-xl border border-line px-4 text-sm font-semibold text-fg hover:bg-surface-2">
              <ExternalLink className="h-4 w-4" /> Open public page
            </a>
          </div>
        </div>
      ) : qr.isError ? (
        <ErrorState message={errorMessage(qr.error)} />
      ) : (
        <Skeleton className="mx-auto h-56 w-56 rounded-3xl" />
      )}
    </Modal>
  );
}

function RecallModal({ product, open, onClose }: { product: Product; open: boolean; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [initiate, setInitiate] = useState(true);
  const m = useOrgMutation(() => api.post("/recalls", { productId: product.id, reason, initiate }), {
    success: initiate ? "Recall initiated — scans now show RECALLED" : "Recall saved as draft",
    onSuccess: onClose,
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Recall this product"
      description="Initiating marks the product RECALLED, records it in the hash chain and anchors the status on-chain."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" disabled={reason.trim().length < 3} loading={m.isPending} onClick={() => m.mutate(undefined)}>
            {initiate ? "Initiate recall" : "Save draft"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Reason (shown to consumers)" required>
          {(id) => <Textarea id={id} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Potency below specification in stability testing." />}
        </Field>
        <label className="flex items-center gap-3 text-sm text-fg">
          <input type="checkbox" checked={initiate} onChange={(e) => setInitiate(e.target.checked)} className="h-4 w-4 accent-brand-500" />
          Initiate immediately (otherwise saved as a draft)
        </label>
        <Alert tone="warn">Consumers scanning this product will immediately see a RECALLED warning.</Alert>
      </div>
    </Modal>
  );
}

/* --------------------------------------------------------------- Tabs */

function IntegrityTab({ product, verification, onVerify, verifying }: { product: Product; verification?: HistoryVerification; onVerify: () => void; verifying: boolean }) {
  const can = useCan();
  const tamper = useOrgMutation((mode: "naive" | "rewrite") => api.post(`/products/${product.id}/demo/tamper`, { mode }), { success: "Demo tamper applied — run verification to see the result" });
  if (!verification)
    return (
      <Card>
        <EmptyState icon={<ShieldCheck className="h-5 w-5" />} title="Run a full integrity verification" description="Recomputes every hash, checks every link and reads each anchor back from the blockchain." action={<Button loading={verifying} onClick={onVerify}>Verify history</Button>} />
      </Card>
    );
  const v = verification;
  const bc = v.blockchainVerification;
  return (
    <div className="space-y-4">
      <Card className={cn("p-5", v.historyValid ? "" : "border-bad-200 dark:border-bad-500/40")}>
        <div className="flex flex-wrap items-center gap-4">
          <div className={cn("grid h-12 w-12 place-items-center rounded-2xl", v.historyValid ? "bg-ok-50 text-ok-600" : "bg-bad-50 text-bad-600")}>
            <ShieldCheck className="h-6 w-6" />
          </div>
          <div className="flex-1">
            <p className="font-display text-lg font-bold text-fg">{v.historyValid ? "History verified" : "History compromised"}</p>
            <p className="text-sm text-muted">
              {v.verifiedEventCount}/{v.eventCount} events valid · blockchain {humanize(bc.status)} · checked {formatDateTime(v.verificationTimestamp)}
            </p>
          </div>
          <Button variant="secondary" icon={<RefreshCw className="h-4 w-4" />} loading={verifying} onClick={onVerify}>
            Re-verify
          </Button>
        </div>
        {!v.historyValid && (
          <div className="mt-4 grid gap-2 text-sm">
            {v.tamperedEvents.map((t) => (
              <Alert key={t.eventId} tone="bad" title={`Event #${t.sequence} ${humanize(t.eventType)} ${t.detectedBy === "BLOCKCHAIN" ? "does not match its blockchain anchor" : "was modified"}`}>
                <span className="hash block">stored {shortHash(t.storedHash, 10)}</span>
                <span className="hash block">recomputed {shortHash(t.recomputedHash, 10)}</span>
                {t.anchoredHash && <span className="hash block">on-chain {shortHash(t.anchoredHash, 10)}</span>}
              </Alert>
            ))}
            {v.brokenLinks.map((b) => (
              <Alert key={b.eventId} tone="bad" title={`Broken link at event #${b.sequence}`}>
                Previous hash doesn't match the event before it.
              </Alert>
            ))}
            {v.passportIntegrity.mismatchedFields.length > 0 && <Alert tone="bad" title="Sealed passport fields changed">{v.passportIntegrity.mismatchedFields.map(humanize).join(", ")}</Alert>}
            <p className="text-muted">{v.affectedEvents.length} event(s) from #{v.firstCompromisedSequence} onwards can no longer be trusted.</p>
          </div>
        )}
        {bc.reason && <Alert tone="warn" className="mt-4">{bc.reason}</Alert>}
      </Card>

      <Card>
        <CardHeader title="Blockchain proofs" description={`${bc.network}${bc.chainId ? ` · chain ${bc.chainId}` : ""}${bc.contractAddress ? ` · contract ${shortHash(bc.contractAddress, 4)}` : ""}`} />
        <Table head={["Event", "Anchored hash", "Transaction", "Block", "Result"]}>
          {bc.proofs.map((p) => (
            <tr key={`${p.eventId}-${p.anchoredHash}`}>
              <Td>
                <span className="hash text-muted">#{p.sequence}</span> {humanize(p.eventType)}
              </Td>
              <Td>
                <CopyText value={p.anchoredHash} display={shortHash(p.anchoredHash, 6)} />
              </Td>
              <Td>{p.transactionHash ? <CopyText value={p.transactionHash} display={shortHash(p.transactionHash, 6)} /> : <span className="text-muted">—</span>}</Td>
              <Td className="hash text-muted">{p.blockNumber ?? "—"}</Td>
              <Td>
                <StatusBadge value={p.result} />
              </Td>
            </tr>
          ))}
        </Table>
      </Card>

      {can("demo:tamper") && product.relation.isBrandOwner && (
        <Card className="border-dashed p-5">
          <div className="flex flex-wrap items-center gap-4">
            <FlaskConical className="h-5 w-5 text-brand-500" />
            <div className="flex-1">
              <p className="font-semibold text-fg">Demo tools</p>
              <p className="text-sm text-muted">Simulate a database attacker (only available when the server runs in DEMO_MODE). This permanently compromises this product's record.</p>
            </div>
            <Button variant="secondary" size="sm" loading={tamper.isPending && tamper.variables === "naive"} onClick={() => tamper.mutate("naive")}>
              Edit an event
            </Button>
            <Button variant="secondary" size="sm" loading={tamper.isPending && tamper.variables === "rewrite"} onClick={() => tamper.mutate("rewrite")}>
              Rewrite chain
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

function TrustTab({ trust, productId }: { trust: Trust; productId: string }) {
  const history = useOrgQuery(["trust-history", productId], () => api.get<Array<{ score: number; createdAt: string }>>(`/products/${productId}/trust-score/history`));
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.3fr]">
      <Card className="p-6">
        <div className="flex items-center gap-6">
          <TrustRing score={trust.score} size={120} stroke={10} />
          <div>
            <p className="font-display text-2xl font-bold text-fg">{humanize(trust.level)}</p>
            <p className="mt-1 text-sm text-muted">Deterministic score from verified facts. Same facts, same score.</p>
          </div>
        </div>
        <div className="mt-6 h-40">
          {history.data && history.data.length > 1 ? (
            <ResponsiveContainer>
              <AreaChart data={history.data.map((h) => ({ score: h.score, at: formatDate(h.createdAt) }))}>
                <defs>
                  <linearGradient id="trustFill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor={CHART.brand} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={CHART.brand} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="at" hide />
                <YAxis domain={[0, 100]} hide />
                <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} />
                <Area type="monotone" dataKey="score" stroke={CHART.brand} strokeWidth={2.5} fill="url(#trustFill)" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <p className="grid h-full place-items-center text-sm text-muted">Score history appears as the record evolves.</p>
          )}
        </div>
      </Card>
      <Card>
        <CardHeader title="How this score was calculated" />
        <ul className="divide-y divide-line">
          {[...trust.factors, ...trust.penalties.filter((p) => p.applied)].map((f) => (
            <li key={f.code} className="flex items-start gap-3 px-5 py-3">
              <span className={cn("hash mt-0.5 w-10 shrink-0 text-right font-bold", f.points < 0 ? "text-bad-600" : f.applied ? "text-ok-600" : "text-muted line-through")}>
                {f.points > 0 ? `+${f.points}` : f.points}
              </span>
              <span className="min-w-0">
                <span className={cn("block text-sm font-medium", f.applied ? "text-fg" : "text-muted")}>{humanize(f.code)}</span>
                <span className="block text-xs text-muted">{f.reason}</span>
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function AskTab({ productId }: { productId: string }) {
  const [question, setQuestion] = useState("");
  const [chat, setChat] = useState<Array<{ q: string; a: string; source: string }>>([]);
  const ask = useOrgMutation((q: string) => api.post<{ answer: string; source: string }>(`/products/${productId}/ask`, { question: q }), {
    onSuccess: (r) => {
      setChat((c) => [...c, { q: question, a: r.answer, source: r.source }]);
      setQuestion("");
    },
  });
  const suggestions = ["Why is the trust score what it is?", "Has the history been tampered with?", "Where has this product been?", "Is there a recall?"];
  return (
    <Card className="flex min-h-[420px] flex-col">
      <CardHeader title="Ask ORIGINX" description="Answers come only from this product's verified record — never invented." />
      <div className="flex-1 space-y-4 p-5">
        {chat.length === 0 && (
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button key={s} onClick={() => setQuestion(s)} className="rounded-full border border-line px-3 py-1.5 text-sm text-muted transition hover:border-brand-300 hover:text-fg">
                {s}
              </button>
            ))}
          </div>
        )}
        {chat.map((m, i) => (
          <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-2">
            <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-brand-500 px-4 py-2.5 text-sm text-white">{m.q}</p>
            <div className="flex max-w-[90%] gap-2.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-surface-2 text-brand-600">
                <Bot className="h-4 w-4" />
              </span>
              <div className="rounded-2xl rounded-tl-md bg-surface-2 px-4 py-2.5 text-sm text-fg">
                {m.a}
                <p className="mt-1.5 text-[11px] text-muted">{m.source === "ai" ? "AI explanation of verified facts" : "Fact-based answer"}</p>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
      <form
        className="flex gap-2 border-t border-line p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (question.trim().length >= 3) ask.mutate(question.trim());
        }}
      >
        <Input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask about this product…" aria-label="Question" />
        <Button type="submit" loading={ask.isPending} icon={<Send className="h-4 w-4" />} aria-label="Ask" />
      </form>
    </Card>
  );
}

/* --------------------------------------------------------------- Page */

export default function ProductDetail() {
  const { productId = "" } = useParams();
  const can = useCan();
  const [tab, setTab] = useState<Tab>("passport");
  const [modal, setModal] = useState<null | "event" | "transfer" | "qr" | "recall">(null);
  const product = useOrgQuery(["product", productId], () => api.get<Product>(`/products/${productId}`));
  const events = useOrgQuery(["events", productId], () => api.get<ProductEvent[]>(`/products/${productId}/events`));
  const verification = useOrgQuery(["verify", productId], () => api.post<HistoryVerification>(`/products/${productId}/verify-history`), { staleTime: 60_000 });
  const custody = useOrgQuery(["product-custody", productId], () => api.get<CustodyTransfer[]>(`/products/${productId}/custody-transfers`), { enabled: tab === "custody" });
  const scans = useOrgQuery(["product-scans", productId], () => api.page<VerificationLog>(`/products/${productId}/verifications`), { enabled: tab === "scans" && Boolean(product.data?.relation.isBrandOwner) });
  const archive = useOrgMutation(() => api.post(`/products/${productId}/archive`), { success: "Product archived" });

  if (product.isLoading)
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    );
  if (product.isError || !product.data)
    return (
      <Card>
        <ErrorState message={errorMessage(product.error)} onRetry={() => product.refetch()} />
      </Card>
    );

  const p = product.data;
  const v = verification.data;
  const checks = new Map(v?.events.map((c) => [c.eventId, c.status]));
  const chainResults = new Map(v?.blockchainVerification.proofs.map((r) => [r.eventId, r]));
  const quarantined = p.identity && !p.identity.isCanonical;
  const canRecordEvents = can("events:create") && !quarantined && (p.relation.isBrandOwner || p.relation.isCurrentCustodian);
  const canTransfer = can("custody:request") && p.relation.isCurrentCustodian && !["QUARANTINED", "RECALLED", "ARCHIVED", "SUSPENDED", "DELIVERED"].includes(p.status);

  return (
    <>
      <Link to="/app/products" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> Products
      </Link>

      <Card className="overflow-hidden">
        <div className="relative flex flex-col gap-6 p-6 md:flex-row md:items-center">
          <div aria-hidden className="absolute -right-20 -top-20 h-60 w-60 rounded-full bg-brand-100/60 blur-3xl dark:bg-brand-500/10" />
          <TrustRing score={p.trust?.score ?? p.trustScore} size={108} stroke={9} className="relative shrink-0" />
          <div className="relative min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge value={quarantined ? "QUARANTINED" : p.status} />
              {v && <StatusBadge value={v.historyValid ? "VALID" : "COMPROMISED"} />}
              {p.identity && <Badge tone={p.identity.status === "ACTIVE" ? "ok" : "bad"}>Identity {humanize(p.identity.status)}</Badge>}
              {p.relation.isBrandOwner && <Badge tone="brand">Brand owner</Badge>}
              {p.relation.isCurrentCustodian && <Badge tone="info">In your custody</Badge>}
            </div>
            <h1 className="mt-2 text-2xl font-bold text-fg sm:text-3xl">{p.productName}</h1>
            <p className="mt-1 text-sm text-muted">
              <span className="hash">{p.productCode}</span>
              {p.serialNumber && <> · Serial <span className="hash">{p.serialNumber}</span></>}
              {p.batch && <> · Batch {p.batch.batchCode}</>} · by {p.organization.name}
            </p>
          </div>
          <div className="relative flex flex-wrap gap-2">
            {canRecordEvents && (
              <Button icon={<CalendarPlus className="h-4 w-4" />} onClick={() => setModal("event")}>
                Record event
              </Button>
            )}
            {canTransfer && (
              <Button variant="secondary" icon={<ArrowLeftRight className="h-4 w-4" />} onClick={() => setModal("transfer")}>
                Transfer
              </Button>
            )}
            <Button variant="secondary" icon={<QrCode className="h-4 w-4" />} onClick={() => setModal("qr")}>
              QR
            </Button>
            {can("recalls:manage") && p.relation.isBrandOwner && !quarantined && p.status !== "RECALLED" && (
              <Button variant="secondary" icon={<Siren className="h-4 w-4 text-bad-600" />} onClick={() => setModal("recall")}>
                Recall
              </Button>
            )}
            {can("products:archive") && p.relation.isBrandOwner && p.status !== "ARCHIVED" && (
              <Button variant="ghost" icon={<Archive className="h-4 w-4" />} loading={archive.isPending} onClick={() => confirm("Archive this product? It stays verifiable and its history is kept.") && archive.mutate(undefined)} aria-label="Archive" />
            )}
          </div>
        </div>
        <dl className="grid grid-cols-2 border-t border-line text-sm md:grid-cols-4">
          {[
            ["Origin", [p.originLocation, p.originCountry].filter(Boolean).join(", ") || "—"],
            ["Custodian", p.currentOwnerOrganizationId === p.organizationId ? p.organization.name : (p as Product & { currentOwner?: { name: string } }).currentOwner?.name ?? "—"],
            ["Manufactured", formatDate(p.manufacturingDate)],
            ["Expires", formatDate(p.expiryDate)],
          ].map(([k, val]) => (
            <div key={k} className="border-line px-6 py-3.5 [&:not(:last-child)]:border-r">
              <dt className="text-xs text-muted">{k}</dt>
              <dd className="mt-0.5 truncate font-medium text-fg">{val}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {quarantined && (
        <Alert tone="bad" title="Quarantined — potential counterfeit" className="mt-4">
          This registration conflicts with an existing product identity. It is not anchored on-chain and scans show COUNTERFEIT.
        </Alert>
      )}

      <Tabs
        className="mt-6"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "passport", label: "Passport" },
          { value: "integrity", label: "Integrity" },
          { value: "trust", label: "Trust" },
          { value: "custody", label: "Custody" },
          { value: "incidents", label: `Incidents${p.incidents.length ? ` (${p.incidents.length})` : ""}` },
          ...(p.relation.isBrandOwner ? [{ value: "scans" as Tab, label: "Scans" }] : []),
          { value: "ask", label: "Ask ORIGINX" },
        ]}
      />

      <div className="mt-4">
        {tab === "passport" && (
          <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
            <Card>
              <CardHeader title="Lifecycle" description="Hash-linked, append-only history" />
              <div className="p-5">
                {events.isLoading ? (
                  <Skeleton className="h-60" />
                ) : events.data?.length ? (
                  <Lifecycle
                    items={events.data.map((e) => ({
                      key: e.id,
                      sequence: e.sequence,
                      eventType: e.eventType,
                      timestamp: e.timestamp,
                      location: e.location,
                      organization: e.actorOrganization ? { name: e.actorOrganization.name, verified: e.actorOrganization.verificationStatus === "VERIFIED" } : null,
                      eventHash: e.eventHash,
                      integrity: checks.get(e.id) ?? "VALID",
                      chain: chainResults.get(e.id) ? { result: chainResults.get(e.id)!.result, transactionHash: chainResults.get(e.id)!.transactionHash } : e.proof ? { result: e.proof.status === "CONFIRMED" ? "VERIFIED" : e.proof.status, transactionHash: e.proof.transactionHash } : null,
                      extra:
                        typeof e.metadata.note === "string" ? (
                          <p className="mt-2 rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">{e.metadata.note}</p>
                        ) : null,
                    }))}
                  />
                ) : (
                  <EmptyState title="No events" />
                )}
              </div>
            </Card>
            <div className="space-y-4">
              <Card>
                <CardHeader title="Identity" />
                <dl className="space-y-3 p-5 text-sm">
                  <div>
                    <dt className="flex items-center gap-1.5 text-xs text-muted">
                      <Fingerprint className="h-3.5 w-3.5" /> Identity hash
                    </dt>
                    <dd className="mt-1">{p.identity ? <CopyText value={p.identity.identityHash} display={shortHash(p.identity.identityHash, 10)} className="px-0" /> : "—"}</dd>
                  </div>
                  <div>
                    <dt className="flex items-center gap-1.5 text-xs text-muted">
                      <Blocks className="h-3.5 w-3.5" /> On-chain registration
                    </dt>
                    <dd className="mt-1">{p.blockchainIdentity ? <CopyText value={p.blockchainIdentity} display={shortHash(p.blockchainIdentity, 10)} className="px-0" /> : <span className="text-muted">Not anchored</span>}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Public verification</dt>
                    <dd className="mt-1">
                      <a href={`/verify/${p.publicVerificationToken}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-brand-600 hover:underline">
                        Open consumer view <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </dd>
                  </div>
                </dl>
              </Card>
              {p.recalls.length > 0 && (
                <Card>
                  <CardHeader title="Recalls" />
                  <ul className="divide-y divide-line">
                    {p.recalls.map((r) => (
                      <li key={r.id} className="px-5 py-3 text-sm">
                        <StatusBadge value={r.status} />
                        <p className="mt-1.5 text-fg">{r.reason}</p>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
              {p.description && (
                <Card className="p-5 text-sm text-muted">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wider">Description</p>
                  {p.description}
                </Card>
              )}
            </div>
          </div>
        )}

        {tab === "integrity" && <IntegrityTab product={p} verification={v} verifying={verification.isFetching} onVerify={() => verification.refetch()} />}
        {tab === "trust" && p.trust?.factors && <TrustTab trust={p.trust} productId={p.id} />}

        {tab === "custody" && (
          <Card>
            <CardHeader title="Custody transfers" description="Every handoff requires the receiving organization's acceptance." />
            {custody.isLoading ? (
              <Skeleton className="m-5 h-24" />
            ) : custody.data?.length ? (
              <Table head={["From", "To", "Status", "Requested", "Responded"]}>
                {custody.data.map((t) => (
                  <tr key={t.id}>
                    <Td>{t.fromOrg.name}</Td>
                    <Td>{t.toOrg.name}</Td>
                    <Td>
                      <StatusBadge value={t.status} />
                    </Td>
                    <Td className="text-muted">{formatDateTime(t.requestedAt)}</Td>
                    <Td className="text-muted">{formatDateTime(t.respondedAt)}</Td>
                  </tr>
                ))}
              </Table>
            ) : (
              <EmptyState icon={<ArrowLeftRight className="h-5 w-5" />} title="No transfers yet" />
            )}
          </Card>
        )}

        {tab === "incidents" && (
          <Card>
            {p.incidents.length ? (
              <ul className="divide-y divide-line">
                {p.incidents.map((i) => (
                  <li key={i.id} className="flex items-start gap-4 px-5 py-4">
                    <StatusBadge value={i.severity} />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-fg">{i.title}</p>
                      <p className="mt-0.5 text-sm text-muted">{i.description}</p>
                      <p className="mt-1 text-xs text-muted">
                        {humanize(i.type)} · {i.source === "SYSTEM" ? "Detected automatically" : "Reported"} · {formatDateTime(i.createdAt)}
                      </p>
                    </div>
                    <StatusBadge value={i.status} />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={<ShieldCheck className="h-5 w-5" />} title="No incidents" description="Nothing suspicious has been detected for this product." />
            )}
          </Card>
        )}

        {tab === "scans" && (
          <Card>
            <CardHeader title="Verification scans" description="Every public and partner scan. IPs are stored only as anonymous hashes." />
            {scans.data?.items.length ? (
              <Table head={["Time", "Result", "Source", "Scanner (hashed)"]}>
                {scans.data.items.map((s) => (
                  <tr key={s.id}>
                    <Td className="text-muted">{formatDateTime(s.timestamp)}</Td>
                    <Td>
                      <StatusBadge value={s.result} />
                    </Td>
                    <Td className="text-muted">{humanize(s.source)}</Td>
                    <Td className="hash text-muted">{shortHash(s.ipHash ?? "", 5)}</Td>
                  </tr>
                ))}
              </Table>
            ) : (
              <EmptyState title="No scans yet" />
            )}
          </Card>
        )}

        {tab === "ask" && <AskTab productId={p.id} />}
      </div>

      <RecordEventModal product={p} open={modal === "event"} onClose={() => setModal(null)} />
      <TransferModal product={p} open={modal === "transfer"} onClose={() => setModal(null)} />
      <QrModal product={p} open={modal === "qr"} onClose={() => setModal(null)} />
      <RecallModal product={p} open={modal === "recall"} onClose={() => setModal(null)} />
    </>
  );
}
