import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app.js";
import { loadSession, requireAdmin, requireAuth } from "../auth/session.js";
import { AppError } from "../common/errors.js";
import { jsonBody } from "../common/validation.js";
import { newId, newRow, notFound, rowsOf, updatedRow, type Row } from "../repositories/rows.js";
import { ensureKelompokBawaan, kelompokIdDari, LAINNYA, urutKelompok } from "../services/kelompok.js";
import type { RowUpdate } from "../db/store.js";

// Kelompok kategori pengeluaran (UI: "Kategori"). Master bersama, hanya admin yang menulis.

const namaSchema = z
  .string({ error: "Nama kategori wajib diisi." })
  .trim()
  .min(1, { error: "Nama kategori wajib diisi." })
  .max(40, { error: "Nama kategori maksimal 40 karakter." });

export interface KelompokDto {
  id: string;
  nama: string;
  urutan: number;
  aktif: boolean;
  /** true untuk "Lainnya": tidak bisa diubah atau dinonaktifkan. */
  sistem: boolean;
}

/** Nama unik (case-insensitive) di antara kelompok aktif; "Lainnya" selalu terpakai. */
function assertNamaFree(rows: Row<"KelompokKategori">[], nama: string, exceptId?: string) {
  const n = nama.toLowerCase();
  if (n === LAINNYA.nama.toLowerCase() || rows.some((r) => r.data.aktif && r.data.id !== exceptId && r.data.nama.toLowerCase() === n)) {
    throw new AppError(409, "Nama kategori sudah dipakai.", { nama: ["Nama kategori sudah dipakai."] });
  }
}

function findKelompok(rows: Row<"KelompokKategori">[], id: string) {
  const found = rows.find((r) => r.data.id === id);
  if (!found) throw notFound();
  return found;
}

export const kelompokKategori = new Hono<AppEnv>();

kelompokKategori.use(requireAuth);

/** Urut `urutan`, "Lainnya" selalu terakhir. */
kelompokKategori.get("/", async (c) => {
  const termasukNonaktif = c.req.query("termasukNonaktif") === "true";
  const { data } = await loadSession(c, ["KelompokKategori"]);
  const list: KelompokDto[] = urutKelompok(rowsOf(data, "KelompokKategori"))
    .filter((g) => termasukNonaktif || g.aktif)
    .map((g) => ({ id: g.id, nama: g.nama, urutan: g.urutan ?? 0, aktif: g.aktif, sistem: false }));
  const terakhir = Math.max(0, ...list.map((g) => g.urutan));
  list.push({ ...LAINNYA, urutan: terakhir + 1, aktif: true, sistem: true });
  return c.json(list);
});

kelompokKategori.post("/", jsonBody(z.object({ nama: namaSchema })), async (c) => {
  const { nama } = c.req.valid("json");
  const { user, data } = await loadSession(c, ["KelompokKategori"]);
  requireAdmin(user);
  const rows = rowsOf(data, "KelompokKategori");
  assertNamaFree(rows, nama);

  const baru = { id: newId("KelompokKategori", rows), nama, urutan: Math.max(0, ...rows.map((r) => r.data.urutan ?? 0)) + 1, aktif: true };
  await c.var.store().append("KelompokKategori", [newRow("KelompokKategori", baru, user.data.id, c.var.clock)]);
  return c.json({ ...baru, sistem: false } satisfies KelompokDto, 201);
});

/** Tambah kelompok bawaan yang belum ada (untuk instalasi lama). Idempoten. */
kelompokKategori.post("/bawaan", async (c) => {
  const { user, data } = await loadSession(c, ["KelompokKategori"]);
  requireAdmin(user);
  const ditambah = await ensureKelompokBawaan(c.var.store(), rowsOf(data, "KelompokKategori"), user.data.id, c.var.clock);
  return c.json({ ditambah });
});

// Didaftarkan sebelum "/:id" supaya "urutan" tidak dianggap ID
kelompokKategori.put(
  "/urutan",
  jsonBody(z.object({ ids: z.array(z.string(), { error: "ids harus berupa daftar ID kategori." }).min(1, { error: "ids tidak boleh kosong." }) })),
  async (c) => {
    const { ids } = c.req.valid("json");
    const { user, data } = await loadSession(c, ["KelompokKategori"]);
    requireAdmin(user);
    const rows = rowsOf(data, "KelompokKategori");
    // "Lainnya" selalu terakhir, abaikan kalau ikut dikirim
    const urut = ids.filter((id) => id !== LAINNYA.id);
    if (new Set(urut).size !== urut.length) throw new AppError(400, "ID kategori tidak boleh dobel.", { ids: ["ID kategori tidak boleh dobel."] });

    const updates: RowUpdate[] = [];
    urut.forEach((id, i) => {
      const r = findKelompok(rows, id);
      if (r.data.urutan !== i + 1) {
        updates.push({ tabel: "KelompokKategori", baris: updatedRow("KelompokKategori", r.data, { urutan: i + 1 }, user.data.id, c.var.clock) });
      }
    });
    await c.var.store().updateRows(updates);
    return c.body(null, 204);
  },
);

kelompokKategori.put("/:id", jsonBody(z.object({ nama: namaSchema })), async (c) => {
  const { nama } = c.req.valid("json");
  const { user, data } = await loadSession(c, ["KelompokKategori"]);
  requireAdmin(user);
  const rows = rowsOf(data, "KelompokKategori");
  const target = findKelompok(rows, c.req.param("id"));
  if (target.data.aktif) assertNamaFree(rows, nama, target.data.id);

  await c.var.store().updateRow("KelompokKategori", updatedRow("KelompokKategori", target.data, { nama }, user.data.id, c.var.clock));
  return c.json({ id: target.data.id, nama, urutan: target.data.urutan ?? 0, aktif: target.data.aktif, sistem: false } satisfies KelompokDto);
});

kelompokKategori.put("/:id/aktif", jsonBody(z.object({ aktif: z.boolean({ error: "Aktif harus true/false." }) })), async (c) => {
  const { aktif } = c.req.valid("json");
  const { user, data } = await loadSession(c, ["KelompokKategori", "Kategori"]);
  requireAdmin(user);
  const rows = rowsOf(data, "KelompokKategori");
  const target = findKelompok(rows, c.req.param("id"));

  if (aktif) assertNamaFree(rows, target.data.nama, target.data.id);
  else {
    const isi = rowsOf(data, "Kategori").filter((k) => k.data.aktif && kelompokIdDari(k.data, rows) === target.data.id);
    if (isi.length) {
      throw new AppError(409, `Masih ada ${isi.length} sub kategori aktif di ${target.data.nama}. Pindahkan atau nonaktifkan dulu.`);
    }
  }

  if (target.data.aktif !== aktif) {
    await c.var.store().updateRow("KelompokKategori", updatedRow("KelompokKategori", target.data, { aktif }, user.data.id, c.var.clock));
  }
  return c.body(null, 204);
});
