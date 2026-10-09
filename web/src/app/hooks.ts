import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from "@tanstack/react-query";
import { useToast } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";

/** Tenant-scoped query: cached per organization and cleared when the user switches organization. */
export function useOrgQuery<T>(key: unknown[], fn: () => Promise<T>, options: Omit<UseQueryOptions<T>, "queryKey" | "queryFn"> = {}) {
  const { activeOrgId } = useAuth();
  return useQuery<T>({ queryKey: ["org", activeOrgId, ...key], queryFn: fn, enabled: Boolean(activeOrgId) && (options.enabled ?? true), ...options });
}

/** Mutation with a success toast, error toast and a refresh of all tenant data. */
export function useOrgMutation<TVars, TResult>(fn: (vars: TVars) => Promise<TResult>, opts: { success?: string | ((r: TResult) => string); onSuccess?: (r: TResult) => void } = {}) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["org"] });
      qc.invalidateQueries({ queryKey: ["admin"] });
      if (opts.success) toast("ok", typeof opts.success === "function" ? opts.success(result) : opts.success);
      opts.onSuccess?.(result);
    },
    onError: (e) => toast("bad", errorMessage(e)),
  });
}

export const CHART = {
  brand: "#f25c05",
  brandSoft: "#ffae71",
  ok: "#059669",
  okSoft: "#10b981",
  warn: "#ca8a04",
  bad: "#dc2626",
  neutral: "#a8998b",
  grid: "rgb(168 153 139 / 0.25)",
};

export const LEVEL_COLOR: Record<string, string> = { EXCELLENT: CHART.ok, TRUSTED: CHART.okSoft, CAUTION: CHART.warn, HIGH_RISK: CHART.bad };
export const RESULT_COLOR: Record<string, string> = {
  HISTORY_VERIFIED: CHART.ok,
  AUTHENTIC: CHART.okSoft,
  RECALLED: CHART.bad,
  COUNTERFEIT: "#991b1b",
  HISTORY_COMPROMISED: "#b91c1c",
  SUSPICIOUS: CHART.warn,
  UNKNOWN: CHART.neutral,
};
