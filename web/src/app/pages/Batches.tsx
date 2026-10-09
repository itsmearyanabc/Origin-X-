import { useState } from "react";
import { Link } from "react-router";
import { Boxes, Fingerprint, Plus, ShieldAlert, ShieldCheck } from "lucide-react";
import { Alert, Badge, Button, Card, CardHeader, EmptyState, ErrorState, Field, Input, Modal, PageHeader, Select, Skeleton, StatusBadge, Table, Td, Textarea } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAuth, useCan } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import type { Balance, BatchRow } from "@/lib/types";
import { useOrgMutation, useOrgQuery } from "../hooks";
import { Qty, useSkus } from "../inventory/shared";

function CreateBatch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const skus = useSkus();
  const [form, setForm] = useState({ batchCode: "", skuId: "", manufacturedAt: "", expiryDate: "", plannedQuantity: "" });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const m = useOrgMutation(
    async () => {
      const batch = await api.post<{ id: string }>("/batches", { batchCode: form.batchCode, manufacturedAt: form.manufacturedAt || undefined, expiryDate: form.expiryDate || undefined });
      if (form.skuId) await api.patch(`/batches/${batch.id}`, { skuId: form.skuId, plannedQuantity: form.plannedQuantity || null });
      return batch;
    },
    {
      success: "Batch created",
      onSuccess: () => {
        setForm({ batchCode: "", skuId: "", manufacturedAt: "", expiryDate: "", plannedQuantity: "" });
        onClose();
      },
    },
  );
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New batch"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!form.batchCode.trim()} loading={m.isPending} onClick={() => m.mutate(undefined)}>
            Create batch
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Batch number" required>
          {(id) => <Input id={id} className="hash" value={form.batchCode} onChange={set("batchCode")} />}
        </Field>
        <Field label="SKU">
          {(id) => (
            <Select id={id} value={form.skuId} onChange={set("skuId")}>
              <option value="">Not linked yet</option>
              {skus.data?.filter((s) => s.owned).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.sku}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Manufactured">{(id) => <Input id={id} type="date" value={form.manufacturedAt} onChange={set("manufacturedAt")} />}</Field>
        <Field label="Expiry" hint="Leave empty if the product does not expire">
          {(id) => <Input id={id} type="date" value={form.expiryDate} onChange={set("expiryDate")} />}
        </Field>
        <Field label="Planned quantity" className="sm:col-span-2">
          {(id) => <Input id={id} inputMode="decimal" value={form.plannedQuantity} onChange={set("plannedQuantity")} disabled={!form.skuId} />}
        </Field>
      </div>
    </Modal>
  );
}

function BatchModal({ batch, onClose }: { batch: BatchRow | null; onClose: () => void }) {
  const { activeOrgId } = useAuth();
  const can = useCan();
  const skus = useSkus();
  const [hold, setHold] = useState("");
  const stock = useOrgQuery(["batch-inventory", batch?.id], () => api.get<Balance[]>(`/batches/${batch!.id}/inventory`), { enabled: Boolean(batch) });
  const update = useOrgMutation((body: Record<string, unknown>) => api.patch(`/batches/${batch!.id}`, body), { success: "Batch updated" });
  const passport = useOrgMutation(() => api.post(`/batches/${batch!.id}/passport`, {}), { success: "Batch passport created and anchored", onSuccess: onClose });
  const placeHold = useOrgMutation((status: "QUARANTINED" | "NONE") => api.post(`/batches/${batch!.id}/hold`, { status, reason: hold }), { success: "Hold updated", onSuccess: onClose });
  if (!batch) return null;
  const owned = batch.organizationId === activeOrgId;
  const sku = skus.data?.find((s) => s.id === batch.skuId);
  return (
    <Modal open={Boolean(batch)} onClose={onClose} size="lg" title={`Batch ${batch.batchCode}`} description={`${sku ? `${sku.sku} · ${sku.name}` : "No SKU linked"} · made ${formatDate(batch.manufacturedAt)} · expires ${formatDate(batch.expiryDate)}`}>
      <div className="space-y-5">
        <div className="flex flex-wrap gap-2">
          <StatusBadge value={batch.qualityStatus === "APPROVED" ? "VERIFIED" : batch.qualityStatus} />
          {batch.holdStatus !== "NONE" && <StatusBadge value={batch.holdStatus} />}
          {batch.passportProductId && (
            <Link to={`/app/products/${batch.passportProductId}`} className="inline-flex items-center gap-1 text-sm font-semibold text-brand-600 hover:underline">
              <Fingerprint className="h-4 w-4" /> Digital Product Passport
            </Link>
          )}
        </div>

        {owned && can("catalogue:manage") && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="SKU">
              {(id) => (
                <Select id={id} value={batch.skuId ?? ""} onChange={(e) => update.mutate({ skuId: e.target.value || null })}>
                  <option value="">Not linked</option>
                  {skus.data?.filter((s) => s.owned).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.sku}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Quality status" hint="Approval is recorded on the batch passport">
              {(id) => (
                <Select id={id} value={batch.qualityStatus} onChange={(e) => update.mutate({ qualityStatus: e.target.value })}>
                  {["PENDING", "APPROVED", "REJECTED"].map((q) => (
                    <option key={q} value={q}>
                      {q}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        )}

        {owned && !batch.passportProductId && batch.skuId && can("products:create") && (
          <Alert tone="info" title="No batch passport yet">
            Create one to give this batch an on-chain identity and record its shipments in a verifiable history.
            <div className="mt-3">
              <Button size="sm" loading={passport.isPending} icon={<Fingerprint className="h-4 w-4" />} onClick={() => passport.mutate(undefined)}>
                Create batch passport
              </Button>
            </div>
          </Alert>
        )}

        <div>
          <p className="mb-2 text-sm font-semibold text-fg">Your stock of this batch</p>
          {stock.data?.length ? (
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-line">
                  {stock.data.map((b) => (
                    <tr key={b.id}>
                      <td className="hash px-3 py-2">
                        {b.location?.warehouse?.code}/{b.location?.code}
                      </td>
                      <td className="px-3 py-2">
                        on hand <Qty value={b.onHand} unit={b.unitOfMeasure} />
                      </td>
                      <td className="px-3 py-2 text-warn-700">
                        held <Qty value={b.quarantined} />
                      </td>
                      <td className="px-3 py-2 text-bad-700">
                        damaged <Qty value={b.damaged} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted">No stock of this batch at your locations.</p>
          )}
        </div>

        {owned && can("inventory:quarantine") && batch.holdStatus !== "RECALLED" && (
          <div className="rounded-2xl border border-dashed border-line p-4">
            <p className="flex items-center gap-2 font-semibold text-fg">
              {batch.holdStatus === "QUARANTINED" ? <ShieldCheck className="h-4 w-4 text-ok-600" /> : <ShieldAlert className="h-4 w-4 text-bad-600" />}
              {batch.holdStatus === "QUARANTINED" ? "Lift brand hold" : "Place brand-wide quarantine hold"}
            </p>
            <p className="mt-1 text-sm text-muted">
              {batch.holdStatus === "QUARANTINED" ? "Holders release their quarantined stock themselves after inspection." : "Quarantines every recorded unit of this batch at every holder and releases reservations. Recorded on the passport."}
            </p>
            <div className="mt-3 flex gap-2">
              <Textarea rows={1} value={hold} onChange={(e) => setHold(e.target.value)} placeholder="Reason" aria-label="Hold reason" />
              <Button variant={batch.holdStatus === "QUARANTINED" ? "secondary" : "danger"} disabled={hold.trim().length < 3} loading={placeHold.isPending} onClick={() => placeHold.mutate(batch.holdStatus === "QUARANTINED" ? "NONE" : "QUARANTINED")}>
                {batch.holdStatus === "QUARANTINED" ? "Lift" : "Hold"}
              </Button>
            </div>
          </div>
        )}
        {batch.holdStatus === "RECALLED" && <Alert tone="bad">This batch is under recall. Its stock cannot be dispatched except as a recall return to the brand.</Alert>}
      </div>
    </Modal>
  );
}

export default function Batches() {
  const can = useCan();
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const list = useOrgQuery(["batches", "all"], () => api.page<BatchRow>("/batches", { pageSize: 100 }));
  const skus = useSkus();
  const batch = list.data?.items.find((b) => b.id === selected) ?? null;
  return (
    <>
      <PageHeader
        title="Batches"
        description="Batch quality, holds, expiry and stock — linked to SKUs and batch passports."
        actions={
          can("products:create") && (
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
              New batch
            </Button>
          )
        }
      />
      <Card>
        <CardHeader title="Your batches" />
        {list.isLoading ? (
          <Skeleton className="m-5 h-40" />
        ) : list.isError ? (
          <ErrorState message={errorMessage(list.error)} />
        ) : list.data?.items.length ? (
          <Table head={["Batch", "SKU", "Manufactured", "Expiry", "Planned", "Quality", "Hold", "Passport"]}>
            {list.data.items.map((b) => {
              const sku = skus.data?.find((s) => s.id === b.skuId);
              const expired = b.expiryDate && new Date(b.expiryDate) < new Date();
              return (
                <tr key={b.id} className="cursor-pointer transition hover:bg-surface-2" onClick={() => setSelected(b.id)}>
                  <Td className="hash font-semibold">{b.batchCode}</Td>
                  <Td className="hash text-muted">{sku?.sku ?? "—"}</Td>
                  <Td className="text-muted">{formatDate(b.manufacturedAt)}</Td>
                  <Td className={expired ? "font-semibold text-bad-700" : "text-muted"}>{formatDate(b.expiryDate)}</Td>
                  <Td>
                    <Qty value={b.plannedQuantity} unit={b.unitOfMeasure ?? undefined} />
                  </Td>
                  <Td>
                    <StatusBadge value={b.qualityStatus === "APPROVED" ? "VERIFIED" : b.qualityStatus} />
                  </Td>
                  <Td>{b.holdStatus === "NONE" ? <span className="text-muted">—</span> : <StatusBadge value={b.holdStatus} />}</Td>
                  <Td>{b.passportProductId ? <Badge tone="ok">Yes</Badge> : <span className="text-muted">—</span>}</Td>
                </tr>
              );
            })}
          </Table>
        ) : (
          <EmptyState icon={<Boxes className="h-5 w-5" />} title="No batches yet" />
        )}
      </Card>
      <CreateBatch open={creating} onClose={() => setCreating(false)} />
      <BatchModal batch={batch} onClose={() => setSelected(null)} />
    </>
  );
}
