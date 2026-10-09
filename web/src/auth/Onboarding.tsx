import { useState } from "react";
import { useNavigate } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, ArrowRight, Boxes, Building2, Check, Clock, Factory, Package, ShieldCheck, Store, Truck, Warehouse, type LucideIcon } from "lucide-react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/format";
import { AuthCard } from "./AuthLayout";

const TYPES: Array<{ value: string; label: string; icon: LucideIcon; text: string }> = [
  { value: "MANUFACTURER", label: "Manufacturer", icon: Factory, text: "Makes products and registers their identity" },
  { value: "BRAND", label: "Brand", icon: ShieldCheck, text: "Owns products made by contract manufacturers" },
  { value: "DISTRIBUTOR", label: "Distributor", icon: Boxes, text: "Buys and resells to downstream partners" },
  { value: "LOGISTICS", label: "Logistics", icon: Truck, text: "Moves products between partners" },
  { value: "WAREHOUSE", label: "Warehouse", icon: Warehouse, text: "Stores and handles inventory" },
  { value: "RETAILER", label: "Retailer", icon: Store, text: "Sells to customers" },
  { value: "SUPPLIER", label: "Supplier", icon: Package, text: "Supplies components or materials" },
  { value: "OTHER", label: "Other", icon: Building2, text: "Another role in the chain" },
];

type Profile = { name: string; legalName: string; country: string; industry: string; website: string; contactEmail: string };

export default function Onboarding() {
  const { me, reload, selectOrganization } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState<Profile>({ name: "", legalName: "", country: "", industry: "", website: "", contactEmail: me?.email ?? "" });
  const [primary, setPrimary] = useState("MANUFACTURER");
  const [extra, setExtra] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const set = (k: keyof Profile) => (e: React.ChangeEvent<HTMLInputElement>) => setProfile((p) => ({ ...p, [k]: e.target.value }));
  const profileValid = profile.name.trim().length >= 2 && (!profile.website || /^https?:\/\/.+\..+/.test(profile.website));

  const create = async () => {
    setError(null);
    setLoading(true);
    try {
      const body = Object.fromEntries(
        Object.entries({ ...profile, organizationType: primary, additionalTypes: extra.filter((t) => t !== primary) }).filter(([, v]) => (Array.isArray(v) ? v.length : String(v).trim())),
      );
      const org = await api.post<{ id: string }>("/organizations", body, false);
      await reload();
      selectOrganization(org.id);
      setStep(3);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const steps = ["Profile", "Supply-chain role", "Review"];

  return (
    <AuthCard title={step === 3 ? "You're set up" : "Set up your organization"} description={step === 3 ? undefined : "This is the workspace your team, products and partners will live in."}>
      {step < 3 && (
        <ol className="mb-8 flex items-center gap-2">
          {steps.map((s, i) => (
            <li key={s} className="flex flex-1 items-center gap-2">
              <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold transition-colors duration-300", i < step ? "bg-brand-500 text-white" : i === step ? "bg-ink-900 text-white" : "bg-ink-200 text-ink-500")}>
                {i < step ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span className={cn("hidden text-xs font-semibold sm:block", i === step ? "text-ink-900" : "text-ink-500")}>{s}</span>
              {i < steps.length - 1 && <span className={cn("h-0.5 flex-1 rounded-full transition-colors duration-500", i < step ? "bg-brand-500" : "bg-ink-200")} />}
            </li>
          ))}
        </ol>
      )}

      {error && <Alert tone="bad" className="mb-5">{error}</Alert>}

      <AnimatePresence mode="wait">
        <motion.div key={step} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.35 }}>
          {step === 0 && (
            <div className="space-y-4">
              <Field label="Organization name" required hint="Shown to partners and on public product pages.">
                {(id) => <Input id={id} autoFocus value={profile.name} onChange={set("name")} placeholder="ABC Pharma" />}
              </Field>
              <Field label="Legal name">{(id) => <Input id={id} value={profile.legalName} onChange={set("legalName")} placeholder="ABC Pharmaceuticals Pvt Ltd" />}</Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Country">{(id) => <Input id={id} value={profile.country} onChange={set("country")} placeholder="IN" />}</Field>
                <Field label="Industry">{(id) => <Input id={id} value={profile.industry} onChange={set("industry")} placeholder="Pharmaceuticals" />}</Field>
              </div>
              <Field label="Website" error={profile.website && !/^https?:\/\/.+\..+/.test(profile.website) ? "Start with https://" : undefined}>
                {(id) => <Input id={id} value={profile.website} onChange={set("website")} placeholder="https://example.com" />}
              </Field>
              <Field label="Contact email">{(id) => <Input id={id} type="email" value={profile.contactEmail} onChange={set("contactEmail")} />}</Field>
              <Button size="lg" className="w-full" disabled={!profileValid} onClick={() => setStep(1)}>
                Continue <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-5">
              <p className="text-sm text-ink-600">What is your organization's main role in the supply chain?</p>
              <div className="grid grid-cols-2 gap-2.5" role="radiogroup" aria-label="Primary role">
                {TYPES.map((t) => {
                  const isPrimary = primary === t.value;
                  return (
                    <button
                      key={t.value}
                      type="button"
                      role="radio"
                      aria-checked={isPrimary}
                      onClick={() => {
                        setPrimary(t.value);
                        setExtra((e) => e.filter((x) => x !== t.value));
                      }}
                      className={cn("relative rounded-2xl border p-3.5 text-left transition-all duration-200", isPrimary ? "border-brand-500 bg-brand-50 ring-2 ring-brand-500/20" : "border-ink-200 bg-white hover:border-ink-300")}
                    >
                      <t.icon className={cn("h-5 w-5", isPrimary ? "text-brand-600" : "text-ink-500")} />
                      <p className="mt-2 text-sm font-bold text-ink-900">{t.label}</p>
                      <p className="mt-0.5 text-[11px] leading-snug text-ink-500">{t.text}</p>
                      {isPrimary && <Check className="absolute right-3 top-3 h-4 w-4 text-brand-500" />}
                    </button>
                  );
                })}
              </div>
              <div>
                <p className="text-sm font-medium text-ink-800">Also acts as <span className="font-normal text-ink-500">(optional)</span></p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {TYPES.filter((t) => t.value !== primary).map((t) => {
                    const on = extra.includes(t.value);
                    return (
                      <button
                        key={t.value}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setExtra((e) => (on ? e.filter((x) => x !== t.value) : [...e, t.value]))}
                        className={cn("rounded-full border px-3 py-1.5 text-xs font-semibold transition", on ? "border-brand-500 bg-brand-500 text-white" : "border-ink-200 bg-white text-ink-600 hover:border-ink-300")}
                      >
                        {t.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex gap-3">
                <Button variant="secondary" size="lg" onClick={() => setStep(0)}>
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <Button size="lg" className="flex-1" onClick={() => setStep(2)}>
                  Continue <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <div className="divide-y divide-ink-100 rounded-2xl border border-ink-200 bg-white">
                {[
                  ["Name", profile.name],
                  ["Legal name", profile.legalName || "—"],
                  ["Primary role", TYPES.find((t) => t.value === primary)?.label],
                  ["Also acts as", extra.filter((e) => e !== primary).map((e) => TYPES.find((t) => t.value === e)?.label).join(", ") || "—"],
                  ["Country", profile.country || "—"],
                  ["Website", profile.website || "—"],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4 px-4 py-3 text-sm">
                    <span className="text-ink-500">{k}</span>
                    <span className="text-right font-medium text-ink-900">{v}</span>
                  </div>
                ))}
              </div>
              <Alert tone="info">New organizations start as <b>pending verification</b>. You can set everything up right away; ORIGINX reviews and verifies your organization before it earns the verified badge.</Alert>
              <div className="flex gap-3">
                <Button variant="secondary" size="lg" onClick={() => setStep(1)}>
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <Button size="lg" className="flex-1" loading={loading} onClick={create}>
                  Create organization
                </Button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6 text-center">
              <div className="relative mx-auto grid h-20 w-20 place-items-center">
                <span className="absolute inset-0 animate-pulse-ring rounded-full bg-brand-400" />
                <span className="relative grid h-20 w-20 place-items-center rounded-full bg-brand-500 text-white">
                  <Check className="h-9 w-9" strokeWidth={3} />
                </span>
              </div>
              <div>
                <p className="text-lg font-bold text-ink-900">{profile.name} is ready.</p>
                <p className="mt-1 text-sm text-ink-600">Your workspace is live. Here's what happens next:</p>
              </div>
              <ol className="space-y-2 text-left text-sm">
                {[
                  [Check, "Organization created — you are the owner", "done"],
                  [Clock, "ORIGINX reviews and verifies your organization", "pending"],
                  [ArrowRight, "Invite your team, connect partners, register products", "next"],
                ].map(([Icon, text, s]) => {
                  const I = Icon as LucideIcon;
                  return (
                    <li key={text as string} className="flex items-center gap-3 rounded-xl bg-white px-4 py-3 ring-1 ring-ink-200">
                      <I className={cn("h-4 w-4", s === "done" ? "text-ok-600" : s === "pending" ? "text-warn-600" : "text-brand-500")} />
                      {text as string}
                    </li>
                  );
                })}
              </ol>
              <Button size="lg" className="w-full" onClick={() => navigate("/app", { replace: true })}>
                Go to my dashboard <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </AuthCard>
  );
}
