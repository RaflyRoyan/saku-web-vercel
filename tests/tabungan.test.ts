import { describe, it, expect } from "vitest";
import { BUDI, siapkan } from "./helpers";

type Sisa = { akunId: string; nominal: number };
const peta = (list: Sisa[]) => Object.fromEntries(list.map((s) => [s.akunId, s.nominal]));

/** T5 lalu keluar 25.000 dari GoPay pada 29 Okt (clock 30 Okt 2026). */
async function bagiGaji() {
  const t = await siapkan();
  const { budi, akun, makan } = t;
  const p1 = (await budi.post("/periode/mulai", { nama: "Gajian Okt", tanggalMulai: "2026-10-25", saldoAwal: [{ akunId: akun.BCA, saldo: 6_000_000 }] })).body.periode;
  const tf = (akunId: string, akunTujuanId: string, nominal: number, biayaAdmin = 0) =>
    budi.post("/transaksi", { tipe: "transfer", akunId, akunTujuanId, nominal, biayaAdmin, tanggal: "2026-10-25" });
  await tf(akun.BCA, akun.Mandiri, 2_000_000, 2_500);
  await tf(akun.BCA, akun.Jago, 1_000_000);
  await tf(akun.Jago, akun.GoPay, 300_000, 1_000);
  const gopay = (await budi.post("/transaksi", { tipe: "keluar", akunId: akun.GoPay, kategoriId: makan, nominal: 25_000, tanggal: "2026-10-29" })).body;
  return { ...t, p1, gopay };
}

describe("T6 tutup periode", () => {
  it("pratinjau = setor; total 5.971.500; periode lama selesai = mulai baru − 1", async () => {
    const { budi, akun, clock, p1 } = await bagiGaji();
    const pratinjau = (await budi.get("/periode/aktif/pratinjau-tutup")).body;
    const harapan = { [akun.BCA]: 2_997_500, [akun.Mandiri]: 2_000_000, [akun.Jago]: 699_000, [akun.GoPay]: 275_000 };
    expect(peta(pratinjau.sisa)).toEqual(harapan);
    expect(pratinjau.sisa.map((s: { nama: string }) => s.nama)).toEqual(["BCA", "Mandiri", "Jago", "GoPay"]);
    expect(pratinjau.total).toBe(5_971_500);

    clock.set("2026-11-25T03:00:00Z");
    const res = await budi.post("/periode/mulai", { nama: "Gajian Nov", saldoAwal: [{ akunId: akun.BCA, saldo: 6_000_000 }] });
    expect(res.status).toBe(201);
    expect(peta(res.body.setorTabungan)).toEqual(harapan);
    expect(res.body.totalTabungan).toBe(5_971_500);

    const lama = (await budi.get("/periode")).body.find((p: { id: string }) => p.id === p1.id);
    expect(lama).toMatchObject({ tanggalSelesai: "2026-11-24", aktif: false });
    const tab = (await budi.get("/tabungan")).body;
    expect(tab.total).toBe(5_971_500);
    expect(tab.riwayat.every((r: { jenis: string; keterangan: string }) => r.jenis === "setor" && r.keterangan === "Sisa Gajian Okt")).toBe(true);
    expect((await budi.get(`/periode/${p1.id}/ringkasan`)).body.setorTabungan).toHaveLength(4);
    expect((await budi.get("/periode/aktif/pratinjau-tutup")).body.total).toBe(6_000_000);
  });

  it("belum ada periode aktif → pratinjau 404", async () => {
    const { budi } = await siapkan();
    expect((await budi.get("/periode/aktif/pratinjau-tutup")).status).toBe(404);
  });
});

describe("T7 edit transaksi periode lama", () => {
  it("GoPay 25.000 → 50.000: setor GoPay 250.000 tanpa baris ganda", async () => {
    const { budi, akun, makan, clock, gopay } = await bagiGaji();
    clock.set("2026-11-25T03:00:00Z");
    await budi.post("/periode/mulai", { saldoAwal: [{ akunId: akun.BCA, saldo: 6_000_000 }] });

    const edit = await budi.put(`/transaksi/${gopay.id}`, { tipe: "keluar", akunId: akun.GoPay, kategoriId: makan, nominal: 50_000, tanggal: "2026-10-29" });
    expect(edit.status).toBe(200);
    const tab = (await budi.get("/tabungan")).body;
    const setorGopay = tab.riwayat.filter((r: { jenis: string; akunId: string }) => r.jenis === "setor" && r.akunId === akun.GoPay);
    expect(setorGopay).toHaveLength(1);
    expect(setorGopay[0].nominal).toBe(250_000);
    expect(tab.riwayat).toHaveLength(4);
    expect(tab.total).toBe(5_946_500);

    // Transaksi baru di periode lama juga menghitung ulang setor
    await budi.post("/transaksi", { tipe: "keluar", akunId: akun.Mandiri, kategoriId: makan, nominal: 10_000, tanggal: "2026-11-01" });
    expect((await budi.get("/tabungan")).body.total).toBe(5_936_500);
  });
});

describe("T9 tarik tabungan", () => {
  it("buat transaksi masuk TARIK_TABUNGAN + baris tarik; saldo BCA aktif +500.000; edit lewat transaksi → 409", async () => {
    const { budi, akun, makan, tarik, clock } = await bagiGaji();
    clock.set("2026-11-25T03:00:00Z");
    const p2 = (await budi.post("/periode/mulai", { saldoAwal: [{ akunId: akun.BCA, saldo: 6_000_000 }] })).body.periode;

    const res = await budi.post("/tabungan/tarik", { akunId: akun.BCA, nominal: 500_000, keterangan: "Servis motor" });
    expect(res.status).toBe(201);
    expect(res.body.saldoTabunganAkun).toBe(2_497_500);
    expect(res.body.transaksi).toMatchObject({ tipe: "masuk", akunId: akun.BCA, kategoriId: tarik, kodeSistem: "TARIK_TABUNGAN", nominal: 500_000, deskripsi: "Servis motor", tanggal: "2026-11-25" });

    const tab = (await budi.get("/tabungan")).body;
    expect(tab.total).toBe(5_471_500);
    expect(tab.perAkun.find((a: { akunId: string }) => a.akunId === akun.BCA)).toMatchObject({ setor: 2_997_500, tarik: 500_000, saldo: 2_497_500 });
    expect(tab.riwayat[0]).toMatchObject({ jenis: "tarik", keterangan: "Servis motor", bisaHapus: true, transaksiId: res.body.transaksi.id });
    expect(tab.riwayat.filter((r: { bisaHapus: boolean }) => r.bisaHapus)).toHaveLength(1);

    const r = (await budi.get(`/periode/${p2.id}/ringkasan`)).body;
    expect(r.perAkun.find((a: { akunId: string }) => a.akunId === akun.BCA).saldoAkhir).toBe(6_500_000);

    const tid = res.body.transaksi.id;
    expect((await budi.put(`/transaksi/${tid}`, { tipe: "keluar", akunId: akun.BCA, kategoriId: makan, nominal: 1 })).status).toBe(409);
    expect((await budi.del(`/transaksi/${tid}`)).status).toBe(409);

    // Hapus tarik → transaksinya ikut terhapus
    expect((await budi.del(`/tabungan/${res.body.id}`)).status).toBe(204);
    expect((await budi.get(`/transaksi/${tid}`)).status).toBe(404);
    expect((await budi.get("/tabungan")).body.total).toBe(5_971_500);
  });

  it("setor tidak bisa dihapus; tarik periode lama tidak bisa dihapus; milik orang lain 404", async () => {
    const { budi, admin, akun, clock } = await bagiGaji();
    clock.set("2026-11-25T03:00:00Z");
    await budi.post("/periode/mulai", {});
    const tarik = (await budi.post("/tabungan/tarik", { akunId: akun.Jago, nominal: 99_000 })).body;
    expect(tarik.transaksi.deskripsi).toBe("Tarik tabungan");
    const setor = (await budi.get("/tabungan")).body.riwayat.find((r: { jenis: string }) => r.jenis === "setor");
    expect((await budi.del(`/tabungan/${setor.id}`)).status).toBe(409);
    expect((await admin.del(`/tabungan/${tarik.id}`)).status).toBe(404);

    clock.set("2026-12-25T03:00:00Z");
    await budi.post("/auth/login", { username: BUDI.username, password: BUDI.password }); // token 30 hari kedaluwarsa
    await budi.post("/periode/mulai", {});
    expect((await budi.del(`/tabungan/${tarik.id}`)).status).toBe(409);
  });
});

describe("T10 tarik melebihi tabungan akun", () => {
  it("422 dengan sisa tabungan akun; tanpa periode aktif 422; tanggal sebelum periode 400", async () => {
    const { budi, akun, clock } = await bagiGaji();
    expect((await budi.post("/tabungan/tarik", { akunId: akun.BCA, nominal: 1 })).status).toBe(422); // tabungan BCA 0

    clock.set("2026-11-25T03:00:00Z");
    await budi.post("/periode/mulai", {});
    const lebih = await budi.post("/tabungan/tarik", { akunId: akun.GoPay, nominal: 275_001 });
    expect(lebih.status).toBe(422);
    expect(lebih.body.title).toBe("Tabungan di GoPay hanya Rp 275.000.");
    expect((await budi.post("/tabungan/tarik", { akunId: akun.GoPay, nominal: 275_000, tanggal: "2026-11-24" })).status).toBe(400);
    expect((await budi.post("/tabungan/tarik", { akunId: akun.GoPay, nominal: 275_000 })).status).toBe(201);
    expect((await budi.post("/tabungan/tarik", { akunId: akun.GoPay, nominal: 1 })).body.title).toBe("Tabungan di GoPay hanya Rp 0.");
  });
});

describe("tutup periode: sisa diteruskan atau ditabung", () => {
  it("sebagian diteruskan, sisanya ditabung; seluruhnya diteruskan → setor 0 tidak tampil di riwayat", async () => {
    const { budi, akun, clock } = await bagiGaji();
    clock.set("2026-11-25T03:00:00Z");
    const res = await budi.post("/periode/mulai", {
      teruskan: [
        { akunId: akun.BCA, nominal: 1_000_000 },
        { akunId: akun.GoPay, nominal: 275_000 },
      ],
      saldoAwal: [
        { akunId: akun.BCA, saldo: 7_000_000 },
        { akunId: akun.GoPay, saldo: 275_000 },
      ],
    });
    expect(res.status).toBe(201);
    expect(peta(res.body.setorTabungan)).toEqual({ [akun.BCA]: 1_997_500, [akun.Mandiri]: 2_000_000, [akun.Jago]: 699_000, [akun.GoPay]: 0 });
    expect(res.body.diteruskan).toEqual([
      { akunId: akun.BCA, nominal: 1_000_000 },
      { akunId: akun.GoPay, nominal: 275_000 },
    ]);
    expect(res.body.totalTabungan).toBe(4_696_500);
    const tab = (await budi.get("/tabungan")).body;
    expect(tab.total).toBe(4_696_500);
    expect(tab.riwayat.some((r: { akunId: string }) => r.akunId === akun.GoPay)).toBe(false);
  });

  it("edit transaksi periode lama: diteruskan tetap, selisih masuk tabungan (bisa minus)", async () => {
    const { budi, akun, makan, clock, gopay } = await bagiGaji();
    clock.set("2026-11-25T03:00:00Z");
    await budi.post("/periode/mulai", { teruskan: [{ akunId: akun.GoPay, nominal: 275_000 }] });

    await budi.put(`/transaksi/${gopay.id}`, { tipe: "keluar", akunId: akun.GoPay, kategoriId: makan, nominal: 50_000, tanggal: "2026-10-29" });
    const tab = (await budi.get("/tabungan")).body;
    const setor = tab.riwayat.filter((r: { akunId: string }) => r.akunId === akun.GoPay);
    expect(setor).toHaveLength(1);
    expect(setor[0].nominal).toBe(-25_000);
    expect(tab.total).toBe(2_997_500 + 2_000_000 + 699_000 - 25_000);
  });

  it("validasi: melebihi sisa, akun dobel; tidak ada yang ditulis", async () => {
    const { budi, akun, clock, store } = await bagiGaji();
    clock.set("2026-11-25T03:00:00Z");
    const res = await budi.post("/periode/mulai", {
      teruskan: [
        { akunId: akun.Jago, nominal: 700_000 },
        { akunId: akun.BCA, nominal: 1 },
        { akunId: akun.BCA, nominal: 2 },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual({
      "teruskan.0.nominal": ["Maksimal Rp 699.000 (sisa Jago)."],
      "teruskan.2.nominal": ["Akun BCA dobel."],
    });
    expect((await store.readMany(["Tabungan"])).Tabungan.rows).toHaveLength(0);
    expect((await budi.get("/periode/aktif")).body.nama).toBe("Gajian Okt");
  });
});

describe("setor langsung ke tabungan (tanpa tutup periode)", () => {
  type Ringkasan = { totalPengeluaran: number; pengeluaranPerKategori: unknown[]; perAkun: { akunId: string; keluar: number; ditabung: number; saldoAkhir: number }[] };

  it("saldo akun berkurang, tidak dihitung pengeluaran, sisa saat tutup hanya sisanya (tanpa dobel)", async () => {
    const { budi, akun, clock, p1 } = await bagiGaji();
    const res = await budi.post("/tabungan/setor", { akunId: akun.BCA, nominal: 1_000_000, keterangan: "Dana darurat" });
    expect(res.status).toBe(201);
    expect(res.body.saldoTabunganAkun).toBe(1_000_000);
    expect(res.body.transaksi).toMatchObject({ tipe: "keluar", akunId: akun.BCA, kodeSistem: "SETOR_TABUNGAN", nominal: 1_000_000, deskripsi: "Dana darurat", tanggal: "2026-10-30" });

    const tab = (await budi.get("/tabungan")).body;
    expect(tab.total).toBe(1_000_000);
    expect(tab.perAkun).toEqual([{ akunId: akun.BCA, nama: "BCA", setor: 1_000_000, tarik: 0, saldo: 1_000_000 }]);
    expect(tab.riwayat[0]).toMatchObject({ jenis: "simpan", keterangan: "Dana darurat", bisaHapus: true, transaksiId: res.body.transaksi.id });

    const r = (await budi.get(`/periode/${p1.id}/ringkasan`)).body as Ringkasan;
    expect(r.totalPengeluaran).toBe(28_500);
    expect(r.pengeluaranPerKategori).toHaveLength(2);
    expect(r.perAkun.find((a) => a.akunId === akun.BCA)).toMatchObject({ keluar: 0, ditabung: 1_000_000, saldoAkhir: 1_997_500 });
    expect((await budi.get("/periode/aktif/pratinjau-tutup")).body.total).toBe(4_971_500);

    clock.set("2026-11-25T03:00:00Z");
    const tutup = await budi.post("/periode/mulai", {});
    expect(tutup.body.totalTabungan).toBe(5_971_500);
    expect((await budi.get("/tabungan")).body.total).toBe(5_971_500);
  });

  it("validasi: melebihi saldo akun 422, tanpa periode 422, kategori sistem tidak bisa dipakai manual, transaksinya terkunci", async () => {
    const t = await siapkan();
    expect((await t.budi.post("/tabungan/setor", { akunId: t.akun.BCA, nominal: 1 })).status).toBe(422);
    const { budi, akun, makan } = await bagiGaji();
    const lebih = await budi.post("/tabungan/setor", { akunId: akun.GoPay, nominal: 275_001 });
    expect(lebih.status).toBe(422);
    expect(lebih.body.title).toBe("Saldo GoPay hanya Rp 275.000.");
    expect((await budi.post("/tabungan/setor", { akunId: akun.GoPay, nominal: 0 })).status).toBe(400);

    const ok = (await budi.post("/tabungan/setor", { akunId: akun.GoPay, nominal: 275_000 })).body;
    expect(ok.transaksi.deskripsi).toBe("Setor tabungan");
    const tid = ok.transaksi.id;
    expect((await budi.put(`/transaksi/${tid}`, { tipe: "keluar", akunId: akun.GoPay, kategoriId: makan, nominal: 1 })).status).toBe(409);
    expect((await budi.del(`/transaksi/${tid}`)).status).toBe(409);
    const manual = await budi.post("/transaksi", { tipe: "keluar", akunId: akun.BCA, kategoriId: ok.transaksi.kategoriId, nominal: 1 });
    expect(manual.status).toBe(400);
    expect(manual.body.errors.kategoriId).toEqual(["Kategori ini hanya untuk setor tabungan."]);
    // Label tetap boleh
    expect((await budi.put("/transaksi/label", { ids: [tid], label: "Darurat" })).status).toBe(200);
  });

  it("hapus setoran di periode aktif → transaksi ikut hilang; setelah periode ditutup tidak bisa dihapus", async () => {
    const { budi, akun, clock } = await bagiGaji();
    const a = (await budi.post("/tabungan/setor", { akunId: akun.Jago, nominal: 100_000 })).body;
    expect((await budi.del(`/tabungan/${a.id}`)).status).toBe(204);
    expect((await budi.get(`/transaksi/${a.transaksi.id}`)).status).toBe(404);
    expect((await budi.get("/tabungan")).body.total).toBe(0);

    const b = (await budi.post("/tabungan/setor", { akunId: akun.Jago, nominal: 100_000 })).body;
    clock.set("2026-11-25T03:00:00Z");
    await budi.post("/periode/mulai", {});
    expect((await budi.del(`/tabungan/${b.id}`)).status).toBe(409);
    const tab = (await budi.get("/tabungan")).body;
    expect(tab.perAkun.find((x: { akunId: string }) => x.akunId === akun.Jago).saldo).toBe(699_000);
  });
});
