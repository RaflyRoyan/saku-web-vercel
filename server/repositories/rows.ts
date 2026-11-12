import { nowWibIso, type Clock } from "../common/clock.js";
import { AppError } from "../common/errors.js";
import { generateId } from "../common/id.js";
import { ID_PREFIX, type Baris, type NamaTabel } from "../db/schema.js";
import type { DataTabel, Row } from "../db/store.js";

export type { Row };

export function rowsOf<S extends NamaTabel>(data: DataTabel<S>, tabel: S): Row<S>[] {
  return data[tabel];
}

/** ID baru dengan prefix tabel, unik terhadap `existing`. Primary key di Postgres tetap jadi penjaga terakhir. */
export function newId(tabel: keyof typeof ID_PREFIX, existing: Iterable<{ data: { id: string } }>): string {
  const taken = new Set<string>();
  for (const r of existing) taken.add(r.data.id);
  return generateId(ID_PREFIX[tabel], (id) => taken.has(id));
}

type Audit = "created_by" | "created_at" | "updated_by" | "updated_at";

/** Baris baru dengan kolom audit terisi. */
export function newRow<S extends NamaTabel>(
  _tabel: S,
  data: Omit<Baris<S>, Audit>,
  by: string,
  clock: Clock,
): Baris<S> {
  return { ...data, created_by: by, created_at: nowWibIso(clock), updated_by: "", updated_at: null } as unknown as Baris<S>;
}

/** Baris lama + perubahan, dengan `updated_by/at` terisi. */
export function updatedRow<S extends NamaTabel>(
  _tabel: S,
  current: Baris<S>,
  changes: Partial<Omit<Baris<S>, Audit>>,
  by: string,
  clock: Clock,
): Baris<S> {
  return { ...current, ...changes, updated_by: by, updated_at: nowWibIso(clock) } as unknown as Baris<S>;
}

export function notFound(): AppError {
  return new AppError(404, "Data tidak ditemukan.");
}

/** Cari baris milik `userId`. ID milik pengguna lain → 404, bukan 403 (spec §5.1 butir 3). */
export function findOwned<S extends NamaTabel>(
  rows: Row<S>[],
  id: string,
  userId: string,
): Row<S> {
  const found = rows.find((r) => {
    const d = r.data as unknown as { id: string; user_id?: string };
    return d.id === id && d.user_id === userId;
  });
  if (!found) throw notFound();
  return found;
}
