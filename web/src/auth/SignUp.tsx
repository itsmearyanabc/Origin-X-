import { GoogleOAuthProvider, GoogleLogin } from '@react-oauth/google';
import { useRef, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, ArrowRight, Building2, Check, ScanLine } from "lucide-react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { homeFor } from "@/components/guards";
import { errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { AuthCard } from "./AuthLayout";
import { PasswordInput, PasswordStrength, passwordRule } from "./PasswordInput";
import { safeNext } from "./SignIn";
import { Turnstile, useTurnstileSiteKey, type TurnstileHandle } from "@/components/Turnstile";

const schema = z.object({
  fullName: z.string().trim().min(2, "Enter your full name."),
  email: z.string().trim().email("Enter a valid work email."),
  password: z.string().refine(passwordRule, "Use at least 10 characters with letters and numbers."),
  terms: z.literal(true, { errorMap: () => ({ message: "Please accept the terms to continue." }) }),
});

function Chooser({ onBusiness }: { onBusiness: () => void }) {
  const navigate = useNavigate();
  const options = [
    { icon: Building2, title: "I'm a business", text: "Manufacturer, brand, distributor, logistics, warehouse or retailer. Register products and manage custody.", action: onBusiness, primary: true },
    { icon: ScanLine, title: "I want to check a product", text: "No account needed. Scan the QR code on the packaging or enter its code.", action: () => navigate("/verify") },
  ];
  return (
    <div className="space-y-3">
      {options.map((o, i) => (
        <motion.button
          key={o.title}
          type="button"
          onClick={o.action}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 + i * 0.08 }}
          className="group flex w-full items-start gap-4 rounded-2xl border border-ink-200 bg-white p-5 text-left shadow-soft transition-all duration-300 hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-lift"
        >
          <div className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl transition-colors ${o.primary ? "bg-brand-500 text-white" : "bg-ink-100 text-ink-700 group-hover:bg-brand-50 group-hover:text-brand-600"}`}>
            <o.icon className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <p className="font-bold text-ink-900">{o.title}</p>
            <p className="mt-1 text-sm leading-relaxed text-ink-600">{o.text}</p>
          </div>
          <ArrowRight className="mt-1 h-5 w-5 text-ink-300 transition-transform group-hover:translate-x-1 group-hover:text-brand-500" />
        </motion.button>
      ))}
    </div>
  );
}

export default function SignUp() {
  const { signUp, signInWithGoogle, status, me } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [step, setStep] = useState<"choose" | "account">(params.get("type") === "org" || params.get("next") ? "account" : "choose");
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState, watch } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { password: "" } });
  const next = safeNext(params.get("next"));

  const { siteKey: humanCheckKey } = useTurnstileSiteKey();
  const [humanToken, setHumanToken] = useState<string | null>(null);
  const humanCheck = useRef<TurnstileHandle>(null);

  if (status === "authenticated" && me && !formState.isSubmitting) return <Navigate to={next ?? homeFor(me)} replace />;

  
  const handleGoogleSuccess = async (response: any) => {
    setError(null);
    try {
      if (response.credential) {
        await signInWithGoogle(response.credential);
        navigate(next ?? "/onboarding", { replace: true });
      }
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    try {
      await signUp(v.fullName, v.email, v.password, humanToken ?? undefined);
      // Email sign-ups confirm their address with the 6-digit code we just emailed.
      navigate(`/verify-email?next=${encodeURIComponent(next ?? "/onboarding")}`, { replace: true });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      humanCheck.current?.reset();
    }
  });

  return (
    <AuthCard
      title={step === "choose" ? "How will you use ORIGINX?" : "Create your account"}
      description={step === "choose" ? "Organizations manage products and custody. Anyone can verify a product — for free." : "You'll set up your organization in the next step."}
      footer={
        <>
          Already have an account?{" "}
          <Link to={`/sign-in${next ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-semibold text-brand-600 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <AnimatePresence mode="wait">
        {step === "choose" ? (
          <motion.div key="choose" exit={{ opacity: 0, x: -20 }}>
            <Chooser onBusiness={() => setStep("account")} />
          </motion.div>
        ) : (
          <motion.form key="account" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} onSubmit={onSubmit} className="space-y-5" noValidate>
            {error && <Alert tone="bad">{error}</Alert>}
            <Field label="Full name" error={formState.errors.fullName?.message}>
              {(id) => <Input id={id} autoComplete="name" autoFocus aria-invalid={Boolean(formState.errors.fullName)} {...register("fullName")} />}
            </Field>
            <Field label="Work email" error={formState.errors.email?.message}>
              {(id) => <Input id={id} type="email" autoComplete="email" aria-invalid={Boolean(formState.errors.email)} {...register("email")} />}
            </Field>
            <Field label="Password" error={formState.errors.password?.message}>
              {(id) => (
                <>
                  <PasswordInput id={id} autoComplete="new-password" aria-invalid={Boolean(formState.errors.password)} {...register("password")} />
                  <PasswordStrength value={watch("password")} />
                </>
              )}
            </Field>
            <label className="flex items-start gap-3 text-sm text-ink-600">
              <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-ink-300 accent-brand-500" {...register("terms")} />
              <span>
                I agree to the{" "}
                <Link to="/terms" target="_blank" className="font-semibold text-brand-600 hover:underline">
                  Terms
                </Link>{" "}
                and{" "}
                <Link to="/privacy" target="_blank" className="font-semibold text-brand-600 hover:underline">
                  Privacy policy
                </Link>
                .
              </span>
            </label>
            {formState.errors.terms && <p className="-mt-3 text-xs font-medium text-bad-600">{formState.errors.terms.message}</p>}
            <Turnstile ref={humanCheck} action="signup" onToken={setHumanToken} />
            <Button type="submit" size="lg" className="w-full" loading={formState.isSubmitting} disabled={Boolean(humanCheckKey) && !humanToken}>
              Create account <ArrowRight className="h-4 w-4" />
            </Button>

            <GoogleOAuthProvider clientId="402692437838-h7uhhn5i1h4gfep3afig79ce2et0ksan.apps.googleusercontent.com">
              <div className="relative my-4">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-300" /></div>
                <div className="relative flex justify-center text-sm"><span className="bg-white px-2 text-gray-500">Or continue with</span></div>
              </div>
              <div className="flex justify-center">
                <GoogleLogin
                  onSuccess={handleGoogleSuccess}
                  onError={() => setError("Google Sign-Up failed.")}
                  useOneTap
                  text="signup_with"
                />
              </div>
            </GoogleOAuthProvider>

            <ul className="grid gap-1.5 pt-1 text-xs text-ink-500">
              {["Free plan: 100 products, 3 team members", "Your organization is reviewed by ORIGINX before it shows as verified"].map((t) => (
                <li key={t} className="flex items-center gap-2">
                  <Check className="h-3.5 w-3.5 text-brand-500" /> {t}
                </li>
              ))}
            </ul>
            {!params.get("type") && (
              <button type="button" onClick={() => setStep("choose")} className="inline-flex items-center gap-1 text-sm font-medium text-ink-500 hover:text-ink-800">
                <ArrowLeft className="h-4 w-4" /> Back
              </button>
            )}
          </motion.form>
        )}
      </AnimatePresence>
    </AuthCard>
  );
}
