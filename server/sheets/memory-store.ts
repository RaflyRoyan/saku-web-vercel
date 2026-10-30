import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { headerOf, SHEET_NAMES, type SheetName } from "./schema.js";
import { SheetMissingError, type CellValue, type RowUpdate, type SheetData, type SheetStore } from "./store.js";

type Grid = CellValue[][];

/** Store di memori untuk test dan dev lokal. `grids[sheet][0]` = header. */
export class MemorySheetStore implements SheetStore {
  private grids = new Map<SheetName, Grid>();

  /** Tanpa argumen: semua sheet dibuat dengan header sesuai schema. */
  constructor(initial?: Partial<Record<SheetName, Grid>>) {
    if (initial) {
      for (const [sheet, grid] of Object.entries(initial) as [SheetName, Grid][]) {
        this.grids.set(sheet, grid.map((r) => [...r]));
      }
    } else {
      for (const sheet of SHEET_NAMES) this.grids.set(sheet, [headerOf(sheet)]);
    }
  }

  async readMany<S extends SheetName>(sheets: readonly S[]): Promise<Record<S, SheetData>> {
    const missing = sheets.filter((s) => !this.grids.has(s));
    if (missing.length) throw new SheetMissingError(missing);

    const result = {} as Record<S, SheetData>;
    for (const sheet of sheets) {
      const [header = [], ...rest] = this.grid(sheet);
      result[sheet] = {
        header: header.map(String),
        rows: rest
          .map((values, i) => ({ row: i + 2, values: [...values] }))
          .filter((r) => r.values.some((v) => v !== "")),
      };
    }
    return result;
  }

  async append(sheet: SheetName, rows: CellValue[][]): Promise<void> {
    this.grid(sheet).push(...rows.map((r) => [...r]));
  }

  async updateRow(sheet: SheetName, row: number, values: CellValue[]): Promise<void> {
    this.set(sheet, row, values);
  }

  async updateRows(updates: readonly RowUpdate[]): Promise<void> {
    for (const u of updates) this.set(u.sheet, u.row, u.values);
  }

  async deleteRow(sheet: SheetName, row: number): Promise<void> {
    this.checkRow(sheet, row);
    this.grid(sheet).splice(row - 1, 1);
  }

  /** Salinan semua sheet (untuk FileSheetStore). */
  dump(): Partial<Record<SheetName, Grid>> {
    return Object.fromEntries([...this.grids].map(([k, g]) => [k, g.map((r) => [...r])]));
  }

  private grid(sheet: SheetName): Grid {
    const grid = this.grids.get(sheet);
    if (!grid) throw new SheetMissingError([sheet]);
    return grid;
  }

  private set(sheet: SheetName, row: number, values: CellValue[]) {
    this.checkRow(sheet, row);
    this.grid(sheet)[row - 1] = [...values];
  }

  private checkRow(sheet: SheetName, row: number) {
    if (!Number.isInteger(row) || row < 2 || row > this.grid(sheet).length) {
      throw new Error(`Baris ${row} tidak ada di sheet ${sheet}.`);
    }
  }
}

/**
 * Memory store yang disimpan ke file JSON, untuk `SHEETS_MODE=memory` di dev lokal
 * (data tetap ada walau modul server dimuat ulang oleh Vite saat file diubah).
 */
export class FileSheetStore implements SheetStore {
  private file: string;

  constructor(file: string) {
    this.file = file;
  }

  private load(): MemorySheetStore {
    try {
      return new MemorySheetStore(JSON.parse(readFileSync(this.file, "utf8")) as Partial<Record<SheetName, Grid>>);
    } catch {
      return new MemorySheetStore();
    }
  }

  private async mutate(fn: (store: MemorySheetStore) => Promise<void>) {
    const store = this.load();
    await fn(store);
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(store.dump()));
  }

  readMany<S extends SheetName>(sheets: readonly S[]) {
    return this.load().readMany(sheets);
  }

  append(sheet: SheetName, rows: CellValue[][]) {
    return this.mutate((s) => s.append(sheet, rows));
  }

  updateRow(sheet: SheetName, row: number, values: CellValue[]) {
    return this.mutate((s) => s.updateRow(sheet, row, values));
  }

  updateRows(updates: readonly RowUpdate[]) {
    return this.mutate((s) => s.updateRows(updates));
  }

  deleteRow(sheet: SheetName, row: number) {
    return this.mutate((s) => s.deleteRow(sheet, row));
  }
}
