import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app.js";
import { loadSession, requireAuth } from "../auth/session.js";
import { nowWibIso, todayWib } from "../common/clock.js";
import { AppError, validationError, type FieldErrors } from "../common/errors.js";
import { jsonBody } from "../common/validation.js";
import { findOwned, newId, newRow, notFound, rowsOf, updatedRow, type Row } from "../repositories/rows.js";
import { pesanBelumDipilih, pilihanAkun } from "../services/akun-pengguna.js";
import { peringatanAnggaran } from "../services/anggaran.js";
import { ensureKategoriSistem } from "../services/pengguna.js";
import { cekSplit, hitungBagian, splitBody, type SplitBody } from "../services/split.js";
import { rencanaSetorTerdampak, simpanSetor } from "../services/tabungan.js";
import { peringatanSaldo, resolveTransaksi } from "../services/transaksi.js";
import type { Baris, NamaTabel } from "../db/schema.js";
import type { DataTabel, Operasi } from "../db/store.js";

const TABEL = [
  "Akun",
  "AkunPengguna",
  "Kategori",
  "KelompokKategori",
  "Periode",
  "SaldoAwal",
  "Transaksi",
  "Tabungan",
  "Anggaran",
  "SplitBill",
  "SplitItem",
  "SplitPeserta",
] as const;

function parseAll(data: DataTabel<(typeof TABEL)[number]>) {
  return {
    akun: rowsOf(data, "Akun"),
    akunPengguna: rowsOf(data, "AkunPengguna"),
    kategori: rowsOf(data, "Kategori"),
    kelompok: rowsOf(data, "KelompokKategori"),
    periode: rowsOf(data, "Periode"),
    saldoAwal: rowsOf(data, "SaldoAwal"),
    transaksi: rowsOf(data, "Transaksi"),
    tabungan: rowsOf(data, "Tabungan"),
    anggaran: rowsOf(data, "Anggaran"),
    bill: rowsOf(data, "SplitBill"),
    item: rowsOf(data, "SplitItem"),
    peserta: rowsOf(data, "SplitPeserta"),
  };
}

type Isi = ReturnType<typeof parseAll>;
type Bill = Row<"SplitBill">["data"];
type T = Row<"Transaksi">["data"];

const urut = (a: { data: { urutan: number | null } }, b: { data: { urutan: number | null } }) => (a.data.urutan ?? 0) - (b.data.urutan ?? 0);
const itemsOf = (s: Isi, id: string) => s.item.filter((r) => r.data.split_id === id).sort(urut);
const pesertaOf = (s: Isi, id: string) => s.peserta.filter((r) => r.data.split_id === id).sort(urut);
const deskripsiMasuk = (split: string, nama: string) => `Patungan ${split} — ${nama}`;

function belumLunas(peserta: Row<"SplitPeserta">[]) {
  const belum = peserta.filter((p) => !p.data.saya && !p.data.lunas);
  return { jumlah: belum.length, nominal: belum.reduce((a, p) => a + (p.data.nominal ?? 0), 0) };
}

function toDto(s: Isi, b: Bill) {
  const namaAkun = (id: string) => s.akun.find((a) => a.data.id === id)?.data.nama ?? "(akun dihapus)";
  const items = itemsOf(s, b.id);
  const peserta = pesertaOf(s, b.id);
  return {
    id: b.id,
    nama: b.nama,
    tanggal: b.tanggal ?? "",
    akunId: b.akun_id,
    akunNama: namaAkun(b.akun_id),
    kategoriId: b.kategori_id,
    kategoriNama: s.kategori.find((k) => k.data.id === b.kategori_id)?.data.nama ?? "(kategori dihapus)",
    akunTerimaId: b.akun_terima_id,
    akunTerimaNama: namaAkun(b.akun_terima_id),
    subtotal: items.reduce((a, it) => a + (it.data.harga ?? 0), 0),
    pajak: b.pajak ?? 0,
    servis: b.servis ?? 0,
    diskon: b.diskon ?? 0,
    total: b.total ?? 0,
    transaksiId: b.transaksi_id || null,
    items: items.map(({ data: it }) => ({ id: it.id, nama: it.nama, qty: it.qty ?? 1, harga: it.harga ?? 0, peserta: it.peserta.split(",").filter(Boolean) })),
    peserta: peserta.map(({ data: p }) => ({ id: p.id, nama: p.nama, saya: p.saya, nominal: p.nominal ?? 0, lunas: p.lunas, transaksiId: p.transaksi_id || null })),
    belumLunas: belumLunas(peserta),
  };
}

/** ID baru sebanyak `n`, unik terhadap baris yang ada dan satu sama lain. */
function idBaru(tabel: "SplitItem" | "SplitPeserta" | "Transaksi", existing: { data: { id: string } }[], n: number): string[] {
  const used = [...existing];
  return Array.from({ length: n }, () => {
    const id = newId(tabel, used);
    used.push({ data: { id } });
    return id;
  });
}

/** Akun penerima: aturan sama dengan akun transaksi (aktif & dipilih), akun lama boleh tetap. */
function cekAkunTerima(s: Isi, uid: string, id: string, lama?: string): string | null {
  const a = s.akun.find((r) => r.data.id === id)?.data;
  if (!a) return "Akun tidak ditemukan.";
  if (id === lama) return null;
  if (!a.aktif) return `Akun ${a.nama} nonaktif dan tidak bisa dipakai.`;
  if (!pilihanAkun(s.akunPengguna, uid).dipilih(id)) return pesanBelumDipilih(a.nama);
  return null;
}

/** Validasi lengkap body + kolom transaksi keluar. Error field digabung dalam satu 400. */
function siapkanKeluar(s: Isi, uid: string, clock: AppEnv["Variables"]["clock"], body: SplitBody, total: number, lama?: { bill: Bill; keluar?: T }) {
  cekSplit(body);
  const errors: FieldErrors = {};
  const terima = cekAkunTerima(s, uid, body.akunTerimaId, lama?.bill.akun_terima_id);
  if (terima) errors.akunTerimaId = [terima];
  let kolom: ReturnType<typeof resolveTransaksi> | undefined;
  try {
    kolom = resolveTransaksi(
      { tipe: "keluar", akunId: body.akunId, kategoriId: body.kategoriId, nominal: total, tanggal: body.tanggal ?? lama?.bill.tanggal ?? todayWib(clock), deskripsi: body.nama },
      s,
      uid,
      clock,
      lama?.keluar,
    );
  } catch (e) {
    if (!(e instanceof AppError) || !e.errors) throw e;
    Object.assign(errors, e.errors);
  }
  if (Object.keys(errors).length || !kolom) throw validationError(errors);
  return kolom;
}

export const split = new Hono<AppEnv>();

split.use(requireAuth);

split.get("/", async (c) => {
  const { user, data } = await loadSession(c, ["SplitBill", "SplitPeserta"]);
  const uid = user.data.id;
  const peserta = rowsOf(data, "SplitPeserta");
  const list = rowsOf(data, "SplitBill")
    .map((r) => r.data)
    .filter((b) => b.user_id === uid)
    .sort((a, b) => (b.tanggal ?? "").localeCompare(a.tanggal ?? "") || (b.created_at ?? "").localeCompare(a.created_at ?? ""))
    .map((b) => {
      const p = peserta.filter((r) => r.data.split_id === b.id);
      return { id: b.id, nama: b.nama, tanggal: b.tanggal ?? "", total: b.total ?? 0, jumlahPeserta: p.length, belumLunas: belumLunas(p) };
    });
  return c.json(list);
});

/** Nama peserta yang pernah dipakai (autocomplete), paling sering dulu. */
split.get("/nama", async (c) => {
  const { user, data } = await loadSession(c, ["SplitPeserta"]);
  const hitung = new Map<string, { nama: string; n: number }>();
  for (const { data: p } of rowsOf(data, "SplitPeserta")) {
    if (p.user_id !== user.data.id || p.saya) continue;
    const key = p.nama.toLowerCase();
    const cur = hitung.get(key);
    hitung.set(key, { nama: cur?.nama ?? p.nama, n: (cur?.n ?? 0) + 1 });
  }
  return c.json([...hitung.values()].sort((a, b) => b.n - a.n || a.nama.localeCompare(b.nama, "id")).map((x) => x.nama));
});

split.get("/:id", async (c) => {
  const { user, data } = await loadSession(c, TABEL);
  const s = parseAll(data);
  return c.json(toDto(s, findOwned(s.bill, c.req.param("id"), user.data.id).data));
});

split.post("/", jsonBody(splitBody), async (c) => {
  const body = c.req.valid("json");
  const { user, data } = await loadSession(c, TABEL);
  const uid = user.data.id;
  const clock = c.var.clock;
  const s = parseAll(data);

  const indeksSaya = body.peserta.findIndex((p) => p.saya);
  const hasil = hitungBagian(body, body.peserta.length, Math.max(0, indeksSaya));
  const kolomTr = siapkanKeluar(s, uid, clock, body, hasil.total);

  const [trId] = idBaru("Transaksi", s.transaksi, 1);
  const splitId = newId("SplitBill", s.bill);
  const pesertaId = idBaru("SplitPeserta", s.peserta, body.peserta.length);
  const itemId = idBaru("SplitItem", s.item, body.items.length);

  const keluar = { id: trId, user_id: uid, ...kolomTr, berulang_id: "", label: "" };
  const fullKeluar = { ...keluar, created_by: uid, created_at: nowWibIso(clock), updated_by: "", updated_at: null };
  const after = [...s.transaksi, { data: fullKeluar }];
  const setor = rencanaSetorTerdampak([kolomTr.periode_id], s.periode, s.saldoAwal, after, s.tabungan, uid, clock);

  const bill = {
    id: splitId,
    user_id: uid,
    tanggal: kolomTr.tanggal,
    nama: body.nama,
    akun_id: body.akunId,
    kategori_id: body.kategoriId,
    akun_terima_id: body.akunTerimaId,
    pajak: body.pajak,
    servis: body.servis,
    diskon: body.diskon,
    total: hasil.total,
    transaksi_id: trId,
  };
  const items = body.items.map((it, i) => ({
    id: itemId[i],
    user_id: uid,
    split_id: splitId,
    nama: it.nama,
    qty: it.qty,
    harga: it.harga,
    peserta: it.peserta.map((p) => pesertaId[p]).join(","),
    urutan: i + 1,
  }));
  const peserta = body.peserta.map((p, i) => ({
    id: pesertaId[i],
    user_id: uid,
    split_id: splitId,
    nama: p.nama,
    saya: p.saya,
    nominal: hasil.nominal[i],
    lunas: p.saya,
    transaksi_id: "",
    urutan: i + 1,
  }));

  // Split, item, peserta, transaksi keluar & setor: satu transaksi database
  await simpanSetor(c.var.store(), setor, [
    { jenis: "insert", tabel: "SplitBill", baris: [newRow("SplitBill", bill, uid, clock)] },
    { jenis: "insert", tabel: "SplitItem", baris: items.map((it) => newRow("SplitItem", it, uid, clock)) },
    { jenis: "insert", tabel: "SplitPeserta", baris: peserta.map((p) => newRow("SplitPeserta", p, uid, clock)) },
    { jenis: "insert", tabel: "Transaksi", baris: [newRow("Transaksi", keluar, uid, clock)] },
  ]);

  const audit = { created_by: uid, created_at: nowWibIso(clock), updated_by: "", updated_at: null };
  const sesudah: Isi = {
    ...s,
    transaksi: after,
    bill: [...s.bill, { data: { ...bill, ...audit } }],
    item: [...s.item, ...items.map((it) => ({ data: { ...it, ...audit } }))],
    peserta: [...s.peserta, ...peserta.map((p) => ({ data: { ...p, ...audit } }))],
  };
  const peringatan = [...peringatanSaldo(fullKeluar, s.saldoAwal, after, s.akun), ...peringatanAnggaran(fullKeluar, s.anggaran, s.kategori, s.kelompok, after)];
  return c.json({ ...toDto(sesudah, sesudah.bill[sesudah.bill.length - 1].data), peringatan }, 201);
});

/**
 * Ganti isi split. Peserta lama dicocokkan lewat `id`; peserta lunas tidak boleh hapus.
 * Item diganti semua. Transaksi keluar & transaksi masuk peserta lunas ikut diperbarui.
 */
split.put("/:id", jsonBody(splitBody), async (c) => {
  const body = c.req.valid("json");
  const { user, data } = await loadSession(c, TABEL);
  const uid = user.data.id;
  const clock = c.var.clock;
  const s = parseAll(data);
  const target = findOwned(s.bill, c.req.param("id"), uid);
  const b = target.data;
  const lamaItem = itemsOf(s, b.id);
  const lamaPeserta = pesertaOf(s, b.id);
  const keluarLama = s.transaksi.find((t) => t.data.id === b.transaksi_id);

  // Peserta lama yang sudah lunas harus tetap ada
  const dipakai = new Set(body.peserta.map((p) => p.id).filter(Boolean));
  const hilang = lamaPeserta.find((p) => !p.data.saya && p.data.lunas && !dipakai.has(p.data.id));
  if (hilang) throw new AppError(422, "Peserta yang sudah lunas tidak bisa dihapus.", { peserta: [`Peserta ${hilang.data.nama} sudah lunas, tidak bisa dihapus.`] });

  const indeksSaya = body.peserta.findIndex((p) => p.saya);
  const hasil = hitungBagian(body, body.peserta.length, Math.max(0, indeksSaya));
  const kolomTr = siapkanKeluar(s, uid, clock, body, hasil.total, { bill: b, keluar: keluarLama?.data });

  const updates: Operasi[] = [];
  const appends: Operasi[] = [];
  const push = <S extends NamaTabel>(tabel: S, baris: Baris<S>) => appends.push({ jenis: "insert", tabel, baris: [baris] } as Operasi);
  const hapus: Operasi[] = [];
  const now = nowWibIso(clock);
  let transaksi = [...s.transaksi];
  const periodeTerdampak: string[] = [kolomTr.periode_id];

  // Transaksi keluar
  let trKeluarId = b.transaksi_id;
  if (keluarLama) {
    periodeTerdampak.push(keluarLama.data.periode_id);
    updates.push({ jenis: "update", tabel: "Transaksi", baris: updatedRow("Transaksi", keluarLama.data, kolomTr, uid, clock) });
    transaksi = transaksi.map((r) => (r.data.id === keluarLama.data.id ? { data: { ...r.data, ...kolomTr } } : r));
  } else {
    [trKeluarId] = idBaru("Transaksi", s.transaksi, 1);
    const baru = { id: trKeluarId, user_id: uid, ...kolomTr, berulang_id: "", label: "" };
    push("Transaksi", newRow("Transaksi", baru, uid, clock));
    transaksi.push({ data: { ...baru, created_by: uid, created_at: now, updated_by: "", updated_at: null } });
  }

  // Peserta: pertahankan yang cocok (id, lunas, transaksi), tambah yang baru, hapus sisanya
  const lamaById = new Map(lamaPeserta.map((p) => [p.data.id, p]));
  const pesertaBaruId = idBaru("SplitPeserta", s.peserta, body.peserta.length);
  const pesertaId = body.peserta.map((p, i) => (p.id && lamaById.has(p.id) ? p.id : pesertaBaruId[i]));
  const errors: FieldErrors = {};
  const pesertaData: Row<"SplitPeserta">["data"][] = [];
  body.peserta.forEach((p, i) => {
    const lama = lamaById.get(pesertaId[i]);
    const kolom = { nama: p.nama, saya: p.saya, nominal: hasil.nominal[i], urutan: i + 1 };
    if (!lama) {
      const baru = { id: pesertaId[i], user_id: uid, split_id: b.id, ...kolom, lunas: p.saya, transaksi_id: "" };
      push("SplitPeserta", newRow("SplitPeserta", baru, uid, clock));
      pesertaData.push({ ...baru, created_by: uid, created_at: now, updated_by: "", updated_at: null });
      return;
    }
    // "Saya" selalu lunas tanpa transaksi; peserta yang berubah jadi "saya" kehilangan status bayar
    const masuk = lama.data.transaksi_id ? s.transaksi.find((t) => t.data.id === lama.data.transaksi_id) : undefined;
    const lunas = p.saya || lama.data.lunas;
    const changes = { ...kolom, lunas, transaksi_id: p.saya ? "" : lama.data.transaksi_id };
    if (masuk && p.saya) {
      hapus.push({ jenis: "delete", tabel: "Transaksi", id: masuk.data.id });
      periodeTerdampak.push(masuk.data.periode_id);
      transaksi = transaksi.filter((r) => r.data.id !== masuk.data.id);
    } else if (masuk) {
      try {
        const kolomMasuk = resolveTransaksi(
          { tipe: "masuk", akunId: body.akunTerimaId, kategoriId: masuk.data.kategori_id, nominal: hasil.nominal[i], tanggal: masuk.data.tanggal ?? undefined, deskripsi: deskripsiMasuk(body.nama, p.nama) },
          s,
          uid,
          clock,
          masuk.data,
        );
        updates.push({ jenis: "update", tabel: "Transaksi", baris: updatedRow("Transaksi", masuk.data, kolomMasuk, uid, clock) });
        transaksi = transaksi.map((r) => (r.data.id === masuk.data.id ? { data: { ...r.data, ...kolomMasuk } } : r));
        periodeTerdampak.push(masuk.data.periode_id, kolomMasuk.periode_id);
      } catch (e) {
        if (!(e instanceof AppError) || !e.errors) throw e;
        for (const [k, v] of Object.entries(e.errors)) (errors[k === "akunId" ? "akunTerimaId" : `peserta.${i}.nama`] ??= []).push(...v);
      }
    }
    updates.push({ jenis: "update", tabel: "SplitPeserta", baris: updatedRow("SplitPeserta", lama.data, changes, uid, clock) });
    pesertaData.push({ ...lama.data, ...changes });
  });
  if (Object.keys(errors).length) throw validationError(errors);
  const tetap = new Set(pesertaId);
  for (const p of lamaPeserta) if (!tetap.has(p.data.id)) hapus.push({ jenis: "delete", tabel: "SplitPeserta", id: p.data.id });

  // Item: ganti semua
  for (const it of lamaItem) hapus.push({ jenis: "delete", tabel: "SplitItem", id: it.data.id });
  const itemId = idBaru("SplitItem", s.item, body.items.length);
  const itemData = body.items.map((it, i) => ({
    id: itemId[i],
    user_id: uid,
    split_id: b.id,
    nama: it.nama,
    qty: it.qty,
    harga: it.harga,
    peserta: it.peserta.map((p) => pesertaId[p]).join(","),
    urutan: i + 1,
  }));
  for (const it of itemData) push("SplitItem", newRow("SplitItem", it, uid, clock));

  const billChanges = {
    tanggal: kolomTr.tanggal,
    nama: body.nama,
    akun_id: body.akunId,
    kategori_id: body.kategoriId,
    akun_terima_id: body.akunTerimaId,
    pajak: body.pajak,
    servis: body.servis,
    diskon: body.diskon,
    total: hasil.total,
    transaksi_id: trKeluarId,
  };
  updates.push({ jenis: "update", tabel: "SplitBill", baris: updatedRow("SplitBill", b, billChanges, uid, clock) });

  const setor = rencanaSetorTerdampak(periodeTerdampak, s.periode, s.saldoAwal, transaksi, s.tabungan, uid, clock);
  await simpanSetor(c.var.store(), setor, [...updates, ...appends, ...hapus]);

  const audit = { created_by: uid, created_at: now, updated_by: "", updated_at: null };
  const billBaru = { ...b, ...billChanges };
  const sesudah: Isi = {
    ...s,
    transaksi,
    bill: s.bill.map((r) => (r.data.id === target.data.id ? { data: billBaru } : r)),
    item: [...s.item.filter((r) => r.data.split_id !== b.id), ...itemData.map((it) => ({ data: { ...it, ...audit } }))],
    peserta: [...s.peserta.filter((r) => r.data.split_id !== b.id), ...pesertaData.map((p) => ({ data: p }))],
  };
  const keluar = transaksi.find((t) => t.data.id === trKeluarId)!.data;
  const peringatan = [...peringatanSaldo(keluar, s.saldoAwal, transaksi, s.akun), ...peringatanAnggaran(keluar, s.anggaran, s.kategori, s.kelompok, transaksi)];
  return c.json({ ...toDto(sesudah, billBaru), peringatan });
});

split.delete("/:id", async (c) => {
  const { user, data } = await loadSession(c, TABEL);
  const uid = user.data.id;
  const s = parseAll(data);
  const target = findOwned(s.bill, c.req.param("id"), uid);
  const peserta = pesertaOf(s, target.data.id);
  const trIds = new Set([target.data.transaksi_id, ...peserta.map((p) => p.data.transaksi_id)].filter(Boolean));
  const trRows = s.transaksi.filter((t) => trIds.has(t.data.id));

  const after = s.transaksi.filter((t) => !trIds.has(t.data.id));
  const setor = rencanaSetorTerdampak(
    trRows.map((t) => t.data.periode_id),
    s.periode,
    s.saldoAwal,
    after,
    s.tabungan,
    uid,
    c.var.clock,
  );
  await simpanSetor(c.var.store(), setor, [
    ...trRows.map((t) => ({ jenis: "delete", tabel: "Transaksi", id: t.data.id }) as Operasi),
    ...peserta.map((p) => ({ jenis: "delete", tabel: "SplitPeserta", id: p.data.id }) as Operasi),
    ...itemsOf(s, target.data.id).map((it) => ({ jenis: "delete", tabel: "SplitItem", id: it.data.id }) as Operasi),
    { jenis: "delete", tabel: "SplitBill", id: target.data.id },
  ]);
  return c.body(null, 204);
});

/** Centang lunas = transaksi masuk kategori PATUNGAN ke akun penerima; uncentang = hapus transaksi itu. Idempoten. */
split.put(
  "/:id/peserta/:pid/lunas",
  jsonBody(
    z.object({
      lunas: z.boolean({ error: "Lunas harus true/false." }),
      tanggal: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Format tanggal harus yyyy-MM-dd." }).optional(),
    }),
  ),
  async (c) => {
    const body = c.req.valid("json");
    const { user, data } = await loadSession(c, TABEL);
    const uid = user.data.id;
    const clock = c.var.clock;
    let s = parseAll(data);
    const b = findOwned(s.bill, c.req.param("id"), uid).data;
    const p = findOwned(s.peserta, c.req.param("pid"), uid);
    if (p.data.split_id !== b.id) throw notFound();
    if (p.data.saya) throw new AppError(422, "Bagianmu sendiri tidak perlu ditandai lunas.");
    // Idempoten. Lunas tanpa transaksi masuk (penulisan sebelumnya gagal di tengah) → buat ulang transaksinya
    const adaMasuk = s.transaksi.some((t) => t.data.id === p.data.transaksi_id);
    if (body.lunas ? p.data.lunas && adaMasuk : !p.data.lunas) return c.json(toDto(s, b));

    const store = c.var.store();
    if (body.lunas) {
      if ((p.data.nominal ?? 0) <= 0) throw new AppError(422, `${p.data.nama} tidak punya tagihan.`);
      let patungan = s.kategori.find((k) => k.data.kode_sistem === "PATUNGAN");
      if (!patungan) {
        // Data lama: kategori sistem baru belum ada
        await ensureKategoriSistem(store, data.Kategori, uid, clock);
        s = { ...s, kategori: rowsOf(await store.read(["Kategori"]), "Kategori") };
        patungan = s.kategori.find((k) => k.data.kode_sistem === "PATUNGAN");
        if (!patungan) throw new AppError(500, "Kategori Patungan tidak tersedia.");
      }
      let kolom: ReturnType<typeof resolveTransaksi>;
      try {
        kolom = resolveTransaksi(
          {
            tipe: "masuk",
            akunId: b.akun_terima_id,
            kategoriId: patungan.data.id,
            nominal: p.data.nominal ?? 0,
            tanggal: body.tanggal ?? todayWib(clock),
            deskripsi: deskripsiMasuk(b.nama, p.data.nama),
          },
          s,
          uid,
          clock,
        );
      } catch (e) {
        // Akun penerima bermasalah → arahkan ke field split, bukan akunId transaksi
        if (e instanceof AppError && e.errors?.akunId) throw new AppError(422, `Akun penerima: ${e.errors.akunId[0]}`);
        throw e;
      }
      const [trId] = idBaru("Transaksi", s.transaksi, 1);
      const baru = { id: trId, user_id: uid, ...kolom, berulang_id: "", label: "" };
      const after = [...s.transaksi, { data: { ...baru, created_by: uid, created_at: nowWibIso(clock), updated_by: "", updated_at: null } }];
      const setor = rencanaSetorTerdampak([kolom.periode_id], s.periode, s.saldoAwal, after, s.tabungan, uid, clock);
      const changes = { lunas: true, transaksi_id: trId };
      // Tandai peserta + transaksi masuk + setor: satu transaksi database
      await simpanSetor(store, setor, [
        { jenis: "update", tabel: "SplitPeserta", baris: updatedRow("SplitPeserta", p.data, changes, uid, clock) },
        { jenis: "insert", tabel: "Transaksi", baris: [newRow("Transaksi", baru, uid, clock)] },
      ]);
      return c.json(toDto({ ...s, transaksi: after, peserta: s.peserta.map((r) => (r.data.id === p.data.id ? { data: { ...r.data, ...changes } } : r)) }, b));
    }

    const masuk = s.transaksi.find((t) => t.data.id === p.data.transaksi_id);
    const after = s.transaksi.filter((t) => t !== masuk);
    const setor = rencanaSetorTerdampak(masuk ? [masuk.data.periode_id] : [], s.periode, s.saldoAwal, after, s.tabungan, uid, clock);
    const changes = { lunas: false, transaksi_id: "" };
    await simpanSetor(store, setor, [
      { jenis: "update", tabel: "SplitPeserta", baris: updatedRow("SplitPeserta", p.data, changes, uid, clock) },
      ...(masuk ? [{ jenis: "delete", tabel: "Transaksi", id: masuk.data.id } as Operasi] : []),
    ]);
    return c.json(toDto({ ...s, transaksi: after, peserta: s.peserta.map((r) => (r.data.id === p.data.id ? { data: { ...r.data, ...changes } } : r)) }, b));
  },
);
