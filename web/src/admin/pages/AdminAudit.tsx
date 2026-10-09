import { useState } from "react";
import { ClipboardList } from "lucide-react";
import { Card, EmptyState, ErrorState, Input, PageHeader, Pagination, Skeleton } from "@/components/ui";
import { AuditTable } from "@/app/pages/AuditLog";
import { api, errorMessage } from "@/lib/api";
import type { AuditLog } from "@/lib/types";
import { useAdminQuery } from "../hooks";

export default function AdminAudit() {
  const [action, setAction] = useState("");
  const [page, setPage] = useState(1);
  const list = useAdminQuery(["audit", action, page], () => api.page<AuditLog>("/admin/audit-logs", { action: action.trim().toUpperCase() || undefined, page, pageSize: 40 }, false));
  return (
    <>
      <PageHeader title="Audit logs" description="Platform-wide, append-only. Admin actions are prefixed ADMIN_." />
      <Card>
        <div className="border-b border-line p-4">
          <Input value={action} onChange={(e) => (setAction(e.target.value), setPage(1))} placeholder="Exact action, e.g. ADMIN_ORGANIZATION_VERIFY" className="max-w-md" aria-label="Filter by action" />
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
