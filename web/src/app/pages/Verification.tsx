import { useState } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, ScanLine, XCircle } from "lucide-react";
import { Button, Card, CardHeader, EmptyState, Input, PageHeader, Pagination, StatusBadge, Table, Td } from "@/components/ui";
import { extractToken } from "@/verify/VerifyHome";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { cn, formatDateTime, humanize, shortHash } from "@/lib/format";
import type { PublicVerification, VerificationLog } from "@/lib/types";
import { useOrgMutation, useOrgQuery } from "../hooks";

export default function Verification() {
  const can = useCan();
  const [code, setCode] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<PublicVerification | null>(null);
  const logs = useOrgQuery(["verification-logs", page], () => api.page<VerificationLog>("/verification/logs", { page, pageSize: 20 }), { enabled: can("analytics:read") });
  const scan = useOrgMutation((token: string) => api.post<PublicVerification>("/verification/scan", { token }), { onSuccess: setResult });
  const token = extractToken(code);
  const good = result && ["HISTORY_VERIFIED", "AUTHENTIC"].includes(result.state);
  const warn = result?.state === "SUSPICIOUS" || result?.state === "UNKNOWN";

  return (
    <>
      <PageHeader title="Verification" description="Check any ORIGINX product at your dock or counter, and see how your products are being verified." />
      <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <Card className="p-5">
          <p className="font-semibold text-fg">Scan or paste a code</p>
          <p className="mt-1 text-sm text-muted">Handheld scanners type the link straight into this box.</p>
          <form
            className="mt-4 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (token) scan.mutate(token);
            }}
          >
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code or verification link" className="hash" autoFocus aria-label="Verification code" />
            <Button type="submit" disabled={!token} loading={scan.isPending} icon={<ScanLine className="h-4 w-4" />}>
              Check
            </Button>
          </form>
          {code && !token && <p className="mt-2 text-xs text-bad-600">Not a valid ORIGINX code.</p>}
        </Card>
        <Card className={cn("p-5", result && (good ? "border-ok-100" : warn ? "border-warn-100" : "border-bad-100"))}>
          {result ? (
            <div className="flex items-start gap-4">
              {good ? <CheckCircle2 className="h-8 w-8 shrink-0 text-ok-600" /> : warn ? <AlertTriangle className="h-8 w-8 shrink-0 text-warn-600" /> : <XCircle className="h-8 w-8 shrink-0 text-bad-600" />}
              <div className="min-w-0 flex-1">
                <StatusBadge value={result.state} />
                <p className="mt-2 font-semibold text-fg">{result.headline}</p>
                {result.passport && (
                  <p className="mt-1 text-sm text-muted">
                    {result.passport.productName} · {result.passport.brand.name} · Batch {result.passport.batch ?? "—"} · Trust {result.passport.trust.score}
                  </p>
                )}
                {result.warnings?.map((w) => (
                  <p key={w} className="mt-2 text-sm text-warn-700">
                    {w}
                  </p>
                ))}
                {token && (
                  <a href={`/verify/${token}`} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-brand-600 hover:underline">
                    Full passport <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
            </div>
          ) : (
            <EmptyState icon={<ScanLine className="h-5 w-5" />} title="Result appears here" description="Partner scans are logged separately from consumer scans." />
          )}
        </Card>
      </div>
      {can("analytics:read") && (
        <Card className="mt-4">
          <CardHeader title="Scans of your products" description="Consumer and partner verifications. Scanners are anonymous hashes." />
          {logs.data?.items.length ? (
            <>
              <Table head={["Time", "Result", "Source", "Product", "Scanner"]}>
                {logs.data.items.map((l) => (
                  <tr key={l.id}>
                    <Td className="text-muted">{formatDateTime(l.timestamp)}</Td>
                    <Td>
                      <StatusBadge value={l.result} />
                    </Td>
                    <Td className="text-muted">{humanize(l.source)}</Td>
                    <Td className="hash text-muted">{shortHash(l.productId ?? "", 5)}</Td>
                    <Td className="hash text-muted">{shortHash(l.ipHash ?? "", 5)}</Td>
                  </tr>
                ))}
              </Table>
              <Pagination page={logs.data.meta.page} pageCount={logs.data.meta.pageCount} onPage={setPage} />
            </>
          ) : (
            <EmptyState title="No scans yet" />
          )}
        </Card>
      )}
    </>
  );
}
