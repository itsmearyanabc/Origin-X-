import { useState } from "react";
import { Siren } from "lucide-react";
import { Card, EmptyState, PageHeader, Pagination, Select, Skeleton, StatusBadge, Table, Td } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDate, humanize } from "@/lib/format";
import type { Recall } from "@/lib/types";
import { useAdminQuery } from "../hooks";

export default function AdminRecalls() {
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const list = useAdminQuery(["recalls", status, page], () => api.page<Recall>("/admin/recalls", { status, page, pageSize: 25 }, false));
  return (
    <>
      <PageHeader title="Recalls" description="Product and batch recalls across the platform." />
      <Card>
        <div className="border-b border-line p-4">
          <Select value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))} className="sm:w-48" aria-label="Status">
            <option value="">All statuses</option>
            {["DRAFT", "INITIATED", "IN_PROGRESS", "COMPLETED", "CANCELLED"].map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </Select>
        </div>
        {list.isLoading ? (
          <Skeleton className="m-5 h-48" />
        ) : list.data?.items.length ? (
          <>
            <Table head={["Organization", "Target", "Reason", "Units", "Status", "Initiated"]}>
              {list.data.items.map((r) => (
                <tr key={r.id}>
                  <Td className="font-semibold">{r.organization?.name}</Td>
                  <Td className="hash text-muted">{r.product?.productCode ?? (r.batch ? `Batch ${r.batch.batchCode}` : "—")}</Td>
                  <Td className="max-w-xs truncate text-muted">{r.reason}</Td>
                  <Td>{r.affectedUnits ?? "—"}</Td>
                  <Td>
                    <StatusBadge value={r.status} />
                  </Td>
                  <Td className="text-muted">{formatDate(r.initiatedAt)}</Td>
                </tr>
              ))}
            </Table>
            <Pagination page={list.data.meta.page} pageCount={list.data.meta.pageCount} onPage={setPage} />
          </>
        ) : (
          <EmptyState icon={<Siren className="h-5 w-5" />} title="No recalls" />
        )}
      </Card>
    </>
  );
}
