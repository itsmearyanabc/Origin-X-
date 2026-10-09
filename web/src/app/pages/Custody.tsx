import { useState } from "react";
import { Link } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeftRight, ArrowRight, Check, Inbox, Send, X } from "lucide-react";
import { Button, Card, CardHeader, EmptyState, ErrorState, Field, Input, Modal, PageHeader, Select, Skeleton, StatusBadge, Table, Tabs, Td, Textarea } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { formatDateTime, humanize, timeAgo } from "@/lib/format";
import type { CustodyTransfer } from "@/lib/types";
import { useOrgMutation, useOrgQuery } from "../hooks";

const RECEIPT_TYPES = [
  ["CUSTODY_TRANSFERRED", "Custody transferred"],
  ["RECEIVED", "Received"],
  ["WAREHOUSE_RECEIVED", "Warehouse received"],
  ["RETAILER_RECEIVED", "Retailer received"],
];

function AcceptModal({ transfer, onClose }: { transfer: CustodyTransfer | null; onClose: () => void }) {
  const [receiptEventType, setType] = useState("CUSTODY_TRANSFERRED");
  const [location, setLocation] = useState("");
  const m = useOrgMutation((t: CustodyTransfer) => api.post(`/custody-transfers/${t.id}/accept`, { receiptEventType, location: location || undefined }), {
    success: "Custody accepted — the handoff is recorded and anchored",
    onSuccess: onClose,
  });
  return (
    <Modal
      open={Boolean(transfer)}
      onClose={onClose}
      title="Accept custody"
      description={transfer ? `${transfer.product.productName} from ${transfer.fromOrg.name}. Accepting makes your organization the custodian.` : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={m.isPending} onClick={() => transfer && m.mutate(transfer)} icon={<Check className="h-4 w-4" />}>
            Accept & record
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Record the handoff as">
          {(id) => (
            <Select id={id} value={receiptEventType} onChange={(e) => setType(e.target.value)}>
              {RECEIPT_TYPES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Receiving location">{(id) => <Input id={id} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Facility or city" />}</Field>
      </div>
    </Modal>
  );
}

function RejectModal({ transfer, onClose }: { transfer: CustodyTransfer | null; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const m = useOrgMutation((t: CustodyTransfer) => api.post(`/custody-transfers/${t.id}/reject`, { reason: reason || undefined }), { success: "Transfer rejected", onSuccess: onClose });
  return (
    <Modal
      open={Boolean(transfer)}
      onClose={onClose}
      title="Reject transfer"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" loading={m.isPending} onClick={() => transfer && m.mutate(transfer)}>
            Reject
          </Button>
        </>
      }
    >
      <Field label="Reason (shared with the sender)">{(id) => <Textarea id={id} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Wrong lot, damaged packaging…" />}</Field>
    </Modal>
  );
}

export default function Custody() {
  const can = useCan();
  const [tab, setTab] = useState<"incoming" | "outgoing" | "history">("incoming");
  const [accepting, setAccepting] = useState<CustodyTransfer | null>(null);
  const [rejecting, setRejecting] = useState<CustodyTransfer | null>(null);
  const incoming = useOrgQuery(["custody", "incoming"], () => api.get<CustodyTransfer[]>("/custody-transfers", { direction: "incoming", status: "TRANSFER_REQUESTED" }));
  const outgoing = useOrgQuery(["custody", "outgoing"], () => api.get<CustodyTransfer[]>("/custody-transfers", { direction: "outgoing", status: "TRANSFER_REQUESTED" }));
  const history = useOrgQuery(["custody", "all"], () => api.get<CustodyTransfer[]>("/custody-transfers"), { enabled: tab === "history" });
  const cancel = useOrgMutation((id: string) => api.post(`/custody-transfers/${id}/cancel`), { success: "Transfer cancelled" });

  const pendingList = tab === "incoming" ? incoming : outgoing;

  return (
    <>
      <PageHeader title="Custody transfers" description="Two-party handoffs: custody only moves when the receiving organization accepts." />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "incoming", label: `Incoming${incoming.data?.length ? ` (${incoming.data.length})` : ""}` },
          { value: "outgoing", label: `Awaiting partner${outgoing.data?.length ? ` (${outgoing.data.length})` : ""}` },
          { value: "history", label: "History" },
        ]}
      />
      <div className="mt-4">
        {tab !== "history" ? (
          pendingList.isLoading ? (
            <Skeleton className="h-32 rounded-2xl" />
          ) : pendingList.isError ? (
            <Card>
              <ErrorState message={errorMessage(pendingList.error)} />
            </Card>
          ) : !pendingList.data?.length ? (
            <Card>
              <EmptyState icon={tab === "incoming" ? <Inbox className="h-5 w-5" /> : <Send className="h-5 w-5" />} title={tab === "incoming" ? "Nothing waiting for you" : "No pending outgoing transfers"} description={tab === "incoming" ? "When a partner sends you a product, it appears here for you to accept." : "Start a transfer from a product in your custody."} />
            </Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              <AnimatePresence>
                {pendingList.data.map((t) => (
                  <motion.div key={t.id} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }}>
                    <Card className="p-5">
                      <div className="flex items-start justify-between gap-3">
                        <Link to={`/app/products/${t.product.id}`} className="min-w-0">
                          <p className="truncate font-semibold text-fg hover:text-brand-600">{t.product.productName}</p>
                          <p className="hash text-muted">{t.product.productCode}</p>
                        </Link>
                        <StatusBadge value={t.status} />
                      </div>
                      <div className="mt-4 flex items-center gap-3 rounded-xl bg-surface-2 px-4 py-3 text-sm">
                        <span className="truncate font-medium text-fg">{t.fromOrg.name}</span>
                        <ArrowRight className="h-4 w-4 shrink-0 text-brand-500" />
                        <span className="truncate font-medium text-fg">{t.toOrg.name}</span>
                      </div>
                      {t.note && <p className="mt-3 text-sm text-muted">"{t.note}"</p>}
                      <div className="mt-4 flex items-center justify-between gap-3">
                        <span className="text-xs text-muted">Requested {timeAgo(t.requestedAt)}</span>
                        {tab === "incoming" && can("custody:respond") && (
                          <div className="flex gap-2">
                            <Button size="sm" variant="secondary" icon={<X className="h-3.5 w-3.5" />} onClick={() => setRejecting(t)}>
                              Reject
                            </Button>
                            <Button size="sm" icon={<Check className="h-3.5 w-3.5" />} onClick={() => setAccepting(t)}>
                              Accept
                            </Button>
                          </div>
                        )}
                        {tab === "outgoing" && can("custody:request") && (
                          <Button size="sm" variant="secondary" loading={cancel.isPending && cancel.variables === t.id} onClick={() => cancel.mutate(t.id)}>
                            Cancel
                          </Button>
                        )}
                      </div>
                    </Card>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )
        ) : (
          <Card>
            <CardHeader title="All transfers" />
            {history.isLoading ? (
              <Skeleton className="m-5 h-24" />
            ) : history.data?.length ? (
              <Table head={["Product", "From", "To", "Status", "Recorded as", "Updated"]}>
                {history.data.map((t) => (
                  <tr key={t.id}>
                    <Td>
                      <Link to={`/app/products/${t.product.id}`} className="font-medium text-fg hover:text-brand-600">
                        {t.product.productName}
                      </Link>
                    </Td>
                    <Td>{t.fromOrg.name}</Td>
                    <Td>{t.toOrg.name}</Td>
                    <Td>
                      <StatusBadge value={t.status} />
                    </Td>
                    <Td className="text-muted">{t.receiptEventType ? humanize(t.receiptEventType) : "—"}</Td>
                    <Td className="text-muted">{formatDateTime(t.respondedAt ?? t.requestedAt)}</Td>
                  </tr>
                ))}
              </Table>
            ) : (
              <EmptyState icon={<ArrowLeftRight className="h-5 w-5" />} title="No transfers yet" />
            )}
          </Card>
        )}
      </div>
      <AcceptModal transfer={accepting} onClose={() => setAccepting(null)} />
      <RejectModal transfer={rejecting} onClose={() => setRejecting(null)} />
    </>
  );
}
