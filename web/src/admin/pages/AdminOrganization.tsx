import { useState } from "react";
import { Link, useParams } from "react-router";
import { ArrowLeft } from "lucide-react";
import { Button, Card, CardHeader, ErrorState, Field, Input, Modal, PageHeader, Select, Skeleton, StatusBadge, Table, Td, Textarea } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAdminCan } from "@/lib/auth";
import { formatDate, humanize } from "@/lib/format";
import type { Entitlements, Member } from "@/lib/types";
import { useAdminMutation, useAdminQuery } from "../hooks";

type OrgDetail = {
  id: string;
  name: string;
  slug: string;
  legalName: string | null;
  organizationType: string;
  additionalTypes: string[];
  industry: string | null;
  country: string | null;
  address: string | null;
  contactEmail: string | null;
  website: string | null;
  status: string;
  verificationStatus: string;
  subscriptionPlan: string;
  createdAt: string;
  members: Member[];
  _count: { products: number; incidents: number; recalls: number };
  entitlements: Entitlements;
};

const ACTIONS: Record<string, Array<{ action: string; label: string; danger?: boolean }>> = {
  PENDING: [{ action: "approve", label: "Approve" }, { action: "reject", label: "Reject", danger: true }],
  ACTIVE: [{ action: "verify", label: "Verify" }, { action: "unverify", label: "Remove verification" }, { action: "suspend", label: "Suspend", danger: true }],
  SUSPENDED: [{ action: "reactivate", label: "Reactivate" }],
  REJECTED: [],
};

export default function AdminOrganization() {
  const { id = "" } = useParams();
  const can = useAdminCan();
  const [pending, setPending] = useState<{ action: string; label: string; danger?: boolean } | null>(null);
  const [reason, setReason] = useState("");
  const [plan, setPlan] = useState({ plan: "", productLimit: "", userLimit: "" });
  const org = useAdminQuery(["org", id], () => api.get<OrgDetail>(`/admin/organizations/${id}`, undefined, false));
  const act = useAdminMutation(({ action }: { action: string }) => api.post(`/admin/organizations/${id}/${action}`, { reason: reason || undefined }, false), {
    success: "Organization updated",
    onSuccess: () => {
      setPending(null);
      setReason("");
    },
  });
  const sub = useAdminMutation(() => api.put(`/admin/organizations/${id}/subscription`, { plan: plan.plan, productLimit: plan.productLimit ? Number(plan.productLimit) : undefined, userLimit: plan.userLimit ? Number(plan.userLimit) : undefined }, false), { success: "Subscription updated" });

  if (org.isLoading) return <Skeleton className="h-96 rounded-2xl" />;
  if (org.isError || !org.data) return <Card><ErrorState message={errorMessage(org.error)} /></Card>;
  const o = org.data;

  return (
    <>
      <Link to="/admin/organizations" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> Organizations
      </Link>
      <PageHeader
        eyebrow={<span className="hash">{o.slug}</span>}
        title={o.name}
        description={`${humanize(o.organizationType)}${o.additionalTypes.length ? ` · also ${o.additionalTypes.map(humanize).join(", ")}` : ""} · created ${formatDate(o.createdAt)}`}
        actions={
          can("orgs") &&
          (ACTIONS[o.status] ?? []).map((a) => (
            <Button key={a.action} variant={a.danger ? "danger" : "secondary"} onClick={() => setPending(a)}>
              {a.label}
            </Button>
          ))
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader title={`Members (${o.members.length})`} />
          <Table head={["Name", "Email", "Role", "Status"]}>
            {o.members.map((m) => (
              <tr key={m.id}>
                <Td className="font-semibold">{m.user.fullName}</Td>
                <Td className="text-muted">{m.user.email}</Td>
                <Td>{humanize(m.role)}</Td>
                <Td>
                  <StatusBadge value={m.status} />
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
        <div className="space-y-4">
          <Card className="space-y-2 p-5 text-sm">
            {[
              ["Status", <StatusBadge key="a" value={o.status} />],
              ["Verification", <StatusBadge key="b" value={o.verificationStatus} />],
              ["Legal name", o.legalName ?? "—"],
              ["Country", o.country ?? "—"],
              ["Contact", o.contactEmail ?? "—"],
              ["Website", o.website ?? "—"],
              ["Products / incidents / recalls", `${o._count.products} / ${o._count.incidents} / ${o._count.recalls}`],
            ].map(([k, v]) => (
              <div key={k as string} className="flex justify-between gap-3">
                <span className="text-muted">{k}</span>
                <span className="text-right font-medium text-fg">{v}</span>
              </div>
            ))}
          </Card>
          <Card className="space-y-3 p-5">
            <p className="font-semibold text-fg">Subscription · {o.subscriptionPlan}</p>
            <p className="text-sm text-muted">
              {o.entitlements.usage.products}/{o.entitlements.limits.products} products · {o.entitlements.usage.users}/{o.entitlements.limits.users} users
            </p>
            {can("orgs") && (
              <div className="grid gap-2">
                <Select value={plan.plan} onChange={(e) => setPlan((p) => ({ ...p, plan: e.target.value }))} aria-label="Plan">
                  <option value="">Change plan…</option>
                  {["FREE", "STARTER", "GROWTH", "ENTERPRISE"].map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </Select>
                {plan.plan === "ENTERPRISE" && (
                  <div className="grid grid-cols-2 gap-2">
                    <Input placeholder="Product limit" inputMode="numeric" value={plan.productLimit} onChange={(e) => setPlan((p) => ({ ...p, productLimit: e.target.value }))} />
                    <Input placeholder="User limit" inputMode="numeric" value={plan.userLimit} onChange={(e) => setPlan((p) => ({ ...p, userLimit: e.target.value }))} />
                  </div>
                )}
                <Button variant="secondary" disabled={!plan.plan} loading={sub.isPending} onClick={() => sub.mutate(undefined)}>
                  Update subscription
                </Button>
              </div>
            )}
          </Card>
        </div>
      </div>
      <Modal
        open={Boolean(pending)}
        onClose={() => setPending(null)}
        title={`${pending?.label} ${o.name}`}
        description="Recorded in the audit log with your reason. Verification changes recalculate the trust score of every product this organization registered."
        footer={
          <>
            <Button variant="secondary" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button variant={pending?.danger ? "danger" : "primary"} loading={act.isPending} onClick={() => pending && act.mutate({ action: pending.action })}>
              Confirm
            </Button>
          </>
        }
      >
        <Field label="Reason">{(fid) => <Textarea id={fid} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
      </Modal>
    </>
  );
}
