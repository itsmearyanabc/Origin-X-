import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { CheckCircle2 } from "lucide-react";
import { Alert, Button, Field, buttonClass } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { AuthCard } from "./AuthLayout";
import { PasswordInput, PasswordStrength, passwordRule } from "./PasswordInput";

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordRule(password)) return setError("Use at least 10 characters with letters and numbers.");
    if (password !== confirm) return setError("Passwords don't match.");
    setError(null);
    setLoading(true);
    try {
      await api.post("/auth/reset-password", { token, password }, false);
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <AuthCard title="Invalid reset link" description="This link is missing its token. Request a new one.">
        <Link to="/forgot-password" className={buttonClass("primary", "lg", "w-full")}>
          Request a new link
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Choose a new password" description="For your security, this signs you out on every device.">
      {done ? (
        <div className="space-y-5 text-center">
          <CheckCircle2 className="mx-auto h-12 w-12 text-ok-600" />
          <p className="text-sm text-ink-600">Your password has been changed.</p>
          <Link to="/sign-in" className={buttonClass("primary", "lg", "w-full")}>
            Sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-5">
          {error && <Alert tone="bad">{error}</Alert>}
          <Field label="New password">
            {(id) => (
              <>
                <PasswordInput id={id} autoComplete="new-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
                <PasswordStrength value={password} />
              </>
            )}
          </Field>
          <Field label="Confirm password">{(id) => <PasswordInput id={id} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />}</Field>
          <Button type="submit" size="lg" className="w-full" loading={loading}>
            Update password
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
