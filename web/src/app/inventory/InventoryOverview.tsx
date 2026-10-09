import { useState } from "react";
import { Link } from "react-router";
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Boxes, ClipboardCheck, PackagePlus, PackageSearch, RefreshCcw, ShieldAlert, Truck } from "lucide-react";
import { Alert, Badge, Button, Card, CardHeader, EmptyState, ErrorState, Field, Modal, PageHeader, Skeleton, Stat, StatusBadge, Table, Td, Textarea, buttonClass } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { formatDate, formatDateTime, humanize, timeAgo } from "@/lib/format";
import type { Discrepancy, InventoryAlerts, InventorySummary, InventoryTx } from "@/lib/types";
import { useOrgMutation, useOrgQuery } from "../hooks";
import { MovementModal, Qty } from "./shared";

export function MovementRows({ items }: { items: InventoryTx[] }) {
  return (
    <>
      {items.map((t) => {
        const signed = t.entries.reduce((acc, e) => (e.bucket === "ON_HAND" ? acc + Number(e.delta) : acc), 0);
        return (
          <tr key={t.id}>
            <Td className="whitespace-nowrap text-muted">{formatDateTime(t.createdAt)}</Td>
            <Td>
              <StatusBadge value={t.type} />
            </Td>
            <Td>
              <span className="block font-medium text-fg">{t.sku?.sku ?? "—"}</span>
              <span className="hash text-muted">{t.batch ? `Batch ${t.batch.batchCode}` : "No batch"}</span>
            </Td>
            <Td className="font-semibold">
              <Qty value={t.quantity} unit={t.unitOfMeasure} className={signed > 0 ? "text-ok-700" : signed < 0 ? "text-bad-700" : undefined} />
            </Td>
            <Td className="text-muted">
              {t.fromLocation && `${t.fromLocation.warehouse.code}/${t.fromLocation.code}`}
              {t.fromLocation && t.toLocation && " → "}
              {t.toLocation && `${t.toLocation.warehouse.code}/${t.toLocation.code}`}
              {!t.fromLocation && !t.toLocation && "—"}
            </Td>
            <Td className="text-muted">
              {t.shipment ? (
                <Link to={`/app/shipments/${t.shipment.id}`} className="hash font-medium text-brand-600 hover:underline">
                  {t.shipment.reference}
                </Link>
              ) : (
                <span className="line-clamp-2 max-w-xs">{t.reason ?? "—"}</span>
              )}
            </Td>
            <Td className="text-muted">{t.actorName}</Td>
          </tr>
        );
      })}
    </>
  );
}

function ResolveModal({ d, onClose }: { d: Discrepancy | null; onClose: () => void }) {
  const [note, setNote] = useState("");
  const m = useOrgMutation((status: string) => api.patch(`/inventory/discrepancies/${d!.id}`, { status, note }), { success: "Discrepancy updated", onSuccess: onClose });
  return (
    <Modal
      open={Boolean(d)}
      onClose={onClose}
      title="Review discrepancy"
      description={d?.message}
      footer={
        <>
          <Button variant="secondary" disabled={note.trim().length < 3} loading={m.isPending && m.variables === "ACKNOWLEDGED"} onClick={() => m.mutate("ACKNOWLEDGED")}>
            Acknowledge
          </Button>
          <Button disabled={note.trim().length < 3} loading={m.isPending && m.variables === "RESOLVED"} onClick={() => m.mutate("RESOLVED")}>
            Mark resolved
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Alert tone="info">Discrepancies are never fixed silently. If stock needs correcting, record an audited adjustment, then resolve this with a note.</Alert>
        <Field label="Note" required>
          {(id) => <Textarea id={id} rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was found and what was done" />}
        </Field>
      </div>
    </Modal>
  );
}

export default function InventoryOverview() {
  const can = useCan();
  const [moving, setMoving] = useState(false);
  const [reviewing, setReviewing] = useState<Discrepancy | null>(null);
  const summary = useOrgQuery(["inventory", "summary"], () => api.get<InventorySummary>("/inventory/summary"));
  const alerts = useOrgQuery(["inventory", "alerts"], () => api.get<InventoryAlerts>("/inventory/alerts"));
  const reconcile = useOrgMutation(() => api.post<{ consistent: boolean; findings: unknown[]; balancesChecked: number }>("/inventory/reconcile"), {
    success: (r) => (r.consistent ? `Ledger and balances match (${r.balancesChecked} balances checked)` : `${r.findings.length} discrepancies found — see below`),
  });
  const s = summary.data;
  const a = alerts.data;

  return (
    <>
      <PageHeader
        title="Inventory"
        description="Stock you hold, where it is, and how it connects to each product's verified history."
        actions={
          <>
            {can("inventory:adjust") && (
              <Button variant="secondary" icon={<ClipboardCheck className="h-4 w-4" />} loading={reconcile.isPending} onClick={() => reconcile.mutate(undefined)}>
                Reconcile
              </Button>
            )}
            {can("shipments:manage") && (
              <Link to="/app/shipments/new" className={buttonClass("secondary")}>
                <Truck className="h-4 w-4" /> New shipment
              </Link>
            )}
            {(can("inventory:receive") || can("inventory:adjust")) && (
              <Button icon={<PackagePlus className="h-4 w-4" />} onClick={() => setMoving(true)}>
                Record movement
              </Button>
            )}
          </>
        }
      />

      {summary.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32 rounded-2xl" />
          ))}
        </div>
      ) : summary.isError ? (
        <Card>
          <ErrorState message={errorMessage(summary.error)} onRetry={() => summary.refetch()} />
        </Card>
      ) : s ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Active SKUs" value={s.activeSkus} hint={`${s.trackedBatches} batches tracked`} icon={<Boxes className="h-4 w-4" />} tone="brand" />
            <Stat label="Incoming shipments" value={s.incomingShipments} hint="Dispatched to you, awaiting receipt" icon={<ArrowDownToLine className="h-4 w-4" />} tone="info" />
            <Stat label="Outgoing shipments" value={s.outgoingShipments} hint="Not yet fully received" icon={<ArrowUpFromLine className="h-4 w-4" />} tone="info" />
            <Stat label="Needs attention" value={s.lowStockSkus + s.openDiscrepancies + s.heldBalances} hint={`${s.lowStockSkus} low stock · ${s.heldBalances} held · ${s.openDiscrepancies} discrepancies`} icon={<AlertTriangle className="h-4 w-4" />} tone={s.lowStockSkus + s.openDiscrepancies + s.heldBalances ? "warn" : "ok"} />
          </div>

          <Card className="mt-4">
            <CardHeader title="Stock totals" description="Grouped by unit of measure — different units are never added together." />
            {s.totalsByUnit.length ? (
              <Table head={["Unit", "On hand", "Reserved", "Available", "Quarantined", "Damaged"]}>
                {s.totalsByUnit.map((u) => (
                  <tr key={u.unitOfMeasure}>
                    <Td className="font-semibold">{u.unitOfMeasure}</Td>
                    <Td>
                      <Qty value={u.onHand} />
                    </Td>
                    <Td>
                      <Qty value={u.reserved} />
                    </Td>
                    <Td className="font-semibold text-ok-700">
                      <Qty value={u.available} />
                    </Td>
                    <Td className="text-warn-700">
                      <Qty value={u.quarantined} />
                    </Td>
                    <Td className="text-bad-700">
                      <Qty value={u.damaged} />
                    </Td>
                  </tr>
                ))}
              </Table>
            ) : (
              <EmptyState icon={<PackageSearch className="h-5 w-5" />} title="No stock recorded yet" description="Create a warehouse, add SKUs, then record your first receipt or opening balance." action={<Link to="/app/warehouses" className={buttonClass("primary")}>Set up warehouses</Link>} />
            )}
          </Card>
        </>
      ) : null}

      {a && (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Alerts" description={`Expiring within ${a.parameters.expiringWithinDays} days · incoming older than ${a.parameters.unconfirmedAfterDays} days`} />
            <ul className="divide-y divide-line">
              {a.lowStock.map((l) => (
                <li key={l.skuId} className="flex items-center gap-3 px-5 py-3 text-sm">
                  <Badge tone="warn">Low stock</Badge>
                  <span className="flex-1 text-fg">
                    {l.sku} · {l.name}
                  </span>
                  <span className="text-muted">
                    <Qty value={l.available} unit={l.unitOfMeasure} /> / threshold {l.threshold}
                  </span>
                </li>
              ))}
              {a.expiring.map((b) => (
                <li key={b.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                  <Badge tone={b.expired ? "bad" : "warn"}>{b.expired ? "Expired" : "Expiring"}</Badge>
                  <span className="flex-1 text-fg">
                    {b.sku?.sku} · Batch {b.batch?.batchCode} · {b.location?.warehouse?.code}/{b.location?.code}
                  </span>
                  <span className="text-muted">{formatDate(b.batch?.expiryDate)}</span>
                </li>
              ))}
              {a.unconfirmedIncoming.map((sh) => (
                <li key={sh.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                  <Badge tone="info">Unconfirmed</Badge>
                  <Link to={`/app/shipments/${sh.id}`} className="hash flex-1 font-medium text-brand-600 hover:underline">
                    {sh.reference}
                  </Link>
                  <span className="text-muted">dispatched {timeAgo(sh.dispatchedAt)}</span>
                </li>
              ))}
              {a.heldStock.map((b) => (
                <li key={b.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                  <Badge tone="bad">Held</Badge>
                  <span className="flex-1 text-fg">
                    {b.sku?.sku} · Batch {b.batch?.batchCode ?? "—"} {b.batch?.holdStatus && b.batch.holdStatus !== "NONE" ? `(${humanize(b.batch.holdStatus)})` : ""}
                  </span>
                  <Qty value={b.quarantined} unit={b.unitOfMeasure} />
                </li>
              ))}
              {!a.lowStock.length && !a.expiring.length && !a.unconfirmedIncoming.length && !a.heldStock.length && <li className="px-5 py-10 text-center text-sm text-muted">No alerts. Low-stock alerts appear once you set reorder thresholds on SKUs.</li>}
            </ul>
          </Card>

          <Card>
            <CardHeader title="Discrepancies" description="Shortages, damage, losses and ledger mismatches needing review" />
            {a.discrepancies.length ? (
              <ul className="divide-y divide-line">
                {a.discrepancies.map((d) => (
                  <li key={d.id} className="flex items-start gap-3 px-5 py-3 text-sm">
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-bad-600" />
                    <div className="min-w-0 flex-1">
                      <p className="text-fg">{d.message}</p>
                      <p className="text-xs text-muted">
                        {humanize(d.type)} · {timeAgo(d.createdAt)}
                      </p>
                    </div>
                    {can("inventory:adjust") && (
                      <Button size="sm" variant="secondary" onClick={() => setReviewing(d)}>
                        Review
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={<RefreshCcw className="h-5 w-5" />} title="No open discrepancies" description="Run Reconcile to re-check every balance against the ledger." />
            )}
          </Card>
        </div>
      )}

      {s && s.recentMovements.length > 0 && (
        <Card className="mt-4">
          <CardHeader
            title="Recent movements"
            action={
              <Link to="/app/inventory/movements" className="text-sm font-semibold text-brand-600 hover:underline">
                Full history →
              </Link>
            }
          />
          <Table head={["When", "Type", "Item", "Quantity", "Location", "Reference", "By"]}>
            <MovementRows items={s.recentMovements} />
          </Table>
        </Card>
      )}

      <MovementModal open={moving} onClose={() => setMoving(false)} />
      <ResolveModal d={reviewing} onClose={() => setReviewing(null)} />
    </>
  );
}
