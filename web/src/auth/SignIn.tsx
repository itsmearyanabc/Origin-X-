import { useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowRight } from "lucide-react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { homeFor } from "@/components/guards";
import { errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { AuthCard } from "./AuthLayout";
import { PasswordInput } from "./PasswordInput";

const schema = z.object({ email: z.string().trim().email("Enter a valid email."), password: z.string().min(1, "Enter your password.") });

/** Only allow in-app redirects (prevents open redirects via ?next=). */
export function safeNext(next: string | null) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : null;
}

export default function SignIn() {
  const { signIn, status, me } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  const next = safeNext(params.get("next"));

  if (status === "authenticated" && me) return <Navigate to={next ?? homeFor(me)} replace />;

  const onSubmit = handleSubmit(async ({ email, password }) => {
    setError(null);
    try {
      const user = await signIn(email, password);
      navigate(next ?? homeFor(user), { replace: true });
    } catch (e) {
      setError(errorMessage(e));
    }
  });

  return (
    <AuthCard
      title="Welcome back"
      description="Sign in to your organization workspace or the ORIGINX admin console."
      footer={
        <>
          New to ORIGINX?{" "}
          <Link to="/sign-up" className="font-semibold text-brand-600 hover:underline">
            Create an organization
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        {error && <Alert tone="bad">{error}</Alert>}
        <Field label="Email" error={formState.errors.email?.message}>
          {(id) => <Input id={id} type="email" autoComplete="email" autoFocus aria-invalid={Boolean(formState.errors.email)} {...register("email")} />}
        </Field>
        <Field label="Password" error={formState.errors.password?.message}>
          {(id) => <PasswordInput id={id} autoComplete="current-password" aria-invalid={Boolean(formState.errors.password)} {...register("password")} />}
        </Field>
        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-sm font-semibold text-brand-600 hover:underline">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" size="lg" className="w-full" loading={formState.isSubmitting}>
          Sign in <ArrowRight className="h-4 w-4" />
        </Button>
      </form>
    </AuthCard>
  );
}
