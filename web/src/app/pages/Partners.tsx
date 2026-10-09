import { useEffect, useState } from "react";
import { BadgeCheck, Check, Handshake, Search, UserPlus, X } from "lucide-react";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Modal, PageHeader, Select, Skeleton, StatusBadge, Tabs } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth, useCan } from "@/lib/auth";
import { formatDate, humanize } from "@/lib/format";
import type { OrgSummary, Relationship } from "@/lib/types";
import { useOrgMutation, useOrgQuery } from "../hooks";

const REL_TYPES = ["SUPPLIER", "DISTRIBUTOR", "LOGISTICS_PROVIDER", "WAREHOUSE", "RETAILER", "CUSTOMER", "PARTNER"];

function RequestModal({ target, onClose }: { target: OrgSummary | null; onClose: () => void }) {
  const [type, setType] = useState("PARTNER");
  const m = useOrgMutation((t: OrgSummary) => api.post("/organizations/current/relationships", { targetOrganizationId: t.id, relationshipType: type }), { success: "Partnership request sent", onSuccess: onClose });
  return (
    <Modal
      open={Boolean(target)}
      onClose={onClose}
      title={`Connect with ${target?.name ?? ""}`}
      description="They must accept before you can transfer custody to each other."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={m.isPending} onClick={() => target && m.mutate(target)}>
            Send request
          </Button>
        </>
      }
    >
      <Field label="They are our…">
        {(id) => (
          <Select id={id} value={type} onChange={(e) => setType(e.target.value)}>
            {REL_TYPES.map((t) => (
              <option key={t} value={t}>
                {humanize(t)}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </Modal>
  );
}

export default function Partners() {
  const { activeOrgId } = useAuth();
  const can = useCan();
  const [tab, setTab] = useState<"network" | "discover">("network");
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [target, setTarget] = useState<OrgSummary | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const rels = useOrgQuery(["relationships"], () => api.get<Relationship[]>("/organizations/current/relationships"));
  const discover = useOrgQuery(["discover", debounced], () => api.page<OrgSummary & { industry: string | null; country: string | null }>("/organizations/current/discover", { q: debounced, pageSize: 24 }), { enabled: tab === "discover" });
  const respond = useOrgMutation(({ id, action }: { id: string; action: "accept" | "reject" | "suspend" }) => api.post(`/organizations/current/relationships/${id}/${action}`), {
    success: "Partnership updated",
  });

  const list = rels.data ?? [];
  const incoming = list.filter((r) => r.status === "REQUESTED" && r.targetOrganizationId === activeOrgId);
  const others = list.filter((r) => !incoming.includes(r));
  const connected = new Set(list.filter((r) => ["ACCEPTED", "REQUESTED"].includes(r.status)).flatMap((r) => [r.sourceOrganizationId, r.targetOrganizationId]));

  return (
    <>
      <PageHeader title="Supply-chain partners" description="Only accepted partners can hand products to each other." />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "network", label: `Your network${incoming.length ? ` · ${incoming.length} new` : ""}` },
          { value: "discover", label: "Find organizations" },
        ]}
      />
      <div className="mt-4 space-y-4">
        {tab === "network" ? (
          <>
            {incoming.length > 0 && (
              <Card>
                <CardHeader title="Requests for you" />
                <ul className="divide-y divide-line">
                  {incoming.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-fg">{r.source.name}</p>
                        <p className="text-sm text-muted">Wants to connect as your {humanize(r.relationshipType).toLowerCase()}</p>
                      </div>
                      {can("relationships:manage") && (
                        <div className="flex gap-2">
                          <Button size="sm" variant="secondary" icon={<X className="h-3.5 w-3.5" />} onClick={() => respond.mutate({ id: r.id, action: "reject" })}>
                            Decline
                          </Button>
                          <Button size="sm" icon={<Check className="h-3.5 w-3.5" />} onClick={() => respond.mutate({ id: r.id, action: "accept" })}>
                            Accept
                          </Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            <Card>
              <CardHeader title="Partnerships" />
              {rels.isLoading ? (
                <Skeleton className="m-5 h-24" />
              ) : others.length ? (
                <ul className="divide-y divide-line">
                  {others.map((r) => {
                    const other = r.sourceOrganizationId === activeOrgId ? r.target : r.source;
                    return (
                      <li key={r.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                        <span className="grid h-10 w-10 place-items-center rounded-xl bg-surface-2 text-xs font-bold text-fg">{other.name.slice(0, 2).toUpperCase()}</span>
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-1.5 font-semibold text-fg">
                            {other.name}
                            {other.verificationStatus === "VERIFIED" && <BadgeCheck className="h-4 w-4 text-ok-600" />}
                          </p>
                          <p className="text-sm text-muted">
                            {humanize(r.relationshipType)} · {r.sourceOrganizationId === activeOrgId ? "you requested" : "they requested"} · {formatDate(r.approvedAt ?? r.createdAt)}
                          </p>
                        </div>
                        <StatusBadge value={r.status} />
                        {r.status === "ACCEPTED" && can("relationships:manage") && (
                          <Button size="sm" variant="ghost" onClick={() => confirm(`Suspend the partnership with ${other.name}? Custody transfers will stop.`) && respond.mutate({ id: r.id, action: "suspend" })}>
                            Suspend
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <EmptyState icon={<Handshake className="h-5 w-5" />} title="No partners yet" description="Find the companies you ship to or receive from." action={<Button onClick={() => setTab("discover")}>Find organizations</Button>} />
              )}
            </Card>
          </>
        ) : (
          <>
            <div className="relative max-w-md">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search organizations" className="pl-10" aria-label="Search organizations" />
            </div>
            {discover.isLoading ? (
              <Skeleton className="h-40 rounded-2xl" />
            ) : discover.data?.items.length ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {discover.data.items.map((o) => (
                  <Card key={o.id} className="flex flex-col p-5">
                    <div className="flex items-start justify-between gap-3">
                      <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-50 text-sm font-bold text-brand-700 dark:bg-brand-500/10">{o.name.slice(0, 2).toUpperCase()}</span>
                      {o.verificationStatus === "VERIFIED" ? <Badge tone="ok">Verified</Badge> : <Badge tone="warn">Unverified</Badge>}
                    </div>
                    <p className="mt-3 font-semibold text-fg">{o.name}</p>
                    <p className="text-sm text-muted">
                      {humanize(o.organizationType ?? "")}
                      {o.industry ? ` · ${o.industry}` : ""}
                      {o.country ? ` · ${o.country}` : ""}
                    </p>
                    <div className="mt-4 flex-1" />
                    {connected.has(o.id) ? (
                      <Badge tone="brand" className="self-start">
                        Connected / pending
                      </Badge>
                    ) : (
                      can("relationships:manage") && (
                        <Button size="sm" variant="secondary" icon={<UserPlus className="h-3.5 w-3.5" />} onClick={() => setTarget(o)} className="self-start">
                          Connect
                        </Button>
                      )
                    )}
                  </Card>
                ))}
              </div>
            ) : (
              <Card>
                <EmptyState title="No organizations found" />
              </Card>
            )}
          </>
        )}
      </div>
      <RequestModal target={target} onClose={() => setTarget(null)} />
    </>
  );
}
