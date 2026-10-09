import { useEffect, useState } from "react";
import { BadgeCheck, Clock, KeyRound, LogOut } from "lucide-react";
import { Alert, Button, Card, CardHeader, Field, Input, PageHeader, Skeleton, StatusBadge, useToast } from "@/components/ui";
import { PasswordInput, PasswordStrength, passwordRule } from "@/auth/PasswordInput";
import { api, errorMessage, session } from "@/lib/api";
import { useAuth, useCan } from "@/lib/auth";
import { humanize } from "@/lib/format";
import type { Organization } from "@/lib/types";
import { useOrgMutation, useOrgQuery } from "../hooks";

function Usage({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = Math.min(100, Math.round((used / Math.max(1, limit)) * 100));
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span className="text-fg">{label}</span>
        <span className="text-muted">
          {used.toLocaleString()} / {limit.toLocaleString()}
        </span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2">
        <div className={`h-full rounded-full ${pct > 90 ? "bg-bad-500" : pct > 70 ? "bg-warn-500" : "bg-brand-500"}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function Settings() {
  const can = useCan();
  const toast = useToast();
  const { signOut, reload } = useAuth();
  const org = useOrgQuery(["org"], () => api.get<Organization>("/organizations/current"));
  const [form, setForm] = useState<Record<string, string>>({});
  const [pw, setPw] = useState({ current: "", next: "" });
  const [pwError, setPwError] = useState<string | null>(null);
  useEffect(() => {
    if (org.data) setForm({ name: org.data.name, legalName: org.data.legalName ?? "", industry: org.data.industry ?? "", country: org.data.country ?? "", address: org.data.address ?? "", contactEmail: org.data.contactEmail ?? "", contactPhone: org.data.contactPhone ?? "", website: org.data.website ?? "" });
  }, [org.data]);
  const save = useOrgMutation(() => api.patch("/organizations/current", Object.fromEntries(Object.entries(form).filter(([, v]) => v.trim()))), { success: "Organization profile saved", onSuccess: () => reload() });
  const changePw = async () => {
    setPwError(null);
    if (!passwordRule(pw.next)) return setPwError("Use at least 10 characters with letters and numbers.");
    try {
      const r = await api.post<{ accessToken: string }>("/auth/change-password", { currentPassword: pw.current, newPassword: pw.next }, false);
      session.setAccessToken(r.accessToken);
      setPw({ current: "", next: "" });
      toast("ok", "Password changed. Other sessions were signed out.");
    } catch (e) {
      setPwError(errorMessage(e));
    }
  };

  if (org.isLoading || !org.data) return <Skeleton className="h-96 rounded-2xl" />;
  const o = org.data;
  const e = o.entitlements;
  const set = (k: string) => (ev: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: ev.target.value }));

  return (
    <>
      <PageHeader title="Settings" description="Organization profile, plan and your account." />
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader
            title="Organization profile"
            description={can("org:settings") ? "Shown to partners and on public product pages." : "Only owners can edit the profile."}
            action={o.verificationStatus === "VERIFIED" ? <StatusBadge value="VERIFIED" /> : <StatusBadge value={o.verificationStatus} />}
          />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            {[
              ["name", "Name"],
              ["legalName", "Legal name"],
              ["industry", "Industry"],
              ["country", "Country"],
              ["contactEmail", "Contact email"],
              ["contactPhone", "Contact phone"],
              ["website", "Website"],
              ["address", "Address"],
            ].map(([k, label]) => (
              <Field key={k} label={label}>
                {(id) => <Input id={id} value={form[k] ?? ""} onChange={set(k)} disabled={!can("org:settings")} />}
              </Field>
            ))}
          </div>
          {can("org:settings") && (
            <div className="flex justify-end border-t border-line px-5 py-3">
              <Button loading={save.isPending} onClick={() => save.mutate(undefined)}>
                Save changes
              </Button>
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card className="p-5">
            <div className="flex items-center gap-3">
              {o.verificationStatus === "VERIFIED" ? <BadgeCheck className="h-6 w-6 text-ok-600" /> : <Clock className="h-6 w-6 text-warn-600" />}
              <div>
                <p className="font-semibold text-fg">{o.verificationStatus === "VERIFIED" ? "Verified organization" : "Verification pending"}</p>
                <p className="text-sm text-muted">Status: {humanize(o.status)} · type {humanize(o.organizationType)}</p>
              </div>
            </div>
          </Card>
          {e && (
            <Card className="space-y-4 p-5">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-fg">{humanize(e.plan)} plan</p>
                <StatusBadge value={e.subscriptionActive ? "ACTIVE" : e.status} />
              </div>
              <Usage label="Products" used={e.usage.products} limit={e.limits.products} />
              <Usage label="Team members" used={e.usage.users} limit={e.limits.users} />
              {!e.enforced && <p className="text-xs text-muted">Plan limits are currently not enforced on this deployment.</p>}
            </Card>
          )}
          <Card>
            <CardHeader title="Your account" />
            <div className="space-y-3 p-5">
              {pwError && <Alert tone="bad">{pwError}</Alert>}
              <Field label="Current password">{(id) => <PasswordInput id={id} autoComplete="current-password" value={pw.current} onChange={(ev) => setPw((p) => ({ ...p, current: ev.target.value }))} />}</Field>
              <Field label="New password">
                {(id) => (
                  <>
                    <PasswordInput id={id} autoComplete="new-password" value={pw.next} onChange={(ev) => setPw((p) => ({ ...p, next: ev.target.value }))} />
                    <PasswordStrength value={pw.next} />
                  </>
                )}
              </Field>
              <Button variant="secondary" icon={<KeyRound className="h-4 w-4" />} disabled={!pw.current || !pw.next} onClick={changePw}>
                Change password
              </Button>
              <div className="h-px bg-line" />
              <Button
                variant="ghost"
                icon={<LogOut className="h-4 w-4" />}
                onClick={async () => {
                  try {
                    await api.post("/auth/logout-all", {}, false);
                  } finally {
                    await signOut();
                  }
                }}
              >
                Sign out of all devices
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
