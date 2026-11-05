import { useQuery } from "@tanstack/react-query";
import { api, send } from "../lib/api";

export interface SplitPeserta {
  id: string;
  nama: string;
  saya: boolean;
  nominal: number;
  lunas: boolean;
  transaksiId: string | null;
}

export interface SplitItem {
  id: string;
  nama: string;
  qty: number;
  harga: number;
  /** ID peserta pemilik item. */
  peserta: string[];
}

export interface BelumLunas {
  jumlah: number;
  nominal: number;
}

export interface Split {
  id: string;
  nama: string;
  tanggal: string;
  akunId: string;
  akunNama: string;
  kategoriId: string;
  kategoriNama: string;
  akunTerimaId: string;
  akunTerimaNama: string;
  subtotal: number;
  pajak: number;
  servis: number;
  diskon: number;
  total: number;
  transaksiId: string | null;
  items: SplitItem[];
  peserta: SplitPeserta[];
  belumLunas: BelumLunas;
}

export interface SplitRingkas {
  id: string;
  nama: string;
  tanggal: string;
  total: number;
  jumlahPeserta: number;
  belumLunas: BelumLunas;
}

/** Body POST/PUT `/split`. `items[].peserta` = indeks ke `peserta`. */
export interface SplitInput {
  nama: string;
  tanggal?: string;
  akunId: string;
  kategoriId: string;
  akunTerimaId: string;
  pajak: number;
  servis: number;
  diskon: number;
  peserta: { id?: string; nama: string; saya: boolean }[];
  items: { nama: string; qty: number; harga: number; peserta: number[] }[];
}

export interface Qris {
  payload: string;
  merchant: string;
  kota: string;
}

export const splitKeys = {
  semua: ["split"] as const,
  list: ["split", "list"] as const,
  detail: (id: string) => ["split", "detail", id] as const,
  nama: ["split", "nama"] as const,
  qris: ["pengaturan", "qris"] as const,
};

export function useSplitList() {
  return useQuery({ queryKey: splitKeys.list, queryFn: () => api<SplitRingkas[]>("/split") });
}

export function useSplit(id: string | undefined) {
  return useQuery({ queryKey: splitKeys.detail(id ?? ""), queryFn: () => api<Split>(`/split/${id}`), enabled: Boolean(id) });
}

export function useNamaPeserta() {
  return useQuery({ queryKey: splitKeys.nama, queryFn: () => api<string[]>("/split/nama"), staleTime: 5 * 60_000 });
}

export function useQris() {
  return useQuery({ queryKey: splitKeys.qris, queryFn: () => api<Qris | null>("/pengaturan/qris"), staleTime: 5 * 60_000 });
}

export const simpanSplit = (input: SplitInput, id?: string) =>
  send<Split & { peringatan: string[] }>(id ? "PUT" : "POST", id ? `/split/${id}` : "/split", input);

export const hapusSplit = (id: string) => send<void>("DELETE", `/split/${id}`);

export const setLunas = (id: string, pesertaId: string, lunas: boolean) => send<Split>("PUT", `/split/${id}/peserta/${pesertaId}/lunas`, { lunas });

export const simpanQris = (payload: string | null) => send<Qris | null>("PUT", "/pengaturan/qris", { payload });
