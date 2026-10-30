// Parser toleran untuk nilai dari Sheets (spec §5.1 butir 5–6) dan serializer untuk menulis.
// Nilai bisa diketik manual di spreadsheet, jadi format masukan dibuat longgar.

import { toWibDate, toWibIso } from "../common/clock.js";
import { SCHEMA, type Baris, type SheetName, type TipeKolom } from "./schema.js";
import type { CellValue, SheetData } from "./store.js";

type Nilai = string | number | boolean | null;

const MS_PER_DAY = 86_400_000;
const SERIAL_EPOCH_MS = Date.UTC(1899, 11, 30); // serial 0 di Google Sheets
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

const pad = (n: number) => String(n).padStart(2, "0");

/** Instant dari serial number, dengan asumsi spreadsheet ber-zona WIB. */
function serialToDate(serial: number): Date {
  return new Date(Math.round(SERIAL_EPOCH_MS + serial * MS_PER_DAY - WIB_OFFSET_MS));
}

function isValidYmd(y: number, m: number, d: number): boolean {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function parseTeks(v: CellValue | undefined): string {
  return v === undefined ? "" : String(v).trim();
}

/** Number, `"1500000"`, `"1.500.000"`, `"Rp 1.500.000"`, `"-25.000"`, `"1.500,50"`. Kosong/rusak → null. */
export function parseAngka(v: CellValue | undefined): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  let s = v.trim().replace(/^rp\.?/i, "").replace(/\s/g, "");
  if (s === "") return null;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s) || /^-?\d+,\d+$/.test(s)) {
    // Format Indonesia: titik = ribuan, koma = desimal
    s = s.replace(/\./g, "").replace(",", ".");
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

/** `true`, `"TRUE"`, `"true"` → true. Selain itu false. */
export function parseBoolean(v: CellValue | undefined): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v.trim().toLowerCase() === "true";
  return false;
}

/** Teks `yyyy-MM-dd` / `d/M/yyyy` atau serial number → `yyyy-MM-dd`. */
export function parseTanggal(v: CellValue | undefined): string | null {
  if (typeof v === "number") return Number.isFinite(v) ? toWibDate(serialToDate(Math.floor(v))) : null;
  if (typeof v !== "string") return null;
  const s = v.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return isValidYmd(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : null;
  }
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) {
    const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return isValidYmd(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : null;
  }
  return null;
}

/** Teks `yyyy-MM` (atau tanggal lengkap) atau serial number → `yyyy-MM`. */
export function parseBulan(v: CellValue | undefined): string | null {
  if (typeof v === "string") {
    const m = /^(\d{4})-(\d{1,2})$/.exec(v.trim());
    if (m) {
      const mo = Number(m[2]);
      return mo >= 1 && mo <= 12 ? `${m[1]}-${pad(mo)}` : null;
    }
  }
  return parseTanggal(v)?.slice(0, 7) ?? null;
}

/** ISO 8601 (dengan atau tanpa offset; tanpa offset = WIB) atau serial number → ISO offset `+07:00`. */
export function parseDatetime(v: CellValue | undefined): string | null {
  if (typeof v === "number") return Number.isFinite(v) ? toWibIso(serialToDate(v)) : null;
  if (typeof v !== "string") return null;
  let s = v.trim();
  if (s === "") return null;
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?))?(Z|[+-]\d{2}:?\d{2})?$/i.exec(s);
  if (!m) return null;
  if (!m[3]) s = `${m[1]}T${m[2] ?? "00:00:00"}+07:00`;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : toWibIso(new Date(t));
}

const PARSERS: Record<TipeKolom, (v: CellValue | undefined) => Nilai> = {
  teks: parseTeks,
  angka: parseAngka,
  boolean: parseBoolean,
  tanggal: parseTanggal,
  bulan: parseBulan,
  datetime: parseDatetime,
};

export interface ParsedRow<S extends SheetName> {
  /** Nomor baris di sheet, dipakai untuk update/hapus. */
  row: number;
  data: Baris<S>;
}

/** Ubah baris mentah jadi objek per kolom. Baris yang `id`-nya kosong dilewati. */
export function parseRows<S extends SheetName>(sheet: S, data: SheetData): ParsedRow<S>[] {
  const columns = SCHEMA[sheet];
  const result: ParsedRow<S>[] = [];
  for (const raw of data.rows) {
    if (parseTeks(raw.values[0]) === "") continue;
    const obj: Record<string, Nilai> = {};
    columns.forEach(([nama, tipe], i) => {
      obj[nama] = PARSERS[tipe](raw.values[i]);
    });
    result.push({ row: raw.row, data: obj as Baris<S> });
  }
  return result;
}

/** Ubah objek jadi nilai sel sesuai urutan kolom (untuk `valueInputOption=RAW`). */
export function toRow<S extends SheetName>(sheet: S, data: Baris<S>): CellValue[] {
  const record = data as Record<string, Nilai>;
  return SCHEMA[sheet].map(([nama, tipe]) => {
    const v = record[nama];
    if (v === null || v === undefined) return "";
    if (tipe === "boolean") return v === true;
    return v;
  });
}
