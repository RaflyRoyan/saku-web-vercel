import { z } from "zod";
import { AppError, validationError, type FieldErrors } from "../common/errors.js";
import type { ParsedRow } from "../repositories/rows.js";

type T = ParsedRow<"Transaksi">["data"];

const MAKS = 1_000_000_000_000;
const rupiah = (label: string, min: 0 | 1) =>
  z
    .number({ error: `${label} harus berupa angka.` })
    .int({ error: `${label} harus bilangan bulat.` })
    .min(min, { error: min ? `${label} harus lebih dari 0.` : `${label} tidak boleh minus.` })
    .max(MAKS, { error: `${label} terlalu besar.` });

export const splitBody = z.object({
  nama: z.string({ error: "Nama wajib diisi." }).trim().min(1, { error: "Nama wajib diisi." }).max(60, { error: "Nama maksimal 60 karakter." }),
  tanggal: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Format tanggal harus yyyy-MM-dd." }).optional(),
  akunId: z.string({ error: "Akun wajib dipilih." }).trim().min(1, { error: "Akun wajib dipilih." }),
  kategoriId: z.string({ error: "Kategori wajib dipilih." }).trim().min(1, { error: "Kategori wajib dipilih." }),
  akunTerimaId: z.string({ error: "Akun penerima wajib dipilih." }).trim().min(1, { error: "Akun penerima wajib dipilih." }),
  pajak: rupiah("Pajak", 0).default(0),
  servis: rupiah("Servis", 0).default(0),
  diskon: rupiah("Diskon", 0).default(0),
  peserta: z
    .array(
      z.object({
        id: z.string().trim().optional(),
        nama: z.string({ error: "Nama wajib diisi." }).trim().min(1, { error: "Nama wajib diisi." }).max(40, { error: "Nama maksimal 40 karakter." }),
        saya: z.boolean({ error: "Saya harus true/false." }),
      }),
      { error: "Peserta wajib diisi." },
    )
    .max(50, { error: "Maksimal 50 orang." }),
  items: z
    .array(
      z.object({
        nama: z.string({ error: "Nama item wajib diisi." }).trim().min(1, { error: "Nama item wajib diisi." }).max(80, { error: "Nama item maksimal 80 karakter." }),
        qty: z.number({ error: "Qty harus berupa angka." }).int({ error: "Qty harus bilangan bulat." }).min(1, { error: "Qty minimal 1." }).max(9999, { error: "Qty terlalu besar." }),
        harga: rupiah("Harga", 1),
        /** Indeks ke array `peserta`. */
        peserta: z.array(z.number().int(), { error: "Peserta item wajib diisi." }),
      }),
      { error: "Item wajib diisi." },
    )
    .max(200, { error: "Maksimal 200 item." }),
});

export type SplitBody = z.infer<typeof splitBody>;

type InputHitung = {
  items: readonly { harga: number; peserta: readonly number[] }[];
  pajak: number;
  servis: number;
  diskon: number;
};

/**
 * Bagian tiap peserta (spec split bill §4): porsi item dibagi rata antar pemiliknya, lalu pajak/servis/diskon
 * proporsional ke subtotal masing-masing. Dibulatkan ke rupiah; sisa pembulatan ke peserta "saya" agar Σ = total.
 * Duplikat di src/lib/splitHitung.ts (pratinjau di browser) — ubah keduanya bersamaan.
 */
export function hitungBagian(body: InputHitung, jumlahPeserta: number, indeksSaya: number): { subtotal: number; total: number; nominal: number[] } {
  const porsi = Array.from({ length: jumlahPeserta }, () => 0);
  let subtotal = 0;
  for (const it of body.items) {
    subtotal += it.harga;
    const pemilik = it.peserta.filter((p) => p >= 0 && p < jumlahPeserta);
    for (const p of pemilik) porsi[p] += it.harga / pemilik.length;
  }
  const total = subtotal + body.pajak + body.servis - body.diskon;
  const faktor = subtotal > 0 ? total / subtotal : 0;
  const nominal = porsi.map((x) => Math.round(x * faktor));
  const sisa = total - nominal.reduce((a, b) => a + b, 0);
  if (jumlahPeserta > 0) nominal[indeksSaya] += sisa;
  return { subtotal, total, nominal };
}

/** Aturan split di luar bentuk data (zod): item, peserta, total (spec split bill §4). */
export function cekSplit(body: SplitBody): void {
  const errors: FieldErrors = {};
  const err = (field: string, pesan: string) => (errors[field] ??= []).push(pesan);
  const n = body.peserta.length;

  if (!body.items.length) err("items", "Minimal 1 item.");
  body.items.forEach((it, i) => {
    if (!it.peserta.length) err(`items.${i}.peserta`, "Pilih minimal 1 orang.");
    else if (it.peserta.some((p) => p < 0 || p >= n) || new Set(it.peserta).size !== it.peserta.length) err(`items.${i}.peserta`, "Peserta tidak valid.");
  });

  if (n < 2) err("peserta", "Minimal 2 orang.");
  else if (body.peserta.filter((p) => p.saya).length !== 1) err("peserta", 'Harus ada tepat 1 peserta "Saya".');
  const dipakai = new Set(body.items.flatMap((it) => it.peserta));
  const nama = new Set<string>();
  body.peserta.forEach((p, i) => {
    const key = p.nama.toLowerCase();
    if (nama.has(key)) err(`peserta.${i}.nama`, `Nama ${p.nama} dobel.`);
    else if (body.items.length && !dipakai.has(i)) err(`peserta.${i}.nama`, `${p.nama} belum punya item.`);
    nama.add(key);
  });

  const subtotal = body.items.reduce((a, it) => a + it.harga, 0);
  if (body.items.length && subtotal + body.pajak + body.servis - body.diskon <= 0) err("diskon", "Diskon melebihi subtotal.");
  if (Object.keys(errors).length) throw validationError(errors);
}

/** Transaksi yang dibuat split bill hanya bisa diubah lewat split bill. */
export function assertBukanSplit(t: T, bill: ParsedRow<"SplitBill">[], peserta: ParsedRow<"SplitPeserta">[]) {
  const splitId = bill.find((b) => b.data.transaksi_id === t.id)?.data.id ?? peserta.find((p) => p.data.transaksi_id === t.id)?.data.split_id;
  if (!splitId) return;
  const nama = bill.find((b) => b.data.id === splitId)?.data.nama ?? "";
  throw new AppError(409, `Transaksi ini bagian dari split bill ${nama}. Ubah lewat halaman Split Bill.`);
}
