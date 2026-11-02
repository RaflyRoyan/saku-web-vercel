import type { Clock } from "../common/clock.js";
import { newId, newRow, type ParsedRow } from "../repositories/rows.js";
import type { SheetStore } from "../sheets/store.js";
import type { PerKategori } from "./ringkasan.js";

/** Kelompok virtual untuk kategori keluar tanpa kelompok (termasuk Biaya Admin Bank). Tidak punya baris di sheet. */
export const LAINNYA = { id: "LAINNYA", nama: "Lainnya" } as const;

/** Kelompok bawaan saat setup / tombol "Tambah kategori bawaan" di Master. */
export const KELOMPOK_BAWAAN = [
  "Kebutuhan Harian",
  "Tempat Tinggal",
  "Transportasi",
  "Tagihan & Langganan",
  "Kesehatan",
  "Belanja & Gaya Hidup",
  "Hiburan & Liburan",
  "Pendidikan",
  "Sosial & Keluarga",
  "Keuangan",
] as const;

type Kategori = ParsedRow<"Kategori">["data"];
type Kelompok = ParsedRow<"KelompokKategori">["data"];

/** ID kelompok efektif satu kategori: null untuk pemasukan, `LAINNYA` kalau kosong / tidak dikenal. */
export function kelompokIdDari(k: Pick<Kategori, "tipe" | "kelompok_id">, kelompok: ParsedRow<"KelompokKategori">[]): string | null {
  if (k.tipe !== "keluar") return null;
  return k.kelompok_id && kelompok.some((g) => g.data.id === k.kelompok_id) ? k.kelompok_id : LAINNYA.id;
}

export function urutKelompok(rows: ParsedRow<"KelompokKategori">[]): Kelompok[] {
  return rows.map((r) => r.data).sort((a, b) => (a.urutan ?? 0) - (b.urutan ?? 0) || a.nama.localeCompare(b.nama, "id"));
}

export interface PerKelompok {
  kelompokId: string;
  nama: string;
  total: number;
  jumlah: number;
  /** Rincian per sub kategori, urut total terbesar. */
  sub: PerKategori[];
}

/** Gabungkan pengeluaran per sub kategori ke kelompoknya. Urut total terbesar, "Lainnya" tetap ikut urutan total. */
export function perKelompok(items: PerKategori[], kategori: ParsedRow<"Kategori">[], kelompok: ParsedRow<"KelompokKategori">[]): PerKelompok[] {
  const kat = new Map(kategori.map((k) => [k.data.id, k.data]));
  const nama = new Map(kelompok.map((g) => [g.data.id, g.data.nama]));
  const map = new Map<string, PerKelompok>();
  for (const item of items) {
    const k = kat.get(item.kategoriId);
    const id = k ? (kelompokIdDari(k, kelompok) ?? LAINNYA.id) : LAINNYA.id;
    const g = map.get(id) ?? { kelompokId: id, nama: nama.get(id) ?? LAINNYA.nama, total: 0, jumlah: 0, sub: [] };
    g.total += item.total;
    g.jumlah += item.jumlah;
    g.sub.push(item);
    map.set(id, g);
  }
  return [...map.values()]
    .map((g) => ({ ...g, sub: [...g.sub].sort((a, b) => b.total - a.total) }))
    .sort((a, b) => b.total - a.total || a.nama.localeCompare(b.nama, "id"));
}

/** Tambah kelompok bawaan yang namanya belum ada (case-insensitive). Idempoten. Mengembalikan jumlah yang ditambah. */
export async function ensureKelompokBawaan(store: SheetStore, rows: ParsedRow<"KelompokKategori">[], by: string, clock: Clock): Promise<number> {
  const ada = new Set(rows.map((r) => r.data.nama.toLowerCase()));
  const taken: { data: { id: string } }[] = [...rows];
  let urutan = Math.max(0, ...rows.map((r) => r.data.urutan ?? 0));
  const append = [];
  for (const nama of KELOMPOK_BAWAAN) {
    if (ada.has(nama.toLowerCase())) continue;
    const id = newId("KelompokKategori", taken);
    taken.push({ data: { id } });
    append.push(newRow("KelompokKategori", { id, nama, urutan: ++urutan, aktif: true }, by, clock));
  }
  if (append.length) await store.append("KelompokKategori", append);
  return append.length;
}
