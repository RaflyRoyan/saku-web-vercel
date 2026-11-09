import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app.js";
import { loadSession, requireAuth } from "../auth/session.js";
import { nowWibIso } from "../common/clock.js";
import { validationError } from "../common/errors.js";
import { jsonBody } from "../common/validation.js";
import { findOwned, newId, newRow, rowsOf, updatedRow } from "../repositories/rows.js";
import { peringatanAnggaran } from "../services/anggaran.js";
import { kelompokIdDari } from "../services/kelompok.js";
import { daftarLabel, labelFinal, labelSchema, MAKS_LABEL, ringkasanLabel, samaLabel } from "../services/label.js";
import { assertBukanSplit } from "../services/split.js";
import { assertBukanTagihanQris } from "../services/tagihan-qris.js";
import { periodeAktif } from "../services/saldo.js";
import { rencanaSetorTerdampak, simpanSetor } from "../services/tabungan.js";
import {
  assertBukanTabungan,
  peringatanSaldo,
  resolveTransaksi,
  transaksiBody,
  transaksiMapper,
  urutTransaksi,
} from "../services/transaksi.js";
import type { RowUpdate, SheetData } from "../sheets/store.js";

const SHEETS = ["Akun", "AkunPengguna", "Kategori", "KelompokKategori", "Periode", "SaldoAwal", "Transaksi", "Tabungan"] as const;
/** POST/PUT juga butuh Anggaran untuk peringatan anggaran terlewati. */
const SHEETS_TULIS = [...SHEETS, "Anggaran"] as const;
/** PUT/DELETE: transaksi milik split bill & tagihan QRIS dikunci. */
const SHEETS_SPLIT = ["SplitBill", "SplitPeserta", "TagihanQris"] as const;

function parseAll(data: Record<(typeof SHEETS)[number], SheetData>) {
  return {
    akun: rowsOf(data, "Akun"),
    akunPengguna: rowsOf(data, "AkunPengguna"),
    kategori: rowsOf(data, "Kategori"),
    kelompok: rowsOf(data, "KelompokKategori"),
    periode: rowsOf(data, "Periode"),
    saldoAwal: rowsOf(data, "SaldoAwal"),
    transaksi: rowsOf(data, "Transaksi"),
    tabungan: rowsOf(data, "Tabungan"),
  };
}

export const transaksi = new Hono<AppEnv>();

transaksi.use(requireAuth);

transaksi.get("/", async (c) => {
  const q = c.req.query();
  const { user, data } = await loadSession(c, SHEETS);
  const uid = user.data.id;
  const s = parseAll(data);
  const toDto = transaksiMapper(s.akun, s.kategori);

  const halaman = Math.max(1, Math.floor(Number(q.halaman) || 1));
  const ukuran = Math.min(200, Math.max(1, Math.floor(Number(q.ukuran) || 50)));
  // periodeId=semua → tanpa filter periode (biasanya dipadukan dengan dari/sampai)
  const semua = q.periodeId === "semua";
  const periodeId = semua ? null : q.periodeId ? findOwned(s.periode, q.periodeId, uid).data.id : periodeAktif(s.periode, uid)?.data.id;
  if (!semua && !periodeId) return c.json({ data: [], total: 0, halaman, ukuran });

  const biayaAdminId = s.kategori.find((k) => k.data.kode_sistem === "BIAYA_ADMIN")?.data.id;
  const cari = q.q?.trim().toLowerCase();
  // Filter kategori induk = semua sub kategorinya; biaya admin transfer ikut kelompok kategori BIAYA_ADMIN
  const subKelompok = q.kelompokId
    ? new Set(s.kategori.filter((k) => kelompokIdDari(k.data, s.kelompok) === q.kelompokId).map((k) => k.data.id))
    : null;
  const list = s.transaksi
    .map((r) => r.data)
    .filter(
      (t) =>
        t.user_id === uid &&
        (semua || t.periode_id === periodeId) &&
        // Filter akun juga mencakup transfer dengan akun ini sebagai tujuan
        (!q.akunId || t.akun_id === q.akunId || t.akun_tujuan_id === q.akunId) &&
        (!q.tipe || t.tipe === q.tipe) &&
        // Biaya admin transfer ikut kategori BIAYA_ADMIN (spec §7.3)
        (!q.kategoriId ||
          t.kategori_id === q.kategoriId ||
          (q.kategoriId === biayaAdminId && t.tipe === "transfer" && (t.biaya_admin ?? 0) > 0)) &&
        (!subKelompok ||
          subKelompok.has(t.kategori_id) ||
          (biayaAdminId !== undefined && subKelompok.has(biayaAdminId) && t.tipe === "transfer" && (t.biaya_admin ?? 0) > 0)) &&
        (!cari || t.deskripsi.toLowerCase().includes(cari)) &&
        (!q.label || samaLabel(t.label, q.label)) &&
        (!q.dari || (t.tanggal ?? "") >= q.dari) &&
        (!q.sampai || (t.tanggal ?? "") <= q.sampai),
    )
    .sort(urutTransaksi);

  return c.json({
    data: list.slice((halaman - 1) * ukuran, halaman * ukuran).map(toDto),
    total: list.length,
    halaman,
    ukuran,
  });
});

/** Label yang pernah dipakai + jumlah transaksinya (saran & filter). */
transaksi.get("/label", async (c) => {
  const { user, data } = await loadSession(c, ["Transaksi"]);
  return c.json(daftarLabel(rowsOf(data, "Transaksi"), user.data.id));
});

/** Ringkasan satu label lintas periode. */
transaksi.get("/label/ringkasan", async (c) => {
  const label = c.req.query("label")?.trim() ?? "";
  if (!label) throw validationError({ label: ["Label wajib diisi."] });
  const { user, data } = await loadSession(c, ["Kategori", "Transaksi"]);
  return c.json(ringkasanLabel(rowsOf(data, "Transaksi"), rowsOf(data, "Kategori"), user.data.id, label));
});

/** Beri/hapus label banyak transaksi sekaligus (satu batchUpdate). Transaksi split/tagihan/tarik tetap boleh: label tidak mengubah uang. */
transaksi.put(
  "/label",
  jsonBody(
    z.object({
      ids: z.array(z.string(), { error: "Pilih minimal 1 transaksi." }).min(1, { error: "Pilih minimal 1 transaksi." }).max(500, { error: "Maksimal 500 transaksi sekaligus." }),
      label: labelSchema.nullable(),
    }),
  ),
  async (c) => {
    const body = c.req.valid("json");
    const { user, data } = await loadSession(c, ["Transaksi"]);
    const uid = user.data.id;
    const rows = rowsOf(data, "Transaksi");
    const label = labelFinal(body.label ?? "", rows, uid);
    if (label === null) throw validationError({ label: [`Label maksimal ${MAKS_LABEL} karakter.`] });
    const target = [...new Set(body.ids)].map((id) => findOwned(rows, id, uid));
    const updates: RowUpdate[] = target
      .filter((r) => r.data.label !== label)
      .map((r) => ({ sheet: "Transaksi", row: r.row, values: updatedRow("Transaksi", r.data, { label }, uid, c.var.clock) }));
    if (updates.length) await c.var.store().updateRows(updates);
    return c.json({ label: label || null, jumlah: target.length });
  },
);

transaksi.get("/:id", async (c) => {
  const { user, data } = await loadSession(c, ["Akun", "Kategori", "Transaksi"]);
  const t = findOwned(rowsOf(data, "Transaksi"), c.req.param("id"), user.data.id);
  return c.json(transaksiMapper(rowsOf(data, "Akun"), rowsOf(data, "Kategori"))(t.data));
});

transaksi.post("/", jsonBody(transaksiBody), async (c) => {
  const body = c.req.valid("json");
  const { user, data } = await loadSession(c, SHEETS_TULIS);
  const uid = user.data.id;
  const s = parseAll(data);
  const kolom = resolveTransaksi(body, s, uid, c.var.clock);
  const label = labelFinal(body.label ?? "", s.transaksi, uid);
  if (label === null) throw validationError({ label: [`Label maksimal ${MAKS_LABEL} karakter.`] });

  const baru = { id: newId("Transaksi", s.transaksi), user_id: uid, ...kolom, berulang_id: "", label };
  const full = { ...baru, created_by: uid, created_at: nowWibIso(c.var.clock), updated_by: "", updated_at: null };
  const after = [...s.transaksi, { row: 0, data: full }];
  const setor = rencanaSetorTerdampak([kolom.periode_id], s.periode, s.saldoAwal, after, s.tabungan, uid, c.var.clock);

  const store = c.var.store();
  await store.append("Transaksi", [newRow("Transaksi", baru, uid, c.var.clock)]);
  await simpanSetor(store, setor);

  const dto = transaksiMapper(s.akun, s.kategori)(full);
  const peringatan = [...peringatanSaldo(full, s.saldoAwal, after, s.akun), ...peringatanAnggaran(full, rowsOf(data, "Anggaran"), s.kategori, s.kelompok, after)];
  return c.json({ ...dto, peringatan }, 201);
});

transaksi.put("/:id", jsonBody(transaksiBody), async (c) => {
  const body = c.req.valid("json");
  const { user, data } = await loadSession(c, [...SHEETS_TULIS, ...SHEETS_SPLIT]);
  const uid = user.data.id;
  const s = parseAll(data);
  const target = findOwned(s.transaksi, c.req.param("id"), uid);
  assertBukanTabungan(target.data, s.kategori);
  assertBukanSplit(target.data, rowsOf(data, "SplitBill"), rowsOf(data, "SplitPeserta"));
  assertBukanTagihanQris(target.data, rowsOf(data, "TagihanQris"));
  const kolom = resolveTransaksi(body, s, uid, c.var.clock, target.data);
  // Label tidak dikirim → label lama tetap
  const label = body.label === undefined ? target.data.label : labelFinal(body.label ?? "", s.transaksi, uid);
  if (label === null) throw validationError({ label: [`Label maksimal ${MAKS_LABEL} karakter.`] });

  const values = updatedRow("Transaksi", target.data, { ...kolom, label }, uid, c.var.clock);
  const full = { ...target.data, ...kolom, label, updated_by: uid, updated_at: nowWibIso(c.var.clock) };
  const after = s.transaksi.map((r) => (r.row === target.row ? { row: r.row, data: full } : r));
  // Tanggal berubah bisa memindahkan transaksi ke periode lain: hitung ulang keduanya
  const setor = rencanaSetorTerdampak([target.data.periode_id, kolom.periode_id], s.periode, s.saldoAwal, after, s.tabungan, uid, c.var.clock);

  await simpanSetor(c.var.store(), setor, [{ sheet: "Transaksi", row: target.row, values }]);

  const dto = transaksiMapper(s.akun, s.kategori)(full);
  const peringatan = [...peringatanSaldo(full, s.saldoAwal, after, s.akun), ...peringatanAnggaran(full, rowsOf(data, "Anggaran"), s.kategori, s.kelompok, after)];
  return c.json({ ...dto, peringatan });
});

transaksi.delete("/:id", async (c) => {
  const { user, data } = await loadSession(c, [...SHEETS, ...SHEETS_SPLIT]);
  const uid = user.data.id;
  const s = parseAll(data);
  const target = findOwned(s.transaksi, c.req.param("id"), uid);
  assertBukanTabungan(target.data, s.kategori);
  assertBukanSplit(target.data, rowsOf(data, "SplitBill"), rowsOf(data, "SplitPeserta"));
  assertBukanTagihanQris(target.data, rowsOf(data, "TagihanQris"));

  const after = s.transaksi.filter((r) => r.row !== target.row);
  const setor = rencanaSetorTerdampak([target.data.periode_id], s.periode, s.saldoAwal, after, s.tabungan, uid, c.var.clock);

  const store = c.var.store();
  await store.deleteRow("Transaksi", target.row);
  await simpanSetor(store, setor);
  return c.body(null, 204);
});
