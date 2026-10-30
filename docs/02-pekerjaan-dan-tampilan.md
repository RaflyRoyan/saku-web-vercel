# Saku · 02 · Pekerjaan & Tampilan

> **Untuk Claude Code.** Dikerjakan setelah [`01-setup-proyek.md`](01-setup-proyek.md) selesai.
> - **Apa yang dikerjakan:** §3 (per milestone, berurutan).
> - **Bagaimana tampilannya:** §4–§6.
> - **Aturan bisnis, model data, endpoint, dan skenario uji (T1–T17):** [`SAKU_API_SPEC.md`](SAKU_API_SPEC.md). Bagian spec yang menyebut .NET/Render/Bearer token **diganti** oleh §2 dokumen ini.
>
> Setelah setiap milestone: `npm run build` + `npm test` harus lulus, lalu laporkan ke user. Kalau ambigu, tanya dulu.

---

## 1. Gambaran aplikasi

Saku mencatat keuangan pribadi per **periode** (gajian ke gajian), bukan per bulan kalender. Uang tersebar di beberapa **akun** (4 bank, e-wallet, cash). Yang ingin dilihat user setiap hari:

1. **Sisa uang di setiap akun** periode ini.
2. **Pengeluaran** periode ini, per kategori dan per akun, beserta deskripsinya.
3. **Langganan** yang sebentar lagi jatuh tempo.
4. **Total tabungan** (akumulasi sisa dari periode-periode sebelumnya).

Aksi yang paling sering: **catat pengeluaran** (harus bisa selesai < 10 detik di HP) dan **transfer antar akun**.

---

## 2. Penyesuaian stack terhadap `SAKU_API_SPEC.md`

| Bagian spec | Diganti menjadi |
|---|---|
| §2 Stack, §3 Struktur | Hono + Vercel Function (`api/index.ts`) + Vite React, struktur di `01-setup-proyek.md` (bagian Netlify diganti Vercel) |
| §4 Env | `SPREADSHEET_ID`, `GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `JWT_SECRET`, `JWT_EXPIRE_DAYS`, `SHEETS_MODE`. Tidak ada `PORT`/`CORS_ORIGINS` |
| §5.2 `Pengguna` | Tambah kolom **`gagal_login`** (angka) dan **`terkunci_sampai`** (datetime) setelah `versi_token`, sebelum kolom audit. Perbarui juga `template/buat_template.py` |
| §6.1 Token | JWT HS256 (`hono/jwt`) di **cookie** `saku_token`: `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=JWT_EXPIRE_DAYS`. Di lokal (http) tanpa `Secure`. Setup/login/ganti password **set cookie**. Body response tanpa `token`, hanya `{ pengguna, expiresAt }`. Tambah `POST /api/auth/logout` |
| §6.1 CSRF | POST/PUT/DELETE wajib header `X-Requested-With: saku` → kalau tidak ada, 403 |
| §6.1 Validasi token | Tanpa cache memori. Baca sheet `Pengguna` dalam `batchGet` yang sama dengan data handler |
| §6.1 Lockout | Disimpan di `gagal_login` / `terkunci_sampai`. Gagal ke-5 dalam 15 menit → kunci 15 menit. Sukses → reset |
| §6.2 Hash | `crypto.pbkdf2` async dari `node:crypto`, format string sama, `crypto.timingSafeEqual` |
| §8 Cache & Lock | Tidak ada cache lintas request dan tidak ada lock global. Setiap handler: **1 `values:batchGet`** untuk semua sheet yang dibutuhkan. Sebelum update/hapus, cari nomor baris berdasarkan `id` dari bacaan terbaru. Operasi multi-langkah tetap idempoten |
| §8 Batas waktu | Function maksimal ±10 detik. Tutup periode: gabungkan tulisan ke `values:batchUpdate` dan `append` multi-baris |
| §5.1 Waktu | Server berjalan di UTC. Semua tanggal dihitung di **WIB (UTC+7)** lewat `server/common/clock.ts` (bisa di-mock) |
| §10.10 Health | `/api/health` dan `/api/health/sheets` |
| §11 | Tanpa rate limit per IP, tanpa Swagger |
| §12 Deploy | Vercel (`vercel.json`, region `sin1`). Dokumen 01 masih menyebut Netlify |
| §13 Test | Vitest + `memory-store` + clock palsu. Test endpoint dengan `app.request()` |
| §5.1 butir 3, §5.2 `Akun`/`Kategori`/`KategoriDefault` | **Akun dan Kategori adalah master bersama** untuk semua pengguna: kolom `user_id` dihapus dari kedua sheet, sheet `KategoriDefault` dihapus. Kategori awal (termasuk 2 kategori sistem) langsung ada di sheet `Kategori` template. Sheet lain (`Periode`, `SaldoAwal`, `Transaksi`, `Berulang`, `BerulangLewati`, `Tabungan`) tetap per pengguna lewat `user_id` |
| §6.3 Peran, §10.3, §10.4 | `GET` akun & kategori boleh semua pengguna. `POST`/`PUT` akun & kategori **hanya admin** (bukan admin → 403). `saldo` di `GET /api/akun` dihitung dari data pengguna yang login saja |
| §7.1 Nonaktifkan akun | Ditolak kalau saldo akun ≠ 0 di periode aktif **milik pengguna mana pun** → 409 `"Saldo akun masih Rp X. Pindahkan dulu sebelum dinonaktifkan."` (X = saldo milik admin sendiri; kalau saldo admin 0 tapi ada pengguna lain yang belum 0, pesan: `"Akun masih dipakai pengguna lain dengan saldo ≠ 0."`) |
| §6.1 Setup, §10.2 tambah pengguna | Tidak ada penyalinan kategori. Setup awal cukup memastikan 2 kategori sistem (`BIAYA_ADMIN`, `TARIK_TABUNGAN`) ada di `Kategori`; kalau belum ada, buat |

---

## 3. Daftar pekerjaan per milestone

Satu milestone = satu merge ke `main` = satu production deploy.

### M1 · Akses Google Sheets

**Backend**
- [ ] `schema.ts`: nama sheet + urutan kolom semua sheet (spec §5.2 + kolom baru `Pengguna`)
- [ ] `parse.ts`: parser toleran (tanggal teks/serial, nominal `"Rp 1.500.000"`, boolean `"TRUE"`), baris tanpa `id` dilewati
- [ ] `store.ts`: interface `readMany(sheets[])`, `append(sheet, rows)`, `updateRow(sheet, row, values)`, `updateRows(...)`, `deleteRow(sheet, row)`
- [ ] `memory-store.ts` dan `google-store.ts` (retry 3× untuk 429/5xx; 403 → log "belum di-share")
- [ ] `config.ts` memilih store sesuai `SHEETS_MODE`
- [ ] `id.ts` (prefix + 8 karakter `a-z2-7`), `clock.ts` (WIB), `errors.ts` (ProblemDetails Bahasa Indonesia)
- [ ] `GET /api/health/sheets`: validasi header semua sheet

**Test:** T16, T17 · **Selesai jika** `/api/health/sheets` OK terhadap spreadsheet asli.

### M2 · Auth & pengguna

**Backend**
- [ ] Hash PBKDF2, JWT cookie, middleware auth (cek `aktif` + `versi_token`), middleware CSRF
- [ ] `GET /auth/status`, `POST /auth/setup` (pastikan 2 kategori sistem ada di `Kategori`), `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `PUT /auth/password`, `PUT /auth/profil`
- [ ] Lockout di sheet
- [ ] Endpoint admin `/pengguna` (spec §10.2), aturan "minimal 1 admin aktif"

**Frontend**
- [ ] Halaman **Setup Awal**, **Login** (§6.1)
- [ ] `useAuth` + route guard: belum login → `/login`. `perluSetup` → `/setup`. Respons 401 di mana pun → bersihkan cache, ke `/login` dengan toast "Sesi berakhir, silakan login ulang."
- [ ] Halaman **Lainnya**, **Pengaturan** (profil, ganti password, logout), **Kelola Pengguna** (admin saja)

**Test:** T1–T4

### M3 · Akun & kategori

**Backend:** endpoint spec §10.3, §10.4, aturan §7.1
**Frontend:** halaman **Master** (tab Akun / Kategori, §6.10)
**Test:** T15

### M4 · Periode, transaksi, ringkasan

**Backend**
- [ ] Periode (§10.5) kecuali `mulai` dan `pratinjau-tutup` (dikerjakan di M5), tapi **periode pertama** sudah bisa dibuat lewat `POST /periode/mulai` tanpa periode aktif
- [ ] Transaksi (§10.6, aturan §7.2, §7.3, `peringatan[]`)
- [ ] Ringkasan periode (§10.9)

**Frontend**
- [ ] **Form Transaksi** (§6.3), sheet ➕ dari bottom nav
- [ ] **Akun** (monitoring per akun, §6.4) dan **Detail Akun** (§6.5)
- [ ] **Riwayat** (§6.6)
- [ ] Kalau belum ada periode: tampilan kosong dengan tombol "Mulai periode pertama" (§6.7 versi tanpa pratinjau)

**Test:** T5, T8, T11

### M5 · Tutup periode & tabungan

**Backend:** `POST /periode/mulai` lengkap (§7.4), `pratinjau-tutup`, hitung ulang setor (§7.5), tabungan & tarik (§7.6, §10.8)
**Frontend:** **Mulai Periode Baru** (§6.7), **Tabungan** (§6.9)
**Test:** T6, T7, T9, T10

### M6 · Langganan & dashboard

**Backend:** berulang + pengingat (§7.7, §10.7), `GET /api/dashboard`
**Frontend:** **Dashboard** (§6.2), **Langganan** (§6.8)
**Test:** T12–T14

### M7 · PWA & polish

- [ ] Ikon final, manifest, `apple-touch-icon`, theme color
- [ ] Banner "Tidak ada koneksi" saat offline, banner "Versi baru tersedia" (atau auto update)
- [ ] Cek semua halaman di lebar 360 px dan 1280 px
- [ ] Checklist kualitas §7 terpenuhi
- [ ] `README.md`: cara run lokal, env, deploy

---

## 4. Sistem desain

### 4.1 Prinsip

1. **Mobile-first.** Target utama HP 360–430 px. Laptop memakai layout yang sama dengan lebar konten maksimum.
2. **Angka adalah fokus.** Nominal besar, tebal, dan mudah dipindai. Label kecil dan abu-abu.
3. **Warna berarti.** Hijau = masuk, merah mawar = keluar, ungu = transfer, emas = tabungan. Jangan dipakai untuk hal lain.
4. **Satu aksi utama per layar.** Tombol utama warna brand, sisanya sekunder/ghost.
5. **Cepat dicatat.** Form transaksi terbuka dengan fokus di nominal dan keyboard angka.
6. **Suasana Sunrise.** Hangat dan cerah seperti matahari terbit: latar krem, aksen oranye, dan gradasi langit fajar (ungu → merah mawar → oranye) **hanya** di kartu saldo utama. Bagian lain tetap bersih supaya angka mudah dibaca.

### 4.2 Token (tema Sunrise)

Semua token sudah didefinisikan di `src/index.css` (lihat `01-setup-proyek.md` §3.6).

| Token | Nilai | Pemakaian |
|---|---|---|
| Brand | `brand-700` `#c2410c` (oranye fajar) | Tombol utama, nav aktif, link, chip terpilih |
| Brand muda | `brand-50` `#fff7ed` · `brand-100` `#ffedd5` | Latar chip terpilih, hover, highlight |
| Aksen | `brand-500` `#f97316` · `brand-600` `#ea580c` | Ikon, garis progress, tombol ⊕ Catat (ikon putih). Tidak untuk teks kecil |
| Gradasi Sunrise | `#7e22ce` → `#be123c` → `#ea580c` (class `bg-sunrise`) | **Hanya** kartu saldo utama Dashboard dan header halaman Login |
| Masuk | `#047857` | Nominal & ikon pemasukan, transfer masuk |
| Keluar | `#be123c` | Nominal & ikon pengeluaran, saldo minus |
| Transfer | `#6d28d9` | Ikon transfer |
| Tabungan | `#a16207` (emas) | Kartu & ikon tabungan, latar kartu `#fefce8` |
| Latar | `#fffaf5` (krem) + cahaya `#ffedd5` tipis di bagian atas | Background halaman |
| Permukaan | `white` + `border-garis` `#f3e3d3` | Kartu, bottom nav, sheet |
| Teks | `stone-900` utama · `stone-500` sekunder · `stone-400` placeholder | Abu-abu hangat, bukan abu-abu kebiruan |
| Fokus | `ring-2 ring-brand-400 ring-offset-2` | Semua elemen yang bisa difokus |

Semua warna teks di atas putih/krem sudah memenuhi kontras ≥ 4.5:1. Teks putih di atas `bg-sunrise` dan `brand-700` juga aman.

| Elemen | Ukuran |
|---|---|
| Font | **Manrope** (variable, `@fontsource-variable/manrope`). Bentuknya bulat dan ramah, angkanya jelas, dan mendukung `tabular-nums` |
| Nominal besar (saldo utama) | `text-3xl font-extrabold tabular-nums tracking-tight` |
| Nominal di kartu/list | `text-base font-bold tabular-nums` |
| Judul halaman | `text-xl font-bold` |
| Label | `text-sm font-medium text-stone-500` |
| Radius | kartu `rounded-2xl`, tombol & input `rounded-xl`, chip `rounded-full` |
| Jarak | padding halaman `px-4` (HP) / `px-6` (laptop), antar kartu `gap-3` |
| Target sentuh | minimal 44 × 44 px |
| Bayangan | `shadow-sm` di kartu. Kartu Sunrise memakai bayangan hangat `shadow-lg shadow-orange-900/15` |

MVP memakai **mode terang** saja. Semua warna lewat token supaya mode gelap bisa ditambah nanti.

### 4.3 Format

| Data | Format | Contoh |
|---|---|---|
| Rupiah | `Intl.NumberFormat("id-ID")`, prefix `Rp`, tanpa desimal | `Rp 2.997.500` |
| Rupiah ringkas (grafik/chip) | jt / rb | `Rp 3 jt`, `Rp 250 rb` |
| Masuk / keluar di list | tanda + warna | `+Rp 500.000` hijau · `−Rp 25.000` merah |
| Transfer di list | panah, warna netral | `BCA → Jago  Rp 1.000.000` |
| Saldo minus | merah + tanda minus | `−Rp 25.000` |
| Tanggal (list) | `d MMM` (tahun hanya kalau beda tahun) | `29 Okt` |
| Tanggal (header/detail) | `EEEE, d MMMM yyyy` | `Kamis, 29 Oktober 2026` |
| Grup tanggal di riwayat | Hari ini · Kemarin · `Senin, 27 Okt` | |
| Periode | nama periode + rentang | `Gajian Okt · 25 Okt – sekarang` |

Semua format di `src/lib/format.ts`.

### 4.4 Komponen dasar (`src/components/ui/`)

| Komponen | Keterangan |
|---|---|
| `Button` | Varian `primary`, `secondary`, `ghost`, `danger`. State `loading` (spinner + disabled) |
| `Card` | Kartu putih `rounded-2xl` |
| `Input`, `Select`, `Textarea` | Label di atas, pesan error merah di bawah (dari `errors` ProblemDetails) |
| `MoneyInput` | `inputMode="numeric"`, format titik ribuan saat mengetik, nilai disimpan sebagai angka |
| `SegmentedControl` | Pilihan tab (keluar/masuk/transfer, tab master) |
| `BottomSheet` | Panel dari bawah di HP, modal di tengah di laptop. Untuk form singkat & konfirmasi |
| `ConfirmDialog` | Konfirmasi aksi berisiko (hapus, nonaktifkan, tutup periode) |
| `Toast` | Notifikasi singkat di atas bottom nav: sukses (hijau), error (merah), peringatan (kuning) |
| `EmptyState` | Ikon + kalimat + tombol aksi |
| `Skeleton` | Placeholder saat loading (bukan spinner layar penuh) |
| `AmountText` | Menampilkan nominal dengan warna/tanda sesuai tipe |
| `TransaksiItem` | Satu baris transaksi (§5.3) |
| `AkunPicker`, `KategoriPicker` | Grid chip untuk pilih cepat, bukan dropdown panjang |

---

## 5. Layout & navigasi

### 5.1 HP (< `lg`)

```
┌──────────────────────────────┐
│ Judul halaman          [ikon]│  ← header sticky, putih
├──────────────────────────────┤
│                              │
│          konten              │  ← scroll, padding bawah 96 px
│                              │
├──────────────────────────────┤
│  🏠     💳     ⊕     🕘    ☰  │  ← bottom nav fixed + safe-area
│ Beranda Akun  Catat Riwayat Lainnya│
└──────────────────────────────┘
```

- Tombol **⊕ Catat** di tengah: lingkaran gradasi oranye (`brand-500` → `brand-700`) dengan ikon putih, sedikit menonjol ke atas, membuka `/transaksi/baru`.
- Nav aktif: ikon + label `brand-700`. Nonaktif: `stone-400`. Latar bottom nav putih dengan border atas `garis`.
- Gunakan `env(safe-area-inset-bottom)` untuk iPhone.

### 5.2 Laptop (≥ `lg`)

```
┌────────────┬─────────────────────────────────────┐
│ Saku       │ Judul halaman            [+ Catat]  │
│            ├─────────────────────────────────────┤
│ Beranda    │                                     │
│ Akun       │   konten (max-w-3xl, di tengah)     │
│ Riwayat    │                                     │
│ Langganan  │                                     │
│ Tabungan   │                                     │
│ Master     │                                     │
│ ────────── │                                     │
│ Pengaturan │                                     │
│ Pengguna*  │                                     │
│ Keluar     │                                     │
└────────────┴─────────────────────────────────────┘
```

`*` hanya untuk admin.

### 5.3 Item transaksi (dipakai di banyak halaman)

```
┌──────────────────────────────────────────┐
│ (🍜)  Makan siang warteg     −Rp 25.000 │
│       Makan · GoPay              29 Okt  │
└──────────────────────────────────────────┘
┌──────────────────────────────────────────┐
│ (⇄)  BCA → Mandiri          Rp 2.000.000 │
│       Transfer · admin Rp 2.500  25 Okt  │
└──────────────────────────────────────────┘
```

- Kiri: lingkaran ikon berwarna sesuai tipe (keluar `rose-50` + ikon merah mawar, masuk `emerald-50` + ikon hijau, transfer `violet-50` + ikon ungu).
- Baris 1: deskripsi (kalau kosong, nama kategori). Baris 2: kategori · akun.
- Kanan: nominal (§4.3) + tanggal.
- Tap → buka form edit. Transaksi `TARIK_TABUNGAN` diberi badge "Tabungan" dan diarahkan ke halaman Tabungan.

---

## 6. Halaman

Setiap halaman wajib menangani 4 state: **loading** (skeleton), **kosong** (EmptyState), **error** (pesan + tombol "Coba lagi"), dan **data**.

### 6.1 Setup Awal & Login

```
┌──────────────────────────────┐
│                              │
│           [logo]             │
│            Saku              │
│  Catat uang, pantau per akun │
│                              │
│  Username                    │
│  [________________________]  │
│  Password                    │
│  [____________________ 👁]   │
│                              │
│  [         Masuk          ]  │
│                              │
└──────────────────────────────┘
```

- **Setup Awal** (hanya kalau `perluSetup`): judul "Buat akun admin", field Nama, Username, Password, Ulangi Password. Tombol "Buat & Masuk".
- Error login ditampilkan di atas tombol: "Username atau password salah." Saat terkunci: "Terlalu banyak percobaan. Coba lagi dalam 15 menit."
- Tidak ada bottom nav.
- Bagian atas (logo + nama) memakai `bg-sunrise` dengan sudut bawah melengkung, seperti langit fajar. Form di bawahnya berada di atas latar krem.

### 6.2 Dashboard (`/`)

```
┌──────────────────────────────┐
│ Halo, Ryn            [⚙]     │
│ Gajian Okt · 25 Okt–sekarang │
├──────────────────────────────┤
│ ┌──────────────────────────┐ │
│ │ Total saldo               │ │  ← kartu bg-sunrise, teks putih
│ │ Rp 5.971.500              │ │
│ │ Keluar periode ini        │ │
│ │ Rp 28.500        ▸ Detail │ │
│ └──────────────────────────┘ │
│                              │
│ ⏰ Pengingat langganan        │  ← hanya muncul kalau ada
│ ┌──────────────────────────┐ │
│ │ Netflix · 2 Nov · 3 hari  │ │
│ │ Rp 54.000  [Lewati][Bayar]│ │
│ └──────────────────────────┘ │
│                              │
│ Saldo per akun     Lihat ▸   │
│ ┌─────┐┌─────┐┌─────┐┌─────┐ │  ← scroll horizontal
│ │BCA  ││Mandi││Jago ││GoPay│ │
│ │2,99j││2 jt ││699rb││275rb│ │
│ └─────┘└─────┘└─────┘└─────┘ │
│                              │
│ Pengeluaran per kategori     │
│   ( donut )   Makan   45%    │
│               Transport 20%  │
│               Lainnya …      │
│                              │
│ ┌──────────────────────────┐ │
│ │ 🐷 Tabungan  Rp 12.400.000│ │  ← kartu emas muda → /tabungan
│ └──────────────────────────┘ │
│                              │
│ Transaksi terakhir  Semua ▸  │
│ [TransaksiItem] × 5          │
└──────────────────────────────┘
```

- **Belum ada periode:** kartu besar "Mulai periode pertama" + penjelasan singkat bahwa gaji diisi sebagai saldo awal.
- **Belum ada akun:** arahkan ke Master → tambah akun dulu.
- Tombol **Bayar** di pengingat membuka BottomSheet konfirmasi (§6.8).
- Donut: maksimal 5 kategori teratas + "Lainnya". Tap kategori → Riwayat terfilter.
- Pull-to-refresh tidak wajib. Data di-refresh saat halaman difokuskan (TanStack Query `refetchOnWindowFocus`).

### 6.3 Form Transaksi (`/transaksi/baru`, `/transaksi/:id`)

```
┌──────────────────────────────┐
│ ✕  Catat transaksi           │
├──────────────────────────────┤
│ [ Keluar | Masuk | Transfer ]│
│                              │
│         Rp 25.000            │  ← MoneyInput besar, autofocus
│                              │
│ Dari akun                    │
│ (BCA)(Mandiri)(Jago)(●GoPay) │  ← chip, 1 baris scroll
│                              │
│ Kategori                     │
│ (●Makan)(Transport)(Belanja) │
│ (Tagihan)(Hiburan)(+ lainnya)│
│                              │
│ Deskripsi                    │
│ [Makan siang warteg_______]  │
│                              │
│ Tanggal      [ Hari ini ▾ ]  │
│                              │
├──────────────────────────────┤
│ [          Simpan         ]  │  ← sticky di atas keyboard
└──────────────────────────────┘
```

**Per tab:**

| Tab | Field |
|---|---|
| Keluar | Nominal, Dari akun, Kategori (keluar, `untukInput=true`), Deskripsi, Tanggal |
| Masuk | Nominal, Ke akun, Kategori (masuk, `untukInput=true`), Deskripsi, Tanggal |
| Transfer | Nominal, Dari akun, Ke akun (tidak boleh sama), **Biaya admin** (default 0, chip cepat: 0 · 2.500 · 6.500), Deskripsi, Tanggal |

**Perilaku:**
- Akun & tipe terakhir yang dipakai **diingat** (localStorage) sebagai default.
- Di bawah chip akun tampil saldo akun terpilih: "Saldo GoPay Rp 300.000".
- Sesudah simpan: toast "Tersimpan" + kembali ke halaman sebelumnya. Kalau ada `peringatan[]` dari API, tampilkan toast kuning (mis. "Saldo GoPay menjadi minus Rp 25.000").
- Tombol "Simpan & catat lagi" (secondary) untuk input beruntun.
- Mode edit: judul "Ubah transaksi", tombol **Hapus** (danger + ConfirmDialog).
- Error validasi per field dari API ditampilkan di bawah field yang bersangkutan.
- Error 422 "Belum ada periode untuk tanggal ini" → tampilkan dengan tombol ke Mulai Periode.

### 6.4 Akun (`/akun`)

```
┌──────────────────────────────┐
│ Akun               [Periode▾]│
├──────────────────────────────┤
│ Total  Rp 5.971.500          │
│                              │
│ ┌──────────────────────────┐ │
│ │ 🏦 BCA                    │ │
│ │ Rp 2.997.500              │ │  ← saldo sekarang, besar
│ │ ───────────────────────── │ │
│ │ Saldo awal   6.000.000    │ │
│ │ Masuk           +0        │ │
│ │ Keluar          −0        │ │
│ │ Biaya admin  −2.500       │ │
│ │ Transfer     −3.000.000   │ │  ← net (masuk − keluar)
│ │ ▓▓▓▓▓▓▓▓░░░░░░  50% sisa  │ │  ← bar sisa vs saldo awal
│ └──────────────────────────┘ │
│ ┌──────────────────────────┐ │
│ │ 📱 GoPay …                │ │
│ └──────────────────────────┘ │
└──────────────────────────────┘
```

- Selector periode (default periode aktif) untuk melihat periode lama.
- Ikon per jenis: bank 🏦 `Landmark`, e-wallet `Smartphone`, cash `Wallet` (lucide).
- Rincian transfer bisa dibuka (masuk & keluar terpisah).
- Tap kartu → Detail Akun.

### 6.5 Detail Akun (`/akun/:id`)

- Header: nama akun + saldo sekarang + ringkasan seperti kartu §6.4.
- Mini donut / bar pengeluaran per kategori **untuk akun ini**.
- Daftar transaksi akun ini di periode terpilih (termasuk transfer masuk), dikelompokkan per tanggal.

### 6.6 Riwayat (`/riwayat`)

```
┌──────────────────────────────┐
│ Riwayat                      │
│ [🔍 Cari deskripsi_______]   │
│ (Periode ini▾)(Akun▾)(Tipe▾) │  ← chip filter, scroll horizontal
│ (Kategori▾)                  │
├──────────────────────────────┤
│ Hari ini            −Rp 25rb │  ← header grup + total keluar hari itu
│ [TransaksiItem]              │
│ Kemarin                      │
│ [TransaksiItem]              │
│ …                            │
│ [ Muat lebih banyak ]        │
└──────────────────────────────┘
```

- Filter aktif tampil sebagai chip brand dengan ✕.
- Pencarian debounce 300 ms.
- Paginasi `ukuran=50` dengan "Muat lebih banyak" (infinite query).
- Filter juga bisa dibuka dari Dashboard (kategori) dan Akun.

### 6.7 Mulai Periode Baru (`/periode/baru`)

Wizard 3 langkah dengan indikator langkah di atas.

```
Langkah 1 · Tutup periode          Langkah 2 · Saldo awal          Langkah 3 · Konfirmasi
┌──────────────────────────┐       ┌──────────────────────────┐    ┌──────────────────────────┐
│ Sisa "Gajian Okt"        │       │ Nama  [Gajian Nov____]   │    │ Periode lama ditutup     │
│ akan masuk tabungan:     │       │ Mulai [25 Nov 2026 ▾]    │    │ 24 Nov 2026              │
│                          │       │                          │    │                          │
│ BCA       2.997.500      │       │ BCA      [6.000.000]     │    │ Masuk tabungan           │
│ Mandiri   2.000.000      │       │ Mandiri  [________0]     │    │ Rp 5.971.500             │
│ Jago        699.000      │       │ Jago     [________0]     │    │                          │
│ GoPay       275.000      │       │ GoPay    [________0]     │    │ Saldo awal baru          │
│ ──────────────────────── │       │ Cash     [________0]     │    │ Rp 6.000.000             │
│ Total     5.971.500      │       │ ──────────────────────── │    │                          │
│                          │       │ Total    6.000.000       │    │ [ Mulai periode ]        │
│ [ Lanjut ]               │       │ [ Lanjut ]               │    │                          │
└──────────────────────────┘       └──────────────────────────┘    └──────────────────────────┘
```

- Langkah 1 memakai `GET /periode/aktif/pratinjau-tutup`. Sisa minus ditampilkan merah dengan catatan "mengurangi tabungan". Kalau belum ada periode aktif, langkah 1 dilewati.
- Langkah 2: tanggal mulai default hari ini. Saldo awal kosong = 0. Petunjuk: "Isi gaji di akun penerima. Pembagian ke akun lain bisa dicatat sebagai transfer."
- Error 409 (ada transaksi setelah tanggal mulai): tampilkan daftar transaksinya dengan tautan untuk mengedit.
- Sukses: halaman ringkasan sederhana → tombol ke Dashboard.

### 6.8 Langganan (`/langganan`)

```
┌──────────────────────────────┐
│ Langganan          [+ Tambah]│
├──────────────────────────────┤
│ ┌──────────────────────────┐ │
│ │ Netflix        Rp 54.000  │ │
│ │ Tiap tgl 2 · GoPay        │ │
│ │ ● Belum dibayar Nov       │ │  ← badge: belum (abu) / dibayar (hijau) / dilewati (abu garis)
│ │        [Lewati] [Bayar]   │ │
│ └──────────────────────────┘ │
│ Nonaktif (2)  ▾              │
└──────────────────────────────┘
```

- **Bayar** → BottomSheet: nominal (bisa diubah), akun, tanggal (default hari ini), deskripsi (default nama). Tombol "Konfirmasi bayar".
- **Lewati** → ConfirmDialog "Lewati Netflix bulan November?". Setelah dilewati ada tombol "Batalkan".
- Form tambah/ubah (BottomSheet): nama, nominal, akun, kategori keluar, tanggal jatuh tempo (1–31), ingatkan H-berapa (default 3), mulai bulan, selesai bulan (opsional), aktif.

### 6.9 Tabungan (`/tabungan`)

```
┌──────────────────────────────┐
│ Tabungan                     │
├──────────────────────────────┤
│ ┌──────────────────────────┐ │
│ │ 🐷 Total tabungan         │ │  ← kartu emas muda (#fefce8)
│ │ Rp 12.400.000             │ │
│ │ [ Tarik tabungan ]        │ │
│ └──────────────────────────┘ │
│                              │
│ Per akun                     │
│ BCA       Rp 6.200.000       │
│ Mandiri   Rp 4.000.000       │
│ …                            │
│                              │
│ Riwayat                      │
│ ↓ Setor · Sisa Gajian Okt    │
│   BCA         +2.997.500     │
│ ↑ Tarik · Servis motor       │
│   BCA           −500.000 [🗑] │  ← hapus hanya untuk tarik di periode aktif
└──────────────────────────────┘
```

- **Tarik tabungan** → BottomSheet: akun (menampilkan tabungan per akun), nominal (maks = tabungan akun itu), tanggal, keterangan. Penjelasan kecil: "Uang ini akan masuk ke saldo akun di periode berjalan."
- Setor minus ditampilkan merah.

### 6.10 Master (`/master`)

- Master dipakai bersama semua pengguna. **Admin** bisa tambah/ubah/nonaktifkan; pengguna biasa hanya melihat (tombol tambah, ubah, dan urutan disembunyikan).
- SegmentedControl **Akun | Kategori**.
- **Akun:** list dengan ikon jenis, nama, saldo periode aktif. Tombol "+ Tambah akun". Tap → BottomSheet ubah (nama, jenis, aktif). Urutan bisa diatur (tombol ▲▼, drag-and-drop tidak wajib). Error 409 saldo ≠ 0 saat menonaktifkan ditampilkan apa adanya.
- **Kategori:** sub-tab Keluar / Masuk. Kategori sistem diberi badge "Sistem" dan tidak bisa dinonaktifkan. Item nonaktif dikelompokkan di bawah dalam bagian yang bisa dibuka.

### 6.11 Lainnya (`/lainnya`, HP saja)

Daftar menu: Langganan · Tabungan · Master · Mulai Periode Baru · Pengaturan · Kelola Pengguna (admin) · Keluar. Di bagian bawah: versi aplikasi.

### 6.12 Pengaturan (`/pengaturan`)

- Profil: nama (bisa diubah), username (read-only), peran.
- Ganti password: password lama, baru, ulangi. Sesudah berhasil, toast "Password diganti".
- Tombol **Keluar** (danger ghost).
- Info: versi aplikasi, status "Terhubung ke Google Sheets" dari `/api/health/sheets`.

### 6.13 Kelola Pengguna (`/pengguna`, admin)

- List pengguna: nama, username, badge peran, badge nonaktif, last login.
- "+ Tambah pengguna" → BottomSheet: nama, username, password awal, peran.
- Aksi per pengguna: ubah (nama, peran, aktif), reset password. Admin tidak bisa menonaktifkan dirinya sendiri (tombol disabled + tooltip).

---

## 7. Checklist kualitas UI

- [ ] Semua teks UI dan pesan error dalam Bahasa Indonesia
- [ ] Semua nominal memakai `formatRupiah` + `tabular-nums`
- [ ] Tidak ada scroll horizontal di lebar 360 px (kecuali baris chip yang memang di-scroll)
- [ ] Target sentuh ≥ 44 px, input ≥ 16 px (supaya iOS tidak zoom)
- [ ] Setiap tombol submit punya state loading dan tidak bisa diklik dua kali
- [ ] Setiap mutasi meng-invalidate query terkait (dashboard, akun, riwayat, tabungan)
- [ ] Setiap halaman punya state loading (skeleton), kosong, dan error
- [ ] Aksi berisiko memakai ConfirmDialog
- [ ] Fokus keyboard terlihat (`focus-visible:ring`), label terhubung ke input, kontras teks minimal AA
- [ ] Bottom nav tidak menutupi konten atau tombol sticky, dan menghormati safe area iPhone
- [ ] 401 di mana pun → kembali ke login dengan pesan sesi berakhir
- [ ] Saat offline: banner "Tidak ada koneksi", tombol simpan dinonaktifkan
