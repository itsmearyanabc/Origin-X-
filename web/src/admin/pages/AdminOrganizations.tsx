import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Building2, Search } from "lucide-react";
import { Button, Card, EmptyState, ErrorState, Input, PageHeader, Pagination, Select, Skeleton, StatusBadge, Table, Td } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAdminCan } from "@/lib/auth";
import { formatDate, humanize } from "@/lib/format";
import { useAdminMutation, useAdminQuery } from "../hooks";

type OrgRow = { id: string; name: string; slug: string; organizationType: string; country: string | null; status: string; verificationStatus: string; subscriptionPlan: string; createdAt: string; _count: { members: number; products: number; incidents: number } };

export default function AdminOrganizations() {
  const [params, setParams] = useSearchParams();
  const can = useAdminCan();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const status = params.get("status") ?? "";
  const list = useAdminQuery(["orgs", status, q, page], () => api.page<OrgRow>("/admin/organizations", { status, q, page, pageSize: 20 }, false));
  const act = useAdminMutation(({ id, action }: { id: string; action: string }) => api.post(`/admin/organizations/${id}/${action}`, {}, false), { success: "Organization updated" });

  return (
    <>
      <PageHeader title="Organizations" description="Approve new organizations, verify identities and act on suspicious tenants." />
      <Card>
        <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <Input value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} placeholder="Search name or slug" className="pl-10" aria-label="Search organizations" />
          </div>
          <Select value={status} onChange={(e) => (setParams(e.target.value ? { status: e.target.value } : {}), setPage(1))} className="sm:w-48" aria-label="Status">
            <option value="">All statuses</option>
            {["PENDING", "ACTIVE", "SUSPENDED", "REJECTED"].map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </Select>
        </div>
        {list.isLoading ? (
          <Skeleton className="m-5 h-48" />
        ) : list.isError ? (
          <ErrorState message={errorMessage(list.error)} />
        ) : list.data?.items.length ? (
          <>
            <Table head={["Organization", "Type", "Status", "Verification", "Plan", "Members / products", "Created", ""]}>
              {list.data.items.map((o) => (
                <tr key={o.id}>
                  <Td>
                    <Link to={`/admin/organizations/${o.id}`} className="font-semibold text-fg hover:text-brand-600">
                      {o.name}
                    </Link>
                    <span className="hash block text-muted">{o.slug}</span>
                  </Td>
                  <Td className="text-muted">{humanize(o.organizationType)}</Td>
                  <Td>
                    <StatusBadge value={o.status} />
                  </Td>
                  <Td>
                    <StatusBadge value={o.verificationStatus} />
                  </Td>
                  <Td className="text-muted">{o.subscriptionPlan}</Td>
                  <Td className="text-muted">
                    {o._count.members} / {o._count.products}
                  </Td>
                  <Td className="text-muted">{formatDate(o.createdAt)}</Td>
                  <Td>
                    {can("orgs") && (
                      <div className="flex gap-1.5">
                        {o.status === "PENDING" && (
                          <>
                            <Button size="sm" onClick={() => act.mutate({ id: o.id, action: "approve" })}>
                              Approve
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => act.mutate({ id: o.id, action: "reject" })}>
                              Reject
                            </Button>
                          </>
                        )}
                        {o.status === "ACTIVE" && o.verificationStatus !== "VERIFIED" && (
                          <Button size="sm" variant="secondary" onClick={() => act.mutate({ id: o.id, action: "verify" })}>
                            Verify
                          </Button>
                        )}
                      </div>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
            <Pagination page={list.data.meta.page} pageCount={list.data.meta.pageCount} onPage={setPage} />
          </>
        ) : (
          <EmptyState icon={<Building2 className="h-5 w-5" />} title="No organizations" />
        )}
      </Card>
    </>
  );
}
