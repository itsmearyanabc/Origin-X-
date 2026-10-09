import { useState } from "react";
import { ClipboardList } from "lucide-react";
import { Card, EmptyState, ErrorState, Input, PageHeader, Pagination, Skeleton, Table, Td } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { formatDateTime, humanize } from "@/lib/format";
import type { AuditLog as Log } from "@/lib/types";
import { useOrgQuery } from "../hooks";

export function AuditTable({ items }: { items: Log[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Table head={["When", "Action", "Resource", "Details"]}>
      {items.map((l) => (
        <tr key={l.id} className="align-top">
          <Td className="whitespace-nowrap text-muted">{formatDateTime(l.timestamp)}</Td>
          <Td className="font-medium">{humanize(l.action)}</Td>
          <Td className="text-muted">
            {l.resourceType}
            {l.resourceId && <span className="hash block">{l.resourceId.slice(-10)}</span>}
          </Td>
          <Td>
            {Object.keys(l.metadata ?? {}).length ? (
              <button className="text-sm font-semibold text-brand-600 hover:underline" onClick={() => setOpen(open === l.id ? null : l.id)}>
                {open === l.id ? "Hide" : "Show"}
              </button>
            ) : (
              <span className="text-muted">—</span>
            )}
            {open === l.id && <pre className="hash mt-2 max-w-md whitespace-pre-wrap break-all rounded-lg bg-surface-2 p-3 text-[11px] text-fg">{JSON.stringify(l.metadata, null, 2)}</pre>}
          </Td>
        </tr>
      ))}
    </Table>
  );
}

export default function AuditLog() {
  const [action, setAction] = useState("");
  const [page, setPage] = useState(1);
  const list = useOrgQuery(["audit", action, page], () => api.page<Log>("/audit-logs", { action: action.trim().toUpperCase() || undefined, page, pageSize: 30 }));
  return (
    <>
      <PageHeader title="Audit log" description="Append-only record of every sensitive action in this organization. Nobody — including ORIGINX — can edit or delete it." />
      <Card>
        <div className="border-b border-line p-4">
          <Input value={action} onChange={(e) => (setAction(e.target.value), setPage(1))} placeholder="Filter by action, e.g. INVENTORY_RECEIPT" className="max-w-sm" aria-label="Filter by action" />
        </div>
        {list.isLoading ? (
          <Skeleton className="m-5 h-60" />
        ) : list.isError ? (
          <ErrorState message={errorMessage(list.error)} />
        ) : list.data?.items.length ? (
          <>
            <AuditTable items={list.data.items} />
            <Pagination page={list.data.meta.page} pageCount={list.data.meta.pageCount} onPage={setPage} />
          </>
        ) : (
          <EmptyState icon={<ClipboardList className="h-5 w-5" />} title="No entries" />
        )}
      </Card>
    </>
  );
}
