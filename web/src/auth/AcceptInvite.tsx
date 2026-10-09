import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { MailOpen } from "lucide-react";
import { Alert, Button, Spinner, buttonClass } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { AuthCard } from "./AuthLayout";

export default function AcceptInvite() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const { status, me, reload, selectOrganization } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const here = `/invite?token=${encodeURIComponent(token)}`;

  const accept = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.post<{ organizationId: string }>("/organizations/invitations/accept", { token }, false);
      await reload();
      selectOrganization(res.organizationId);
      navigate("/app", { replace: true });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  if (status === "loading") return <Spinner className="h-8 w-8" />;

  return (
    <AuthCard title="Join your team on ORIGINX" description="You've been invited to an organization workspace.">
      <div className="space-y-5">
        <div className="grid place-items-center rounded-2xl bg-brand-50 py-8">
          <MailOpen className="h-10 w-10 text-brand-600" />
        </div>
        {error && <Alert tone="bad">{error}</Alert>}
        {!token ? (
          <Alert tone="bad">This invitation link is incomplete. Ask your administrator to send it again.</Alert>
        ) : status === "authenticated" ? (
          <>
            <p className="text-sm text-ink-600">
              You're signed in as <span className="font-semibold text-ink-900">{me?.email}</span>. The invitation must have been sent to this address.
            </p>
            <Button size="lg" className="w-full" loading={loading} onClick={accept}>
              Accept invitation
            </Button>
          </>
        ) : (
          <div className="grid gap-3">
            <p className="text-sm text-ink-600">Sign in or create an account with the email address the invitation was sent to.</p>
            <Link to={`/sign-in?next=${encodeURIComponent(here)}`} className={buttonClass("primary", "lg")}>
              Sign in to accept
            </Link>
            <Link to={`/sign-up?next=${encodeURIComponent(here)}`} className={buttonClass("secondary", "lg")}>
              Create an account
            </Link>
          </div>
        )}
      </div>
    </AuthCard>
  );
}
