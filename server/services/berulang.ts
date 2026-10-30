import type { ParsedRow } from "../repositories/rows.js";

type B = ParsedRow<"Berulang">["data"];

export type StatusBulan = "belum" | "dibayar" | "dilewati";
export type StatusPengingat = "akan_datang" | "hari_ini" | "terlambat";

const pad = (n: number) => String(n).padStart(2, "0");

/** `yyyy-MM` + n bulan. */
export function addMonths(bulan: string, n: number): string {
  const [y, m] = bulan.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

/** Jatuh tempo di bulan B = min(tgl_jatuh_tempo, hari terakhir bulan B) (spec §7.7). */
export function jatuhTempo(tgl: number, bulan: string): string {
  const [y, m] = bulan.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${bulan}-${pad(Math.min(tgl, last))}`;
}

/** Selisih hari `b − a` untuk tanggal `yyyy-MM-dd`. */
export function selisihHari(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** Berlaku di bulan B kalau aktif, mulai ≤ B, dan (selesai kosong atau B ≤ selesai). */
export function berlaku(b: B, bulan: string): boolean {
  return b.aktif && !!b.mulai && b.mulai <= bulan && (!b.selesai || bulan <= b.selesai);
}

/** Transaksi pembayaran langganan ini yang tanggalnya di bulan B. */
export function pembayaran(b: B, bulan: string, transaksi: ParsedRow<"Transaksi">[]) {
  return transaksi.find((t) => t.data.berulang_id === b.id && t.data.user_id === b.user_id && (t.data.tanggal ?? "").startsWith(bulan));
}

export function dilewati(b: B, bulan: string, lewati: ParsedRow<"BerulangLewati">[]) {
  return lewati.find((l) => l.data.berulang_id === b.id && l.data.user_id === b.user_id && l.data.bulan === bulan);
}

export function statusBulan(
  b: B,
  bulan: string,
  transaksi: ParsedRow<"Transaksi">[],
  lewati: ParsedRow<"BerulangLewati">[],
): { status: StatusBulan; transaksiId: string | null } {
  const bayar = pembayaran(b, bulan, transaksi);
  if (bayar) return { status: "dibayar", transaksiId: bayar.data.id };
  return { status: dilewati(b, bulan, lewati) ? "dilewati" : "belum", transaksiId: null };
}

export interface Pengingat {
  berulangId: string;
  bulan: string;
  jatuhTempo: string;
  status: StatusPengingat;
  sisaHari: number;
}

/**
 * Pengingat untuk tanggal acuan `hari` (spec §7.7): periksa bulan ini dan bulan depan.
 * Tampil kalau berlaku, belum dibayar, belum dilewati, dan hari ≥ jatuh tempo − ingatkan_h_min.
 * `terlambat` hanya untuk bulan berjalan; bulan sebelumnya tidak ditampilkan.
 */
export function hitungPengingat(
  berulang: ParsedRow<"Berulang">[],
  transaksi: ParsedRow<"Transaksi">[],
  lewati: ParsedRow<"BerulangLewati">[],
  userId: string,
  hari: string,
): Pengingat[] {
  const ini = hari.slice(0, 7);
  const hasil: Pengingat[] = [];
  for (const { data: b } of berulang) {
    if (b.user_id !== userId) continue;
    for (const bulan of [ini, addMonths(ini, 1)]) {
      if (!berlaku(b, bulan) || pembayaran(b, bulan, transaksi) || dilewati(b, bulan, lewati)) continue;
      const jt = jatuhTempo(b.tgl_jatuh_tempo ?? 1, bulan);
      const sisaHari = selisihHari(hari, jt);
      if (sisaHari > (b.ingatkan_h_min ?? 3)) continue;
      if (sisaHari < 0 && bulan !== ini) continue;
      hasil.push({ berulangId: b.id, bulan, jatuhTempo: jt, status: sisaHari > 0 ? "akan_datang" : sisaHari === 0 ? "hari_ini" : "terlambat", sisaHari });
    }
  }
  return hasil.sort((a, b) => a.jatuhTempo.localeCompare(b.jatuhTempo));
}
