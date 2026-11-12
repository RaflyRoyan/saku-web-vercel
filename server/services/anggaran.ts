import type { Clock } from "../common/clock.js";
import { validationError, type FieldErrors } from "../common/errors.js";
import { formatRupiah } from "../common/format.js";
import { newId, newRow, type Row } from "../repositories/rows.js";
import type { Baris } from "../db/schema.js";
import { kelompokIdDari, LAINNYA, urutKelompok } from "./kelompok.js";

export type StatusAnggaran = "aman" | "hampir" | "lewat";

/** Terpakai ≥ 80% anggaran = "hampir". */
export const BATAS_HAMPIR = 80;

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
  /** Batas yang diisi untuk kategori induk ini. null = `anggaran` dihitung dari jumlah sub kategorinya. */
  anggaranSendiri: number | null;
  sub: AnggaranSub[];
}

export interface AnggaranPeriode {
  periodeId: string;
  /** Ada minimal satu batas di periode ini. */
  ada: boolean;
  /** Total anggaran semua kategori induk vs seluruh pengeluaran periode. */
  total: PosAnggaran;
  kelompok: AnggaranKelompok[];
}

type Anggaran = Row<"Anggaran">;
type Kategori = Row<"Kategori">;
type Kelompok = Row<"KelompokKategori">;

export function pos(anggaran: number | null, terpakai: number): PosAnggaran {
  if (!anggaran || anggaran <= 0) return { anggaran: null, terpakai, sisa: null, persen: null, status: null };
  const persen = Math.round((terpakai / anggaran) * 100);
  const status: StatusAnggaran = terpakai > anggaran ? "lewat" : persen >= BATAS_HAMPIR ? "hampir" : "aman";
  return { anggaran, terpakai, sisa: anggaran - terpakai, persen, status };
}

export const anggaranMilik = (rows: Anggaran[], userId: string, periodeId: string) =>
  rows.filter((r) => r.data.user_id === userId && r.data.periode_id === periodeId);

/** Pengeluaran per sub kategori di satu periode: keluar + biaya admin transfer (kategori BIAYA_ADMIN), sama dengan ringkasan. */
export function terpakaiPerKategori(periodeId: string, userId: string, transaksi: Row<"Transaksi">[], kategori: Kategori[]): Map<string, number> {
  const biayaAdminId = kategori.find((k) => k.data.kode_sistem === "BIAYA_ADMIN")?.data.id ?? "BIAYA_ADMIN";
  // Setor langsung ke tabungan bukan pengeluaran
  const setorId = kategori.find((k) => k.data.kode_sistem === "SETOR_TABUNGAN")?.data.id;
  const map = new Map<string, number>();
  const add = (id: string, n: number) => map.set(id, (map.get(id) ?? 0) + n);
  for (const { data: t } of transaksi) {
    if (t.user_id !== userId || t.periode_id !== periodeId) continue;
    if (t.tipe === "keluar") {
      if (t.kategori_id !== setorId) add(t.kategori_id, t.nominal ?? 0);
    } else if (t.tipe === "transfer" && (t.biaya_admin ?? 0) > 0) add(biayaAdminId, t.biaya_admin ?? 0);
  }
  return map;
}

/**
 * Anggaran vs realisasi satu periode. Kategori induk tampil kalau punya batas (sendiri atau dari sub) atau ada pengeluaran.
 * Batas induk = batas sendiri, atau jumlah batas sub kategorinya kalau tidak diisi.
 */
export function hitungAnggaran(
  periodeId: string,
  userId: string,
  anggaran: Anggaran[],
  kategori: Kategori[],
  kelompok: Kelompok[],
  transaksi: Row<"Transaksi">[],
): AnggaranPeriode {
  const milik = anggaranMilik(anggaran, userId, periodeId);
  const batasKelompok = new Map<string, number>();
  const batasSub = new Map<string, number>();
  for (const { data: a } of milik) {
    if (a.kategori_id) batasSub.set(a.kategori_id, a.nominal ?? 0);
    else if (a.kelompok_id) batasKelompok.set(a.kelompok_id, a.nominal ?? 0);
  }
  const terpakai = terpakaiPerKategori(periodeId, userId, transaksi, kategori);
  const kat = new Map(kategori.map((k) => [k.data.id, k.data]));

  // Sub kategori per kelompok: yang dianggarkan atau ada pengeluaran
  const subPer = new Map<string, AnggaranSub[]>();
  for (const id of new Set([...batasSub.keys(), ...terpakai.keys()])) {
    const k = kat.get(id);
    if (k && k.tipe !== "keluar") continue;
    const kelompokId = k ? (kelompokIdDari(k, kelompok) ?? LAINNYA.id) : LAINNYA.id;
    const list = subPer.get(kelompokId) ?? [];
    list.push({ kategoriId: id, nama: k?.nama ?? (id === "BIAYA_ADMIN" ? "Biaya Admin Bank" : "(kategori dihapus)"), ...pos(batasSub.get(id) ?? null, terpakai.get(id) ?? 0) });
    subPer.set(kelompokId, list);
  }

  const urutan = [...urutKelompok(kelompok).map((g) => ({ id: g.id, nama: g.nama })), LAINNYA];
  const hasil: AnggaranKelompok[] = [];
  for (const g of urutan) {
    const sub = (subPer.get(g.id) ?? []).sort((a, b) => b.terpakai - a.terpakai || a.nama.localeCompare(b.nama, "id"));
    const sendiri = batasKelompok.get(g.id) ?? null;
    const dariSub = sub.reduce((n, s) => n + (s.anggaran ?? 0), 0);
    const total = sub.reduce((n, s) => n + s.terpakai, 0);
    if (!sendiri && !dariSub && !total) continue;
    hasil.push({ kelompokId: g.id, nama: g.nama, anggaranSendiri: sendiri, sub, ...pos(sendiri ?? (dariSub || null), total) });
  }

  const totalAnggaran = hasil.reduce((n, g) => n + (g.anggaran ?? 0), 0);
  const totalTerpakai = hasil.reduce((n, g) => n + g.terpakai, 0);
  return { periodeId, ada: milik.length > 0, total: pos(totalAnggaran || null, totalTerpakai), kelompok: hasil };
}

/** Peringatan kalau transaksi pengeluaran ini membuat (atau masih) melewati anggaran sub kategori / kategori induknya. Tidak memblokir. */
export function peringatanAnggaran(
  t: Row<"Transaksi">["data"],
  anggaran: Anggaran[],
  kategori: Kategori[],
  kelompok: Kelompok[],
  transaksi: Row<"Transaksi">[],
): string[] {
  let kategoriId: string | undefined;
  if (t.tipe === "keluar") kategoriId = t.kategori_id;
  else if (t.tipe === "transfer" && (t.biaya_admin ?? 0) > 0) kategoriId = kategori.find((k) => k.data.kode_sistem === "BIAYA_ADMIN")?.data.id;
  if (!kategoriId || !anggaranMilik(anggaran, t.user_id, t.periode_id).length) return [];

  const hasil = hitungAnggaran(t.periode_id, t.user_id, anggaran, kategori, kelompok, transaksi);
  const pesan = (label: string, p: PosAnggaran) =>
    `Anggaran ${label} terlewati ${formatRupiah(-(p.sisa ?? 0))} (terpakai ${formatRupiah(p.terpakai)} dari ${formatRupiah(p.anggaran ?? 0)}).`;
  const out: string[] = [];
  for (const g of hasil.kelompok) {
    const s = g.sub.find((x) => x.kategoriId === kategoriId);
    if (!s) continue;
    if (s.status === "lewat") out.push(pesan(s.nama, s));
    if (g.status === "lewat") out.push(pesan(`kategori ${g.nama}`, g));
  }
  return out;
}

export interface ItemAnggaran {
  kelompokId?: string;
  kategoriId?: string;
  nominal: number;
}

/**
 * Validasi isi anggaran: tepat satu dari kelompokId/kategoriId, sub kategori harus pengeluaran, tidak dobel,
 * dan jumlah batas sub kategori tidak melebihi batas kategori induknya.
 * `lama` = baris anggaran periode ini sebelum diubah: kategori/kelompok yang sudah ada tetap boleh walau nonaktif.
 */
export function cekAnggaran(items: ItemAnggaran[], kategori: Kategori[], kelompok: Kelompok[], lama: Anggaran[]) {
  const errors: FieldErrors = {};
  const sudahSub = new Set(lama.map((r) => r.data.kategori_id).filter(Boolean));
  const sudahKelompok = new Set(lama.map((r) => r.data.kelompok_id).filter(Boolean));
  const seen = new Set<string>();
  const batasKelompok = new Map<string, number>();
  const jumlahSub = new Map<string, number>();

  items.forEach((item, i) => {
    if (Boolean(item.kelompokId) === Boolean(item.kategoriId)) {
      errors[`items.${i}`] = ["Pilih salah satu: kategori atau sub kategori."];
      return;
    }
    if (item.kategoriId) {
      const key = `items.${i}.kategoriId`;
      const k = kategori.find((r) => r.data.id === item.kategoriId)?.data;
      if (!k) errors[key] = ["Sub kategori tidak ditemukan."];
      else if (k.tipe !== "keluar") errors[key] = [`${k.nama} bukan kategori pengeluaran.`];
      else if (!k.aktif && !sudahSub.has(k.id)) errors[key] = [`Sub kategori ${k.nama} nonaktif dan tidak bisa dipakai.`];
      else if (seen.has(`k:${k.id}`)) errors[key] = [`Sub kategori ${k.nama} dobel.`];
      else {
        const g = kelompokIdDari(k, kelompok) ?? LAINNYA.id;
        jumlahSub.set(g, (jumlahSub.get(g) ?? 0) + item.nominal);
      }
      seen.add(`k:${item.kategoriId}`);
    } else if (item.kelompokId) {
      const key = `items.${i}.kelompokId`;
      const g = item.kelompokId === LAINNYA.id ? { ...LAINNYA, aktif: true } : kelompok.find((r) => r.data.id === item.kelompokId)?.data;
      if (!g) errors[key] = ["Kategori tidak ditemukan."];
      else if (!g.aktif && !sudahKelompok.has(g.id)) errors[key] = [`Kategori ${g.nama} nonaktif dan tidak bisa dipakai.`];
      else if (seen.has(`g:${g.id}`)) errors[key] = [`Kategori ${g.nama} dobel.`];
      else batasKelompok.set(g.id, item.nominal);
      seen.add(`g:${item.kelompokId}`);
    }
  });

  items.forEach((item, i) => {
    if (!item.kelompokId || item.nominal <= 0 || errors[`items.${i}.kelompokId`]) return;
    const sub = jumlahSub.get(item.kelompokId) ?? 0;
    if (sub > item.nominal) {
      const nama = item.kelompokId === LAINNYA.id ? LAINNYA.nama : (kelompok.find((r) => r.data.id === item.kelompokId)?.data.nama ?? "");
      errors[`items.${i}.nominal`] = [`Jumlah anggaran sub kategori ${nama} (${formatRupiah(sub)}) melebihi anggaran kategorinya (${formatRupiah(item.nominal)}).`];
    }
  });
  if (Object.keys(errors).length) throw validationError(errors);
}

/** Baris anggaran baru untuk periode `keId`, disalin dari periode `dariId` (hanya kategori/kelompok yang masih aktif). */
export function salinAnggaran(
  anggaran: Anggaran[],
  userId: string,
  dariId: string,
  keId: string,
  kategori: Kategori[],
  kelompok: Kelompok[],
  clock: Clock,
): Baris<"Anggaran">[] {
  const katAktif = new Set(kategori.filter((k) => k.data.aktif && k.data.tipe === "keluar").map((k) => k.data.id));
  const kelAktif = new Set([LAINNYA.id, ...kelompok.filter((g) => g.data.aktif).map((g) => g.data.id)]);
  const taken: { data: { id: string } }[] = [...anggaran];
  const rows: Baris<"Anggaran">[] = [];
  for (const { data: a } of anggaranMilik(anggaran, userId, dariId)) {
    if ((a.nominal ?? 0) <= 0) continue;
    if (a.kategori_id ? !katAktif.has(a.kategori_id) : !kelAktif.has(a.kelompok_id)) continue;
    const id = newId("Anggaran", taken);
    taken.push({ data: { id } });
    rows.push(newRow("Anggaran", { id, user_id: userId, periode_id: keId, kelompok_id: a.kelompok_id, kategori_id: a.kategori_id, nominal: a.nominal }, userId, clock));
  }
  return rows;
}
