import { useState } from "react";
import { Link } from "react-router";
import { AlertTriangle, Bot, Plus, User } from "lucide-react";
import { Button, Card, EmptyState, ErrorState, Field, Input, Modal, PageHeader, Pagination, Select, Skeleton, StatusBadge, Table, Td, Textarea } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { formatDateTime, humanize } from "@/lib/format";
import type { Incident, ProductListItem } from "@/lib/types";
import { useOrgMutation, useOrgQuery } from "../hooks";

const TYPES = ["IDENTITY_COLLISION", "TAMPERED_RECORD", "INVALID_BLOCKCHAIN_PROOF", "BROKEN_CUSTODY_CHAIN", "UNVERIFIED_ORGANIZATION", "SUSPICIOUS_TRANSFER", "SUSPICIOUS_VERIFICATION_PATTERN", "COUNTERFEIT", "OTHER"];
const SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

export function EvidenceView({ evidence }: { evidence: Record<string, unknown> }) {
  if (!Object.keys(evidence).length) return <p className="text-sm text-muted">No evidence attached.</p>;
  return <pre className="hash max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-surface-2 p-4 text-xs text-fg">{JSON.stringify(evidence, null, 2)}</pre>;
}

function IncidentModal({ incident, onClose }: { incident: Incident | null; onClose: () => void }) {
  const can = useCan();
  const [note, setNote] = useState("");
  const update = useOrgMutation((status: string) => api.patch(`/incidents/${incident!.id}`, { status, note: note || undefined }), { success: "Incident updated", onSuccess: onClose });
  if (!incident) return null;
  const closed = ["RESOLVED", "DISMISSED", "RECALLED"].includes(incident.status);
  return (
    <Modal
      open={Boolean(incident)}
      onClose={onClose}
      size="lg"
      title={incident.title}
      description={`${humanize(incident.type)} · ${incident.source === "SYSTEM" ? "detected automatically" : "reported manually"} · ${formatDateTime(incident.createdAt)}`}
      footer={
        can("incidents:manage") && (
          <>
            {closed ? (
              <Button variant="secondary" loading={update.isPending} onClick={() => update.mutate("OPEN")}>
                Re-open
              </Button>
            ) : (
              <>
                {incident.status === "OPEN" && (
                  <Button variant="secondary" loading={update.isPending && update.variables === "INVESTIGATING"} onClick={() => update.mutate("INVESTIGATING")}>
                    Start investigating
                  </Button>
                )}
                <Button variant="secondary" loading={update.isPending && update.variables === "DISMISSED"} onClick={() => update.mutate("DISMISSED")}>
                  Dismiss
                </Button>
                <Button loading={update.isPending && update.variables === "RESOLVED"} onClick={() => update.mutate("RESOLVED")}>
                  Resolve
                </Button>
              </>
            )}
          </>
        )
      }
    >
      <div className="space-y-5">
        <div className="flex flex-wrap gap-2">
          <StatusBadge value={incident.severity} />
          <StatusBadge value={incident.status} />
        </div>
        <p className="text-fg">{incident.description}</p>
        {incident.product && (
          <Link to={`/app/products/${incident.product.id}`} className="inline-flex text-sm font-semibold text-brand-600 hover:underline">
            {incident.product.productName} · {incident.product.productCode} →
          </Link>
        )}
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Evidence</p>
          <EvidenceView evidence={incident.evidence} />
        </div>
        {incident.resolutionNote && <p className="rounded-xl bg-surface-2 p-3 text-sm text-muted">Note: {incident.resolutionNote}</p>}
        {can("incidents:manage") && <Field label="Resolution note">{(id) => <Textarea id={id} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>}
      </div>
    </Modal>
  );
}

function CreateIncident({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form, setForm] = useState({ productId: "", type: "OTHER", severity: "MEDIUM", title: "", description: "" });
  const products = useOrgQuery(["products", "picker"], () => api.page<ProductListItem>("/products", { pageSize: 100 }), { enabled: open });
  const m = useOrgMutation(() => api.post("/incidents", { ...form, productId: form.productId || undefined }), {
    success: "Incident reported",
    onSuccess: () => {
      setForm({ productId: "", type: "OTHER", severity: "MEDIUM", title: "", description: "" });
      onClose();
    },
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Report an incident"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={form.title.trim().length < 3 || form.description.trim().length < 3} loading={m.isPending} onClick={() => m.mutate(undefined)}>
            Report
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Product" className="sm:col-span-2">
          {(id) => (
            <Select id={id} value={form.productId} onChange={set("productId")}>
              <option value="">Not product-specific</option>
              {products.data?.items.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.productName} · {p.productCode}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Type">
          {(id) => (
            <Select id={id} value={form.type} onChange={set("type")}>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {humanize(t)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Severity">
          {(id) => (
            <Select id={id} value={form.severity} onChange={set("severity")}>
              {SEVERITIES.map((t) => (
                <option key={t} value={t}>
                  {humanize(t)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Title" required className="sm:col-span-2">
          {(id) => <Input id={id} value={form.title} onChange={set("title")} />}
        </Field>
        <Field label="Description" required className="sm:col-span-2">
          {(id) => <Textarea id={id} rows={4} value={form.description} onChange={set("description")} />}
        </Field>
      </div>
    </Modal>
  );
}

export default function Incidents() {
  const can = useCan();
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Incident | null>(null);
  const [creating, setCreating] = useState(false);
  const list = useOrgQuery(["incidents", status, type, page], () => api.page<Incident>("/incidents", { status, type, page, pageSize: 20 }));

  return (
    <>
      <PageHeader
        title="Incidents"
        description="Tampering, broken custody, identity collisions and cloned codes are detected automatically. Your team can report others."
        actions={
          can("incidents:create") && (
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
              Report incident
            </Button>
          )
        }
      />
      <Card>
        <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row">
          <Select value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))} className="sm:w-48" aria-label="Status">
            <option value="">All statuses</option>
            {["OPEN", "INVESTIGATING", "RESOLVED", "DISMISSED", "RECALLED"].map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </Select>
          <Select value={type} onChange={(e) => (setType(e.target.value), setPage(1))} className="sm:w-64" aria-label="Type">
            <option value="">All types</option>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {humanize(t)}
              </option>
            ))}
          </Select>
        </div>
        {list.isLoading ? (
          <div className="space-y-3 p-5">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-11" />
            ))}
          </div>
        ) : list.isError ? (
          <ErrorState message={errorMessage(list.error)} />
        ) : list.data?.items.length ? (
          <>
            <Table head={["Incident", "Product", "Severity", "Status", "Source", "Detected"]}>
              {list.data.items.map((i) => (
                <tr key={i.id} className="cursor-pointer transition hover:bg-surface-2" onClick={() => setSelected(i)}>
                  <Td>
                    <span className="block font-semibold text-fg">{i.title}</span>
                    <span className="text-xs text-muted">{humanize(i.type)}</span>
                  </Td>
                  <Td className="text-muted">{i.product?.productCode ?? "—"}</Td>
                  <Td>
                    <StatusBadge value={i.severity} />
                  </Td>
                  <Td>
                    <StatusBadge value={i.status} />
                  </Td>
                  <Td className="text-muted">
                    <span className="inline-flex items-center gap-1.5">
                      {i.source === "SYSTEM" ? <Bot className="h-3.5 w-3.5" /> : <User className="h-3.5 w-3.5" />} {i.source === "SYSTEM" ? "Automatic" : "Manual"}
                    </span>
                  </Td>
                  <Td className="text-muted">{formatDateTime(i.detectedAt)}</Td>
                </tr>
              ))}
            </Table>
            <Pagination page={list.data.meta.page} pageCount={list.data.meta.pageCount} onPage={setPage} />
          </>
        ) : (
          <EmptyState icon={<AlertTriangle className="h-5 w-5" />} title="No incidents" description="Nothing needs your attention right now." />
        )}
      </Card>
      <IncidentModal incident={selected} onClose={() => setSelected(null)} />
      <CreateIncident open={creating} onClose={() => setCreating(false)} />
    </>
  );
}
