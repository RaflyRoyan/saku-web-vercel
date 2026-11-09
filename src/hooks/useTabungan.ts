import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { Periode } from "./usePeriode";

export interface RiwayatTabungan {
  id: string;
  tanggal: string;
  /** setor = sisa saat tutup periode, simpan = setor langsung. */
  jenis: "setor" | "simpan" | "tarik";
  periodeId: string;
  periodeNama: string;
  akunId: string;
  akunNama: string;
  nominal: number;
  keterangan: string;
  transaksiId: string | null;
  bisaHapus: boolean;
}

export interface Tabungan {
  total: number;
  perAkun: { akunId: string; nama: string; setor: number; tarik: number; saldo: number }[];
  riwayat: RiwayatTabungan[];
}

export interface PratinjauTutup {
  periode: Periode;
  sisa: { akunId: string; nama: string; nominal: number }[];
  total: number;
}

export const tabunganKeys = {
  all: ["tabungan"] as const,
  pratinjau: ["periode", "aktif", "pratinjau-tutup"] as const,
};

export function useTabungan() {
  return useQuery({ queryKey: tabunganKeys.all, queryFn: () => api<Tabungan>("/tabungan") });
}

export function usePratinjauTutup(enabled: boolean) {
  return useQuery({
    queryKey: tabunganKeys.pratinjau,
    queryFn: () => api<PratinjauTutup>("/periode/aktif/pratinjau-tutup"),
    enabled,
  });
}
