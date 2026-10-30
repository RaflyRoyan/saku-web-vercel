# Saku

Aplikasi pencatatan keuangan pribadi multi-pengguna (web + PWA). Catat pemasukan, pengeluaran, dan transfer per akun, tutup buku per periode (gajian ke gajian), sisa saldo otomatis masuk tabungan, dan pengingat langganan bulanan.

```
React SPA (PWA) ──fetch /api/* + cookie──▶ Vercel Function (Hono) ──Service Account──▶ Google Sheets
```

- **Frontend:** Vite, React 19, React Router, TanStack Query, Tailwind CSS v4, `vite-plugin-pwa`
- **Backend:** Hono di satu Vercel Function, runtime Node.js (`api/index.ts` → `server/app.ts`)
- **Penyimpanan:** Google Sheets (satu spreadsheet, satu sheet per tabel), tanpa database
- **Auth:** JWT HS256 di cookie HttpOnly `saku_token`, password PBKDF2-SHA256

Dokumen lengkap ada di `docs/`: spesifikasi API & aturan bisnis (`SAKU_API_SPEC.md`), daftar pekerjaan & desain tampilan (`02-pekerjaan-dan-tampilan.md`).

## Menjalankan di lokal

Butuh Node 22.

```bash
npm install
cp .env.example .env      # lalu isi, lihat bagian Environment
npm run dev               # http://localhost:5173 (frontend + API dalam satu server Vite)
```

Tanpa akses Google, jalankan dengan data lokal: set `SHEETS_MODE=memory`. Data disimpan di `.data/saku-memory.json` (hapus file itu untuk mulai dari kosong).

Buka aplikasi, lalu buat admin pertama di halaman **Setup Awal** (hanya muncul selama sheet `Pengguna` kosong).

### Perintah lain

| Perintah | Fungsi |
|---|---|
| `npm test` | Semua test (Vitest, memakai memory store + clock palsu) |
| `npx vitest run tests/transaksi.test.ts` | Satu file test |
| `npm run lint` | oxlint |
| `npm run build` | Type check (`tsc -b`) + build produksi ke `dist/` |
| `npm run template` | Generate ulang `template/Saku_Template.xlsx` dari `server/sheets/schema.ts` |
| `npm run ikon` | Generate ulang ikon PWA & favicon dari `public/logo.svg` |

## Environment

| Variabel | Wajib | Keterangan |
|---|---|---|
| `SHEETS_MODE` | | `google` (default) atau `memory` (data lokal untuk dev) |
| `SPREADSHEET_ID` | mode google | ID spreadsheet, bagian URL di antara `/d/` dan `/edit` |
| `GOOGLE_CLIENT_EMAIL` | mode google | Email service account (`…@….iam.gserviceaccount.com`) |
| `GOOGLE_PRIVATE_KEY` | mode google | `private_key` dari file JSON service account, termasuk `-----BEGIN PRIVATE KEY-----`. Boleh dengan `\n` literal |
| `JWT_SECRET` | ya | Minimal 32 karakter acak, mis. `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `JWT_EXPIRE_DAYS` | | Masa berlaku sesi dalam hari (default 30) |

Jangan commit `.env` atau file JSON service account.

### Menyiapkan Google Sheets

1. Google Cloud Console → buat project → aktifkan **Google Sheets API**.
2. Buat **Service Account**, lalu buat key JSON. Ambil `client_email` dan `private_key` untuk env.
3. Buat spreadsheet baru: **File → Import** `template/Saku_Template.xlsx` (pilih *Replace spreadsheet*).
4. **Share** spreadsheet ke email service account sebagai **Editor**.
5. Cek: `GET /api/health/sheets` harus mengembalikan `{ "ok": true }`. Kalau 503, detail kolom yang salah ada di response.

Kolom dibaca berdasarkan **urutan**, bukan nama header, jadi jangan menyisipkan atau memindahkan kolom.

## Deploy ke Vercel

1. Import repo ini di Vercel (**Add New → Project**). Framework, build command, folder output (`dist`), region function (`sin1`, Singapura), dan rewrite sudah diatur di `vercel.json`.
2. **Settings → Environment Variables** (environment *Production*, juga *Preview* kalau dipakai): isi `SHEETS_MODE=google`, `SPREADSHEET_ID`, `GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `JWT_SECRET`, `JWT_EXPIRE_DAYS`.
3. Deploy, lalu cek `https://<situs>/api/health/sheets`.
4. Buka situs dan lakukan Setup Awal untuk membuat admin pertama.

## Struktur

```
api/index.ts               entry Vercel Function; vercel.json me-rewrite /api/* ke sini
vercel.json                build, region, rewrite SPA & API, batas durasi function
server/
  app.ts                   createApp(): middleware + daftar route
  routes/                  handler HTTP per resource
  services/                aturan bisnis (saldo, ringkasan, tabungan, langganan)
  repositories/rows.ts     helper baris sheet (ID, audit, kepemilikan)
  sheets/                  schema kolom, parser toleran, store memory/file/Google
  auth/                    hash password, JWT cookie, sesi & CSRF
src/
  pages/                   satu file per halaman
  components/              layout, komponen UI dasar, komponen keuangan
  hooks/                   query & mutation TanStack Query
  lib/                     fetch API, format Rupiah/tanggal
tests/                     Vitest (skenario T1–T17 dari spec)
template/                  generator template spreadsheet
```

## API

Semua endpoint di bawah `/api`. Selain `health`, `auth/status`, `auth/setup`, dan `auth/login`, wajib login (cookie). Request `POST`/`PUT`/`DELETE` wajib header `X-Requested-With: saku`. Error memakai ProblemDetails (`application/problem+json`) dengan pesan Bahasa Indonesia.

| Resource | Endpoint |
|---|---|
| Health | `GET /health`, `GET /health/sheets` |
| Auth | `GET /auth/status`, `POST /auth/setup`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `PUT /auth/password`, `PUT /auth/profil` |
| Pengguna (admin) | `GET /pengguna`, `POST /pengguna`, `PUT /pengguna/{id}`, `POST /pengguna/{id}/reset-password` |
| Akun | `GET /akun`, `POST /akun` *(admin)*, `PUT /akun/{id}` *(admin)*, `PUT /akun/{id}/aktif` *(admin)*, `PUT /akun/urutan` *(admin)* |
| Kategori | `GET /kategori`, `POST /kategori` *(admin)*, `PUT /kategori/{id}` *(admin)*, `PUT /kategori/{id}/aktif` *(admin)* |
| Periode | `GET /periode`, `GET /periode/aktif`, `GET /periode/aktif/pratinjau-tutup`, `POST /periode/mulai`, `PUT /periode/{id}`, `PUT /periode/{id}/saldo-awal`, `GET /periode/{id}/ringkasan` |
| Transaksi | `GET /transaksi`, `GET /transaksi/{id}`, `POST /transaksi`, `PUT /transaksi/{id}`, `DELETE /transaksi/{id}` |
| Tabungan | `GET /tabungan`, `POST /tabungan/tarik`, `DELETE /tabungan/{id}` |
| Langganan | `GET /berulang`, `POST /berulang`, `PUT /berulang/{id}`, `GET /berulang/pengingat`, `POST /berulang/{id}/konfirmasi`, `POST /berulang/{id}/lewati`, `DELETE /berulang/{id}/lewati/{bulan}` |
| Dashboard | `GET /dashboard` |

Detail body, response, dan aturan bisnis: `docs/SAKU_API_SPEC.md` §7 dan §10. Akun & kategori adalah master bersama semua pengguna; data lain (periode, transaksi, tabungan, langganan) terpisah per pengguna.
