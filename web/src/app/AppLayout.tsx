import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import {
  AlertTriangle,
  ArrowLeftRight,
  BadgeCheck,
  Boxes,
  Check,
  ChevronsUpDown,
  ClipboardList,
  Clock,
  Handshake,
  History,
  LayoutDashboard,
  PackageSearch,
  Truck,
  Warehouse,
  Warehouse as WarehouseIcon,
  Package,
  Plus,
  ScanLine,
  Settings,
  Siren,
  Users,
} from "lucide-react";
import { Link } from "react-router";
import { PanelShell, type NavGroup } from "@/components/PanelShell";
import { useAuth, useCan } from "@/lib/auth";
import { api } from "@/lib/api";
import { cn, humanize } from "@/lib/format";
import type { CustodyTransfer, ShipmentView } from "@/lib/types";

function OrgSwitcher() {
  const { me, activeOrg, selectOrganization } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  if (!activeOrg) return null;
  return (
    <div ref={ref} className="relative inline-block max-w-full">
      <button onClick={() => setOpen((o) => !o)} className="flex max-w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left hover:bg-surface-2" aria-haspopup="listbox" aria-expanded={open}>
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-ink-900 text-xs font-bold text-white dark:bg-surface-2">{activeOrg.name.slice(0, 2).toUpperCase()}</span>
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 truncate text-sm font-semibold text-fg">
            {activeOrg.name}
            {activeOrg.verificationStatus === "VERIFIED" && <BadgeCheck className="h-4 w-4 shrink-0 text-ok-600" aria-label="Verified organization" />}
          </span>
          <span className="block truncate text-xs text-muted">{humanize(activeOrg.role)}</span>
        </span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div role="listbox" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.15 }} className="absolute left-0 top-full z-30 mt-2 w-72 rounded-2xl border border-line bg-surface p-2 shadow-lift">
            <p className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">Organizations</p>
            {me?.organizations.map((o) => (
              <button
                key={o.organizationId}
                role="option"
                aria-selected={o.organizationId === activeOrg.organizationId}
                onClick={() => {
                  selectOrganization(o.organizationId);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-surface-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-fg">{o.name}</span>
                  <span className="block text-xs text-muted">{humanize(o.role)}</span>
                </span>
                {o.organizationId === activeOrg.organizationId && <Check className="h-4 w-4 text-brand-500" />}
              </button>
            ))}
            <div className="my-1 h-px bg-line" />
            <Link to="/onboarding" className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-brand-600 hover:bg-surface-2">
              <Plus className="h-4 w-4" /> New organization
            </Link>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function StatusBanner() {
  const { activeOrg } = useAuth();
  if (!activeOrg) return null;
  if (activeOrg.status === "SUSPENDED" || activeOrg.status === "REJECTED")
    return (
      <div className="flex items-center gap-2 border-b border-bad-100 bg-bad-50 px-6 py-2.5 text-sm text-bad-700 dark:border-bad-500/20 dark:bg-bad-500/10">
        <AlertTriangle className="h-4 w-4" /> This organization is {activeOrg.status.toLowerCase()} and read-only. Contact ORIGINX support.
      </div>
    );
  if (activeOrg.verificationStatus !== "VERIFIED")
    return (
      <div className="flex items-center gap-2 border-b border-warn-100 bg-warn-50 px-6 py-2.5 text-sm text-warn-700 dark:border-warn-500/20 dark:bg-warn-500/10 dark:text-warn-500">
        <Clock className="h-4 w-4 shrink-0" />
        <span>
          <b>Verification pending.</b> You can use everything now; products show "unverified organization" until ORIGINX verifies you.
        </span>
      </div>
    );
  return null;
}

export default function AppLayout() {
  const { activeOrgId } = useAuth();
  const can = useCan();
  const incoming = useQuery({
    queryKey: ["org", activeOrgId, "custody", "incoming-count"],
    queryFn: () => api.get<CustodyTransfer[]>("/custody-transfers", { direction: "incoming", status: "TRANSFER_REQUESTED" }),
    refetchInterval: 30_000,
    enabled: Boolean(activeOrgId),
  });

  const incomingShipments = useQuery({
    queryKey: ["org", activeOrgId, "shipments", "incoming-count"],
    queryFn: () => api.page<ShipmentView>("/shipments", { direction: "incoming", status: "DISPATCHED,PARTIALLY_RECEIVED", pageSize: 1 }),
    refetchInterval: 30_000,
    enabled: Boolean(activeOrgId),
  });

  const groups: NavGroup[] = [
    { label: "Overview", items: [{ to: "/app", label: "Dashboard", icon: LayoutDashboard, end: true }] },
    {
      label: "Products",
      items: [
        { to: "/app/products", label: "Products & passports", icon: Package },
        { to: "/app/batches", label: "Batches", icon: Boxes },
      ],
    },
    {
      label: "Inventory",
      items: [
        { to: "/app/inventory", label: "Inventory overview", icon: Warehouse, end: true },
        { to: "/app/inventory/products", label: "Stock by product", icon: PackageSearch },
        { to: "/app/warehouses", label: "Warehouses", icon: WarehouseIcon },
        { to: "/app/shipments", label: "Shipments", icon: Truck, badge: incomingShipments.data?.meta.total || null },
        { to: "/app/inventory/movements", label: "Stock movements", icon: History },
      ],
    },
    {
      label: "Supply chain",
      items: [
        { to: "/app/custody", label: "Custody transfers", icon: ArrowLeftRight, badge: incoming.data?.length || null },
        { to: "/app/partners", label: "Partners", icon: Handshake },
      ],
    },
    {
      label: "Trust",
      items: [
        { to: "/app/verification", label: "Verification", icon: ScanLine },
        { to: "/app/incidents", label: "Incidents", icon: AlertTriangle },
        { to: "/app/recalls", label: "Recalls", icon: Siren },
      ],
    },
    {
      label: "Organization",
      items: [
        { to: "/app/team", label: "Team", icon: Users },
        { to: "/app/audit", label: "Audit log", icon: ClipboardList, hidden: !can("audit:read") },
        { to: "/app/settings", label: "Settings", icon: Settings },
      ],
    },
  ];

  return (
    <PanelShell
      key={activeOrgId ?? "none"}
      title="Workspace"
      homeTo="/app"
      groups={groups}
      topLeft={<OrgSwitcher />}
      banner={<StatusBanner />}
      sidebarFooter={
        <Link to="/verify" target="_blank" className={cn("flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-muted hover:bg-surface-2 hover:text-fg")}>
          <ScanLine className="h-4 w-4 text-brand-500" /> Open consumer verify page
        </Link>
      }
    />
  );
}
