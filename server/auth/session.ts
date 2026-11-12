import type { Context, MiddlewareHandler } from "hono";
import type { AppEnv } from "../app.js";
import { AppError } from "../common/errors.js";
import { rowsOf, type Row } from "../repositories/rows.js";
import type { NamaTabel } from "../db/schema.js";
import type { DataTabel } from "../db/store.js";
import { clearToken, readToken } from "./token.js";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** POST/PUT/PATCH/DELETE wajib header `X-Requested-With: saku` (02 §2, CSRF). */
export const csrf: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (UNSAFE_METHODS.has(c.req.method) && c.req.header("X-Requested-With") !== "saku") {
    throw new AppError(403, "Permintaan ditolak.");
  }
  await next();
};

/** Cek cookie JWT. Validasi ke tabel `Pengguna` dilakukan di `loadSession`. */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const claims = await readToken(c);
  if (!claims) throw new AppError(401, "Sesi berakhir, silakan login ulang.");
  c.set("claims", claims);
  await next();
};

export interface Session<S extends NamaTabel> {
  user: Row<"Pengguna">;
  data: DataTabel<S | "Pengguna">;
}

export interface SessionOpsi {
  /** Baca tabel per pengguna milik semua pengguna (admin, mis. cek saldo akun sebelum dinonaktifkan). */
  semuaPengguna?: boolean;
}

/**
 * Baca `Pengguna` + tabel yang dibutuhkan handler, lalu pastikan pengguna masih aktif dan
 * `versi_token` cocok dengan token. Tabel per pengguna hanya berisi baris milik pengguna yang login.
 */
export async function loadSession<S extends NamaTabel>(
  c: Context<AppEnv>,
  tabel: readonly S[] = [],
  opsi: SessionOpsi = {},
): Promise<Session<S>> {
  const claims = c.var.claims;
  if (!claims) throw new AppError(401, "Sesi berakhir, silakan login ulang.");
  const names = [...new Set<S | "Pengguna">(["Pengguna", ...tabel])];
  const data = await c.var.store().read(names, opsi.semuaPengguna ? {} : { userId: claims.sub });
  const user = rowsOf(data, "Pengguna").find((r) => r.data.id === claims.sub);
  if (!user || !user.data.aktif || user.data.versi_token !== claims.ver) {
    clearToken(c);
    throw new AppError(401, "Sesi berakhir, silakan login ulang.");
  }
  return { user, data };
}

export function requireAdmin(user: Row<"Pengguna">) {
  if (user.data.peran !== "admin") throw new AppError(403, "Hanya admin yang boleh mengakses fitur ini.");
}
