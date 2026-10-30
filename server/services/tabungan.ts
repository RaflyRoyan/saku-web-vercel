import type { Clock } from "../common/clock.js";
import { newId, newRow, updatedRow, type ParsedRow } from "../repositories/rows.js";
import type { CellValue, RowUpdate, SheetStore } from "../sheets/store.js";
import { saldoPerAkun } from "./saldo.js";

export interface SetorPlan {
  /** Baris setor yang sudah ada dan nilainya berubah. */
  updates: RowUpdate[];
  /** Baris setor baru untuk sheet `Tabungan`. */
  appends: CellValue[][];
  setor: { akunId: string; nominal: number }[];
}

/**
 * Upsert baris Tabungan `setor` untuk periode tertutup (spec §7.4 langkah 2, §7.5):
 * satu baris per akun yang punya saldo awal atau transaksi di periode itu, nominal = saldo akhir.
 * Baris setor lama yang akunnya sudah tidak punya data di-nol-kan, bukan dihapus. Tidak pernah ada setor ganda.
 */
export function rencanaSetor(
  periode: ParsedRow<"Periode">["data"],
  saldoAwal: ParsedRow<"SaldoAwal">[],
  transaksi: ParsedRow<"Transaksi">[],
  tabungan: ParsedRow<"Tabungan">[],
  by: string,
  clock: Clock,
): SetorPlan {
  const tanggal = periode.tanggal_selesai ?? "";
  const keterangan = `Sisa ${periode.nama}`;
  const saldo = saldoPerAkun(periode.id, saldoAwal, transaksi);
  const existing = tabungan.filter(
    (t) => t.data.user_id === periode.user_id && t.data.jenis === "setor" && t.data.periode_id === periode.id,
  );
  for (const t of existing) if (!saldo.has(t.data.akun_id)) saldo.set(t.data.akun_id, 0);

  const plan: SetorPlan = { updates: [], appends: [], setor: [] };
  const taken = [...tabungan];
  for (const [akunId, nominal] of saldo) {
    plan.setor.push({ akunId, nominal });
    const first = existing.find((t) => t.data.akun_id === akunId);
    if (first) {
      const d = first.data;
      if (d.nominal !== nominal || d.tanggal !== tanggal || d.keterangan !== keterangan) {
        plan.updates.push({
          sheet: "Tabungan",
          row: first.row,
          values: updatedRow("Tabungan", d, { nominal, tanggal, keterangan }, by, clock),
        });
      }
    } else {
      const id = newId("Tabungan", taken);
      taken.push({ row: 0, data: { id } as ParsedRow<"Tabungan">["data"] });
      plan.appends.push(
        newRow(
          "Tabungan",
          { id, user_id: periode.user_id, tanggal, jenis: "setor", periode_id: periode.id, akun_id: akunId, nominal, keterangan, transaksi_id: "" },
          by,
          clock,
        ),
      );
    }
  }
  return plan;
}

/** Saldo tabungan pengguna: Σ setor − Σ tarik. */
export function totalTabungan(tabungan: ParsedRow<"Tabungan">[], userId: string): number {
  let total = 0;
  for (const { data: t } of tabungan) {
    if (t.user_id !== userId) continue;
    if (t.jenis === "setor") total += t.nominal ?? 0;
    else if (t.jenis === "tarik") total -= t.nominal ?? 0;
  }
  return total;
}

/**
 * Hitung ulang setor untuk periode tertutup yang terdampak perubahan (spec §7.5).
 * Bisa 2 periode kalau transaksi pindah periode. `saldoAwal`/`transaksi` = isi sheet setelah perubahan.
 */
export function rencanaSetorTerdampak(
  periodeIds: string[],
  periode: ParsedRow<"Periode">[],
  saldoAwal: ParsedRow<"SaldoAwal">[],
  transaksi: ParsedRow<"Transaksi">[],
  tabungan: ParsedRow<"Tabungan">[],
  by: string,
  clock: Clock,
): Omit<SetorPlan, "setor"> {
  const updates: RowUpdate[] = [];
  const appends: CellValue[][] = [];
  for (const id of new Set(periodeIds)) {
    const p = periode.find((r) => r.data.id === id)?.data;
    if (!p?.tanggal_selesai) continue;
    const plan = rencanaSetor(p, saldoAwal, transaksi, tabungan, by, clock);
    updates.push(...plan.updates);
    appends.push(...plan.appends);
  }
  return { updates, appends };
}

/** Tulis hasil rencana setor: update baris lama lalu append baris baru. */
export async function simpanSetor(store: SheetStore, plan: Omit<SetorPlan, "setor">, extraUpdates: RowUpdate[] = []) {
  const updates = [...extraUpdates, ...plan.updates];
  if (updates.length) await store.updateRows(updates);
  if (plan.appends.length) await store.append("Tabungan", plan.appends);
}
