// Kolom per tabel Postgres (spec §5.2 + penyesuaian 02 §2). Nama tabel = nama di sini dalam snake_case
// (mis. `AkunPengguna` → `akun_pengguna`), nama kolom sama persis. Migrasi SQL ada di supabase/migrations.

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
  // Kelompok di atas kategori pengeluaran (UI: "Kategori"; sheet Kategori tampil sebagai "Sub kategori").
  // Kelompok "Lainnya" tidak punya baris: kategori keluar dengan kelompok_id kosong masuk ke sana.
  KelompokKategori: [
    ["id", "teks"],
    ["nama", "teks"],
    ["urutan", "angka"],
    ["aktif", "boolean"],
    ...AUDIT,
  ],
  Kategori: [
    ["id", "teks"],
    ["nama", "teks"],
    ["tipe", "teks"],
    ["kode_sistem", "teks"],
    ["aktif", "boolean"],
    ...AUDIT,
    // Ditambahkan setelah audit supaya kolom data lama tidak bergeser. Hanya untuk tipe keluar.
    ["kelompok_id", "teks"],
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
  // Anggaran per periode milik pengguna. Satu baris = satu batas: kelompok_id (kategori induk) ATAU kategori_id (sub kategori).
  Anggaran: [
    ["id", "teks"],
    ["user_id", "teks"],
    ["periode_id", "teks"],
    ["kelompok_id", "teks"],
    ["kategori_id", "teks"],
    ["nominal", "angka"],
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
    // Ditambahkan setelah audit supaya kolom data lama tidak bergeser. Label bebas, mis. "Liburan Jogja". Kosong = tanpa label.
    ["label", "teks"],
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
    // Ditambahkan setelah audit. Baris setor: bagian sisa akun yang diteruskan ke periode berikutnya (bukan ditabung).
    // nominal setor = sisa − diteruskan. Kosong = 0 (data lama: seluruh sisa ditabung).
    ["diteruskan", "angka"],
  ],
  // Split bill: satu struk yang ditalangi pengguna lalu ditagih ke peserta lain (spec split bill §3).
  SplitBill: [
    ["id", "teks"],
    ["user_id", "teks"],
    ["tanggal", "tanggal"],
    ["nama", "teks"],
    ["akun_id", "teks"],
    ["kategori_id", "teks"],
    ["akun_terima_id", "teks"],
    ["pajak", "angka"],
    ["servis", "angka"],
    ["diskon", "angka"],
    ["total", "angka"],
    ["transaksi_id", "teks"],
    ...AUDIT,
  ],
  SplitItem: [
    ["id", "teks"],
    ["user_id", "teks"],
    ["split_id", "teks"],
    ["nama", "teks"],
    ["qty", "angka"],
    // Harga total baris (bukan per unit)
    ["harga", "angka"],
    // ID peserta pemilik item, dipisah koma
    ["peserta", "teks"],
    ["urutan", "angka"],
    ...AUDIT,
  ],
  SplitPeserta: [
    ["id", "teks"],
    ["user_id", "teks"],
    ["split_id", "teks"],
    ["nama", "teks"],
    ["saya", "boolean"],
    ["nominal", "angka"],
    ["lunas", "boolean"],
    // Transaksi masuk saat lunas
    ["transaksi_id", "teks"],
    ["urutan", "angka"],
    ...AUDIT,
  ],
  // Pengaturan per pengguna (kunci–nilai), mis. kunci "qris" = payload QRIS statis
  Pengaturan: [
    ["id", "teks"],
    ["user_id", "teks"],
    ["kunci", "teks"],
    ["nilai", "teks"],
    ...AUDIT,
  ],
  // Tagihan QRIS bernominal (halaman Terima QRIS). Tersimpan saat QR dibuat, lunas = transaksi masuk.
  TagihanQris: [
    ["id", "teks"],
    ["user_id", "teks"],
    ["tanggal", "tanggal"],
    ["nominal", "angka"],
    ["keterangan", "teks"],
    ["akun_id", "teks"],
    ["kategori_id", "teks"],
    ["lunas", "boolean"],
    ["transaksi_id", "teks"],
    ...AUDIT,
  ],
} as const satisfies Record<string, readonly Kolom[]>;

export type NamaTabel = keyof typeof SCHEMA;

export const NAMA_TABEL = Object.keys(SCHEMA) as NamaTabel[];

/** Nama tabel di Postgres, mis. `AkunPengguna` → `akun_pengguna`. */
export function tabelDb(nama: NamaTabel): string {
  return nama.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
}

/** Tabel data per pengguna (punya kolom `user_id`). Master bersama & `Pengguna` tidak. */
export function punyaUserId(nama: NamaTabel): boolean {
  return SCHEMA[nama].some(([kolom]) => kolom === "user_id");
}

export function kolomOf(nama: NamaTabel): string[] {
  return SCHEMA[nama].map(([kolom]) => kolom);
}

export const ID_PREFIX = {
  Pengguna: "US",
  Akun: "AK",
  AkunPengguna: "AP",
  KelompokKategori: "KK",
  Kategori: "KT",
  Periode: "PR",
  SaldoAwal: "SA",
  Anggaran: "AG",
  Transaksi: "TR",
  Berulang: "RB",
  BerulangLewati: "RL",
  Tabungan: "TB",
  SplitBill: "SB",
  SplitItem: "SI",
  SplitPeserta: "SP",
  Pengaturan: "PG",
  TagihanQris: "TQ",
} as const satisfies Partial<Record<NamaTabel, string>>;

interface TipeTs {
  teks: string;
  angka: number | null;
  boolean: boolean;
  tanggal: string | null; // yyyy-MM-dd
  bulan: string | null; // yyyy-MM
  datetime: string | null; // ISO 8601 offset +07:00
}

type KolomTabel<S extends NamaTabel> = (typeof SCHEMA)[S][number];

/** Satu baris tabel, key = nama kolom. Teks kosong = "", bukan null. */
export type Baris<S extends NamaTabel> = {
  [K in KolomTabel<S> as K[0]]: TipeTs[K[1]];
};
