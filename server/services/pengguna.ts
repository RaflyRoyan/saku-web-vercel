import { z } from "zod";
import { passwordProblem } from "../auth/password.js";
import type { Clock } from "../common/clock.js";
import { AppError } from "../common/errors.js";
import { newId, newRow, rowsOf, updatedRow, type ParsedRow } from "../repositories/rows.js";
import type { Baris } from "../sheets/schema.js";
import type { RowUpdate, SheetData, SheetStore } from "../sheets/store.js";

// ---------- Schema body ----------

export const usernameSchema = z
  .string({ error: "Username wajib diisi." })
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._]{3,30}$/, { error: "Username 3–30 karakter: huruf kecil, angka, titik, atau garis bawah." });

export const namaSchema = z
  .string({ error: "Nama wajib diisi." })
  .trim()
  .min(1, { error: "Nama wajib diisi." })
  .max(50, { error: "Nama maksimal 50 karakter." });

export const passwordSchema = z.string({ error: "Password wajib diisi." }).superRefine((v, ctx) => {
  const problem = passwordProblem(v);
  if (problem) ctx.addIssue({ code: "custom", message: problem });
});

export const peranSchema = z.enum(["admin", "user"], { error: "Peran harus 'admin' atau 'user'." });

// ---------- Bentuk response ----------

export interface PenggunaDto {
  id: string;
  username: string;
  nama: string;
  peran: string;
  aktif: boolean;
  lastLogin: string | null;
}

/** `password_hash` dan kolom lockout tidak pernah dikirim. */
export function toDto(p: Pick<Baris<"Pengguna">, "id" | "username" | "nama" | "peran" | "aktif" | "last_login">): PenggunaDto {
  return { id: p.id, username: p.username, nama: p.nama, peran: p.peran, aktif: p.aktif, lastLogin: p.last_login };
}

// ---------- Operasi ----------

export function findByUsername(rows: ParsedRow<"Pengguna">[], username: string) {
  const u = username.trim().toLowerCase();
  return rows.find((r) => r.data.username.toLowerCase() === u);
}

export function assertUsernameFree(rows: ParsedRow<"Pengguna">[], username: string) {
  if (findByUsername(rows, username)) {
    throw new AppError(409, "Username sudah dipakai.", { username: ["Username sudah dipakai."] });
  }
}

/** Data pengguna baru (belum ditulis). `by` kosong = pengguna membuat dirinya sendiri (setup awal). */
export function buildPengguna(
  existing: ParsedRow<"Pengguna">[],
  input: { username: string; nama: string; peran: "admin" | "user"; passwordHash: string },
): Omit<Baris<"Pengguna">, "created_by" | "created_at" | "updated_by" | "updated_at"> {
  return {
    id: newId("Pengguna", existing),
    username: input.username,
    password_hash: input.passwordHash,
    nama: input.nama,
    peran: input.peran,
    aktif: true,
    last_login: null,
    versi_token: 1,
    gagal_login: 0,
    terkunci_sampai: null,
  };
}

const KATEGORI_SISTEM = [
  { kode: "BIAYA_ADMIN", nama: "Biaya Admin Bank", tipe: "keluar" },
  { kode: "TARIK_TABUNGAN", nama: "Tarik Tabungan", tipe: "masuk" },
] as const;

/**
 * Pastikan 2 kategori sistem ada di master `Kategori` (02 §2).
 * Kategori aktif dengan nama + tipe sama tapi tanpa kode diberi kode, supaya nama tidak dobel.
 */
export async function ensureKategoriSistem(
  store: SheetStore,
  kategoriData: SheetData,
  by: string,
  clock: Clock,
): Promise<void> {
  const rows = rowsOf({ Kategori: kategoriData }, "Kategori");
  const append: ReturnType<typeof newRow<"Kategori">>[] = [];
  const updates: RowUpdate[] = [];
  const used = [...rows];

  for (const sys of KATEGORI_SISTEM) {
    if (rows.some((r) => r.data.kode_sistem === sys.kode)) continue;
    const sameName = rows.find(
      (r) => r.data.aktif && r.data.kode_sistem === "" && r.data.tipe === sys.tipe && r.data.nama.toLowerCase() === sys.nama.toLowerCase(),
    );
    if (sameName) {
      updates.push({ sheet: "Kategori", row: sameName.row, values: updatedRow("Kategori", sameName.data, { kode_sistem: sys.kode }, by, clock) });
      continue;
    }
    const id = newId("Kategori", used);
    used.push({ row: 0, data: { id } as Baris<"Kategori"> });
    append.push(newRow("Kategori", { id, nama: sys.nama, tipe: sys.tipe, kode_sistem: sys.kode, aktif: true }, by, clock));
  }

  if (updates.length) await store.updateRows(updates);
  if (append.length) await store.append("Kategori", append);
}

/** Jumlah admin aktif kalau `override` diterapkan pada satu pengguna. */
export function countActiveAdmins(rows: ParsedRow<"Pengguna">[], override?: { id: string; peran: string; aktif: boolean }) {
  return rows.filter((r) => {
    const d = override && r.data.id === override.id ? override : r.data;
    return d.peran === "admin" && d.aktif;
  }).length;
}
