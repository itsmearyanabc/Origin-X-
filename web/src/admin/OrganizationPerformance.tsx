import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BadgeCheck, Blocks, Boxes, Package, ScanLine, ShieldAlert, ShoppingCart, Siren } from "lucide-react";
import { Card, CardHeader, EmptyState, Skeleton, Stat } from "@/components/ui";
import { CHART } from "@/app/hooks";
import { api } from "@/lib/api";
import { formatDate, humanize } from "@/lib/format";
import { useAdminQuery } from "./hooks";

export type Performance = {
  kpis: {
    products: number;
    warehouses: number;
    openIncidents: number;
    activeRecalls: number;
    completedCustodyTransfers: number;
    averageTrustScore: number | null;
    scans30d: number;
    failedScans30d: number;
    orders30d: number;
    revenue30d: Array<{ currency: string; revenue: string }>;
  };
  verificationsByDay: Array<{ day: string; total: number; failed: number }>;
  salesByDay: Array<{ day: string; orders: number } & Record<string, number | string>>;
  salesCurrencies: string[];
  verificationResults: Record<string, number>;
  trustLevels: Record<string, number>;
  productStatus: Record<string, number>;
  proofs: Record<string, number>;
};

const TONE: Record<string, string> = {
  EXCELLENT: CHART.ok, TRUSTED: CHART.okSoft, CAUTION: CHART.warn, HIGH_RISK: CHART.bad,
  HISTORY_VERIFIED: CHART.ok, AUTHENTIC: CHART.okSoft, RECALLED: CHART.warn, SUSPICIOUS: CHART.warn, COUNTERFEIT: CHART.bad, HISTORY_COMPROMISED: CHART.bad, UNKNOWN: CHART.neutral,
  CONFIRMED: CHART.ok, PENDING: CHART.warn, FAILED: CHART.bad,
  ACTIVE: CHART.ok, DELIVERED: CHART.okSoft, IN_TRANSIT: CHART.brandSoft, QUARANTINED: CHART.bad,
};

/** A compact proportional bar: one coloured segment per key, with counts. */
function Breakdown({ title, data }: { title: string; data: Record<string, number> }) {
  const entries = Object.entries(data).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, n]) => s + n, 0);
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</p>
      {total ? (
        <>
          <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-surface-2">
            {entries.map(([k, n]) => <div key={k} style={{ width: `${(n / total) * 100}%`, background: TONE[k] ?? CHART.neutral }} title={`${humanize(k)}: ${n}`} />)}
          </div>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            {entries.map(([k, n]) => (
              <li key={k} className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: TONE[k] ?? CHART.neutral }} />
                {humanize(k)} <span className="font-semibold text-fg">{n}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-2 text-sm text-muted">No data yet</p>
      )}
    </div>
  );
}

export function OrganizationPerformance({ organizationId }: { organizationId: string }) {
  const q = useAdminQuery(["org-performance", organizationId], () => api.get<Performance>(`/admin/organizations/${organizationId}/performance`, undefined, false));
  if (q.isLoading) return <Skeleton className="mb-4 h-72 rounded-2xl" />;
  const p = q.data;
  if (!p) return null;
  const k = p.kpis;
  const currency = p.salesCurrencies[0];
  const revenue = k.revenue30d.map((r) => `${r.currency} ${Number(r.revenue).toLocaleString()}`).join(" · ") || "—";
  const scans = p.verificationsByDay.map((d) => ({ label: formatDate(d.day), passed: d.total - d.failed, failed: d.failed }));
  const sales = p.salesByDay.map((d) => ({ ...d, label: formatDate(d.day) }));
  return (
    <section className="mb-4 space-y-4" aria-label="Performance">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Products" value={k.products} hint={`${k.completedCustodyTransfers} custody handoffs`} icon={<Package className="h-4 w-4" />} />
        <Stat label="Avg. trust score" value={k.averageTrustScore ?? "—"} hint="across this organization's passports" icon={<BadgeCheck className="h-4 w-4" />} tone={k.averageTrustScore === null ? "neutral" : k.averageTrustScore >= 80 ? "ok" : k.averageTrustScore >= 50 ? "warn" : "bad"} />
        <Stat label="Scans (30d)" value={k.scans30d} hint={`${k.failedScans30d} failed or suspicious`} icon={<ScanLine className="h-4 w-4" />} tone={k.failedScans30d ? "warn" : "ok"} />
        <Stat label="Sales (30d)" value={k.orders30d} hint={revenue} icon={<ShoppingCart className="h-4 w-4" />} />
        <Stat label="Warehouses" value={k.warehouses} icon={<Boxes className="h-4 w-4" />} />
        <Stat label="Open incidents" value={k.openIncidents} icon={<ShieldAlert className="h-4 w-4" />} tone={k.openIncidents ? "bad" : "ok"} />
        <Stat label="Active recalls" value={k.activeRecalls} icon={<Siren className="h-4 w-4" />} tone={k.activeRecalls ? "warn" : "ok"} />
        <Stat label="Blockchain proofs" value={Object.values(p.proofs).reduce((s, n) => s + n, 0)} hint={`${p.proofs.CONFIRMED ?? 0} confirmed · ${p.proofs.PENDING ?? 0} pending`} icon={<Blocks className="h-4 w-4" />} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Consumer verifications" description="Last 30 days — scans of this organization's products per day" />
          <div className="h-60 p-4">
            {k.scans30d ? (
              <ResponsiveContainer>
                <BarChart data={scans}>
                  <CartesianGrid stroke={CHART.grid} vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={24} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={32} />
                  <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} cursor={{ fill: CHART.grid }} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="passed" name="Verified scans" stackId="s" fill={CHART.ok} />
                  <Bar dataKey="failed" name="Failed / suspicious" stackId="s" fill={CHART.bad} radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState icon={<ScanLine className="h-5 w-5" />} title="No scans in the last 30 days" />
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title="Recorded sales" description={currency ? `Last 30 days — revenue per day (${currency})` : "Last 30 days"} />
          <div className="h-60 p-4">
            {currency ? (
              <ResponsiveContainer>
                <BarChart data={sales}>
                  <CartesianGrid stroke={CHART.grid} vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={24} />
                  <YAxis tick={{ fontSize: 11 }} width={56} />
                  <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} />
                  <Bar dataKey={currency} name={`Revenue (${currency})`} fill={CHART.brand} radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState icon={<ShoppingCart className="h-5 w-5" />} title="No recorded sales in the last 30 days" />
            )}
          </div>
        </Card>
      </div>

      <Card className="grid gap-6 p-5 md:grid-cols-2">
        <Breakdown title="Trust levels" data={p.trustLevels} />
        <Breakdown title="Product status" data={p.productStatus} />
        <Breakdown title="Scan results (30d)" data={p.verificationResults} />
        <Breakdown title="Blockchain proofs" data={p.proofs} />
      </Card>
    </section>
  );
}
