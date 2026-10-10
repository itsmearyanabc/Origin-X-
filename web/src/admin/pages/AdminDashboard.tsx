import { Link } from "react-router";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, Blocks, Building2, Fingerprint, Package, ScanLine, Siren, Users } from "lucide-react";
import { Badge, Card, CardHeader, EmptyState, ErrorState, PageHeader, Skeleton, Stat, StatusBadge } from "@/components/ui";
import { CHART } from "@/app/hooks";
import { api, errorMessage } from "@/lib/api";
import { formatDate, humanize, number } from "@/lib/format";
import type { ChainStatus, Warehouse } from "@/lib/types";
import { useAdminQuery } from "../hooks";
import { WarehouseMap } from "@/app/inventory/WarehouseMap";
import { useAuth } from "@/lib/auth";

type Dashboard = {
  organizations: { byStatus: Record<string, number>; pendingApproval: number };
  users: number;
  products: number;
  openIncidents: number;
  activeRecalls: number;
  identityCollisions: number;
  verificationsLast24h: number;
  blockchain: { confirmedProofs: number; pendingProofs: number; network: ChainStatus };
};
type Metrics = {
  verificationVolume30d: Array<{ day: string; total: number; failed: number }>;
  verificationFailures30d: number;
  counterfeitAttempts30d: number;
  identityCollisions30d: number;
  productsRecalled: number;
  suspiciousProducts: number;
  mostVerifiedProducts: Array<{ id?: string; productCode?: string; productName?: string; organization?: { name: string }; verifications: number }>;
  organizationsWithUnusualActivity: Array<{ id: string; name: string; status: string; signals: Record<string, number>; total: number }>;
};
type InventoryOverview = { warehouses: number; skus: number; batchesOnHold: number; shipmentsByStatus: Record<string, number>; openDiscrepanciesByType: Record<string, number> };
type InventorySalesOverview = { orders: number; revenue: Array<{ currency: string; revenue: string }> };

export default function AdminDashboard() {
  const { me } = useAuth();
  const dash = useAdminQuery(["dashboard"], () => api.get<Dashboard>("/admin/dashboard", undefined, false), { refetchInterval: 60_000 });
  const metrics = useAdminQuery(["metrics"], () => api.get<Metrics>("/admin/platform-metrics", undefined, false));
  const inventory = useAdminQuery(["inventory"], () => api.get<InventoryOverview>("/admin/inventory/overview", undefined, false));
  const networkWarehouses = useAdminQuery(["inventory", "warehouses"], () => api.get<Array<Warehouse & { organization: { name: string } }>>("/admin/inventory/warehouses", undefined, false));
  const superAdminSales = useAdminQuery(["inventory", "sales-overview"], () => api.get<InventorySalesOverview>("/admin/inventory/sales-overview", undefined, false), { enabled: me?.platformRole === "SUPER_ADMIN" });
  const d = dash.data;
  const m = metrics.data;
  if (dash.isLoading) return <Skeleton className="h-96 rounded-2xl" />;
  if (dash.isError || !d) return <Card><ErrorState message={errorMessage(dash.error)} onRetry={() => dash.refetch()} /></Card>;
  const chain = d.blockchain.network;

  return (
    <>
      <PageHeader eyebrow="ORIGINX platform" title="Platform overview" description="Tenants, trust signals and network health across every organization." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Organizations" value={number(Object.values(d.organizations.byStatus).reduce((a, b) => a + b, 0))} hint={<Link to="/admin/organizations?status=PENDING" className="font-semibold text-brand-600">{d.organizations.pendingApproval} awaiting approval →</Link>} icon={<Building2 className="h-4 w-4" />} tone="brand" />
        <Stat label="Products" value={number(d.products)} hint={`${number(d.users)} users`} icon={<Package className="h-4 w-4" />} tone="info" />
        <Stat label="Verifications (24h)" value={number(d.verificationsLast24h)} hint={m ? `${number(m.verificationFailures30d)} failures in 30 days` : undefined} icon={<ScanLine className="h-4 w-4" />} tone="ok" />
        <Stat label="Open incidents" value={d.openIncidents} hint={`${d.activeRecalls} active recall${d.activeRecalls === 1 ? "" : "s"} · ${d.identityCollisions} identity collision${d.identityCollisions === 1 ? "" : "s"}`} icon={<AlertTriangle className="h-4 w-4" />} tone={d.openIncidents ? "bad" : "ok"} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Verification volume" description="Last 30 days — total vs. failed (unknown, suspicious, counterfeit, compromised)" />
          <div className="h-64 p-4">
            {m?.verificationVolume30d.length ? (
              <ResponsiveContainer>
                <AreaChart data={m.verificationVolume30d.map((p) => ({ ...p, day: formatDate(p.day) }))}>
                  <defs>
                    <linearGradient id="vol" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor={CHART.brand} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={CHART.brand} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={CHART.grid} vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={32} />
                  <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} />
                  <Area type="monotone" dataKey="total" stroke={CHART.brand} fill="url(#vol)" strokeWidth={2.5} />
                  <Area type="monotone" dataKey="failed" stroke={CHART.bad} fill="transparent" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <p className="grid h-full place-items-center text-sm text-muted">No verifications yet</p>
            )}
          </div>
        </Card>
        <Card className="p-5">
          <p className="flex items-center gap-2 font-semibold text-fg">
            <Blocks className="h-4 w-4 text-brand-500" /> Blockchain
          </p>
          <div className="mt-4 space-y-2 text-sm">
            {[
              ["Network", `${chain.network}${chain.chainId ? ` · ${chain.chainId}` : ""}`],
              ["Status", <StatusBadge key="s" value={chain.available ? "ACTIVE" : chain.configured ? "UNAVAILABLE" : "NOT_ANCHORED"} />],
              ["Confirmed proofs", number(d.blockchain.confirmedProofs)],
              ["Pending proofs", number(d.blockchain.pendingProofs)],
              ["On-chain identities", chain.onChainIdentityCount ?? "—"],
            ].map(([k, v]) => (
              <div key={k as string} className="flex justify-between gap-3">
                <span className="text-muted">{k}</span>
                <span className="font-medium text-fg">{v}</span>
              </div>
            ))}
          </div>
          {chain.reason && <p className="mt-3 text-xs text-warn-700">{chain.reason}</p>}
          <Link to="/admin/blockchain" className="mt-4 inline-block text-sm font-semibold text-brand-600">
            Proof explorer →
          </Link>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Trust signals (30 days)" />
          <div className="grid grid-cols-2 gap-3 p-5 text-sm">
            {m &&
              [
                [Fingerprint, "Counterfeit scans", m.counterfeitAttempts30d],
                [AlertTriangle, "Identity collisions", m.identityCollisions30d],
                [Siren, "Products recalled", m.productsRecalled],
                [Users, "High-risk products", m.suspiciousProducts],
              ].map(([Icon, label, value]) => {
                const I = Icon as typeof Fingerprint;
                return (
                  <div key={label as string} className="rounded-xl bg-surface-2 p-3">
                    <I className="h-4 w-4 text-brand-500" />
                    <p className="mt-2 font-display text-2xl font-bold text-fg">{value as number}</p>
                    <p className="text-xs text-muted">{label as string}</p>
                  </div>
                );
              })}
          </div>
        </Card>
        <Card>
          <CardHeader title="Unusual activity" description="Organizations with integrity or fraud signals" />
          {m?.organizationsWithUnusualActivity.length ? (
            <ul className="divide-y divide-line">
              {m.organizationsWithUnusualActivity.slice(0, 6).map((o) => (
                <li key={o.id} className="px-5 py-3 text-sm">
                  <Link to={`/admin/organizations/${o.id}`} className="font-semibold text-fg hover:text-brand-600">
                    {o.name}
                  </Link>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {Object.entries(o.signals).map(([k, v]) => (
                      <Badge key={k} tone="bad">
                        {humanize(k)} · {v}
                      </Badge>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Nothing unusual" />
          )}
        </Card>
        <Card>
          <CardHeader title="Inventory network" />
          {inventory.data ? (
            <div className="space-y-2 p-5 text-sm">
              {[
                ["Warehouses", inventory.data.warehouses],
                ["SKUs", inventory.data.skus],
                ["Batches on hold", inventory.data.batchesOnHold],
                ["Shipments in transit", (inventory.data.shipmentsByStatus.DISPATCHED ?? 0) + (inventory.data.shipmentsByStatus.PARTIALLY_RECEIVED ?? 0)],
                ["Open inventory discrepancies", Object.values(inventory.data.openDiscrepanciesByType).reduce((a, b) => a + b, 0)],
                ...(me?.platformRole === "SUPER_ADMIN" ? [["Recorded sales (30d)", superAdminSales.data?.orders ?? 0], ["Sales revenue (30d)", superAdminSales.data?.revenue.map((r) => `${r.currency} ${Number(r.revenue).toLocaleString()}`).join(" · ") || "—"]] : []),
              ].map(([k, v]) => (
                <div key={k as string} className="flex justify-between">
                  <span className="text-muted">{k}</span>
                  <span className="font-semibold text-fg">{v as number}</span>
                </div>
              ))}
            </div>
          ) : (
            <Skeleton className="m-5 h-24" />
          )}
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="Warehouse network map" description="All mapped locations across ORIGINX organizations." />
        {networkWarehouses.data ? <div className="p-4"><WarehouseMap warehouses={networkWarehouses.data} /></div> : <Skeleton className="m-5 h-56 rounded-xl" />}
      </Card>

      {m && m.mostVerifiedProducts.length > 0 && (
        <Card className="mt-4">
          <CardHeader title="Most verified products" />
          <ul className="divide-y divide-line">
            {m.mostVerifiedProducts.map((p) => (
              <li key={p.id} className="flex items-center gap-4 px-5 py-3 text-sm">
                <span className="flex-1">
                  <span className="font-semibold text-fg">{p.productName}</span> <span className="hash text-muted">{p.productCode}</span>
                </span>
                <span className="text-muted">{p.organization?.name}</span>
                <span className="font-display text-lg font-bold text-fg">{p.verifications}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
