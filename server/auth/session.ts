import type { Context, MiddlewareHandler } from "hono";
import type { AppEnv } from "../app.js";
import { AppError } from "../common/errors.js";
import { rowsOf, type ParsedRow } from "../repositories/rows.js";
import type { SheetName } from "../sheets/schema.js";
import type { SheetData } from "../sheets/store.js";
import { clearToken, readToken } from "./token.js";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** POST/PUT/PATCH/DELETE wajib header `X-Requested-With: saku` (02 §2, CSRF). */
export const csrf: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (UNSAFE_METHODS.has(c.req.method) && c.req.header("X-Requested-With") !== "saku") {
    throw new AppError(403, "Permintaan ditolak.");
  }
  await next();
};

/** Cek cookie JWT. Validasi ke sheet `Pengguna` dilakukan di `loadSession`. */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const claims = await readToken(c);
  if (!claims) throw new AppError(401, "Sesi berakhir, silakan login ulang.");
  c.set("claims", claims);
  await next();
};

export interface Session<S extends SheetName> {
  user: ParsedRow<"Pengguna">;
  data: Record<S | "Pengguna", SheetData>;
}

/**
 * Baca `Pengguna` + sheet yang dibutuhkan handler dalam satu batchGet, lalu pastikan
 * pengguna masih aktif dan `versi_token` cocok dengan token.
 */
export async function loadSession<S extends SheetName>(c: Context<AppEnv>, sheets: readonly S[] = []): Promise<Session<S>> {
  const claims = c.var.claims;
  if (!claims) throw new AppError(401, "Sesi berakhir, silakan login ulang.");
  const names = [...new Set<S | "Pengguna">(["Pengguna", ...sheets])];
  const data = await c.var.store().readMany(names);
  const user = rowsOf(data, "Pengguna").find((r) => r.data.id === claims.sub);
  if (!user || !user.data.aktif || user.data.versi_token !== claims.ver) {
    clearToken(c);
    throw new AppError(401, "Sesi berakhir, silakan login ulang.");
  }
  return { user, data };
}

export function requireAdmin(user: ParsedRow<"Pengguna">) {
  if (user.data.peran !== "admin") throw new AppError(403, "Hanya admin yang boleh mengakses fitur ini.");
}
