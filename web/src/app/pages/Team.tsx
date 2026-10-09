import { useState } from "react";
import { Copy, Mail, UserPlus, Users } from "lucide-react";
import { Alert, Button, Card, CardHeader, EmptyState, Field, Input, Modal, PageHeader, Select, Skeleton, StatusBadge, Table, Td, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth, useCan } from "@/lib/auth";
import { formatDate, humanize } from "@/lib/format";
import type { Invitation, Member, OrgRole } from "@/lib/types";
import { useOrgMutation, useOrgQuery } from "../hooks";

const ROLES: Array<{ value: OrgRole; text: string }> = [
  { value: "ORG_OWNER", text: "Full control, settings and billing" },
  { value: "ORG_ADMIN", text: "Manage products, team (non-owners) and operations" },
  { value: "ORG_MANAGER", text: "Products, custody, shipments, incidents" },
  { value: "ORG_OPERATOR", text: "Record events, receive stock, scan" },
  { value: "ORG_VIEWER", text: "Read-only" },
];

function InviteModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { role } = useAuth();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<OrgRole>("ORG_OPERATOR");
  const [link, setLink] = useState<string | null>(null);
  const allowed = ROLES.filter((r) => role === "ORG_OWNER" || !["ORG_OWNER", "ORG_ADMIN"].includes(r.value));
  const m = useOrgMutation(() => api.post<{ acceptToken: string }>("/organizations/current/invitations", { email, role: inviteRole }), {
    success: "Invitation created",
    onSuccess: (r) => setLink(`${window.location.origin}/invite?token=${encodeURIComponent(r.acceptToken)}`),
  });
  const close = () => {
    setLink(null);
    setEmail("");
    onClose();
  };
  return (
    <Modal open={open} onClose={close} title="Invite a teammate" footer={link ? <Button onClick={close}>Done</Button> : <><Button variant="secondary" onClick={close}>Cancel</Button><Button disabled={!/^\S+@\S+\.\S+$/.test(email)} loading={m.isPending} onClick={() => m.mutate(undefined)}>Create invitation</Button></>}>
      {link ? (
        <div className="space-y-4">
          <Alert tone="ok" title="Invitation ready">Send this link to {email}. It works only for that email address and expires in 7 days.</Alert>
          <div className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2">
            <span className="hash flex-1 truncate text-muted">{link}</span>
            <Button size="sm" variant="ghost" icon={<Copy className="h-3.5 w-3.5" />} onClick={() => navigator.clipboard?.writeText(link).then(() => toast("ok", "Link copied"))}>
              Copy
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <Field label="Email">{(id) => <Input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
          <div className="space-y-2" role="radiogroup" aria-label="Role">
            {allowed.map((r) => (
              <label key={r.value} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${inviteRole === r.value ? "border-brand-400 bg-brand-50 dark:bg-brand-500/10" : "border-line"}`}>
                <input type="radio" name="role" checked={inviteRole === r.value} onChange={() => setInviteRole(r.value)} className="mt-1 accent-brand-500" />
                <span>
                  <span className="block text-sm font-semibold text-fg">{humanize(r.value)}</span>
                  <span className="text-xs text-muted">{r.text}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}

export default function Team() {
  const { me, role } = useAuth();
  const can = useCan();
  const [inviting, setInviting] = useState(false);
  const members = useOrgQuery(["members"], () => api.get<Member[]>("/organizations/current/members"));
  const invitations = useOrgQuery(["invitations"], () => api.get<Invitation[]>("/organizations/current/invitations"), { enabled: can("members:manage") });
  const changeRole = useOrgMutation(({ id, role: r }: { id: string; role: string }) => api.patch(`/organizations/current/members/${id}`, { role: r }), { success: "Role updated" });
  const remove = useOrgMutation((id: string) => api.delete(`/organizations/current/members/${id}`), { success: "Member removed" });
  const revoke = useOrgMutation((id: string) => api.delete(`/organizations/current/invitations/${id}`), { success: "Invitation revoked" });
  const privileged = (r: string) => r === "ORG_OWNER" || r === "ORG_ADMIN";

  return (
    <>
      <PageHeader
        title="Team"
        description="People in this organization and what they can do."
        actions={
          can("members:manage") && (
            <Button icon={<UserPlus className="h-4 w-4" />} onClick={() => setInviting(true)}>
              Invite
            </Button>
          )
        }
      />
      <Card>
        <CardHeader title="Members" />
        {members.isLoading ? (
          <Skeleton className="m-5 h-32" />
        ) : members.data?.length ? (
          <Table head={["Name", "Email", "Role", "Status", "Joined", ""]}>
            {members.data.map((m) => {
              const self = m.user.id === me?.id;
              const editable = can("members:manage") && m.status === "ACTIVE" && !self && (role === "ORG_OWNER" || !privileged(m.role));
              return (
                <tr key={m.id}>
                  <Td className="font-semibold">
                    {m.user.fullName} {self && <span className="text-xs font-normal text-muted">(you)</span>}
                  </Td>
                  <Td className="text-muted">{m.user.email}</Td>
                  <Td>
                    {editable ? (
                      <Select value={m.role} onChange={(e) => changeRole.mutate({ id: m.id, role: e.target.value })} className="h-9 w-40" aria-label={`Role of ${m.user.fullName}`}>
                        {ROLES.filter((r) => role === "ORG_OWNER" || !privileged(r.value)).map((r) => (
                          <option key={r.value} value={r.value}>
                            {humanize(r.value)}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      humanize(m.role)
                    )}
                  </Td>
                  <Td>
                    <StatusBadge value={m.status} />
                  </Td>
                  <Td className="text-muted">{formatDate(m.createdAt)}</Td>
                  <Td>
                    {editable && (
                      <Button size="sm" variant="ghost" onClick={() => confirm(`Remove ${m.user.fullName}?`) && remove.mutate(m.id)}>
                        Remove
                      </Button>
                    )}
                  </Td>
                </tr>
              );
            })}
          </Table>
        ) : (
          <EmptyState icon={<Users className="h-5 w-5" />} title="No members" />
        )}
      </Card>
      {can("members:manage") && (
        <Card className="mt-4">
          <CardHeader title="Invitations" />
          {invitations.data?.length ? (
            <Table head={["Email", "Role", "Status", "Expires", ""]}>
              {invitations.data.map((i) => (
                <tr key={i.id}>
                  <Td>
                    <span className="inline-flex items-center gap-2">
                      <Mail className="h-4 w-4 text-muted" />
                      {i.email}
                    </span>
                  </Td>
                  <Td>{humanize(i.role)}</Td>
                  <Td>
                    <StatusBadge value={i.status} />
                  </Td>
                  <Td className="text-muted">{formatDate(i.expiresAt)}</Td>
                  <Td>
                    {i.status === "PENDING" && (
                      <Button size="sm" variant="ghost" onClick={() => revoke.mutate(i.id)}>
                        Revoke
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          ) : (
            <EmptyState title="No invitations" />
          )}
        </Card>
      )}
      <InviteModal open={inviting} onClose={() => setInviting(false)} />
    </>
  );
}
