import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app.js";
import { loadSession, requireAuth } from "../auth/session.js";
import { todayWib } from "../common/clock.js";
import { AppError, validationError } from "../common/errors.js";
import { formatRupiah } from "../common/format.js";
import { jsonBody } from "../common/validation.js";
import { findOwned, newId, newRow, rowsOf, type ParsedRow } from "../repositories/rows.js";
import { pesanBelumDipilih, pilihanAkun } from "../services/akun-pengguna.js";
import { addDays } from "../services/periode.js";
import { periodeAktif } from "../services/saldo.js";
import { transaksiMapper } from "../services/transaksi.js";

const tanggalSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Format tanggal harus yyyy-MM-dd." });

type Tabungan = ParsedRow<"Tabungan">["data"];

export interface TabunganDto {
  id: string;
  tanggal: string;
  jenis: string;
  periodeId: string;
  periodeNama: string;
  akunId: string;
  akunNama: string;
  nominal: number;
  keterangan: string;
  transaksiId: string | null;
  /** Hanya tarik di periode aktif yang boleh dihapus. */
  bisaHapus: boolean;
}

/** Saldo tabungan per akun: Σ setor − Σ tarik (spec §7.6). */
function perAkun(rows: Tabungan[]) {
  const map = new Map<string, { setor: number; tarik: number }>();
  for (const t of rows) {
    const a = map.get(t.akun_id) ?? { setor: 0, tarik: 0 };
    if (t.jenis === "setor") a.setor += t.nominal ?? 0;
    else if (t.jenis === "tarik") a.tarik += t.nominal ?? 0;
    map.set(t.akun_id, a);
  }
  return map;
}

export const tabungan = new Hono<AppEnv>();

tabungan.use(requireAuth);

tabungan.get("/", async (c) => {
  const { user, data } = await loadSession(c, ["Akun", "Periode", "Tabungan"]);
  const uid = user.data.id;
  const akun = rowsOf(data, "Akun");
  const periode = rowsOf(data, "Periode");
  const aktifId = periodeAktif(periode, uid)?.data.id;
  const milik = rowsOf(data, "Tabungan")
    .map((r) => r.data)
    .filter((t) => t.user_id === uid);
  const namaAkun = new Map(akun.map((a) => [a.data.id, a.data.nama]));
  const namaPeriode = new Map(periode.map((p) => [p.data.id, p.data.nama]));
  const urutan = new Map(akun.map((a) => [a.data.id, a.data.urutan ?? 0]));

  const per = [...perAkun(milik)]
    .map(([akunId, s]) => ({ akunId, nama: namaAkun.get(akunId) ?? "(akun dihapus)", setor: s.setor, tarik: s.tarik, saldo: s.setor - s.tarik }))
    .sort((a, b) => (urutan.get(a.akunId) ?? 0) - (urutan.get(b.akunId) ?? 0));

  const riwayat: TabunganDto[] = milik
    .sort((a, b) => (b.tanggal ?? "").localeCompare(a.tanggal ?? "") || (b.created_at ?? "").localeCompare(a.created_at ?? ""))
    .map((t) => ({
      id: t.id,
      tanggal: t.tanggal ?? "",
      jenis: t.jenis,
      periodeId: t.periode_id,
      periodeNama: namaPeriode.get(t.periode_id) ?? "",
      akunId: t.akun_id,
      akunNama: namaAkun.get(t.akun_id) ?? "(akun dihapus)",
      nominal: t.nominal ?? 0,
      keterangan: t.keterangan,
      transaksiId: t.transaksi_id || null,
      bisaHapus: t.jenis === "tarik" && t.periode_id === aktifId,
    }));

  return c.json({ total: per.reduce((n, a) => n + a.saldo, 0), perAkun: per, riwayat });
});

/**
 * Tarik tabungan (spec §7.6): baris Tabungan `tarik` + Transaksi `masuk` kategori TARIK_TABUNGAN di periode aktif,
 * supaya uangnya menambah modal periode berjalan. Tabungan ditulis dulu: kalau transaksi gagal dibuat,
 * baris tarik masih bisa dihapus lewat `DELETE /tabungan/{id}`.
 */
tabungan.post(
  "/tarik",
  jsonBody(
    z.object({
      tanggal: tanggalSchema.optional(),
      akunId: z.string({ error: "Akun wajib dipilih." }).trim().min(1, { error: "Akun wajib dipilih." }),
      nominal: z
        .number({ error: "Nominal harus berupa angka." })
        .int({ error: "Nominal harus bilangan bulat." })
        .gt(0, { error: "Nominal harus lebih dari 0." })
        .max(1_000_000_000_000, { error: "Nominal terlalu besar." }),
      keterangan: z.string().trim().max(200, { error: "Keterangan maksimal 200 karakter." }).optional(),
    }),
  ),
  async (c) => {
    const body = c.req.valid("json");
    const { user, data } = await loadSession(c, ["Akun", "AkunPengguna", "Kategori", "Periode", "Transaksi", "Tabungan"]);
    const uid = user.data.id;
    const clock = c.var.clock;
    const today = todayWib(clock);
    const tanggal = body.tanggal ?? today;

    const aktif = periodeAktif(rowsOf(data, "Periode"), uid);
    if (!aktif) throw new AppError(422, "Belum ada periode aktif. Mulai periode baru dulu.");
    if (tanggal < (aktif.data.tanggal_mulai ?? "")) {
      throw validationError({ tanggal: [`Tanggal harus di periode aktif (mulai ${aktif.data.tanggal_mulai}).`] });
    }
    if (tanggal > addDays(today, 31)) throw validationError({ tanggal: ["Tanggal paling lambat 31 hari dari hari ini."] });

    const akun = rowsOf(data, "Akun");
    const a = akun.find((r) => r.data.id === body.akunId)?.data;
    if (!a) throw validationError({ akunId: ["Akun tidak ditemukan."] });
    if (!a.aktif) throw validationError({ akunId: [`Akun ${a.nama} nonaktif dan tidak bisa dipakai.`] });
    // Hasil tarik masuk ke saldo akun, jadi akunnya harus dipakai pengguna
    if (!pilihanAkun(rowsOf(data, "AkunPengguna"), uid).dipilih(a.id)) throw validationError({ akunId: [pesanBelumDipilih(a.nama)] });

    const kategori = rowsOf(data, "Kategori");
    const kat = kategori.find((k) => k.data.kode_sistem === "TARIK_TABUNGAN")?.data;
    if (!kat) throw new AppError(422, "Kategori sistem Tarik Tabungan belum ada. Hubungi admin.");

    const tabunganRows = rowsOf(data, "Tabungan");
    const s = perAkun(tabunganRows.map((r) => r.data).filter((t) => t.user_id === uid)).get(a.id);
    const saldo = s ? s.setor - s.tarik : 0;
    if (body.nominal > saldo) throw new AppError(422, `Tabungan di ${a.nama} hanya ${formatRupiah(saldo)}.`);

    const keterangan = body.keterangan || "Tarik tabungan";
    const transaksiId = newId("Transaksi", rowsOf(data, "Transaksi"));
    const tarik = {
      id: newId("Tabungan", tabunganRows),
      user_id: uid,
      tanggal,
      jenis: "tarik",
      periode_id: aktif.data.id,
      akun_id: a.id,
      nominal: body.nominal,
      keterangan,
      transaksi_id: transaksiId,
    };
    const transaksi = {
      id: transaksiId,
      user_id: uid,
      periode_id: aktif.data.id,
      tanggal,
      tipe: "masuk",
      akun_id: a.id,
      akun_tujuan_id: "",
      kategori_id: kat.id,
      nominal: body.nominal,
      biaya_admin: 0,
      deskripsi: keterangan,
      berulang_id: "",
    };
    const store = c.var.store();
    await store.append("Tabungan", [newRow("Tabungan", tarik, uid, clock)]);
    await store.append("Transaksi", [newRow("Transaksi", transaksi, uid, clock)]);

    const dto = transaksiMapper(akun, kategori)({ ...transaksi, created_by: uid, created_at: null, updated_by: "", updated_at: null });
    return c.json({ id: tarik.id, saldoTabunganAkun: saldo - body.nominal, transaksi: dto }, 201);
  },
);

/** Hapus tarik tabungan di periode aktif beserta transaksinya. Transaksi dihapus dulu supaya aman diulang. */
tabungan.delete("/:id", async (c) => {
  const { user, data } = await loadSession(c, ["Periode", "Transaksi", "Tabungan"]);
  const uid = user.data.id;
  const target = findOwned(rowsOf(data, "Tabungan"), c.req.param("id"), uid);
  const aktifId = periodeAktif(rowsOf(data, "Periode"), uid)?.data.id;
  if (target.data.jenis !== "tarik" || target.data.periode_id !== aktifId) {
    throw new AppError(409, "Hanya tarik tabungan di periode aktif yang bisa dihapus.");
  }

  const store = c.var.store();
  const trx = rowsOf(data, "Transaksi").find((r) => r.data.id === target.data.transaksi_id && r.data.user_id === uid);
  if (trx) await store.deleteRow("Transaksi", trx.row);
  await store.deleteRow("Tabungan", target.row);
  return c.body(null, 204);
});
