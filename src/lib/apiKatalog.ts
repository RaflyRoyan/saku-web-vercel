// Katalog endpoint untuk halaman Dokumentasi API. Sumber kebenaran tetap docs/SAKU_API_SPEC.md §10.

export type Method = "GET" | "POST" | "PUT" | "DELETE";
export type Akses = "publik" | "login" | "admin";

export interface Param {
  nama: string;
  ket: string;
  wajib?: boolean;
  contoh?: string;
}

export interface Endpoint {
  id: string;
  grup: string;
  method: Method;
  /** Path setelah `/api`, parameter ditulis `{nama}`. */
  path: string;
  judul: string;
  ket: string;
  akses: Akses;
  query?: Param[];
  /** Field body JSON. */
  field?: Param[];
  /** Contoh body untuk diisi di panel Coba. */
  contoh?: unknown;
  /** Penjelasan respons sukses. */
  respons: string;
  /** Peringatan khusus (mis. mengubah sesi). */
  awas?: string;
}

const AKTIF = [{ nama: "aktif", ket: "true / false", wajib: true }];
const URUTAN = [{ nama: "ids", ket: "Daftar ID sesuai urutan baru", wajib: true }];

export const KATALOG: Endpoint[] = [
  // ── Health
  { id: "health", grup: "Health", method: "GET", path: "/health", judul: "Cek API hidup", ket: "Tanpa login, tanpa akses Google Sheets.", akses: "publik", respons: "`{ status: \"ok\", waktu }`" },
  {
    id: "health-sheets",
    grup: "Health",
    method: "GET",
    path: "/health/sheets",
    judul: "Cek header spreadsheet",
    ket: "Membandingkan baris 1 setiap sheet dengan schema. Kolom kurang, salah urut, atau tidak dikenal dilaporkan per sheet.",
    akses: "publik",
    respons: "Status tiap sheet beserta daftar `masalah`.",
  },

  // ── Auth
  { id: "auth-status", grup: "Auth", method: "GET", path: "/auth/status", judul: "Status setup", ket: "Apakah setup admin pertama sudah dilakukan.", akses: "publik", respons: "`{ perluSetup: boolean }`" },
  {
    id: "auth-setup",
    grup: "Auth",
    method: "POST",
    path: "/auth/setup",
    judul: "Setup admin pertama",
    ket: "Hanya bisa sekali, saat sheet Pengguna masih kosong. Juga membuat kategori sistem & kelompok bawaan.",
    akses: "publik",
    field: [
      { nama: "username", ket: "3–30 huruf kecil/angka/._-", wajib: true },
      { nama: "password", ket: "Minimal 8 karakter", wajib: true },
      { nama: "nama", ket: "Nama tampilan", wajib: true },
    ],
    contoh: { username: "admin", password: "********", nama: "Admin" },
    respons: "201 `{ pengguna, expiresAt }` + cookie `saku_token`. 409 kalau sudah pernah setup.",
  },
  {
    id: "auth-login",
    grup: "Auth",
    method: "POST",
    path: "/auth/login",
    judul: "Login",
    ket: "Mengembalikan cookie HttpOnly `saku_token` (JWT). Gagal berulang mengunci akun sementara.",
    akses: "publik",
    field: [
      { nama: "username", ket: "", wajib: true },
      { nama: "password", ket: "", wajib: true },
    ],
    contoh: { username: "budi", password: "********" },
    respons: "`{ pengguna, expiresAt }` + cookie sesi baru.",
    awas: "Login dengan akun lain akan mengganti sesi di browser ini.",
  },
  { id: "auth-logout", grup: "Auth", method: "POST", path: "/auth/logout", judul: "Logout", ket: "Menghapus cookie sesi.", akses: "publik", respons: "204", awas: "Anda akan keluar dari aplikasi." },
  { id: "auth-me", grup: "Auth", method: "GET", path: "/auth/me", judul: "Pengguna saat ini", ket: "Profil dari sesi yang sedang aktif.", akses: "login", respons: "`{ id, username, nama, peran }`" },
  {
    id: "auth-password",
    grup: "Auth",
    method: "PUT",
    path: "/auth/password",
    judul: "Ganti password",
    ket: "Menaikkan versi token: sesi di perangkat lain ikut keluar.",
    akses: "login",
    field: [
      { nama: "passwordLama", ket: "", wajib: true },
      { nama: "passwordBaru", ket: "Minimal 8 karakter", wajib: true },
    ],
    contoh: { passwordLama: "", passwordBaru: "" },
    respons: "`{ expiresAt }` + cookie baru.",
    awas: "Password akun Anda benar-benar diganti.",
  },
  { id: "auth-profil", grup: "Auth", method: "PUT", path: "/auth/profil", judul: "Ubah nama", ket: "", akses: "login", field: [{ nama: "nama", ket: "", wajib: true }], contoh: { nama: "Budi" }, respons: "Profil terbaru." },

  // ── Dashboard
  {
    id: "dashboard",
    grup: "Dashboard",
    method: "GET",
    path: "/dashboard",
    judul: "Beranda",
    ket: "Satu request untuk seluruh Beranda: ringkasan periode aktif, anggaran, total tabungan, pengingat langganan, dan 5 transaksi terakhir.",
    akses: "login",
    respons: "`{ ringkasan | null, anggaran | null, totalTabungan, pengingat[], transaksiTerakhir[] }`",
  },

  // ── Akun
  {
    id: "akun-list",
    grup: "Akun",
    method: "GET",
    path: "/akun",
    judul: "Daftar akun",
    ket: "Default: akun aktif yang dipilih pengguna, urut pilihan pengguna, dengan saldo periode aktif.",
    akses: "login",
    query: [{ nama: "termasukNonaktif", ket: "true = semua akun master, urut master", contoh: "false" }],
    respons: "`[{ id, nama, jenis, urutan, aktif, saldo, dipilih, urutanSaya }]`",
  },
  { id: "akun-pilihan", grup: "Akun", method: "GET", path: "/akun/pilihan", judul: "Pilihan akun saya", ket: "Semua akun master + status dipilih.", akses: "login", respons: "`{ eksplisit, akun: [{ id, nama, jenis, dipilih, saldo }] }`" },
  {
    id: "akun-pilihan-put",
    grup: "Akun",
    method: "PUT",
    path: "/akun/pilihan",
    judul: "Simpan pilihan akun saya",
    ket: "Urutan `ids` = urutan tampil. Akun yang dilepas harus bersaldo 0 di periode aktif (409 kalau tidak).",
    akses: "login",
    field: [{ nama: "ids", ket: "Minimal 1 ID akun", wajib: true }],
    contoh: { ids: ["AK-..."] },
    respons: "204",
  },
  {
    id: "akun-post",
    grup: "Akun",
    method: "POST",
    path: "/akun",
    judul: "Tambah akun master",
    ket: "",
    akses: "admin",
    field: [
      { nama: "nama", ket: "Unik", wajib: true },
      { nama: "jenis", ket: "bank / ewallet / cash", wajib: true },
      { nama: "urutan", ket: "Angka, opsional" },
    ],
    contoh: { nama: "SeaBank", jenis: "bank" },
    respons: "201 + akun baru.",
  },
  { id: "akun-urutan", grup: "Akun", method: "PUT", path: "/akun/urutan", judul: "Urutan master akun", ket: "", akses: "admin", field: URUTAN, contoh: { ids: ["AK-...", "AK-..."] }, respons: "204" },
  {
    id: "akun-put",
    grup: "Akun",
    method: "PUT",
    path: "/akun/{id}",
    judul: "Ubah akun master",
    ket: "",
    akses: "admin",
    field: [
      { nama: "nama", ket: "", wajib: true },
      { nama: "jenis", ket: "bank / ewallet / cash", wajib: true },
      { nama: "urutan", ket: "", wajib: true },
    ],
    contoh: { nama: "BCA", jenis: "bank", urutan: 1 },
    respons: "204",
  },
  { id: "akun-aktif", grup: "Akun", method: "PUT", path: "/akun/{id}/aktif", judul: "Aktif/nonaktif akun", ket: "Nonaktif ditolak kalau masih ada saldo.", akses: "admin", field: AKTIF, contoh: { aktif: false }, respons: "204" },

  // ── Kategori
  {
    id: "kelompok-list",
    grup: "Kategori",
    method: "GET",
    path: "/kelompok-kategori",
    judul: "Kategori induk",
    ket: "Kategori induk pengeluaran. \"Lainnya\" (id `LAINNYA`) selalu ada di akhir.",
    akses: "login",
    query: [{ nama: "termasukNonaktif", ket: "true / false", contoh: "false" }],
    respons: "`[{ id, nama, urutan, aktif, sistem }]`",
  },
  { id: "kelompok-post", grup: "Kategori", method: "POST", path: "/kelompok-kategori", judul: "Tambah kategori induk", ket: "Nama \"Lainnya\" dicadangkan.", akses: "admin", field: [{ nama: "nama", ket: "Unik", wajib: true }], contoh: { nama: "Hewan Peliharaan" }, respons: "201" },
  { id: "kelompok-bawaan", grup: "Kategori", method: "POST", path: "/kelompok-kategori/bawaan", judul: "Tambah kategori induk bawaan", ket: "Idempoten: hanya menambah yang belum ada.", akses: "admin", respons: "`{ ditambah }`" },
  { id: "kelompok-urutan", grup: "Kategori", method: "PUT", path: "/kelompok-kategori/urutan", judul: "Urutan kategori induk", ket: "", akses: "admin", field: URUTAN, contoh: { ids: ["KK-...", "KK-..."] }, respons: "204" },
  { id: "kelompok-put", grup: "Kategori", method: "PUT", path: "/kelompok-kategori/{id}", judul: "Ubah kategori induk", ket: "", akses: "admin", field: [{ nama: "nama", ket: "", wajib: true }], contoh: { nama: "Kebutuhan Harian" }, respons: "Kategori induk terbaru." },
  { id: "kelompok-aktif", grup: "Kategori", method: "PUT", path: "/kelompok-kategori/{id}/aktif", judul: "Aktif/nonaktif kategori induk", ket: "Ditolak kalau masih ada sub kategori aktif.", akses: "admin", field: AKTIF, contoh: { aktif: false }, respons: "204" },
  {
    id: "kategori-list",
    grup: "Kategori",
    method: "GET",
    path: "/kategori",
    judul: "Sub kategori",
    ket: "Kategori pemasukan & sub kategori pengeluaran (dengan kategori induknya).",
    akses: "login",
    query: [
      { nama: "tipe", ket: "masuk / keluar", contoh: "keluar" },
      { nama: "untukInput", ket: "true = sembunyikan kategori sistem", contoh: "true" },
      { nama: "termasukNonaktif", ket: "true / false", contoh: "false" },
    ],
    respons: "`[{ id, nama, tipe, kodeSistem, aktif, kelompokId, kelompokNama }]`",
  },
  {
    id: "kategori-post",
    grup: "Kategori",
    method: "POST",
    path: "/kategori",
    judul: "Tambah sub kategori",
    ket: "`kelompokId` hanya untuk tipe keluar; kosong = Lainnya.",
    akses: "admin",
    field: [
      { nama: "nama", ket: "", wajib: true },
      { nama: "tipe", ket: "masuk / keluar", wajib: true },
      { nama: "kelompokId", ket: "ID kategori induk" },
    ],
    contoh: { nama: "Kopi", tipe: "keluar", kelompokId: "KK-..." },
    respons: "201",
  },
  {
    id: "kategori-put",
    grup: "Kategori",
    method: "PUT",
    path: "/kategori/{id}",
    judul: "Ubah sub kategori",
    ket: "`kelompokId` tidak dikirim = tidak berubah.",
    akses: "admin",
    field: [
      { nama: "nama", ket: "", wajib: true },
      { nama: "kelompokId", ket: "ID kategori induk / LAINNYA" },
    ],
    contoh: { nama: "Kopi", kelompokId: "KK-..." },
    respons: "Kategori terbaru.",
  },
  { id: "kategori-aktif", grup: "Kategori", method: "PUT", path: "/kategori/{id}/aktif", judul: "Aktif/nonaktif sub kategori", ket: "Kategori sistem tidak bisa dinonaktifkan.", akses: "admin", field: AKTIF, contoh: { aktif: false }, respons: "204" },

  // ── Periode
  { id: "periode-list", grup: "Periode", method: "GET", path: "/periode", judul: "Daftar periode", ket: "Terbaru di atas.", akses: "login", respons: "`[{ id, nama, tanggalMulai, tanggalSelesai, keterangan, aktif }]`" },
  { id: "periode-aktif", grup: "Periode", method: "GET", path: "/periode/aktif", judul: "Periode aktif", ket: "", akses: "login", respons: "Periode + `saldoAwal[]`. 404 kalau belum ada." },
  { id: "periode-pratinjau", grup: "Periode", method: "GET", path: "/periode/aktif/pratinjau-tutup", judul: "Pratinjau tutup periode", ket: "Sisa tiap akun bila periode aktif ditutup sekarang. Tidak menulis apa pun.", akses: "login", respons: "`{ periode, sisa: [{ akunId, nama, nominal }], total }`" },
  {
    id: "periode-mulai",
    grup: "Periode",
    method: "POST",
    path: "/periode/mulai",
    judul: "Mulai periode baru",
    ket: "Menutup periode aktif (tanggal selesai = mulai − 1), menabung sisa yang tidak diteruskan, membuat periode baru + saldo awal. Transaksi lama bertanggal ≥ mulai tetap di periode lama.",
    akses: "login",
    field: [
      { nama: "nama", ket: "Default \"Periode d MMM yyyy\"" },
      { nama: "tanggalMulai", ket: "yyyy-MM-dd, default hari ini" },
      { nama: "keterangan", ket: "" },
      { nama: "saldoAwal", ket: "[{ akunId, saldo }]" },
      { nama: "teruskan", ket: "[{ akunId, nominal }] bagian sisa yang diteruskan; sisanya ditabung" },
      { nama: "salinAnggaran", ket: "true = salin anggaran periode sebelumnya" },
    ],
    contoh: { tanggalMulai: "2026-11-25", saldoAwal: [{ akunId: "AK-...", saldo: 6000000 }], teruskan: [{ akunId: "AK-...", nominal: 500000 }], salinAnggaran: true },
    respons: "201 `{ periode, setorTabungan, diteruskan, anggaranDisalin, transaksiTetapDiPeriodeLama, totalTabungan }`",
    awas: "Periode aktif Anda benar-benar ditutup.",
  },
  { id: "periode-put", grup: "Periode", method: "PUT", path: "/periode/{id}", judul: "Ubah nama periode", ket: "Tanggal tidak bisa diubah.", akses: "login", field: [{ nama: "nama", ket: "", wajib: true }, { nama: "keterangan", ket: "" }], contoh: { nama: "Gajian Nov", keterangan: "" }, respons: "Periode terbaru." },
  {
    id: "periode-saldo",
    grup: "Periode",
    method: "PUT",
    path: "/periode/{id}/saldo-awal",
    judul: "Ganti saldo awal",
    ket: "Mengganti seluruh saldo awal periode. Periode tertutup → setor tabungan dihitung ulang.",
    akses: "login",
    field: [{ nama: "saldoAwal", ket: "[{ akunId, saldo }]", wajib: true }],
    contoh: { saldoAwal: [{ akunId: "AK-...", saldo: 1000000 }] },
    respons: "204",
  },
  { id: "periode-ringkasan", grup: "Periode", method: "GET", path: "/periode/{id}/ringkasan", judul: "Ringkasan periode", ket: "Saldo per akun, pengeluaran per kategori & kategori induk, setor tabungan.", akses: "login", respons: "Objek ringkasan (spec §10.9)." },
  { id: "anggaran-get", grup: "Anggaran", method: "GET", path: "/periode/{id}/anggaran", judul: "Anggaran periode", ket: "Batas vs terpakai per kategori induk & sub kategori. Status: aman < 80% ≤ hampir ≤ 100% < lewat.", akses: "login", respons: "`{ periodeId, ada, total, kelompok: [{ …, sub: [] }] }`" },
  {
    id: "anggaran-put",
    grup: "Anggaran",
    method: "PUT",
    path: "/periode/{id}/anggaran",
    judul: "Simpan anggaran",
    ket: "Mengganti seluruh anggaran periode. Isi `kelompokId` ATAU `kategoriId` per item; nominal 0 = hapus. Jumlah sub tidak boleh melebihi batas induknya.",
    akses: "login",
    field: [{ nama: "items", ket: "[{ kelompokId? | kategoriId?, nominal }]", wajib: true }],
    contoh: { items: [{ kelompokId: "KK-...", nominal: 2000000 }, { kategoriId: "KT-...", nominal: 500000 }] },
    respons: "Hasil hitung anggaran terbaru.",
  },

  // ── Transaksi
  {
    id: "transaksi-list",
    grup: "Transaksi",
    method: "GET",
    path: "/transaksi",
    judul: "Daftar transaksi",
    ket: "Urut tanggal terbaru. Filter akun juga mencakup transfer ke akun itu.",
    akses: "login",
    query: [
      { nama: "periodeId", ket: "Default periode aktif; `semua` = lintas periode" },
      { nama: "akunId", ket: "" },
      { nama: "tipe", ket: "keluar / masuk / transfer" },
      { nama: "kelompokId", ket: "Kategori induk" },
      { nama: "kategoriId", ket: "Sub kategori" },
      { nama: "q", ket: "Cari deskripsi" },
      { nama: "dari", ket: "yyyy-MM-dd" },
      { nama: "sampai", ket: "yyyy-MM-dd" },
      { nama: "label", ket: "Filter label (tidak peka huruf besar/kecil)" },
      { nama: "halaman", ket: "Default 1", contoh: "1" },
      { nama: "ukuran", ket: "Default 50, maks 200", contoh: "20" },
    ],
    respons: "`{ data[], total, halaman, ukuran }`",
  },
  { id: "transaksi-label-list", grup: "Transaksi", method: "GET", path: "/transaksi/label", judul: "Daftar label", ket: "Label yang pernah dipakai, paling sering dulu.", akses: "login", respons: "`[{ label, jumlah }]`" },
  {
    id: "transaksi-label-ringkasan",
    grup: "Transaksi",
    method: "GET",
    path: "/transaksi/label/ringkasan",
    judul: "Ringkasan label",
    ket: "Lintas periode. Transfer tidak dihitung.",
    akses: "login",
    query: [{ nama: "label", ket: "Wajib", contoh: "Liburan Jogja" }],
    respons: "`{ label, jumlah, masuk, keluar, dari, sampai, perKategori[] }`",
  },
  {
    id: "transaksi-label-put",
    grup: "Transaksi",
    method: "PUT",
    path: "/transaksi/label",
    judul: "Beri label massal",
    ket: "Banyak transaksi sekaligus. null = hapus label.",
    akses: "login",
    field: [
      { nama: "ids", ket: "ID transaksi, 1–500", wajib: true },
      { nama: "label", ket: "Maks 50 karakter, atau null", wajib: true },
    ],
    contoh: { ids: ["TR-..."], label: "Liburan Jogja" },
    respons: "`{ label, jumlah }`",
  },
  { id: "transaksi-get", grup: "Transaksi", method: "GET", path: "/transaksi/{id}", judul: "Detail transaksi", ket: "", akses: "login", respons: "Transaksi dengan nama akun & kategori." },
  {
    id: "transaksi-post",
    grup: "Transaksi",
    method: "POST",
    path: "/transaksi",
    judul: "Catat transaksi",
    ket: "Periode ditentukan dari tanggal. Saldo minus & anggaran terlewati tidak memblokir, hanya `peringatan`.",
    akses: "login",
    field: [
      { nama: "tipe", ket: "keluar / masuk / transfer", wajib: true },
      { nama: "akunId", ket: "Akun asal", wajib: true },
      { nama: "akunTujuanId", ket: "Wajib untuk transfer" },
      { nama: "kategoriId", ket: "Wajib untuk keluar/masuk" },
      { nama: "nominal", ket: "> 0", wajib: true },
      { nama: "biayaAdmin", ket: "Transfer saja" },
      { nama: "deskripsi", ket: "Maks 200 karakter" },
      { nama: "tanggal", ket: "yyyy-MM-dd, default hari ini" },
      { nama: "label", ket: "Opsional, maks 50 karakter. PUT: tidak dikirim = tetap, null = hapus" },
    ],
    contoh: { tipe: "keluar", akunId: "AK-...", kategoriId: "KT-...", nominal: 15000, deskripsi: "Kopi" },
    respons: "201 transaksi + `peringatan[]`.",
  },
  {
    id: "transaksi-put",
    grup: "Transaksi",
    method: "PUT",
    path: "/transaksi/{id}",
    judul: "Ubah transaksi",
    ket: "Body sama dengan catat. Tanggal tidak berubah = tetap di periodenya.",
    akses: "login",
    contoh: { tipe: "keluar", akunId: "AK-...", kategoriId: "KT-...", nominal: 20000, tanggal: "2026-11-05" },
    respons: "Transaksi + `peringatan[]`.",
  },
  { id: "transaksi-delete", grup: "Transaksi", method: "DELETE", path: "/transaksi/{id}", judul: "Hapus transaksi", ket: "Transaksi tarik tabungan dihapus lewat menu Tabungan.", akses: "login", respons: "204" },

  // ── Tabungan
  { id: "tabungan-list", grup: "Tabungan", method: "GET", path: "/tabungan", judul: "Tabungan", ket: "Total, saldo per akun, dan riwayat setor/tarik.", akses: "login", respons: "`{ total, perAkun[], riwayat[] }`" },
  {
    id: "tabungan-tarik",
    grup: "Tabungan",
    method: "POST",
    path: "/tabungan/tarik",
    judul: "Tarik tabungan",
    ket: "Mencatat tarik + transaksi masuk (kategori Tarik Tabungan) di periode aktif.",
    akses: "login",
    field: [
      { nama: "akunId", ket: "", wajib: true },
      { nama: "nominal", ket: "≤ saldo tabungan akun", wajib: true },
      { nama: "tanggal", ket: "yyyy-MM-dd" },
      { nama: "keterangan", ket: "" },
    ],
    contoh: { akunId: "AK-...", nominal: 100000, keterangan: "Darurat" },
    respons: "201 `{ id, saldoTabunganAkun, transaksi }`",
  },
  { id: "tabungan-delete", grup: "Tabungan", method: "DELETE", path: "/tabungan/{id}", judul: "Batalkan tarik", ket: "Hanya tarik di periode aktif; transaksinya ikut dihapus.", akses: "login", respons: "204" },

  // ── Langganan
  { id: "berulang-list", grup: "Langganan", method: "GET", path: "/berulang", judul: "Daftar langganan", ket: "", akses: "login", query: [{ nama: "termasukNonaktif", ket: "true / false", contoh: "false" }], respons: "Langganan + status bulan ini." },
  { id: "berulang-pengingat", grup: "Langganan", method: "GET", path: "/berulang/pengingat", judul: "Pengingat", ket: "Langganan yang jatuh tempo bulan ini & depan sesuai H-n.", akses: "login", query: [{ nama: "tanggal", ket: "yyyy-MM-dd, default hari ini" }], respons: "`[{ berulangId, bulan, jatuhTempo, status, sisaHari, berulang }]`" },
  {
    id: "berulang-post",
    grup: "Langganan",
    method: "POST",
    path: "/berulang",
    judul: "Tambah langganan",
    ket: "",
    akses: "login",
    field: [
      { nama: "nama", ket: "", wajib: true },
      { nama: "akunId", ket: "", wajib: true },
      { nama: "kategoriId", ket: "Kategori keluar", wajib: true },
      { nama: "nominal", ket: "", wajib: true },
      { nama: "tglJatuhTempo", ket: "1–31", wajib: true },
      { nama: "ingatkanHMin", ket: "0–15 hari", wajib: true },
      { nama: "mulai", ket: "yyyy-MM", wajib: true },
      { nama: "selesai", ket: "yyyy-MM atau null" },
    ],
    contoh: { nama: "Netflix", akunId: "AK-...", kategoriId: "KT-...", nominal: 54000, tglJatuhTempo: 10, ingatkanHMin: 3, mulai: "2026-11", selesai: null },
    respons: "201",
  },
  { id: "berulang-put", grup: "Langganan", method: "PUT", path: "/berulang/{id}", judul: "Ubah langganan", ket: "Body sama dengan tambah + `aktif`.", akses: "login", contoh: { nama: "Netflix", akunId: "AK-...", kategoriId: "KT-...", nominal: 54000, tglJatuhTempo: 10, ingatkanHMin: 3, mulai: "2026-11", selesai: null, aktif: true }, respons: "Langganan terbaru." },
  {
    id: "berulang-konfirmasi",
    grup: "Langganan",
    method: "POST",
    path: "/berulang/{id}/konfirmasi",
    judul: "Bayar langganan",
    ket: "Membuat transaksi keluar dari data langganan. Sudah dibayar bulan itu → 409.",
    akses: "login",
    field: [
      { nama: "bulan", ket: "yyyy-MM", wajib: true },
      { nama: "tanggal", ket: "Default hari ini" },
      { nama: "nominal", ket: "Default nominal langganan" },
      { nama: "akunId", ket: "Default akun langganan" },
      { nama: "deskripsi", ket: "Default nama langganan" },
    ],
    contoh: { bulan: "2026-11" },
    respons: "201 transaksi + `peringatan[]`.",
  },
  { id: "berulang-lewati", grup: "Langganan", method: "POST", path: "/berulang/{id}/lewati", judul: "Lewati bulan", ket: "", akses: "login", field: [{ nama: "bulan", ket: "yyyy-MM", wajib: true }], contoh: { bulan: "2026-11" }, respons: "201 `{ id, berulangId, bulan }`" },
  { id: "berulang-batal-lewati", grup: "Langganan", method: "DELETE", path: "/berulang/{id}/lewati/{bulan}", judul: "Batal lewati", ket: "", akses: "login", respons: "204" },

  // ── Split Bill
  { id: "split-list", grup: "Split Bill", method: "GET", path: "/split", judul: "Daftar split bill", ket: "Urut tanggal terbaru.", akses: "login", respons: "`[{ id, nama, tanggal, total, jumlahPeserta, belumLunas: { jumlah, nominal } }]`" },
  { id: "split-nama", grup: "Split Bill", method: "GET", path: "/split/nama", judul: "Nama peserta", ket: "Nama yang pernah dipakai (autocomplete), paling sering dulu.", akses: "login", respons: "`string[]`" },
  { id: "split-get", grup: "Split Bill", method: "GET", path: "/split/{id}", judul: "Detail split bill", ket: "", akses: "login", respons: "`{ id, nama, tanggal, akunId, kategoriId, akunTerimaId, subtotal, pajak, servis, diskon, total, transaksiId, items[], peserta[], belumLunas }`" },
  {
    id: "split-post",
    grup: "Split Bill",
    method: "POST",
    path: "/split",
    judul: "Buat split bill",
    ket: "Bagian tiap orang dihitung server: porsi item dibagi rata antar pemilik, pajak/servis/diskon proporsional, sisa pembulatan ke peserta \"saya\". Membuat 1 transaksi keluar sebesar total.",
    akses: "login",
    field: [
      { nama: "nama", ket: "Nama tagihan", wajib: true },
      { nama: "tanggal", ket: "yyyy-MM-dd, default hari ini" },
      { nama: "akunId", ket: "Akun pembayar", wajib: true },
      { nama: "kategoriId", ket: "Kategori pengeluaran", wajib: true },
      { nama: "akunTerimaId", ket: "Akun penerima pembayaran teman", wajib: true },
      { nama: "pajak / servis / diskon", ket: "Rupiah, default 0" },
      { nama: "peserta", ket: "[{ id?, nama, saya }], tepat 1 saya, min 2 orang", wajib: true },
      { nama: "items", ket: "[{ nama, qty, harga, peserta: indeks peserta[] }]", wajib: true },
    ],
    contoh: {
      nama: "Makan Bakmi",
      akunId: "AK-...",
      kategoriId: "KT-...",
      akunTerimaId: "AK-...",
      pajak: 6000,
      peserta: [{ nama: "Saya", saya: true }, { nama: "Andi", saya: false }],
      items: [{ nama: "Bakmi", qty: 1, harga: 30000, peserta: [0] }, { nama: "Nasi", qty: 1, harga: 30000, peserta: [1] }],
    },
    respons: "201 detail split + `peringatan[]`.",
  },
  { id: "split-put", grup: "Split Bill", method: "PUT", path: "/split/{id}", judul: "Ubah split bill", ket: "Body sama dengan buat. Peserta lama dicocokkan lewat `id`; peserta lunas tidak boleh dihapus (422). Transaksi keluar & pemasukan peserta lunas ikut diperbarui.", akses: "login", contoh: { nama: "Makan Bakmi", akunId: "AK-...", kategoriId: "KT-...", akunTerimaId: "AK-...", peserta: [{ id: "SP-...", nama: "Saya", saya: true }, { id: "SP-...", nama: "Andi", saya: false }], items: [{ nama: "Bakmi", qty: 1, harga: 30000, peserta: [0, 1] }] }, respons: "Detail split + `peringatan[]`." },
  { id: "split-delete", grup: "Split Bill", method: "DELETE", path: "/split/{id}", judul: "Hapus split bill", ket: "Transaksi keluar dan semua pemasukan dari peserta ikut terhapus.", akses: "login", respons: "204" },
  {
    id: "split-lunas",
    grup: "Split Bill",
    method: "PUT",
    path: "/split/{id}/peserta/{pid}/lunas",
    judul: "Tandai lunas / belum",
    ket: "lunas=true → transaksi masuk kategori Patungan ke akun penerima. false → transaksi itu dihapus. Idempoten. Peserta \"saya\" → 422.",
    akses: "login",
    field: [
      { nama: "lunas", ket: "true / false", wajib: true },
      { nama: "tanggal", ket: "Tanggal pemasukan, default hari ini" },
    ],
    contoh: { lunas: true },
    respons: "Detail split terbaru.",
  },

  // ── Pengaturan
  { id: "pengaturan-qris-get", grup: "Pengaturan", method: "GET", path: "/pengaturan/qris", judul: "QRIS tersimpan", ket: "QRIS statis untuk kartu tagihan split bill.", akses: "login", respons: "`{ payload, merchant, kota }` atau `null`" },
  {
    id: "pengaturan-qris-put",
    grup: "Pengaturan",
    method: "PUT",
    path: "/pengaturan/qris",
    judul: "Simpan QRIS",
    ket: "Payload EMV divalidasi (CRC16, penanda ID.CO.QRIS). null = hapus.",
    akses: "login",
    field: [{ nama: "payload", ket: "Isi teks QR QRIS statis, atau null", wajib: true }],
    contoh: { payload: null },
    respons: "`{ payload, merchant, kota }` atau `null`",
  },

  // ── Tagihan QRIS
  { id: "tagihan-qris-list", grup: "Tagihan QRIS", method: "GET", path: "/tagihan-qris", judul: "Daftar tagihan QRIS", ket: "Terbaru dulu, termasuk yang sudah lunas.", akses: "login", respons: "`[{ id, tanggal, nominal, keterangan, akunId, akunNama, kategoriId, kategoriNama, lunas, transaksiId }]`" },
  {
    id: "tagihan-qris-post",
    grup: "Tagihan QRIS",
    method: "POST",
    path: "/tagihan-qris",
    judul: "Buat tagihan QRIS",
    ket: "Tersimpan belum lunas. Akun & kategori dipakai saat ditandai lunas.",
    akses: "login",
    field: [
      { nama: "nominal", ket: "Rupiah, > 0", wajib: true },
      { nama: "keterangan", ket: "Maks. 100 karakter" },
      { nama: "akunId", ket: "Akun penerima", wajib: true },
      { nama: "kategoriId", ket: "Kategori pemasukan", wajib: true },
    ],
    contoh: { nominal: 25000, keterangan: "Kaos L", akunId: "AK-…", kategoriId: "KT-…" },
    respons: "201 + tagihan",
  },
  {
    id: "tagihan-qris-lunas",
    grup: "Tagihan QRIS",
    method: "PUT",
    path: "/tagihan-qris/{id}/lunas",
    judul: "Tandai lunas / belum",
    ket: "Lunas = transaksi masuk. Batal lunas = transaksi dihapus. Idempoten.",
    akses: "login",
    field: [
      { nama: "lunas", ket: "true/false", wajib: true },
      { nama: "tanggal", ket: "yyyy-MM-dd, default hari ini" },
    ],
    contoh: { lunas: true },
    respons: "Tagihan terbaru.",
  },
  { id: "tagihan-qris-delete", grup: "Tagihan QRIS", method: "DELETE", path: "/tagihan-qris/{id}", judul: "Hapus tagihan", ket: "Transaksi masuknya ikut terhapus.", akses: "login", respons: "204" },

  // ── Pengguna
  { id: "pengguna-list", grup: "Pengguna", method: "GET", path: "/pengguna", judul: "Daftar pengguna", ket: "", akses: "admin", respons: "`[{ id, username, nama, peran, aktif, lastLogin }]`" },
  {
    id: "pengguna-post",
    grup: "Pengguna",
    method: "POST",
    path: "/pengguna",
    judul: "Tambah pengguna",
    ket: "",
    akses: "admin",
    field: [
      { nama: "username", ket: "", wajib: true },
      { nama: "password", ket: "Minimal 8 karakter", wajib: true },
      { nama: "nama", ket: "", wajib: true },
      { nama: "peran", ket: "admin / user", wajib: true },
    ],
    contoh: { username: "siti", password: "********", nama: "Siti", peran: "user" },
    respons: "201",
  },
  {
    id: "pengguna-put",
    grup: "Pengguna",
    method: "PUT",
    path: "/pengguna/{id}",
    judul: "Ubah pengguna",
    ket: "Nonaktif / ganti peran langsung mengeluarkan sesinya.",
    akses: "admin",
    field: [
      { nama: "nama", ket: "", wajib: true },
      { nama: "peran", ket: "admin / user", wajib: true },
      { nama: "aktif", ket: "true / false", wajib: true },
    ],
    contoh: { nama: "Siti", peran: "user", aktif: true },
    respons: "Pengguna terbaru.",
  },
  { id: "pengguna-reset", grup: "Pengguna", method: "POST", path: "/pengguna/{id}/reset-password", judul: "Reset password", ket: "", akses: "admin", field: [{ nama: "passwordBaru", ket: "Minimal 8 karakter", wajib: true }], contoh: { passwordBaru: "" }, respons: "204" },
];

export const GRUP = [...new Set(KATALOG.map((e) => e.grup))];

/** Nama parameter `{x}` di path. */
export const paramPath = (path: string) => [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
