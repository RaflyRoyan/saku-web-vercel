import { z } from "zod";
import { todayWib, type Clock } from "../common/clock.js";
import { AppError, validationError, type FieldErrors } from "../common/errors.js";
import { formatRupiah } from "../common/format.js";
import type { ParsedRow } from "../repositories/rows.js";
import { pesanBelumDipilih, pilihanAkun } from "./akun-pengguna.js";
import { addDays, periodeUntukTanggal } from "./periode.js";
import { saldoPerAkun } from "./saldo.js";

const tanggalSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Format tanggal harus yyyy-MM-dd." });
const MAKS_NOMINAL = 1_000_000_000_000;

export const transaksiBody = z.object({
  tanggal: tanggalSchema.optional(),
  tipe: z.enum(["keluar", "masuk", "transfer"], { error: "Tipe harus keluar, masuk, atau transfer." }),
  akunId: z.string({ error: "Akun wajib dipilih." }).trim().min(1, { error: "Akun wajib dipilih." }),
  akunTujuanId: z.string().trim().optional(),
  kategoriId: z.string().trim().optional(),
  nominal: z
    .number({ error: "Nominal harus berupa angka." })
    .int({ error: "Nominal harus bilangan bulat." })
    .gt(0, { error: "Nominal harus lebih dari 0." })
    .max(MAKS_NOMINAL, { error: "Nominal maksimal Rp 1.000.000.000.000." }),
  biayaAdmin: z
    .number({ error: "Biaya admin harus berupa angka." })
    .int({ error: "Biaya admin harus bilangan bulat." })
    .min(0, { error: "Biaya admin tidak boleh minus." })
    .max(MAKS_NOMINAL, { error: "Biaya admin terlalu besar." })
    .optional(),
  deskripsi: z.string().trim().max(200, { error: "Deskripsi maksimal 200 karakter." }).optional(),
});

export type TransaksiBody = z.infer<typeof transaksiBody>;
type T = ParsedRow<"Transaksi">["data"];

export interface TransaksiDto {
  id: string;
  periodeId: string;
  tanggal: string;
  tipe: string;
  akunId: string;
  akunNama: string;
  akunTujuanId: string | null;
  akunTujuanNama: string | null;
  kategoriId: string | null;
  kategoriNama: string | null;
  kodeSistem: string | null;
  nominal: number;
  biayaAdmin: number;
  deskripsi: string;
  berulangId: string | null;
  createdAt: string | null;
}

/** DTO dengan nama akun/kategori (denormalisasi untuk tampilan, spec §10.6). */
export function transaksiMapper(akun: ParsedRow<"Akun">[], kategori: ParsedRow<"Kategori">[]) {
  const namaAkun = new Map(akun.map((a) => [a.data.id, a.data.nama]));
  const kat = new Map(kategori.map((k) => [k.data.id, k.data]));
  return (t: T): TransaksiDto => ({
    id: t.id,
    periodeId: t.periode_id,
    tanggal: t.tanggal ?? "",
    tipe: t.tipe,
    akunId: t.akun_id,
    akunNama: namaAkun.get(t.akun_id) ?? "(akun dihapus)",
    akunTujuanId: t.akun_tujuan_id || null,
    akunTujuanNama: t.akun_tujuan_id ? (namaAkun.get(t.akun_tujuan_id) ?? "(akun dihapus)") : null,
    kategoriId: t.kategori_id || null,
    kategoriNama: t.kategori_id ? (kat.get(t.kategori_id)?.nama ?? "(kategori dihapus)") : null,
    kodeSistem: (t.kategori_id && kat.get(t.kategori_id)?.kode_sistem) || null,
    nominal: t.nominal ?? 0,
    biayaAdmin: t.biaya_admin ?? 0,
    deskripsi: t.deskripsi,
    berulangId: t.berulang_id || null,
    createdAt: t.created_at,
  });
}

/** Urut tanggal desc, lalu created_at desc (spec §10.6). */
export function urutTransaksi(a: T, b: T): number {
  return (b.tanggal ?? "").localeCompare(a.tanggal ?? "") || (b.created_at ?? "").localeCompare(a.created_at ?? "");
}

export function isTarikTabungan(t: T, kategori: ParsedRow<"Kategori">[]): boolean {
  return kategori.some((k) => k.data.id === t.kategori_id && k.data.kode_sistem === "TARIK_TABUNGAN");
}

export interface SheetsTransaksi {
  akun: ParsedRow<"Akun">[];
  akunPengguna: ParsedRow<"AkunPengguna">[];
  kategori: ParsedRow<"Kategori">[];
  periode: ParsedRow<"Periode">[];
}

/**
 * Validasi aturan bisnis transaksi (spec §5.2 Transaksi, §7.1, §7.2) lalu kembalikan kolom yang disimpan.
 * `current` = transaksi lama saat edit: akun/kategori yang sudah nonaktif boleh tetap dipakai kalau tidak diganti.
 */
export function resolveTransaksi(
  body: TransaksiBody,
  sheets: SheetsTransaksi,
  userId: string,
  clock: Clock,
  current?: T,
): Pick<T, "periode_id" | "tanggal" | "tipe" | "akun_id" | "akun_tujuan_id" | "kategori_id" | "nominal" | "biaya_admin" | "deskripsi"> {
  const errors: FieldErrors = {};
  const err = (field: string, pesan: string) => (errors[field] ??= []).push(pesan);
  const today = todayWib(clock);
  const tanggal = body.tanggal ?? today;

  const pilihan = pilihanAkun(sheets.akunPengguna, userId);
  const cekAkun = (field: "akunId" | "akunTujuanId", id: string, lama?: string) => {
    const a = sheets.akun.find((r) => r.data.id === id)?.data;
    if (!a) err(field, "Akun tidak ditemukan.");
    else if (id === lama) return;
    else if (!a.aktif) err(field, `Akun ${a.nama} nonaktif dan tidak bisa dipakai.`);
    else if (!pilihan.dipilih(id)) err(field, pesanBelumDipilih(a.nama));
  };

  cekAkun("akunId", body.akunId, current?.akun_id);
  let akunTujuan = "";
  let kategoriId = "";
  let biayaAdmin = 0;

  if (body.tipe === "transfer") {
    akunTujuan = body.akunTujuanId ?? "";
    if (!akunTujuan) err("akunTujuanId", "Akun tujuan wajib dipilih.");
    else if (akunTujuan === body.akunId) err("akunTujuanId", "Akun tujuan harus berbeda dengan akun asal.");
    else cekAkun("akunTujuanId", akunTujuan, current?.akun_tujuan_id);
    biayaAdmin = body.biayaAdmin ?? 0;
  } else {
    kategoriId = body.kategoriId ?? "";
    const k = sheets.kategori.find((r) => r.data.id === kategoriId)?.data;
    if (!kategoriId) err("kategoriId", "Kategori wajib dipilih.");
    else if (!k) err("kategoriId", "Kategori tidak ditemukan.");
    else if (k.tipe !== body.tipe) err("kategoriId", `Kategori ${k.nama} bukan kategori ${body.tipe === "masuk" ? "pemasukan" : "pengeluaran"}.`);
    else if (k.kode_sistem === "TARIK_TABUNGAN") err("kategoriId", "Kategori ini hanya untuk tarik tabungan.");
    else if (!k.aktif && kategoriId !== current?.kategori_id) err("kategoriId", `Kategori ${k.nama} nonaktif dan tidak bisa dipakai.`);
    if (body.biayaAdmin) err("biayaAdmin", "Biaya admin hanya untuk transfer.");
  }

  if (tanggal > addDays(today, 31)) err("tanggal", "Tanggal paling lambat 31 hari dari hari ini.");
  if (Object.keys(errors).length) throw validationError(errors);

  const periode = periodeUntukTanggal(sheets.periode, userId, tanggal);
  return {
    periode_id: periode.data.id,
    tanggal,
    tipe: body.tipe,
    akun_id: body.akunId,
    akun_tujuan_id: akunTujuan,
    kategori_id: kategoriId,
    nominal: body.nominal,
    biaya_admin: biayaAdmin,
    deskripsi: body.deskripsi ?? "",
  };
}

/** Peringatan saldo minus untuk akun yang dikurangi transaksi ini (spec §7.3). Tidak memblokir. */
export function peringatanSaldo(
  t: T,
  saldoAwal: ParsedRow<"SaldoAwal">[],
  transaksi: ParsedRow<"Transaksi">[],
  akun: ParsedRow<"Akun">[],
): string[] {
  if (t.tipe === "masuk") return [];
  const saldo = saldoPerAkun(t.periode_id, saldoAwal, transaksi).get(t.akun_id) ?? 0;
  if (saldo >= 0) return [];
  const nama = akun.find((a) => a.data.id === t.akun_id)?.data.nama ?? "akun";
  return [`Saldo ${nama} menjadi minus ${formatRupiah(-saldo)}`];
}

export function assertBukanTarik(t: T, kategori: ParsedRow<"Kategori">[]) {
  if (isTarikTabungan(t, kategori)) throw new AppError(409, "Ubah lewat menu Tabungan.");
}
