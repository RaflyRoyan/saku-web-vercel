import { AppError } from "../common/errors.js";
import type { ParsedRow } from "../repositories/rows.js";

type T = ParsedRow<"Transaksi">["data"];

/** Deskripsi transaksi masuk saat tagihan QRIS dibayar. */
export const deskripsiTagihan = (keterangan: string) => keterangan || "Pembayaran QRIS";

/** Transaksi masuk dari tagihan QRIS hanya bisa diubah lewat halaman Terima QRIS. */
export function assertBukanTagihanQris(t: T, tagihan: ParsedRow<"TagihanQris">[]) {
  if (tagihan.some((r) => r.data.transaksi_id === t.id)) {
    throw new AppError(409, "Transaksi ini dari tagihan QRIS. Ubah lewat halaman Terima QRIS.");
  }
}
