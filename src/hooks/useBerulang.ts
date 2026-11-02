import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { AnggaranPeriode } from "./useAnggaran";
import type { Ringkasan } from "./usePeriode";
import type { Transaksi } from "./useTransaksi";

export interface Berulang {
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
  /** Bulan acuan status (bulan pengingat yang tampil atau bulan ini). */
  bulan: string;
  jatuhTempo: string;
  status: "belum" | "dibayar" | "dilewati";
  transaksiId: string | null;
  berlaku: boolean;
}

export interface Pengingat {
  berulangId: string;
  bulan: string;
  jatuhTempo: string;
  status: "akan_datang" | "hari_ini" | "terlambat";
  sisaHari: number;
  berulang: Berulang;
}

export interface Dashboard {
  ringkasan: Ringkasan | null;
  /** Anggaran periode aktif (null kalau belum ada periode). */
  anggaran: AnggaranPeriode | null;
  totalTabungan: number;
  pengingat: Pengingat[];
  transaksiTerakhir: Transaksi[];
}

export const berulangKeys = {
  all: ["berulang"] as const,
  dashboard: ["dashboard"] as const,
};

export function useBerulang() {
  return useQuery({ queryKey: berulangKeys.all, queryFn: () => api<Berulang[]>("/berulang?termasukNonaktif=true") });
}

export function useDashboard() {
  return useQuery({ queryKey: berulangKeys.dashboard, queryFn: () => api<Dashboard>("/dashboard") });
}
