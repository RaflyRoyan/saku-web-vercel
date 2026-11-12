import type { Clock } from "../common/clock.js";
import type { Baris } from "../db/schema.js";
import type { Operasi, RowUpdate, Store } from "../db/store.js";
import { newId, newRow, updatedRow, type Row } from "../repositories/rows.js";
import { saldoPerAkun } from "./saldo.js";

export interface SetorPlan {
  /** Baris setor yang sudah ada dan nilainya berubah. */
  updates: RowUpdate[];
  /** Baris setor baru untuk tabel `Tabungan`. */
  appends: Baris<"Tabungan">[];
  setor: { akunId: string; nominal: number }[];
}

/**
 * Upsert baris Tabungan `setor` untuk periode tertutup (spec §7.4 langkah 2, §7.5):
 * satu baris per akun yang punya saldo awal atau transaksi di periode itu, nominal = saldo akhir − diteruskan.
 * `teruskan` hanya dikirim saat menutup periode; saat hitung ulang, `diteruskan` dari baris lama tetap dipakai
 * sehingga selisih akibat edit transaksi masuk ke tabungan.
 * Baris setor lama yang akunnya sudah tidak punya data di-nol-kan, bukan dihapus. Tidak pernah ada setor ganda.
 */
export function rencanaSetor(
  periode: Row<"Periode">["data"],
  saldoAwal: Row<"SaldoAwal">[],
  transaksi: Row<"Transaksi">[],
  tabungan: Row<"Tabungan">[],
  by: string,
  clock: Clock,
  teruskan?: Map<string, number>,
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
  for (const [akunId, sisa] of saldo) {
    const first = existing.find((t) => t.data.akun_id === akunId);
    const diteruskan = teruskan ? (teruskan.get(akunId) ?? 0) : (first?.data.diteruskan ?? 0);
    const nominal = sisa - diteruskan;
    plan.setor.push({ akunId, nominal });
    if (first) {
      const d = first.data;
      if (d.nominal !== nominal || d.tanggal !== tanggal || d.keterangan !== keterangan || (d.diteruskan ?? 0) !== diteruskan) {
        plan.updates.push({
          tabel: "Tabungan",
          baris: updatedRow("Tabungan", d, { nominal, tanggal, keterangan, diteruskan }, by, clock),
        });
      }
    } else {
      const id = newId("Tabungan", taken);
      taken.push({ data: { id } as Row<"Tabungan">["data"] });
      plan.appends.push(
        newRow(
          "Tabungan",
          { id, user_id: periode.user_id, tanggal, jenis: "setor", periode_id: periode.id, akun_id: akunId, nominal, keterangan, transaksi_id: "", diteruskan },
          by,
          clock,
        ),
      );
    }
  }
  return plan;
}

/** Saldo tabungan pengguna: Σ setor (tutup periode) + Σ simpan (setor langsung) − Σ tarik. */
export function totalTabungan(tabungan: Row<"Tabungan">[], userId: string): number {
  let total = 0;
  for (const { data: t } of tabungan) {
    if (t.user_id !== userId) continue;
    if (t.jenis === "setor" || t.jenis === "simpan") total += t.nominal ?? 0;
    else if (t.jenis === "tarik") total -= t.nominal ?? 0;
  }
  return total;
}

/**
 * Hitung ulang setor untuk periode tertutup yang terdampak perubahan (spec §7.5).
 * Bisa 2 periode kalau transaksi pindah periode. `saldoAwal`/`transaksi` = isi tabel setelah perubahan.
 */
export function rencanaSetorTerdampak(
  periodeIds: string[],
  periode: Row<"Periode">[],
  saldoAwal: Row<"SaldoAwal">[],
  transaksi: Row<"Transaksi">[],
  tabungan: Row<"Tabungan">[],
  by: string,
  clock: Clock,
): Omit<SetorPlan, "setor"> {
  const updates: RowUpdate[] = [];
  const appends: Baris<"Tabungan">[] = [];
  for (const id of new Set(periodeIds)) {
    const p = periode.find((r) => r.data.id === id)?.data;
    if (!p?.tanggal_selesai) continue;
    const plan = rencanaSetor(p, saldoAwal, transaksi, tabungan, by, clock);
    updates.push(...plan.updates);
    appends.push(...plan.appends);
  }
  return { updates, appends };
}

/**
 * Tulis hasil rencana setor dalam satu transaksi bersama `extra` (perubahan utama handler, mis. transaksi yang diedit).
 * `extra` dijalankan lebih dulu.
 */
export async function simpanSetor(store: Store, plan: Omit<SetorPlan, "setor">, extra: Operasi[] = []) {
  await store.batch([...extra, ...opsSetor(plan)]);
}

/** Operasi tulis dari rencana setor, untuk digabung ke `store.batch` lain. */
export function opsSetor(plan: Omit<SetorPlan, "setor">): Operasi[] {
  return [
    ...plan.updates.map((u) => ({ jenis: "update", ...u }) as Operasi),
    ...(plan.appends.length ? [{ jenis: "insert", tabel: "Tabungan", baris: plan.appends } as Operasi] : []),
  ];
}
