import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { sign, verify } from "hono/jwt";
import type { AppEnv } from "../app.js";

export const COOKIE_NAME = "saku_token";
const DAY_MS = 24 * 60 * 60 * 1000;

export interface Claims {
  sub: string;
  role: string;
  ver: number;
  name: string;
  /** Detik epoch, dicek dengan clock aplikasi (bukan jam sistem) supaya bisa di-mock. */
  exp: number;
}

/** Buat JWT dan pasang cookie. Mengembalikan `expiresAt` (ISO). */
export async function issueToken(
  c: Context<AppEnv>,
  user: { id: string; peran: string; versi_token: number | null; nama: string },
): Promise<string> {
  const { jwtSecret, jwtExpireDays } = c.var.settings();
  const now = c.var.clock.now().getTime();
  const expiresAt = new Date(now + jwtExpireDays * DAY_MS);
  const claims: Claims = {
    sub: user.id,
    role: user.peran,
    ver: user.versi_token ?? 1,
    name: user.nama,
    exp: Math.floor(expiresAt.getTime() / 1000),
  };
  const token = await sign({ ...claims }, jwtSecret, "HS256");
  setCookie(c, COOKIE_NAME, token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:", // lokal (http) tanpa Secure
    sameSite: "Lax",
    path: "/",
    maxAge: jwtExpireDays * 24 * 60 * 60,
  });
  return expiresAt.toISOString();
}

export function clearToken(c: Context<AppEnv>) {
  deleteCookie(c, COOKIE_NAME, { path: "/" });
}

/** Klaim dari cookie, atau null kalau tidak ada / rusak / kedaluwarsa. */
export async function readToken(c: Context<AppEnv>): Promise<Claims | null> {
  const token = getCookie(c, COOKIE_NAME);
  if (!token) return null;
  try {
    const payload = await verify(token, c.var.settings().jwtSecret, { alg: "HS256", exp: false, nbf: false, iat: false });
    const { sub, role, ver, name, exp } = payload as Partial<Claims>;
    if (typeof sub !== "string" || typeof ver !== "number" || typeof exp !== "number") return null;
    if (exp * 1000 <= c.var.clock.now().getTime()) return null;
    return { sub, role: String(role), ver, name: String(name), exp };
  } catch {
    return null;
  }
}
