import { useState } from "react";
import { Settings } from "lucide-react";
import { Alert, Button, Card, CardHeader, EmptyState, Field, Input, PageHeader, Skeleton, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { useAdminCan } from "@/lib/auth";
import { useAdminMutation, useAdminQuery } from "../hooks";

export default function AdminSettings() {
  const can = useAdminCan();
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const settings = useAdminQuery(["settings"], () => api.get<Record<string, unknown>>("/admin/settings", undefined, false));
  const save = useAdminMutation((body: { key: string; value: unknown }) => api.put(`/admin/settings/${encodeURIComponent(body.key)}`, { value: body.value }, false), {
    success: "Setting saved",
    onSuccess: () => {
      setKey("");
      setValue("");
    },
  });
  const submit = () => {
    setParseError(null);
    try {
      save.mutate({ key, value: JSON.parse(value) });
    } catch {
      setParseError("Value must be valid JSON (e.g. true, 42, \"text\" or {\"a\":1}).");
    }
  };
  return (
    <>
      <PageHeader title="Platform settings" description="Key/value configuration managed by super administrators. Every change is audited." />
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader title="Current settings" />
          {settings.isLoading ? (
            <Skeleton className="m-5 h-32" />
          ) : settings.data && Object.keys(settings.data).length ? (
            <ul className="divide-y divide-line">
              {Object.entries(settings.data).map(([k, v]) => (
                <li key={k} className="flex items-start justify-between gap-4 px-5 py-3">
                  <button className="hash text-left font-semibold text-fg hover:text-brand-600" onClick={() => (setKey(k), setValue(JSON.stringify(v)))}>
                    {k}
                  </button>
                  <code className="hash max-w-xs truncate text-muted">{JSON.stringify(v)}</code>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={<Settings className="h-5 w-5" />} title="No settings yet" />
          )}
        </Card>
        {can("settings") ? (
          <Card className="space-y-4 p-5">
            <p className="font-semibold text-fg">Set a value</p>
            {parseError && <Alert tone="bad">{parseError}</Alert>}
            <Field label="Key" hint="camelCase, letters/digits/dots">
              {(id) => <Input id={id} className="hash" value={key} onChange={(e) => setKey(e.target.value)} placeholder="maintenanceBanner" />}
            </Field>
            <Field label="Value (JSON)">{(id) => <Textarea id={id} rows={4} className="hash" value={value} onChange={(e) => setValue(e.target.value)} placeholder='"Scheduled maintenance Sunday 02:00 UTC"' />}</Field>
            <Button disabled={!key.trim() || !value.trim()} loading={save.isPending} onClick={submit}>
              Save
            </Button>
          </Card>
        ) : (
          <Alert tone="info">Only super administrators can change platform settings.</Alert>
        )}
      </div>
    </>
  );
}
