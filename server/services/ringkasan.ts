import type { ParsedRow } from "../repositories/rows.js";
import type { PilihanAkun } from "./akun-pengguna.js";
import { periodeDto, type PeriodeDto } from "./periode.js";

export interface PerKategori {
  kategoriId: string;
  nama: string;
  total: number;
  jumlah: number;
}

export interface RingkasanAkun {
  akunId: string;
  nama: string;
  jenis: string;
  aktif: boolean;
  saldoAwal: number;
  masuk: number;
  keluar: number;
  biayaAdmin: number;
  transferMasuk: number;
  transferKeluar: number;
  saldoAkhir: number;
  jumlahTransaksi: number;
  pengeluaranPerKategori: PerKategori[];
}

export interface Ringkasan {
  periode: PeriodeDto;
  totalSaldoAwal: number;
  totalMasuk: number;
  totalPengeluaran: number;
  totalSaldoAkhir: number;
  perAkun: RingkasanAkun[];
  pengeluaranPerKategori: PerKategori[];
  pemasukanPerKategori: PerKategori[];
  setorTabungan: { akunId: string; nominal: number }[];
}

type KategoriCounter = ReturnType<typeof kategoriCounter>;

function kategoriCounter(nama: (id: string) => string) {
  const map = new Map<string, PerKategori>();
  return {
    add(kategoriId: string, total: number) {
      const k = map.get(kategoriId) ?? { kategoriId, nama: nama(kategoriId), total: 0, jumlah: 0 };
      k.total += total;
      k.jumlah += 1;
      map.set(kategoriId, k);
    },
    list(): PerKategori[] {
      return [...map.values()].sort((a, b) => b.total - a.total || a.nama.localeCompare(b.nama, "id"));
    },
  };
}

/**
 * Ringkasan satu periode (spec §10.9, rumus §7.3).
 * Biaya admin transfer dihitung sebagai pengeluaran kategori `BIAYA_ADMIN` dari akun asal.
 */
export function hitungRingkasan(
  periode: ParsedRow<"Periode">["data"],
  akun: ParsedRow<"Akun">[],
  kategori: ParsedRow<"Kategori">[],
  saldoAwal: ParsedRow<"SaldoAwal">[],
  transaksi: ParsedRow<"Transaksi">[],
  tabungan: ParsedRow<"Tabungan">[],
  pilihan: PilihanAkun,
): Ringkasan {
  const namaKategori = new Map(kategori.map((k) => [k.data.id, k.data.nama]));
  const biayaAdminKat = kategori.find((k) => k.data.kode_sistem === "BIAYA_ADMIN")?.data;
  const biayaAdminId = biayaAdminKat?.id ?? "BIAYA_ADMIN";
  const nama = (id: string) => namaKategori.get(id) ?? (id === biayaAdminId ? "Biaya Admin Bank" : "Tanpa kategori");

  const perAkun = new Map<string, RingkasanAkun & { kat: KategoriCounter }>();
  const get = (akunId: string) => {
    let a = perAkun.get(akunId);
    if (!a) {
      a = {
        akunId,
        nama: "",
        jenis: "",
        aktif: false,
        saldoAwal: 0,
        masuk: 0,
        keluar: 0,
        biayaAdmin: 0,
        transferMasuk: 0,
        transferKeluar: 0,
        saldoAkhir: 0,
        jumlahTransaksi: 0,
        pengeluaranPerKategori: [],
        kat: kategoriCounter(nama),
      };
      perAkun.set(akunId, a);
    }
    return a;
  };
  const punyaData = new Set<string>();

  for (const { data: s } of saldoAwal) {
    if (s.periode_id !== periode.id || !s.akun_id) continue;
    get(s.akun_id).saldoAwal += s.saldo ?? 0;
    punyaData.add(s.akun_id);
  }

  const pengeluaran = kategoriCounter(nama);
  const pemasukan = kategoriCounter(nama);
  for (const { data: t } of transaksi) {
    if (t.periode_id !== periode.id) continue;
    const nominal = t.nominal ?? 0;
    const asal = get(t.akun_id);
    asal.jumlahTransaksi += 1;
    punyaData.add(t.akun_id);
    if (t.tipe === "masuk") {
      asal.masuk += nominal;
      pemasukan.add(t.kategori_id, nominal);
    } else if (t.tipe === "keluar") {
      asal.keluar += nominal;
      asal.kat.add(t.kategori_id, nominal);
      pengeluaran.add(t.kategori_id, nominal);
    } else if (t.tipe === "transfer") {
      const biaya = t.biaya_admin ?? 0;
      asal.transferKeluar += nominal;
      if (biaya > 0) {
        asal.biayaAdmin += biaya;
        asal.kat.add(biayaAdminId, biaya);
        pengeluaran.add(biayaAdminId, biaya);
      }
      const tujuan = get(t.akun_tujuan_id);
      tujuan.transferMasuk += nominal;
      tujuan.jumlahTransaksi += 1;
      punyaData.add(t.akun_tujuan_id);
    }
  }

  // Akun aktif yang dipilih pengguna + akun lain yang punya data di periode ini, urut menurut pengguna
  const daftar: RingkasanAkun[] = [];
  for (const { data: a } of pilihan.urutkan(akun)) {
    if (!(a.aktif && pilihan.dipilih(a.id)) && !punyaData.has(a.id)) continue;
    const { kat, ...r } = get(a.id);
    r.nama = a.nama;
    r.jenis = a.jenis;
    r.aktif = a.aktif;
    r.saldoAkhir = r.saldoAwal + r.masuk - r.keluar - r.biayaAdmin + r.transferMasuk - r.transferKeluar;
    r.pengeluaranPerKategori = kat.list();
    daftar.push(r);
  }

  const sum = (f: (a: RingkasanAkun) => number) => daftar.reduce((n, a) => n + f(a), 0);
  return {
    periode: periodeDto(periode),
    totalSaldoAwal: sum((a) => a.saldoAwal),
    totalMasuk: sum((a) => a.masuk),
    totalPengeluaran: sum((a) => a.keluar + a.biayaAdmin),
    totalSaldoAkhir: sum((a) => a.saldoAkhir),
    perAkun: daftar,
    pengeluaranPerKategori: pengeluaran.list(),
    pemasukanPerKategori: pemasukan.list(),
    setorTabungan: periode.tanggal_selesai
      ? tabungan
          .filter((t) => t.data.jenis === "setor" && t.data.periode_id === periode.id && t.data.user_id === periode.user_id)
          .map((t) => ({ akunId: t.data.akun_id, nominal: t.data.nominal ?? 0 }))
      : [],
  };
}
