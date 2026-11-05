# Split Bill — Desain

Tanggal: 2026-11-06 · Status: disetujui di chat, menunggu review spec

## 1. Tujuan

Pengguna menalangi satu tagihan (struk) untuk beberapa orang, lalu menagih bagian tiap orang lewat WhatsApp dengan QRIS bernominal. Pengguna mencentang orang yang sudah membayar; hanya yang dicentang yang tercatat sebagai pemasukan.

Kriteria sukses:
- Struk bisa diisi lewat scan (OCR) atau manual, lalu diedit.
- Bagian tiap orang dihitung per item (atau bagi rata), pajak/servis/diskon proporsional, jumlah semua bagian = total struk tepat (rupiah).
- Tiap orang mendapat gambar kartu berisi QRIS dengan nominal sudah terisi + rincian, dibagikan ke WhatsApp lewat share sheet HP.
- Saldo akun selalu cocok dengan uang riil: total struk keluar dari akun pembayar; tiap pelunasan masuk ke akun penerima.

## 2. Keputusan (dari user)

| Topik | Keputusan |
|---|---|
| Sumber QRIS | QRIS statis GoPay milik user, dijadikan dinamis (nominal disisipkan) |
| OCR | Tesseract.js di browser (gratis, foto tidak keluar HP) |
| Pencatatan | 1 transaksi keluar sebesar total; tiap peserta lunas = 1 transaksi masuk |
| Cara bagi | Per item (1 item bisa beberapa orang) + tombol bagi rata; pajak/servis/diskon proporsional |
| Kirim WA | Gambar kartu via `navigator.share` (share sheet), tanpa link publik |

Asumsi yang disetujui:
1. "Saya" otomatis jadi peserta; bagiannya dianggap lunas tanpa transaksi masuk.
2. Nama peserta diketik per split, autocomplete dari nama yang pernah dipakai user. Nomor WA tidak disimpan.
3. Pemasukan memakai kategori sistem baru **Patungan** (`kode_sistem = PATUNGAN`, tipe masuk), dibuat otomatis seperti `BIAYA_ADMIN`.
4. Akun penerima default = akun bernama GoPay milik user (kalau ada), bisa diganti per split.
5. Centang lunas → buat transaksi masuk. Uncentang → hapus transaksi itu. Hapus split → hapus transaksi keluar + semua transaksi masuknya.
6. Foto struk tidak disimpan.

## 3. Model data (Google Sheets)

Semua sheet baru memakai kolom AUDIT di akhir dan difilter `user_id` (isolasi data seperti sheet lain). Template & `/api/health/sheets` ikut diperbarui.

**SplitBill** (prefix ID `SB`)
| kolom | tipe | ket |
|---|---|---|
| id | teks | |
| user_id | teks | |
| tanggal | tanggal | tanggal struk; menentukan periode transaksi keluar |
| nama | teks | mis. "Makan Bakmi" |
| akun_id | teks | akun pembayar (transaksi keluar) |
| kategori_id | teks | kategori keluar |
| akun_terima_id | teks | akun tujuan transaksi masuk |
| pajak | angka | rupiah |
| servis | angka | rupiah |
| diskon | angka | rupiah, positif |
| total | angka | subtotal item + pajak + servis − diskon |
| transaksi_id | teks | transaksi keluar |

**SplitItem** (prefix `SI`)
| kolom | tipe | ket |
|---|---|---|
| id, user_id, split_id | teks | |
| nama | teks | |
| qty | angka | ≥ 1 |
| harga | angka | harga total baris (bukan per unit) |
| peserta | teks | id peserta dipisah koma; kosong tidak boleh |
| urutan | angka | |

**SplitPeserta** (prefix `SP`)
| kolom | tipe | ket |
|---|---|---|
| id, user_id, split_id | teks | |
| nama | teks | |
| saya | boolean | peserta = pengguna sendiri (tepat 1 per split) |
| nominal | angka | hasil hitung server |
| lunas | boolean | "saya" selalu true |
| transaksi_id | teks | transaksi masuk saat lunas |
| urutan | angka | |

**Pengaturan** (prefix `PG`)
| kolom | tipe | ket |
|---|---|---|
| id, user_id | teks | |
| kunci | teks | `qris` |
| nilai | teks | payload QRIS statis (string EMV) |

Kategori sistem baru di `KATEGORI_SISTEM` (`server/services/pengguna.ts`): `{ kode: "PATUNGAN", nama: "Patungan", tipe: "masuk" }`.

## 4. Perhitungan bagian (`server/services/split.ts`)

1. Subtotal per peserta = Σ item: `harga / jumlahPesertaItem` untuk tiap peserta item itu (pecahan disimpan presisi penuh dulu).
2. Faktor `f = (pajak + servis − diskon) / Σ subtotal item`. Bagian = subtotal × (1 + f).
3. Bulatkan tiap bagian ke rupiah (`Math.round`). Selisih `total − Σ bagian` ditambahkan ke peserta "saya", sehingga Σ bagian = total tepat.
4. Bagi rata (frontend): semua item di-assign ke semua peserta → hasil sama dengan total / n.

Validasi (422, `errors` per field):
- min 1 item, tiap item `harga > 0`, `qty ≥ 1`, min 1 peserta di tiap item (`items.{i}.peserta`).
- min 2 peserta, tepat 1 `saya`, nama tidak kosong & tidak dobel (`peserta.{i}.nama`).
- `pajak, servis, diskon ≥ 0`, total > 0.
- akun pembayar/penerima harus akun milik user; kategori harus tipe keluar & aktif.

## 5. QRIS (`server/common/qris.ts` + `src/lib/qris.ts`)

Browser tidak boleh import dari `server/`, dan function Vercel dikompilasi per file, jadi logika diduplikasi kecil: `server/common/qris.ts` (parse + validasi, dipakai `PUT /api/pengaturan/qris`) dan `src/lib/qris.ts` (parse + validasi + buat dinamis, dipakai kartu bagikan). Keduanya diuji dengan vektor yang sama.

- Parse TLV EMV (tag 2 digit, panjang 2 digit). Wajib: `00=01`, `01` ada, `58=ID`, ada merchant account info berisi `ID.CO.QRIS`, `63` = CRC16-CCITT (poly 0x1021, init 0xFFFF) valid.
- Nama merchant dari tag `59`, kota tag `60` (ditampilkan saat simpan).
- Dinamis: ubah `01` jadi `12`, buang tag `54` lama bila ada, sisipkan `54` = nominal (string integer) sebelum tag `58`, hitung ulang `63`.
- Payload bukan QRIS → 422 "Kode ini bukan QRIS. Pastikan QR dari GoPay Merchant/QRIS atas namamu."

## 6. API

Semua butuh login; mutasi butuh `X-Requested-With: saku`.

| Method | Path | Fungsi |
|---|---|---|
| GET | `/api/split` | daftar split user (ringkas: nama, tanggal, total, jumlah belum lunas & nominalnya) |
| GET | `/api/split/:id` | detail: split + item + peserta |
| POST | `/api/split` | buat split → hitung bagian, buat transaksi keluar, simpan semuanya; respons detail + `peringatan` (saldo/anggaran, sama seperti transaksi) |
| PUT | `/api/split/:id` | ganti isi (replace-all item & peserta). Peserta lunas tidak boleh dihapus (422 `peserta.{i}`); dicocokkan lewat `id`. Nominal transaksi keluar & masuk yang terkait ikut diperbarui |
| DELETE | `/api/split/:id` | hapus split + item + peserta + transaksi keluar + transaksi masuk |
| PUT | `/api/split/:id/peserta/:pid/lunas` | body `{ lunas: boolean, tanggal? }`. true → buat transaksi masuk (tanggal default hari ini WIB, akun = `akun_terima_id`, kategori PATUNGAN, deskripsi "Patungan <nama split> — <nama peserta>"). false → hapus transaksi masuk. Peserta `saya` → 422 |
| GET | `/api/split/nama` | daftar nama peserta yang pernah dipakai (autocomplete) |
| GET | `/api/pengaturan/qris` | `{ payload, merchant, kota } \| null` |
| PUT | `/api/pengaturan/qris` | body `{ payload }`, divalidasi §5; `null` untuk hapus |

Integritas transaksi terkait: `PUT/DELETE /api/transaksi/:id` untuk transaksi yang dirujuk `SplitBill.transaksi_id` atau `SplitPeserta.transaksi_id` → 409 "Transaksi ini bagian dari split bill <nama>. Ubah lewat halaman Split Bill." (handler transaksi ikut memuat `SplitBill` & `SplitPeserta`.)

Periode: transaksi keluar/masuk memakai aturan periode biasa (`periodeUntukTanggal`); tanpa periode cocok → error yang sama seperti transaksi biasa.

## 7. Frontend

Dependensi baru: `tesseract.js` (dynamic import, hanya di langkah scan), `jsqr` (decode QR dari gambar), `qrcode` (render QR ke canvas).

- **Pengaturan → QRIS** (`PengaturanPage`): upload/foto gambar QR → `jsqr` → validasi lokal → tampil merchant & kota → simpan. Tombol hapus.
- **Menu Lainnya → Split Bill** (`/split`): daftar split, badge "N belum bayar · Rp X". Tombol "Split baru".
- **`/split/baru`** wizard (juga dipakai untuk edit `/split/:id/ubah`):
  1. *Struk*: "Foto struk" (input file `capture=environment`) → Tesseract (`ind+eng`) dengan progress → parser baris: `nama … harga` (angka format Indonesia `12.000`/`12,000`), deteksi `qty x`, baris berlabel subtotal/total (diabaikan sebagai item), pajak/PB1/PPN, service/servis, diskon/potongan. Atau "Isi manual".
  2. *Item*: edit/tambah/hapus item, isi pajak, servis, diskon; total dihitung & dibandingkan dengan total hasil OCR (peringatan kalau beda).
  3. *Peserta*: tambah nama (autocomplete), "Saya" otomatis; assign item lewat chip per item; tombol "Bagi rata".
  4. *Ringkasan*: nama split, tanggal, akun pembayar, kategori, akun penerima, bagian tiap orang → Simpan.
- **`/split/:id`** detail: rincian, daftar peserta dengan nominal, checkbox Lunas (optimistic + toast), tombol **Bagikan** per peserta.
- **Kartu bagikan**: canvas ±1080 px lebar: judul split, tanggal, nama peserta, item miliknya (porsi), pajak/servis/diskon proporsional, total, QRIS dinamis bernominal, nama merchant, catatan "Simpan gambar lalu bayar lewat Scan → Galeri di aplikasi e-wallet". `navigator.share({ files: [png] })`; fallback unduh PNG. Kalau QRIS belum diatur, kartu tanpa QR + tautan ke Pengaturan.
- **Dashboard**: kartu kecil "Split bill: N orang belum bayar · Rp X" (hanya kalau ada), klik → `/split`.
- `invalidateKeuangan` ikut meng-invalidate `["split"]`.

## 8. Error & batasan

- OCR gagal/kosong → pesan "Struk tidak terbaca, isi manual atau foto ulang", lanjut manual.
- Akurasi Tesseract struk thermal ±60–80%; langkah edit wajib dilihat user.
- QR personal GoPay (bukan QRIS merchant) ditolak validasi §5.
- `navigator.share` dengan file tidak tersedia di desktop sebagian browser → unduh.

## 9. Test (Vitest)

- `tests/split.test.ts`: pembagian per item & bagi rata, pajak/servis/diskon proporsional, pembulatan Σ = total, validasi 422, buat/ubah/hapus beserta transaksi terkait, lunas/uncentang, peserta lunas tidak bisa dihapus, isolasi user (404), transaksi terkait ditolak 409 di `/api/transaksi`.
- `tests/qris.test.ts`: CRC16 vektor dikenal, statis → dinamis (tag 01=12, tag 54, CRC baru valid), payload non-QRIS ditolak.
- Parser OCR (`src/lib/parseStruk.ts`) diuji dengan contoh teks struk (fungsi murni, tanpa Tesseract).

## 10. Dokumen

`docs/SAKU_API_SPEC.md`: sheet baru (§5), aturan split (§7 baru), endpoint (§10). `template/Saku_Template.xlsx` di-generate ulang. Spreadsheet asli: tab `SplitBill`, `SplitItem`, `SplitPeserta`, `Pengaturan` dibuat dengan header.
