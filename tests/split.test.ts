import { describe, it, expect } from "vitest";
import { crc16 } from "../server/common/qris";
import type { Operasi, Store } from "../server/db/store";
import { barisDari, siapkan } from "./helpers";

/** Batch berikutnya ditambah operasi yang pasti gagal (id dobel) di akhir: seluruh transaksi database harus batal. */
function gagalkanBatchBerikutnya(store: Store) {
  const asli = store.batch.bind(store);
  store.batch = async (ops: readonly Operasi[]) => {
    store.batch = asli;
    const dobel = barisDari("Akun", ["AK-gagal", "Gagal"]);
    return asli([...ops, { jenis: "insert", tabel: "Akun", baris: [dobel, dobel] }]);
  };
}

type Peserta = { id: string; nama: string; saya: boolean; nominal: number; lunas: boolean; transaksiId: string | null };
type Tr = { id: string; tipe: string; akunId: string; nominal: number; deskripsi: string; kodeSistem: string | null; kategoriId: string | null };

async function siapSplit() {
  const t = await siapkan();
  await t.budi.post("/periode/mulai", { tanggalMulai: "2026-10-25", saldoAwal: [{ akunId: t.akun.BCA, saldo: 1_000_000 }] });
  const body = (o: Record<string, unknown> = {}) => ({
    nama: "Makan Bakmi",
    tanggal: "2026-10-29",
    akunId: t.akun.BCA,
    kategoriId: t.makan,
    akunTerimaId: t.akun.GoPay,
    pajak: 6_000,
    peserta: [
      { nama: "Saya", saya: true },
      { nama: "Andi", saya: false },
    ],
    items: [
      { nama: "Bakmi", qty: 1, harga: 30_000, peserta: [0] },
      { nama: "Nasi", qty: 1, harga: 30_000, peserta: [1] },
    ],
    ...o,
  });
  const res = await t.budi.post("/split", body());
  const split = res.body;
  const andi = () => split.peserta.find((p: Peserta) => p.nama === "Andi") as Peserta;
  const trx = async () => (await t.budi.get("/transaksi")).body.data as Tr[];
  return { ...t, res, split, body, andi, trx };
}

describe("split bill", () => {
  it("POST: total, bagian, transaksi keluar total dari akun pembayar; saya otomatis lunas", async () => {
    const { res, split, trx, akun } = await siapSplit();
    expect(res.status).toBe(201);
    expect(split).toMatchObject({ nama: "Makan Bakmi", subtotal: 60_000, total: 66_000, akunNama: "BCA", akunTerimaNama: "GoPay", belumLunas: { jumlah: 1, nominal: 33_000 } });
    expect(split.peserta.map((p: Peserta) => [p.nama, p.nominal, p.lunas])).toEqual([
      ["Saya", 33_000, true],
      ["Andi", 33_000, false],
    ]);
    expect(split.items[1].peserta).toEqual([split.peserta[1].id]);
    const list = await trx();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: split.transaksiId, tipe: "keluar", akunId: akun.BCA, nominal: 66_000, deskripsi: "Makan Bakmi" });
    expect(Array.isArray(res.body.peringatan)).toBe(true);
  });

  it("lunas → transaksi masuk Patungan; idempoten; uncentang menghapus", async () => {
    const { budi, split, andi, trx, akun } = await siapSplit();
    const url = `/split/${split.id}/peserta/${andi().id}/lunas`;
    const r1 = await budi.put(url, { lunas: true });
    expect(r1.status).toBe(200);
    const p = r1.body.peserta.find((x: Peserta) => x.nama === "Andi");
    expect(p.lunas).toBe(true);
    expect(r1.body.belumLunas).toEqual({ jumlah: 0, nominal: 0 });
    const masuk = (await trx()).filter((t) => t.tipe === "masuk");
    expect(masuk).toHaveLength(1);
    expect(masuk[0]).toMatchObject({ id: p.transaksiId, akunId: akun.GoPay, nominal: 33_000, kodeSistem: "PATUNGAN", deskripsi: "Patungan Makan Bakmi — Andi" });

    // Double tap / retry jaringan
    expect((await budi.put(url, { lunas: true })).status).toBe(200);
    expect((await trx()).filter((t) => t.tipe === "masuk")).toHaveLength(1);

    const r3 = await budi.put(url, { lunas: false });
    expect(r3.body.peserta.find((x: Peserta) => x.nama === "Andi")).toMatchObject({ lunas: false, transaksiId: null });
    expect((await trx()).filter((t) => t.tipe === "masuk")).toHaveLength(0);
  });

  it("lunas peserta saya → 422", async () => {
    const { budi, split } = await siapSplit();
    const saya = split.peserta.find((p: Peserta) => p.saya);
    expect((await budi.put(`/split/${split.id}/peserta/${saya.id}/lunas`, { lunas: true })).status).toBe(422);
  });

  it("data lama tanpa kategori PATUNGAN → dibuat otomatis saat lunas", async () => {
    const { budi, store, split, andi, trx } = await siapSplit();
    const patungan = (await store.read(["Kategori"])).Kategori.find((r) => r.data.kode_sistem === "PATUNGAN");
    expect(patungan).toBeDefined();
    await store.deleteRow("Kategori", patungan!.data.id);

    const res = await budi.put(`/split/${split.id}/peserta/${andi().id}/lunas`, { lunas: true });
    expect(res.status).toBe(200);
    expect((await trx()).find((t) => t.tipe === "masuk")?.kodeSistem).toBe("PATUNGAN");
  });

  it("PUT: nominal & akun penerima peserta lunas ikut ke transaksi masuk; peserta lunas tidak bisa dihapus", async () => {
    const { budi, split, body, andi, trx, akun } = await siapSplit();
    await budi.put(`/split/${split.id}/peserta/${andi().id}/lunas`, { lunas: true });
    const peserta = split.peserta.map((p: Peserta) => ({ id: p.id, nama: p.nama, saya: p.saya }));

    const ubah = await budi.put(
      `/split/${split.id}`,
      body({ peserta, akunTerimaId: akun.Jago, items: [{ nama: "Bakmi", qty: 1, harga: 30_000, peserta: [0] }, { nama: "Nasi", qty: 1, harga: 50_000, peserta: [1] }] }),
    );
    expect(ubah.status).toBe(200);
    expect(ubah.body).toMatchObject({ total: 86_000, akunTerimaId: akun.Jago });
    const list = await trx();
    expect(list.find((t) => t.tipe === "masuk")).toMatchObject({ akunId: akun.Jago, nominal: 53_750 });
    expect(list.find((t) => t.tipe === "keluar")).toMatchObject({ nominal: 86_000 });

    const hapus = await budi.put(`/split/${split.id}`, body({ peserta: [peserta[0], { nama: "Budi", saya: false }] }));
    expect(hapus.status).toBe(422);
    expect(hapus.body.errors.peserta).toEqual(["Peserta Andi sudah lunas, tidak bisa dihapus."]);
  });

  it("transaksi milik split tidak bisa diubah/dihapus lewat /transaksi", async () => {
    const { budi, split, andi, trx, makan, akun } = await siapSplit();
    await budi.put(`/split/${split.id}/peserta/${andi().id}/lunas`, { lunas: true });
    const pesan = "Transaksi ini bagian dari split bill Makan Bakmi. Ubah lewat halaman Split Bill.";
    const ubah = await budi.put(`/transaksi/${split.transaksiId}`, { tipe: "keluar", akunId: akun.BCA, kategoriId: makan, nominal: 1 });
    expect(ubah.status).toBe(409);
    expect(ubah.body.title).toBe(pesan);
    const masuk = (await trx()).find((t) => t.tipe === "masuk")!;
    const del = await budi.del(`/transaksi/${masuk.id}`);
    expect(del.status).toBe(409);
    expect(del.body.title).toBe(pesan);
  });

  it("DELETE: split & semua transaksinya hilang", async () => {
    const { budi, split, andi, trx } = await siapSplit();
    await budi.put(`/split/${split.id}/peserta/${andi().id}/lunas`, { lunas: true });
    expect((await budi.del(`/split/${split.id}`)).status).toBe(204);
    expect(await trx()).toEqual([]);
    expect((await budi.get("/split")).body).toEqual([]);
    expect((await budi.get(`/split/${split.id}`)).status).toBe(404);
  });

  it("daftar ringkas, nama peserta, validasi, isolasi user", async () => {
    const { budi, admin, split, body } = await siapSplit();
    expect((await budi.get("/split")).body).toEqual([
      { id: split.id, nama: "Makan Bakmi", tanggal: "2026-10-29", total: 66_000, jumlahPeserta: 2, belumLunas: { jumlah: 1, nominal: 33_000 } },
    ]);
    expect((await budi.get("/split/nama")).body).toEqual(["Andi"]);
    expect((await admin.get(`/split/${split.id}`)).status).toBe(404);

    const bad = await budi.post("/split", body({ peserta: [{ nama: "Saya", saya: true }, { nama: "Andi", saya: false }, { nama: "Budi", saya: false }] }));
    expect(bad.status).toBe(400);
    expect(bad.body.errors["peserta.2.nama"]).toEqual(["Budi belum punya item."]);
    const kat = await budi.post("/split", body({ kategoriId: "KT-tidakada", akunTerimaId: "AK-tidakada" }));
    expect(Object.keys(kat.body.errors).sort()).toEqual(["akunTerimaId", "kategoriId"]);
  });
});

describe("pengaturan QRIS", () => {
  const tlv = (id: string, v: string) => `${id}${String(v.length).padStart(2, "0")}${v}`;
  const body = tlv("00", "01") + tlv("01", "11") + tlv("26", tlv("00", "ID.CO.QRIS.WWW")) + tlv("58", "ID") + tlv("59", "TOKO SAKU") + tlv("60", "SURABAYA") + "6304";
  const payload = body + crc16(body);

  it("simpan, baca, tolak bukan QRIS, hapus", async () => {
    const { budi, admin } = await siapkan();
    expect((await budi.get("/pengaturan/qris")).body).toBeNull();
    const ok = await budi.put("/pengaturan/qris", { payload });
    expect(ok.body).toEqual({ payload, merchant: "TOKO SAKU", kota: "SURABAYA" });
    expect((await budi.get("/pengaturan/qris")).body).toEqual({ payload, merchant: "TOKO SAKU", kota: "SURABAYA" });
    expect((await admin.get("/pengaturan/qris")).body).toBeNull();

    const bad = await budi.put("/pengaturan/qris", { payload: "sampah" });
    expect(bad.status).toBe(400);
    expect(bad.body.errors.payload).toEqual(["Kode ini bukan QRIS. Pastikan QR dari GoPay Merchant/QRIS atas namamu."]);

    expect((await budi.put("/pengaturan/qris", { payload: null })).body).toBeNull();
    expect((await budi.get("/pengaturan/qris")).body).toBeNull();
  });
});

describe("split bill: gagal di tengah → tidak ada yang tertulis (transaksi database)", () => {
  it("POST gagal → 502, split & transaksi keluar tidak tersimpan; kirim ulang berhasil", async () => {
    const t = await siapkan();
    await t.budi.post("/periode/mulai", { tanggalMulai: "2026-10-25", saldoAwal: [{ akunId: t.akun.BCA, saldo: 1_000_000 }] });
    const body = {
      nama: "Makan",
      tanggal: "2026-10-29",
      akunId: t.akun.BCA,
      kategoriId: t.makan,
      akunTerimaId: t.akun.GoPay,
      peserta: [{ nama: "Saya", saya: true }, { nama: "Andi", saya: false }],
      items: [{ nama: "A", qty: 1, harga: 10_000, peserta: [0] }, { nama: "B", qty: 1, harga: 10_000, peserta: [1] }],
    };
    gagalkanBatchBerikutnya(t.store);
    expect((await t.budi.post("/split", body)).status).toBe(502);
    expect((await t.budi.get("/split")).body).toEqual([]);
    expect((await t.budi.get("/transaksi")).body.data).toEqual([]);

    expect((await t.budi.post("/split", body)).status).toBe(201);
    expect((await t.budi.get("/split")).body).toHaveLength(1);
    expect(((await t.budi.get("/transaksi")).body.data as Tr[]).filter((x) => x.tipe === "keluar")).toHaveLength(1);
  });

  it("lunas gagal → peserta tetap belum lunas tanpa transaksi masuk; retry membuat tepat 1", async () => {
    const { budi, store, split, andi, trx } = await siapSplit();
    const url = `/split/${split.id}/peserta/${andi().id}/lunas`;
    gagalkanBatchBerikutnya(store);
    expect((await budi.put(url, { lunas: true })).status).toBe(502);
    expect((await trx()).filter((x) => x.tipe === "masuk")).toHaveLength(0);
    expect((await budi.get(`/split/${split.id}`)).body.peserta[1].lunas).toBe(false);

    expect((await budi.put(url, { lunas: true })).status).toBe(200);
    const masuk = (await trx()).filter((x) => x.tipe === "masuk");
    expect(masuk).toHaveLength(1);
    expect((await budi.get(`/split/${split.id}`)).body.peserta[1].transaksiId).toBe(masuk[0].id);
  });

  it("tutup periode gagal → periode lama tetap aktif dan tabungan kosong", async () => {
    const t = await siapkan();
    await t.budi.post("/periode/mulai", { nama: "Okt", tanggalMulai: "2026-10-01", saldoAwal: [{ akunId: t.akun.BCA, saldo: 100_000 }] });
    gagalkanBatchBerikutnya(t.store);
    expect((await t.budi.post("/periode/mulai", { tanggalMulai: "2026-10-15" })).status).toBe(502);
    expect((await t.budi.get("/periode/aktif")).body.nama).toBe("Okt");
    expect((await t.store.read(["Tabungan"])).Tabungan).toEqual([]);
    expect((await t.budi.get("/periode")).body).toHaveLength(1);
  });
});
