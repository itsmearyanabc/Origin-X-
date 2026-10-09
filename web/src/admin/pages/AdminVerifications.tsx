import { useState } from "react";
import { ScanLine } from "lucide-react";
import { Card, CardHeader, EmptyState, PageHeader, Pagination, Select, Skeleton, StatusBadge, Table, Td } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDateTime, humanize, shortHash } from "@/lib/format";
import type { VerificationLog } from "@/lib/types";
import { useAdminQuery } from "../hooks";

export default function AdminVerifications() {
  const [result, setResult] = useState("");
  const [page, setPage] = useState(1);
  const metrics = useAdminQuery(["metrics"], () => api.get<{ verificationResults30d: Record<string, number>; verificationFailures30d: number }>("/admin/platform-metrics", undefined, false));
  const logs = useAdminQuery(["vlogs", result, page], () => api.page<VerificationLog>("/admin/verification-logs", { result, page, pageSize: 30 }, false));
  return (
    <>
      <PageHeader title="Verification monitoring" description="Every consumer and partner scan. Scanners are salted hashes — no IP addresses are stored." />
      {metrics.data && (
        <div className="mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-7">
          {["HISTORY_VERIFIED", "AUTHENTIC", "RECALLED", "SUSPICIOUS", "COUNTERFEIT", "HISTORY_COMPROMISED", "UNKNOWN"].map((r) => (
            <button key={r} onClick={() => (setResult(result === r ? "" : r), setPage(1))} className={`rounded-2xl border p-4 text-left transition ${result === r ? "border-brand-400 bg-brand-50 dark:bg-brand-500/10" : "border-line bg-surface hover:border-ink-300"}`}>
              <p className="font-display text-2xl font-bold text-fg">{metrics.data.verificationResults30d[r] ?? 0}</p>
              <p className="mt-1 text-xs text-muted">{humanize(r)} · 30d</p>
            </button>
          ))}
        </div>
      )}
      <Card>
        <CardHeader
          title="Scan log"
          action={
            <Select value={result} onChange={(e) => (setResult(e.target.value), setPage(1))} className="h-9 w-52" aria-label="Result">
              <option value="">All results</option>
              {["HISTORY_VERIFIED", "AUTHENTIC", "RECALLED", "SUSPICIOUS", "COUNTERFEIT", "HISTORY_COMPROMISED", "UNKNOWN"].map((r) => (
                <option key={r} value={r}>
                  {humanize(r)}
                </option>
              ))}
            </Select>
          }
        />
        {logs.isLoading ? (
          <Skeleton className="m-5 h-48" />
        ) : logs.data?.items.length ? (
          <>
            <Table head={["Time", "Result", "Source", "Product", "Scanner"]}>
              {logs.data.items.map((l) => (
                <tr key={l.id}>
                  <Td className="text-muted">{formatDateTime(l.timestamp)}</Td>
                  <Td>
                    <StatusBadge value={l.result} />
                  </Td>
                  <Td className="text-muted">{humanize(l.source)}</Td>
                  <Td className="hash text-muted">{l.productId ? shortHash(l.productId, 5) : "unknown code"}</Td>
                  <Td className="hash text-muted">{shortHash(l.ipHash ?? "", 5)}</Td>
                </tr>
              ))}
            </Table>
            <Pagination page={logs.data.meta.page} pageCount={logs.data.meta.pageCount} onPage={setPage} />
          </>
        ) : (
          <EmptyState icon={<ScanLine className="h-5 w-5" />} title="No scans" />
        )}
      </Card>
    </>
  );
}
