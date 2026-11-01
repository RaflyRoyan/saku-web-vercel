import type { ParsedRow } from "../repositories/rows.js";

/**
 * Akun yang dipakai satu pengguna (sheet `AkunPengguna`).
 * Pengguna yang belum punya baris sama sekali (pengguna lama) = memakai semua akun, urut `urutan` master.
 */
export interface PilihanAkun {
  /** true kalau pengguna sudah pernah menyimpan pilihan sendiri. */
  eksplisit: boolean;
  /** Baris `AkunPengguna` milik pengguna, urut `urutan`. */
  baris: ParsedRow<"AkunPengguna">[];
  dipilih(akunId: string): boolean;
  /** Kunci urut: urutan pengguna dulu, akun yang tidak dipilih di belakang (urutan master). */
  urutan(akun: ParsedRow<"Akun">["data"]): number;
  /** Salinan `akun` yang diurutkan menurut `urutan()`. */
  urutkan<A extends { data: ParsedRow<"Akun">["data"] }>(akun: A[]): A[];
}

const SESUDAH_PILIHAN = 1_000_000;

export function pilihanAkun(rows: ParsedRow<"AkunPengguna">[], userId: string): PilihanAkun {
  const baris = rows
    .filter((r) => r.data.user_id === userId && r.data.akun_id)
    .sort((a, b) => (a.data.urutan ?? 0) - (b.data.urutan ?? 0));
  const posisi = new Map(baris.map((r, i) => [r.data.akun_id, i + 1]));
  const eksplisit = baris.length > 0;

  const urutan = (a: ParsedRow<"Akun">["data"]) => {
    const master = a.urutan ?? 0;
    if (!eksplisit) return master;
    return posisi.get(a.id) ?? SESUDAH_PILIHAN + master;
  };

  return {
    eksplisit,
    baris,
    dipilih: (akunId) => !eksplisit || posisi.has(akunId),
    urutan,
    urutkan: (akun) => [...akun].sort((a, b) => urutan(a.data) - urutan(b.data) || a.data.nama.localeCompare(b.data.nama, "id")),
  };
}

export const pesanBelumDipilih = (nama: string) => `Akun ${nama} belum dipilih di Pengaturan.`;
