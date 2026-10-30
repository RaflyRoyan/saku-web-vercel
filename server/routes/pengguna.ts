import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app.js";
import { hashPassword } from "../auth/password.js";
import { loadSession, requireAdmin, requireAuth } from "../auth/session.js";
import { AppError } from "../common/errors.js";
import { jsonBody } from "../common/validation.js";
import { newRow, notFound, rowsOf, updatedRow } from "../repositories/rows.js";
import {
  assertUsernameFree,
  buildPengguna,
  countActiveAdmins,
  namaSchema,
  passwordSchema,
  peranSchema,
  toDto,
  usernameSchema,
} from "../services/pengguna.js";

export const pengguna = new Hono<AppEnv>();

pengguna.use(requireAuth);

pengguna.get("/", async (c) => {
  const { user, data } = await loadSession(c);
  requireAdmin(user);
  const list = rowsOf(data, "Pengguna").map((r) => toDto(r.data));
  list.sort((a, b) => a.nama.localeCompare(b.nama, "id"));
  return c.json(list);
});

pengguna.post(
  "/",
  jsonBody(z.object({ username: usernameSchema, password: passwordSchema, nama: namaSchema, peran: peranSchema })),
  async (c) => {
    const body = c.req.valid("json");
    const { user, data } = await loadSession(c);
    requireAdmin(user);
    const rows = rowsOf(data, "Pengguna");
    assertUsernameFree(rows, body.username);

    const passwordHash = await hashPassword(body.password, c.var.settings().passwordIterations);
    const baru = buildPengguna(rows, { username: body.username, nama: body.nama, peran: body.peran, passwordHash });
    await c.var.store().append("Pengguna", [newRow("Pengguna", baru, user.data.id, c.var.clock)]);
    return c.json(toDto(baru), 201);
  },
);

pengguna.put(
  "/:id",
  jsonBody(z.object({ nama: namaSchema, peran: peranSchema, aktif: z.boolean({ error: "Aktif harus true/false." }) })),
  async (c) => {
    const body = c.req.valid("json");
    const { user, data } = await loadSession(c);
    requireAdmin(user);
    const rows = rowsOf(data, "Pengguna");
    const target = rows.find((r) => r.data.id === c.req.param("id"));
    if (!target) throw notFound();

    if (target.data.id === user.data.id && !body.aktif) {
      throw new AppError(409, "Anda tidak bisa menonaktifkan akun sendiri.");
    }
    if (countActiveAdmins(rows, { id: target.data.id, peran: body.peran, aktif: body.aktif }) === 0) {
      throw new AppError(409, "Harus ada minimal 1 admin aktif.");
    }

    const dinonaktifkan = target.data.aktif && !body.aktif;
    const changes = {
      nama: body.nama,
      peran: body.peran,
      aktif: body.aktif,
      // Nonaktif → semua sesi pengguna itu berakhir
      versi_token: (target.data.versi_token ?? 1) + (dinonaktifkan ? 1 : 0),
    };
    await c.var.store().updateRow("Pengguna", target.row, updatedRow("Pengguna", target.data, changes, user.data.id, c.var.clock));
    return c.json(toDto({ ...target.data, ...changes }));
  },
);

pengguna.post("/:id/reset-password", jsonBody(z.object({ passwordBaru: passwordSchema })), async (c) => {
  const { passwordBaru } = c.req.valid("json");
  const { user, data } = await loadSession(c);
  requireAdmin(user);
  const target = rowsOf(data, "Pengguna").find((r) => r.data.id === c.req.param("id"));
  if (!target) throw notFound();

  const changes = {
    password_hash: await hashPassword(passwordBaru, c.var.settings().passwordIterations),
    versi_token: (target.data.versi_token ?? 1) + 1,
    gagal_login: 0,
    terkunci_sampai: null,
  };
  await c.var.store().updateRow("Pengguna", target.row, updatedRow("Pengguna", target.data, changes, user.data.id, c.var.clock));
  return c.body(null, 204);
});
