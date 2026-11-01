import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

export type JenisAkun = "bank" | "ewallet" | "cash";
export type TipeKategori = "masuk" | "keluar";

export interface Akun {
  id: string;
  nama: string;
  jenis: JenisAkun;
  urutan: number;
  aktif: boolean;
  /** Saldo milik pengguna yang login di periode aktif; null kalau belum ada periode. */
  saldo: number | null;
  /** Dipakai pengguna yang login (Pengaturan → Akun saya). */
  dipilih: boolean;
  /** Urutan menurut pengguna; akun yang tidak dipilih di belakang. */
  urutanSaya: number;
}

export interface PilihanAkun {
  /** false = belum pernah disimpan (semua akun aktif dipakai). */
  eksplisit: boolean;
  akun: { id: string; nama: string; jenis: JenisAkun; dipilih: boolean; saldo: number | null }[];
}

export interface Kategori {
  id: string;
  nama: string;
  tipe: TipeKategori;
  kodeSistem: "BIAYA_ADMIN" | "TARIK_TABUNGAN" | null;
  aktif: boolean;
}

export const masterKeys = {
  akun: ["akun"] as const,
  pilihanAkun: ["akun", "pilihan"] as const,
  kategori: ["kategori"] as const,
};

/**
 * `false` (default): hanya akun aktif yang dipilih pengguna, urut pengguna.
 * `true`: semua akun termasuk nonaktif & tidak dipilih, urut master.
 */
export function useAkun(termasukNonaktif = false) {
  return useQuery({
    queryKey: [...masterKeys.akun, { termasukNonaktif }],
    queryFn: () => api<Akun[]>(`/akun?termasukNonaktif=${termasukNonaktif}`),
  });
}

export function usePilihanAkun() {
  return useQuery({ queryKey: masterKeys.pilihanAkun, queryFn: () => api<PilihanAkun>("/akun/pilihan") });
}

/** Akun untuk pilihan di form: aktif & dipilih, ditambah akun lama di `tetap` (saat edit). Urut pengguna. */
export function akunUntukForm(list: Akun[], tetap: (string | null | undefined)[] = []): Akun[] {
  return list.filter((a) => (a.aktif && a.dipilih) || tetap.includes(a.id)).sort((a, b) => a.urutanSaya - b.urutanSaya || a.nama.localeCompare(b.nama, "id"));
}

export function useKategori(termasukNonaktif = false) {
  return useQuery({
    queryKey: [...masterKeys.kategori, { termasukNonaktif }],
    queryFn: () => api<Kategori[]>(`/kategori?termasukNonaktif=${termasukNonaktif}`),
  });
}
