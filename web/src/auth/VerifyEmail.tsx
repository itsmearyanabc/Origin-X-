import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { CheckCircle2, MailCheck, XCircle } from "lucide-react";
import { Alert, Button, Spinner, buttonClass } from "@/components/ui";
import { ApiError, api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { homeFor } from "@/components/guards";
import { AuthCard } from "./AuthLayout";

const RESEND_SECONDS = 60;
const safeNext = (n: string | null) => (n && n.startsWith("/") && !n.startsWith("//") ? n : null);

/**
 * Email verification.
 *  - /verify-email?token=…  → legacy confirmation link from older emails (still honoured)
 *  - /verify-email          → enter the 6-digit code that was emailed (signed-in users)
 */
export default function VerifyEmail() {
  const [params] = useSearchParams();
  return params.get("token") ? <LinkVerification token={params.get("token")!} /> : <CodeVerification />;
}

function CodeVerification() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { me, status, reload } = useAuth();
  const next = safeNext(params.get("next"));
  const [digits, setDigits] = useState<string[]>(Array(6).fill(""));
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [cooldown, setCooldown] = useState(params.get("send") ? 0 : RESEND_SECONDS);
  const [sending, setSending] = useState(false);
  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  const autoSent = useRef(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const resend = async (auto = false) => {
    setSending(true);
    setError(null);
    try {
      await api.post("/auth/verify-email/request", {}, false);
      setNotice(`A new code is on its way to ${me?.email}.`);
      setDigits(Array(6).fill(""));
      inputs.current[0]?.focus();
      setCooldown(RESEND_SECONDS);
    } catch (e) {
      const wait = e instanceof ApiError ? (e.details as Array<{ retryAfterSeconds?: number }> | undefined)?.[0]?.retryAfterSeconds : undefined;
      if (wait) setCooldown(wait);
      // An automatic send right after another one: the earlier code is still valid — not an error.
      if (auto && e instanceof ApiError && e.code === "OTP_RESEND_TOO_SOON") setNotice(`We sent a code to ${me?.email} moments ago — use that one.`);
      else setError(errorMessage(e));
    } finally {
      setSending(false);
    }
  };

  // Arriving from the "confirm your email" banner: send a code straight away.
  useEffect(() => {
    if (params.get("send") && status === "authenticated" && me && !me.emailVerified && !autoSent.current) {
      autoSent.current = true;
      void resend(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, me]);

  const submit = async (code: string) => {
    if (code.length !== 6 || verifying) return;
    setVerifying(true);
    setError(null);
    try {
      await api.post("/auth/verify-email/otp", { code }, false);
      const fresh = await reload();
      navigate(next ?? (fresh ? homeFor(fresh) : "/onboarding"), { replace: true });
    } catch (e) {
      setError(errorMessage(e));
      setDigits(Array(6).fill(""));
      inputs.current[0]?.focus();
    } finally {
      setVerifying(false);
    }
  };

  const setDigit = (i: number, value: string) => {
    const v = value.replace(/\D/g, "");
    if (v.length > 1) return fill(v);
    const nextDigits = [...digits];
    nextDigits[i] = v;
    setDigits(nextDigits);
    if (v && i < 5) inputs.current[i + 1]?.focus();
    if (nextDigits.every(Boolean)) void submit(nextDigits.join(""));
  };
  const fill = (raw: string) => {
    const v = raw.replace(/\D/g, "").slice(0, 6).split("");
    const nextDigits = Array.from({ length: 6 }, (_, i) => v[i] ?? "");
    setDigits(nextDigits);
    inputs.current[Math.min(v.length, 5)]?.focus();
    if (v.length === 6) void submit(v.join(""));
  };
  const onKeyDown = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !digits[i] && i > 0) inputs.current[i - 1]?.focus();
    if (e.key === "ArrowLeft" && i > 0) inputs.current[i - 1]?.focus();
    if (e.key === "ArrowRight" && i < 5) inputs.current[i + 1]?.focus();
  };
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    fill(e.clipboardData.getData("text"));
  };

  if (status === "loading") return <Spinner className="mx-auto mt-24 h-8 w-8" />;
  if (status !== "authenticated" || !me) return <Navigate to={`/sign-in?next=${encodeURIComponent(`/verify-email${next ? `?next=${encodeURIComponent(next)}` : ""}`)}`} replace />;
  if (me.emailVerified) return <Navigate to={next ?? homeFor(me)} replace />;

  return (
    <AuthCard title="Verify your email" description={<>We sent a 6-digit code to <span className="font-semibold text-ink-900">{me.email}</span>. It expires in 10 minutes.</>}>
      <div className="space-y-5">
        <MailCheck className="mx-auto h-11 w-11 text-brand-500" />
        {error && <Alert tone="bad">{error}</Alert>}
        {notice && !error && <Alert tone="ok">{notice}</Alert>}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit(digits.join(""));
          }}
          className="space-y-5"
        >
          <div className="flex justify-center gap-2" role="group" aria-label="6-digit verification code">
            {digits.map((d, i) => (
              <input
                key={i}
                ref={(el) => {
                  inputs.current[i] = el;
                }}
                value={d}
                onChange={(e) => setDigit(i, e.target.value)}
                onKeyDown={(e) => onKeyDown(i, e)}
                onPaste={onPaste}
                onFocus={(e) => e.target.select()}
                inputMode="numeric"
                autoComplete={i === 0 ? "one-time-code" : "off"}
                maxLength={6}
                autoFocus={i === 0}
                disabled={verifying}
                aria-label={`Digit ${i + 1}`}
                className="h-14 w-11 rounded-xl border border-ink-200 bg-white text-center font-mono text-2xl font-bold text-ink-900 outline-none transition focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 disabled:opacity-60 sm:w-12"
              />
            ))}
          </div>
          <Button type="submit" size="lg" className="w-full" loading={verifying} disabled={digits.some((d) => !d)}>
            Verify email
          </Button>
        </form>
        <p className="text-center text-sm text-ink-600">
          Didn't get it? Check spam, or{" "}
          {cooldown > 0 ? (
            <span className="text-ink-400">resend in {cooldown}s</span>
          ) : (
            <button type="button" onClick={() => void resend()} disabled={sending} className="font-semibold text-brand-600 hover:underline disabled:opacity-60">
              {sending ? "Sending…" : "resend the code"}
            </button>
          )}
          .
        </p>
      </div>
    </AuthCard>
  );
}

function LinkVerification({ token }: { token: string }) {
  const { me, reload } = useAuth();
  const [state, setState] = useState<"working" | "ok" | "error">("working");
  const [message, setMessage] = useState("");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    api
      .post("/auth/verify-email", { token }, false)
      .then(() => {
        setState("ok");
        reload();
      })
      .catch((e) => {
        setState("error");
        setMessage(errorMessage(e));
      });
  }, [token, reload]);

  return (
    <AuthCard title="Email verification">
      <div className="space-y-5 text-center">
        {state === "working" && <Spinner className="mx-auto h-8 w-8" />}
        {state === "ok" && (
          <>
            <CheckCircle2 className="mx-auto h-12 w-12 text-ok-600" />
            <p className="text-sm text-ink-600">Your email address is verified.</p>
            <Link to={me ? homeFor(me) : "/sign-in"} className={buttonClass("primary", "lg", "w-full")}>
              Continue
            </Link>
          </>
        )}
        {state === "error" && (
          <>
            <XCircle className="mx-auto h-12 w-12 text-bad-600" />
            <p className="text-sm text-ink-600">{message}</p>
            {me && !me.emailVerified && (
              <Link to="/verify-email?send=1" className={buttonClass("primary", "lg", "w-full")}>
                Get a verification code instead
              </Link>
            )}
          </>
        )}
      </div>
    </AuthCard>
  );
}
