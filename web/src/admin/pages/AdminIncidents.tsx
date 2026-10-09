import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button, Card, EmptyState, Modal, PageHeader, Pagination, Select, Skeleton, StatusBadge, Table, Td } from "@/components/ui";
import { EvidenceView } from "@/app/pages/Incidents";
import { api } from "@/lib/api";
import { useAdminCan } from "@/lib/auth";
import { formatDateTime, humanize } from "@/lib/format";
import type { Incident } from "@/lib/types";
import { useAdminMutation, useAdminQuery } from "../hooks";

export default function AdminIncidents() {
  const can = useAdminCan();
  const [status, setStatus] = useState("OPEN");
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<Incident | null>(null);
  const list = useAdminQuery(["incidents", status, type, page], () => api.page<Incident>("/admin/incidents", { status, type, page, pageSize: 25 }, false));
  const update = useAdminMutation((s: string) => api.patch(`/admin/incidents/${open!.id}`, { status: s, note: "Updated by ORIGINX compliance" }, false), { success: "Incident updated", onSuccess: () => setOpen(null) });
  return (
    <>
      <PageHeader title="Incidents" description="Every tenant's incidents — collisions, tampering, invalid proofs, cloned codes." />
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
            {["IDENTITY_COLLISION", "TAMPERED_RECORD", "INVALID_BLOCKCHAIN_PROOF", "BROKEN_CUSTODY_CHAIN", "SUSPICIOUS_VERIFICATION_PATTERN", "COUNTERFEIT", "OTHER"].map((t) => (
              <option key={t} value={t}>
                {humanize(t)}
              </option>
            ))}
          </Select>
        </div>
        {list.isLoading ? (
          <Skeleton className="m-5 h-48" />
        ) : list.data?.items.length ? (
          <>
            <Table head={["Incident", "Organization", "Product", "Severity", "Status", "Detected"]}>
              {list.data.items.map((i) => (
                <tr key={i.id} className="cursor-pointer hover:bg-surface-2" onClick={() => setOpen(i)}>
                  <Td>
                    <span className="block font-semibold">{i.title}</span>
                    <span className="text-xs text-muted">{humanize(i.type)}</span>
                  </Td>
                  <Td className="text-muted">{i.organization?.name}</Td>
                  <Td className="hash text-muted">{i.product?.productCode ?? "—"}</Td>
                  <Td>
                    <StatusBadge value={i.severity} />
                  </Td>
                  <Td>
                    <StatusBadge value={i.status} />
                  </Td>
                  <Td className="text-muted">{formatDateTime(i.detectedAt)}</Td>
                </tr>
              ))}
            </Table>
            <Pagination page={list.data.meta.page} pageCount={list.data.meta.pageCount} onPage={setPage} />
          </>
        ) : (
          <EmptyState icon={<AlertTriangle className="h-5 w-5" />} title="No incidents" />
        )}
      </Card>
      <Modal
        open={Boolean(open)}
        onClose={() => setOpen(null)}
        size="lg"
        title={open?.title ?? ""}
        description={open ? `${open.organization?.name} · ${humanize(open.type)}` : undefined}
        footer={
          can("compliance") &&
          open &&
          !["RESOLVED", "DISMISSED", "RECALLED"].includes(open.status) && (
            <>
              <Button variant="secondary" onClick={() => update.mutate("INVESTIGATING")}>
                Investigating
              </Button>
              <Button variant="secondary" onClick={() => update.mutate("DISMISSED")}>
                Dismiss
              </Button>
              <Button onClick={() => update.mutate("RESOLVED")}>Resolve</Button>
            </>
          )
        }
      >
        {open && (
          <div className="space-y-4">
            <p className="text-fg">{open.description}</p>
            <EvidenceView evidence={open.evidence} />
          </div>
        )}
      </Modal>
    </>
  );
}
