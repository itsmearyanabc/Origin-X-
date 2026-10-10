import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, refreshSession, session } from "./api";
import { storage } from "./storage";
import type { Me, OrgRole } from "./types";

type Status = "loading" | "anonymous" | "authenticated";
type AuthResult = { user: { accountType: Me["accountType"] }; accessToken: string; demoEmailVerificationToken?: string };

type AuthContextValue = {
  status: Status;
  me: Me | null;
  activeOrgId: string | null;
  activeOrg: Me["organizations"][number] | null;
  role: OrgRole | null;
  isAdmin: boolean;
  signIn: (email: string, password: string) => Promise<Me>;
  signInWithGoogle: (credential: string) => Promise<Me>;
  signUp: (fullName: string, email: string, password: string) => Promise<Me>;
  signOut: () => Promise<void>;
  reload: () => Promise<Me | null>;
  selectOrganization: (id: string) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const ORG_KEY = "originx.activeOrg";

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<Status>("loading");
  const [me, setMe] = useState<Me | null>(null);
  const [activeOrgId, setActiveOrgId] = useState<string | null>(() => storage.get(ORG_KEY));

  const applyMe = useCallback((next: Me | null) => {
    setMe(next);
    setStatus(next ? "authenticated" : "anonymous");
    if (!next) return;
    const stored = storage.get(ORG_KEY);
    const valid = next.organizations.find((o) => o.organizationId === stored) ?? next.organizations[0] ?? null;
    session.setOrganization(valid?.organizationId ?? null);
    setActiveOrgId(valid?.organizationId ?? null);
  }, []);

  const reload = useCallback(async () => {
    try {
      const next = await api.get<Me>("/auth/me", undefined, false);
      applyMe(next);
      return next;
    } catch {
      applyMe(null);
      return null;
    }
  }, [applyMe]);

  // Restore the session from the httpOnly refresh cookie on first load.
  useEffect(() => {
    let cancelled = false;
    refreshSession().then(async (ok) => {
      if (cancelled) return;
      if (ok) await reload();
      else applyMe(null);
    });
    const off = session.onExpired(() => {
      session.setAccessToken(null);
      applyMe(null);
      queryClient.clear();
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [applyMe, reload, queryClient]);

  const finishAuth = useCallback(
    async (result: AuthResult) => {
      session.setAccessToken(result.accessToken);
      const next = await reload();
      if (!next) throw new Error("Could not load your profile.");
      return next;
    },
    [reload],
  );

  const signIn = useCallback(
    async (email: string, password: string) => finishAuth(await api.post<AuthResult>("/auth/login", { email, password }, false)),
    [finishAuth],
  );

  const signUp = useCallback(
    async (fullName: string, email: string, password: string) => finishAuth(await api.post<AuthResult>("/auth/register", { fullName, email, password }, false)),
    [finishAuth],
  );

  
  const signInWithGoogle = useCallback(async (credential: string) => {
    const { data } = await api.post<AuthResult>("/auth/google", { credential });
    session.set(data.accessToken);
    return await reload();
  }, [reload]);

  const signOut = useCallback(async () => {
    try {
      await api.post("/auth/logout", {}, false);
    } catch {
      // the cookie is cleared server-side even if the token was already invalid
    }
    session.setAccessToken(null);
    session.setOrganization(null);
    queryClient.clear();
    applyMe(null);
  }, [applyMe, queryClient]);

  const selectOrganization = useCallback(
    (id: string) => {
      storage.set(ORG_KEY, id);
      session.setOrganization(id);
      setActiveOrgId(id);
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] === "org" });
    },
    [queryClient],
  );

  const value = useMemo<AuthContextValue>(() => {
    const activeOrg = me?.organizations.find((o) => o.organizationId === activeOrgId) ?? null;
    return {
      status,
      me,
      activeOrgId,
      activeOrg,
      role: activeOrg?.role ?? null,
      isAdmin: me?.accountType === "PLATFORM_ADMIN",
      signIn,
      signInWithGoogle,
      signUp,
      signOut,
      reload,
      selectOrganization,
    };
  }, [status, me, activeOrgId, signIn, signUp, signOut, reload, selectOrganization]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

/** Mirrors ORG_PERMISSIONS on the server, used only to hide actions the API would refuse anyway. */
const PERMISSIONS: Record<string, OrgRole[]> = {
  "org:settings": ["ORG_OWNER"],
  "members:manage": ["ORG_OWNER", "ORG_ADMIN"],
  "relationships:manage": ["ORG_OWNER", "ORG_ADMIN"],
  "products:create": ["ORG_OWNER", "ORG_ADMIN", "ORG_MANAGER"],
  "products:update": ["ORG_OWNER", "ORG_ADMIN", "ORG_MANAGER"],
  "products:archive": ["ORG_OWNER", "ORG_ADMIN"],
  "events:create": ["ORG_OWNER", "ORG_ADMIN", "ORG_MANAGER", "ORG_OPERATOR"],
  "custody:request": ["ORG_OWNER", "ORG_ADMIN", "ORG_MANAGER"],
  "custody:respond": ["ORG_OWNER", "ORG_ADMIN", "ORG_MANAGER"],
  "incidents:create": ["ORG_OWNER", "ORG_ADMIN", "ORG_MANAGER", "ORG_OPERATOR"],
  "incidents:manage": ["ORG_OWNER", "ORG_ADMIN"],
  "recalls:manage": ["ORG_OWNER", "ORG_ADMIN"],
  "analytics:read": ["ORG_OWNER", "ORG_ADMIN", "ORG_MANAGER", "ORG_VIEWER"],
  "audit:read": ["ORG_OWNER", "ORG_ADMIN"],
  "demo:tamper": ["ORG_OWNER", "ORG_ADMIN"],
  "inventory:receive": ["ORG_OWNER", "ORG_ADMIN", "ORG_MANAGER", "ORG_OPERATOR"],
  "inventory:move": ["ORG_OWNER", "ORG_ADMIN", "ORG_MANAGER", "ORG_OPERATOR"],
  "inventory:reserve": ["ORG_OWNER", "ORG_ADMIN", "ORG_MANAGER"],
  "inventory:dispatch": ["ORG_OWNER", "ORG_ADMIN", "ORG_MANAGER"],
  "inventory:quarantine": ["ORG_OWNER", "ORG_ADMIN", "ORG_MANAGER"],
  "inventory:adjust": ["ORG_OWNER", "ORG_ADMIN"],
  "warehouses:manage": ["ORG_OWNER", "ORG_ADMIN"],
  "catalogue:manage": ["ORG_OWNER", "ORG_ADMIN", "ORG_MANAGER"],
  "shipments:manage": ["ORG_OWNER", "ORG_ADMIN", "ORG_MANAGER"],
  "shipments:receive": ["ORG_OWNER", "ORG_ADMIN", "ORG_MANAGER", "ORG_OPERATOR"],
};

export function useCan() {
  const { role } = useAuth();
  return (permission: keyof typeof PERMISSIONS) => Boolean(role && PERMISSIONS[permission]?.includes(role));
}

/** Admin permissions mirrored from ADMIN_PERMISSIONS. */
export function useAdminCan() {
  const { me } = useAuth();
  const role = me?.platformRole;
  return (permission: "orgs" | "users" | "compliance" | "audit" | "blockchain" | "settings") => {
    const map: Record<string, string[]> = {
      orgs: ["SUPER_ADMIN", "PLATFORM_ADMIN"],
      users: ["SUPER_ADMIN"],
      compliance: ["SUPER_ADMIN", "PLATFORM_ADMIN", "COMPLIANCE_ADMIN"],
      audit: ["SUPER_ADMIN", "PLATFORM_ADMIN", "COMPLIANCE_ADMIN"],
      blockchain: ["SUPER_ADMIN", "PLATFORM_ADMIN"],
      settings: ["SUPER_ADMIN"],
    };
    return Boolean(role && map[permission].includes(role));
  };
}
