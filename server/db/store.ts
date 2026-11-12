import { toWibIso } from "../common/clock.js";
import { AppError, storageError } from "../common/errors.js";
import type { Sql, Tx } from "./client.js";
import { kolomOf, punyaUserId, SCHEMA, tabelDb, type Baris, type NamaTabel } from "./schema.js";

/** Satu baris hasil baca. */
export interface Row<S extends NamaTabel> {
  data: Baris<S>;
}

export type DataTabel<S extends NamaTabel> = { [K in S]: Row<K>[] };

/** Timpa satu baris (dicari dari `baris.id`). */
export type RowUpdate = { [S in NamaTabel]: { tabel: S; baris: Baris<S> } }[NamaTabel];

export type RowDelete = { tabel: NamaTabel; id: string };

/** Operasi tulis untuk `batch`, dijalankan berurutan dalam satu transaksi. */
export type Operasi =
  | ({ [S in NamaTabel]: { jenis: "insert"; tabel: S; baris: Baris<S>[] } }[NamaTabel])
  | ({ jenis: "update" } & RowUpdate)
  | ({ jenis: "delete" } & RowDelete);

export interface BacaOpsi {
  /**
   * Tabel per pengguna (yang punya `user_id`) hanya dibaca baris milik pengguna ini.
   * Tanpa `userId` = semua pengguna (mis. admin mengecek saldo akun di semua pengguna).
   * Master bersama & `Pengguna` selalu dibaca utuh.
   */
  userId?: string;
}

export interface Store {
  /** Baca beberapa tabel. Urutan baris = urutan insert. */
  read<S extends NamaTabel>(tabel: readonly S[], opsi?: BacaOpsi): Promise<DataTabel<S>>;
  append<S extends NamaTabel>(tabel: S, baris: readonly Baris<S>[]): Promise<void>;
  updateRow<S extends NamaTabel>(tabel: S, baris: Baris<S>): Promise<void>;
  /** Timpa banyak baris, boleh lintas tabel, dalam satu transaksi. */
  updateRows(updates: readonly RowUpdate[]): Promise<void>;
  deleteRow(tabel: NamaTabel, id: string): Promise<void>;
  /** Hapus banyak baris, boleh lintas tabel, dalam satu transaksi. */
  deleteRows(rows: readonly RowDelete[]): Promise<void>;
  /** Campuran insert/update/delete dalam satu transaksi: semua berhasil atau semua batal. */
  batch(ops: readonly Operasi[]): Promise<void>;
  /** Nama kolom per tabel di schema `public`, untuk health check. */
  kolomTabel(): Promise<Record<string, string[]>>;
}

type Nilai = string | number | boolean | null;

/** Nilai dari Postgres → bentuk `Baris` (sama seperti yang dipakai service sejak versi Sheets). */
export function dariDb<S extends NamaTabel>(tabel: S, row: Record<string, unknown>): Baris<S> {
  const obj: Record<string, Nilai> = {};
  for (const [nama, tipe] of SCHEMA[tabel]) {
    const v = row[nama];
    switch (tipe) {
      case "teks":
        obj[nama] = v == null ? "" : String(v);
        break;
      case "angka":
        obj[nama] = v == null ? null : Number(v);
        break;
      case "boolean":
        obj[nama] = v === true;
        break;
      case "tanggal":
        obj[nama] = v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
        break;
      case "bulan":
        obj[nama] = v == null ? null : String(v).trim();
        break;
      case "datetime":
        obj[nama] = v == null ? null : toWibIso(v instanceof Date ? v : new Date(String(v)));
        break;
    }
  }
  return obj as Baris<S>;
}

/** `Baris` → nilai kolom untuk insert/update. Teks kosong disimpan sebagai NULL. */
export function keDb<S extends NamaTabel>(tabel: S, baris: Baris<S>): Record<string, Nilai> {
  const record = baris as Record<string, Nilai | undefined>;
  const obj: Record<string, Nilai> = {};
  for (const [nama, tipe] of SCHEMA[tabel]) {
    const v = record[nama];
    obj[nama] = v === undefined || (tipe === "teks" && v === "") ? null : v;
  }
  return obj;
}

const MAKS_INSERT = 500;

export class PostgresStore implements Store {
  private sql: Sql;

  constructor(sql: Sql) {
    this.sql = sql;
  }

  async read<S extends NamaTabel>(tabel: readonly S[], opsi: BacaOpsi = {}): Promise<DataTabel<S>> {
    const sql = this.sql;
    const unik = [...new Set(tabel)];
    const hasil = await jalankan(() =>
      Promise.all(
        unik.map((t) => {
          const filter = opsi.userId && punyaUserId(t) ? sql`where user_id = ${opsi.userId}` : sql``;
          return sql`select * from ${sql(tabelDb(t))} ${filter} order by no`;
        }),
      ),
    );
    const data = {} as DataTabel<S>;
    unik.forEach((t, i) => {
      (data as Record<string, unknown>)[t] = hasil[i].map((r) => ({ data: dariDb(t, r) }));
    });
    return data;
  }

  append<S extends NamaTabel>(tabel: S, baris: readonly Baris<S>[]): Promise<void> {
    if (!baris.length) return Promise.resolve();
    return this.batch([{ jenis: "insert", tabel, baris: [...baris] } as Operasi]);
  }

  updateRow<S extends NamaTabel>(tabel: S, baris: Baris<S>): Promise<void> {
    return this.batch([{ jenis: "update", tabel, baris } as Operasi]);
  }

  updateRows(updates: readonly RowUpdate[]): Promise<void> {
    return this.batch(updates.map((u) => ({ jenis: "update", ...u }) as Operasi));
  }

  deleteRow(tabel: NamaTabel, id: string): Promise<void> {
    return this.batch([{ jenis: "delete", tabel, id }]);
  }

  deleteRows(rows: readonly RowDelete[]): Promise<void> {
    return this.batch(rows.map((r) => ({ jenis: "delete", ...r }) as Operasi));
  }

  async kolomTabel(): Promise<Record<string, string[]>> {
    const rows = await jalankan(
      () => this.sql`select table_name, column_name from information_schema.columns where table_schema = 'public' order by ordinal_position`,
    );
    const hasil: Record<string, string[]> = {};
    for (const r of rows) (hasil[String(r.table_name)] ??= []).push(String(r.column_name));
    return hasil;
  }

  async batch(ops: readonly Operasi[]): Promise<void> {
    if (!ops.length) return;
    await jalankan(() =>
      this.sql.begin(async (tx) => {
        for (const op of ops) await tulis(tx, op);
      }),
    );
  }
}

async function tulis(tx: Tx, op: Operasi): Promise<void> {
  const tabel = tx(tabelDb(op.tabel));
  if (op.jenis === "insert") {
    const kolom = kolomOf(op.tabel);
    const rows = op.baris.map((b) => keDb(op.tabel, b as never));
    for (let i = 0; i < rows.length; i += MAKS_INSERT) {
      await tx`insert into ${tabel} ${tx(rows.slice(i, i + MAKS_INSERT), kolom)}`;
    }
    return;
  }
  if (op.jenis === "update") {
    const nilai = keDb(op.tabel, op.baris as never);
    const kolom = kolomOf(op.tabel).filter((k) => k !== "id");
    await tx`update ${tabel} set ${tx(nilai, kolom)} where id = ${op.baris.id}`;
    return;
  }
  await tx`delete from ${tabel} where id = ${op.id}`;
}

/** Error database → 502 tanpa detail ke client (sama seperti saat Google Sheets gagal). */
async function jalankan<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AppError) throw err;
    const code = (err as { code?: unknown }).code;
    console.error("Database gagal:", typeof code === "string" ? code : "", err instanceof Error ? err.message : String(err));
    throw storageError();
  }
}
