import { useInfiniteQuery, useQuery, type QueryClient } from "@tanstack/react-query";
import { api, send } from "../lib/api";

export type TipeTransaksi = "keluar" | "masuk" | "transfer";

export interface Transaksi {
  id: string;
  periodeId: string;
  tanggal: string;
  tipe: TipeTransaksi;
  akunId: string;
  akunNama: string;
  akunTujuanId: string | null;
  akunTujuanNama: string | null;
  kategoriId: string | null;
  kategoriNama: string | null;
  kodeSistem: "BIAYA_ADMIN" | "TARIK_TABUNGAN" | "PATUNGAN" | null;
  nominal: number;
  biayaAdmin: number;
  deskripsi: string;
  berulangId: string | null;
  label: string | null;
  createdAt: string | null;
}

export interface TransaksiTersimpan extends Transaksi {
  peringatan: string[];
}

export interface FilterTransaksi {
  periodeId?: string;
  akunId?: string;
  tipe?: string;
  kategoriId?: string;
  /** Kategori induk pengeluaran ("LAINNYA" untuk Lainnya). */
  kelompokId?: string;
  q?: string;
  /** Rentang tanggal yyyy-MM-dd (inklusif). */
  dari?: string;
  sampai?: string;
  label?: string;
}

interface Halaman {
  data: Transaksi[];
  total: number;
  halaman: number;
  ukuran: number;
}

export const transaksiKeys = {
  all: ["transaksi"] as const,
  list: (f: FilterTransaksi) => ["transaksi", "list", f] as const,
  detail: (id: string) => ["transaksi", id] as const,
  label: ["transaksi", "label"] as const,
  ringkasanLabel: (label: string) => ["transaksi", "label", "ringkasan", label] as const,
};

export interface LabelDipakai {
  label: string;
  jumlah: number;
}

export interface RingkasanLabel {
  label: string;
  jumlah: number;
  masuk: number;
  keluar: number;
  dari: string | null;
  sampai: string | null;
  perKategori: { kategoriId: string; kategoriNama: string; nominal: number }[];
}

/** Label yang pernah dipakai, paling sering dulu. */
export function useLabelList() {
  return useQuery({ queryKey: transaksiKeys.label, queryFn: () => api<LabelDipakai[]>("/transaksi/label") });
}

export function useRingkasanLabel(label: string) {
  return useQuery({
    queryKey: transaksiKeys.ringkasanLabel(label),
    queryFn: () => api<RingkasanLabel>(`/transaksi/label/ringkasan?${new URLSearchParams({ label })}`),
    enabled: Boolean(label),
  });
}

/** Beri label banyak transaksi sekaligus. null = hapus label. */
export const setLabelTransaksi = (ids: string[], label: string | null) => send<{ label: string | null; jumlah: number }>("PUT", "/transaksi/label", { ids, label });

function query(f: FilterTransaksi, halaman: number, ukuran: number) {
  const params = new URLSearchParams({ halaman: String(halaman), ukuran: String(ukuran) });
  for (const [k, v] of Object.entries(f)) if (v) params.set(k, v);
  return `/transaksi?${params}`;
}

/** Paginasi "Muat lebih banyak" (02 §6.6). */
export function useTransaksiList(f: FilterTransaksi, ukuran = 50, enabled = true) {
  return useInfiniteQuery({
    queryKey: [...transaksiKeys.list(f), ukuran],
    queryFn: ({ pageParam }) => api<Halaman>(query(f, pageParam, ukuran)),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.halaman * last.ukuran < last.total ? last.halaman + 1 : undefined),
    enabled,
  });
}

export function useTransaksi(id: string | undefined) {
  return useQuery({
    queryKey: transaksiKeys.detail(id ?? ""),
    queryFn: () => api<Transaksi>(`/transaksi/${id}`),
    enabled: Boolean(id),
  });
}

/** Setelah transaksi/periode berubah: saldo, ringkasan, dan riwayat ikut berubah. */
export function invalidateKeuangan(qc: QueryClient) {
  for (const key of [["transaksi"], ["ringkasan"], ["periode"], ["akun"], ["tabungan"], ["berulang"], ["dashboard"], ["split"], ["tagihan-qris"]]) qc.invalidateQueries({ queryKey: key });
}
