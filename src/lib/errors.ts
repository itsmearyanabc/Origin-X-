export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const notFound = (resource: string, code = `${resource.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase()}_NOT_FOUND`) =>
  new AppError(code, `${resource.replace(/([a-z])([A-Z])/g, "$1 $2")} could not be found.`, 404);

export const forbidden = (message = "You do not have permission to perform this action.", code = "FORBIDDEN") =>
  new AppError(code, message, 403);

export function ok<T>(data: T, meta?: Record<string, unknown>) {
  return { success: true as const, data, ...(meta ? { meta } : {}) };
}

export function fail(code: string, message: string, details?: unknown) {
  return {
    success: false as const,
    error: { code, message, ...(details !== undefined ? { details } : {}) },
  };
}
