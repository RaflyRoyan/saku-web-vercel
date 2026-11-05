import type { Split, SplitInput } from "../../hooks/useSplit";

/** State wizard split bill. Peserta indeks 0 = "Saya". */
export interface FormSplit extends SplitInput {
  /** Total tertulis di struk hasil OCR, untuk dibandingkan dengan hasil hitung. */
  totalStruk: number | null;
  /** ID peserta yang sudah lunas (mode edit): tidak boleh dihapus, server menolak dengan 422. */
  lunasIds: string[];
}

export const formBaru = (tanggal: string): FormSplit => ({
  nama: "",
  tanggal,
  akunId: "",
  kategoriId: "",
  akunTerimaId: "",
  pajak: 0,
  servis: 0,
  diskon: 0,
  peserta: [{ nama: "Saya", saya: true }],
  items: [],
  totalStruk: null,
  lunasIds: [],
});

export function dariSplit(s: Split): FormSplit {
  const indeks = new Map(s.peserta.map((p, i) => [p.id, i]));
  return {
    nama: s.nama,
    tanggal: s.tanggal,
    akunId: s.akunId,
    kategoriId: s.kategoriId,
    akunTerimaId: s.akunTerimaId,
    pajak: s.pajak,
    servis: s.servis,
    diskon: s.diskon,
    peserta: s.peserta.map((p) => ({ id: p.id, nama: p.nama, saya: p.saya })),
    items: s.items.map((it) => ({ nama: it.nama, qty: it.qty, harga: it.harga, peserta: it.peserta.map((id) => indeks.get(id) ?? -1).filter((i) => i >= 0) })),
    totalStruk: null,
    lunasIds: s.peserta.filter((p) => p.lunas && !p.saya).map((p) => p.id),
  };
}

export type SetForm = (fn: (f: FormSplit) => FormSplit) => void;

/** Error server → langkah wizard yang memuat field-nya. */
export function langkahUntuk(field: string): 1 | 2 | 3 {
  if (field.startsWith("items") || ["pajak", "servis", "diskon"].includes(field)) return 1;
  if (field.startsWith("peserta")) return 2;
  return 3;
}
