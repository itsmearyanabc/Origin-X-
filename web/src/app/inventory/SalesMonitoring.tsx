import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { Activity, ClipboardList, Package, Plus, ReceiptText, TriangleAlert, Trash2 } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, Field, Input, Modal, PageHeader, Select, Skeleton, Stat, buttonClass } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useCan } from "@/lib/auth";
import type { Balance, InventoryAlerts, SkuStock } from "@/lib/types";
import { Link } from "react-router";
import { useOrgMutation, useOrgQuery } from "../hooks";
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

type RecordedSales = {
  totals: Array<{ currency: string; revenue: string; orders: number; units: string }>;
  previousTotals: Array<{ currency: string; revenue: string; orders: number; units: string }>;
  trend: Array<{ period: string; currency: string; revenue: string; orders: number }>;
  orders: number;
  topProducts: Array<{ skuId: string; sku: string; name: string; unitOfMeasure: string; quantity: string; revenue: string; currency: string }>;
  recent: Array<{ id: string; reference: string; customerName: string; currency: string; soldAt: string; items: Array<{ productName: string; sku: string; quantity: string; unitOfMeasure: string; unitPrice: string; lineTotal: string }> }>;
};
type SaleLine = { balanceId: string; quantity: string; unitPrice: string };

function RecordSaleModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [customer, setCustomer] = useState("");
  const [currency, setCurrency] = useState("INR");
  const [lines, setLines] = useState<SaleLine[]>([{ balanceId: "", quantity: "1", unitPrice: "" }]);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const balances = useOrgQuery(["inventory", "sale-stock"], () => api.page<Balance>("/inventory/balances", { pageSize: 100 }), { enabled: open });
  const usable = (balances.data?.items ?? []).filter((b) => Number(b.available) > 0 && b.batch?.holdStatus !== "QUARANTINED" && b.batch?.holdStatus !== "RECALLED" && b.batch?.qualityStatus !== "REJECTED");
  const mutation = useOrgMutation(() => api.post("/sales", {
    customerName: customer,
    currency,
    items: lines.map((line) => {
      const balance = usable.find((b) => b.id === line.balanceId)!;
      return { skuId: balance.skuId, batchId: balance.batchId, locationId: balance.locationId, quantity: line.quantity, unitPrice: line.unitPrice };
    }),
  }, true, idempotencyKey), { success: "Sale recorded and stock updated", onSuccess: () => { setCustomer(""); setLines([{ balanceId: "", quantity: "1", unitPrice: "" }]); setIdempotencyKey(crypto.randomUUID()); onClose(); } });
  const total = lines.reduce((sum, line) => sum + (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0), 0);
  return <Modal open={open} onClose={onClose} title="Record a sale" description="Saving also posts a completed stock dispatch to the inventory ledger." size="lg" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={mutation.isPending} disabled={!customer.trim() || lines.some((line) => !line.balanceId || !line.unitPrice || Number(line.quantity) <= 0 || Number(line.unitPrice) <= 0)} onClick={() => mutation.mutate(undefined)}>Record sale · {new Intl.NumberFormat(undefined, { style: "currency", currency }).format(total)}</Button></>}>
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Customer" required>{(id) => <Input id={id} value={customer} onChange={(e) => { setCustomer(e.target.value); setIdempotencyKey(crypto.randomUUID()); }} placeholder="Customer or business name" />}</Field>
      <Field label="Currency" required>{(id) => <Select id={id} value={currency} onChange={(e) => { setCurrency(e.target.value); setIdempotencyKey(crypto.randomUUID()); }}>{["INR", "USD", "EUR", "GBP", "AED"].map((value) => <option key={value}>{value}</option>)}</Select>}</Field>
    </div>
    <div className="mt-5 space-y-3">
      <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">Sale items</h3><Button size="sm" variant="secondary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => { setLines((current) => [...current, { balanceId: "", quantity: "1", unitPrice: "" }]); setIdempotencyKey(crypto.randomUUID()); }}>Add item</Button></div>
      {balances.isLoading ? <Skeleton className="h-20 rounded-xl" /> : lines.map((line, index) => <div key={index} className="grid gap-2 rounded-xl border border-line p-3 sm:grid-cols-[minmax(0,2fr)_1fr_1fr_auto]">
        <Field label="Product · location · batch" required>{(id) => <Select id={id} value={line.balanceId} onChange={(e) => { setLines((rows) => rows.map((r, i) => i === index ? { ...r, balanceId: e.target.value } : r)); setIdempotencyKey(crypto.randomUUID()); }}><option value="">Select stock…</option>{usable.map((b) => <option key={b.id} value={b.id}>{b.sku?.sku} · {b.location?.warehouse?.name || "Warehouse"}/{b.location?.code} · {b.batch?.batchCode || "No batch"} · {fmtQty(b.available)} {b.unitOfMeasure}</option>)}</Select>}</Field>
        <Field label="Quantity" required>{(id) => <Input id={id} type="number" min="0.0001" step="any" value={line.quantity} onChange={(e) => { setLines((rows) => rows.map((r, i) => i === index ? { ...r, quantity: e.target.value } : r)); setIdempotencyKey(crypto.randomUUID()); }} />}</Field>
        <Field label={`Price / unit (${currency})`} required>{(id) => <Input id={id} type="number" min="0.01" step="0.01" value={line.unitPrice} onChange={(e) => { setLines((rows) => rows.map((r, i) => i === index ? { ...r, unitPrice: e.target.value } : r)); setIdempotencyKey(crypto.randomUUID()); }} />}</Field>
        <button className="mt-6 rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-bad-600 disabled:opacity-30" disabled={lines.length === 1} onClick={() => { setLines((rows) => rows.filter((_, i) => i !== index)); setIdempotencyKey(crypto.randomUUID()); }} aria-label="Remove item"><Trash2 className="h-4 w-4" /></button>
      </div>)}
      {!balances.isLoading && usable.length === 0 && <EmptyState title="No available stock" description="Receive stock before recording a sale." />}
    </div>
  </Modal>;
}

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
  const [recording, setRecording] = useState(false);
  const [currency, setCurrency] = useState("INR");
  const report = useOrgQuery(["dispatch-monitoring", period], () => api.get<SalesMonitoringData>("/inventory/dispatch-monitoring", { period }));
  const sales = useOrgQuery(["sales-monitoring", period], () => api.get<RecordedSales>("/inventory/sales-monitoring", { period }));
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
  const revenueRows = sales.data?.totals ?? [];
  const currencies = [...new Set(revenueRows.map((row) => row.currency))];
  const activeCurrency = currencies.includes(currency) ? currency : currencies[0] ?? "INR";
  const revenue = revenueRows.find((row) => row.currency === activeCurrency);
  const prevRevenue = sales.data?.previousTotals.find((row) => row.currency === activeCurrency);
  const money = (amount: string | number, code = activeCurrency) => new Intl.NumberFormat(undefined, { style: "currency", currency: code, maximumFractionDigits: 0 }).format(Number(amount));
  const revenueSeries = (sales.data?.trend ?? []).filter((row) => row.currency === activeCurrency).map((row) => ({ label: dateLabel(row.period, period), revenue: Number(row.revenue), orders: row.orders }));

  return (
    <>
      <PageHeader
        eyebrow="Inventory intelligence"
        title="Sales monitor"
        description="Revenue and order activity from recorded sales, linked to stock movements and replenishment signals."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select aria-label="Sales period" value={period} onChange={(event) => setPeriod(event.target.value as Period)}>
              {PERIODS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </Select>
            {can("inventory:dispatch") && <Button onClick={() => setRecording(true)}>Record sale</Button>}
            {can("inventory:dispatch") && <Link to="/app/inventory/movements?new=dispatch&type=DISPATCH" className={buttonClass("secondary")}>Record dispatch</Link>}
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-brand-200 bg-brand-50/70 px-4 py-3 text-sm text-brand-900 dark:border-brand-500/20 dark:bg-brand-500/10 dark:text-brand-100">
        <Activity className="h-4 w-4 shrink-0" />
        <span>Revenue is calculated from recorded sales and saved price snapshots. General dispatches remain separate and are not counted as sales.</span>
      </div>

      <Card className="mb-4 overflow-hidden">
        <CardHeader title="Recorded sales" description={`${PERIODS.find((option) => option.value === period)?.label} · prices captured at sale time`} action={<div className="flex items-center gap-2">{currencies.length > 1 && <Select aria-label="Revenue currency" value={activeCurrency} onChange={(e) => setCurrency(e.target.value)}>{currencies.map((value) => <option key={value}>{value}</option>)}</Select>}<Badge tone="ok">Ledger linked</Badge></div>} />
        {sales.isLoading ? <div className="grid gap-4 p-5 sm:grid-cols-3"><Skeleton className="h-28 rounded-xl" /><Skeleton className="h-28 rounded-xl" /><Skeleton className="h-28 rounded-xl" /></div> : sales.isError ? <div className="p-5"><ErrorState message={errorMessage(sales.error)} onRetry={() => sales.refetch()} /></div> : sales.data ? <>
          <div className="grid gap-4 p-5 sm:grid-cols-3">
            <Stat label={`Sales revenue · ${activeCurrency}`} value={money(revenue?.revenue ?? 0)} hint={revenue ? changeText(Number(revenue.revenue), Number(prevRevenue?.revenue ?? 0)) : "No recorded sales in this period"} icon={<Activity className="h-4 w-4" />} tone="brand" />
            <Stat label="Sales orders" value={number.format(revenue?.orders ?? 0)} hint="Completed orders recorded in this period" icon={<ReceiptText className="h-4 w-4" />} tone="ok" />
            <Stat label="Units sold" value={number.format(Number(revenue?.units ?? 0))} hint="Across all catalogue items" icon={<Package className="h-4 w-4" />} tone="info" />
          </div>
          <div className="grid gap-4 border-t border-line p-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(300px,1fr)]">
            <section><h3 className="mb-2 text-sm font-semibold text-fg">Revenue trend</h3>{revenueSeries.length ? <div className="h-[280px]"><ResponsiveContainer width="100%" height="100%"><AreaChart data={revenueSeries} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}><defs><linearGradient id="recordedRevenueFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#f25c05" stopOpacity={0.3} /><stop offset="95%" stopColor="#f25c05" stopOpacity={0.02} /></linearGradient></defs><CartesianGrid vertical={false} stroke="rgb(168 153 139 / 0.22)" strokeDasharray="4 6" /><XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#8a8179" }} minTickGap={22} /><YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#8a8179" }} width={60} tickFormatter={(value) => number.format(Number(value))} /><Tooltip formatter={(value) => [money(Number(value)), "Revenue"]} contentStyle={{ borderRadius: 14, borderColor: "#e7e2dc" }} /><Area type="monotone" dataKey="revenue" stroke="#f25c05" strokeWidth={3} fill="url(#recordedRevenueFill)" activeDot={{ r: 5, strokeWidth: 0 }} isAnimationActive animationDuration={1000} animationEasing="ease-out" /></AreaChart></ResponsiveContainer></div> : <EmptyState icon={<Activity className="h-5 w-5" />} title="No sales recorded in this period" description="Record a sale to begin tracking revenue and order trends." action={can("inventory:dispatch") ? <Button onClick={() => setRecording(true)}>Record first sale</Button> : undefined} />}</section>
            <section><h3 className="mb-2 text-sm font-semibold text-fg">Top selling products</h3>{sales.data.topProducts.filter((p) => p.currency === activeCurrency).length ? <ol className="divide-y divide-line">{sales.data.topProducts.filter((p) => p.currency === activeCurrency).slice(0, 5).map((p, i) => <motion.li key={p.skuId} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.06 }} className="flex items-center justify-between gap-3 py-3"><div className="min-w-0"><p className="truncate text-sm font-medium">{p.name}</p><p className="font-mono text-xs text-muted">{p.sku} · {fmtQty(p.quantity)} {p.unitOfMeasure}</p></div><b className="shrink-0 text-sm tabular-nums">{money(p.revenue)}</b></motion.li>)}</ol> : <EmptyState icon={<Package className="h-5 w-5" />} title="No rankings yet" description="Recorded sales populate this list." />}</section>
          </div>
          <div className="border-t border-line"><CardHeader title="Recent sales" description="Completed orders reduce the corresponding available stock." />{sales.data.recent.length ? <div className="divide-y divide-line">{sales.data.recent.map((sale) => { const total = sale.items.reduce((sum, item) => sum + Number(item.lineTotal), 0); return <div key={sale.id} className="flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3 text-sm"><div className="min-w-40 flex-1"><p className="font-semibold text-fg">{sale.customerName}</p><p className="font-mono text-xs text-muted">{sale.reference} · {new Date(sale.soldAt).toLocaleDateString()}</p></div><span className="text-muted">{sale.items.map((item) => `${item.productName} × ${fmtQty(item.quantity)}`).join(" · ")}</span><b className="ml-auto tabular-nums">{money(total, sale.currency)}</b></div>; })}</div> : <EmptyState title="No sales yet" description="Sales you record will appear here." />}</div>
        </> : null}
      </Card>

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
      <RecordSaleModal open={recording} onClose={() => setRecording(false)} />
    </>
  );
}
