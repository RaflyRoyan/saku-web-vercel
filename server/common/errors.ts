import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export type FieldErrors = Record<string, string[]>;

/** Error yang dikirim ke client sebagai ProblemDetails (`application/problem+json`). */
export class AppError extends Error {
  status: ContentfulStatusCode;
  title: string;
  errors?: FieldErrors;
  /** Field tambahan di body ProblemDetails, mis. daftar transaksi yang bentrok. */
  extra?: Record<string, unknown>;

  constructor(status: ContentfulStatusCode, title: string, errors?: FieldErrors, extra?: Record<string, unknown>) {
    super(title);
    this.name = "AppError";
    this.status = status;
    this.title = title;
    this.errors = errors;
    this.extra = extra;
  }
}

/** 400 dengan pesan per field, mis. `{ nominal: ["Nominal harus lebih dari 0."] }`. */
export function validationError(errors: FieldErrors): AppError {
  return new AppError(400, "Data yang dikirim tidak valid.", errors);
}

/** 502: database gagal diakses. */
export function storageError(): AppError {
  return new AppError(502, "Gagal mengakses penyimpanan data.");
}

export function problem(
  c: Context,
  status: ContentfulStatusCode,
  title: string,
  extra?: Record<string, unknown>,
) {
  return c.body(JSON.stringify({ title, status, ...extra }), status, {
    "Content-Type": "application/problem+json",
  });
}

export function problemFromError(c: Context, err: unknown) {
  if (err instanceof AppError) {
    return problem(c, err.status, err.title, { ...err.extra, ...(err.errors ? { errors: err.errors } : {}) });
  }
  if (err instanceof HTTPException) {
    // Mis. body JSON rusak dari validator Hono
    const title = err.status === 400 ? "Format data tidak valid." : "Permintaan tidak dapat diproses.";
    return problem(c, err.status as ContentfulStatusCode, title);
  }
  console.error("Error tak tertangani:", err instanceof Error ? err.message : err);
  return problem(c, 500, "Terjadi kesalahan pada server.");
}
