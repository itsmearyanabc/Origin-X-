import { useState } from "react";
import { Link, useParams } from "react-router";
import { ArrowLeft, ArrowRightLeft, MapPin, Plus, ShieldAlert, ShieldCheck, Warehouse as WarehouseIcon } from "lucide-react";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, Field, Input, Modal, PageHeader, Skeleton, StatusBadge, Table, Td, Textarea } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import type { Balance, Warehouse } from "@/lib/types";
import { useOrgMutation, useOrgQuery } from "../hooks";
import { LocationSelect, Qty, useWarehouses } from "./shared";
import { WarehouseMap } from "./WarehouseMap";

function WarehouseModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form, setForm] = useState({ code: "", name: "", address: "", city: "", country: "", latitude: "", longitude: "" });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const point = form.latitude && form.longitude ? { latitude: Number(form.latitude), longitude: Number(form.longitude) } : null;
  const m = useOrgMutation(() => api.post("/warehouses", { ...Object.fromEntries(Object.entries(form).filter(([k, v]) => !["latitude", "longitude"].includes(k) && v.trim())), ...(point ?? {}) }), {
    success: "Warehouse created with a MAIN location",
    onSuccess: () => {
      setForm({ code: "", name: "", address: "", city: "", country: "", latitude: "", longitude: "" });
      onClose();
    },
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New warehouse"
      description="Pin the warehouse on the map to save its precise coordinates. Codes, addresses and bins never appear in public product journeys."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!form.code.trim() || form.name.trim().length < 2 || !point || !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude) || Math.abs(point.latitude) > 90 || Math.abs(point.longitude) > 180} loading={m.isPending} onClick={() => m.mutate(undefined)}>
            Create
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Code" required>
          {(id) => <Input id={id} className="hash" value={form.code} onChange={set("code")} placeholder="DEL-DC1" />}
        </Field>
        <Field label="Name" required>
          {(id) => <Input id={id} value={form.name} onChange={set("name")} />}
        </Field>
        <Field label="Address" className="sm:col-span-2">
          {(id) => <Input id={id} value={form.address} onChange={set("address")} />}
        </Field>
        <Field label="City">{(id) => <Input id={id} value={form.city} onChange={set("city")} />}</Field>
        <Field label="Country">{(id) => <Input id={id} value={form.country} onChange={set("country")} placeholder="IN" />}</Field>
        <Field label="Latitude">{(id) => <Input id={id} inputMode="decimal" value={form.latitude} onChange={set("latitude")} placeholder="28.6139" />}</Field>
        <Field label="Longitude">{(id) => <Input id={id} inputMode="decimal" value={form.longitude} onChange={set("longitude")} placeholder="77.2090" />}</Field>
        <div className="sm:col-span-2"><p className="mb-2 text-xs text-muted">Click the site location on the map or enter its latitude and longitude. A map pin is required.</p><WarehouseMap warehouses={[]} selected={point} onPick={(p) => setForm((f) => ({ ...f, latitude: String(p.latitude), longitude: String(p.longitude) }))} /></div>
      </div>
    </Modal>
  );
}

export default function Warehouses() {
  const can = useCan();
  const [creating, setCreating] = useState(false);
  const list = useWarehouses();
  return (
    <>
      <PageHeader
        title="Warehouses"
        description="Your sites and storage locations. Each warehouse starts with a MAIN location."
        actions={
          can("warehouses:manage") && (
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
              New warehouse
            </Button>
          )
        }
      />
      {list.isLoading ? (
        <Skeleton className="h-40 rounded-2xl" />
      ) : list.isError ? (
        <Card>
          <ErrorState message={errorMessage(list.error)} />
        </Card>
      ) : (
        <>
        <section className="mb-4"><WarehouseMap warehouses={list.data ?? []} /></section>
        {list.data?.length ? <>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.data.map((w) => (
            <Link key={w.id} to={`/app/warehouses/${w.id}`}>
              <Card className="h-full p-5 transition hover:-translate-y-0.5 hover:shadow-lift">
                <div className="flex items-start justify-between">
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-500/10">
                    <WarehouseIcon className="h-5 w-5" />
                  </span>
                  <StatusBadge value={w.status} />
                </div>
                <p className="hash mt-4 text-xs text-muted">{w.code}</p>
                <p className="font-semibold text-fg">{w.name}</p>
                <p className="mt-1 flex items-center gap-1 text-sm text-muted">
                  <MapPin className="h-3.5 w-3.5" /> {[w.city, w.country].filter(Boolean).join(", ") || "—"}
                </p>
                <p className="mt-4 text-sm text-muted">
                  {w.locations.length} location{w.locations.length === 1 ? "" : "s"} · {w.balanceCount ?? 0} stock line{w.balanceCount === 1 ? "" : "s"}
                </p>
              </Card>
            </Link>
          ))}
        </div>
        </> : <Card>
          <EmptyState icon={<WarehouseIcon className="h-5 w-5" />} title="No warehouses yet" description="Create one to start recording stock." action={can("warehouses:manage") && <Button onClick={() => setCreating(true)}>New warehouse</Button>} />
        </Card>}
        </>
      )}
      <WarehouseModal open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

function MoveModal({ balance, onClose }: { balance: Balance | null; onClose: () => void }) {
  const [to, setTo] = useState("");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const m = useOrgMutation(() => api.post("/inventory/transfers", { skuId: balance!.skuId, batchId: balance!.batchId, fromLocationId: balance!.locationId, toLocationId: to, quantity, reason: reason || undefined }), {
    success: "Stock moved",
    onSuccess: () => {
      setQuantity("");
      onClose();
    },
  });
  return (
    <Modal
      open={Boolean(balance)}
      onClose={onClose}
      title="Move stock"
      description={balance ? `${balance.sku?.sku} · batch ${balance.batch?.batchCode ?? "—"} · ${balance.available} ${balance.unitOfMeasure} available` : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!to || !quantity} loading={m.isPending} onClick={() => m.mutate(undefined)}>
            Move
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <LocationSelect value={to} onChange={setTo} label="Destination location" required />
        <Field label={`Quantity (${balance?.unitOfMeasure ?? ""})`} required>
          {(id) => <Input id={id} inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} />}
        </Field>
        <Field label="Note">{(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
      </div>
    </Modal>
  );
}

function QuarantineModal({ target, onClose }: { target: { balance: Balance; release: boolean } | null; onClose: () => void }) {
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const m = useOrgMutation(() => api.post(target!.release ? "/inventory/quarantine/release" : "/inventory/quarantine", { balanceId: target!.balance.id, quantity, reason }), {
    success: target?.release ? "Released to available stock" : "Stock quarantined",
    onSuccess: () => {
      setQuantity("");
      setReason("");
      onClose();
    },
  });
  return (
    <Modal
      open={Boolean(target)}
      onClose={onClose}
      title={target?.release ? "Release from quarantine" : "Quarantine stock"}
      description={target?.release ? "Only release after inspection. Batches under a brand hold or recall cannot be released." : "Quarantined stock is excluded from available stock and cannot be dispatched."}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={target?.release ? "primary" : "danger"} disabled={!quantity || reason.trim().length < 3} loading={m.isPending} onClick={() => m.mutate(undefined)}>
            {target?.release ? "Release" : "Quarantine"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={`Quantity (${target?.balance.unitOfMeasure ?? ""})`} required hint={target ? `${target.release ? target.balance.quarantined : target.balance.available} available for this action` : undefined}>
          {(id) => <Input id={id} inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} />}
        </Field>
        <Field label="Reason" required>
          {(id) => <Textarea id={id} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
      </div>
    </Modal>
  );
}

export function WarehouseDetail() {
  const { warehouseId = "" } = useParams();
  const can = useCan();
  const [loc, setLoc] = useState({ code: "", zone: "", aisle: "", shelf: "", bin: "" });
  const [adding, setAdding] = useState(false);
  const [moving, setMoving] = useState<Balance | null>(null);
  const [quarantine, setQuarantine] = useState<{ balance: Balance; release: boolean } | null>(null);
  const [mapPoint, setMapPoint] = useState<{ latitude: number; longitude: number } | null>(null);
  const [editingMap, setEditingMap] = useState(false);
  const w = useOrgQuery(["warehouse", warehouseId], () => api.get<Warehouse & { balances: Balance[] }>(`/warehouses/${warehouseId}`));
  const saveMap = useOrgMutation(() => api.patch(`/warehouses/${warehouseId}`, mapPoint), { success: "Warehouse map location updated", onSuccess: () => setEditingMap(false) });
  const addLoc = useOrgMutation(() => api.post(`/warehouses/${warehouseId}/locations`, Object.fromEntries(Object.entries(loc).filter(([, v]) => v.trim()))), {
    success: "Location added",
    onSuccess: () => {
      setLoc({ code: "", zone: "", aisle: "", shelf: "", bin: "" });
      setAdding(false);
    },
  });
  const toggle = useOrgMutation(({ id, status }: { id: string; status: string }) => api.patch(`/locations/${id}`, { status }), { success: "Location updated" });

  if (w.isLoading) return <Skeleton className="h-96 rounded-2xl" />;
  if (w.isError || !w.data) return <Card><ErrorState message={errorMessage(w.error)} /></Card>;
  const data = w.data;

  return (
    <>
      <Link to="/app/warehouses" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> Warehouses
      </Link>
      <PageHeader eyebrow={<span className="hash">{data.code}</span>} title={data.name} description={[data.address, data.city, data.country].filter(Boolean).join(", ")} actions={<div className="flex items-center gap-2">{can("warehouses:manage") && <Button size="sm" variant="secondary" icon={<MapPin className="h-3.5 w-3.5" />} onClick={() => { setMapPoint(data.latitude != null && data.longitude != null ? { latitude: data.latitude, longitude: data.longitude } : null); setEditingMap(true); }}>Set map pin</Button>}<StatusBadge value={data.status} /></div>} />
      <div className="grid gap-4 xl:grid-cols-[1fr_2fr]">
        <Card>
          <CardHeader
            title="Locations"
            action={
              can("warehouses:manage") && (
                <Button size="sm" variant="secondary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setAdding((x) => !x)}>
                  Add
                </Button>
              )
            }
          />
          {adding && (
            <div className="grid grid-cols-2 gap-2 border-b border-line p-4">
              {(["code", "zone", "aisle", "shelf", "bin"] as const).map((k) => (
                <Input key={k} placeholder={k === "code" ? "Code *" : k} value={loc[k]} onChange={(e) => setLoc((l) => ({ ...l, [k]: e.target.value }))} aria-label={k} className={k === "code" ? "hash col-span-2" : ""} />
              ))}
              <Button className="col-span-2" disabled={!loc.code.trim()} loading={addLoc.isPending} onClick={() => addLoc.mutate(undefined)}>
                Save location
              </Button>
            </div>
          )}
          <ul className="divide-y divide-line">
            {data.locations.map((l) => (
              <li key={l.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                <span className="hash font-semibold text-fg">{l.code}</span>
                <span className="flex-1 text-muted">{[l.zone, l.aisle && `aisle ${l.aisle}`, l.shelf && `shelf ${l.shelf}`, l.bin && `bin ${l.bin}`].filter(Boolean).join(" · ")}</span>
                <StatusBadge value={l.status} />
                {can("warehouses:manage") && (
                  <button className="text-xs font-semibold text-brand-600 hover:underline" onClick={() => toggle.mutate({ id: l.id, status: l.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" })}>
                    {l.status === "ACTIVE" ? "Deactivate" : "Activate"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Stock in this warehouse" />
          {data.balances.length ? (
            <Table head={["Location", "Item", "On hand", "Available", "Reserved", "Quarantined", "Damaged", ""]}>
              {data.balances.map((b) => (
                <tr key={b.id}>
                  <Td className="hash">{b.location?.code}</Td>
                  <Td>
                    <span className="hash block font-semibold text-fg">{b.sku?.sku}</span>
                    <span className="text-xs text-muted">
                      {b.batch ? `Batch ${b.batch.batchCode}` : "No batch"}
                      {b.batch?.expiryDate ? ` · exp. ${formatDate(b.batch.expiryDate)}` : ""}
                    </span>
                    {b.batch && b.batch.holdStatus !== "NONE" && <Badge tone="bad" className="ml-1">{b.batch.holdStatus}</Badge>}
                  </Td>
                  <Td>
                    <Qty value={b.onHand} unit={b.unitOfMeasure} />
                  </Td>
                  <Td className="font-semibold text-ok-700">
                    <Qty value={b.available} />
                  </Td>
                  <Td>
                    <Qty value={b.reserved} />
                  </Td>
                  <Td className="text-warn-700">
                    <Qty value={b.quarantined} />
                  </Td>
                  <Td className="text-bad-700">
                    <Qty value={b.damaged} />
                  </Td>
                  <Td>
                    <div className="flex gap-1">
                      {can("inventory:move") && Number(b.available) > 0 && (
                        <Button size="sm" variant="ghost" icon={<ArrowRightLeft className="h-3.5 w-3.5" />} onClick={() => setMoving(b)} aria-label="Move stock" />
                      )}
                      {can("inventory:quarantine") && Number(b.available) > 0 && (
                        <Button size="sm" variant="ghost" icon={<ShieldAlert className="h-3.5 w-3.5 text-warn-600" />} onClick={() => setQuarantine({ balance: b, release: false })} aria-label="Quarantine" />
                      )}
                      {can("inventory:quarantine") && Number(b.quarantined) > 0 && (
                        <Button size="sm" variant="ghost" icon={<ShieldCheck className="h-3.5 w-3.5 text-ok-600" />} onClick={() => setQuarantine({ balance: b, release: true })} aria-label="Release quarantine" />
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </Table>
          ) : (
            <EmptyState title="No stock here yet" />
          )}
        </Card>
      </div>
      <MoveModal balance={moving} onClose={() => setMoving(null)} />
      <QuarantineModal target={quarantine} onClose={() => setQuarantine(null)} />
      <Modal open={editingMap} onClose={() => setEditingMap(false)} title="Warehouse map location" description="Click the exact site location. This pin is visible to your organization's members and platform administrators." footer={<><Button variant="secondary" onClick={() => setEditingMap(false)}>Cancel</Button><Button disabled={!mapPoint} loading={saveMap.isPending} onClick={() => saveMap.mutate(undefined)}>Save map pin</Button></>}>
        <WarehouseMap warehouses={[]} selected={mapPoint} onPick={setMapPoint} />
        <p className="mt-3 font-mono text-xs text-muted">{mapPoint ? `${mapPoint.latitude}, ${mapPoint.longitude}` : "No location selected"}</p>
      </Modal>
    </>
  );
}
