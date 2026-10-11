import { GoogleOAuthProvider, GoogleLogin } from '@react-oauth/google';
import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowRight } from "lucide-react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { homeFor } from "@/components/guards";
import { ApiError, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { AuthCard } from "./AuthLayout";
import { PasswordInput } from "./PasswordInput";
import { Turnstile, useTurnstileSiteKey, type TurnstileHandle } from "@/components/Turnstile";

const schema = z.object({ email: z.string().trim().email("Enter a valid email."), password: z.string().min(1, "Enter your password.") });

/** Only allow in-app redirects (prevents open redirects via ?next=). */
export function safeNext(next: string | null) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : null;
}

/** 75 → "1:15", 4800 → "1:20:00". */
function clock(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

export default function SignIn() {
  const { signIn, signInWithGoogle, status, me } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  const next = safeNext(params.get("next"));

  const { siteKey: humanCheckKey } = useTurnstileSiteKey();
  const [humanToken, setHumanToken] = useState<string | null>(null);
  const humanCheck = useRef<TurnstileHandle>(null);

  // Brute-force lockout: the server pauses sign-in after repeated wrong passwords (30 s, 1 min,
  // 5 min, …). Count the pause down live and keep the button disabled until it ends.
  const [pausedUntil, setPausedUntil] = useState<number | null>(null);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!pausedUntil) return;
    const timer = setInterval(() => {
      if (Date.now() >= pausedUntil) {
        setPausedUntil(null);
        setError(null);
      } else setTick((n) => n + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [pausedUntil]);
  const pauseLeft = pausedUntil ? Math.max(0, Math.ceil((pausedUntil - Date.now()) / 1000)) : 0;

  if (status === "authenticated" && me) return <Navigate to={next ?? homeFor(me)} replace />;

  
  const handleGoogleSuccess = async (response: any) => {
    setError(null);
    try {
      if (response.credential) {
        const user = await signInWithGoogle(response.credential);
        navigate(next ?? homeFor(user), { replace: true });
      }
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const onSubmit = handleSubmit(async ({ email, password }) => {
    setError(null);
    try {
      const user = await signIn(email, password, humanToken ?? undefined);
      navigate(next ?? homeFor(user), { replace: true });
    } catch (e) {
      const wait = e instanceof ApiError && e.code === "LOGIN_LOCKED" ? (e.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds : undefined;
      if (wait) setPausedUntil(Date.now() + wait * 1000);
      setError(errorMessage(e));
    } finally {
      humanCheck.current?.reset(); // tokens are single-use
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

        <GoogleOAuthProvider clientId="402692437838-h7uhhn5i1h4gfep3afig79ce2et0ksan.apps.googleusercontent.com">
          <div className="mt-4 flex justify-center">
            <GoogleLogin
              onSuccess={handleGoogleSuccess}
              onError={() => setError("Google Sign-In failed.")}
              useOneTap
            />
          </div>
        </GoogleOAuthProvider>
        
        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-300" /></div>
          <div className="relative flex justify-center text-sm"><span className="bg-white px-2 text-gray-500">Or continue with</span></div>
        </div>

        {pauseLeft > 0 ? (
          <Alert tone="bad">
            Too many failed sign-in attempts. You can try again in <span className="font-mono font-semibold">{clock(pauseLeft)}</span>. Forgot your password?{" "}
            <Link to="/forgot-password" className="font-semibold underline">Reset it</Link> to sign in right away.
          </Alert>
        ) : (
          error && <Alert tone="bad">{error}</Alert>
        )}
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
        <Turnstile ref={humanCheck} action="login" onToken={setHumanToken} />
        <Button type="submit" size="lg" className="w-full" loading={formState.isSubmitting} disabled={pauseLeft > 0 || (Boolean(humanCheckKey) && !humanToken)}>
          {pauseLeft > 0 ? `Try again in ${clock(pauseLeft)}` : <>Sign in <ArrowRight className="h-4 w-4" /></>}
        </Button>
      </form>
    </AuthCard>
  );
}
