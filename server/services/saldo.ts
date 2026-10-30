import type { ParsedRow } from "../repositories/rows.js";

/** Periode aktif (tanggal_selesai kosong) milik pengguna. Maksimal satu. */
export function periodeAktif(periode: ParsedRow<"Periode">[], userId: string): ParsedRow<"Periode"> | undefined {
  return periode.find((p) => p.data.user_id === userId && !p.data.tanggal_selesai);
}

/**
 * Saldo akhir per akun dalam satu periode (spec §7.3):
 * saldo_awal + masuk − keluar − biaya_admin + transfer_masuk − transfer_keluar.
 * Hanya baris dengan `periode_id` periode ini yang dihitung.
 */
export function saldoPerAkun(
  periodeId: string,
  saldoAwal: ParsedRow<"SaldoAwal">[],
  transaksi: ParsedRow<"Transaksi">[],
): Map<string, number> {
  const saldo = new Map<string, number>();
  const add = (akunId: string, n: number) => {
    if (akunId) saldo.set(akunId, (saldo.get(akunId) ?? 0) + n);
  };

  for (const { data: s } of saldoAwal) {
    if (s.periode_id === periodeId) add(s.akun_id, s.saldo ?? 0);
  }
  for (const { data: t } of transaksi) {
    if (t.periode_id !== periodeId) continue;
    const nominal = t.nominal ?? 0;
    if (t.tipe === "masuk") add(t.akun_id, nominal);
    else if (t.tipe === "keluar") add(t.akun_id, -nominal);
    else if (t.tipe === "transfer") {
      add(t.akun_id, -nominal - (t.biaya_admin ?? 0));
      add(t.akun_tujuan_id, nominal);
    }
  }
  return saldo;
}

/** Saldo satu akun di periode aktif setiap pengguna yang punya periode aktif. */
export function saldoAkunSemuaPengguna(
  akunId: string,
  periode: ParsedRow<"Periode">[],
  saldoAwal: ParsedRow<"SaldoAwal">[],
  transaksi: ParsedRow<"Transaksi">[],
): { userId: string; saldo: number }[] {
  return periode
    .filter((p) => !p.data.tanggal_selesai)
    .map((p) => ({
      userId: p.data.user_id,
      saldo: saldoPerAkun(p.data.id, saldoAwal, transaksi).get(akunId) ?? 0,
    }));
}
