import { useState } from "react";
import { Package } from "lucide-react";
import { Alert, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Pagination, Select, Skeleton, StatusBadge, Table, Td, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { useAdminCan } from "@/lib/auth";
import { humanize } from "@/lib/format";
import { useAdminMutation, useAdminQuery } from "../hooks";

type Row = { id: string; productCode: string; productName: string; status: string; trustScore: number; trustLevel: string; riskLevel: string; organization: { id: string; name: string }; identity: { status: string; isCanonical: boolean } | null };

export default function AdminProducts() {
  const can = useAdminCan();
  const [q, setQ] = useState("");
  const [risk, setRisk] = useState("");
  const [page, setPage] = useState(1);
  const [target, setTarget] = useState<Row | null>(null);
  const [form, setForm] = useState({ status: "SUSPENDED", reason: "" });
  const list = useAdminQuery(["products", q, risk, page], () => api.page<Row>("/admin/products", { q, riskLevel: risk, page, pageSize: 25 }, false));
  const intervene = useAdminMutation(() => api.post(`/admin/products/${target!.id}/identity-status`, form, false), {
    success: "Identity status changed — appended to history and anchored",
    onSuccess: () => {
      setTarget(null);
      setForm({ status: "SUSPENDED", reason: "" });
    },
  });
  return (
    <>
      <PageHeader title="Products" description="All passports across tenants. Interventions append a new, anchored event — history is never edited." />
      <Card>
        <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row">
          <Input value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} placeholder="Search name or code" className="sm:max-w-sm" aria-label="Search" />
          <Select value={risk} onChange={(e) => (setRisk(e.target.value), setPage(1))} className="sm:w-44" aria-label="Risk">
            <option value="">All risk levels</option>
            {["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((r) => (
              <option key={r} value={r}>
                {humanize(r)}
              </option>
            ))}
          </Select>
        </div>
        {list.isLoading ? (
          <Skeleton className="m-5 h-48" />
        ) : list.data?.items.length ? (
          <>
            <Table head={["Product", "Organization", "Status", "Identity", "Trust", "Risk", ""]}>
              {list.data.items.map((p) => (
                <tr key={p.id}>
                  <Td>
                    <span className="block font-semibold">{p.productName}</span>
                    <span className="hash text-muted">{p.productCode}</span>
                  </Td>
                  <Td className="text-muted">{p.organization.name}</Td>
                  <Td>
                    <StatusBadge value={p.status} />
                  </Td>
                  <Td>{p.identity ? <StatusBadge value={p.identity.isCanonical ? p.identity.status : "QUARANTINED"} /> : "—"}</Td>
                  <Td className="font-semibold">{p.trustScore}</Td>
                  <Td>
                    <StatusBadge value={p.riskLevel} />
                  </Td>
                  <Td>
                    {can("compliance") && (
                      <Button size="sm" variant="ghost" onClick={() => setTarget(p)}>
                        Intervene
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
            <Pagination page={list.data.meta.page} pageCount={list.data.meta.pageCount} onPage={setPage} />
          </>
        ) : (
          <EmptyState icon={<Package className="h-5 w-5" />} title="No products" />
        )}
      </Card>
      <Modal
        open={Boolean(target)}
        onClose={() => setTarget(null)}
        title={`Change identity status · ${target?.productName}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setTarget(null)}>
              Cancel
            </Button>
            <Button variant="danger" disabled={form.reason.trim().length < 3} loading={intervene.isPending} onClick={() => intervene.mutate(undefined)}>
              Apply
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Alert tone="warn">This appends a STATUS_CHANGED event, anchors the new status on-chain and is shown to consumers. Use after an investigation.</Alert>
          <Field label="New identity status">
            {(id) => (
              <Select id={id} value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
                {["ACTIVE", "SUSPENDED", "COUNTERFEIT", "REVOKED"].map((s) => (
                  <option key={s} value={s}>
                    {humanize(s)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Reason" required>
            {(id) => <Textarea id={id} rows={3} value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} />}
          </Field>
        </div>
      </Modal>
    </>
  );
}
