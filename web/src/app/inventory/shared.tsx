import { useState } from "react";
import { Alert, Button, Field, Input, Modal, Select, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { cn, humanize } from "@/lib/format";
import type { BatchRow, SkuStock, Warehouse } from "@/lib/types";
import { useOrgMutation, useOrgQuery } from "../hooks";

/** Formats an exact decimal string without floating-point noise. */
export function fmtQty(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "—";
  const s = String(value);
  const [int, frac] = s.split(".");
  const grouped = Number(int).toLocaleString();
  const trimmed = frac?.replace(/0+$/, "");
  return trimmed ? `${grouped}.${trimmed}` : grouped;
}

export function Qty({ value, unit, className, muted }: { value: string | number | null | undefined; unit?: string; className?: string; muted?: boolean }) {
  const zero = Number(value ?? 0) === 0;
  return (
    <span className={cn("tabular-nums", (muted || zero) && "text-muted", className)}>
      {fmtQty(value)}
      {unit && <span className="ml-1 text-xs font-normal text-muted">{unit}</span>}
    </span>
  );
}

export const UNITS = ["PCS", "BOX", "CARTON", "PALLET", "PACK", "DOSE", "VIAL", "KG", "G", "L", "ML", "M"];

export function useWarehouses() {
  return useOrgQuery(["warehouses"], () => api.get<Warehouse[]>("/warehouses"));
}
export function useSkus() {
  return useOrgQuery(["inventory", "products"], () => api.get<SkuStock[]>("/inventory/products"));
}
export function useBatches() {
  return useOrgQuery(["batches", "all"], () => api.page<BatchRow>("/batches", { pageSize: 100 }));
}

/** Warehouse → location picker (active locations only). */
export function LocationSelect({ value, onChange, warehouseId, label = "Location", required }: { value: string; onChange: (id: string) => void; warehouseId?: string; label?: string; required?: boolean }) {
  const warehouses = useWarehouses();
  const list = (warehouses.data ?? []).filter((w) => w.status === "ACTIVE" && (!warehouseId || w.id === warehouseId));
  return (
    <Field label={label} required={required}>
      {(id) => (
        <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select a location…</option>
          {list.map((w) => (
            <optgroup key={w.id} label={`${w.code} · ${w.name}`}>
              {w.locations
                .filter((l) => l.status === "ACTIVE")
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {w.code} / {l.code}
                    {l.zone ? ` (${l.zone})` : ""}
                  </option>
                ))}
            </optgroup>
          ))}
        </Select>
      )}
    </Field>
  );
}

const MOVEMENTS: Array<{ type: string; label: string; help: string; permission: Parameters<ReturnType<typeof useCan>>[0]; reason?: boolean; bucket?: boolean; direction?: boolean }> = [
  { type: "RECEIPT", label: "Receive new stock", help: "Stock produced or bought from outside ORIGINX (your own SKUs).", permission: "inventory:receive" },
  { type: "OPENING_BALANCE", label: "Opening balance", help: "Record stock you already had when starting with ORIGINX.", permission: "inventory:receive" },
  { type: "CUSTOMER_RETURN", label: "Customer return", help: "Goods returned by a customer.", permission: "inventory:receive", reason: true, bucket: true },
  { type: "DAMAGE", label: "Record damage", help: "Moves stock from available to damaged.", permission: "inventory:receive", reason: true },
  { type: "DISPATCH", label: "Dispatch outside ORIGINX", help: "Sales or deliveries to parties not on ORIGINX. Use Shipments for partners.", permission: "inventory:dispatch", reason: true },
  { type: "SUPPLIER_RETURN", label: "Return to supplier", help: "Stock sent back to an external supplier.", permission: "inventory:dispatch", reason: true },
  { type: "LOSS", label: "Record loss", help: "Stock that is gone (theft, expiry write-off). Creates a discrepancy for review.", permission: "inventory:adjust", reason: true, bucket: true },
  { type: "STOCK_ADJUSTMENT", label: "Stock adjustment", help: "Audited correction after a count. Decreases create a discrepancy for review.", permission: "inventory:adjust", reason: true, bucket: true, direction: true },
];

export function MovementModal({ open, onClose, defaults }: { open: boolean; onClose: () => void; defaults?: { skuId?: string; batchId?: string; locationId?: string; type?: string } }) {
  const can = useCan();
  const skus = useSkus();
  const batches = useBatches();
  const allowed = MOVEMENTS.filter((m) => can(m.permission));
  const [form, setForm] = useState({ type: defaults?.type ?? allowed[0]?.type ?? "RECEIPT", skuId: defaults?.skuId ?? "", batchId: defaults?.batchId ?? "", locationId: defaults?.locationId ?? "", quantity: "", reason: "", bucket: "ON_HAND", direction: "INCREASE" });
  const meta = MOVEMENTS.find((m) => m.type === form.type);
  const sku = skus.data?.find((s) => s.id === form.skuId);
  const skuBatches = (batches.data?.items ?? []).filter((b) => b.skuId === form.skuId);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const m = useOrgMutation(
    () =>
      api.post("/inventory/movements", {
        type: form.type,
        skuId: form.skuId,
        batchId: form.batchId || null,
        locationId: form.locationId,
        quantity: form.quantity,
        reason: form.reason || undefined,
        bucket: meta?.bucket ? form.bucket : undefined,
        direction: meta?.direction ? form.direction : undefined,
      }),
    { success: "Movement recorded in the ledger", onSuccess: onClose },
  );
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Record stock movement"
      description="Every movement is written to the append-only inventory ledger with your name and reason."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!form.skuId || !form.locationId || !form.quantity || (meta?.reason && form.reason.trim().length < 3)} loading={m.isPending} onClick={() => m.mutate(undefined)}>
            Record movement
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Movement" className="sm:col-span-2" hint={meta?.help}>
          {(id) => (
            <Select id={id} value={form.type} onChange={(e) => set("type")(e.target.value)}>
              {allowed.map((mv) => (
                <option key={mv.type} value={mv.type}>
                  {mv.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="SKU" required>
          {(id) => (
            <Select id={id} value={form.skuId} onChange={(e) => setForm((f) => ({ ...f, skuId: e.target.value, batchId: "" }))}>
              <option value="">Select…</option>
              {skus.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.sku} · {s.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Batch" hint="Leave empty for SKU-level stock">
          {(id) => (
            <Select id={id} value={form.batchId} onChange={(e) => set("batchId")(e.target.value)} disabled={!form.skuId}>
              <option value="">No batch</option>
              {skuBatches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.batchCode}
                  {b.holdStatus !== "NONE" ? ` (${b.holdStatus.toLowerCase()})` : ""}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="sm:col-span-2">
          <LocationSelect value={form.locationId} onChange={set("locationId")} required />
        </div>
        <Field label={`Quantity${sku ? ` (${sku.unitOfMeasure})` : ""}`} required hint={sku && !sku.allowsFractional ? "Whole numbers only for this unit." : undefined}>
          {(id) => <Input id={id} inputMode="decimal" value={form.quantity} onChange={(e) => set("quantity")(e.target.value)} />}
        </Field>
        {meta?.direction && (
          <Field label="Direction">
            {(id) => (
              <Select id={id} value={form.direction} onChange={(e) => set("direction")(e.target.value)}>
                <option value="INCREASE">Increase</option>
                <option value="DECREASE">Decrease</option>
              </Select>
            )}
          </Field>
        )}
        {meta?.bucket && (
          <Field label="Stock bucket">
            {(id) => (
              <Select id={id} value={form.bucket} onChange={(e) => set("bucket")(e.target.value)}>
                {["ON_HAND", "QUARANTINED", "DAMAGED"].map((b) => (
                  <option key={b} value={b}>
                    {humanize(b)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        {meta?.reason !== undefined && (
          <Field label="Reason" required={meta.reason} className="sm:col-span-2">
            {(id) => <Textarea id={id} rows={2} value={form.reason} onChange={(e) => set("reason")(e.target.value)} />}
          </Field>
        )}
        {form.batchId && batches.data?.items.find((b) => b.id === form.batchId)?.holdStatus !== "NONE" && (
          <Alert tone="warn" className="sm:col-span-2">
            This batch is on hold. Incoming stock is booked as quarantined and cannot be dispatched.
          </Alert>
        )}
      </div>
    </Modal>
  );
}
