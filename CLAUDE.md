# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Saku

Aplikasi pencatatan keuangan pribadi multi-pengguna. Web + PWA, di-host di Vercel. Penyimpanan data = Google Sheets (bukan database).

```
React SPA (PWA) ──fetch /api/* + cookie──▶ Vercel Function (Hono) ──Service Account──▶ Google Sheets
```

## Dokumen
- docs/SAKU_API_SPEC.md: model data Google Sheets, aturan bisnis, endpoint, skenario uji T1–T17 (sumber kebenaran)
- docs/02-pekerjaan-dan-tampilan.md: daftar pekerjaan per milestone (M1–M7), penyesuaian stack, desain tampilan
- docs/01-setup-proyek.md: setup & struktur folder awal (sudah selesai)
- Spec ditulis untuk .NET/Render/Bearer token. Kalau bertentangan, **02 §2 yang menang** (cookie JWT, tanpa cache/lock, Vitest). Hosting: **Vercel** (dokumen menyebut Netlify; repo ini versi Vercel)

## Perintah
- npm run dev            → http://localhost:5173 (frontend + API: Hono dijalankan di dalam Vite lewat `@hono/vite-dev-server`, env dari `.env`)
- npm test               → Vitest (sekali jalan)
- npx vitest run tests/health.test.ts   → satu file test
- npx vitest run -t "nama test"         → satu test berdasarkan nama
- npm run lint           → oxlint
- npm run template       → generate ulang `template/Saku_Template.xlsx` dari `server/sheets/schema.ts`
- npm run ikon           → generate ulang ikon PWA & favicon dari `public/logo.svg` (`scripts/buat_ikon.ts`)
- npm run build          → `tsc -b` (3 tsconfig) + vite build; wajib lulus sebelum commit

Lingkungan: Windows, Node v22 (jangan minta upgrade Node global). Deploy lewat integrasi Git Vercel; `vercel` CLI tidak wajib.

## Arsitektur
- **Entry API**: `api/index.ts` (Vercel Function, `hono/vercel`). `vercel.json` me-rewrite semua `/api/*` ke function ini dan path lain ke `index.html`; URL asli tetap utuh sehingga Hono app di `server/app.ts` (`basePath("/api")`) merutekan. Route baru didaftarkan di app ini. Region `sin1`, `maxDuration` 30 detik.
- **Lapisan backend** (`server/`): `routes/` → `services/` (aturan bisnis) → `repositories/` → `sheets/store.ts` (interface `SheetStore`). Implementasi: `memory-store.ts` (`MemorySheetStore` untuk test; `FileSheetStore` → `.data/saku-memory.json` untuk `SHEETS_MODE=memory` di dev lokal, supaya data bertahan saat Vite memuat ulang modul server) dan `google-store.ts`, dipilih oleh `SHEETS_MODE` di `server/config.ts`.
- **Sheets**: baca/tulis berdasarkan **urutan kolom** di `sheets/schema.ts`, bukan nama header. Nilai dibaca lewat parser toleran `sheets/parse.ts`. Tidak ada cache lintas request: tiap handler 1 `values:batchGet` untuk semua sheet yang dibutuhkan (termasuk `Pengguna` untuk validasi token). Sebelum update/hapus, cari nomor baris dari `id` pada bacaan terbaru.
- **Batas waktu** function `maxDuration` 30 detik (`vercel.json`), timeout request Google 8 detik: operasi besar (tutup periode) digabung ke `values:batchUpdate` / append multi-baris, dan harus idempoten.
- **Master bersama**: `Akun` & `Kategori` dipakai semua pengguna (tanpa `user_id`), hanya admin yang boleh menulis. Tidak ada sheet `KategoriDefault` (02 §2).
- **Isolasi data**: sheet lain kecuali `Pengguna` difilter `user_id`; ID milik user lain → 404. Kolom audit diisi dari JWT, tidak pernah dari body.
- **Waktu**: server UTC, semua tanggal dihitung WIB lewat `server/common/clock.ts` (bisa di-mock di test).
- **Error**: ProblemDetails (`title` Bahasa Indonesia, `errors` per field camelCase) dari `server/common/errors.ts`. Frontend `src/lib/api.ts` mengubahnya jadi `ApiError`.
- **Auth**: JWT HS256 di cookie `saku_token` (HttpOnly). Handler terproteksi memanggil `loadSession(c, [sheet…])` (`server/auth/session.ts`) yang membaca `Pengguna` + sheet lain dalam satu batchGet dan mengecek `aktif`/`versi_token`. 401 di frontend → `src/lib/session.ts` → kembali ke /login (kecuali query/mutation ber-`meta.ignore401`). POST/PUT/DELETE wajib header `X-Requested-With: saku` (sudah dikirim `src/lib/api.ts`), kalau tidak 403.
- **Frontend** (`src/`): React Router (route di `App.tsx`), TanStack Query, Tailwind v4 tema Sunrise (token di `index.css`, spec di 02 §4). Satu file per halaman di `src/pages/`.
- **PWA**: `vite-plugin-pwa` di `vite.config.ts` (`registerType: "prompt"`); `/api/*` dikecualikan dari cache service worker. `components/StatusBanner.tsx` menampilkan banner offline & "Versi baru tersedia". `Button` dengan `type="submit"` atau prop `kirim` otomatis nonaktif saat offline.

## Test
- Vitest, environment node, hanya `tests/**/*.test.ts`.
- Pakai `memory-store` + `FakeClock`. Test endpoint lewat `createApp({ store: () => store, clock }).request("/api/...")` dari `server/app.ts`, tanpa server HTTP.
- Tiap milestone punya skenario T# yang wajib lulus (spec §14).

## Aturan
- TypeScript strict. Frontend di src/, backend di server/, entry function di api/index.ts
- Kode browser tidak boleh import dari server/
- `erasableSyntaxOnly` aktif di `src/` (tsconfig.app.json): tanpa parameter property, enum, atau namespace
- Pesan error & teks UI: Bahasa Indonesia
- Jangan commit .env atau kredensial apa pun
- Jangan log password, token, atau private key
- Kerjakan per milestone. Setelah selesai: npm run build && npm test, lalu laporkan
- Kalau ambigu, tanya user dulu
