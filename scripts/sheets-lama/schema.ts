// Helper header & kolom spreadsheet lama. Hanya dipakai skrip migrasi dari Google Sheets.
import { SCHEMA, type NamaTabel } from "../../server/db/schema.js";

export { SCHEMA };
export type { Baris, TipeKolom } from "../../server/db/schema.js";
export type SheetName = NamaTabel;

export function headerOf(sheet: SheetName): string[] {
  return SCHEMA[sheet].map(([nama]) => nama);
}

/** Huruf kolom A, B, …, Z, AA, … dari indeks 0-based. */
export function columnLetter(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function lastColumn(sheet: SheetName): string {
  return columnLetter(SCHEMA[sheet].length - 1);
}

/** Bandingkan header baris 1 dengan schema. Kosong = cocok. */
export function validateHeader(sheet: SheetName, header: readonly string[]): string[] {
  const expected = headerOf(sheet);
  const actual = header.map((h) => h.trim());
  const masalah: string[] = [];
  const total = Math.max(expected.length, actual.length);
  for (let i = 0; i < total; i++) {
    const exp = expected[i];
    const act = actual[i] ?? "";
    const col = columnLetter(i);
    if (exp === undefined) {
      if (act !== "") masalah.push(`Kolom ${col} tidak dikenal: "${act}".`);
    } else if (act !== exp) {
      masalah.push(act === "" ? `Kolom ${col} harus "${exp}", tetapi kosong.` : `Kolom ${col} harus "${exp}", tetapi "${act}".`);
    }
  }
  return masalah;
}
