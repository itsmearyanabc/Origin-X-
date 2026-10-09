import { AlertTriangle, Blocks, Boxes, Building2, ClipboardList, Inbox, LayoutDashboard, Package, ScanLine, Settings, ShieldCheck, Siren, Users } from "lucide-react";
import { PanelShell, type NavGroup } from "@/components/PanelShell";
import { Badge } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { humanize } from "@/lib/format";

export default function AdminLayout() {
  const { me } = useAuth();
  const groups: NavGroup[] = [
    { label: "Platform", items: [{ to: "/admin", label: "Dashboard", icon: LayoutDashboard, end: true }] },
    {
      label: "Tenants",
      items: [
        { to: "/admin/organizations", label: "Organizations", icon: Building2 },
        { to: "/admin/users", label: "Users", icon: Users },
      ],
    },
    {
      label: "Trust & safety",
      items: [
        { to: "/admin/products", label: "Products", icon: Package },
        { to: "/admin/incidents", label: "Incidents", icon: AlertTriangle },
        { to: "/admin/recalls", label: "Recalls", icon: Siren },
        { to: "/admin/verifications", label: "Verification monitoring", icon: ScanLine },
        { to: "/admin/blockchain", label: "Blockchain", icon: Blocks },
      ],
    },
    {
      label: "Operations",
      items: [
        { to: "/admin/audit", label: "Audit logs", icon: ClipboardList },
        { to: "/admin/messages", label: "Contact messages", icon: Inbox },
        { to: "/admin/settings", label: "Settings", icon: Settings },
      ],
    },
  ];
  return (
    <PanelShell
      title="Admin"
      homeTo="/admin"
      groups={groups}
      topLeft={
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-brand-500" />
          <span className="text-sm font-semibold text-fg">ORIGINX platform console</span>
          <Badge tone="brand">{humanize(me?.platformRole)}</Badge>
        </div>
      }
      sidebarFooter={
        <p className="flex items-center gap-2 px-3 py-2 text-xs text-muted">
          <Boxes className="h-4 w-4" /> Read-mostly. Every admin action is audited.
        </p>
      }
    />
  );
}
