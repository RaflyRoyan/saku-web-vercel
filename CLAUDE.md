# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Saku

Aplikasi pencatatan keuangan pribadi multi-pengguna. Web + PWA, di-host di Vercel. Penyimpanan data = Postgres di Supabase (dulu Google Sheets).

```
React SPA (PWA) ──fetch /api/* + cookie──▶ Vercel Function (Hono) ──postgres.js, pooler :6543──▶ Supabase Postgres
```

## Dokumen
- docs/SAKU_API_SPEC.md: model data (ditulis untuk Google Sheets; kolom sama dengan tabel Postgres), aturan bisnis, endpoint, skenario uji T1–T17 (sumber kebenaran)
- docs/02-pekerjaan-dan-tampilan.md: daftar pekerjaan per milestone (M1–M7), penyesuaian stack, desain tampilan
- docs/01-setup-proyek.md: setup & struktur folder awal (sudah selesai)
- Spec ditulis untuk .NET/Render/Bearer token. Kalau bertentangan, **02 §2 yang menang** (cookie JWT, tanpa cache/lock, Vitest). Hosting: **Vercel** (dokumen menyebut Netlify; repo ini versi Vercel)

## Perintah
- npm run db:start       → Postgres lokal lewat Supabase CLI (Docker), `127.0.0.1:54322`, migrasi di `supabase/migrations` otomatis terpasang. Wajib jalan untuk dev & test
- npm run db:reset       → buat ulang database lokal dari migrasi
- npm run dev            → http://localhost:5173 (frontend + API: Hono dijalankan di dalam Vite lewat `@hono/vite-dev-server`, env dari `.env`)
- npm test               → Vitest (sekali jalan, ke Postgres lokal; `DATABASE_URL_TEST` untuk database lain)
- npx vitest run tests/health.test.ts   → satu file test
- npx vitest run -t "nama test"         → satu test berdasarkan nama
- npm run lint           → oxlint
- npm run migrasi:sheets → salin data Google Sheets lama ke Postgres (`scripts/migrasi_ke_supabase.ts`, env di `.env.migrasi`), aman diulang
- npm run ikon           → generate ulang ikon PWA & favicon dari `public/logo.svg` (`scripts/buat_ikon.ts`)
- npm run build          → `tsc -b` (3 tsconfig) + vite build; wajib lulus sebelum commit

Lingkungan: Windows, Node v22 (jangan minta upgrade Node global). Deploy lewat integrasi Git Vercel; `vercel` CLI tidak wajib.

## Arsitektur
- **Entry API**: `api/index.ts` (Vercel Function, `hono/vercel`). `vercel.json` me-rewrite semua `/api/*` ke function ini dan path lain ke `index.html`; URL asli tetap utuh sehingga Hono app di `server/app.ts` (`basePath("/api")`) merutekan. Route baru didaftarkan di app ini. Region `sin1`, `maxDuration` 30 detik.
- **Lapisan backend** (`server/`): `routes/` → `services/` (aturan bisnis, fungsi murni atas array baris) → `repositories/rows.ts` → `db/store.ts` (interface `Store`, implementasi `PostgresStore`). Koneksi di `db/client.ts` (postgres.js, `prepare: false` & `max: 1` untuk transaction pooler), dibuat sekali per instance di `server/config.ts`.
- **Database**: tabel & kolom didefinisikan di `server/db/schema.ts` (nama tabel = snake_case, mis. `AkunPengguna` → `akun_pengguna`); perubahan struktur = file migrasi baru di `supabase/migrations/` (jangan edit migrasi lama). Kolom `no` (identity) menjaga urutan insert dan selalu dipakai `order by`. `dariDb`/`keDb` di `db/store.ts` mengubah nilai ke/dari bentuk `Baris` (teks kosong = `""` di aplikasi, `NULL` di database; `date` tetap string `yyyy-MM-dd`; `timestamptz` → ISO WIB).
- **Baca**: tiap handler 1× `loadSession(c, [tabel…])`. Tabel per pengguna (punya `user_id`) hanya dibaca baris milik pengguna yang login; `{ semuaPengguna: true }` hanya untuk cek admin lintas pengguna (nonaktifkan akun). Tidak ada cache lintas request. Update/hapus berdasarkan `id`.
- **Tulis**: perubahan multi-tabel lewat `store.batch([...Operasi])` = satu transaksi database (semua berhasil atau semua batal). `simpanSetor(store, plan, extra)` menggabungkan perubahan utama handler dengan hitung ulang setor tabungan. Error database → 502 "Gagal mengakses penyimpanan data." tanpa detail.
- **Batas waktu** function `maxDuration` 30 detik (`vercel.json`).
- **Master bersama**: `Akun`, `Kategori`, `KelompokKategori` dipakai semua pengguna (tanpa `user_id`), hanya admin yang boleh menulis. Tidak ada tabel `KategoriDefault` (02 §2).
- **Isolasi data**: tabel lain kecuali `Pengguna` difilter `user_id` saat dibaca; ID milik user lain → 404 (`findOwned`). Kolom audit diisi dari JWT, tidak pernah dari body. RLS aktif di semua tabel tanpa policy dan Data API Supabase dimatikan: hanya server (role `postgres`) yang bisa membaca.
- **Waktu**: server UTC, semua tanggal dihitung WIB lewat `server/common/clock.ts` (bisa di-mock di test).
- **Error**: ProblemDetails (`title` Bahasa Indonesia, `errors` per field camelCase) dari `server/common/errors.ts`. Frontend `src/lib/api.ts` mengubahnya jadi `ApiError`.
- **Auth**: JWT HS256 di cookie `saku_token` (HttpOnly). Handler terproteksi memanggil `loadSession(c, [tabel…])` (`server/auth/session.ts`) yang membaca `Pengguna` + tabel lain lalu mengecek `aktif`/`versi_token`. 401 di frontend → `src/lib/session.ts` → kembali ke /login (kecuali query/mutation ber-`meta.ignore401`). POST/PUT/DELETE wajib header `X-Requested-With: saku` (sudah dikirim `src/lib/api.ts`), kalau tidak 403.
- **Frontend** (`src/`): React Router (route di `App.tsx`), TanStack Query, Tailwind v4 tema Sunrise (token di `index.css`, spec di 02 §4). Satu file per halaman di `src/pages/`.
- **PWA**: `vite-plugin-pwa` di `vite.config.ts` (`registerType: "prompt"`); `/api/*` dikecualikan dari cache service worker. `components/StatusBanner.tsx` menampilkan banner offline & "Versi baru tersedia". `Button` dengan `type="submit"` atau prop `kirim` otomatis nonaktif saat offline.

## Test
- Vitest, environment node, hanya `tests/**/*.test.ts`. Butuh Postgres lokal (`npm run db:start`); semua tabel di-truncate sebelum tiap test (`tests/setup-db.ts`), file test jalan bergantian (`fileParallelism: false`).
- Pakai `PostgresStore` + `FakeClock` dari `tests/helpers.ts` (`setupTest`, `siapkan`, `appendRaw`/`rowsDari` untuk data mentah). Test endpoint lewat `createApp({ store: () => store, clock }).request("/api/...")` dari `server/app.ts`, tanpa server HTTP.
- `scripts/sheets-lama/` = kode Google Sheets lama, hanya untuk skrip migrasi data (dan test parser T16).
- Tiap milestone punya skenario T# yang wajib lulus (spec §14).

## Aturan
- TypeScript strict. Frontend di src/, backend di server/, entry function di api/index.ts
- Kode browser tidak boleh import dari server/
- Import relatif di `server/` dan `api/` **wajib berakhiran `.js`** (mis. `from "../common/errors.js"`): Vercel mengompilasi per file ke ESM tanpa bundling, import tanpa ekstensi membuat function crash (`FUNCTION_INVOCATION_FAILED`)
- `erasableSyntaxOnly` aktif di `src/` (tsconfig.app.json): tanpa parameter property, enum, atau namespace
- Pesan error & teks UI: Bahasa Indonesia
- Jangan commit .env atau kredensial apa pun
- Jangan log password, token, atau private key
- Kerjakan per milestone. Setelah selesai: npm run build && npm test, lalu laporkan
- Kalau ambigu, tanya user dulu
