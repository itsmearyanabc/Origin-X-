import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { CheckCircle2, XCircle } from "lucide-react";
import { Spinner, buttonClass } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { homeFor } from "@/components/guards";
import { AuthCard } from "./AuthLayout";

export default function VerifyEmail() {
  const [params] = useSearchParams();
  const { me, reload } = useAuth();
  const [state, setState] = useState<"working" | "ok" | "error">("working");
  const [message, setMessage] = useState("");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    api
      .post("/auth/verify-email", { token: params.get("token") ?? "" }, false)
      .then(() => {
        setState("ok");
        reload();
      })
      .catch((e) => {
        setState("error");
        setMessage(errorMessage(e));
      });
  }, [params, reload]);

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
          </>
        )}
      </div>
    </AuthCard>
  );
}
