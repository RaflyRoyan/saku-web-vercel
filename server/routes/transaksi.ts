import { Hono } from "hono";
import type { AppEnv } from "../app.js";
import { loadSession, requireAuth } from "../auth/session.js";
import { nowWibIso } from "../common/clock.js";
import { jsonBody } from "../common/validation.js";
import { findOwned, newId, newRow, rowsOf, updatedRow } from "../repositories/rows.js";
import { periodeAktif } from "../services/saldo.js";
import { rencanaSetorTerdampak, simpanSetor } from "../services/tabungan.js";
import {
  assertBukanTarik,
  peringatanSaldo,
  resolveTransaksi,
  transaksiBody,
  transaksiMapper,
  urutTransaksi,
} from "../services/transaksi.js";
import type { SheetData } from "../sheets/store.js";

const SHEETS = ["Akun", "AkunPengguna", "Kategori", "Periode", "SaldoAwal", "Transaksi", "Tabungan"] as const;

function parseAll(data: Record<(typeof SHEETS)[number], SheetData>) {
  return {
    akun: rowsOf(data, "Akun"),
    akunPengguna: rowsOf(data, "AkunPengguna"),
    kategori: rowsOf(data, "Kategori"),
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
        (!cari || t.deskripsi.toLowerCase().includes(cari)) &&
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

transaksi.get("/:id", async (c) => {
  const { user, data } = await loadSession(c, ["Akun", "Kategori", "Transaksi"]);
  const t = findOwned(rowsOf(data, "Transaksi"), c.req.param("id"), user.data.id);
  return c.json(transaksiMapper(rowsOf(data, "Akun"), rowsOf(data, "Kategori"))(t.data));
});

transaksi.post("/", jsonBody(transaksiBody), async (c) => {
  const body = c.req.valid("json");
  const { user, data } = await loadSession(c, SHEETS);
  const uid = user.data.id;
  const s = parseAll(data);
  const kolom = resolveTransaksi(body, s, uid, c.var.clock);

  const baru = { id: newId("Transaksi", s.transaksi), user_id: uid, ...kolom, berulang_id: "" };
  const full = { ...baru, created_by: uid, created_at: nowWibIso(c.var.clock), updated_by: "", updated_at: null };
  const after = [...s.transaksi, { row: 0, data: full }];
  const setor = rencanaSetorTerdampak([kolom.periode_id], s.periode, s.saldoAwal, after, s.tabungan, uid, c.var.clock);

  const store = c.var.store();
  await store.append("Transaksi", [newRow("Transaksi", baru, uid, c.var.clock)]);
  await simpanSetor(store, setor);

  const dto = transaksiMapper(s.akun, s.kategori)(full);
  return c.json({ ...dto, peringatan: peringatanSaldo(full, s.saldoAwal, after, s.akun) }, 201);
});

transaksi.put("/:id", jsonBody(transaksiBody), async (c) => {
  const body = c.req.valid("json");
  const { user, data } = await loadSession(c, SHEETS);
  const uid = user.data.id;
  const s = parseAll(data);
  const target = findOwned(s.transaksi, c.req.param("id"), uid);
  assertBukanTarik(target.data, s.kategori);
  const kolom = resolveTransaksi(body, s, uid, c.var.clock, target.data);

  const values = updatedRow("Transaksi", target.data, kolom, uid, c.var.clock);
  const full = { ...target.data, ...kolom, updated_by: uid, updated_at: nowWibIso(c.var.clock) };
  const after = s.transaksi.map((r) => (r.row === target.row ? { row: r.row, data: full } : r));
  // Tanggal berubah bisa memindahkan transaksi ke periode lain: hitung ulang keduanya
  const setor = rencanaSetorTerdampak([target.data.periode_id, kolom.periode_id], s.periode, s.saldoAwal, after, s.tabungan, uid, c.var.clock);

  await simpanSetor(c.var.store(), setor, [{ sheet: "Transaksi", row: target.row, values }]);

  const dto = transaksiMapper(s.akun, s.kategori)(full);
  return c.json({ ...dto, peringatan: peringatanSaldo(full, s.saldoAwal, after, s.akun) });
});

transaksi.delete("/:id", async (c) => {
  const { user, data } = await loadSession(c, SHEETS);
  const uid = user.data.id;
  const s = parseAll(data);
  const target = findOwned(s.transaksi, c.req.param("id"), uid);
  assertBukanTarik(target.data, s.kategori);

  const after = s.transaksi.filter((r) => r.row !== target.row);
  const setor = rencanaSetorTerdampak([target.data.periode_id], s.periode, s.saldoAwal, after, s.tabungan, uid, c.var.clock);

  const store = c.var.store();
  await store.deleteRow("Transaksi", target.row);
  await simpanSetor(store, setor);
  return c.body(null, 204);
});
