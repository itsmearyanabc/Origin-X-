import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { useAuth } from "@/lib/auth";
import { Spinner } from "./ui";

function Loading() {
  return (
    <div className="grid min-h-screen place-items-center bg-bg">
      <Spinner className="h-7 w-7" />
    </div>
  );
}

/** Where a signed-in user belongs. */
export function homeFor(me: { accountType: string; organizations: unknown[] } | null) {
  if (!me) return "/sign-in";
  if (me.accountType === "PLATFORM_ADMIN") return "/admin";
  return me.organizations.length ? "/app" : "/onboarding";
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === "loading") return <Loading />;
  if (status === "anonymous") return <Navigate to={`/sign-in?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return <>{children}</>;
}

export function RequireOrgMember({ children }: { children: ReactNode }) {
  const { status, me } = useAuth();
  const location = useLocation();
  if (status === "loading") return <Loading />;
  if (status === "anonymous") return <Navigate to={`/sign-in?next=${encodeURIComponent(location.pathname)}`} replace />;
  if (me?.accountType === "PLATFORM_ADMIN" && !me.organizations.length) return <Navigate to="/admin" replace />;
  if (!me?.organizations.length) return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { status, isAdmin, me } = useAuth();
  const location = useLocation();
  if (status === "loading") return <Loading />;
  if (status === "anonymous") return <Navigate to={`/sign-in?next=${encodeURIComponent(location.pathname)}`} replace />;
  if (!isAdmin) return <Navigate to={homeFor(me)} replace />;
  return <>{children}</>;
}
