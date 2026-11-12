import { describe, it, expect } from "vitest";
import { siapkan } from "./helpers";

type Kelompok = { id: string; nama: string };

async function persiapan() {
  const t = await siapkan();
  const { admin, budi, akun, makan } = t;
  const list = (await admin.get("/kelompok-kategori")).body as Kelompok[];
  const kh = list.find((g) => g.nama === "Kebutuhan Harian")!.id;
  const tr = list.find((g) => g.nama === "Transportasi")!.id;
  await admin.put(`/kategori/${makan}`, { nama: "Makan", kelompokId: kh });
  const kopi = (await admin.post("/kategori", { nama: "Kopi", tipe: "keluar", kelompokId: kh })).body.id as string;
  const bensin = (await admin.post("/kategori", { nama: "Bensin", tipe: "keluar", kelompokId: tr })).body.id as string;
  const periode = (await budi.post("/periode/mulai", { tanggalMulai: "2026-10-25", saldoAwal: [{ akunId: akun.BCA, saldo: 5_000_000 }] })).body.periode.id as string;
  const keluar = (kategoriId: string, nominal: number, tanggal = "2026-10-26") =>
    budi.post("/transaksi", { tipe: "keluar", akunId: akun.BCA, kategoriId, nominal, tanggal });
  return { ...t, kh, tr, kopi, bensin, periode, keluar };
}

describe("anggaran per periode", () => {
  it("simpan anggaran kategori induk + sub kategori, hitung terpakai/sisa/status", async () => {
    const { budi, kh, tr, makan, kopi, bensin, periode, keluar, akun } = await persiapan();
    const put = await budi.put(`/periode/${periode}/anggaran`, {
      items: [
        { kelompokId: kh, nominal: 2_000_000 },
        { kategoriId: makan, nominal: 1_500_000 },
        { kategoriId: kopi, nominal: 100_000 },
        { kategoriId: bensin, nominal: 500_000 },
      ],
    });
    expect(put.status).toBe(200);

    await keluar(makan, 1_000_000);
    await keluar(kopi, 90_000);
    await keluar(bensin, 600_000);
    // Biaya admin transfer masuk realisasi Lainnya (tanpa anggaran)
    await budi.post("/transaksi", { tipe: "transfer", akunId: akun.BCA, akunTujuanId: akun.GoPay, nominal: 10_000, biayaAdmin: 2_500, tanggal: "2026-10-26" });

    const r = (await budi.get(`/periode/${periode}/anggaran`)).body;
    expect(r.ada).toBe(true);
    const [g1, g2, g3] = r.kelompok;
    expect(g1).toMatchObject({ kelompokId: kh, anggaran: 2_000_000, anggaranSendiri: 2_000_000, terpakai: 1_090_000, sisa: 910_000, persen: 55, status: "aman" });
    expect(g1.sub).toEqual([
      { kategoriId: makan, nama: "Makan", anggaran: 1_500_000, terpakai: 1_000_000, sisa: 500_000, persen: 67, status: "aman" },
      { kategoriId: kopi, nama: "Kopi", anggaran: 100_000, terpakai: 90_000, sisa: 10_000, persen: 90, status: "hampir" },
    ]);
    // Induk tanpa batas sendiri: batas = jumlah batas sub kategorinya
    expect(g2).toMatchObject({ kelompokId: tr, anggaran: 500_000, anggaranSendiri: null, terpakai: 600_000, sisa: -100_000, persen: 120, status: "lewat" });
    expect(g3).toMatchObject({ kelompokId: "LAINNYA", anggaran: null, terpakai: 2_500, status: null });
    expect(r.total).toEqual({ anggaran: 2_500_000, terpakai: 1_692_500, sisa: 807_500, persen: 68, status: "aman" });

    // Dashboard ikut menampilkan anggaran periode aktif
    expect((await budi.get("/dashboard")).body.anggaran.total.anggaran).toBe(2_500_000);
  });

  it("PUT mengganti seluruh anggaran: ubah, hapus yang tidak dikirim / 0", async () => {
    const { budi, kh, makan, kopi, periode, store } = await persiapan();
    await budi.put(`/periode/${periode}/anggaran`, { items: [{ kelompokId: kh, nominal: 1_000_000 }, { kategoriId: makan, nominal: 500_000 }] });
    await budi.put(`/periode/${periode}/anggaran`, { items: [{ kategoriId: makan, nominal: 700_000 }, { kategoriId: kopi, nominal: 0 }] });
    const r = (await budi.get(`/periode/${periode}/anggaran`)).body;
    expect(r.kelompok).toHaveLength(1);
    expect(r.kelompok[0]).toMatchObject({ anggaran: 700_000, anggaranSendiri: null });
    const rows = (await store.read(["Anggaran"])).Anggaran;
    expect(rows).toHaveLength(1);

    await budi.put(`/periode/${periode}/anggaran`, { items: [] });
    expect((await budi.get(`/periode/${periode}/anggaran`)).body).toMatchObject({ ada: false, kelompok: [] });
  });

  it("validasi: sub melebihi induk, pemasukan, dobel, salah satu wajib", async () => {
    const { budi, kh, makan, kopi, gaji, periode } = await persiapan();
    const res = await budi.put(`/periode/${periode}/anggaran`, {
      items: [
        { kelompokId: kh, nominal: 100_000 },
        { kategoriId: makan, nominal: 80_000 },
        { kategoriId: kopi, nominal: 50_000 },
        { kategoriId: gaji, nominal: 1 },
        { kategoriId: makan, nominal: 1 },
        { nominal: 5 },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual({
      "items.0.nominal": ["Jumlah anggaran sub kategori Kebutuhan Harian (Rp 130.000) melebihi anggaran kategorinya (Rp 100.000)."],
      "items.3.kategoriId": ["Gaji bukan kategori pengeluaran."],
      "items.4.kategoriId": ["Sub kategori Makan dobel."],
      "items.5": ["Pilih salah satu: kategori atau sub kategori."],
    });
  });

  it("isolasi: periode pengguna lain → 404", async () => {
    const { admin, budi, periode } = await persiapan();
    expect((await admin.get(`/periode/${periode}/anggaran`)).status).toBe(404);
    expect((await admin.put(`/periode/${periode}/anggaran`, { items: [] })).status).toBe(404);
    expect((await budi.get(`/periode/${periode}/anggaran`)).status).toBe(200);
  });

  it("peringatan saat transaksi melewati anggaran (tidak memblokir)", async () => {
    const { budi, kh, makan, kopi, periode, keluar } = await persiapan();
    await budi.put(`/periode/${periode}/anggaran`, { items: [{ kelompokId: kh, nominal: 200_000 }, { kategoriId: kopi, nominal: 50_000 }] });

    expect((await keluar(kopi, 40_000)).body.peringatan).toEqual([]);
    const lewat = await keluar(kopi, 20_000);
    expect(lewat.status).toBe(201);
    expect(lewat.body.peringatan).toEqual(["Anggaran Kopi terlewati Rp 10.000 (terpakai Rp 60.000 dari Rp 50.000)."]);

    const induk = await keluar(makan, 150_000);
    expect(induk.body.peringatan).toEqual(["Anggaran kategori Kebutuhan Harian terlewati Rp 10.000 (terpakai Rp 210.000 dari Rp 200.000)."]);

    // Edit transaksi juga diperiksa
    const ubah = await budi.put(`/transaksi/${induk.body.id}`, { tipe: "keluar", akunId: induk.body.akunId, kategoriId: makan, nominal: 100_000, tanggal: "2026-10-26" });
    expect(ubah.body.peringatan).toEqual([]);
  });

  it("periode baru: salin anggaran opsional lewat salinAnggaran", async () => {
    const { budi, kh, kopi, periode } = await persiapan();
    await budi.put(`/periode/${periode}/anggaran`, { items: [{ kelompokId: kh, nominal: 300_000 }, { kategoriId: kopi, nominal: 50_000 }] });

    const tanpa = await budi.post("/periode/mulai", { tanggalMulai: "2026-10-28" });
    expect(tanpa.body.anggaranDisalin).toBe(0);
    expect((await budi.get(`/periode/${tanpa.body.periode.id}/anggaran`)).body.ada).toBe(false);

    // Periode lama tidak berubah; salin dari periode terakhir (tanpa anggaran) → 0
    expect((await budi.get(`/periode/${periode}/anggaran`)).body.total.anggaran).toBe(300_000);

    await budi.put(`/periode/${tanpa.body.periode.id}/anggaran`, { items: [{ kategoriId: kopi, nominal: 75_000 }] });
    const salin = await budi.post("/periode/mulai", { tanggalMulai: "2026-10-29", salinAnggaran: true });
    expect(salin.status).toBe(201);
    expect(salin.body.anggaranDisalin).toBe(1);
    const r = (await budi.get(`/periode/${salin.body.periode.id}/anggaran`)).body;
    expect(r.kelompok[0].sub[0]).toMatchObject({ kategoriId: kopi, anggaran: 75_000, terpakai: 0 });
  });
});
