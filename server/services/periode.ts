import { AppError } from "../common/errors.js";
import type { ParsedRow } from "../repositories/rows.js";

export interface PeriodeDto {
  id: string;
  nama: string;
  tanggalMulai: string;
  tanggalSelesai: string | null;
  keterangan: string;
  aktif: boolean;
}

export const periodeDto = (
  p: Pick<ParsedRow<"Periode">["data"], "id" | "nama" | "tanggal_mulai" | "tanggal_selesai" | "keterangan">,
): PeriodeDto => ({
  id: p.id,
  nama: p.nama,
  tanggalMulai: p.tanggal_mulai ?? "",
  tanggalSelesai: p.tanggal_selesai,
  keterangan: p.keterangan,
  aktif: !p.tanggal_selesai,
});

/** Periode milik pengguna, terbaru di atas. */
export function periodeMilik(periode: ParsedRow<"Periode">[], userId: string): ParsedRow<"Periode">[] {
  return periode
    .filter((p) => p.data.user_id === userId && p.data.tanggal_mulai)
    .sort((a, b) => (b.data.tanggal_mulai ?? "").localeCompare(a.data.tanggal_mulai ?? ""));
}

/**
 * Periode yang mencakup `tanggal`: tanggal_mulai ≤ tanggal ≤ (tanggal_selesai ?? ∞) (spec §7.2).
 * Tidak ketemu → 422.
 */
export function periodeUntukTanggal(periode: ParsedRow<"Periode">[], userId: string, tanggal: string): ParsedRow<"Periode"> {
  const found = periodeMilik(periode, userId).find(
    ({ data: p }) => (p.tanggal_mulai ?? "") <= tanggal && (!p.tanggal_selesai || tanggal <= p.tanggal_selesai),
  );
  if (!found) throw new AppError(422, "Belum ada periode untuk tanggal ini. Mulai periode baru dulu.");
  return found;
}

/** `yyyy-MM-dd` + n hari. */
export function addDays(tanggal: string, n: number): string {
  const d = new Date(`${tanggal}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

/** Nama default `"Periode 25 Okt 2026"` (spec §5.2). */
export function namaDefault(tanggal: string): string {
  const [y, m, d] = tanggal.split("-").map(Number);
  return `Periode ${d} ${BULAN[m - 1]} ${y}`;
}
