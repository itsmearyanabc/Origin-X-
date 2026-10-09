import { useState } from "react";
import { Link } from "react-router";
import { Plus, Siren } from "lucide-react";
import { Alert, Button, Card, EmptyState, ErrorState, Field, Modal, PageHeader, Select, Skeleton, StatusBadge, Table, Tabs, Td, Textarea } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import type { Batch, ProductListItem, Recall } from "@/lib/types";
import { useOrgMutation, useOrgQuery } from "../hooks";

const NEXT: Record<string, Array<{ status: string; label: string; danger?: boolean }>> = {
  DRAFT: [
    { status: "INITIATED", label: "Initiate", danger: true },
    { status: "CANCELLED", label: "Discard" },
  ],
  INITIATED: [
    { status: "IN_PROGRESS", label: "Mark in progress" },
    { status: "COMPLETED", label: "Complete" },
    { status: "CANCELLED", label: "Cancel recall" },
  ],
  IN_PROGRESS: [
    { status: "COMPLETED", label: "Complete" },
    { status: "CANCELLED", label: "Cancel recall" },
  ],
};

function CreateRecall({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [target, setTarget] = useState<"product" | "batch">("product");
  const [productId, setProductId] = useState("");
  const [batchId, setBatchId] = useState("");
  const [reason, setReason] = useState("");
  const [initiate, setInitiate] = useState(false);
  const products = useOrgQuery(["products", "recall-picker"], () => api.page<ProductListItem>("/products", { scope: "registered", pageSize: 100 }), { enabled: open });
  const batches = useOrgQuery(["batches", "picker"], () => api.page<Batch>("/batches", { pageSize: 100 }), { enabled: open });
  const m = useOrgMutation(() => api.post("/recalls", { productId: target === "product" ? productId : undefined, batchId: target === "batch" ? batchId : undefined, reason, initiate }), {
    success: initiate ? "Recall initiated" : "Recall drafted",
    onSuccess: () => {
      setReason("");
      onClose();
    },
  });
  const ready = reason.trim().length >= 3 && (target === "product" ? productId : batchId);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New recall"
      description="Only products your organization registered can be recalled."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={initiate ? "danger" : "primary"} disabled={!ready} loading={m.isPending} onClick={() => m.mutate(undefined)}>
            {initiate ? "Initiate recall" : "Save draft"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Tabs
          value={target}
          onChange={setTarget}
          tabs={[
            { value: "product", label: "Single product" },
            { value: "batch", label: "Whole batch" },
          ]}
        />
        {target === "product" ? (
          <Field label="Product">
            {(id) => (
              <Select id={id} value={productId} onChange={(e) => setProductId(e.target.value)}>
                <option value="">Select…</option>
                {products.data?.items
                  .filter((p) => p.status !== "QUARANTINED" && p.status !== "RECALLED")
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.productName} · {p.productCode}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
        ) : (
          <Field label="Batch">
            {(id) => (
              <Select id={id} value={batchId} onChange={(e) => setBatchId(e.target.value)}>
                <option value="">Select…</option>
                {batches.data?.items.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.batchCode} ({b._count?.products ?? 0} products)
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Field label="Reason (shown to consumers)" required>
          {(id) => <Textarea id={id} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
        <label className="flex items-center gap-3 text-sm text-fg">
          <input type="checkbox" checked={initiate} onChange={(e) => setInitiate(e.target.checked)} className="h-4 w-4 accent-brand-500" />
          Initiate now
        </label>
        {initiate && <Alert tone="warn">Every affected unit is marked RECALLED, the status is anchored on-chain and all scans show a recall warning immediately.</Alert>}
      </div>
    </Modal>
  );
}

export default function Recalls() {
  const can = useCan();
  const [creating, setCreating] = useState(false);
  const list = useOrgQuery(["recalls"], () => api.get<Recall[]>("/recalls"));
  const transition = useOrgMutation(({ id, status }: { id: string; status: string }) => api.post(`/recalls/${id}/transition`, { status }), { success: "Recall updated" });

  return (
    <>
      <PageHeader
        title="Recalls"
        description="Recall a single product or a whole batch. Consumers see it on their very next scan."
        actions={
          can("recalls:manage") && (
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
              New recall
            </Button>
          )
        }
      />
      <Card>
        {list.isLoading ? (
          <Skeleton className="m-5 h-24" />
        ) : list.isError ? (
          <ErrorState message={errorMessage(list.error)} />
        ) : list.data?.length ? (
          <Table head={["Target", "Reason", "Units", "Status", "Initiated", "Actions"]}>
            {list.data.map((r) => (
              <tr key={r.id}>
                <Td>
                  {r.product ? (
                    <Link to={`/app/products/${r.product.id}`} className="font-semibold text-fg hover:text-brand-600">
                      {r.product.productName ?? r.product.productCode}
                    </Link>
                  ) : (
                    <span className="font-semibold text-fg">Batch {r.batch?.batchCode}</span>
                  )}
                </Td>
                <Td className="max-w-xs truncate text-muted">{r.reason}</Td>
                <Td className="text-muted">{r.affectedUnits ?? "—"}</Td>
                <Td>
                  <StatusBadge value={r.status} />
                </Td>
                <Td className="text-muted">{formatDate(r.initiatedAt)}</Td>
                <Td>
                  {can("recalls:manage") && (
                    <div className="flex flex-wrap gap-1.5">
                      {(NEXT[r.status] ?? []).map((n) => (
                        <Button
                          key={n.status}
                          size="sm"
                          variant={n.danger ? "danger" : "secondary"}
                          loading={transition.isPending && transition.variables?.id === r.id && transition.variables.status === n.status}
                          onClick={() => (n.status !== "CANCELLED" || confirm("Cancel this recall? Products are restored with a new, anchored status event.")) && transition.mutate({ id: r.id, status: n.status })}
                        >
                          {n.label}
                        </Button>
                      ))}
                    </div>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        ) : (
          <EmptyState icon={<Siren className="h-5 w-5" />} title="No recalls" description="Good news — nothing has been recalled." />
        )}
      </Card>
      <CreateRecall open={creating} onClose={() => setCreating(false)} />
    </>
  );
}
