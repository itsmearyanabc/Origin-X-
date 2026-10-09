import { useState } from "react";
import { Users } from "lucide-react";
import { Button, Card, EmptyState, Input, PageHeader, Pagination, Select, Skeleton, StatusBadge, Table, Td } from "@/components/ui";
import { api } from "@/lib/api";
import { useAdminCan, useAuth } from "@/lib/auth";
import { formatDate, humanize, timeAgo } from "@/lib/format";
import { useAdminMutation, useAdminQuery } from "../hooks";

type UserRow = { id: string; email: string; fullName: string; platformRole: string; status: string; lastLoginAt: string | null; createdAt: string; memberships: Array<{ role: string; organization: { id: string; name: string } }> };

export default function AdminUsers() {
  const can = useAdminCan();
  const { me } = useAuth();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const list = useAdminQuery(["users", q, page], () => api.page<UserRow>("/admin/users", { q, page, pageSize: 25 }, false));
  const status = useAdminMutation(({ id, s }: { id: string; s: string }) => api.patch(`/admin/users/${id}/status`, { status: s }, false), { success: "User updated" });
  const role = useAdminMutation(({ id, r }: { id: string; r: string }) => api.patch(`/admin/users/${id}/platform-role`, { platformRole: r }, false), { success: "Platform role updated" });
  return (
    <>
      <PageHeader title="Users" description="Every account on the platform. Suspending a user ends all of their sessions immediately." />
      <Card>
        <div className="border-b border-line p-4">
          <Input value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} placeholder="Search name or email" className="max-w-sm" aria-label="Search users" />
        </div>
        {list.isLoading ? (
          <Skeleton className="m-5 h-48" />
        ) : list.data?.items.length ? (
          <>
            <Table head={["User", "Organizations", "Platform role", "Status", "Last sign-in", ""]}>
              {list.data.items.map((u) => (
                <tr key={u.id}>
                  <Td>
                    <span className="block font-semibold">{u.fullName}</span>
                    <span className="text-xs text-muted">{u.email}</span>
                  </Td>
                  <Td className="text-muted">{u.memberships.map((m) => `${m.organization.name} (${humanize(m.role)})`).join(", ") || "—"}</Td>
                  <Td>
                    {can("users") && u.id !== me?.id ? (
                      <Select value={u.platformRole} onChange={(e) => confirm(`Change platform role of ${u.email}?`) && role.mutate({ id: u.id, r: e.target.value })} className="h-9 w-44" aria-label="Platform role">
                        {["NONE", "SUPPORT_ADMIN", "COMPLIANCE_ADMIN", "PLATFORM_ADMIN", "SUPER_ADMIN"].map((r) => (
                          <option key={r} value={r}>
                            {humanize(r)}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      humanize(u.platformRole)
                    )}
                  </Td>
                  <Td>
                    <StatusBadge value={u.status} />
                  </Td>
                  <Td className="text-muted">{u.lastLoginAt ? timeAgo(u.lastLoginAt) : `joined ${formatDate(u.createdAt)}`}</Td>
                  <Td>
                    {can("users") && u.id !== me?.id && (
                      <Button size="sm" variant={u.status === "ACTIVE" ? "ghost" : "secondary"} onClick={() => status.mutate({ id: u.id, s: u.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE" })}>
                        {u.status === "ACTIVE" ? "Suspend" : "Reactivate"}
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
            <Pagination page={list.data.meta.page} pageCount={list.data.meta.pageCount} onPage={setPage} />
          </>
        ) : (
          <EmptyState icon={<Users className="h-5 w-5" />} title="No users" />
        )}
      </Card>
    </>
  );
}
