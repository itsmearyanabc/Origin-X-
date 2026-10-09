import { useState } from "react";
import { Link, useParams } from "react-router";
import { ArrowLeft, Boxes, PackagePlus, Plus, Search } from "lucide-react";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, Field, Input, Modal, PageHeader, Select, Skeleton, StatusBadge, Table, Td, Textarea } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import type { Balance, Sku, SkuStock } from "@/lib/types";
import { useOrgMutation, useOrgQuery } from "../hooks";
import { MovementModal, Qty, UNITS } from "./shared";

function CreateSkuModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form, setForm] = useState({ sku: "", name: "", category: "", brand: "", unitOfMeasure: "PCS", description: "" });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const m = useOrgMutation(() => api.post("/catalogue/skus", Object.fromEntries(Object.entries(form).filter(([, v]) => v.trim()))), {
    success: "SKU added to your catalogue",
    onSuccess: () => {
      setForm({ sku: "", name: "", category: "", brand: "", unitOfMeasure: "PCS", description: "" });
      onClose();
    },
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New SKU"
      description="A SKU describes a kind of product. Each physical unit or batch can still get its own passport."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!form.sku.trim() || form.name.trim().length < 2} loading={m.isPending} onClick={() => m.mutate(undefined)}>
            Create SKU
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="SKU" required>
          {(id) => <Input id={id} className="hash" value={form.sku} onChange={set("sku")} placeholder="OVX-05-DOSE" />}
        </Field>
        <Field label="Unit of measure" hint="Cannot change once stock exists">
          {(id) => (
            <Select id={id} value={form.unitOfMeasure} onChange={set("unitOfMeasure")}>
              {UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Name" required className="sm:col-span-2">
          {(id) => <Input id={id} value={form.name} onChange={set("name")} />}
        </Field>
        <Field label="Category">{(id) => <Input id={id} value={form.category} onChange={set("category")} />}</Field>
        <Field label="Brand">{(id) => <Input id={id} value={form.brand} onChange={set("brand")} />}</Field>
        <Field label="Description" className="sm:col-span-2">
          {(id) => <Textarea id={id} rows={2} value={form.description} onChange={set("description")} />}
        </Field>
      </div>
    </Modal>
  );
}

export default function ProductInventory() {
  const can = useCan();
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const list = useOrgQuery(["inventory", "products", q], () => api.get<SkuStock[]>("/inventory/products", { q }));
  return (
    <>
      <PageHeader
        title="Stock by product"
        description="Every SKU you own or hold, with stock across all your locations."
        actions={
          can("catalogue:manage") && (
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
              New SKU
            </Button>
          )
        }
      />
      <Card>
        <div className="border-b border-line p-4">
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search SKU, name or category" className="pl-10" aria-label="Search SKUs" />
          </div>
        </div>
        {list.isLoading ? (
          <Skeleton className="m-5 h-40" />
        ) : list.isError ? (
          <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />
        ) : list.data?.length ? (
          <Table head={["SKU", "Category", "Batches", "On hand", "Available", "Reserved", "Held / damaged", "Status"]}>
            {list.data.map((s) => (
              <tr key={s.id} className="transition hover:bg-surface-2">
                <Td>
                  <Link to={`/app/inventory/products/${s.id}`} className="block">
                    <span className="hash block font-semibold text-fg hover:text-brand-600">{s.sku}</span>
                    <span className="text-xs text-muted">{s.name}</span>
                  </Link>
                </Td>
                <Td className="text-muted">{s.category ?? "—"}</Td>
                <Td className="text-muted">{s.batchCount}</Td>
                <Td>
                  <Qty value={s.onHand} unit={s.unitOfMeasure} />
                </Td>
                <Td className="font-semibold">
                  <Qty value={s.available} unit={s.unitOfMeasure} className={s.lowStock ? "text-warn-700" : "text-ok-700"} />
                  {s.lowStock && <Badge tone="warn" className="ml-2">Low</Badge>}
                </Td>
                <Td>
                  <Qty value={s.reserved} />
                </Td>
                <Td>
                  <Qty value={s.quarantined} className="text-warn-700" /> / <Qty value={s.damaged} className="text-bad-700" />
                </Td>
                <Td>
                  {s.owned ? <StatusBadge value={s.status} /> : <Badge tone="info">Partner SKU</Badge>}
                </Td>
              </tr>
            ))}
          </Table>
        ) : (
          <EmptyState icon={<Boxes className="h-5 w-5" />} title="No SKUs yet" description="Create SKUs for the products you make or stock." />
        )}
      </Card>
      <CreateSkuModal open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

export function SkuDetail() {
  const { skuId = "" } = useParams();
  const can = useCan();
  const [threshold, setThreshold] = useState("");
  const [moving, setMoving] = useState(false);
  const detail = useOrgQuery(["sku", skuId], () => api.get<{ sku: Sku; owned: boolean; batches: Array<{ id: string; batchCode: string; holdStatus: string; qualityStatus: string; expiryDate: string | null; passportProductId: string | null }>; balances: Balance[]; reorderThreshold: string | null }>(`/catalogue/skus/${skuId}`));
  const setRule = useOrgMutation(() => api.put(`/catalogue/skus/${skuId}/reorder-rule`, { threshold: threshold.trim() === "" ? null : threshold }), { success: "Reorder threshold saved" });
  if (detail.isLoading) return <Skeleton className="h-96 rounded-2xl" />;
  if (detail.isError || !detail.data) return <Card><ErrorState message={errorMessage(detail.error)} /></Card>;
  const { sku, batches, balances } = detail.data;

  return (
    <>
      <Link to="/app/inventory/products" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> Stock by product
      </Link>
      <PageHeader
        eyebrow={<span className="hash">{sku.sku}</span>}
        title={sku.name}
        description={`${sku.category ?? "Uncategorized"} · tracked in ${sku.unitOfMeasure}${detail.data.owned ? "" : " · partner SKU"}`}
        actions={
          (can("inventory:receive") || can("inventory:adjust")) && (
            <Button icon={<PackagePlus className="h-4 w-4" />} onClick={() => setMoving(true)}>
              Record movement
            </Button>
          )
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader title="Stock by location" />
          {balances.length ? (
            <Table head={["Location", "Batch", "On hand", "Available", "Reserved", "Quarantined", "Damaged"]}>
              {balances.map((b) => (
                <tr key={b.id}>
                  <Td className="hash">
                    {b.location?.warehouse?.code}/{b.location?.code}
                  </Td>
                  <Td>
                    {b.batch ? (
                      <>
                        <span className="hash">{b.batch.batchCode}</span>
                        {b.batch.holdStatus !== "NONE" && <StatusBadge value={b.batch.holdStatus} className="ml-2" />}
                      </>
                    ) : (
                      "—"
                    )}
                  </Td>
                  <Td>
                    <Qty value={b.onHand} />
                  </Td>
                  <Td className="font-semibold text-ok-700">
                    <Qty value={b.available} />
                  </Td>
                  <Td>
                    <Qty value={b.reserved} />
                  </Td>
                  <Td className="text-warn-700">
                    <Qty value={b.quarantined} />
                  </Td>
                  <Td className="text-bad-700">
                    <Qty value={b.damaged} />
                  </Td>
                </tr>
              ))}
            </Table>
          ) : (
            <EmptyState title="No stock at your locations" />
          )}
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Batches" />
            <ul className="divide-y divide-line">
              {batches.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center gap-2 px-5 py-3 text-sm">
                  <span className="hash flex-1 font-semibold text-fg">{b.batchCode}</span>
                  <StatusBadge value={b.qualityStatus === "APPROVED" ? "VERIFIED" : b.qualityStatus} />
                  {b.holdStatus !== "NONE" && <StatusBadge value={b.holdStatus} />}
                  <span className="text-xs text-muted">exp. {formatDate(b.expiryDate)}</span>
                  {b.passportProductId && (
                    <Link to={`/app/products/${b.passportProductId}`} className="text-xs font-semibold text-brand-600 hover:underline">
                      Passport →
                    </Link>
                  )}
                </li>
              ))}
              {!batches.length && <li className="px-5 py-6 text-sm text-muted">No batches yet. Create one on the Batches page.</li>}
            </ul>
          </Card>
          <Card className="p-5">
            <p className="font-semibold text-fg">Reorder threshold</p>
            <p className="mt-1 text-sm text-muted">Alert when your available stock falls to this level. Current: {detail.data.reorderThreshold ? `${detail.data.reorderThreshold} ${sku.unitOfMeasure}` : "not set"}.</p>
            {can("catalogue:manage") && (
              <div className="mt-3 flex gap-2">
                <Input value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder="e.g. 500 (empty = remove)" inputMode="decimal" aria-label="Reorder threshold" />
                <Button variant="secondary" loading={setRule.isPending} onClick={() => setRule.mutate(undefined)}>
                  Save
                </Button>
              </div>
            )}
          </Card>
        </div>
      </div>
      <MovementModal open={moving} onClose={() => setMoving(false)} defaults={{ skuId }} />
    </>
  );
}
