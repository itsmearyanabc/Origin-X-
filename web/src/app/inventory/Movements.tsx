import { useState } from "react";
import { History, PackagePlus } from "lucide-react";
import { useSearchParams } from "react-router";
import { Button, Card, EmptyState, ErrorState, Input, PageHeader, Pagination, Select, Skeleton, Table } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { humanize } from "@/lib/format";
import type { InventoryTx } from "@/lib/types";
import { useOrgQuery } from "../hooks";
import { MovementRows } from "./InventoryOverview";
import { MovementModal, useSkus, useWarehouses } from "./shared";

const TYPES = ["OPENING_BALANCE", "RECEIPT", "DISPATCH", "TRANSFER_OUT", "TRANSFER_IN", "RESERVATION", "RESERVATION_RELEASE", "CUSTOMER_RETURN", "SUPPLIER_RETURN", "DAMAGE", "LOSS", "STOCK_ADJUSTMENT", "QUARANTINE", "QUARANTINE_RELEASE", "RECALL_ALLOCATION", "RECALL_RETURN"];

export default function Movements() {
  const can = useCan();
  const [params] = useSearchParams();
  const [filters, setFilters] = useState(() => ({ type: params.get("type") === "DISPATCH" ? "DISPATCH" : "", skuId: "", warehouseId: "", from: "", to: "" }));
  const [page, setPage] = useState(1);
  const [moving, setMoving] = useState(() => params.get("new") === "dispatch");
  const skus = useSkus();
  const warehouses = useWarehouses();
  const list = useOrgQuery(["inventory", "transactions", filters, page], () =>
    api.page<InventoryTx>("/inventory/transactions", { ...filters, from: filters.from ? new Date(filters.from).toISOString() : undefined, to: filters.to ? new Date(`${filters.to}T23:59:59`).toISOString() : undefined, page, pageSize: 25 }),
  );
  const set = (k: keyof typeof filters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFilters((f) => ({ ...f, [k]: e.target.value }));
    setPage(1);
  };
  return (
    <>
      <PageHeader
        title="Stock movements"
        description="The append-only inventory ledger: every receipt, dispatch, transfer, reservation, return, adjustment, quarantine and recall movement."
        actions={
          (can("inventory:receive") || can("inventory:adjust")) && (
            <Button icon={<PackagePlus className="h-4 w-4" />} onClick={() => setMoving(true)}>
              Record movement
            </Button>
          )
        }
      />
      <Card>
        <div className="grid gap-3 border-b border-line p-4 sm:grid-cols-2 lg:grid-cols-5">
          <Select value={filters.type} onChange={set("type")} aria-label="Type">
            <option value="">All types</option>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {humanize(t)}
              </option>
            ))}
          </Select>
          <Select value={filters.skuId} onChange={set("skuId")} aria-label="SKU">
            <option value="">All SKUs</option>
            {skus.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.sku}
              </option>
            ))}
          </Select>
          <Select value={filters.warehouseId} onChange={set("warehouseId")} aria-label="Warehouse">
            <option value="">All warehouses</option>
            {warehouses.data?.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code}
              </option>
            ))}
          </Select>
          <Input type="date" value={filters.from} onChange={set("from")} aria-label="From date" />
          <Input type="date" value={filters.to} onChange={set("to")} aria-label="To date" />
        </div>
        {list.isLoading ? (
          <Skeleton className="m-5 h-60" />
        ) : list.isError ? (
          <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />
        ) : list.data?.items.length ? (
          <>
            <Table head={["When", "Type", "Item", "Quantity", "Location", "Reference / reason", "By"]}>
              <MovementRows items={list.data.items} />
            </Table>
            <Pagination page={list.data.meta.page} pageCount={list.data.meta.pageCount} onPage={setPage} />
          </>
        ) : (
          <EmptyState icon={<History className="h-5 w-5" />} title="No movements match" />
        )}
      </Card>
      <MovementModal open={moving} onClose={() => setMoving(false)} defaults={{ type: params.get("type") === "DISPATCH" ? "DISPATCH" : undefined }} />
    </>
  );
}
