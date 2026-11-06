import { useQuery } from "@tanstack/react-query";
import { api, send } from "../lib/api";

export interface TagihanQris {
  id: string;
  tanggal: string;
  nominal: number;
  keterangan: string;
  akunId: string;
  akunNama: string;
  kategoriId: string;
  kategoriNama: string;
  lunas: boolean;
  transaksiId: string | null;
}

export interface TagihanQrisInput {
  nominal: number;
  keterangan: string;
  akunId: string;
  kategoriId: string;
}

export const tagihanQrisKey = ["tagihan-qris"] as const;

export function useTagihanQris() {
  return useQuery({ queryKey: tagihanQrisKey, queryFn: () => api<TagihanQris[]>("/tagihan-qris") });
}

export const buatTagihanQris = (input: TagihanQrisInput) => send<TagihanQris>("POST", "/tagihan-qris", input);

export const setLunasTagihanQris = (id: string, lunas: boolean, tanggal?: string) => send<TagihanQris>("PUT", `/tagihan-qris/${id}/lunas`, { lunas, tanggal });

export const hapusTagihanQris = (id: string) => send<void>("DELETE", `/tagihan-qris/${id}`);
