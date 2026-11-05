# Split Bill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fitur split bill: struk (OCR Tesseract/manual) → bagian per orang → kartu QRIS bernominal dibagikan ke WhatsApp → centang lunas jadi transaksi masuk.

**Architecture:** 4 sheet baru (`SplitBill`, `SplitItem`, `SplitPeserta`, `Pengaturan`) + route Hono `/api/split` & `/api/pengaturan`. Perhitungan bagian di `server/services/split.ts`; transaksi keluar/masuk dibuat lewat `resolveTransaksi` + `rencanaSetorTerdampak` yang sudah ada. OCR, decode QR, QRIS dinamis, dan gambar kartu semuanya di browser.

**Tech Stack:** Hono, zod, Google Sheets store, Vitest, React + TanStack Query + Tailwind v4; dependensi baru `tesseract.js`, `jsqr`, `qrcode` (+ `@types/qrcode`).

**Spec:** `docs/superpowers/specs/2026-11-06-split-bill-design.md`

## Global Constraints

- Import relatif di `server/` & `api/` wajib berakhiran `.js`. Kode `src/` tidak boleh import dari `server/`.
- `erasableSyntaxOnly` di `src/`: tanpa enum, namespace, parameter property.
- Kolom sheet dibaca/ditulis berdasarkan urutan di `server/sheets/schema.ts`; AUDIT di akhir tiap sheet baru.
- Tiap handler: satu `loadSession(c, [...sheets])`. Data milik user lain → 404 (`findOwned`). Audit dari JWT.
- Error ProblemDetails, `title` & pesan Bahasa Indonesia, `errors` per field camelCase berindeks (`items.0.harga`, `peserta.1.nama`).
- Nominal rupiah bilangan bulat; Σ bagian peserta = `total` tepat.
- Kategori sistem baru: `{ kode: "PATUNGAN", nama: "Patungan", tipe: "masuk" }`.
- Deskripsi transaksi masuk: `Patungan <nama split> — <nama peserta>`. Deskripsi transaksi keluar: `<nama split>`.
- Pesan 409 transaksi terkait: `Transaksi ini bagian dari split bill <nama>. Ubah lewat halaman Split Bill.`
- Pesan QRIS ditolak: `Kode ini bukan QRIS. Pastikan QR dari GoPay Merchant/QRIS atas namamu.`
- Tiap task selesai: `npx tsc -b`, `npm run lint`, `npm test` lulus. Commit hanya kalau user minta (CLAUDE.md); langkah "Commit" = siapkan stage, commit saat diizinkan.

## Review Focus

1. Peserta tanpa item (nominal 0) → 422 `peserta.{i}.nama` "<nama> belum punya item." (test di Task 3).
2. Centang lunas dua kali (double tap / retry jaringan) → idempoten: 200, tidak ada transaksi masuk kedua (test di Task 4).
3. Payload QRIS dari `jsqr` dengan spasi/newline di ujung, CRC huruf kecil, atau sudah punya tag `54` → tetap valid & tag 54 diganti, bukan dobel (test di Task 2).
4. Spreadsheet lama tanpa kategori `PATUNGAN` → lunas membuat kategori itu otomatis, tidak 500 (test di Task 4).
5. Edit split mengganti nominal peserta lunas atau `akunTerimaId` → transaksi masuk terkait ikut diperbarui nominal & akunnya (test di Task 4).

---

### Task 1: Schema sheet baru + kategori sistem Patungan

**Files:**
- Modify: `server/sheets/schema.ts` (SCHEMA + `ID_PREFIX`)
- Modify: `server/services/pengguna.ts:78` (`KATEGORI_SISTEM`)
- Modify: `template/Saku_Template.xlsx` (via `npm run template`)
- Test: `tests/sheets.test.ts`, `tests/health.test.ts` (ekspektasi daftar sheet, kalau ada)

**Interfaces:**
- Produces: sheet `SplitBill`, `SplitItem`, `SplitPeserta`, `Pengaturan` dengan kolom persis spec §3 (urutan: kolom data lalu AUDIT); `ID_PREFIX.SplitBill="SB"`, `SplitItem="SI"`, `SplitPeserta="SP"`, `Pengaturan="PG"`. Tipe kolom: `tanggal`→`tanggal`, nominal→`angka`, `saya`/`lunas`→`boolean`, sisanya `teks`.

- [ ] **Step 1:** Tambah test di `tests/sheets.test.ts`: `SHEET_NAMES` berisi keempat sheet; header `SplitPeserta` = `["id","user_id","split_id","nama","saya","nominal","lunas","transaksi_id","urutan","created_by","created_at","updated_by","updated_at"]`. Tambah test `/auth/setup` → `GET /kategori` memuat `kodeSistem: "PATUNGAN"` tipe masuk.
- [ ] **Step 2:** `npx vitest run tests/sheets.test.ts` → FAIL.
- [ ] **Step 3:** Isi schema & `KATEGORI_SISTEM`. Perbarui ekspektasi test lain yang menghitung kategori sistem/daftar sheet (`grep -rn "TARIK_TABUNGAN\|SHEET_NAMES" tests`).
- [ ] **Step 4:** `npm test` → PASS. `npm run template` → xlsx berisi 4 tab baru.
- [ ] **Step 5:** Stage `server/sheets/schema.ts server/services/pengguna.ts template/Saku_Template.xlsx tests/`.

### Task 2: Library QRIS (server + browser)

**Files:**
- Create: `server/common/qris.ts`, `src/lib/qris.ts`
- Test: `tests/qris.test.ts` (impor keduanya: `../server/common/qris`, `../src/lib/qris`)

**Interfaces:**
- Produces (kedua file, signature sama):
  - `crc16(s: string): string` — CRC16-CCITT-FALSE (poly 0x1021, init 0xFFFF), 4 hex uppercase.
  - `parseQris(payload: string): { ok: true; payload: string; merchant: string; kota: string } | { ok: false; pesan: string }` — `payload` hasil trim; validasi spec §5; CRC dibandingkan case-insensitive.
- Produces (hanya `src/lib/qris.ts`): `qrisDinamis(payload: string, nominal: number): string` — tag `01`=`12`, hapus tag `54` lama, sisipkan `54` sebelum `58`, tag `63` dihitung ulang dari string sampai `6304`.

- [ ] **Step 1:** Test: `crc16("123456789") === "29B1"`; buat payload statis contoh di test (rakit TLV: `000201`, `010211`, `26..` berisi `0016ID.CO.QRIS.WWW`, `5802ID`, `5910TOKO SAKU`, `6008SURABAYA`, `6304`+crc) → `parseQris` ok dengan merchant `TOKO SAKU`, kota `SURABAYA`; payload + `"\n "` tetap ok; CRC lowercase ok; CRC salah → `ok:false`; tanpa `ID.CO.QRIS` → `ok:false` dengan pesan Global Constraints; `qrisDinamis(p, 25000)` → mengandung `010212`, `540525000`, `parseQris` hasilnya ok; `qrisDinamis(qrisDinamis(p,1000), 2000)` hanya punya satu tag 54 (`54042000`).
- [ ] **Step 2:** `npx vitest run tests/qris.test.ts` → FAIL.
- [ ] **Step 3:** Implementasi. Parser TLV iteratif: `id = s.slice(i,i+2)`, `len = Number(s.slice(i+2,i+4))`; panjang tidak valid/terpotong → `ok:false`.
- [ ] **Step 4:** Test PASS; `npx tsc -b` lulus (server project ikut memeriksa `src/lib/qris.ts` lewat impor test — tidak boleh memakai API DOM).
- [ ] **Step 5:** Stage.

### Task 3: Service perhitungan & validasi split

**Files:**
- Create: `server/services/split.ts`
- Test: `tests/split-hitung.test.ts` (unit, tanpa HTTP)

**Interfaces:**
- Produces:
  - `export const splitBody` (zod): `{ nama: string 1–60, tanggal?: yyyy-MM-dd, akunId: string, kategoriId: string, akunTerimaId: string, pajak: int ≥0 (default 0), servis: int ≥0 (default 0), diskon: int ≥0 (default 0), peserta: { id?: string; nama: string 1–40; saya: boolean }[], items: { nama: string 1–80; qty: int ≥1; harga: int >0; peserta: number[] /* indeks ke array peserta */ }[] }`; `export type SplitBody`.
  - `hitungBagian(body: Pick<SplitBody,"items"|"pajak"|"servis"|"diskon">, jumlahPeserta: number, indeksSaya: number): { subtotal: number; total: number; nominal: number[] }` — algoritma spec §4 (sisa pembulatan ke `indeksSaya`).
  - `cekSplit(body: SplitBody): void` — lempar `validationError` untuk: `items` kosong (`items`), indeks peserta item kosong/di luar range/dobel (`items.{i}.peserta`), peserta < 2 (`peserta`), jumlah `saya` ≠ 1 (`peserta`), nama dobel case-insensitive (`peserta.{i}.nama` "Nama <x> dobel."), peserta tanpa item (`peserta.{i}.nama` "<nama> belum punya item."), total ≤ 0 (`diskon` "Diskon melebihi subtotal.").

- [ ] **Step 1:** Test `hitungBagian`:
  - 3 item: A 30.000 [0], B 20.000 [1], C 10.000 [0,1,2]; pajak 6.000, servis 0, diskon 0, saya=0 → `{ subtotal: 60000, total: 66000, nominal: [36666, 25667, 3667] }` (porsi ×1,1 = 36666,67 / 25666,67 / 3666,67 → bulat 36667/25667/3667 = 66001, sisa −1 ke saya).
  - Bagi rata 100.000 untuk 3 orang, saya=0 → `[33334, 33333, 33333]`.
  - Diskon 10.000 dari subtotal 50.000 [0],[1] 25.000/25.000 → `[20000, 20000]`.
- [ ] **Step 2:** Test `cekSplit`: tiap aturan di Interfaces menghasilkan key error persis; body valid tidak melempar.
- [ ] **Step 3:** `npx vitest run tests/split-hitung.test.ts` → FAIL.
- [ ] **Step 4:** Implementasi.
- [ ] **Step 5:** Test PASS, stage.

### Task 4: Route `/api/split` + `/api/pengaturan` + penjagaan transaksi

**Files:**
- Create: `server/routes/split.ts`, `server/routes/pengaturan.ts`
- Modify: `server/app.ts` (`app.route("/split", split)`, `app.route("/pengaturan", pengaturan)`)
- Modify: `server/routes/transaksi.ts` (PUT/DELETE muat `SplitBill`, `SplitPeserta`; 409 bila dirujuk)
- Modify: `server/services/pengguna.ts` (export `ensureKategoriSistem` sudah ada — dipakai lazy di lunas)
- Test: `tests/split.test.ts`

**Interfaces:**
- Consumes: `splitBody`, `hitungBagian`, `cekSplit` (Task 3); `parseQris` (Task 2, versi server); `resolveTransaksi`, `rencanaSetorTerdampak`, `simpanSetor`, `peringatanSaldo`, `peringatanAnggaran`, `findOwned`, `newId`, `newRow`, `updatedRow`.
- Produces (JSON):
  - `SplitDto = { id, nama, tanggal, akunId, akunNama, kategoriId, kategoriNama, akunTerimaId, akunTerimaNama, subtotal, pajak, servis, diskon, total, transaksiId, items: { id, nama, qty, harga, peserta: string[] /* id peserta */ }[], peserta: { id, nama, saya, nominal, lunas, transaksiId: string|null }[], belumLunas: { jumlah: number, nominal: number } }`
  - `SplitRingkasDto = { id, nama, tanggal, total, jumlahPeserta, belumLunas: { jumlah, nominal } }` (urut tanggal desc, lalu created_at desc)
  - `GET /split` → `SplitRingkasDto[]`; `GET /split/:id` → `SplitDto`; `POST /split` → 201 `SplitDto & { peringatan: string[] }`; `PUT /split/:id` → `SplitDto & { peringatan }`; `DELETE /split/:id` → 204; `PUT /split/:id/peserta/:pid/lunas` body `{ lunas: boolean, tanggal?: string }` → `SplitDto`; `GET /split/nama` → `string[]` (unik, bukan "saya", urut paling sering dipakai); `GET /pengaturan/qris` → `{ payload, merchant, kota } | null`; `PUT /pengaturan/qris` body `{ payload: string | null }` → objek sama / `null`.

Aturan yang tidak ditentukan signature:
- Validasi master: `akunId` & `akunTerimaId` lewat aturan akun `resolveTransaksi` (error dipetakan ke field `akunId` / `akunTerimaId`); `kategoriId` keluar biasa (error `kategoriId`).
- POST: transaksi keluar `{ tipe:"keluar", akunId, kategoriId, nominal: total, tanggal, deskripsi: nama }`. Peserta `saya` disimpan `lunas: true`, `transaksi_id: ""`.
- PUT: peserta lama dicocokkan via `id`; peserta lama yang `lunas` (bukan saya) tidak ada di body → 422 `peserta` "Peserta <nama> sudah lunas, tidak bisa dihapus."; item & peserta lain di-replace (hapus baris lama bawah-ke-atas, append baru); transaksi keluar di-update; transaksi masuk peserta lunas di-update `nominal` + `akun_id`. Semua update baris lewat satu `simpanSetor(store, setor, updates)`.
- Lunas true: kalau sudah lunas → kembalikan DTO tanpa menulis. Kategori PATUNGAN tidak ada → `ensureKategoriSistem` lalu baca ulang `Kategori`. Lunas false: hapus transaksi masuk, `lunas:false`, `transaksi_id:""`. Peserta `saya` → 422.
- DELETE: hapus transaksi keluar & semua transaksi masuk, lalu baris SplitPeserta, SplitItem, SplitBill (bawah-ke-atas per sheet); setor dihitung ulang untuk semua periode terdampak.
- Pengaturan: satu baris per `(user_id, kunci="qris")`, upsert; `null` menghapus baris.

- [ ] **Step 1:** Test di `tests/split.test.ts` (pakai `siapkan()` + `periode/mulai` saldo BCA 1.000.000 tanggal 2026-10-25):
  - POST split 2 peserta (Saya, Andi) → 201, `total` benar, `GET /transaksi` berisi 1 keluar nominal total dari BCA deskripsi nama split; peserta Saya `lunas:true`.
  - Lunas Andi → transaksi masuk ke `akunTerimaId` (GoPay) kategori `kodeSistem:"PATUNGAN"`, deskripsi `Patungan Makan Bakmi — Andi`; ulangi lunas true → transaksi masuk tetap 1 (**Review Focus 2**); lunas false → transaksi masuk terhapus.
  - Lunas peserta Saya → 422.
  - Hapus baris kategori PATUNGAN dari store sebelum lunas → tetap 200 dan kategori dibuat (**Review Focus 4**).
  - PUT ubah harga item sehingga nominal Andi (lunas) berubah & ganti `akunTerimaId` ke Jago → transaksi masuk Andi nominal & akun baru (**Review Focus 5**); PUT tanpa Andi saat lunas → 422.
  - `PUT /transaksi/<keluar>` dan `DELETE /transaksi/<masuk>` → 409 dengan pesan Global Constraints.
  - DELETE split → 204, transaksi keluar & masuk hilang, `GET /split` kosong.
  - Split milik budi diakses admin → 404.
  - `GET /split/nama` → `["Andi"]`.
  - `PUT /pengaturan/qris` payload valid → merchant/kota; payload sampah → 422 `payload` pesan QRIS; `GET` setelah `null` → `null`.
- [ ] **Step 2:** `npx vitest run tests/split.test.ts` → FAIL.
- [ ] **Step 3:** Implementasi route & daftarkan di `server/app.ts`; tambah penjagaan 409 di `transaksi.ts`.
- [ ] **Step 4:** `npm test` (semua, termasuk transaksi lama) PASS; `npx tsc -b` PASS.
- [ ] **Step 5:** Stage.

### Task 5: Parser teks struk

**Files:**
- Create: `src/lib/parseStruk.ts`
- Test: `tests/parse-struk.test.ts`

**Interfaces:**
- Produces: `parseStruk(teks: string): { items: { nama: string; qty: number; harga: number }[]; pajak: number; servis: number; diskon: number; total: number | null }`
  - Angka: `12.000`, `12,000`, `12000`, `Rp12.000`, `12.000,00` → 12000.
  - Baris item: teks lalu angka terakhir di baris = harga; awalan `2x`/`2 x`/`2 ` sebelum nama atau `x2` → qty (default 1).
  - Label (case-insensitive) diabaikan sebagai item: `sub total|subtotal`, `total|grand total|jumlah` (→ `total`), `pajak|tax|pb1|ppn` (→ `pajak`), `service|servis|svc` (→ `servis`), `diskon|disc|discount|potongan` (→ `diskon`, nilai absolut), `tunai|cash|kembali|change|bayar|debit|qris` (dibuang).
  - Baris tanpa angka atau angka < 100 dibuang.

- [ ] **Step 1:** Test dengan 2 contoh teks struk (restoran dengan PB1 10% + service, dan minimarket dengan diskon & qty `2 x`) — assert items, pajak, servis, diskon, total persis.
- [ ] **Step 2:** FAIL. **Step 3:** Implementasi. **Step 4:** PASS. **Step 5:** Stage.

### Task 6: Hooks frontend + Pengaturan QRIS

**Files:**
- Create: `src/hooks/useSplit.ts`
- Modify: `src/hooks/useTransaksi.ts` (`invalidateKeuangan` + `["split"]`)
- Modify: `src/pages/PengaturanPage.tsx` (bagian "QRIS untuk tagihan")
- Modify: `package.json` (dependensi `jsqr`, `qrcode`, `tesseract.js`, dev `@types/qrcode`)

**Interfaces:**
- Consumes: DTO Task 4; `parseQris` (Task 2 browser).
- Produces: tipe `Split`, `SplitRingkas`, `SplitInput` (= body Task 3); `splitKeys = { semua: ["split"], list: ["split","list"], detail: (id) => ["split", id], nama: ["split","nama"] }`; hooks `useSplitList()`, `useSplit(id)`, `useNamaPeserta()`, `useQris()`; fungsi `simpanSplit(input, id?)`, `hapusSplit(id)`, `setLunas(id, pid, lunas)`, `simpanQris(payload | null)` (semua via `send`).

- [ ] **Step 1:** `npm i jsqr qrcode tesseract.js && npm i -D @types/qrcode`.
- [ ] **Step 2:** Hooks. Pengaturan: input file `accept="image/*"` → gambar ke canvas → `jsQR(imageData)`; null → "QR tidak terbaca, coba gambar lebih jelas."; `parseQris` gagal → tampilkan pesannya; ok → kartu "Merchant · Kota" + tombol Simpan; kalau sudah tersimpan: tampil merchant + tombol Ganti/Hapus.
- [ ] **Step 3:** `npx tsc -b && npm run lint` PASS. Cek manual `npm run dev`: upload gambar QRIS → merchant tampil, simpan, reload tetap ada.
- [ ] **Step 4:** Stage.

### Task 7: Halaman Split Bill (daftar, wizard, detail) + OCR

**Files:**
- Create: `src/pages/SplitPage.tsx` (`/split`), `src/pages/SplitFormPage.tsx` (`/split/baru`, `/split/:id/ubah`), `src/pages/SplitDetailPage.tsx` (`/split/:id`)
- Create: `src/components/split/LangkahStruk.tsx`, `LangkahItem.tsx`, `LangkahPeserta.tsx`, `LangkahRingkasan.tsx`
- Create: `src/lib/ocr.ts` — `bacaStruk(file: File, onProgress: (p: number) => void): Promise<string>` (dynamic `import("tesseract.js")`, `createWorker(["ind","eng"])`, terminate setelah selesai)
- Modify: `src/App.tsx` (3 route), `src/pages/LainnyaPage.tsx` (menu "Split Bill", ikon `ReceiptText`)

**Interfaces:**
- Consumes: Task 5 `parseStruk`, Task 6 hooks, `hitungBagian` **diduplikasi ringan** di `src/lib/splitHitung.ts` (signature sama dengan Task 3, untuk pratinjau langsung; server tetap sumber kebenaran — tambahkan kasus Task 3 Step 1 ke `tests/split-hitung.test.ts` terhadap versi `src`).
- State wizard: satu `useState<SplitInput>` di `SplitFormPage`, peserta indeks 0 = `{ nama: "Saya", saya: true }`.

- [ ] **Step 1:** `LangkahStruk`: tombol "Foto struk" (`<input type="file" accept="image/*" capture="environment">`) → progress bar → `parseStruk` → isi state; teks kosong/0 item → pesan "Struk tidak terbaca, isi manual atau foto ulang"; tombol "Isi manual".
- [ ] **Step 2:** `LangkahItem`: list item editable (nama, qty, harga `MoneyInput`), tambah/hapus, field pajak/servis/diskon, total; kalau `total` OCR ≠ total hitung → alert kuning "Total struk Rp X, hasil hitung Rp Y. Cek lagi item." 
- [ ] **Step 3:** `LangkahPeserta`: tambah nama dengan `<datalist>` dari `useNamaPeserta`; tiap item punya chip peserta toggle; tombol "Bagi rata" (semua item → semua peserta); pratinjau nominal per orang dari `splitHitung`.
- [ ] **Step 4:** `LangkahRingkasan`: nama split, tanggal, akun pembayar, kategori keluar, akun penerima (default akun bernama "GoPay" kalau ada), daftar bagian → Simpan → toast peringatan (seperti transaksi) → navigasi `/split/:id`. Error server dipetakan ke langkah yang memuat field-nya.
- [ ] **Step 5:** `SplitPage`: daftar kartu (nama, tanggal, total, badge "N belum bayar · Rp X" / "Lunas semua"), tombol "Split baru". `SplitDetailPage`: rincian, peserta dengan checkbox Lunas (`setLunas`, invalidate keuangan), tombol Bagikan (Task 8 — sementara disabled), Ubah, Hapus (konfirmasi in-page, bukan `window.confirm`).
- [ ] **Step 6:** `npx tsc -b && npm run lint && npm test` PASS. Cek manual alur buat → lunas → hapus di `npm run dev`.
- [ ] **Step 7:** Stage.

### Task 8: Kartu bagikan (QRIS bernominal + share WhatsApp)

**Files:**
- Create: `src/lib/kartuSplit.ts` — `buatKartu(opts: { split: Split; pesertaId: string; qris: string | null }): Promise<Blob>` (PNG 1080 px lebar, canvas 2D; QR via `QRCode.toCanvas` dari `qrisDinamis(qris, nominal)`)
- Create: `src/lib/bagikan.ts` — `bagikanGambar(blob: Blob, namaFile: string, teks: string): Promise<"share" | "unduh">`
- Modify: `src/pages/SplitDetailPage.tsx` (aktifkan tombol Bagikan per peserta, sembunyikan untuk `saya`)

**Interfaces:**
- Consumes: `qrisDinamis` (Task 2), `useQris` (Task 6), `Split` (Task 6).
- Isi kartu (urut): nama split, tanggal (`formatTanggalPanjang`), "Tagihan untuk <nama>", item miliknya dengan porsi (`harga / jumlah peserta item`, ditandai "½", "⅓" atau "1/n" bila dibagi), baris "Pajak & servis" / "Diskon" = `nominal − Σ porsi`, Total (besar), QR + nama merchant, catatan "Simpan gambar ini, lalu bayar lewat Scan QR → pilih dari Galeri di aplikasi e-wallet." Tanpa QRIS: kotak "QRIS belum diatur" ganti QR.
- Teks share: `Halo <nama>, tagihan <nama split>: Rp X. Bayar lewat QRIS di gambar ya.`
- `bagikanGambar`: `navigator.canShare?.({ files })` → `navigator.share({ files, text })`; `AbortError` dianggap selesai; selain itu unduh via `<a download>`.

- [ ] **Step 1:** Implementasi; font canvas `Manrope Variable` (sudah dimuat app), warna token Sunrise ditulis literal hex dari `src/index.css`.
- [ ] **Step 2:** Cek manual di HP (`npm run dev -- --host`): Bagikan → share sheet → WhatsApp menerima gambar; QR di gambar di-scan aplikasi e-wallet menampilkan nominal terisi.
- [ ] **Step 3:** `npx tsc -b && npm run lint` PASS. Stage.

### Task 9: Kartu dashboard, dokumentasi, spreadsheet asli

**Files:**
- Create: `src/components/keuangan/KartuSplit.tsx` (pakai `useSplitList`; tampil hanya bila Σ `belumLunas.jumlah` > 0: "Split bill: N orang belum bayar · Rp X", link `/split`)
- Modify: `src/pages/DashboardPage.tsx` (render `<KartuSplit />` di bawah `KartuAnggaran`)
- Modify: `src/lib/apiKatalog.ts` (grup "Split Bill" & "Pengaturan": semua endpoint Task 4, contoh tanpa kredensial/payload QRIS asli)
- Modify: `docs/SAKU_API_SPEC.md` (§5 sheet baru, §7 aturan split, §10 endpoint, PATUNGAN di daftar kategori sistem)
- Script sementara `scripts/tambah_sheet_split.ts` (dihapus setelah jalan): buat tab `SplitBill`, `SplitItem`, `SplitPeserta`, `Pengaturan` + header di spreadsheet asli bila belum ada; **jalankan hanya setelah user setuju**.

- [ ] **Step 1:** Kartu + dashboard; katalog & spec.
- [ ] **Step 2:** `npm run build && npm test` PASS.
- [ ] **Step 3:** Minta izin user → jalankan script sheet asli → `GET /api/health/sheets` ok → hapus script.
- [ ] **Step 4:** Laporkan ke user; commit/push hanya bila diminta.
