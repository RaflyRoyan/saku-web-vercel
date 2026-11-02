import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app.js";
import { loadSession, requireAdmin, requireAuth } from "../auth/session.js";
import { AppError, validationError } from "../common/errors.js";
import { jsonBody } from "../common/validation.js";
import { newId, newRow, notFound, rowsOf, updatedRow, type ParsedRow } from "../repositories/rows.js";
import { kelompokIdDari, LAINNYA } from "../services/kelompok.js";

// Kategori = master bersama semua pengguna; hanya admin yang menulis (02 §2).
// Di UI, kategori pengeluaran tampil sebagai "Sub kategori" di bawah kelompoknya (sheet KelompokKategori).

const namaSchema = z
  .string({ error: "Nama kategori wajib diisi." })
  .trim()
  .min(1, { error: "Nama kategori wajib diisi." })
  .max(40, { error: "Nama kategori maksimal 40 karakter." });
const tipeSchema = z.enum(["masuk", "keluar"], { error: "Tipe harus masuk atau keluar." });
/** Kosong / tidak dikirim / "LAINNYA" = kelompok Lainnya. */
const kelompokSchema = z.string().trim().optional();

export interface KategoriDto {
  id: string;
  nama: string;
  tipe: string;
  kodeSistem: string | null;
  aktif: boolean;
  /** Hanya pengeluaran; pemasukan = null. Tanpa kelompok = "LAINNYA". */
  kelompokId: string | null;
  kelompokNama: string | null;
}

type Kelompok = ParsedRow<"KelompokKategori">[];

const toDto =
  (kelompok: Kelompok) =>
  (k: ParsedRow<"Kategori">["data"]): KategoriDto => {
    const kelompokId = kelompokIdDari(k, kelompok);
    return {
      id: k.id,
      nama: k.nama,
      tipe: k.tipe,
      kodeSistem: k.kode_sistem || null,
      aktif: k.aktif,
      kelompokId,
      kelompokNama: kelompokId === null ? null : (kelompok.find((g) => g.data.id === kelompokId)?.data.nama ?? LAINNYA.nama),
    };
  };

/** Nama unik per tipe (case-insensitive) di antara kategori aktif. */
function assertNamaFree(rows: ParsedRow<"Kategori">[], nama: string, tipe: string, exceptId?: string) {
  const n = nama.toLowerCase();
  if (rows.some((r) => r.data.aktif && r.data.id !== exceptId && r.data.tipe === tipe && r.data.nama.toLowerCase() === n)) {
    throw new AppError(409, "Nama kategori sudah dipakai.", { nama: ["Nama kategori sudah dipakai."] });
  }
}

/**
 * Nilai `kelompok_id` yang disimpan. Pemasukan tidak boleh berkelompok.
 * Kelompok harus ada & aktif, kecuali sama dengan kelompok lama (saat edit).
 */
function resolveKelompok(tipe: string, kelompokId: string | undefined, kelompok: Kelompok, lama?: string): string {
  const id = !kelompokId || kelompokId === LAINNYA.id ? "" : kelompokId;
  if (tipe !== "keluar") {
    if (id) throw validationError({ kelompokId: ["Kategori pemasukan tidak memakai kelompok."] });
    return "";
  }
  if (!id || id === lama) return id;
  const g = kelompok.find((r) => r.data.id === id)?.data;
  if (!g) throw validationError({ kelompokId: ["Kategori tidak ditemukan."] });
  if (!g.aktif) throw validationError({ kelompokId: [`Kategori ${g.nama} nonaktif dan tidak bisa dipakai.`] });
  return id;
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
  const { data } = await loadSession(c, ["Kategori", "KelompokKategori"]);

  // Urutan mengikuti urutan baris di sheet
  const list = rowsOf(data, "Kategori")
    .filter(({ data: k }) => (!tipe || k.tipe === tipe) && (termasukNonaktif || k.aktif) && !(untukInput && k.kode_sistem))
    .map((r) => toDto(rowsOf(data, "KelompokKategori"))(r.data));
  return c.json(list);
});

kategori.post("/", jsonBody(z.object({ nama: namaSchema, tipe: tipeSchema, kelompokId: kelompokSchema })), async (c) => {
  const body = c.req.valid("json");
  const { user, data } = await loadSession(c, ["Kategori", "KelompokKategori"]);
  requireAdmin(user);
  const rows = rowsOf(data, "Kategori");
  const kelompok = rowsOf(data, "KelompokKategori");
  assertNamaFree(rows, body.nama, body.tipe);
  const kelompokId = resolveKelompok(body.tipe, body.kelompokId, kelompok);

  const baru = { id: newId("Kategori", rows), nama: body.nama, tipe: body.tipe, kode_sistem: "", aktif: true, kelompok_id: kelompokId };
  await c.var.store().append("Kategori", [newRow("Kategori", baru, user.data.id, c.var.clock)]);
  return c.json(toDto(kelompok)({ ...baru, created_by: "", created_at: null, updated_by: "", updated_at: null }), 201);
});

/** `kelompokId` tidak dikirim = kelompok tidak berubah. */
kategori.put("/:id", jsonBody(z.object({ nama: namaSchema, kelompokId: kelompokSchema })), async (c) => {
  const body = c.req.valid("json");
  const { user, data } = await loadSession(c, ["Kategori", "KelompokKategori"]);
  requireAdmin(user);
  const rows = rowsOf(data, "Kategori");
  const kelompok = rowsOf(data, "KelompokKategori");
  const target = findKategori(rows, c.req.param("id"));
  if (target.data.aktif) assertNamaFree(rows, body.nama, target.data.tipe, target.data.id);
  const kelompokId =
    body.kelompokId === undefined ? target.data.kelompok_id : resolveKelompok(target.data.tipe, body.kelompokId, kelompok, target.data.kelompok_id);

  const changes = { nama: body.nama, kelompok_id: kelompokId };
  await c.var.store().updateRow("Kategori", target.row, updatedRow("Kategori", target.data, changes, user.data.id, c.var.clock));
  return c.json(toDto(kelompok)({ ...target.data, ...changes }));
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
