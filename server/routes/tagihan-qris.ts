import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app.js";
import { loadSession, requireAuth } from "../auth/session.js";
import { nowWibIso, todayWib } from "../common/clock.js";
import { jsonBody } from "../common/validation.js";
import { findOwned, newId, newRow, rowsOf, updatedRow, type Row } from "../repositories/rows.js";
import { deskripsiTagihan } from "../services/tagihan-qris.js";
import { rencanaSetorTerdampak, simpanSetor } from "../services/tabungan.js";
import { resolveTransaksi } from "../services/transaksi.js";
import type { DataTabel, Operasi } from "../db/store.js";

const TABEL = ["Akun", "AkunPengguna", "Kategori", "Periode", "SaldoAwal", "Transaksi", "Tabungan", "TagihanQris"] as const;

function parseAll(data: DataTabel<(typeof TABEL)[number]>) {
  return {
    akun: rowsOf(data, "Akun"),
    akunPengguna: rowsOf(data, "AkunPengguna"),
    kategori: rowsOf(data, "Kategori"),
    periode: rowsOf(data, "Periode"),
    saldoAwal: rowsOf(data, "SaldoAwal"),
    transaksi: rowsOf(data, "Transaksi"),
    tabungan: rowsOf(data, "Tabungan"),
    tagihan: rowsOf(data, "TagihanQris"),
  };
}

type Isi = ReturnType<typeof parseAll>;
type Tagihan = Row<"TagihanQris">["data"];

function toDto(s: Pick<Isi, "akun" | "kategori">, t: Tagihan) {
  return {
    id: t.id,
    tanggal: t.tanggal ?? "",
    nominal: t.nominal ?? 0,
    keterangan: t.keterangan,
    akunId: t.akun_id,
    akunNama: s.akun.find((a) => a.data.id === t.akun_id)?.data.nama ?? "(akun dihapus)",
    kategoriId: t.kategori_id,
    kategoriNama: s.kategori.find((k) => k.data.id === t.kategori_id)?.data.nama ?? "(kategori dihapus)",
    lunas: t.lunas,
    transaksiId: t.transaksi_id || null,
  };
}

const tagihanBody = z.object({
  nominal: z.number({ error: "Nominal harus berupa angka." }).int({ error: "Nominal harus bilangan bulat." }).positive({ error: "Nominal harus lebih dari 0." }),
  keterangan: z.string().trim().max(100, { error: "Keterangan maksimal 100 karakter." }).default(""),
  akunId: z.string({ error: "Akun wajib dipilih." }).min(1, { error: "Akun wajib dipilih." }),
  kategoriId: z.string({ error: "Kategori wajib dipilih." }).min(1, { error: "Kategori wajib dipilih." }),
});

/** Tagihan QRIS bernominal: tersimpan saat QR dibuat, ditandai lunas setelah dibayar. */
export const tagihanQris = new Hono<AppEnv>();

tagihanQris.use(requireAuth);

tagihanQris.get("/", async (c) => {
  const { user, data } = await loadSession(c, ["Akun", "Kategori", "TagihanQris"]);
  const s = { akun: rowsOf(data, "Akun"), kategori: rowsOf(data, "Kategori") };
  const list = rowsOf(data, "TagihanQris")
    .map((r) => r.data)
    .filter((t) => t.user_id === user.data.id)
    .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))
    .map((t) => toDto(s, t));
  return c.json(list);
});

tagihanQris.post("/", jsonBody(tagihanBody), async (c) => {
  const body = c.req.valid("json");
  const { user, data } = await loadSession(c, TABEL);
  const uid = user.data.id;
  const clock = c.var.clock;
  const s = parseAll(data);
  // Validasi akun & kategori dengan aturan transaksi masuk, supaya "Sudah dibayar" nanti tidak gagal
  resolveTransaksi({ tipe: "masuk", akunId: body.akunId, kategoriId: body.kategoriId, nominal: body.nominal, deskripsi: deskripsiTagihan(body.keterangan) }, s, uid, clock);

  const baru = {
    id: newId("TagihanQris", s.tagihan),
    user_id: uid,
    tanggal: todayWib(clock),
    nominal: body.nominal,
    keterangan: body.keterangan,
    akun_id: body.akunId,
    kategori_id: body.kategoriId,
    lunas: false,
    transaksi_id: "",
  };
  await c.var.store().append("TagihanQris", [newRow("TagihanQris", baru, uid, clock)]);
  return c.json(toDto(s, { ...baru, created_by: uid, created_at: nowWibIso(clock), updated_by: "", updated_at: null }), 201);
});

/** Lunas = transaksi masuk ke akun & kategori tagihan; batal lunas = hapus transaksi itu. Idempoten. */
tagihanQris.put(
  "/:id/lunas",
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
    const s = parseAll(data);
    const target = findOwned(s.tagihan, c.req.param("id"), uid);
    const t = target.data;
    // Lunas tanpa transaksi (penulisan sebelumnya gagal di tengah) → buat ulang transaksinya
    const masuk = s.transaksi.find((r) => r.data.id === t.transaksi_id);
    if (body.lunas ? t.lunas && masuk : !t.lunas) return c.json(toDto(s, t));

    const store = c.var.store();
    if (body.lunas) {
      const kolom = resolveTransaksi(
        { tipe: "masuk", akunId: t.akun_id, kategoriId: t.kategori_id, nominal: t.nominal ?? 0, tanggal: body.tanggal ?? todayWib(clock), deskripsi: deskripsiTagihan(t.keterangan) },
        s,
        uid,
        clock,
      );
      const trId = newId("Transaksi", s.transaksi);
      const baru = { id: trId, user_id: uid, ...kolom, berulang_id: "", label: "" };
      const after = [...s.transaksi, { data: { ...baru, created_by: uid, created_at: nowWibIso(clock), updated_by: "", updated_at: null } }];
      const setor = rencanaSetorTerdampak([kolom.periode_id], s.periode, s.saldoAwal, after, s.tabungan, uid, clock);
      const changes = { lunas: true, transaksi_id: trId };
      // Tandai tagihan + transaksi masuk + setor: satu transaksi database
      await simpanSetor(store, setor, [
        { jenis: "update", tabel: "TagihanQris", baris: updatedRow("TagihanQris", t, changes, uid, clock) },
        { jenis: "insert", tabel: "Transaksi", baris: [newRow("Transaksi", baru, uid, clock)] },
      ]);
      return c.json(toDto(s, { ...t, ...changes }));
    }

    const after = s.transaksi.filter((r) => r !== masuk);
    const setor = rencanaSetorTerdampak(masuk ? [masuk.data.periode_id] : [], s.periode, s.saldoAwal, after, s.tabungan, uid, clock);
    const changes = { lunas: false, transaksi_id: "" };
    await simpanSetor(store, setor, [
      { jenis: "update", tabel: "TagihanQris", baris: updatedRow("TagihanQris", t, changes, uid, clock) },
      ...(masuk ? [{ jenis: "delete", tabel: "Transaksi", id: masuk.data.id } as Operasi] : []),
    ]);
    return c.json(toDto(s, { ...t, ...changes }));
  },
);

/** Batalkan tagihan. Kalau sudah lunas, transaksi masuknya ikut terhapus. */
tagihanQris.delete("/:id", async (c) => {
  const { user, data } = await loadSession(c, TABEL);
  const uid = user.data.id;
  const s = parseAll(data);
  const target = findOwned(s.tagihan, c.req.param("id"), uid);
  const masuk = s.transaksi.find((r) => r.data.id === target.data.transaksi_id);
  const after = s.transaksi.filter((r) => r !== masuk);
  const setor = rencanaSetorTerdampak(masuk ? [masuk.data.periode_id] : [], s.periode, s.saldoAwal, after, s.tabungan, uid, c.var.clock);
  await simpanSetor(c.var.store(), setor, [
    ...(masuk ? [{ jenis: "delete", tabel: "Transaksi", id: masuk.data.id } as Operasi] : []),
    { jenis: "delete", tabel: "TagihanQris", id: target.data.id },
  ]);
  return c.body(null, 204);
});
