import { useState } from "react";
import { Blocks, RefreshCw } from "lucide-react";
import { Alert, Button, Card, CardHeader, CopyText, EmptyState, PageHeader, Pagination, Select, Skeleton, StatusBadge, Table, Td } from "@/components/ui";
import { api } from "@/lib/api";
import { useAdminCan } from "@/lib/auth";
import { formatDateTime, shortHash } from "@/lib/format";
import type { ChainStatus, Proof } from "@/lib/types";
import { useAdminMutation, useAdminQuery } from "../hooks";

export default function AdminBlockchain() {
  const can = useAdminCan();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const chain = useAdminQuery(["chain"], () => api.get<ChainStatus>("/admin/blockchain/status", undefined, false), { refetchInterval: 30_000 });
  const proofs = useAdminQuery(["proofs", status, page], () => api.page<Proof & { product: { productCode: string } }>("/admin/blockchain/proofs", { status, page, pageSize: 25 }, false));
  const retry = useAdminMutation(() => api.post<{ processed: number; confirmed: number; available: boolean }>("/admin/blockchain/anchor-pending", {}, false), { success: (r) => (r.available ? `Anchored ${r.confirmed} of ${r.processed} pending proofs` : "Blockchain unavailable — nothing anchored") });
  const retryFailed = useAdminMutation((id: string) => api.post(`/admin/blockchain/proofs/${id}/retry`, {}, false), { success: "Failed proof queued for retry" });
  const c = chain.data;
  return (
    <>
      <PageHeader
        title="Blockchain"
        description="Anchoring network status and every proof. Only real transaction hashes are ever stored."
        actions={
          can("blockchain") && (
            <Button variant="secondary" icon={<RefreshCw className="h-4 w-4" />} loading={retry.isPending} onClick={() => retry.mutate(undefined)}>
              Anchor pending proofs
            </Button>
          )
        }
      />
      {c ? (
        <Card className="mb-4 grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Status", <StatusBadge key="s" value={c.available ? "ACTIVE" : c.configured ? "UNAVAILABLE" : "NOT_ANCHORED"} />],
            ["Network", `${c.network}${c.chainId ? ` (chain ${c.chainId})` : ""}`],
            ["Contract", c.contractAddress ? <CopyText key="c" value={c.contractAddress} display={shortHash(c.contractAddress, 6)} className="px-0" /> : "—"],
            ["Anchoring wallet", c.anchorer ? <CopyText key="w" value={c.anchorer} display={shortHash(c.anchorer, 6)} className="px-0" /> : "—"],
            ["Latest block", c.latestBlock ?? "—"],
            ["On-chain identities", c.onChainIdentityCount ?? "—"],
            ["On-chain events", c.onChainEventCount ?? "—"],
          ].map(([k, v]) => (
            <div key={k as string}>
              <p className="text-xs text-muted">{k}</p>
              <div className="mt-1 font-medium text-fg">{v}</div>
            </div>
          ))}
          {c.reason && (
            <Alert tone="warn" className="sm:col-span-2 lg:col-span-4">
              {c.reason}
            </Alert>
          )}
        </Card>
      ) : (
        <Skeleton className="mb-4 h-32 rounded-2xl" />
      )}
      <Card>
        <CardHeader
          title="Proofs"
          action={
            <Select value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))} className="h-9 w-40" aria-label="Status">
              <option value="">All</option>
              {["CONFIRMED", "PENDING", "FAILED"].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          }
        />
        {proofs.isLoading ? (
          <Skeleton className="m-5 h-48" />
        ) : proofs.data?.items.length ? (
          <>
            <Table head={["Kind", "Product", "Anchored hash", "Transaction", "Block", "Status", "Created", "Recovery"]}>
              {proofs.data.items.map((p) => (
                <tr key={p.id}>
                  <Td>
                    <StatusBadge value={p.kind} />
                  </Td>
                  <Td className="hash text-muted">{p.product.productCode}</Td>
                  <Td>
                    <CopyText value={p.eventHash} display={shortHash(p.eventHash, 6)} />
                  </Td>
                  <Td>{p.transactionHash ? <CopyText value={p.transactionHash} display={shortHash(p.transactionHash, 6)} /> : <span className="text-muted">{p.lastError ? "error" : "—"}</span>}</Td>
                  <Td className="hash text-muted">{p.blockNumber ?? "—"}</Td>
                  <Td>
                    <StatusBadge value={p.status} />
                  </Td>
                  <Td className="text-muted">{formatDateTime(p.createdAt)}</Td>
                  <Td>
                    {p.status === "FAILED" && can("blockchain") ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={retryFailed.isPending}
                        disabled={retryFailed.isPending}
                        onClick={() => {
                          if (window.confirm("Retry this failed proof on the configured chain? If its transaction was already broadcast, ORIGINX will resume that transaction.")) {
                            retryFailed.mutate(p.id);
                          }
                        }}
                      >
                        Retry
                      </Button>
                    ) : "—"}
                  </Td>
                </tr>
              ))}
            </Table>
            <Pagination page={proofs.data.meta.page} pageCount={proofs.data.meta.pageCount} onPage={setPage} />
          </>
        ) : (
          <EmptyState icon={<Blocks className="h-5 w-5" />} title="No proofs" />
        )}
      </Card>
    </>
  );
}
