/**
 * ORIGINX API client.
 * - Access token lives only in memory (never localStorage).
 * - Refresh token is an httpOnly cookie; refresh calls send X-Requested-With (CSRF guard).
 * - A 401 triggers one shared refresh, then the request is retried once.
 */
export type ApiErrorBody = { code: string; message: string; details?: Array<{ path: string; message: string }> };

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: ApiErrorBody["details"],
  ) {
    super(message);
  }
}

export type Meta = { total: number; page: number; pageSize: number; pageCount: number };
export type Paged<T> = { items: T[]; meta: Meta };

let accessToken: string | null = null;
let organizationId: string | null = null;
let refreshing: Promise<boolean> | null = null;
const listeners = new Set<() => void>();

export const session = {
  setAccessToken(token: string | null) {
    accessToken = token;
  },
  hasAccessToken: () => Boolean(accessToken),
  setOrganization(id: string | null) {
    organizationId = id;
  },
  getOrganization: () => organizationId,
  /** Notified when the session is irrecoverably lost (refresh failed). */
  onExpired(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

const BASE = "/api/v1";

async function parse<T>(res: Response): Promise<{ data: T; meta?: Meta }> {
  let body: { success: boolean; data?: T; meta?: Meta; error?: ApiErrorBody } | null = null;
  try {
    body = await res.json();
  } catch {
    // non-JSON (proxy error page, network issue)
  }
  if (!res.ok || !body?.success) {
    const err = body?.error;
    throw new ApiError(res.status, err?.code ?? "NETWORK_ERROR", err?.message ?? "The server could not be reached. Please try again.", err?.details);
  }
  return { data: body.data as T, meta: body.meta };
}

export async function refreshSession(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const res = await fetch(`${BASE}/auth/refresh`, {
          method: "POST",
          credentials: "include",
          headers: { "X-Requested-With": "originx-web" },
        });
        const { data } = await parse<{ accessToken: string }>(res);
        accessToken = data.accessToken;
        return true;
      } catch {
        accessToken = null;
        return false;
      } finally {
        setTimeout(() => (refreshing = null), 0);
      }
    })();
  }
  return refreshing;
}

type RequestOptions = { body?: unknown; query?: Record<string, string | number | undefined | null>; org?: boolean; auth?: boolean };

async function request<T>(method: string, path: string, opts: RequestOptions = {}, retried = false): Promise<{ data: T; meta?: Meta }> {
  const url = new URL(`${BASE}${path}`, window.location.origin);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  const headers: Record<string, string> = { "X-Requested-With": "originx-web" };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.auth !== false && accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (opts.org && organizationId) headers["X-Organization-Id"] = organizationId;

  const res = await fetch(url.toString().replace(window.location.origin, ""), {
    method,
    headers,
    credentials: "include",
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401 && opts.auth !== false && !retried && !path.startsWith("/auth/")) {
    if (await refreshSession()) return request<T>(method, path, opts, true);
    listeners.forEach((fn) => fn());
  }
  return parse<T>(res);
}

export const api = {
  get: <T>(path: string, query?: RequestOptions["query"], org = true) => request<T>("GET", path, { query, org }).then((r) => r.data),
  page: <T>(path: string, query?: RequestOptions["query"], org = true) =>
    request<T[]>("GET", path, { query, org }).then((r) => ({ items: r.data, meta: r.meta! }) as Paged<T>),
  post: <T>(path: string, body?: unknown, org = true) => request<T>("POST", path, { body: body ?? {}, org }).then((r) => r.data),
  patch: <T>(path: string, body?: unknown, org = true) => request<T>("PATCH", path, { body: body ?? {}, org }).then((r) => r.data),
  put: <T>(path: string, body?: unknown, org = true) => request<T>("PUT", path, { body: body ?? {}, org }).then((r) => r.data),
  delete: <T>(path: string, org = true) => request<T>("DELETE", path, { org }).then((r) => r.data),
  /** Unauthenticated public call (consumer verification, contact form). */
  public: <T>(method: "GET" | "POST", path: string, body?: unknown) => request<T>(method, path, { body, auth: false }).then((r) => r.data),
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.details?.length) return error.details.map((d) => (d.path ? `${d.path}: ${d.message}` : d.message)).join(" · ");
    return error.message;
  }
  return "Something went wrong. Please try again.";
}
