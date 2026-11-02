import { describe, it, expect } from "vitest";
import { siapkan } from "./helpers";

type Kelompok = { id: string; nama: string; aktif: boolean; sistem: boolean };
type Kategori = { id: string; nama: string; tipe: string; kelompokId: string | null; kelompokNama: string | null; kodeSistem: string | null };

async function kelompokId(client: { get: (p: string) => Promise<{ body: unknown }> }, nama: string) {
  const list = (await client.get("/kelompok-kategori")).body as Kelompok[];
  return list.find((g) => g.nama === nama)!.id;
}

describe("kelompok kategori pengeluaran", () => {
  it("setup membuat kelompok bawaan; Lainnya virtual selalu terakhir", async () => {
    const { budi } = await siapkan();
    const list = (await budi.get("/kelompok-kategori")).body as Kelompok[];
    expect(list.map((g) => g.nama)).toEqual([
      "Kebutuhan Harian",
      "Tempat Tinggal",
      "Transportasi",
      "Tagihan & Langganan",
      "Kesehatan",
      "Belanja & Gaya Hidup",
      "Hiburan & Liburan",
      "Pendidikan",
      "Sosial & Keluarga",
      "Keuangan",
      "Lainnya",
    ]);
    expect(list.at(-1)).toMatchObject({ id: "LAINNYA", sistem: true });
  });

  it("sub kategori lama & kategori sistem masuk Lainnya; pemasukan tanpa kelompok", async () => {
    const { budi } = await siapkan();
    const list = (await budi.get("/kategori")).body as Kategori[];
    const byNama = new Map(list.map((k) => [k.nama, k]));
    expect(byNama.get("Makan")).toMatchObject({ kelompokId: "LAINNYA", kelompokNama: "Lainnya" });
    expect(byNama.get("Biaya Admin Bank")).toMatchObject({ kelompokId: "LAINNYA", kelompokNama: "Lainnya" });
    expect(byNama.get("Gaji")).toMatchObject({ kelompokId: null, kelompokNama: null });
  });

  it("admin membuat & memindah sub kategori ke kelompok; validasi kelompok", async () => {
    const { admin, budi, makan, gaji } = await siapkan();
    const mm = await kelompokId(admin, "Kebutuhan Harian");

    const pindah = await admin.put(`/kategori/${makan}`, { nama: "Makan", kelompokId: mm });
    expect(pindah.body).toMatchObject({ kelompokId: mm, kelompokNama: "Kebutuhan Harian" });

    // Tanpa kelompokId = tidak berubah
    expect((await admin.put(`/kategori/${makan}`, { nama: "Makan siang" })).body.kelompokId).toBe(mm);

    const kopi = await admin.post("/kategori", { nama: "Kopi", tipe: "keluar", kelompokId: mm });
    expect(kopi.status).toBe(201);
    expect(kopi.body.kelompokNama).toBe("Kebutuhan Harian");

    expect((await admin.post("/kategori", { nama: "X", tipe: "keluar", kelompokId: "KK-tidakada" })).body.errors.kelompokId).toEqual(["Kategori tidak ditemukan."]);
    expect((await admin.put(`/kategori/${gaji}`, { nama: "Gaji", kelompokId: mm })).body.errors.kelompokId).toEqual([
      "Kategori pemasukan tidak memakai kelompok.",
    ]);
    // Kembali ke Lainnya
    expect((await admin.put(`/kategori/${makan}`, { nama: "Makan", kelompokId: "LAINNYA" })).body.kelompokId).toBe("LAINNYA");

    expect((await budi.post("/kelompok-kategori", { nama: "Hobi" })).status).toBe(403);
  });

  it("CRUD kelompok: nama unik, Lainnya dicadangkan, nonaktif ditolak kalau masih berisi", async () => {
    const { admin, makan } = await siapkan();
    const hobi = await admin.post("/kelompok-kategori", { nama: "Hobi" });
    expect(hobi.status).toBe(201);
    expect((await admin.post("/kelompok-kategori", { nama: "hobi" })).status).toBe(409);
    expect((await admin.post("/kelompok-kategori", { nama: "Lainnya" })).status).toBe(409);

    await admin.put(`/kategori/${makan}`, { nama: "Makan", kelompokId: hobi.body.id });
    const tolak = await admin.put(`/kelompok-kategori/${hobi.body.id}/aktif`, { aktif: false });
    expect(tolak.status).toBe(409);
    expect(tolak.body.title).toBe("Masih ada 1 sub kategori aktif di Hobi. Pindahkan atau nonaktifkan dulu.");

    await admin.put(`/kategori/${makan}`, { nama: "Makan", kelompokId: "LAINNYA" });
    expect((await admin.put(`/kelompok-kategori/${hobi.body.id}/aktif`, { aktif: false })).status).toBe(204);
    const aktif = (await admin.get("/kelompok-kategori")).body as Kelompok[];
    expect(aktif.some((g) => g.nama === "Hobi")).toBe(false);
    // Kelompok nonaktif tidak bisa dipakai lagi
    expect((await admin.post("/kategori", { nama: "Mancing", tipe: "keluar", kelompokId: hobi.body.id })).body.errors.kelompokId).toEqual([
      "Kategori Hobi nonaktif dan tidak bisa dipakai.",
    ]);
  });

  it("kelompok bawaan idempoten & urutan bisa diatur", async () => {
    const { admin } = await siapkan();
    expect((await admin.post("/kelompok-kategori/bawaan")).body).toEqual({ ditambah: 0 });
    const list = (await admin.get("/kelompok-kategori")).body as Kelompok[];
    const ids = list.filter((g) => !g.sistem).map((g) => g.id);
    expect((await admin.put("/kelompok-kategori/urutan", { ids: [...ids].reverse() })).status).toBe(204);
    const baru = (await admin.get("/kelompok-kategori")).body as Kelompok[];
    expect(baru[0].nama).toBe("Keuangan");
    expect(baru.at(-1)!.nama).toBe("Lainnya");
  });

  it("ringkasan per kelompok + filter riwayat per kelompok", async () => {
    const { admin, budi, akun, makan, biayaAdmin } = await siapkan();
    const mm = await kelompokId(admin, "Kebutuhan Harian");
    const tr = await kelompokId(admin, "Transportasi");
    await admin.put(`/kategori/${makan}`, { nama: "Makan", kelompokId: mm });
    const bensin = (await admin.post("/kategori", { nama: "Bensin", tipe: "keluar", kelompokId: tr })).body.id as string;
    const kopi = (await admin.post("/kategori", { nama: "Kopi", tipe: "keluar", kelompokId: mm })).body.id as string;

    await budi.post("/periode/mulai", { tanggalMulai: "2026-10-25", saldoAwal: [{ akunId: akun.BCA, saldo: 1_000_000 }] });
    const keluar = (kategoriId: string, nominal: number) =>
      budi.post("/transaksi", { tipe: "keluar", akunId: akun.BCA, kategoriId, nominal, tanggal: "2026-10-26" });
    await keluar(makan, 50_000);
    await keluar(kopi, 20_000);
    await keluar(bensin, 100_000);
    await budi.post("/transaksi", { tipe: "transfer", akunId: akun.BCA, akunTujuanId: akun.GoPay, nominal: 10_000, biayaAdmin: 2_500, tanggal: "2026-10-26" });

    const r = (await budi.get("/dashboard")).body.ringkasan;
    expect(r.pengeluaranPerKelompok).toEqual([
      { kelompokId: tr, nama: "Transportasi", total: 100_000, jumlah: 1, sub: [{ kategoriId: bensin, nama: "Bensin", total: 100_000, jumlah: 1 }] },
      {
        kelompokId: mm,
        nama: "Kebutuhan Harian",
        total: 70_000,
        jumlah: 2,
        sub: [
          { kategoriId: makan, nama: "Makan", total: 50_000, jumlah: 1 },
          { kategoriId: kopi, nama: "Kopi", total: 20_000, jumlah: 1 },
        ],
      },
      { kelompokId: "LAINNYA", nama: "Lainnya", total: 2_500, jumlah: 1, sub: [{ kategoriId: biayaAdmin, nama: "Biaya Admin Bank", total: 2_500, jumlah: 1 }] },
    ]);
    expect(r.perAkun.find((a: { nama: string }) => a.nama === "BCA").pengeluaranPerKelompok.map((g: { nama: string }) => g.nama)).toEqual([
      "Transportasi",
      "Kebutuhan Harian",
      "Lainnya",
    ]);

    const filter = async (id: string) => ((await budi.get(`/transaksi?kelompokId=${id}`)).body.data as { deskripsi: string; nominal: number }[]).map((t) => t.nominal);
    expect((await filter(mm)).sort()).toEqual([20_000, 50_000]);
    expect(await filter("LAINNYA")).toEqual([10_000]); // transfer dengan biaya admin
  });
});
