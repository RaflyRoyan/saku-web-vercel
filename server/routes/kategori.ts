import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app.js";
import { loadSession, requireAdmin, requireAuth } from "../auth/session.js";
import { AppError } from "../common/errors.js";
import { jsonBody } from "../common/validation.js";
import { newId, newRow, notFound, rowsOf, updatedRow, type ParsedRow } from "../repositories/rows.js";

// Kategori = master bersama semua pengguna; hanya admin yang menulis (02 §2).

const namaSchema = z
  .string({ error: "Nama kategori wajib diisi." })
  .trim()
  .min(1, { error: "Nama kategori wajib diisi." })
  .max(40, { error: "Nama kategori maksimal 40 karakter." });
const tipeSchema = z.enum(["masuk", "keluar"], { error: "Tipe harus masuk atau keluar." });

export interface KategoriDto {
  id: string;
  nama: string;
  tipe: string;
  kodeSistem: string | null;
  aktif: boolean;
}

const toDto = (k: ParsedRow<"Kategori">["data"]): KategoriDto => ({
  id: k.id,
  nama: k.nama,
  tipe: k.tipe,
  kodeSistem: k.kode_sistem || null,
  aktif: k.aktif,
});

/** Nama unik per tipe (case-insensitive) di antara kategori aktif. */
function assertNamaFree(rows: ParsedRow<"Kategori">[], nama: string, tipe: string, exceptId?: string) {
  const n = nama.toLowerCase();
  if (rows.some((r) => r.data.aktif && r.data.id !== exceptId && r.data.tipe === tipe && r.data.nama.toLowerCase() === n)) {
    throw new AppError(409, "Nama kategori sudah dipakai.", { nama: ["Nama kategori sudah dipakai."] });
  }
}

function findKategori(rows: ParsedRow<"Kategori">[], id: string) {
  const found = rows.find((r) => r.data.id === id);
  if (!found) throw notFound();
  return found;
}

export const kategori = new Hono<AppEnv>();

kategori.use(requireAuth);

kategori.get("/", async (c) => {
  const tipe = c.req.query("tipe");
  const untukInput = c.req.query("untukInput") === "true";
  const termasukNonaktif = c.req.query("termasukNonaktif") === "true";
  const { data } = await loadSession(c, ["Kategori"]);

  // Urutan mengikuti urutan baris di sheet
  const list = rowsOf(data, "Kategori")
    .filter(({ data: k }) => (!tipe || k.tipe === tipe) && (termasukNonaktif || k.aktif) && !(untukInput && k.kode_sistem))
    .map((r) => toDto(r.data));
  return c.json(list);
});

kategori.post("/", jsonBody(z.object({ nama: namaSchema, tipe: tipeSchema })), async (c) => {
  const body = c.req.valid("json");
  const { user, data } = await loadSession(c, ["Kategori"]);
  requireAdmin(user);
  const rows = rowsOf(data, "Kategori");
  assertNamaFree(rows, body.nama, body.tipe);

  const baru = { id: newId("Kategori", rows), nama: body.nama, tipe: body.tipe, kode_sistem: "", aktif: true };
  await c.var.store().append("Kategori", [newRow("Kategori", baru, user.data.id, c.var.clock)]);
  return c.json(toDto({ ...baru, created_by: "", created_at: null, updated_by: "", updated_at: null }), 201);
});

kategori.put("/:id", jsonBody(z.object({ nama: namaSchema })), async (c) => {
  const { nama } = c.req.valid("json");
  const { user, data } = await loadSession(c, ["Kategori"]);
  requireAdmin(user);
  const rows = rowsOf(data, "Kategori");
  const target = findKategori(rows, c.req.param("id"));
  if (target.data.aktif) assertNamaFree(rows, nama, target.data.tipe, target.data.id);

  await c.var.store().updateRow("Kategori", target.row, updatedRow("Kategori", target.data, { nama }, user.data.id, c.var.clock));
  return c.json(toDto({ ...target.data, nama }));
});

kategori.put("/:id/aktif", jsonBody(z.object({ aktif: z.boolean({ error: "Aktif harus true/false." }) })), async (c) => {
  const { aktif } = c.req.valid("json");
  const { user, data } = await loadSession(c, ["Kategori"]);
  requireAdmin(user);
  const rows = rowsOf(data, "Kategori");
  const target = findKategori(rows, c.req.param("id"));

  if (!aktif && target.data.kode_sistem) throw new AppError(409, "Kategori sistem tidak bisa dinonaktifkan.");
  if (aktif) assertNamaFree(rows, target.data.nama, target.data.tipe, target.data.id);

  if (target.data.aktif !== aktif) {
    await c.var.store().updateRow("Kategori", target.row, updatedRow("Kategori", target.data, { aktif }, user.data.id, c.var.clock));
  }
  return c.body(null, 204);
});
