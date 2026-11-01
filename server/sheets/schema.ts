// Urutan kolom per sheet = urutan kolom A, B, C, … (spec §5.2 + penyesuaian 02 §2).
// API membaca & menulis berdasarkan urutan ini, bukan nama header.

export type TipeKolom = "teks" | "angka" | "boolean" | "tanggal" | "bulan" | "datetime";

type Kolom = readonly [nama: string, tipe: TipeKolom];

const AUDIT = [
  ["created_by", "teks"],
  ["created_at", "datetime"],
  ["updated_by", "teks"],
  ["updated_at", "datetime"],
] as const satisfies readonly Kolom[];

export const SCHEMA = {
  Pengguna: [
    ["id", "teks"],
    ["username", "teks"],
    ["password_hash", "teks"],
    ["nama", "teks"],
    ["peran", "teks"],
    ["aktif", "boolean"],
    ["last_login", "datetime"],
    ["versi_token", "angka"],
    ["gagal_login", "angka"],
    ["terkunci_sampai", "datetime"],
    ...AUDIT,
  ],
  // Akun & Kategori = master bersama semua pengguna (02 §2), tanpa user_id
  Akun: [
    ["id", "teks"],
    ["nama", "teks"],
    ["jenis", "teks"],
    ["urutan", "angka"],
    ["aktif", "boolean"],
    ...AUDIT,
  ],
  // Akun yang dipakai tiap pengguna + urutannya sendiri. Belum punya baris = semua akun aktif.
  AkunPengguna: [
    ["id", "teks"],
    ["user_id", "teks"],
    ["akun_id", "teks"],
    ["urutan", "angka"],
    ...AUDIT,
  ],
  Kategori: [
    ["id", "teks"],
    ["nama", "teks"],
    ["tipe", "teks"],
    ["kode_sistem", "teks"],
    ["aktif", "boolean"],
    ...AUDIT,
  ],
  Periode: [
    ["id", "teks"],
    ["user_id", "teks"],
    ["nama", "teks"],
    ["tanggal_mulai", "tanggal"],
    ["tanggal_selesai", "tanggal"],
    ["keterangan", "teks"],
    ...AUDIT,
  ],
  SaldoAwal: [
    ["id", "teks"],
    ["user_id", "teks"],
    ["periode_id", "teks"],
    ["akun_id", "teks"],
    ["saldo", "angka"],
    ...AUDIT,
  ],
  Transaksi: [
    ["id", "teks"],
    ["user_id", "teks"],
    ["periode_id", "teks"],
    ["tanggal", "tanggal"],
    ["tipe", "teks"],
    ["akun_id", "teks"],
    ["akun_tujuan_id", "teks"],
    ["kategori_id", "teks"],
    ["nominal", "angka"],
    ["biaya_admin", "angka"],
    ["deskripsi", "teks"],
    ["berulang_id", "teks"],
    ...AUDIT,
  ],
  Berulang: [
    ["id", "teks"],
    ["user_id", "teks"],
    ["nama", "teks"],
    ["akun_id", "teks"],
    ["kategori_id", "teks"],
    ["nominal", "angka"],
    ["tgl_jatuh_tempo", "angka"],
    ["ingatkan_h_min", "angka"],
    ["mulai", "bulan"],
    ["selesai", "bulan"],
    ["aktif", "boolean"],
    ...AUDIT,
  ],
  BerulangLewati: [
    ["id", "teks"],
    ["user_id", "teks"],
    ["berulang_id", "teks"],
    ["bulan", "bulan"],
    ...AUDIT,
  ],
  Tabungan: [
    ["id", "teks"],
    ["user_id", "teks"],
    ["tanggal", "tanggal"],
    ["jenis", "teks"],
    ["periode_id", "teks"],
    ["akun_id", "teks"],
    ["nominal", "angka"],
    ["keterangan", "teks"],
    ["transaksi_id", "teks"],
    ...AUDIT,
  ],
} as const satisfies Record<string, readonly Kolom[]>;

export type SheetName = keyof typeof SCHEMA;

export const SHEET_NAMES = Object.keys(SCHEMA) as SheetName[];

export const ID_PREFIX = {
  Pengguna: "US",
  Akun: "AK",
  AkunPengguna: "AP",
  Kategori: "KT",
  Periode: "PR",
  SaldoAwal: "SA",
  Transaksi: "TR",
  Berulang: "RB",
  BerulangLewati: "RL",
  Tabungan: "TB",
} as const satisfies Partial<Record<SheetName, string>>;

interface TipeTs {
  teks: string;
  angka: number | null;
  boolean: boolean;
  tanggal: string | null; // yyyy-MM-dd
  bulan: string | null; // yyyy-MM
  datetime: string | null; // ISO 8601 offset +07:00
}

type KolomSheet<S extends SheetName> = (typeof SCHEMA)[S][number];

/** Satu baris sheet yang sudah di-parse, key = nama kolom. */
export type Baris<S extends SheetName> = {
  [K in KolomSheet<S> as K[0]]: TipeTs[K[1]];
};

export function headerOf(sheet: SheetName): string[] {
  return SCHEMA[sheet].map(([nama]) => nama);
}

/** Huruf kolom A, B, …, Z, AA, … dari indeks 0-based. */
export function columnLetter(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function lastColumn(sheet: SheetName): string {
  return columnLetter(SCHEMA[sheet].length - 1);
}

/** Bandingkan header baris 1 dengan schema. Kosong = cocok. */
export function validateHeader(sheet: SheetName, header: readonly string[]): string[] {
  const expected = headerOf(sheet);
  const actual = header.map((h) => h.trim());
  const masalah: string[] = [];
  const total = Math.max(expected.length, actual.length);
  for (let i = 0; i < total; i++) {
    const exp = expected[i];
    const act = actual[i] ?? "";
    const col = columnLetter(i);
    if (exp === undefined) {
      if (act !== "") masalah.push(`Kolom ${col} tidak dikenal: "${act}".`);
    } else if (act !== exp) {
      masalah.push(act === "" ? `Kolom ${col} harus "${exp}", tetapi kosong.` : `Kolom ${col} harus "${exp}", tetapi "${act}".`);
    }
  }
  return masalah;
}
