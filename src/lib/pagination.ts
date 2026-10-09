import { AppError } from "./errors.js";

export type Query = Record<string, unknown>;

export function parsePagination(query: Query) {
  const page = Math.max(1, Number(query.page ?? 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize ?? 20) || 20));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export function pageMeta(total: number, page: number, pageSize: number) {
  return { total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

/**
 * `?sort=createdAt` or `?sort=-trustScore`. Only whitelisted fields are accepted so clients
 * cannot sort (and thereby probe) on arbitrary columns.
 */
export function parseSort<T extends string>(query: Query, allowed: readonly T[], fallback: T, fallbackDir: "asc" | "desc" = "desc") {
  const raw = typeof query.sort === "string" ? query.sort : "";
  if (!raw) return { [fallback]: fallbackDir } as Record<T, "asc" | "desc">;
  const dir = raw.startsWith("-") ? "desc" : "asc";
  const field = raw.replace(/^[-+]/, "") as T;
  if (!allowed.includes(field)) {
    throw new AppError("INVALID_SORT", `Sorting is supported on: ${allowed.join(", ")}.`, 400);
  }
  return { [field]: dir } as Record<T, "asc" | "desc">;
}

export function str(query: Query, key: string): string | undefined {
  const value = query[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export async function paginate<T>(
  query: Query,
  count: () => Promise<number>,
  fetch: (args: { skip: number; take: number }) => Promise<T[]>,
) {
  const { skip, take, page, pageSize } = parsePagination(query);
  const [total, items] = await Promise.all([count(), fetch({ skip, take })]);
  return { items, meta: pageMeta(total, page, pageSize) };
}
