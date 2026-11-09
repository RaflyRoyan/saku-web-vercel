import { useQuery } from "@tanstack/react-query";
import { ApiError, api } from "../lib/api";

export interface Periode {
  id: string;
  nama: string;
  tanggalMulai: string;
  tanggalSelesai: string | null;
  keterangan: string;
  aktif: boolean;
}

export interface PeriodeAktif extends Periode {
  saldoAwal: { akunId: string; saldo: number }[];
}

export interface PerKategori {
  kategoriId: string;
  nama: string;
  total: number;
  jumlah: number;
}

/** Pengeluaran per kategori induk (KelompokKategori) dengan rincian per sub kategori. */
export interface PerKelompok {
  kelompokId: string;
  nama: string;
  total: number;
  jumlah: number;
  sub: PerKategori[];
}

export interface RingkasanAkun {
  akunId: string;
  nama: string;
  jenis: "bank" | "ewallet" | "cash";
  aktif: boolean;
  saldoAwal: number;
  masuk: number;
  keluar: number;
  /** Setor langsung ke tabungan (bukan pengeluaran, tetap mengurangi saldo). */
  ditabung: number;
  biayaAdmin: number;
  transferMasuk: number;
  transferKeluar: number;
  saldoAkhir: number;
  jumlahTransaksi: number;
  pengeluaranPerKategori: PerKategori[];
  pengeluaranPerKelompok: PerKelompok[];
}

export interface Ringkasan {
  periode: Periode;
  totalSaldoAwal: number;
  totalMasuk: number;
  totalPengeluaran: number;
  totalSaldoAkhir: number;
  perAkun: RingkasanAkun[];
  pengeluaranPerKategori: PerKategori[];
  pengeluaranPerKelompok: PerKelompok[];
  pemasukanPerKategori: PerKategori[];
  setorTabungan: { akunId: string; nominal: number }[];
}

export const periodeKeys = {
  all: ["periode"] as const,
  aktif: ["periode", "aktif"] as const,
  ringkasan: (id: string) => ["ringkasan", id] as const,
};

export function usePeriodeList() {
  return useQuery({ queryKey: periodeKeys.all, queryFn: () => api<Periode[]>("/periode") });
}

/** Periode aktif, atau `null` kalau belum ada (API 404). */
export function usePeriodeAktif() {
  return useQuery({
    queryKey: periodeKeys.aktif,
    queryFn: async () => {
      try {
        return await api<PeriodeAktif>("/periode/aktif");
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
  });
}

export function useRingkasan(periodeId: string | undefined) {
  return useQuery({
    queryKey: periodeKeys.ringkasan(periodeId ?? ""),
    queryFn: () => api<Ringkasan>(`/periode/${periodeId}/ringkasan`),
    enabled: Boolean(periodeId),
  });
}

/** Periode terpilih dari `?periode=` atau periode aktif. */
export function usePeriodeTerpilih(id: string | null) {
  const aktif = usePeriodeAktif();
  return { aktif, periodeId: id ?? aktif.data?.id };
}
