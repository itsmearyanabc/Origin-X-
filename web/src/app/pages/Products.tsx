import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowDownUp, Package, Plus, Search, ShieldAlert } from "lucide-react";
import { Alert, Button, Card, EmptyState, ErrorState, Field, Input, Modal, PageHeader, Pagination, Select, Skeleton, StatusBadge, Table, Tabs, Td, Textarea } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { formatDate, humanize } from "@/lib/format";
import type { ProductDetail, ProductListItem } from "@/lib/types";
import { LEVEL_COLOR, useOrgMutation, useOrgQuery } from "../hooks";

const schema = z.object({
  productCode: z.string().trim().min(2, "At least 2 characters.").max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._\-/]*$/, "Letters, digits and . _ - / only."),
  productName: z.string().trim().min(2, "Enter a product name."),
  category: z.string().trim().max(100).optional(),
  serialNumber: z.string().trim().max(100).optional(),
  batchCode: z.string().trim().max(64).optional(),
  originCountry: z.string().trim().max(60).optional(),
  originLocation: z.string().trim().max(200).optional(),
  manufacturingDate: z.string().optional(),
  expiryDate: z.string().optional(),
  currentLocation: z.string().trim().max(200).optional(),
  description: z.string().trim().max(2000).optional(),
});
type FormValues = z.infer<typeof schema>;
type CreateResult = { product: ProductDetail; collision: null | { detected: boolean; message: string; status: string } };

function clean(values: FormValues) {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) if (v && String(v).trim()) out[k] = String(v).trim();
  return out;
}

export function RegisterProductModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [collision, setCollision] = useState<CreateResult | null>(null);
  const { register, handleSubmit, formState, reset } = useForm<FormValues>({ resolver: zodResolver(schema) });
  const create = useOrgMutation((v: FormValues) => api.post<CreateResult>("/products", clean(v)), {
    onSuccess: (r) => {
      if (r.collision?.detected) setCollision(r);
      else {
        reset();
        onClose();
        navigate(`/app/products/${r.product.id}`);
      }
    },
    success: (r) => (r.collision?.detected ? "Registration quarantined: identity collision" : "Product registered and anchored on-chain"),
  });

  const close = () => {
    setCollision(null);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      size="lg"
      title={collision ? "Identity collision detected" : "Register a product"}
      description={collision ? undefined : "Creates the Digital Product Passport, registers its global identity on-chain and issues a QR token."}
      footer={
        collision ? (
          <>
            <Button variant="secondary" onClick={close}>
              Close
            </Button>
            <Button onClick={() => navigate(`/app/products/${collision.product.id}`)}>View quarantined record</Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" form="register-product" loading={create.isPending}>
              Register & anchor
            </Button>
          </>
        )
      }
    >
      {collision ? (
        <div className="space-y-4">
          <div className="flex gap-4 rounded-2xl bg-bad-50 p-5 text-bad-700 dark:bg-bad-500/10">
            <ShieldAlert className="h-8 w-8 shrink-0" />
            <div>
              <p className="font-bold">POTENTIAL COUNTERFEIT</p>
              <p className="mt-1 text-sm">{collision.collision?.message}</p>
            </div>
          </div>
          <p className="text-sm text-muted">If this product genuinely belongs to you, contact ORIGINX support with proof of ownership. The incident is visible in your Incidents list.</p>
        </div>
      ) : (
        <form id="register-product" onSubmit={handleSubmit((v) => create.mutate(v))} className="grid gap-4 sm:grid-cols-2" noValidate>
          <Field label="Product ID" required error={formState.errors.productCode?.message} hint="Your SKU / product code, e.g. RX-29481">
            {(id) => <Input id={id} className="hash" autoFocus aria-invalid={Boolean(formState.errors.productCode)} {...register("productCode")} />}
          </Field>
          <Field label="Serial number" hint="Optional — identifies a single unit">
            {(id) => <Input id={id} className="hash" {...register("serialNumber")} />}
          </Field>
          <Field label="Product name" required error={formState.errors.productName?.message} className="sm:col-span-2">
            {(id) => <Input id={id} aria-invalid={Boolean(formState.errors.productName)} {...register("productName")} />}
          </Field>
          <Field label="Category">{(id) => <Input id={id} placeholder="Vaccine, Electronics…" {...register("category")} />}</Field>
          <Field label="Batch code" hint="Created automatically if new">
            {(id) => <Input id={id} className="hash" {...register("batchCode")} />}
          </Field>
          <Field label="Origin location">{(id) => <Input id={id} placeholder="Delhi, India" {...register("originLocation")} />}</Field>
          <Field label="Origin country">{(id) => <Input id={id} placeholder="IN" {...register("originCountry")} />}</Field>
          <Field label="Manufacturing date">{(id) => <Input id={id} type="date" {...register("manufacturingDate")} />}</Field>
          <Field label="Expiry date">{(id) => <Input id={id} type="date" {...register("expiryDate")} />}</Field>
          <Field label="Current location" className="sm:col-span-2">
            {(id) => <Input id={id} placeholder="Plant 1, Delhi" {...register("currentLocation")} />}
          </Field>
          <Field label="Description" className="sm:col-span-2">
            {(id) => <Textarea id={id} rows={3} {...register("description")} />}
          </Field>
          <Alert tone="info" className="sm:col-span-2">
            Product ID, serial, batch, origin and dates are <b>sealed</b> into the first event and cannot be edited later.
          </Alert>
        </form>
      )}
    </Modal>
  );
}

export default function Products() {
  const [params, setParams] = useSearchParams();
  const can = useCan();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [scope, setScope] = useState<"all" | "registered" | "custody">("all");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("-createdAt");
  const [page, setPage] = useState(1);
  const [debounced, setDebounced] = useState(q);
  const creating = params.get("new") === "1";

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 300);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => setPage(1), [debounced, scope, status, sort]);

  const list = useOrgQuery(["products", debounced, scope, status, sort, page], () =>
    api.page<ProductListItem>("/products", { q: debounced, scope: scope === "all" ? undefined : scope, status, sort, page, pageSize: 15 }),
  );

  return (
    <>
      <PageHeader
        title="Products & passports"
        description="Every product your organization registered or currently holds."
        actions={
          can("products:create") && (
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setParams({ new: "1" })}>
              Register product
            </Button>
          )
        }
      />
      <Card>
        <div className="flex flex-col gap-3 border-b border-line p-4 lg:flex-row lg:items-center">
          <Tabs
            value={scope}
            onChange={setScope}
            tabs={[
              { value: "all", label: "All" },
              { value: "registered", label: "Registered by us" },
              { value: "custody", label: "In our custody" },
            ]}
          />
          <div className="flex flex-1 flex-col gap-3 sm:flex-row lg:justify-end">
            <div className="relative sm:w-72">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, ID or serial" className="pl-10" aria-label="Search products" />
            </div>
            <Select value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-44" aria-label="Filter by status">
              <option value="">All statuses</option>
              {["ACTIVE", "DELIVERED", "RECALLED", "QUARANTINED", "SUSPENDED", "ARCHIVED"].map((s) => (
                <option key={s} value={s}>
                  {humanize(s)}
                </option>
              ))}
            </Select>
            <Button variant="secondary" icon={<ArrowDownUp className="h-4 w-4" />} onClick={() => setSort((s) => (s === "-trustScore" ? "trustScore" : s === "trustScore" ? "-createdAt" : "-trustScore"))}>
              {sort === "-createdAt" ? "Newest" : sort === "-trustScore" ? "Highest trust" : "Lowest trust"}
            </Button>
          </div>
        </div>

        {list.isLoading ? (
          <div className="space-y-3 p-5">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-11" />
            ))}
          </div>
        ) : list.isError ? (
          <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />
        ) : !list.data?.items.length ? (
          <EmptyState icon={<Package className="h-5 w-5" />} title={debounced || status ? "No matching products" : "No products yet"} description={debounced || status ? "Try a different search or filter." : "Register a product to create its passport and QR code."} />
        ) : (
          <>
            <Table head={["Product", "Batch", "Custodian", "Status", "Trust", "Registered"]}>
              {list.data.items.map((p) => (
                <tr key={p.id} className="group transition hover:bg-surface-2">
                  <Td>
                    <Link to={`/app/products/${p.id}`} className="block">
                      <span className="block font-semibold text-fg group-hover:text-brand-600">{p.productName}</span>
                      <span className="hash text-muted">
                        {p.productCode}
                        {p.serialNumber ? ` · ${p.serialNumber}` : ""}
                      </span>
                    </Link>
                  </Td>
                  <Td className="hash text-muted">{p.batch?.batchCode ?? "—"}</Td>
                  <Td className="text-muted">{p.currentOwner?.name ?? "—"}</Td>
                  <Td>
                    <StatusBadge value={p.identity && !p.identity.isCanonical ? "QUARANTINED" : p.status} />
                  </Td>
                  <Td>
                    <span className="font-display text-base font-bold" style={{ color: LEVEL_COLOR[p.trustLevel] }}>
                      {p.trustScore}
                    </span>
                    <span className="ml-1.5 text-xs text-muted">{humanize(p.trustLevel)}</span>
                  </Td>
                  <Td className="text-muted">{formatDate(p.createdAt)}</Td>
                </tr>
              ))}
            </Table>
            <Pagination page={list.data.meta.page} pageCount={list.data.meta.pageCount} onPage={setPage} />
          </>
        )}
      </Card>
      <RegisterProductModal open={creating} onClose={() => setParams({})} />
    </>
  );
}
