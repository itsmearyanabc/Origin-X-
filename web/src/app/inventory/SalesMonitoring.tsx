import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { Activity, ClipboardList, Package, TriangleAlert } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge, Card, CardHeader, EmptyState, ErrorState, PageHeader, Select, Skeleton, Stat, buttonClass } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useCan } from "@/lib/auth";
import type { InventoryAlerts, SkuStock } from "@/lib/types";
import { Link } from "react-router";
import { useOrgQuery } from "../hooks";
import { fmtQty, useSkus } from "./shared";

type Period = "7d" | "30d" | "90d" | "12m";
type SalesMonitoringData = {
  period: Period;
  from: string;
  to: string;
  previousFrom: string;
  dispatches: number;
  uniqueProducts: number;
  trend: Array<{ period: string; unitOfMeasure: string; quantity: string; dispatches: number }>;
  totalsByUnit: Array<{ unitOfMeasure: string; quantity: string; dispatches: number }>;
  previousTotalsByUnit: Array<{ unitOfMeasure: string; quantity: string; dispatches: number }>;
  topProducts: Array<{ skuId: string; sku: string; name: string; unitOfMeasure: string; quantity: string; dispatches: number }>;
};

const PERIODS: Array<{ value: Period; label: string }> = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "12m", label: "Last 12 months" },
];

const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const dateLabel = (value: string, period: Period) => {
  const date = new Date(value);
  return date.toLocaleDateString(undefined, period === "12m" ? { month: "short", year: "2-digit" } : { day: "numeric", month: "short" });
};

function changeText(current: number, previous: number) {
  if (previous <= 0) return current > 0 ? "New activity in this period" : "No dispatches in either period";
  const change = ((current - previous) / previous) * 100;
  return `${change > 0 ? "+" : ""}${Math.round(change)}% vs previous period`;
}

export default function SalesMonitoring() {
  const can = useCan();
  const [period, setPeriod] = useState<Period>("30d");
  const [unit, setUnit] = useState("");
  const report = useOrgQuery(["sales-monitoring", period], () => api.get<SalesMonitoringData>("/inventory/sales-monitoring", { period }));
  const alerts = useOrgQuery(["inventory", "alerts"], () => api.get<InventoryAlerts>("/inventory/alerts"));
  const skus = useSkus();

  const units = useMemo(() => {
    const values = new Set<string>([
      ...(skus.data ?? []).map((sku: SkuStock) => sku.unitOfMeasure),
      ...(report.data?.totalsByUnit ?? []).map((row) => row.unitOfMeasure),
    ]);
    return [...values].sort((a, b) => a.localeCompare(b));
  }, [skus.data, report.data?.totalsByUnit]);
  const selectedUnit = units.includes(unit) ? unit : units[0] ?? "PCS";
  const current = report.data?.totalsByUnit.find((row) => row.unitOfMeasure === selectedUnit);
  const previous = report.data?.previousTotalsByUnit.find((row) => row.unitOfMeasure === selectedUnit);
  const currentQty = Number(current?.quantity ?? 0);
  const previousQty = Number(previous?.quantity ?? 0);
  const series = (report.data?.trend ?? [])
    .filter((row) => row.unitOfMeasure === selectedUnit)
    .map((row) => ({ label: dateLabel(row.period, period), quantity: Number(row.quantity), dispatches: row.dispatches }));
  const topProducts = (report.data?.topProducts ?? []).filter((row) => row.unitOfMeasure === selectedUnit).slice(0, 5);
  const maxProductQty = Math.max(1, ...topProducts.map((product) => Number(product.quantity)));
  const lowStock = alerts.data?.lowStock.slice(0, 5) ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Inventory intelligence"
        title="Sales monitor"
        description="Track recorded external dispatches alongside the stock and replenishment signals that support them."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select aria-label="Sales period" value={period} onChange={(event) => setPeriod(event.target.value as Period)}>
              {PERIODS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </Select>
            {can("inventory:dispatch") && <Link to="/app/inventory/movements?new=dispatch&type=DISPATCH" className={buttonClass("primary")}>Record dispatch</Link>}
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-brand-200 bg-brand-50/70 px-4 py-3 text-sm text-brand-900 dark:border-brand-500/20 dark:bg-brand-500/10 dark:text-brand-100">
        <Activity className="h-4 w-4 shrink-0" />
        <span>Sales activity is measured from completed “Dispatch outside ORIGINX” movements. Revenue and order totals are not shown because ORIGINX does not yet record prices or sales orders.</span>
      </div>

      {report.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}</div>
      ) : report.isError ? (
        <Card><ErrorState message={errorMessage(report.error)} onRetry={() => report.refetch()} /></Card>
      ) : report.data ? (
        <>
          <motion.div initial="hidden" animate="visible" variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.08 } } }} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: `Units dispatched · ${selectedUnit}`, value: fmtQty(currentQty), hint: changeText(currentQty, previousQty), icon: <Activity className="h-4 w-4" />, tone: "brand" as const },
              { label: "Dispatch records", value: number.format(report.data.dispatches), hint: "Completed external dispatches", icon: <ClipboardList className="h-4 w-4" />, tone: "info" as const },
              { label: "Products moved", value: number.format(report.data.uniqueProducts), hint: "Unique SKUs in this period", icon: <Package className="h-4 w-4" />, tone: "ok" as const },
              { label: "Low stock", value: number.format(alerts.data?.lowStock.length ?? 0), hint: "SKUs at or below their reorder threshold", icon: <TriangleAlert className="h-4 w-4" />, tone: (alerts.data?.lowStock.length ?? 0) ? "warn" as const : "neutral" as const },
            ].map((item) => (
              <motion.div key={item.label} variants={{ hidden: { opacity: 0, y: 14 }, visible: { opacity: 1, y: 0 } }} transition={{ duration: 0.35, ease: "easeOut" }}>
                <Stat {...item} />
              </motion.div>
            ))}
          </motion.div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(320px,1fr)]">
            <Card className="min-w-0 overflow-hidden">
              <CardHeader title="Dispatch trend" description={`${PERIODS.find((option) => option.value === period)?.label} · ${selectedUnit}`} action={<Badge tone="info">Live ledger data</Badge>} />
              {series.length ? (
                <div className="h-[310px] p-4 pt-6 sm:h-[360px] sm:p-6">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={series} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
                      <defs>
                        <linearGradient id="salesDispatchFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#f25c05" stopOpacity={0.28} />
                          <stop offset="95%" stopColor="#f25c05" stopOpacity={0.015} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid vertical={false} stroke="rgb(168 153 139 / 0.22)" strokeDasharray="4 6" />
                      <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#8a8179" }} minTickGap={22} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#8a8179" }} width={52} tickFormatter={(value) => number.format(Number(value))} />
                      <Tooltip formatter={(value) => [`${fmtQty(Number(value))} ${selectedUnit}`, "Dispatched"]} contentStyle={{ borderRadius: 14, borderColor: "#e7e2dc", boxShadow: "0 12px 32px -20px rgba(23,32,51,.4)" }} />
                      <Area type="monotone" dataKey="quantity" name="Dispatched" stroke="#f25c05" strokeWidth={3} fill="url(#salesDispatchFill)" activeDot={{ r: 5, strokeWidth: 0, fill: "#f25c05" }} isAnimationActive animationDuration={1000} animationEasing="ease-out" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <EmptyState icon={<Activity className="h-5 w-5" />} title="No dispatches in this period" description="Record completed sales or deliveries as “Dispatch outside ORIGINX” to see the trend here." action={can("inventory:dispatch") ? <Link to="/app/inventory/movements?new=dispatch&type=DISPATCH" className={buttonClass("primary")}>Record a dispatch</Link> : undefined} />
              )}
            </Card>

            <Card className="min-w-0">
              <CardHeader title="Top dispatched products" description={`Ranked by quantity · ${selectedUnit}`} action={units.length > 1 ? <Select aria-label="Unit of measure" value={selectedUnit} onChange={(event) => setUnit(event.target.value)}>{units.map((value) => <option key={value} value={value}>{value}</option>)}</Select> : undefined} />
              {topProducts.length ? (
                <ol className="divide-y divide-line">
                  {topProducts.map((product, index) => (
                    <motion.li key={product.skuId} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: index * 0.07, duration: 0.3 }}>
                      <Link to={`/app/inventory/products/${product.skuId}`} className="block px-5 py-4 transition hover:bg-surface-2">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0"><p className="truncate text-sm font-semibold text-fg">{product.name}</p><p className="mt-0.5 font-mono text-xs text-muted">{product.sku}</p></div>
                          <span className="shrink-0 text-right"><span className="block font-display text-lg font-bold tabular-nums text-fg">{fmtQty(product.quantity)}</span><span className="text-[11px] text-muted">{product.unitOfMeasure}</span></span>
                        </div>
                        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2"><motion.div initial={{ width: 0 }} animate={{ width: `${Math.max(4, Number(product.quantity) / maxProductQty * 100)}%` }} transition={{ delay: 0.12 + index * 0.07, duration: 0.75, ease: "easeOut" }} className="h-full rounded-full bg-gradient-to-r from-brand-500 to-orange-300" /></div>
                      </Link>
                    </motion.li>
                  ))}
                </ol>
              ) : (
                <EmptyState icon={<Package className="h-5 w-5" />} title="Product rankings will appear here" description="Once a dispatch is recorded, this panel highlights which SKUs are moving most." />
              )}
            </Card>
          </div>

          <Card className="mt-4">
            <CardHeader title="Replenishment watch" description="Low stock products can constrain future dispatches." action={<Link to="/app/inventory/products" className="text-sm font-semibold text-brand-600 hover:underline">Open stock catalog →</Link>} />
            {alerts.isLoading ? <Skeleton className="m-5 h-24" /> : alerts.isError ? <div className="p-5"><ErrorState message={errorMessage(alerts.error)} onRetry={() => alerts.refetch()} /></div> : lowStock.length ? (
              <ul className="divide-y divide-line">
                {lowStock.map((item) => (
                  <li key={item.skuId} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                    <Badge tone="warn">Reorder</Badge>
                    <Link to={`/app/inventory/products/${item.skuId}`} className="min-w-0 flex-1 font-medium text-fg hover:text-brand-600">{item.sku} · {item.name}</Link>
                    <span className="text-muted">Available <b className="font-semibold text-fg">{fmtQty(item.available)} {item.unitOfMeasure}</b> · threshold {fmtQty(item.threshold)} {item.unitOfMeasure}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={<Package className="h-5 w-5" />} title="No reorder alerts" description="Set a threshold on a product to get an early warning when stock runs low." action={<Link to="/app/inventory/products" className={buttonClass("secondary")}>Review stock levels</Link>} />
            )}
          </Card>
        </>
      ) : null}
    </>
  );
}
