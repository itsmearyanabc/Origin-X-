import { useState } from "react";
import { Link } from "react-router";
import { MailCheck } from "lucide-react";
import { Alert, Button, Field, Input, buttonClass } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { AuthCard } from "./AuthLayout";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState<{ demoResetToken?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      setSent(await api.post<{ demoResetToken?: string }>("/auth/forgot-password", { email }, false));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthCard title="Reset your password" description="Enter your account email and we'll send you a reset link." footer={<Link to="/sign-in" className="font-semibold text-brand-600 hover:underline">Back to sign in</Link>}>
      {sent ? (
        <div className="space-y-5 text-center">
          <MailCheck className="mx-auto h-12 w-12 text-ok-600" />
          <p className="text-sm text-ink-600">If an account exists for <span className="font-semibold text-ink-900">{email}</span>, a reset link is on its way. It expires in one hour.</p>
          {sent.demoResetToken && (
            <Alert tone="warn" title="Demo mode">
              Email delivery isn't configured, so here is your reset link directly.
              <Link to={`/reset-password?token=${encodeURIComponent(sent.demoResetToken)}`} className={buttonClass("secondary", "sm", "mt-3")}>
                Open reset link
              </Link>
            </Alert>
          )}
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-5">
          {error && <Alert tone="bad">{error}</Alert>}
          <Field label="Email">{(id) => <Input id={id} type="email" required autoFocus autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
          <Button type="submit" size="lg" className="w-full" loading={loading}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
