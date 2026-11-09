import { z } from "zod";
import type { ParsedRow } from "../repositories/rows.js";

type T = ParsedRow<"Transaksi">["data"];

export const MAKS_LABEL = 50;

export const labelSchema = z.string({ error: "Label harus berupa teks." }).max(200, { error: "Label terlalu panjang." });

/** Rapikan spasi. Kosong = tanpa label. */
export function rapikanLabel(input: string): string {
  return input.trim().replace(/\s+/g, " ");
}

/**
 * Label final: dirapikan, lalu kalau label yang sama (beda huruf besar/kecil) sudah dipakai pengguna,
 * ejaan lama yang dipakai. Lebih dari 50 karakter → null (caller mengembalikan error).
 */
export function labelFinal(input: string, transaksi: readonly { data: T }[], uid: string): string | null {
  const rapi = rapikanLabel(input);
  if (rapi.length > MAKS_LABEL) return null;
  if (!rapi) return "";
  const kecil = rapi.toLowerCase();
  return transaksi.find((r) => r.data.user_id === uid && r.data.label.toLowerCase() === kecil)?.data.label ?? rapi;
}

export const samaLabel = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Label yang dipakai pengguna + jumlah transaksinya, paling sering dulu. */
export function daftarLabel(transaksi: readonly { data: T }[], uid: string): { label: string; jumlah: number }[] {
  const hitung = new Map<string, { label: string; jumlah: number }>();
  for (const { data: t } of transaksi) {
    if (t.user_id !== uid || !t.label) continue;
    const key = t.label.toLowerCase();
    const cur = hitung.get(key);
    hitung.set(key, { label: cur?.label ?? t.label, jumlah: (cur?.jumlah ?? 0) + 1 });
  }
  return [...hitung.values()].sort((a, b) => b.jumlah - a.jumlah || a.label.localeCompare(b.label, "id"));
}

/** Total masuk/keluar satu label (lintas periode, transfer tidak dihitung) + rincian keluar per kategori. */
export function ringkasanLabel(transaksi: readonly { data: T }[], kategori: readonly ParsedRow<"Kategori">[], uid: string, label: string) {
  const list = transaksi.map((r) => r.data).filter((t) => t.user_id === uid && t.label && samaLabel(t.label, label));
  const nama = new Map(kategori.map((k) => [k.data.id, k.data.nama]));
  const perKategori = new Map<string, number>();
  let masuk = 0;
  let keluar = 0;
  for (const t of list) {
    const n = t.nominal ?? 0;
    if (t.tipe === "masuk") masuk += n;
    else if (t.tipe === "keluar") {
      keluar += n;
      perKategori.set(t.kategori_id, (perKategori.get(t.kategori_id) ?? 0) + n);
    }
  }
  const tanggal = list.map((t) => t.tanggal ?? "").filter(Boolean).sort();
  return {
    label: list[0]?.label ?? label,
    jumlah: list.length,
    masuk,
    keluar,
    dari: tanggal[0] ?? null,
    sampai: tanggal[tanggal.length - 1] ?? null,
    perKategori: [...perKategori.entries()]
      .map(([kategoriId, nominal]) => ({ kategoriId, kategoriNama: nama.get(kategoriId) ?? "(kategori dihapus)", nominal }))
      .sort((a, b) => b.nominal - a.nominal),
  };
}
