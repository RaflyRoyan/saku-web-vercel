# Saku API: Spesifikasi Implementasi

> **Untuk Claude Code.** Dokumen ini adalah sumber kebenaran untuk membangun backend **Saku**.
> Kerjakan bertahap sesuai [§14 Milestone](#14-milestone-pengerjaan). Setelah setiap milestone, jalankan `dotnet build` dan `dotnet test`.
> Kalau ada yang ambigu, **tanyakan ke user dulu**, jangan berasumsi.
> Bahasa: identifier kode boleh Inggris atau Indonesia, tapi **pesan error ke user wajib Bahasa Indonesia**.

---

## 1. Ringkasan

Saku adalah aplikasi pencatatan keuangan pribadi **multi-pengguna** (data terpisah per pengguna).

```
Flutter (HP) ──HTTPS + Bearer JWT──▶ Saku API (.NET 8, Render free, Docker) ──Service Account──▶ Google Sheets
```

Konsep inti:

| Konsep | Arti |
|---|---|
| **Akun** | Tempat penyimpanan uang: `bank` / `ewallet` / `cash` |
| **Periode** | Rentang dari satu kali "Mulai Periode Baru" sampai yang berikutnya (biasanya gajian ke gajian). Dimulai manual. Hanya **1 periode aktif** per pengguna. |
| **Saldo awal** | Modal setiap akun di awal periode. **Gaji masuk lewat sini**, bukan transaksi. Akun yang tidak diisi = 0. |
| **Transaksi** | `keluar` (pengeluaran), `masuk` (pemasukan tambahan selain gaji), `transfer` (pindah antar akun sendiri, opsional `biaya_admin`) |
| **Sisa** | Saldo akhir setiap akun saat periode ditutup. Otomatis dicatat ke Tabungan sebagai `setor`. Boleh minus. |
| **Tabungan** | Σ setor − Σ tarik. **Tarik** otomatis membuat transaksi `masuk` kategori `TARIK_TABUNGAN` di periode aktif. |
| **Berulang** | Langganan dengan pengingat H-n dan konfirmasi manual (bisa juga dilewati) |

---

## 2. Stack & package

| Kebutuhan | Pilihan |
|---|---|
| Runtime | .NET 8, ASP.NET Core **Minimal API** |
| Google Sheets | `Google.Apis.Sheets.v4` (Service Account, scope `https://www.googleapis.com/auth/spreadsheets`) |
| Auth | `Microsoft.AspNetCore.Authentication.JwtBearer` 8.x |
| Hash password | `System.Security.Cryptography.Rfc2898DeriveBytes.Pbkdf2` (bawaan .NET), **tanpa** package tambahan |
| Cache | `IMemoryCache` |
| Test | xUnit + `Microsoft.AspNetCore.Mvc.Testing` |
| Deploy | Docker (`mcr.microsoft.com/dotnet/aspnet:8.0-alpine`) di Render free, region Singapore |

Membuat credential Google:

```csharp
// Google.Apis.Auth versi baru:
var credential = CredentialFactory.FromJson<ServiceAccountCredential>(json)
    .ToGoogleCredential()
    .CreateScoped(SheetsService.Scope.Spreadsheets);
// Kalau CredentialFactory belum ada di versi yang terpasang: GoogleCredential.FromJson(json).CreateScoped(...)
```

---

## 3. Struktur proyek

```
saku/
├── api/
│   ├── Saku.Api/
│   │   ├── Program.cs                  # DI, auth, middleware, map endpoint
│   │   ├── Config/SakuOptions.cs
│   │   ├── Sheets/
│   │   │   ├── ISheetStore.cs          # abstraksi baca/tulis baris
│   │   │   ├── GoogleSheetStore.cs     # implementasi Google Sheets API
│   │   │   ├── InMemorySheetStore.cs   # untuk dev lokal & test (SHEETS_MODE=memory)
│   │   │   └── SheetSchema.cs          # nama sheet + urutan kolom (§5)
│   │   ├── Domain/                     # record/entity per sheet + enum
│   │   ├── Repositories/               # 1 repository per sheet, mapping baris ⇄ entity
│   │   ├── Services/                   # logika bisnis (§7–§9)
│   │   ├── Endpoints/                  # 1 file per grup endpoint (§10)
│   │   ├── Auth/                       # JWT, hash password, lockout
│   │   └── Common/                     # IdGenerator, Clock (WIB), ProblemDetails helper
│   ├── Saku.Api.Tests/
│   └── Dockerfile
├── render.yaml
└── template/Saku_Template.xlsx
```

---

## 4. Konfigurasi (environment variable)

| Nama | Wajib | Keterangan |
|---|---|---|
| `SPREADSHEET_ID` | ✅ (kecuali mode memory) | ID dari URL spreadsheet |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | ✅ (kecuali mode memory) | Isi file key JSON. Terima **JSON mentah atau base64** (deteksi: diawali `{` → mentah) |
| `JWT_SECRET` | ✅ | Minimal 32 karakter acak |
| `JWT_EXPIRE_DAYS` | | Default `30` |
| `SHEETS_MODE` | | `google` (default) / `memory` |
| `PORT` | | Diisi Render. Default lokal `5080`. `UseUrls($"http://0.0.0.0:{port}")` |
| `CORS_ORIGINS` | | Opsional, dipisah koma (untuk versi web nanti) |

Aplikasi **gagal start** dengan pesan jelas kalau env wajib kosong.

---

## 5. Model data Google Sheets

### 5.1 Aturan umum

1. Setiap sheet: **header di baris 1**, data mulai baris 2. **API membaca dan menulis berdasarkan urutan kolom** di tabel bawah, bukan berdasarkan nama header. Saat startup, **validasi bahwa header cocok**. Kalau tidak cocok, log error dan endpoint `/health/sheets` mengembalikan 503 dengan detail kolom yang salah.
2. **ID** = prefix + `-` + 8 karakter acak base32 huruf kecil (`a-z2-7`), mis. `TR-k3f9x2ab`. Unik global (cek tabrakan saat generate).

   | Sheet | Prefix |
   |---|---|
   | Pengguna | `US` |
   | Akun | `AK` |
   | Kategori | `KT` |
   | Periode | `PR` |
   | SaldoAwal | `SA` |
   | Transaksi | `TR` |
   | Berulang | `RB` |
   | BerulangLewati | `RL` |
   | Tabungan | `TB` |

3. **Per pengguna:** semua sheet kecuali `Pengguna` dan `KategoriDefault` punya `user_id`. **Setiap query wajib difilter `user_id` = pengguna yang login.** Mengakses ID milik pengguna lain → **404** (bukan 403, supaya tidak membocorkan keberadaan data).
4. **Kolom audit** (4 kolom terakhir di setiap sheet): `created_by, created_at, updated_by, updated_at`. Diisi API dari JWT, **tidak pernah dari body request**. Data seed: `created_by = SYSTEM`.
5. **Format nilai** (tulis dengan `valueInputOption=RAW`):

   | Tipe | Format |
   |---|---|
   | tanggal | teks `yyyy-MM-dd` |
   | bulan | teks `yyyy-MM` |
   | datetime | teks ISO 8601 offset WIB, mis. `2026-10-29T10:15:00+07:00` |
   | angka | number (bukan teks), tanpa pemisah ribuan |
   | boolean | `TRUE` / `FALSE` |
   | kosong | string kosong `""` |

6. **Baca** dengan `valueRenderOption=UNFORMATTED_VALUE` dan `dateTimeRenderOption=SERIAL_NUMBER`. Parser harus toleran:
   - Tanggal bisa berupa teks (`yyyy-MM-dd`, `d/M/yyyy`) **atau** serial number (kalau diketik manual) → `DateTime.FromOADate`.
   - Angka bisa berupa number atau teks (`"1.500.000"`, `"Rp 1.500.000"`).
   - Boolean bisa `true`, `"TRUE"`, atau `"true"`.
   - Baris yang `id`-nya kosong dilewati.
7. **Master tidak dihapus** (`aktif = FALSE`). Transaksi, SaldoAwal, BerulangLewati, dan Tabungan `tarik` boleh **hapus baris**.
8. Semua waktu memakai **WIB (UTC+7)**. Buat `IClock` supaya mudah di-mock di test.

### 5.2 Kolom per sheet (urutan = urutan kolom A, B, C, …)

**`Pengguna`** (tidak per-user)

| # | Kolom | Tipe | Aturan |
|---|---|---|---|
| A | id | teks | `US-…` |
| B | username | teks | unik (case-insensitive), disimpan huruf kecil, 3–30 karakter `[a-z0-9._]` |
| C | password_hash | teks | lihat §6.2 |
| D | nama | teks | 1–50 karakter |
| E | peran | teks | `admin` / `user` |
| F | aktif | boolean | |
| G | last_login | datetime | |
| H | versi_token | angka | mulai 1. Naik 1 saat ganti/reset password atau dinonaktifkan |
| I–L | audit | | |

**`Akun`**

| # | Kolom | Tipe | Aturan |
|---|---|---|---|
| A | id | teks | `AK-…` |
| B | user_id | teks | |
| C | nama | teks | 1–40 karakter, unik per user (case-insensitive, hanya di antara akun aktif) |
| D | jenis | teks | `bank` / `ewallet` / `cash` |
| E | urutan | angka | default = max + 1 |
| F | aktif | boolean | |
| G–J | audit | | |

**`AkunPengguna`** (akun master yang dipakai tiap pengguna, §7.1)

| # | Kolom | Tipe | Aturan |
|---|---|---|---|
| A | id | teks | `AP-…` |
| B | user_id | teks | |
| C | akun_id | teks | ID `Akun`, satu baris per akun per pengguna |
| D | urutan | angka | urutan milik pengguna, mulai 1 |
| E–H | audit | | |

**`Kategori`**

| # | Kolom | Tipe | Aturan |
|---|---|---|---|
| A | id | teks | `KT-…` |
| B | user_id | teks | |
| C | nama | teks | 1–40 karakter, unik per user + tipe (di antara kategori aktif) |
| D | tipe | teks | `masuk` / `keluar` |
| E | kode_sistem | teks | kosong, `BIAYA_ADMIN` (keluar), atau `TARIK_TABUNGAN` (masuk). **Kategori sistem tidak bisa dinonaktifkan, diganti tipenya, atau dibuat manual.** |
| F | aktif | boolean | |
| G–J | audit | | |

**`KategoriDefault`** (tidak per-user, read-only bagi API)

| # | Kolom | Tipe |
|---|---|---|
| A | id | `KD01` … |
| B | nama | teks |
| C | tipe | `masuk` / `keluar` |
| D | kode_sistem | teks |
| E | urutan | angka |
| F–I | audit | |

> Saat pengguna baru dibuat (setup awal atau oleh admin), **salin semua baris KategoriDefault** ke `Kategori` untuk pengguna tersebut. Kalau `BIAYA_ADMIN` atau `TARIK_TABUNGAN` tidak ada di KategoriDefault, tetap buat keduanya.

**`Periode`**

| # | Kolom | Tipe | Aturan |
|---|---|---|---|
| A | id | teks | `PR-…` |
| B | user_id | teks | |
| C | nama | teks | 1–50 karakter, default `"Periode {d MMM yyyy}"` |
| D | tanggal_mulai | tanggal | |
| E | tanggal_selesai | tanggal | **kosong = aktif**. Maksimal 1 aktif per user |
| F | keterangan | teks | opsional |
| G–J | audit | | |

**`SaldoAwal`**

| # | Kolom | Tipe | Aturan |
|---|---|---|---|
| A | id | teks | `SA-…` |
| B | user_id | teks | |
| C | periode_id | teks | |
| D | akun_id | teks | unik per (periode_id, akun_id) |
| E | saldo | angka | ≥ 0 |
| F–I | audit | | |

**`Transaksi`**

| # | Kolom | Tipe | Aturan |
|---|---|---|---|
| A | id | teks | `TR-…` |
| B | user_id | teks | |
| C | periode_id | teks | ditentukan server dari `tanggal` (§7.2) |
| D | tanggal | tanggal | |
| E | tipe | teks | `keluar` / `masuk` / `transfer` |
| F | akun_id | teks | sumber (keluar/transfer) atau penerima (masuk) |
| G | akun_tujuan_id | teks | wajib untuk transfer dan ≠ `akun_id`. Kosong untuk lainnya |
| H | kategori_id | teks | wajib untuk keluar/masuk, dan tipenya harus cocok. **Kosong untuk transfer** |
| I | nominal | angka | > 0, maks 1.000.000.000.000 |
| J | biaya_admin | angka | ≥ 0. Hanya untuk transfer (selain transfer harus 0) |
| K | deskripsi | teks | maks 200 karakter |
| L | berulang_id | teks | diisi oleh endpoint konfirmasi langganan |
| M–P | audit | | |

**`Berulang`**

| # | Kolom | Tipe | Aturan |
|---|---|---|---|
| A | id | teks | `RB-…` |
| B | user_id | teks | |
| C | nama | teks | 1–50 karakter |
| D | akun_id | teks | akun aktif |
| E | kategori_id | teks | kategori `keluar` aktif |
| F | nominal | angka | > 0 |
| G | tgl_jatuh_tempo | angka | 1–31 |
| H | ingatkan_h_min | angka | 0–15, default 3 |
| I | mulai | bulan | |
| J | selesai | bulan | kosong = tanpa batas, ≥ mulai |
| K | aktif | boolean | |
| L–O | audit | | |

**`BerulangLewati`**

| # | Kolom | Tipe | Aturan |
|---|---|---|---|
| A | id | teks | `RL-…` |
| B | user_id | teks | |
| C | berulang_id | teks | |
| D | bulan | bulan | unik per (berulang_id, bulan) |
| E–H | audit | | |

**`Tabungan`**

| # | Kolom | Tipe | Aturan |
|---|---|---|---|
| A | id | teks | `TB-…` |
| B | user_id | teks | |
| C | tanggal | tanggal | setor = tanggal_selesai periode asal; tarik = input |
| D | jenis | teks | `setor` / `tarik` |
| E | periode_id | teks | setor: periode asal sisa. Tarik: periode aktif saat ditarik |
| F | akun_id | teks | |
| G | nominal | angka | setor boleh minus/0; tarik > 0 |
| H | keterangan | teks | setor: `"Sisa {nama periode}"` |
| I | transaksi_id | teks | tarik: ID transaksi `masuk` TARIK_TABUNGAN yang dibuat otomatis |
| J–M | audit | | |

---

## 6. Autentikasi & otorisasi

### 6.1 Alur

| Langkah | Detail |
|---|---|
| Setup awal | `GET /api/auth/status` → `{ "perluSetup": true }` kalau sheet Pengguna kosong. `POST /api/auth/setup` membuat **admin pertama**. Hanya bisa dipanggil **sekali**: kalau sudah ada pengguna → 409. Kategori default ikut disalin. |
| Login | `POST /api/auth/login` `{username, password}` → `{ token, expiresAt, pengguna }`. Update `last_login`. |
| Request | Header `Authorization: Bearer <token>`. Semua `/api/*` wajib token **kecuali** `auth/status`, `auth/setup`, dan `auth/login`. |
| Token | JWT HS256 dengan claim `sub` = user id, `role` = peran, `ver` = versi_token, `name` = nama. Berlaku `JWT_EXPIRE_DAYS` hari. |
| Validasi token | Setiap request: cek pengguna masih `aktif` dan `ver` == `versi_token` di sheet (pakai cache pengguna 60 detik). Kalau tidak cocok → 401 `"Sesi berakhir, silakan login ulang."` |
| Ganti password | `PUT /api/auth/password` `{passwordLama, passwordBaru}` → `versi_token++`, lalu kembalikan token baru. |
| Lockout | Gagal login **5×** dalam 15 menit per username → kunci 15 menit (simpan in-memory, cukup karena 1 instance). Pesan error **sama** untuk username salah dan password salah: `"Username atau password salah."` |

### 6.2 Hash password

- Format string: `pbkdf2-sha256$<iterasi>$<salt base64>$<hash base64>`
- Iterasi `600000`, salt 16 byte acak, hash 32 byte
- Bandingkan dengan `CryptographicOperations.FixedTimeEquals`
- Aturan password: minimal 8 karakter, mengandung huruf dan angka

### 6.3 Peran

| Peran | Hak |
|---|---|
| `user` | Hanya data miliknya sendiri |
| `admin` | Sama dengan `user`, ditambah kelola pengguna (§10.2). **Admin tidak bisa melihat data keuangan pengguna lain.** |

- Admin tidak bisa menonaktifkan dirinya sendiri.
- Harus selalu ada minimal 1 admin aktif.

---

## 7. Aturan bisnis

### 7.1 Akun & kategori

- Akun atau kategori yang **nonaktif** tidak boleh dipakai di transaksi baru, saldo awal baru, atau langganan baru. Tetapi tetap tampil di riwayat dan ringkasan kalau punya data di periode tersebut.
- Akun tidak bisa dinonaktifkan kalau saldonya di periode aktif ≠ 0 → 409 `"Saldo akun masih Rp X. Pindahkan dulu sebelum dinonaktifkan."`
- Ubah nama, jenis, dan urutan selalu boleh.
- **Akun pilihan pengguna** (sheet `AkunPengguna`, diatur di Pengaturan → Akun saya): tiap pengguna memilih akun master yang dipakai + urutannya sendiri.
  - Pengguna yang belum punya baris sama sekali = memakai semua akun aktif dengan urutan master (pengguna lama).
  - Setelah pilihan disimpan, akun baru dari admin **tidak** otomatis dipilih.
  - Akun yang tidak dipilih ditolak di transaksi baru (asal/tujuan), langganan, tarik tabungan, dan saldo awal > 0 → 400 `"Akun X belum dipilih di Pengaturan."`. Nilai lama saat edit tetap boleh.
  - Akun tidak bisa dilepas kalau saldonya di periode aktif pengguna ≠ 0 → 409 `"Saldo X masih Rp Y. Pindahkan dulu sebelum akun dilepas."`
  - Ringkasan menampilkan akun aktif yang dipilih + akun lain yang punya data di periode itu, urut menurut pengguna.

### 7.2 Penentuan `periode_id` transaksi

Diberi `tanggal` dari pengguna:

1. Cari periode milik user yang mencakup tanggal tersebut: `tanggal_mulai ≤ tanggal ≤ (tanggal_selesai ?? ∞)`.
2. Kalau tidak ketemu (tanggal sebelum periode pertama, atau belum ada periode sama sekali) → 422 `"Belum ada periode untuk tanggal ini. Mulai periode baru dulu."`
3. Tanggal di masa depan diperbolehkan maksimal sampai hari ini + 31 hari.

Saat transaksi di-**edit** dan tanggalnya berubah, `periode_id` dihitung ulang.

### 7.3 Rumus saldo per akun dalam satu periode

```
saldo_awal     = SaldoAwal.saldo (periode, akun) atau 0
masuk          = Σ nominal  tipe=masuk    dengan akun_id=akun
keluar         = Σ nominal  tipe=keluar   dengan akun_id=akun
biaya_admin    = Σ biaya_admin tipe=transfer dengan akun_id=akun
transfer_masuk = Σ nominal  tipe=transfer dengan akun_tujuan_id=akun
transfer_keluar= Σ nominal  tipe=transfer dengan akun_id=akun

saldo_akhir = saldo_awal + masuk − keluar − biaya_admin + transfer_masuk − transfer_keluar
```

Hanya transaksi dengan `periode_id` = periode tersebut yang dihitung.

Dalam **laporan per kategori**, `biaya_admin` dihitung sebagai pengeluaran kategori `BIAYA_ADMIN` dari akun asal, digabung dengan transaksi `keluar` biasa yang memakai kategori itu.

`total_pengeluaran` periode = Σ keluar + Σ biaya_admin. Transfer **tidak** termasuk.

Peringatan saldo minus **tidak memblokir** transaksi. Response transaksi menyertakan `peringatan: ["Saldo BCA menjadi minus Rp 25.000"]`.

### 7.4 Mulai periode baru (tutup buku)

`POST /api/periode/mulai`, dikerjakan di bawah **write lock** dan bersifat atomik secara logika:

1. Validasi input:
   - `tanggalMulai` default = hari ini.
   - Kalau ada periode aktif P: `tanggalMulai` > `P.tanggal_mulai`, dan **tidak ada transaksi P yang bertanggal ≥ `tanggalMulai`**. Kalau ada → 409 dengan daftar transaksi tersebut.
   - `saldoAwal[]`: setiap akun_id harus milik user, aktif, tidak duplikat, saldo ≥ 0. Akun aktif yang tidak dikirim dianggap 0 dan **tidak** dibuatkan baris SaldoAwal.
2. Kalau ada P:
   1. `P.tanggal_selesai = tanggalMulai − 1 hari`.
   2. Hitung `saldo_akhir` setiap akun untuk P (§7.3). Akun yang dihitung = akun yang punya SaldoAwal atau transaksi di P.
   3. Untuk setiap akun tersebut, **upsert** baris Tabungan `jenis=setor, periode_id=P, akun_id` dengan `nominal = saldo_akhir`, `tanggal = P.tanggal_selesai`, `keterangan = "Sisa {P.nama}"`. Nominal 0 tetap dicatat supaya jelas.
3. Buat Periode baru dan baris SaldoAwal-nya.
4. Response: periode baru, ringkasan setor tabungan dari P, dan total tabungan.

Urutan tulis ke Sheets: tabungan → update P → periode baru → saldo awal. Kalau gagal di tengah jalan, endpoint harus **idempoten saat diulang**:
- Upsert tabungan.
- Kalau P sudah tertutup dengan `tanggal_selesai = tanggalMulai − 1` dan periode baru belum ada, lanjutkan saja.

Log setiap langkah.

`GET /api/periode/aktif/pratinjau-tutup` mengembalikan **pratinjau** sisa setiap akun yang akan masuk tabungan, tanpa menulis apa pun.

### 7.5 Konsistensi tabungan setelah edit

Kalau ada perubahan pada **periode yang sudah tertutup**, yaitu:
- tambah, edit, atau hapus transaksi,
- edit saldo awal,
- transaksi pindah periode karena tanggalnya diedit,

maka **hitung ulang** baris Tabungan `setor` untuk periode yang terdampak (bisa 2 periode kalau transaksi pindah) dengan upsert per akun. Ini memastikan tidak pernah ada setor ganda.

### 7.6 Tarik tabungan

`POST /api/tabungan/tarik` `{tanggal?, akunId, nominal, keterangan}`:

1. Harus ada periode aktif, dan tanggal (default hari ini) berada di periode aktif.
2. `nominal` ≤ saldo tabungan **akun tersebut** (Σ setor − Σ tarik untuk akun_id). Kalau lebih → 422 `"Tabungan di {akun} hanya Rp X."`
3. Buat **Transaksi** `tipe=masuk`, kategori `TARIK_TABUNGAN`, akun_id yang sama, deskripsi = keterangan.
4. Buat baris **Tabungan** `jenis=tarik`, `periode_id` = periode aktif, `transaksi_id` = ID transaksi dari langkah 3.

Alasannya: uang tabungan yang ditarik menambah modal periode aktif, lalu pemakaiannya dicatat sebagai pengeluaran biasa. Tanpa transaksi `masuk` ini, uang akan terhitung dua kali.

Aturan terkait:
- Menghapus tarik tabungan (`DELETE /api/tabungan/{id}`, hanya untuk `jenis=tarik` di periode aktif) juga menghapus transaksinya.
- Transaksi dengan kategori `TARIK_TABUNGAN` **tidak boleh diedit atau dihapus lewat endpoint transaksi** → 409 `"Ubah lewat menu Tabungan."`
- Kategori `TARIK_TABUNGAN` tidak muncul di pilihan kategori saat membuat transaksi `masuk` biasa (endpoint kategori mendukung filter `untukInput=true`).

### 7.7 Langganan (Berulang)

Untuk tanggal acuan `hari` (default hari ini, WIB):

- **Jatuh tempo di bulan B** = `min(tgl_jatuh_tempo, hari terakhir bulan B)`.
- Langganan **berlaku** di bulan B kalau `aktif`, `mulai ≤ B`, dan `(selesai kosong atau B ≤ selesai)`.
- **Sudah dibayar** di bulan B = ada transaksi dengan `berulang_id` ini yang tanggalnya di bulan B.
- **Dilewati** = ada baris BerulangLewati (berulang_id, B).
- **Pengingat**: periksa B = bulan ini **dan** bulan depan (karena H-n bisa melewati batas bulan). Tampilkan kalau berlaku, belum dibayar, belum dilewati, dan `hari ≥ jatuh_tempo − ingatkan_h_min`.
  - Status `akan_datang` kalau hari < jatuh tempo, `hari_ini`, atau `terlambat` (hari > jatuh tempo, hanya untuk bulan berjalan).
  - Bulan sebelumnya yang terlewat **tidak** ditampilkan.
- **Konfirmasi** `POST /api/berulang/{id}/konfirmasi` `{bulan, tanggal?, nominal?, akunId?, deskripsi?}`:
  - Membuat transaksi `keluar` dengan nilai default dari data langganan. `tanggal` default = hari ini, `deskripsi` default = nama langganan.
  - Kalau bulan itu sudah dibayar → 409.
- **Lewati** `POST /api/berulang/{id}/lewati` `{bulan}`. **Batal lewati** `DELETE /api/berulang/{id}/lewati/{bulan}`.

---

## 8. Akses Google Sheets

| Topik | Aturan |
|---|---|
| Kuota | Sheets API: ±60 request baca/menit/user. **Baca banyak sheet sekaligus dengan `values:batchGet`**, jangan satu per satu. |
| Cache | Cache **seluruh isi setiap sheet** di `IMemoryCache` (TTL 30 detik, master 5 menit). **Invalidasi sheet terkait setelah setiap tulis.** |
| Tulis | `values:append` (`insertDataOption=INSERT_ROWS`) untuk baris baru. `values:update` untuk ubah satu baris (range `Sheet!A{row}:{lastCol}{row}`). `batchUpdate` + `deleteDimension` untuk hapus baris (butuh `sheetId` numerik, di-cache). Beberapa update sekaligus → `values:batchUpdate`. |
| Lock | Satu `SemaphoreSlim(1,1)` global untuk **semua operasi tulis** (Render free = 1 instance). Sebelum update atau hapus, **baca ulang sheet tanpa cache** di dalam lock untuk mendapatkan nomor baris terbaru berdasarkan `id`. |
| Retry | 429 dan 5xx dari Google → retry 3× dengan exponential backoff (500 ms, 1 s, 2 s). |
| Error | 403 dari Google → log `"Spreadsheet belum di-share ke {email service account}"`. Ke client cukup 502 `"Gagal mengakses penyimpanan data."` |
| Abstraksi | `ISheetStore` dengan method `ReadAllAsync(sheet)`, `ReadManyAsync(sheets[])`, `AppendAsync(sheet, rows)`, `UpdateRowAsync(sheet, rowNumber, values)`, `DeleteRowAsync(sheet, rowNumber)`. `InMemorySheetStore` mengimplementasikan interface yang sama untuk test. |

---

## 9. Validasi & format error

- Semua error memakai **ProblemDetails** (`application/problem+json`) dengan `title` dalam Bahasa Indonesia.
- Validasi per field → 400 `ValidationProblem` dengan `errors: { "nominal": ["Nominal harus lebih dari 0."] }`. Nama field memakai camelCase sesuai body.

| Status | Kapan |
|---|---|
| 400 | Input tidak valid / JSON rusak |
| 401 | Token tidak ada, salah, kedaluwarsa, atau versi token tidak cocok |
| 403 | Bukan admin pada endpoint admin |
| 404 | Data tidak ada **atau milik user lain** |
| 409 | Konflik aturan: duplikat, setup sudah dilakukan, sudah dibayar, kategori sistem, dll. |
| 422 | Aturan bisnis gagal: tidak ada periode, tabungan kurang, dll. |
| 429 | Lockout login / kuota Google |
| 502 | Gagal akses Google Sheets |

JSON memakai camelCase, tanggal `yyyy-MM-dd`, dan datetime ISO.

---

## 10. Endpoint

Semua endpoint di bawah `/api` wajib token, kecuali yang ditandai 🔓.

### 10.1 Auth

| Method | Path | Body / Query | Response |
|---|---|---|---|
| GET 🔓 | `/api/auth/status` | | `{ perluSetup }` |
| POST 🔓 | `/api/auth/setup` | `{ username, password, nama }` | 201 `{ token, expiresAt, pengguna }` |
| POST 🔓 | `/api/auth/login` | `{ username, password }` | `{ token, expiresAt, pengguna }` |
| GET | `/api/auth/me` | | `pengguna` |
| PUT | `/api/auth/password` | `{ passwordLama, passwordBaru }` | `{ token, expiresAt }` |
| PUT | `/api/auth/profil` | `{ nama }` | `pengguna` |

`pengguna` = `{ id, username, nama, peran, aktif, lastLogin }`. **`password_hash` tidak pernah dikirim.**

### 10.2 Pengguna (admin)

| Method | Path | Body | Keterangan |
|---|---|---|---|
| GET | `/api/pengguna` | | Daftar semua pengguna |
| POST | `/api/pengguna` | `{ username, password, nama, peran }` | Kategori default ikut disalin |
| PUT | `/api/pengguna/{id}` | `{ nama, peran, aktif }` | Nonaktif → `versi_token++` |
| POST | `/api/pengguna/{id}/reset-password` | `{ passwordBaru }` | `versi_token++` |

### 10.3 Akun

| Method | Path | Body / Query | Keterangan |
|---|---|---|---|
| GET | `/api/akun?termasukNonaktif=false` | | `false`: akun aktif yang dipilih pengguna, urut pengguna. `true`: semua akun, urut `urutan` master. Sertakan `saldo` pada periode aktif (atau `null` kalau belum ada periode), `dipilih`, dan `urutanSaya` |
| GET | `/api/akun/pilihan` | | `{ eksplisit, akun: [{ id, nama, jenis, dipilih, saldo }] }`. Akun aktif: yang dipilih dulu (urut pengguna), lalu sisanya |
| PUT | `/api/akun/pilihan` | `{ ids: [...] }` | Ganti pilihan akun pengguna; urutan = urutan `ids`. Minimal 1, akun harus aktif. Aturan §7.1 |
| POST | `/api/akun` | `{ nama, jenis, urutan? }` | |
| PUT | `/api/akun/{id}` | `{ nama, jenis, urutan }` | |
| PUT | `/api/akun/{id}/aktif` | `{ aktif }` | Aturan §7.1 |
| PUT | `/api/akun/urutan` | `{ ids: [...] }` | Atur ulang urutan sekaligus |

### 10.4 Kategori

| Method | Path | Body / Query | Keterangan |
|---|---|---|---|
| GET | `/api/kategori?tipe=keluar&untukInput=true&termasukNonaktif=false` | | `untukInput=true` menyembunyikan TARIK_TABUNGAN dan BIAYA_ADMIN |
| POST | `/api/kategori` | `{ nama, tipe }` | |
| PUT | `/api/kategori/{id}` | `{ nama }` | Tipe tidak bisa diubah |
| PUT | `/api/kategori/{id}/aktif` | `{ aktif }` | Kategori sistem → 409 |

### 10.5 Periode

| Method | Path | Body | Keterangan |
|---|---|---|---|
| GET | `/api/periode` | | Semua periode, terbaru di atas |
| GET | `/api/periode/aktif` | | Periode aktif + saldo awal, atau 404 kalau belum ada |
| GET | `/api/periode/aktif/pratinjau-tutup` | | §7.4 pratinjau |
| POST | `/api/periode/mulai` | `{ nama?, tanggalMulai?, keterangan?, saldoAwal: [{ akunId, saldo }] }` | §7.4 |
| PUT | `/api/periode/{id}` | `{ nama, keterangan }` | Tanggal tidak bisa diubah lewat sini |
| PUT | `/api/periode/{id}/saldo-awal` | `{ saldoAwal: [{ akunId, saldo }] }` | Ganti seluruh saldo awal periode itu (upsert + hapus yang tidak dikirim). Periode tertutup → hitung ulang tabungan (§7.5) |
| GET | `/api/periode/{id}/ringkasan` | | §10.9 |

### 10.6 Transaksi

| Method | Path | Body / Query | Keterangan |
|---|---|---|---|
| GET | `/api/transaksi` | `periodeId` (default aktif), `akunId`, `tipe`, `kategoriId`, `q` (cari deskripsi), `dari`, `sampai`, `halaman`=1, `ukuran`=50 (maks 200) | Urut tanggal desc, lalu created_at desc. Response `{ data, total, halaman, ukuran }`. **Filter `akunId` juga mencakup transfer dengan akun tersebut sebagai tujuan.** Setiap item disertai nama akun/kategori (denormalisasi untuk tampilan). |
| GET | `/api/transaksi/{id}` | | |
| POST | `/api/transaksi` | `{ tanggal?, tipe, akunId, akunTujuanId?, kategoriId?, nominal, biayaAdmin?, deskripsi? }` | 201. Response menyertakan `peringatan[]` |
| PUT | `/api/transaksi/{id}` | Sama dengan POST | Aturan §7.5 dan §7.6 |
| DELETE | `/api/transaksi/{id}` | | 204. Aturan §7.5 dan §7.6 |

### 10.7 Berulang

| Method | Path | Body | Keterangan |
|---|---|---|---|
| GET | `/api/berulang?termasukNonaktif=false` | | Sertakan status bulan ini: `belum`, `dibayar` (+ transaksiId), atau `dilewati` |
| POST | `/api/berulang` | `{ nama, akunId, kategoriId, nominal, tglJatuhTempo, ingatkanHMin?, mulai, selesai? }` | |
| PUT | `/api/berulang/{id}` | Sama dengan POST + `aktif` | |
| GET | `/api/berulang/pengingat?tanggal=` | | §7.7 → `[{ berulang, bulan, jatuhTempo, status, sisaHari }]` |
| POST | `/api/berulang/{id}/konfirmasi` | `{ bulan, tanggal?, nominal?, akunId?, deskripsi? }` | 201 transaksi |
| POST | `/api/berulang/{id}/lewati` | `{ bulan }` | 201 |
| DELETE | `/api/berulang/{id}/lewati/{bulan}` | | 204 |

### 10.8 Tabungan

| Method | Path | Body | Keterangan |
|---|---|---|---|
| GET | `/api/tabungan` | | `{ total, perAkun: [{ akunId, nama, setor, tarik, saldo }], riwayat: [...] }` |
| POST | `/api/tabungan/tarik` | `{ tanggal?, akunId, nominal, keterangan }` | §7.6 |
| DELETE | `/api/tabungan/{id}` | | Hanya `tarik` di periode aktif |

### 10.9 Ringkasan & dashboard

`GET /api/periode/{id}/ringkasan`:

```json
{
  "periode": { "id": "PR-…", "nama": "Gajian Nov 2026", "tanggalMulai": "2026-11-25", "tanggalSelesai": null, "aktif": true },
  "totalSaldoAwal": 6000000,
  "totalMasuk": 0,
  "totalPengeluaran": 3500,
  "totalSaldoAkhir": 5996500,
  "perAkun": [
    {
      "akunId": "AK-…", "nama": "BCA", "jenis": "bank",
      "saldoAwal": 6000000, "masuk": 0, "keluar": 0, "biayaAdmin": 2500,
      "transferMasuk": 0, "transferKeluar": 3000000, "saldoAkhir": 2997500,
      "jumlahTransaksi": 2,
      "pengeluaranPerKategori": [{ "kategoriId": "KT-…", "nama": "Biaya Admin Bank", "total": 2500, "jumlah": 1 }]
    }
  ],
  "pengeluaranPerKategori": [ … ],
  "pemasukanPerKategori": [ … ],
  "setorTabungan": [ { "akunId": "…", "nominal": 0 } ]
}
```

- `perAkun` berisi semua akun aktif, ditambah akun nonaktif yang punya data di periode itu. Urut `urutan`.
- `setorTabungan` hanya terisi untuk periode yang sudah tertutup.

`GET /api/dashboard` = ringkasan periode aktif (atau `null`) + `totalTabungan` + `pengingat` (§7.7) + `transaksiTerakhir` (5 item).

### 10.10 Health

| Path | Auth | Keterangan |
|---|---|---|
| `GET /health` | 🔓 | `{ status: "ok", waktu }` tanpa menyentuh Google. Dipakai Render dan cron ping. |
| `GET /health/sheets` | 🔓 | Cek koneksi + validasi header semua sheet. 200 `{ ok: true, sheets: [...] }` atau 503 dengan detail. **Jangan bocorkan data, cukup nama sheet dan status.** |

---

## 11. Non-fungsional

- **Rate limit** (`Microsoft.AspNetCore.RateLimiting`): 120 request/menit per user, dan 10/menit per IP untuk `/api/auth/login`.
- **Logging:** request method, path, status, dan durasi. **Jangan pernah log** password, token, atau isi JSON service account.
- Response gzip.
- Kompatibel dengan Render free: start < 10 detik dan RAM < 300 MB. Image alpine, `DOTNET_gcServer=0`.
- **Swagger/OpenAPI** hanya aktif di Development.

---

## 12. Deploy

`api/Dockerfile`: multi-stage `sdk:8.0-alpine` → `aspnet:8.0-alpine`, `EXPOSE 10000`, `ENV DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=true`.

`render.yaml`:

```yaml
services:
  - type: web
    name: saku-api
    runtime: docker
    plan: free
    region: singapore
    dockerContext: ./api
    dockerfilePath: ./api/Dockerfile
    healthCheckPath: /health
    envVars:
      - key: SPREADSHEET_ID
        sync: false
      - key: GOOGLE_SERVICE_ACCOUNT_JSON
        sync: false
      - key: JWT_SECRET
        generateValue: true
```

Cron ping (cron-job.org): `GET /health` setiap 10 menit, jam 06.00–23.00 WIB.

---

## 13. Pengujian (wajib)

Gunakan `InMemorySheetStore` + `IClock` palsu. Minimal skenario berikut harus lulus:

| # | Skenario | Ekspektasi |
|---|---|---|
| T1 | Setup awal dua kali | Kedua kalinya 409. Kategori default tersalin (termasuk 2 kategori sistem) |
| T2 | Login salah 5× | Percobaan ke-6 → 429 walaupun password benar. Setelah 15 menit (clock maju) bisa login |
| T3 | Ganti password | Token lama → 401, token baru OK |
| T4 | User A akses transaksi milik user B | 404 |
| T5 | **Bagi gaji** (contoh README): mulai periode BCA 6.000.000. Transfer BCA→Mandiri 2.000.000 (admin 2.500), BCA→Jago 1.000.000, Jago→GoPay 300.000 (admin 1.000) | Saldo akhir BCA 2.997.500 · Mandiri 2.000.000 · Jago 699.000 · GoPay 300.000 · total 5.996.500 · totalPengeluaran 3.500 · kategori Biaya Admin Bank 3.500 |
| T6 | Lanjutan T5: keluar 25.000 dari GoPay, lalu mulai periode baru dengan BCA 6.000.000 | Tabungan setor: BCA 2.997.500, Mandiri 2.000.000, Jago 699.000, GoPay 275.000 → total 5.971.500. Periode lama `tanggal_selesai` = mulai baru − 1 |
| T7 | Edit transaksi GoPay di periode lama dari 25.000 menjadi 50.000 | Setor GoPay menjadi 250.000, **tidak ada baris setor ganda** |
| T8 | Pengeluaran melebihi saldo | Transaksi tetap tersimpan, ada `peringatan`. Saat tutup periode, setor akun itu minus |
| T9 | Tarik tabungan 500.000 dari BCA | Tercipta transaksi masuk TARIK_TABUNGAN + baris tarik. Saldo tabungan BCA berkurang. Saldo akhir BCA periode aktif bertambah 500.000. Edit transaksi itu lewat endpoint transaksi → 409 |
| T10 | Tarik melebihi tabungan akun | 422 |
| T11 | Mulai periode dengan tanggal ≤ mulai periode aktif, atau ada transaksi setelah tanggal tersebut | 409 / 400 |
| T12 | Langganan tgl 31, bulan Februari | Jatuh tempo 28/29 Feb |
| T13 | Langganan tgl 2, H-3, hari ini 30 Okt | Muncul pengingat bulan November |
| T14 | Konfirmasi langganan dua kali di bulan sama | Kedua kalinya 409. Setelah lewati, tidak muncul di pengingat |
| T15 | Nonaktifkan akun bersaldo | 409. Saldo 0 → OK, dan akun tidak bisa dipakai di transaksi baru |
| T16 | Parser: tanggal serial number, nominal teks `"Rp 1.500.000"`, boolean `"TRUE"` | Terbaca benar |
| T17 | Header sheet salah urutan | `/health/sheets` → 503 |

Tambahkan juga test integrasi endpoint (WebApplicationFactory) untuk alur T5–T7 lewat HTTP.

---

## 14. Milestone pengerjaan

| # | Milestone | Selesai jika |
|---|---|---|
| M1 | Kerangka proyek, config, `ISheetStore` (memory + Google), schema & validasi header, parser nilai, `/health`, `/health/sheets` | T16, T17 lulus. `/health/sheets` OK terhadap spreadsheet asli |
| M2 | Auth: setup, login, JWT, hash, lockout, versi token, pengguna (admin), salin kategori default | T1–T4 lulus |
| M3 | Akun & kategori | T15 lulus |
| M4 | Periode, saldo awal, transaksi, ringkasan | T5, T8, T11 lulus |
| M5 | Tutup periode + tabungan (setor, hitung ulang, tarik) | T6, T7, T9, T10 lulus |
| M6 | Berulang + pengingat + dashboard | T12–T14 lulus |
| M7 | Rate limit, logging, Dockerfile, render.yaml, README API (cara run lokal, env, daftar endpoint) | Build Docker sukses, semua test hijau |

Setelah M7: deploy ke Render, isi env, cek `/health/sheets`, lalu lakukan setup awal lewat `POST /api/auth/setup`.

---

## Lampiran: keputusan desain

| Keputusan | Alasan |
|---|---|
| Saldo tidak disimpan | Selalu konsisten dengan transaksi |
| Setor tabungan disimpan (bukan dihitung saat dibaca) | Sesuai permintaan user ("sheet tabungan"). Konsistensi dijaga dengan hitung ulang §7.5 |
| Tarik tabungan membuat transaksi masuk | Mencegah uang terhitung dua kali (§7.6) |
| Relasi via ID | Nama akun/kategori bisa diganti tanpa merusak data |
| 404 untuk data user lain | Tidak membocorkan keberadaan data |
| Lock global + 1 instance | Google Sheets tidak punya transaksi atau locking. Render free memang hanya 1 instance |
