import { useQuery } from "@tanstack/react-query";
import { api, send } from "../lib/api";

export type StatusAnggaran = "aman" | "hampir" | "lewat";

export interface PosAnggaran {
  /** null = tidak dianggarkan. */
  anggaran: number | null;
  terpakai: number;
  sisa: number | null;
  persen: number | null;
  status: StatusAnggaran | null;
}

export interface AnggaranSub extends PosAnggaran {
  kategoriId: string;
  nama: string;
}

export interface AnggaranKelompok extends PosAnggaran {
  kelompokId: string;
  nama: string;
  /** Batas yang diisi untuk kategori induk; null = dihitung dari jumlah sub kategorinya. */
  anggaranSendiri: number | null;
  sub: AnggaranSub[];
}

export interface AnggaranPeriode {
  periodeId: string;
  ada: boolean;
  total: PosAnggaran;
  kelompok: AnggaranKelompok[];
}

export interface ItemAnggaran {
  kelompokId?: string;
  kategoriId?: string;
  nominal: number;
}

/** Di bawah prefix "periode" supaya ikut ter-refresh oleh `invalidateKeuangan`. */
export const anggaranKey = (periodeId: string) => ["periode", periodeId, "anggaran"] as const;

export function useAnggaran(periodeId: string | undefined) {
  return useQuery({
    queryKey: anggaranKey(periodeId ?? ""),
    queryFn: () => api<AnggaranPeriode>(`/periode/${periodeId}/anggaran`),
    enabled: Boolean(periodeId),
  });
}

export const simpanAnggaran = (periodeId: string, items: ItemAnggaran[]) =>
  send<AnggaranPeriode>("PUT", `/periode/${periodeId}/anggaran`, { items });

/** Warna bar & teks per status. */
export const WARNA_STATUS: Record<StatusAnggaran, { bar: string; teks: string; label: string }> = {
  aman: { bar: "bg-masuk", teks: "text-stone-500", label: "Aman" },
  hampir: { bar: "bg-amber-500", teks: "text-amber-700", label: "Hampir habis" },
  lewat: { bar: "bg-keluar", teks: "text-keluar", label: "Terlewati" },
};
