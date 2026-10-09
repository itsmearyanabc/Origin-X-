import { useState } from "react";
import { Inbox } from "lucide-react";
import { Card, EmptyState, PageHeader, Pagination, Select, Skeleton, StatusBadge } from "@/components/ui";
import { api } from "@/lib/api";
import { useAdminCan } from "@/lib/auth";
import { formatDateTime, humanize } from "@/lib/format";
import { useAdminMutation, useAdminQuery } from "../hooks";

type Msg = { id: string; name: string; email: string; company: string | null; topic: string; message: string; status: string; createdAt: string };

export default function AdminMessages() {
  const can = useAdminCan();
  const [status, setStatus] = useState("NEW");
  const [page, setPage] = useState(1);
  const list = useAdminQuery(["messages", status, page], () => api.page<Msg>("/admin/contact-messages", { status, page, pageSize: 20 }, false));
  const update = useAdminMutation(({ id, s }: { id: string; s: string }) => api.patch(`/admin/contact-messages/${id}`, { status: s }, false), { success: "Message updated" });
  return (
    <>
      <PageHeader
        title="Contact messages"
        description="Messages from the public website."
        actions={
          <Select value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))} className="w-44" aria-label="Status">
            <option value="">All</option>
            {["NEW", "IN_PROGRESS", "CLOSED"].map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </Select>
        }
      />
      {list.isLoading ? (
        <Skeleton className="h-48 rounded-2xl" />
      ) : list.data?.items.length ? (
        <div className="space-y-3">
          {list.data.items.map((m) => (
            <Card key={m.id} className="p-5">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold text-fg">{m.name}</p>
                <a href={`mailto:${m.email}`} className="text-sm text-brand-600 hover:underline">
                  {m.email}
                </a>
                {m.company && <span className="text-sm text-muted">· {m.company}</span>}
                <span className="ml-auto flex items-center gap-2">
                  <StatusBadge value={m.topic} />
                  <StatusBadge value={m.status} />
                </span>
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm text-fg">{m.message}</p>
              <div className="mt-3 flex items-center justify-between text-xs text-muted">
                <span>
                  {formatDateTime(m.createdAt)} · ref {m.id.slice(-8).toUpperCase()}
                </span>
                {can("orgs") && (
                  <span className="flex gap-3">
                    {m.status !== "IN_PROGRESS" && (
                      <button className="font-semibold text-brand-600" onClick={() => update.mutate({ id: m.id, s: "IN_PROGRESS" })}>
                        Mark in progress
                      </button>
                    )}
                    {m.status !== "CLOSED" && (
                      <button className="font-semibold text-brand-600" onClick={() => update.mutate({ id: m.id, s: "CLOSED" })}>
                        Close
                      </button>
                    )}
                  </span>
                )}
              </div>
            </Card>
          ))}
          <Pagination page={list.data.meta.page} pageCount={list.data.meta.pageCount} onPage={setPage} />
        </div>
      ) : (
        <Card>
          <EmptyState icon={<Inbox className="h-5 w-5" />} title="No messages" />
        </Card>
      )}
    </>
  );
}
