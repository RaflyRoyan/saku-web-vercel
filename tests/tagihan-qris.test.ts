import { describe, it, expect } from "vitest";
import { siapkan } from "./helpers";

type Tr = { id: string; tipe: string; akunId: string; kategoriId: string | null; nominal: number; deskripsi: string; tanggal: string };

async function siap() {
  const t = await siapkan();
  await t.budi.post("/periode/mulai", { tanggalMulai: "2026-10-25", saldoAwal: [{ akunId: t.akun.GoPay, saldo: 0 }] });
  const buat = (o: Record<string, unknown> = {}) => t.budi.post("/tagihan-qris", { nominal: 25_000, keterangan: "Kaos L", akunId: t.akun.GoPay, kategoriId: t.gaji, ...o });
  const trx = async () => (await t.budi.get("/transaksi")).body.data as Tr[];
  return { ...t, buat, trx };
}

describe("tagihan QRIS", () => {
  it("POST menyimpan draft belum lunas tanpa transaksi; GET hanya milik sendiri", async () => {
    const { buat, budi, admin, trx } = await siap();
    const r = await buat();
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ tanggal: "2026-10-30", nominal: 25_000, keterangan: "Kaos L", akunNama: "GoPay", kategoriNama: "Gaji", lunas: false, transaksiId: null });
    expect(await trx()).toHaveLength(0);
    expect((await budi.get("/tagihan-qris")).body).toEqual([r.body]);
    expect((await admin.get("/tagihan-qris")).body).toEqual([]);
  });

  it("POST validasi: nominal, kategori bukan pemasukan", async () => {
    const { buat, makan } = await siap();
    const nol = await buat({ nominal: 0 });
    expect(nol.status).toBe(400);
    expect(nol.body.errors.nominal).toBeDefined();
    const salah = await buat({ kategoriId: makan });
    expect(salah.status).toBe(400);
    expect(salah.body.errors.kategoriId).toEqual(["Kategori Makan bukan kategori pemasukan."]);
  });

  it("lunas → transaksi masuk; idempoten; batal lunas menghapus transaksi", async () => {
    const { buat, budi, trx, akun, gaji } = await siap();
    const { id } = (await buat()).body;
    const r1 = await budi.put(`/tagihan-qris/${id}/lunas`, { lunas: true, tanggal: "2026-10-29" });
    expect(r1.status).toBe(200);
    expect(r1.body.lunas).toBe(true);
    const masuk = await trx();
    expect(masuk).toHaveLength(1);
    expect(masuk[0]).toMatchObject({ id: r1.body.transaksiId, tipe: "masuk", akunId: akun.GoPay, kategoriId: gaji, nominal: 25_000, deskripsi: "Kaos L", tanggal: "2026-10-29" });

    expect((await budi.put(`/tagihan-qris/${id}/lunas`, { lunas: true })).body.transaksiId).toBe(r1.body.transaksiId);
    expect(await trx()).toHaveLength(1);

    const r2 = await budi.put(`/tagihan-qris/${id}/lunas`, { lunas: false });
    expect(r2.body).toMatchObject({ lunas: false, transaksiId: null });
    expect(await trx()).toHaveLength(0);
  });

  it("tanpa keterangan → deskripsi 'Pembayaran QRIS'", async () => {
    const { buat, budi, trx } = await siap();
    const { id } = (await buat({ keterangan: "" })).body;
    await budi.put(`/tagihan-qris/${id}/lunas`, { lunas: true });
    expect((await trx())[0].deskripsi).toBe("Pembayaran QRIS");
  });

  it("transaksi dari tagihan dikunci di /transaksi (409)", async () => {
    const { buat, budi } = await siap();
    const { id } = (await buat()).body;
    const { transaksiId } = (await budi.put(`/tagihan-qris/${id}/lunas`, { lunas: true })).body;
    expect((await budi.del(`/transaksi/${transaksiId}`)).status).toBe(409);
  });

  it("DELETE membatalkan tagihan beserta transaksi masuknya", async () => {
    const { buat, budi, trx } = await siap();
    const { id } = (await buat()).body;
    await budi.put(`/tagihan-qris/${id}/lunas`, { lunas: true });
    expect((await budi.del(`/tagihan-qris/${id}`)).status).toBe(204);
    expect(await trx()).toHaveLength(0);
    expect((await budi.get("/tagihan-qris")).body).toEqual([]);
  });

  it("tagihan milik user lain → 404", async () => {
    const { buat, admin } = await siap();
    const { id } = (await buat()).body;
    expect((await admin.put(`/tagihan-qris/${id}/lunas`, { lunas: true })).status).toBe(404);
    expect((await admin.del(`/tagihan-qris/${id}`)).status).toBe(404);
  });
});
