import { nowWibIso, type Clock } from "../common/clock.js";
import { AppError } from "../common/errors.js";
import { generateId } from "../common/id.js";
import { parseRows, toRow, type ParsedRow } from "../sheets/parse.js";
import { ID_PREFIX, type Baris, type SheetName } from "../sheets/schema.js";
import type { CellValue, SheetData } from "../sheets/store.js";

export type { ParsedRow };

export function rowsOf<S extends SheetName>(data: Record<S, SheetData>, sheet: S): ParsedRow<S>[] {
  return parseRows(sheet, data[sheet]);
}

/** ID baru dengan prefix sheet, unik terhadap `existing`. */
export function newId(sheet: keyof typeof ID_PREFIX, existing: Iterable<{ data: { id: string } }>): string {
  const taken = new Set<string>();
  for (const r of existing) taken.add(r.data.id);
  return generateId(ID_PREFIX[sheet], (id) => taken.has(id));
}

type Audit = "created_by" | "created_at" | "updated_by" | "updated_at";

/** Baris baru dengan kolom audit terisi. */
export function newRow<S extends SheetName>(
  sheet: S,
  data: Omit<Baris<S>, Audit>,
  by: string,
  clock: Clock,
): CellValue[] {
  const full = { ...data, created_by: by, created_at: nowWibIso(clock), updated_by: "", updated_at: null } as unknown as Baris<S>;
  return toRow(sheet, full);
}

/** Baris lama + perubahan, dengan `updated_by/at` terisi. */
export function updatedRow<S extends SheetName>(
  sheet: S,
  current: Baris<S>,
  changes: Partial<Omit<Baris<S>, Audit>>,
  by: string,
  clock: Clock,
): CellValue[] {
  const full = { ...current, ...changes, updated_by: by, updated_at: nowWibIso(clock) } as unknown as Baris<S>;
  return toRow(sheet, full);
}

export function notFound(): AppError {
  return new AppError(404, "Data tidak ditemukan.");
}

/** Cari baris milik `userId`. ID milik pengguna lain → 404, bukan 403 (spec §5.1 butir 3). */
export function findOwned<S extends SheetName>(
  rows: ParsedRow<S>[],
  id: string,
  userId: string,
): ParsedRow<S> {
  const found = rows.find((r) => {
    const d = r.data as unknown as { id: string; user_id?: string };
    return d.id === id && d.user_id === userId;
  });
  if (!found) throw notFound();
  return found;
}
