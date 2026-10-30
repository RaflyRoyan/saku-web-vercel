import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app.js";
import { loadSession, requireAuth } from "../auth/session.js";
import { nowWibIso, todayWib } from "../common/clock.js";
import { AppError, validationError, type FieldErrors } from "../common/errors.js";
import { jsonBody } from "../common/validation.js";
import { findOwned, newId, newRow, rowsOf, updatedRow, type ParsedRow } from "../repositories/rows.js";
import {
  addMonths,
  berlaku,
  dilewati,
  hitungPengingat,
  jatuhTempo,
  pembayaran,
  statusBulan,
  type Pengingat,
} from "../services/berulang.js";
import { rencanaSetorTerdampak, simpanSetor } from "../services/tabungan.js";
import { peringatanSaldo, resolveTransaksi, transaksiMapper } from "../services/transaksi.js";
import type { SheetData } from "../sheets/store.js";

const bulanSchema = z.string({ error: "Bulan wajib diisi." }).regex(/^\d{4}-(0[1-9]|1[0-2])$/, { error: "Format bulan harus yyyy-MM." });
const tanggalSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Format tanggal harus yyyy-MM-dd." });
const nominalSchema = z
  .number({ error: "Nominal harus berupa angka." })
  .int({ error: "Nominal harus bilangan bulat." })
  .gt(0, { error: "Nominal harus lebih dari 0." })
  .max(1_000_000_000_000, { error: "Nominal terlalu besar." });

const berulangBody = z.object({
  nama: z.string({ error: "Nama wajib diisi." }).trim().min(1, { error: "Nama wajib diisi." }).max(50, { error: "Nama maksimal 50 karakter." }),
  akunId: z.string({ error: "Akun wajib dipilih." }).trim().min(1, { error: "Akun wajib dipilih." }),
  kategoriId: z.string({ error: "Kategori wajib dipilih." }).trim().min(1, { error: "Kategori wajib dipilih." }),
  nominal: nominalSchema,
  tglJatuhTempo: z
    .number({ error: "Tanggal jatuh tempo harus berupa angka." })
    .int({ error: "Tanggal jatuh tempo harus bilangan bulat." })
    .min(1, { error: "Tanggal jatuh tempo 1–31." })
    .max(31, { error: "Tanggal jatuh tempo 1–31." }),
  ingatkanHMin: z
    .number({ error: "Pengingat harus berupa angka." })
    .int({ error: "Pengingat harus bilangan bulat." })
    .min(0, { error: "Pengingat 0–15 hari." })
    .max(15, { error: "Pengingat 0–15 hari." })
    .default(3),
  mulai: bulanSchema,
  selesai: bulanSchema.nullish(),
});

const SHEETS = ["Akun", "Kategori", "Periode", "SaldoAwal", "Transaksi", "Tabungan", "Berulang", "BerulangLewati"] as const;

function parseAll(data: Record<(typeof SHEETS)[number], SheetData>) {
  return {
    akun: rowsOf(data, "Akun"),
    kategori: rowsOf(data, "Kategori"),
    periode: rowsOf(data, "Periode"),
    saldoAwal: rowsOf(data, "SaldoAwal"),
    transaksi: rowsOf(data, "Transaksi"),
    tabungan: rowsOf(data, "Tabungan"),
    berulang: rowsOf(data, "Berulang"),
    lewati: rowsOf(data, "BerulangLewati"),
  };
}

type Sheets = ReturnType<typeof parseAll>;
type B = ParsedRow<"Berulang">["data"];

export interface BerulangDto {
  id: string;
  nama: string;
  akunId: string;
  akunNama: string;
  kategoriId: string;
  kategoriNama: string;
  nominal: number;
  tglJatuhTempo: number;
  ingatkanHMin: number;
  mulai: string;
  selesai: string | null;
  aktif: boolean;
  /** Bulan acuan status: bulan pengingat yang sedang tampil, atau bulan ini. */
  bulan: string;
  jatuhTempo: string;
  status: "belum" | "dibayar" | "dilewati";
  transaksiId: string | null;
  /** Langganan tidak berlaku di bulan acuan (belum mulai / sudah selesai / nonaktif). */
  berlaku: boolean;
}

function mapper(s: Sheets, pengingat: Pengingat[], hari: string) {
  const namaAkun = new Map(s.akun.map((a) => [a.data.id, a.data.nama]));
  const namaKat = new Map(s.kategori.map((k) => [k.data.id, k.data.nama]));
  return (b: B): BerulangDto => {
    // Bulan pengingat yang tampil; kalau bulan depan sudah dibayar/dilewati lebih awal, tampilkan bulan depan
    const ini = hari.slice(0, 7);
    const depan = addMonths(ini, 1);
    const bulan =
      pengingat.find((p) => p.berulangId === b.id)?.bulan ??
      (statusBulan(b, depan, s.transaksi, s.lewati).status !== "belum" ? depan : ini);
    const st = statusBulan(b, bulan, s.transaksi, s.lewati);
    return {
      id: b.id,
      nama: b.nama,
      akunId: b.akun_id,
      akunNama: namaAkun.get(b.akun_id) ?? "(akun dihapus)",
      kategoriId: b.kategori_id,
      kategoriNama: namaKat.get(b.kategori_id) ?? "(kategori dihapus)",
      nominal: b.nominal ?? 0,
      tglJatuhTempo: b.tgl_jatuh_tempo ?? 1,
      ingatkanHMin: b.ingatkan_h_min ?? 3,
      mulai: b.mulai ?? "",
      selesai: b.selesai,
      aktif: b.aktif,
      bulan,
      jatuhTempo: jatuhTempo(b.tgl_jatuh_tempo ?? 1, bulan),
      ...st,
      berlaku: berlaku(b, bulan),
    };
  };
}

/** Pengingat lengkap dengan data langganannya (spec §10.7 `[{ berulang, bulan, jatuhTempo, status, sisaHari }]`). */
export function pengingatDto(s: Sheets, userId: string, hari: string) {
  const list = hitungPengingat(s.berulang, s.transaksi, s.lewati, userId, hari);
  const toDto = mapper(s, list, hari);
  const byId = new Map(s.berulang.map((b) => [b.data.id, b.data]));
  return list.map((p) => ({ ...p, berulang: toDto(byId.get(p.berulangId)!) }));
}

/** Akun aktif & kategori `keluar` aktif bukan kategori sistem (spec §5.2 Berulang, §7.1). */
function cekMaster(s: Sheets, body: z.infer<typeof berulangBody>, current?: B) {
  const errors: FieldErrors = {};
  const a = s.akun.find((r) => r.data.id === body.akunId)?.data;
  if (!a) errors.akunId = ["Akun tidak ditemukan."];
  else if (!a.aktif && a.id !== current?.akun_id) errors.akunId = [`Akun ${a.nama} nonaktif dan tidak bisa dipakai.`];
  const k = s.kategori.find((r) => r.data.id === body.kategoriId)?.data;
  if (!k) errors.kategoriId = ["Kategori tidak ditemukan."];
  else if (k.tipe !== "keluar" || k.kode_sistem) errors.kategoriId = [`Kategori ${k.nama} bukan kategori pengeluaran biasa.`];
  else if (!k.aktif && k.id !== current?.kategori_id) errors.kategoriId = [`Kategori ${k.nama} nonaktif dan tidak bisa dipakai.`];
  if (body.selesai && body.selesai < body.mulai) errors.selesai = ["Bulan selesai tidak boleh sebelum bulan mulai."];
  if (Object.keys(errors).length) throw validationError(errors);
}

const kolom = (body: z.infer<typeof berulangBody>) => ({
  nama: body.nama,
  akun_id: body.akunId,
  kategori_id: body.kategoriId,
  nominal: body.nominal,
  tgl_jatuh_tempo: body.tglJatuhTempo,
  ingatkan_h_min: body.ingatkanHMin,
  mulai: body.mulai,
  selesai: body.selesai || null,
});

export const berulang = new Hono<AppEnv>();

berulang.use(requireAuth);

berulang.get("/", async (c) => {
  const termasukNonaktif = c.req.query("termasukNonaktif") === "true";
  const { user, data } = await loadSession(c, SHEETS);
  const uid = user.data.id;
  const s = parseAll(data);
  const hari = todayWib(c.var.clock);
  const toDto = mapper(s, hitungPengingat(s.berulang, s.transaksi, s.lewati, uid, hari), hari);
  const list = s.berulang
    .map((r) => r.data)
    .filter((b) => b.user_id === uid && (termasukNonaktif || b.aktif))
    .sort((a, b) => (a.tgl_jatuh_tempo ?? 0) - (b.tgl_jatuh_tempo ?? 0) || a.nama.localeCompare(b.nama, "id"))
    .map(toDto);
  return c.json(list);
});

berulang.get("/pengingat", async (c) => {
  const tanggal = c.req.query("tanggal");
  if (tanggal && !tanggalSchema.safeParse(tanggal).success) throw validationError({ tanggal: ["Format tanggal harus yyyy-MM-dd."] });
  const { user, data } = await loadSession(c, SHEETS);
  return c.json(pengingatDto(parseAll(data), user.data.id, tanggal ?? todayWib(c.var.clock)));
});

berulang.post("/", jsonBody(berulangBody), async (c) => {
  const body = c.req.valid("json");
  const { user, data } = await loadSession(c, SHEETS);
  const uid = user.data.id;
  const s = parseAll(data);
  cekMaster(s, body);
  const baru = { id: newId("Berulang", s.berulang), user_id: uid, ...kolom(body), aktif: true };
  await c.var.store().append("Berulang", [newRow("Berulang", baru, uid, c.var.clock)]);
  const hari = todayWib(c.var.clock);
  const full = { ...baru, created_by: uid, created_at: null, updated_by: "", updated_at: null };
  return c.json(mapper(s, [], hari)(full), 201);
});

berulang.put("/:id", jsonBody(berulangBody.extend({ aktif: z.boolean({ error: "Aktif harus true/false." }) })), async (c) => {
  const body = c.req.valid("json");
  const { user, data } = await loadSession(c, SHEETS);
  const uid = user.data.id;
  const s = parseAll(data);
  const target = findOwned(s.berulang, c.req.param("id"), uid);
  cekMaster(s, body, target.data);
  const changes = { ...kolom(body), aktif: body.aktif };
  await c.var.store().updateRow("Berulang", target.row, updatedRow("Berulang", target.data, changes, uid, c.var.clock));
  const hari = todayWib(c.var.clock);
  return c.json(mapper(s, [], hari)({ ...target.data, ...changes }));
});

/**
 * Bayar langganan bulan B: transaksi `keluar` dengan default dari data langganan, tanggal default hari ini (spec §7.7).
 */
berulang.post(
  "/:id/konfirmasi",
  jsonBody(
    z.object({
      bulan: bulanSchema,
      tanggal: tanggalSchema.optional(),
      nominal: nominalSchema.optional(),
      akunId: z.string().trim().min(1, { error: "Akun wajib dipilih." }).optional(),
      deskripsi: z.string().trim().max(200, { error: "Deskripsi maksimal 200 karakter." }).optional(),
    }),
  ),
  async (c) => {
    const body = c.req.valid("json");
    const { user, data } = await loadSession(c, SHEETS);
    const uid = user.data.id;
    const clock = c.var.clock;
    const s = parseAll(data);
    const b = findOwned(s.berulang, c.req.param("id"), uid).data;
    if (!berlaku(b, body.bulan)) throw new AppError(422, `Langganan ${b.nama} tidak berlaku di bulan ${body.bulan}.`);
    if (pembayaran(b, body.bulan, s.transaksi)) throw new AppError(409, `Langganan ${b.nama} bulan ${body.bulan} sudah dibayar.`);

    const tanggal = body.tanggal ?? todayWib(clock);

    const kolomTr = resolveTransaksi(
      { tipe: "keluar", akunId: body.akunId ?? b.akun_id, kategoriId: b.kategori_id, nominal: body.nominal ?? b.nominal ?? 0, deskripsi: body.deskripsi || b.nama, tanggal },
      s,
      uid,
      clock,
    );
    const baru = { id: newId("Transaksi", s.transaksi), user_id: uid, ...kolomTr, berulang_id: b.id };
    const full = { ...baru, created_by: uid, created_at: nowWibIso(clock), updated_by: "", updated_at: null };
    const after = [...s.transaksi, { row: 0, data: full }];
    const setor = rencanaSetorTerdampak([kolomTr.periode_id], s.periode, s.saldoAwal, after, s.tabungan, uid, clock);

    const store = c.var.store();
    await store.append("Transaksi", [newRow("Transaksi", baru, uid, clock)]);
    await simpanSetor(store, setor);
    const dto = transaksiMapper(s.akun, s.kategori)(full);
    return c.json({ ...dto, peringatan: peringatanSaldo(full, s.saldoAwal, after, s.akun) }, 201);
  },
);

berulang.post("/:id/lewati", jsonBody(z.object({ bulan: bulanSchema })), async (c) => {
  const { bulan } = c.req.valid("json");
  const { user, data } = await loadSession(c, SHEETS);
  const uid = user.data.id;
  const s = parseAll(data);
  const b = findOwned(s.berulang, c.req.param("id"), uid).data;
  if (pembayaran(b, bulan, s.transaksi)) throw new AppError(409, `Langganan ${b.nama} bulan ${bulan} sudah dibayar.`);
  if (dilewati(b, bulan, s.lewati)) throw new AppError(409, `Langganan ${b.nama} bulan ${bulan} sudah dilewati.`);
  const baru = { id: newId("BerulangLewati", s.lewati), user_id: uid, berulang_id: b.id, bulan };
  await c.var.store().append("BerulangLewati", [newRow("BerulangLewati", baru, uid, c.var.clock)]);
  return c.json({ id: baru.id, berulangId: b.id, bulan }, 201);
});

berulang.delete("/:id/lewati/:bulan", async (c) => {
  const { user, data } = await loadSession(c, ["Berulang", "BerulangLewati"]);
  const uid = user.data.id;
  const b = findOwned(rowsOf(data, "Berulang"), c.req.param("id"), uid).data;
  const row = dilewati(b, c.req.param("bulan"), rowsOf(data, "BerulangLewati"));
  if (!row) throw new AppError(404, "Data tidak ditemukan.");
  await c.var.store().deleteRow("BerulangLewati", row.row);
  return c.body(null, 204);
});
