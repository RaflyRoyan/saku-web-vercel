import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { loadSession, requireAuth } from "../auth/session.js";
import { clearToken, issueToken } from "../auth/token.js";
import { nowWibIso, toWibIso } from "../common/clock.js";
import { AppError } from "../common/errors.js";
import { jsonBody } from "../common/validation.js";
import { newRow, rowsOf, updatedRow } from "../repositories/rows.js";
import {
  buildPengguna,
  ensureKategoriSistem,
  findByUsername,
  namaSchema,
  passwordSchema,
  toDto,
  usernameSchema,
} from "../services/pengguna.js";

const MAX_GAGAL = 5;
const LOCK_MS = 15 * 60 * 1000;
const LOGIN_SALAH = "Username atau password salah.";
const TERKUNCI = "Terlalu banyak percobaan. Coba lagi dalam 15 menit.";

// Hash pembanding untuk username yang tidak ada, supaya waktu respons sama
const dummyHashes = new Map<number, Promise<string>>();
const dummyHash = (iterations: number) => {
  let h = dummyHashes.get(iterations);
  if (!h) dummyHashes.set(iterations, (h = hashPassword("saku-dummy-password-1", iterations)));
  return h;
};

export const auth = new Hono<AppEnv>();

auth.get("/status", async (c) => {
  const { Pengguna } = await c.var.store().readMany(["Pengguna"]);
  return c.json({ perluSetup: rowsOf({ Pengguna }, "Pengguna").length === 0 });
});

auth.post(
  "/setup",
  jsonBody(z.object({ username: usernameSchema, password: passwordSchema, nama: namaSchema })),
  async (c) => {
    const body = c.req.valid("json");
    const store = c.var.store();
    const data = await store.readMany(["Pengguna", "Kategori"]);
    const existing = rowsOf(data, "Pengguna");
    if (existing.length) throw new AppError(409, "Setup awal sudah dilakukan.");

    const passwordHash = await hashPassword(body.password, c.var.settings().passwordIterations);
    const user = buildPengguna(existing, { username: body.username, nama: body.nama, peran: "admin", passwordHash });
    user.last_login = nowWibIso(c.var.clock);
    await store.append("Pengguna", [newRow("Pengguna", user, user.id, c.var.clock)]);
    await ensureKategoriSistem(store, data.Kategori, user.id, c.var.clock);

    const expiresAt = await issueToken(c, user);
    return c.json({ pengguna: toDto(user), expiresAt }, 201);
  },
);

auth.post(
  "/login",
  jsonBody(z.object({ username: z.string({ error: "Username wajib diisi." }), password: z.string({ error: "Password wajib diisi." }) })),
  async (c) => {
    const { username, password } = c.req.valid("json");
    const store = c.var.store();
    const clock = c.var.clock;
    const now = clock.now().getTime();
    const { Pengguna } = await store.readMany(["Pengguna"]);
    const found = findByUsername(rowsOf({ Pengguna }, "Pengguna"), username);

    if (!found) {
      await verifyPassword(password, await dummyHash(c.var.settings().passwordIterations));
      throw new AppError(401, LOGIN_SALAH);
    }

    const u = found.data;
    const lockedUntil = u.terkunci_sampai ? Date.parse(u.terkunci_sampai) : 0;
    if (lockedUntil > now) throw new AppError(429, TERKUNCI);

    const ok = (await verifyPassword(password, u.password_hash)) && u.aktif;
    if (!ok) {
      // Hitungan gagal di-reset kalau gagal terakhir (updated_at) lebih dari 15 menit lalu
      const lastFail = u.updated_at ? Date.parse(u.updated_at) : 0;
      const prev = lockedUntil > 0 || now - lastFail > LOCK_MS ? 0 : (u.gagal_login ?? 0);
      const gagal = prev + 1;
      const kunci = gagal >= MAX_GAGAL;
      await store.updateRow(
        "Pengguna",
        found.row,
        updatedRow(
          "Pengguna",
          u,
          { gagal_login: kunci ? 0 : gagal, terkunci_sampai: kunci ? toWibIso(new Date(now + LOCK_MS)) : null },
          u.id,
          clock,
        ),
      );
      throw new AppError(kunci ? 429 : 401, kunci ? TERKUNCI : LOGIN_SALAH);
    }

    const changes = { last_login: nowWibIso(clock), gagal_login: 0, terkunci_sampai: null };
    await store.updateRow("Pengguna", found.row, updatedRow("Pengguna", u, changes, u.id, clock));
    const expiresAt = await issueToken(c, u);
    return c.json({ pengguna: toDto({ ...u, ...changes }), expiresAt });
  },
);

auth.post("/logout", (c) => {
  clearToken(c);
  return c.body(null, 204);
});

auth.use("/me", requireAuth);
auth.use("/password", requireAuth);
auth.use("/profil", requireAuth);

auth.get("/me", async (c) => {
  const { user } = await loadSession(c);
  return c.json(toDto(user.data));
});

auth.put(
  "/password",
  jsonBody(z.object({ passwordLama: z.string({ error: "Password lama wajib diisi." }), passwordBaru: passwordSchema })),
  async (c) => {
    const { passwordLama, passwordBaru } = c.req.valid("json");
    const { user } = await loadSession(c);
    if (!(await verifyPassword(passwordLama, user.data.password_hash))) {
      throw new AppError(400, "Password lama salah.", { passwordLama: ["Password lama salah."] });
    }
    const changes = {
      password_hash: await hashPassword(passwordBaru, c.var.settings().passwordIterations),
      versi_token: (user.data.versi_token ?? 1) + 1,
    };
    await c.var.store().updateRow("Pengguna", user.row, updatedRow("Pengguna", user.data, changes, user.data.id, c.var.clock));
    const expiresAt = await issueToken(c, { ...user.data, ...changes });
    return c.json({ expiresAt });
  },
);

auth.put("/profil", jsonBody(z.object({ nama: namaSchema })), async (c) => {
  const { nama } = c.req.valid("json");
  const { user } = await loadSession(c);
  await c.var.store().updateRow("Pengguna", user.row, updatedRow("Pengguna", user.data, { nama }, user.data.id, c.var.clock));
  return c.json(toDto({ ...user.data, nama }));
});

