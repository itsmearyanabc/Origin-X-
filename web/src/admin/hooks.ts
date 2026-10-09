import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { useOrgMutation } from "@/app/hooks";

/** Platform-admin queries (no tenant header). Cleared on sign-out like everything else. */
export function useAdminQuery<T>(key: unknown[], fn: () => Promise<T>, options: Omit<UseQueryOptions<T>, "queryKey" | "queryFn"> = {}) {
  return useQuery<T>({ queryKey: ["admin", ...key], queryFn: fn, ...options });
}

export const useAdminMutation = useOrgMutation;
