import { Link } from "react-router";
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, ArrowLeftRight, ArrowRight, Blocks, Gauge, Handshake, Package, Plus, ScanLine, Siren } from "lucide-react";
import { Card, CardHeader, EmptyState, ErrorState, PageHeader, Skeleton, Stat, StatusBadge, buttonClass } from "@/components/ui";
import { api, ApiError, errorMessage } from "@/lib/api";
import { useAuth, useCan } from "@/lib/auth";
import { humanize, number, timeAgo } from "@/lib/format";
import type { ProductListItem } from "@/lib/types";
import { CHART, LEVEL_COLOR, RESULT_COLOR, useOrgQuery } from "../hooks";

type Dashboard = {
  products: { registered: number; inCustody: number; visible: number; byStatus: Record<string, number>; byTrustLevel: Record<string, number>; averageTrustScore: number };
  incidents: { open: number; openByType: Record<string, number> };
  recalls: { active: number };
  custody: { pendingIncoming: number; pendingOutgoing: number };
  partners: number;
  verifications30d: { total: number; failed: number; byResult: Record<string, number> };
  blockchain: { proofsByStatus: Record<string, number> };
};

function ChartTooltip({ active, payload }: { active?: boolean; payload?: Array<{ name: string; value: number }> }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-lift">
      <p className="font-semibold text-fg">{humanize(payload[0].name)}</p>
      <p className="text-muted">{number(payload[0].value)}</p>
    </div>
  );
}

export default function Dashboard() {
  const { activeOrg, me } = useAuth();
  const can = useCan();
  const dash = useOrgQuery(["dashboard"], () => api.get<Dashboard>("/analytics/dashboard"), { enabled: can("analytics:read") });
  const recent = useOrgQuery(["products", "recent"], () => api.page<ProductListItem>("/products", { pageSize: 6 }));
  const d = dash.data;

  const trustData = Object.entries(d?.products.byTrustLevel ?? {}).map(([name, value]) => ({ name, value }));
  const verifyData = Object.entries(d?.verifications30d.byResult ?? {}).map(([name, value]) => ({ name, value }));
  const proofs = d?.blockchain.proofsByStatus ?? {};
  const proofTotal = Object.values(proofs).reduce((a, b) => a + b, 0);

  return (
    <>
      <PageHeader
        eyebrow={activeOrg?.name}
        title={`Good ${new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"}, ${me?.fullName.split(" ")[0]}`}
        description="Your products, custody and trust signals at a glance."
        actions={
          can("products:create") && (
            <Link to="/app/products?new=1" className={buttonClass("primary")}>
              <Plus className="h-4 w-4" /> Register product
            </Link>
          )
        }
      />

      {!can("analytics:read") ? null : dash.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32 rounded-2xl" />
          ))}
        </div>
      ) : dash.isError ? (
        <Card>
          <ErrorState message={dash.error instanceof ApiError && dash.error.status === 403 ? "Your role can't view analytics." : errorMessage(dash.error)} onRetry={() => dash.refetch()} />
        </Card>
      ) : d ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Products registered" value={number(d.products.registered)} hint={`${number(d.products.inCustody)} currently in your custody`} icon={<Package className="h-4 w-4" />} tone="brand" />
            <Stat label="Average trust score" value={d.products.averageTrustScore} hint="Across products you registered" icon={<Gauge className="h-4 w-4" />} tone={d.products.averageTrustScore >= 75 ? "ok" : "warn"} />
            <Stat label="Open incidents" value={d.incidents.open} hint={`${d.recalls.active} active recall${d.recalls.active === 1 ? "" : "s"}`} icon={<AlertTriangle className="h-4 w-4" />} tone={d.incidents.open ? "bad" : "ok"} />
            <Stat label="Verifications (30 days)" value={number(d.verifications30d.total)} hint={`${number(d.verifications30d.failed)} did not pass`} icon={<ScanLine className="h-4 w-4" />} tone="info" />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader title="Trust distribution" description="Products by trust level" />
              <div className="h-56 p-4">
                {trustData.length ? (
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie data={trustData} dataKey="value" nameKey="name" innerRadius={52} outerRadius={80} paddingAngle={3} stroke="none">
                        {trustData.map((e) => (
                          <Cell key={e.name} fill={LEVEL_COLOR[e.name] ?? CHART.neutral} />
                        ))}
                      </Pie>
                      <Tooltip content={<ChartTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="grid h-full place-items-center text-sm text-muted">No products yet</p>
                )}
              </div>
              <div className="flex flex-wrap gap-3 px-5 pb-4 text-xs">
                {trustData.map((e) => (
                  <span key={e.name} className="inline-flex items-center gap-1.5 text-muted">
                    <span className="h-2 w-2 rounded-full" style={{ background: LEVEL_COLOR[e.name] }} /> {humanize(e.name)} · {e.value}
                  </span>
                ))}
              </div>
            </Card>

            <Card>
              <CardHeader title="Verification results" description="Consumer & partner scans, last 30 days" />
              <div className="h-64 p-4">
                {verifyData.length ? (
                  <ResponsiveContainer>
                    <BarChart data={verifyData} layout="vertical" margin={{ left: 20 }}>
                      <XAxis type="number" hide />
                      <YAxis type="category" dataKey="name" width={110} tickFormatter={humanize} tick={{ fontSize: 11, fill: "currentColor" }} axisLine={false} tickLine={false} className="text-muted" />
                      <Tooltip content={<ChartTooltip />} cursor={{ fill: CHART.grid }} />
                      <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={14}>
                        {verifyData.map((e) => (
                          <Cell key={e.name} fill={RESULT_COLOR[e.name] ?? CHART.neutral} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="grid h-full place-items-center text-sm text-muted">No scans yet</p>
                )}
              </div>
            </Card>

            <Card className="flex flex-col">
              <CardHeader title="Network & proofs" />
              <div className="grid flex-1 gap-3 p-5">
                <Link to="/app/custody" className="flex items-center gap-3 rounded-xl bg-surface-2 px-4 py-3 transition hover:ring-1 hover:ring-brand-200">
                  <ArrowLeftRight className="h-5 w-5 text-brand-500" />
                  <span className="flex-1 text-sm text-fg">Incoming transfers</span>
                  <span className="font-display text-xl font-bold text-fg">{d.custody.pendingIncoming}</span>
                </Link>
                <Link to="/app/partners" className="flex items-center gap-3 rounded-xl bg-surface-2 px-4 py-3 transition hover:ring-1 hover:ring-brand-200">
                  <Handshake className="h-5 w-5 text-brand-500" />
                  <span className="flex-1 text-sm text-fg">Active partners</span>
                  <span className="font-display text-xl font-bold text-fg">{d.partners}</span>
                </Link>
                <div className="rounded-xl bg-surface-2 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Blocks className="h-5 w-5 text-brand-500" />
                    <span className="flex-1 text-sm text-fg">On-chain proofs</span>
                    <span className="font-display text-xl font-bold text-fg">{number(proofs.CONFIRMED ?? 0)}</span>
                  </div>
                  {proofTotal > 0 && (
                    <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-line">
                      <div style={{ width: `${((proofs.CONFIRMED ?? 0) / proofTotal) * 100}%`, background: CHART.ok }} />
                      <div style={{ width: `${((proofs.PENDING ?? 0) / proofTotal) * 100}%`, background: CHART.warn }} />
                      <div style={{ width: `${((proofs.FAILED ?? 0) / proofTotal) * 100}%`, background: CHART.bad }} />
                    </div>
                  )}
                  {(proofs.PENDING ?? 0) > 0 && <p className="mt-2 text-xs text-muted">{proofs.PENDING} awaiting confirmation</p>}
                </div>
              </div>
            </Card>
          </div>
        </>
      ) : null}

      <Card className="mt-4">
        <CardHeader
          title="Recent products"
          action={
            <Link to="/app/products" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-600 hover:underline">
              View all <ArrowRight className="h-4 w-4" />
            </Link>
          }
        />
        {recent.isLoading ? (
          <div className="space-y-3 p-5">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : recent.data?.items.length ? (
          <ul className="divide-y divide-line">
            {recent.data.items.map((p) => (
              <li key={p.id}>
                <Link to={`/app/products/${p.id}`} className="flex items-center gap-4 px-5 py-3.5 transition hover:bg-surface-2">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-500/10">
                    <Package className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-fg">{p.productName}</span>
                    <span className="block text-xs text-muted">
                      {p.productCode}
                      {p.batch ? ` · Batch ${p.batch.batchCode}` : ""} · {timeAgo(p.createdAt)}
                    </span>
                  </span>
                  <StatusBadge value={p.status} className="hidden sm:inline-flex" />
                  <span className="w-12 text-right font-display text-lg font-bold" style={{ color: LEVEL_COLOR[p.trustLevel] }}>
                    {p.trustScore}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={<Package className="h-5 w-5" />}
            title="No products yet"
            description="Register your first product to create its Digital Product Passport and on-chain identity."
            action={
              can("products:create") && (
                <Link to="/app/products?new=1" className={buttonClass("primary")}>
                  <Plus className="h-4 w-4" /> Register product
                </Link>
              )
            }
          />
        )}
      </Card>

      {d && d.incidents.open > 0 && (
        <Link to="/app/incidents" className="mt-4 flex items-center gap-3 rounded-2xl border border-bad-100 bg-bad-50 px-5 py-4 text-sm text-bad-700 transition hover:shadow-soft dark:border-bad-500/20 dark:bg-bad-500/10">
          <Siren className="h-5 w-5" />
          <span className="flex-1">
            <b>{d.incidents.open} open incident{d.incidents.open > 1 ? "s" : ""}</b> need attention: {Object.entries(d.incidents.openByType).map(([t, n]) => `${humanize(t)} (${n})`).join(", ")}
          </span>
          <ArrowRight className="h-4 w-4" />
        </Link>
      )}
    </>
  );
}

