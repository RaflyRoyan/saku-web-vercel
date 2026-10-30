import type { SheetName } from "./schema.js";

/** Nilai mentah satu sel, seperti dikembalikan Sheets API (UNFORMATTED_VALUE). */
export type CellValue = string | number | boolean;

export interface RawRow {
  /** Nomor baris di sheet (1-based, header = baris 1). */
  row: number;
  values: CellValue[];
}

export interface SheetData {
  /** Isi baris 1 apa adanya. */
  header: string[];
  /** Baris data mulai baris 2. Baris yang seluruhnya kosong tidak ikut. */
  rows: RawRow[];
}

export interface RowUpdate {
  sheet: SheetName;
  row: number;
  values: CellValue[];
}

export interface SheetStore {
  /** Baca beberapa sheet sekaligus (satu `values:batchGet`). */
  readMany<S extends SheetName>(sheets: readonly S[]): Promise<Record<S, SheetData>>;
  /** Tambah baris baru di akhir sheet. */
  append(sheet: SheetName, rows: CellValue[][]): Promise<void>;
  /** Timpa satu baris (kolom A sampai kolom terakhir schema). */
  updateRow(sheet: SheetName, row: number, values: CellValue[]): Promise<void>;
  /** Timpa banyak baris, boleh lintas sheet (satu `values:batchUpdate`). */
  updateRows(updates: readonly RowUpdate[]): Promise<void>;
  /** Hapus satu baris; baris di bawahnya naik satu. */
  deleteRow(sheet: SheetName, row: number): Promise<void>;
}

/** Sheet yang diminta tidak ada di spreadsheet. */
export class SheetMissingError extends Error {
  sheets: SheetName[];

  constructor(sheets: SheetName[]) {
    super(`Sheet tidak ditemukan: ${sheets.join(", ")}`);
    this.name = "SheetMissingError";
    this.sheets = sheets;
  }
}
