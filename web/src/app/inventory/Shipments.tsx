import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUpFromLine, Check, Plus, Trash2, Truck, X } from "lucide-react";
import { Alert, Badge, Button, Card, CardHeader, EmptyState, ErrorState, Field, Input, Modal, PageHeader, Pagination, Select, Skeleton, StatusBadge, Table, Tabs, Td, Textarea, buttonClass, useToast } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAuth, useCan } from "@/lib/auth";
import { cn, formatDateTime, humanize } from "@/lib/format";
import type { Balance, Relationship, ShipmentView } from "@/lib/types";
import { useOrgMutation, useOrgQuery } from "../hooks";
import { LocationSelect, Qty, fmtQty, useWarehouses } from "./shared";

const FLOW = ["DRAFT", "RESERVED", "READY_TO_DISPATCH", "DISPATCHED", "PARTIALLY_RECEIVED", "RECEIVED"];

export default function Shipments() {
  const can = useCan();
  const [tab, setTab] = useState<"incoming" | "outgoing">("incoming");
  const [page, setPage] = useState(1);
  const list = useOrgQuery(["shipments", tab, page], () => api.page<ShipmentView>("/shipments", { direction: tab, page, pageSize: 20 }));
  useEffect(() => setPage(1), [tab]);
  return (
    <>
      <PageHeader
        title="Shipments"
        description="Stock moving between your organization and its partners. Every dispatch and receipt is ledgered and recorded on the batch passport."
        actions={
          can("shipments:manage") && (
            <Link to="/app/shipments/new" className={buttonClass("primary")}>
              <Plus className="h-4 w-4" /> New shipment
            </Link>
          )
        }
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "incoming", label: "Incoming" },
          { value: "outgoing", label: "Outgoing" },
        ]}
      />
      <Card className="mt-4">
        {list.isLoading ? (
          <Skeleton className="m-5 h-40" />
        ) : list.isError ? (
          <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />
        ) : list.data?.items.length ? (
          <>
            <Table head={["Reference", tab === "incoming" ? "From" : "To", "Items", "Status", "Dispatched", "Received", ""]}>
              {list.data.items.map((s) => (
                <tr key={s.id} className="transition hover:bg-surface-2">
                  <Td>
                    <Link to={`/app/shipments/${s.id}`} className="hash font-semibold text-fg hover:text-brand-600">
                      {s.reference}
                    </Link>
                    {s.purpose === "RECALL_RETURN" && <Badge tone="bad" className="ml-2">Recall return</Badge>}
                  </Td>
                  <Td>{tab === "incoming" ? s.sender?.name : s.receiver?.name}</Td>
                  <Td className="text-muted">{s.items.length}</Td>
                  <Td>
                    <StatusBadge value={s.status} />
                    {s.hasDiscrepancy && <Badge tone="warn" className="ml-1.5">Discrepancy</Badge>}
                  </Td>
                  <Td className="text-muted">{formatDateTime(s.dispatchedAt)}</Td>
                  <Td className="text-muted">{formatDateTime(s.receivedAt)}</Td>
                  <Td>
                    <Link to={`/app/shipments/${s.id}`} className="text-sm font-semibold text-brand-600">
                      Open →
                    </Link>
                  </Td>
                </tr>
              ))}
            </Table>
            <Pagination page={list.data.meta.page} pageCount={list.data.meta.pageCount} onPage={setPage} />
          </>
        ) : (
          <EmptyState icon={tab === "incoming" ? <ArrowDownToLine className="h-5 w-5" /> : <ArrowUpFromLine className="h-5 w-5" />} title={tab === "incoming" ? "No incoming shipments" : "No outgoing shipments"} />
        )}
      </Card>
    </>
  );
}

/* --------------------------------------------------------------- New */

type Line = { balanceId: string; quantity: string };

export function NewShipment() {
  const { activeOrgId } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const warehouses = useWarehouses();
  const [warehouseId, setWarehouseId] = useState("");
  const [receiver, setReceiver] = useState("");
  const [purpose, setPurpose] = useState<"STANDARD" | "RECALL_RETURN">("STANDARD");
  const [transferCustody, setTransferCustody] = useState(false);
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([{ balanceId: "", quantity: "" }]);
  const [busy, setBusy] = useState<null | "draft" | "reserve" | "dispatch">(null);
  const [error, setError] = useState<string | null>(null);

  const partners = useOrgQuery(["relationships", "ACCEPTED"], () => api.get<Relationship[]>("/organizations/current/relationships", { status: "ACCEPTED" }));
  const balances = useOrgQuery(["inventory", "balances", warehouseId], () => api.page<Balance>("/inventory/balances", { warehouseId, pageSize: 100 }), { enabled: Boolean(warehouseId) });
  const partnerOrgs = useMemo(() => Array.from(new Map((partners.data ?? []).map((r) => { const o = r.sourceOrganizationId === activeOrgId ? r.target : r.source; return [o.id, o]; })).values()), [partners.data, activeOrgId]);
  const eligible = (balances.data?.items ?? []).filter((b) => (purpose === "STANDARD" ? Number(b.available) > 0 && (!b.batch || b.batch.holdStatus === "NONE") : Number(b.quarantined) > 0 && b.batch?.holdStatus === "RECALLED"));
  const byId = new Map(eligible.map((b) => [b.id, b]));

  const submit = async (mode: "draft" | "reserve" | "dispatch") => {
    setError(null);
    setBusy(mode);
    try {
      const items = lines.filter((l) => l.balanceId && l.quantity).map((l) => {
        const b = byId.get(l.balanceId)!;
        return { skuId: b.skuId, batchId: b.batchId, fromLocationId: b.locationId, quantity: l.quantity };
      });
      const created = await api.post<ShipmentView>("/shipments", { receiverOrganizationId: receiver, originWarehouseId: warehouseId, items, notes: notes || undefined, transferCustody, purpose });
      if (mode === "reserve") await api.post(`/shipments/${created.id}/reserve`);
      if (mode === "dispatch") await api.post(`/shipments/${created.id}/dispatch`);
      toast("ok", mode === "dispatch" ? "Shipment dispatched" : mode === "reserve" ? "Stock reserved" : "Draft saved");
      navigate(`/app/shipments/${created.id}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const ready = warehouseId && receiver && lines.some((l) => l.balanceId && Number(l.quantity) > 0);

  return (
    <>
      <Link to="/app/shipments" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> Shipments
      </Link>
      <PageHeader title="New shipment" description="Choose what to send and to whom. Stock is validated and reserved on the server; nothing leaves your balance until dispatch." />
      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Card className="p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Shipment type">
              {(id) => (
                <Select id={id} value={purpose} onChange={(e) => (setPurpose(e.target.value as typeof purpose), setLines([{ balanceId: "", quantity: "" }]))}>
                  <option value="STANDARD">Standard shipment</option>
                  <option value="RECALL_RETURN">Recall return to brand</option>
                </Select>
              )}
            </Field>
            <Field label="Origin warehouse" required>
              {(id) => (
                <Select id={id} value={warehouseId} onChange={(e) => (setWarehouseId(e.target.value), setLines([{ balanceId: "", quantity: "" }]))}>
                  <option value="">Select…</option>
                  {warehouses.data?.filter((w) => w.status === "ACTIVE").map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.code} · {w.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Receiving partner" required className="sm:col-span-2" hint="Only accepted supply-chain partners can receive shipments.">
              {(id) => (
                <Select id={id} value={receiver} onChange={(e) => setReceiver(e.target.value)}>
                  <option value="">Select…</option>
                  {partnerOrgs.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.verificationStatus === "VERIFIED" ? " ✓" : ""}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>

          <p className="mb-2 mt-6 text-sm font-semibold text-fg">Items</p>
          <div className="space-y-2">
            {lines.map((line, i) => {
              const b = byId.get(line.balanceId);
              const max = b ? (purpose === "STANDARD" ? b.available : b.quarantined) : null;
              return (
                <div key={i} className="grid gap-2 rounded-xl border border-line p-3 sm:grid-cols-[1fr_140px_auto]">
                  <Select value={line.balanceId} onChange={(e) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, balanceId: e.target.value } : l)))} disabled={!warehouseId} aria-label="Stock line">
                    <option value="">{warehouseId ? "Select stock…" : "Choose a warehouse first"}</option>
                    {eligible.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.sku?.sku} · {s.batch ? `batch ${s.batch.batchCode}` : "no batch"} · {s.location?.code} · {fmtQty(purpose === "STANDARD" ? s.available : s.quarantined)} {s.unitOfMeasure}
                      </option>
                    ))}
                  </Select>
                  <Input inputMode="decimal" placeholder={max ? `max ${fmtQty(max)}` : "Quantity"} value={line.quantity} onChange={(e) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, quantity: e.target.value } : l)))} aria-label="Quantity" />
                  <Button variant="ghost" icon={<Trash2 className="h-4 w-4" />} onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : ls))} aria-label="Remove line" />
                </div>
              );
            })}
          </div>
          <Button variant="secondary" size="sm" className="mt-3" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setLines((ls) => [...ls, { balanceId: "", quantity: "" }])}>
            Add item
          </Button>
          {warehouseId && !eligible.length && !balances.isLoading && (
            <Alert tone="info" className="mt-4">
              {purpose === "STANDARD" ? "No available, dispatchable stock in this warehouse. Held, recalled or reserved stock cannot be shipped." : "No recalled stock in quarantine here."}
            </Alert>
          )}
        </Card>

        <div className="space-y-4">
          <Card className="space-y-4 p-5">
            <Field label="Notes">{(id) => <Textarea id={id} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Handling instructions, temperature range…" />}</Field>
            {purpose === "STANDARD" && (
              <label className="flex items-start gap-3 text-sm text-fg">
                <input type="checkbox" checked={transferCustody} onChange={(e) => setTransferCustody(e.target.checked)} className="mt-0.5 h-4 w-4 accent-brand-500" />
                <span>
                  Also transfer custody of the batch passports
                  <span className="block text-xs text-muted">Opens custody requests on dispatch. Custody moves only when the receiver accepts — after the full quantity arrives.</span>
                </span>
              </label>
            )}
          </Card>
          {error && <Alert tone="bad">{error}</Alert>}
          <Card className="grid gap-2 p-5">
            <Button disabled={!ready} loading={busy === "dispatch"} icon={<Truck className="h-4 w-4" />} onClick={() => submit("dispatch")}>
              Dispatch now
            </Button>
            {purpose === "STANDARD" && (
              <Button variant="secondary" disabled={!ready} loading={busy === "reserve"} onClick={() => submit("reserve")}>
                Reserve stock, dispatch later
              </Button>
            )}
            <Button variant="ghost" disabled={!ready} loading={busy === "draft"} onClick={() => submit("draft")}>
              Save as draft
            </Button>
          </Card>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------ Detail */

function ReceiveModal({ shipment, open, onClose }: { shipment: ShipmentView; open: boolean; onClose: () => void }) {
  const open_ = shipment.items.filter((i) => Number(i.outstandingQty) > 0);
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [acceptCustody, setAcceptCustody] = useState(true);
  const [rows, setRows] = useState<Record<string, { receivedQty: string; damagedQty: string; missingQty: string }>>(() => Object.fromEntries(open_.map((i) => [i.id, { receivedQty: i.outstandingQty, damagedQty: "", missingQty: "" }])));
  const pendingCustody = (shipment.custodyTransfers ?? []).filter((t) => t.status === "TRANSFER_REQUESTED").length;
  const m = useOrgMutation(
    () => api.post<{ status: string; custody: { acceptedNow: number; note?: string } }>(`/shipments/${shipment.id}/receive`, { locationId: location, notes: notes || undefined, acceptCustody: pendingCustody ? acceptCustody : undefined, items: Object.entries(rows).map(([itemId, r]) => ({ itemId, receivedQty: r.receivedQty || 0, damagedQty: r.damagedQty || 0, missingQty: r.missingQty || 0 })) }),
    { success: (r) => (r.status === "RECEIVED" ? "Shipment fully received" : "Partial receipt recorded"), onSuccess: onClose },
  );
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Receive shipment"
      description="Enter what actually arrived. Damaged goods are booked as damaged; missing quantities are recorded and raise a discrepancy for both sides."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!location} loading={m.isPending} icon={<Check className="h-4 w-4" />} onClick={() => m.mutate(undefined)}>
            Confirm receipt
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <LocationSelect value={location} onChange={setLocation} label="Receive into" required />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted">
                <th className="py-2">Item</th>
                <th>Outstanding</th>
                <th>Received</th>
                <th>Damaged</th>
                <th>Missing</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {open_.map((i) => (
                <tr key={i.id}>
                  <td className="py-2 pr-2">
                    <span className="hash block whitespace-nowrap font-semibold text-fg">{i.sku?.sku}</span>
                    <span className="text-xs text-muted">{i.batch ? `Batch ${i.batch.batchCode}` : "No batch"}</span>
                  </td>
                  <td className="pr-2">
                    <Qty value={i.outstandingQty} unit={i.unitOfMeasure} />
                  </td>
                  {(["receivedQty", "damagedQty", "missingQty"] as const).map((k) => (
                    <td key={k} className="pr-2">
                      <Input inputMode="decimal" className="h-9 w-24" value={rows[i.id]?.[k] ?? ""} onChange={(e) => setRows((r) => ({ ...r, [i.id]: { ...r[i.id], [k]: e.target.value } }))} aria-label={`${k} for ${i.sku?.sku}`} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pendingCustody > 0 && (
          <label className="flex items-start gap-3 text-sm text-fg">
            <input type="checkbox" checked={acceptCustody} onChange={(e) => setAcceptCustody(e.target.checked)} className="mt-0.5 h-4 w-4 accent-brand-500" />
            <span>
              Accept custody of the batch passport{pendingCustody > 1 ? "s" : ""} when everything has arrived
              <span className="block text-xs text-muted">Partial receipts never move custody.</span>
            </span>
          </label>
        )}
        <Field label="Notes">{(id) => <Textarea id={id} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
      </div>
    </Modal>
  );
}

export function ShipmentDetail() {
  const { shipmentId = "" } = useParams();
  const can = useCan();
  const [receiving, setReceiving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [returnLoc, setReturnLoc] = useState("");
  const [reason, setReason] = useState("");
  const q = useOrgQuery(["shipment", shipmentId], () => api.get<ShipmentView>(`/shipments/${shipmentId}`));
  const act = useOrgMutation(({ action, body }: { action: string; body?: unknown }) => api.post(`/shipments/${shipmentId}/${action}`, body), { success: "Shipment updated" });

  if (q.isLoading) return <Skeleton className="h-96 rounded-2xl" />;
  if (q.isError || !q.data) return <Card><ErrorState message={errorMessage(q.error)} /></Card>;
  const s = q.data;
  const outgoing = s.direction === "outgoing";
  const stepIndex = FLOW.indexOf(s.status);
  const terminal = ["CANCELLED", "REJECTED", "RETURNED"].includes(s.status);

  return (
    <>
      <Link to="/app/shipments" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> Shipments
      </Link>
      <PageHeader
        eyebrow={outgoing ? "Outgoing shipment" : "Incoming shipment"}
        title={<span className="hash">{s.reference}</span>}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            {s.sender?.name} <ArrowRight className="h-4 w-4 text-brand-500" /> {s.receiver?.name}
            {s.purpose === "RECALL_RETURN" && <Badge tone="bad">Recall return</Badge>}
          </span>
        }
        actions={
          <>
            {outgoing && can("shipments:manage") && s.status === "DRAFT" && s.purpose === "STANDARD" && (
              <Button variant="secondary" loading={act.isPending} onClick={() => act.mutate({ action: "reserve" })}>
                Reserve stock
              </Button>
            )}
            {outgoing && can("shipments:manage") && s.status === "RESERVED" && (
              <Button variant="secondary" loading={act.isPending} onClick={() => act.mutate({ action: "ready" })}>
                Mark ready
              </Button>
            )}
            {outgoing && can("shipments:manage") && ["DRAFT", "RESERVED", "READY_TO_DISPATCH"].includes(s.status) && (
              <>
                <Button variant="ghost" onClick={() => { const r = prompt("Reason for cancelling?"); if (r && r.trim().length >= 3) act.mutate({ action: "cancel", body: { reason: r } }); }}>
                  Cancel
                </Button>
                <Button icon={<Truck className="h-4 w-4" />} loading={act.isPending} onClick={() => act.mutate({ action: "dispatch" })}>
                  Dispatch
                </Button>
              </>
            )}
            {!outgoing && can("shipments:receive") && ["DISPATCHED", "PARTIALLY_RECEIVED"].includes(s.status) && (
              <>
                {s.status === "DISPATCHED" && (
                  <Button variant="secondary" icon={<X className="h-4 w-4" />} onClick={() => setRejecting(true)}>
                    Reject
                  </Button>
                )}
                <Button icon={<ArrowDownToLine className="h-4 w-4" />} onClick={() => setReceiving(true)}>
                  Receive
                </Button>
              </>
            )}
          </>
        }
      />

      {!terminal ? (
        <Card className="mb-4 overflow-x-auto p-5">
          <ol className="flex min-w-[600px] items-center">
            {FLOW.map((step, i) => (
              <li key={step} className="flex flex-1 items-center">
                <div className="flex flex-col items-center gap-1.5">
                  <span className={cn("grid h-8 w-8 place-items-center rounded-full text-xs font-bold transition-colors", i < stepIndex ? "bg-brand-500 text-white" : i === stepIndex ? "bg-ink-900 text-white ring-4 ring-brand-100 dark:bg-brand-500" : "bg-surface-2 text-muted")}>
                    {i < stepIndex ? <Check className="h-4 w-4" /> : i + 1}
                  </span>
                  <span className={cn("whitespace-nowrap text-[11px] font-semibold", i <= stepIndex ? "text-fg" : "text-muted")}>{humanize(step)}</span>
                </div>
                {i < FLOW.length - 1 && <span className={cn("mx-2 mb-5 h-0.5 flex-1 rounded-full", i < stepIndex ? "bg-brand-500" : "bg-line")} />}
              </li>
            ))}
          </ol>
        </Card>
      ) : (
        <Alert tone={s.status === "RETURNED" ? "info" : "warn"} className="mb-4" title={`Shipment ${humanize(s.status).toLowerCase()}`}>
          {s.notes}
        </Alert>
      )}

      {s.status === "REJECTED" && outgoing && can("shipments:manage") && (
        <Card className="mb-4 flex flex-col gap-3 p-5 sm:flex-row sm:items-end">
          <div className="flex-1">
            <LocationSelect value={returnLoc} onChange={setReturnLoc} label="Book the returned stock into" />
          </div>
          <Button disabled={!returnLoc} loading={act.isPending} onClick={() => act.mutate({ action: "return", body: { locationId: returnLoc } })}>
            Book return
          </Button>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader title="Items" />
          <Table head={["Item", outgoing ? "From" : "", "Requested", "Dispatched", "Received", "Damaged", "Missing", "Outstanding"]}>
            {s.items.map((i) => (
              <tr key={i.id}>
                <Td>
                  <span className="hash block whitespace-nowrap font-semibold text-fg">{i.sku?.sku}</span>
                  <span className="text-xs text-muted">
                    {i.batch ? `Batch ${i.batch.batchCode}` : "No batch"}
                    {i.batch?.passportProductId && (
                      <>
                        {" · "}
                        <Link to={`/app/products/${i.batch.passportProductId}`} className="font-semibold text-brand-600 hover:underline">
                          passport
                        </Link>
                      </>
                    )}
                  </span>
                </Td>
                <Td className="hash text-muted">{outgoing ? i.fromLocation?.code : ""}</Td>
                <Td>
                  <Qty value={i.requestedQty} unit={i.unitOfMeasure} />
                </Td>
                <Td>
                  <Qty value={i.dispatchedQty} />
                </Td>
                <Td className="text-ok-700">
                  <Qty value={i.receivedQty} />
                </Td>
                <Td className="text-bad-700">
                  <Qty value={i.damagedQty} />
                </Td>
                <Td className="text-bad-700">
                  <Qty value={i.missingQty} />
                </Td>
                <Td className="font-semibold">
                  <Qty value={i.outstandingQty} />
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
        <div className="space-y-4">
          <Card className="space-y-2 p-5 text-sm">
            {[
              ["Status", <StatusBadge key="s" value={s.status} />],
              ["Created", formatDateTime(s.createdAt)],
              ["Dispatched", formatDateTime(s.dispatchedAt)],
              ["Received", formatDateTime(s.receivedAt)],
              ["Origin", s.originWarehouse ? [s.originWarehouse.code, s.originWarehouse.city].filter(Boolean).join(" · ") : "—"],
              ["Destination", s.destinationWarehouse ? [s.destinationWarehouse.code, s.destinationWarehouse.city].filter(Boolean).join(" · ") : "—"],
            ].map(([k, v]) => (
              <div key={k as string} className="flex items-center justify-between gap-3">
                <span className="text-muted">{k}</span>
                <span className="text-right font-medium text-fg">{v}</span>
              </div>
            ))}
            {s.hasDiscrepancy && <Alert tone="warn">Damaged or missing quantities were recorded. See Inventory → Discrepancies.</Alert>}
            {s.notes && !terminal && <p className="rounded-xl bg-surface-2 p-3 text-muted">{s.notes}</p>}
          </Card>
          {(s.transferCustody || (s.custodyTransfers ?? []).length > 0) && (
            <Card className="p-5 text-sm">
              <p className="font-semibold text-fg">Passport custody</p>
              <p className="mt-1 text-muted">Shipping stock is not a custody acceptance. Custody requests opened by this shipment:</p>
              <ul className="mt-3 space-y-2">
                {(s.custodyTransfers ?? []).map((t) => (
                  <li key={t.id} className="flex items-center justify-between">
                    <Link to={`/app/products/${t.productId}`} className="font-medium text-brand-600 hover:underline">
                      Batch passport
                    </Link>
                    <StatusBadge value={t.status} />
                  </li>
                ))}
                {!(s.custodyTransfers ?? []).length && <li className="text-muted">Opened at dispatch.</li>}
              </ul>
            </Card>
          )}
        </div>
      </div>

      {receiving && <ReceiveModal shipment={s} open={receiving} onClose={() => setReceiving(false)} />}
      <Modal
        open={rejecting}
        onClose={() => setRejecting(false)}
        title="Reject shipment"
        description="The sender will book the stock back. Any custody requests from this shipment are rejected."
        footer={
          <>
            <Button variant="secondary" onClick={() => setRejecting(false)}>
              Cancel
            </Button>
            <Button variant="danger" disabled={reason.trim().length < 3} loading={act.isPending} onClick={() => act.mutate({ action: "reject", body: { reason } }, { onSuccess: () => setRejecting(false) })}>
              Reject
            </Button>
          </>
        }
      >
        <Field label="Reason" required>
          {(id) => <Textarea id={id} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
      </Modal>
    </>
  );
}
