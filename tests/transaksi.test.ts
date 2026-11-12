import { describe, it, expect } from "vitest";
import { siapkan } from "./helpers";

const transfer = (akunId: string, akunTujuanId: string, nominal: number, biayaAdmin = 0) => ({
  tipe: "transfer",
  akunId,
  akunTujuanId,
  nominal,
  biayaAdmin,
  tanggal: "2026-10-25",
});

describe("periode pertama", () => {
  it("belum ada periode: aktif 404, transaksi 422, list kosong", async () => {
    const { budi, akun, makan } = await siapkan();
    expect((await budi.get("/periode/aktif")).status).toBe(404);
    expect((await budi.get("/periode")).body).toEqual([]);
    const res = await budi.post("/transaksi", { tipe: "keluar", akunId: akun.BCA, kategoriId: makan, nominal: 10_000 });
    expect(res.status).toBe(422);
    expect(res.body.title).toBe("Belum ada periode untuk tanggal ini. Mulai periode baru dulu.");
    expect((await budi.get("/transaksi")).body).toEqual({ data: [], total: 0, halaman: 1, ukuran: 50 });
  });

  it("mulai periode: nama default, saldo awal, validasi akun", async () => {
    const { budi, admin, akun } = await siapkan();
    const bad = await budi.post("/periode/mulai", { saldoAwal: [{ akunId: "AK-tidakada", saldo: 1 }, { akunId: akun.BCA, saldo: -5 }] });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.errors)).toContain("saldoAwal.1.saldo");

    const dobel = await budi.post("/periode/mulai", { saldoAwal: [{ akunId: akun.BCA, saldo: 1 }, { akunId: akun.BCA, saldo: 2 }] });
    expect(dobel.body.errors["saldoAwal.1.akunId"]).toEqual(["Akun BCA dobel."]);

    const res = await budi.post("/periode/mulai", { saldoAwal: [{ akunId: akun.BCA, saldo: 6_000_000 }, { akunId: akun.GoPay, saldo: 0 }] });
    expect(res.status).toBe(201);
    expect(res.body.periode).toMatchObject({ nama: "Periode 30 Okt 2026", tanggalMulai: "2026-10-30", tanggalSelesai: null, aktif: true });
    expect(res.body.setorTabungan).toEqual([]);

    const aktif = await budi.get("/periode/aktif");
    expect(aktif.body.saldoAwal).toEqual([{ akunId: akun.BCA, saldo: 6_000_000 }]);
    // Periode per pengguna: admin belum punya
    expect((await admin.get("/periode/aktif")).status).toBe(404);
    // Saldo di GET /akun milik pengguna yang login
    const list = (await budi.get("/akun")).body as { id: string; saldo: number }[];
    expect(list.find((a) => a.id === akun.BCA)!.saldo).toBe(6_000_000);
  });
});

describe("T5 bagi gaji", () => {
  it("saldo akhir per akun, total, pengeluaran & kategori Biaya Admin Bank", async () => {
    const { budi, akun, biayaAdmin } = await siapkan();
    const p = await budi.post("/periode/mulai", { nama: "Gajian Okt", tanggalMulai: "2026-10-25", saldoAwal: [{ akunId: akun.BCA, saldo: 6_000_000 }] });
    expect((await budi.post("/transaksi", transfer(akun.BCA, akun.Mandiri, 2_000_000, 2_500))).status).toBe(201);
    expect((await budi.post("/transaksi", transfer(akun.BCA, akun.Jago, 1_000_000))).status).toBe(201);
    const t3 = await budi.post("/transaksi", transfer(akun.Jago, akun.GoPay, 300_000, 1_000));
    expect(t3.body).toMatchObject({ akunNama: "Jago", akunTujuanNama: "GoPay", kategoriId: null, peringatan: [] });

    const r = (await budi.get(`/periode/${p.body.periode.id}/ringkasan`)).body;
    const saldo = Object.fromEntries(r.perAkun.map((a: { nama: string; saldoAkhir: number }) => [a.nama, a.saldoAkhir]));
    expect(saldo).toEqual({ BCA: 2_997_500, Mandiri: 2_000_000, Jago: 699_000, GoPay: 300_000 });
    expect(r.totalSaldoAwal).toBe(6_000_000);
    expect(r.totalSaldoAkhir).toBe(5_996_500);
    expect(r.totalPengeluaran).toBe(3_500);
    expect(r.totalMasuk).toBe(0);
    expect(r.pengeluaranPerKategori).toEqual([{ kategoriId: biayaAdmin, nama: "Biaya Admin Bank", total: 3_500, jumlah: 2 }]);
    expect(r.setorTabungan).toEqual([]);

    const bca = r.perAkun.find((a: { nama: string }) => a.nama === "BCA");
    expect(bca).toMatchObject({ saldoAwal: 6_000_000, biayaAdmin: 2_500, transferKeluar: 3_000_000, jumlahTransaksi: 2 });
    expect(bca.pengeluaranPerKategori).toEqual([{ kategoriId: biayaAdmin, nama: "Biaya Admin Bank", total: 2_500, jumlah: 1 }]);

    // Filter akun mencakup transfer masuk; filter kategori Biaya Admin mencakup transfer berbiaya
    expect((await budi.get(`/transaksi?akunId=${akun.Jago}`)).body.total).toBe(2);
    expect((await budi.get(`/transaksi?kategoriId=${biayaAdmin}`)).body.total).toBe(2);
  });
});

describe("T8 pengeluaran melebihi saldo", () => {
  it("tetap tersimpan dengan peringatan; saat tutup periode setor minus", async () => {
    const { budi, akun, makan, clock } = await siapkan();
    await budi.post("/periode/mulai", { tanggalMulai: "2026-10-25", saldoAwal: [{ akunId: akun.GoPay, saldo: 10_000 }] });
    const res = await budi.post("/transaksi", { tipe: "keluar", akunId: akun.GoPay, kategoriId: makan, nominal: 35_000, tanggal: "2026-10-29" });
    expect(res.status).toBe(201);
    expect(res.body.peringatan).toEqual(["Saldo GoPay menjadi minus Rp 25.000"]);
    expect((await budi.get("/transaksi")).body.total).toBe(1);

    clock.set("2026-11-25T03:00:00Z");
    const baru = await budi.post("/periode/mulai", { saldoAwal: [] });
    expect(baru.status).toBe(201);
    expect(baru.body.setorTabungan).toEqual([{ akunId: akun.GoPay, nominal: -25_000 }]);
    expect(baru.body.totalTabungan).toBe(-25_000);
    const list = (await budi.get("/periode")).body;
    expect(list.map((p: { tanggalMulai: string; tanggalSelesai: string | null }) => [p.tanggalMulai, p.tanggalSelesai])).toEqual([
      ["2026-11-25", null],
      ["2026-10-25", "2026-11-24"],
    ]);
  });
});

describe("T11 mulai periode tidak valid", () => {
  it("tanggal ≤ mulai periode aktif → 400; transaksi pada/setelah tanggal mulai tetap di periode lama", async () => {
    const { budi, akun, makan } = await siapkan();
    await budi.post("/periode/mulai", { tanggalMulai: "2026-10-25", saldoAwal: [{ akunId: akun.BCA, saldo: 100_000 }] });
    const sama = await budi.post("/periode/mulai", { tanggalMulai: "2026-10-25" });
    expect(sama.status).toBe(400);
    expect(Object.keys(sama.body.errors)).toEqual(["tanggalMulai"]);
    expect((await budi.post("/periode/mulai", { tanggalMulai: "2026-10-01" })).status).toBe(400);

    const t = await budi.post("/transaksi", { tipe: "keluar", akunId: akun.BCA, kategoriId: makan, nominal: 5_000, tanggal: "2026-10-28" });
    const lama = t.body.periodeId as string;
    const baru = await budi.post("/periode/mulai", { tanggalMulai: "2026-10-28" });
    expect(baru.status).toBe(201);
    expect(baru.body.transaksiTetapDiPeriodeLama).toBe(1);
    // Ikut sisa periode lama: 100.000 − 5.000
    expect(baru.body.setorTabungan).toEqual([{ akunId: akun.BCA, nominal: 95_000 }]);
    expect((await budi.get(`/transaksi/${t.body.id}`)).body.periodeId).toBe(lama);
    expect((await budi.get(`/periode/${baru.body.periode.id}/ringkasan`)).body.totalPengeluaran).toBe(0);

    // Edit tanpa ganti tanggal tetap di periode lama; ganti tanggal → ikut periode sesuai tanggal
    const ubah = await budi.put(`/transaksi/${t.body.id}`, { tipe: "keluar", akunId: akun.BCA, kategoriId: makan, nominal: 7_000, tanggal: "2026-10-28" });
    expect(ubah.body.periodeId).toBe(lama);
    const pindah = await budi.put(`/transaksi/${t.body.id}`, { tipe: "keluar", akunId: akun.BCA, kategoriId: makan, nominal: 7_000, tanggal: "2026-10-29" });
    expect(pindah.body.periodeId).toBe(baru.body.periode.id);

    // Transaksi baru bertanggal ≥ mulai masuk periode baru
    const t2 = await budi.post("/transaksi", { tipe: "keluar", akunId: akun.BCA, kategoriId: makan, nominal: 1_000, tanggal: "2026-10-28" });
    expect(t2.body.periodeId).toBe(baru.body.periode.id);
  });
});

describe("transaksi", () => {
  it("T4: pengguna lain → 404 untuk lihat, ubah, hapus, ringkasan", async () => {
    const { admin, budi, akun, makan } = await siapkan();
    const p = await budi.post("/periode/mulai", { tanggalMulai: "2026-10-25" });
    const t = await budi.post("/transaksi", { tipe: "keluar", akunId: akun.BCA, kategoriId: makan, nominal: 5_000 });
    const id = t.body.id;
    const body = { tipe: "keluar", akunId: akun.BCA, kategoriId: makan, nominal: 1 };
    expect((await admin.get(`/transaksi/${id}`)).status).toBe(404);
    expect((await admin.put(`/transaksi/${id}`, body)).status).toBe(404);
    expect((await admin.del(`/transaksi/${id}`)).status).toBe(404);
    expect((await admin.get(`/periode/${p.body.periode.id}/ringkasan`)).status).toBe(404);
    expect((await admin.get(`/transaksi?periodeId=${p.body.periode.id}`)).status).toBe(404);
    expect((await budi.get(`/transaksi/${id}`)).status).toBe(200);
  });

  it("validasi per field dan aturan tipe", async () => {
    const { budi, akun, makan, gaji, tarik } = await siapkan();
    await budi.post("/periode/mulai", { tanggalMulai: "2026-10-25" });
    const kosong = await budi.post("/transaksi", { tipe: "keluar", akunId: akun.BCA, nominal: 0 });
    expect(kosong.status).toBe(400);
    expect(kosong.body.errors.nominal).toEqual(["Nominal harus lebih dari 0."]);

    const salahTipe = await budi.post("/transaksi", { tipe: "masuk", akunId: akun.BCA, kategoriId: makan, nominal: 1 });
    expect(Object.keys(salahTipe.body.errors)).toEqual(["kategoriId"]);
    expect((await budi.post("/transaksi", { tipe: "masuk", akunId: akun.BCA, kategoriId: tarik, nominal: 1 })).status).toBe(400);
    expect((await budi.post("/transaksi", { tipe: "keluar", akunId: akun.BCA, kategoriId: makan, nominal: 1, biayaAdmin: 500 })).body.errors.biayaAdmin).toBeDefined();
    expect((await budi.post("/transaksi", transfer(akun.BCA, akun.BCA, 1))).body.errors.akunTujuanId).toEqual([
      "Akun tujuan harus berbeda dengan akun asal.",
    ]);
    const jauh = await budi.post("/transaksi", { tipe: "masuk", akunId: akun.BCA, kategoriId: gaji, nominal: 1, tanggal: "2026-12-01" });
    expect(jauh.body.errors.tanggal).toBeDefined();
    expect((await budi.post("/transaksi", { tipe: "masuk", akunId: akun.BCA, kategoriId: gaji, nominal: 1, tanggal: "2026-11-30" })).status).toBe(201);
    // Sebelum periode pertama
    expect((await budi.post("/transaksi", { tipe: "masuk", akunId: akun.BCA, kategoriId: gaji, nominal: 1, tanggal: "2026-10-24" })).status).toBe(422);
  });

  it("T15 lanjutan: akun nonaktif tidak bisa dipakai di transaksi baru, tapi edit lama tetap boleh", async () => {
    const { admin, budi, akun, makan } = await siapkan();
    await budi.post("/periode/mulai", { tanggalMulai: "2026-10-25" });
    const t = await budi.post("/transaksi", { tipe: "keluar", akunId: akun.Jago, kategoriId: makan, nominal: 5_000 });
    // Saldo Jago budi -5.000 → tidak bisa dinonaktifkan; hapus dulu transaksinya
    expect((await admin.put(`/akun/${akun.Jago}/aktif`, { aktif: false })).status).toBe(409);
    const t2 = await budi.post("/transaksi", { tipe: "masuk", akunId: akun.Jago, kategoriId: (await admin.post("/kategori", { nama: "Lain", tipe: "masuk" })).body.id, nominal: 5_000 });
    expect(t2.status).toBe(201);
    expect((await admin.put(`/akun/${akun.Jago}/aktif`, { aktif: false })).status).toBe(204);

    const baru = await budi.post("/transaksi", { tipe: "keluar", akunId: akun.Jago, kategoriId: makan, nominal: 1 });
    expect(baru.status).toBe(400);
    expect(baru.body.errors.akunId).toEqual(["Akun Jago nonaktif dan tidak bisa dipakai."]);
    const edit = await budi.put(`/transaksi/${t.body.id}`, { tipe: "keluar", akunId: akun.Jago, kategoriId: makan, nominal: 5_000, deskripsi: "Kopi" });
    expect(edit.status).toBe(200);
    expect(edit.body.deskripsi).toBe("Kopi");
    // Akun nonaktif yang punya data tetap muncul di ringkasan
    const aktif = (await budi.get("/periode/aktif")).body;
    const r = (await budi.get(`/periode/${aktif.id}/ringkasan`)).body;
    expect(r.perAkun.find((a: { akunId: string }) => a.akunId === akun.Jago)).toMatchObject({ aktif: false, saldoAkhir: 0 });
  });

  it("edit pindah periode, hapus, urutan & paginasi, transaksi tarik tabungan → 409", async () => {
    const { budi, akun, makan, store, clock } = await siapkan();
    await budi.post("/periode/mulai", { tanggalMulai: "2026-10-01" });
    clock.set("2026-10-20T03:00:00Z");
    for (const [tanggal, deskripsi] of [["2026-10-05", "Satu"], ["2026-10-10", "Dua"], ["2026-10-10", "Tiga"]]) {
      clock.advance(1000);
      await budi.post("/transaksi", { tipe: "keluar", akunId: akun.BCA, kategoriId: makan, nominal: 1_000, tanggal, deskripsi });
    }
    const hal1 = (await budi.get("/transaksi?ukuran=2")).body;
    expect(hal1.total).toBe(3);
    expect(hal1.data.map((t: { deskripsi: string }) => t.deskripsi)).toEqual(["Tiga", "Dua"]);
    expect((await budi.get("/transaksi?ukuran=2&halaman=2")).body.data[0].deskripsi).toBe("Satu");
    expect((await budi.get("/transaksi?q=ti")).body.data.map((t: { deskripsi: string }) => t.deskripsi)).toEqual(["Tiga"]);

    // Tutup periode lama: semua transaksinya sebelum 15 Okt
    const p2 = await budi.post("/periode/mulai", { tanggalMulai: "2026-10-15", saldoAwal: [{ akunId: akun.BCA, saldo: 50_000 }] });
    expect(p2.status).toBe(201);
    // Setor tabungan periode lama = 0 − 3.000
    expect(p2.body.setorTabungan).toEqual([{ akunId: akun.BCA, nominal: -3_000 }]);

    // Pindahkan "Satu" ke periode baru → setor lama dihitung ulang tanpa baris ganda
    const lama = (await budi.get("/periode")).body[1].id;
    const satu = (await budi.get(`/transaksi?q=satu&periodeId=${lama}`)).body.data[0];
    const pindah = await budi.put(`/transaksi/${satu.id}`, { tipe: "keluar", akunId: akun.BCA, kategoriId: makan, nominal: 1_000, tanggal: "2026-10-16" });
    expect(pindah.body.periodeId).toBe(p2.body.periode.id);
    const setor = async () => (await store.read(["Tabungan"])).Tabungan.filter((r) => r.data.jenis === "setor").map((r) => r.data.nominal);
    expect(await setor()).toEqual([-2_000]);

    expect((await budi.del(`/transaksi/${satu.id}`)).status).toBe(204);
    expect((await budi.get(`/transaksi/${satu.id}`)).status).toBe(404);
  });

  it("transaksi kategori TARIK_TABUNGAN tidak bisa diedit/dihapus lewat transaksi", async () => {
    const { budi, akun, makan, tarik, store } = await siapkan();
    await budi.post("/periode/mulai", { tanggalMulai: "2026-10-25" });
    const t = await budi.post("/transaksi", { tipe: "keluar", akunId: akun.BCA, kategoriId: makan, nominal: 1 });
    // Ubah baris langsung jadi transaksi tarik tabungan (normalnya dibuat endpoint tabungan di M5)
    const row = (await store.read(["Transaksi"])).Transaksi.find((r) => r.data.id === t.body.id)!;
    await store.updateRow("Transaksi", { ...row.data, tipe: "masuk", kategori_id: tarik });
    const body = { tipe: "masuk", akunId: akun.BCA, kategoriId: tarik, nominal: 2 };
    expect((await budi.put(`/transaksi/${t.body.id}`, body)).body.title).toBe("Ubah lewat menu Tabungan.");
    expect((await budi.del(`/transaksi/${t.body.id}`)).status).toBe(409);
  });
});

describe("ubah periode & saldo awal", () => {
  it("ganti nama; saldo awal upsert + hapus; periode tertutup → setor dihitung ulang", async () => {
    const { budi, akun, store } = await siapkan();
    const p1 = (await budi.post("/periode/mulai", { tanggalMulai: "2026-10-01", saldoAwal: [{ akunId: akun.BCA, saldo: 100 }, { akunId: akun.GoPay, saldo: 50 }] })).body.periode;
    const ubah = await budi.put(`/periode/${p1.id}`, { nama: "Gajian Okt" });
    expect(ubah.body).toMatchObject({ nama: "Gajian Okt", keterangan: "" });

    await budi.post("/periode/mulai", { tanggalMulai: "2026-10-15" });
    const setor = async () =>
      (await store.read(["Tabungan"])).Tabungan.filter((r) => r.data.jenis === "setor").map((r) => [r.data.akun_id, r.data.nominal]);
    expect(await setor()).toEqual([[akun.BCA, 100], [akun.GoPay, 50]]);

    expect((await budi.put(`/periode/${p1.id}/saldo-awal`, { saldoAwal: [{ akunId: akun.BCA, saldo: 300 }, { akunId: akun.Jago, saldo: 7 }] })).status).toBe(204);
    const r = (await budi.get(`/periode/${p1.id}/ringkasan`)).body;
    expect(r.totalSaldoAwal).toBe(307);
    // GoPay tidak dikirim → baris saldo awal dihapus, setor jadi 0 (bukan baris baru)
    expect(await setor()).toEqual([[akun.BCA, 300], [akun.GoPay, 0], [akun.Jago, 7]]);
    expect(r.setorTabungan).toHaveLength(3);
  });
});

describe("filter riwayat lintas periode", () => {
  it("periodeId=semua + dari/sampai mencakup periode tertutup; tetap hanya milik sendiri", async () => {
    const { budi, admin, akun, makan, clock } = await siapkan();
    await budi.post("/periode/mulai", { tanggalMulai: "2026-10-01" });
    clock.set("2026-10-20T03:00:00Z");
    for (const tanggal of ["2026-10-05", "2026-10-12"]) {
      await budi.post("/transaksi", { tipe: "keluar", akunId: akun.BCA, kategoriId: makan, nominal: 1_000, tanggal });
    }
    await budi.post("/periode/mulai", { tanggalMulai: "2026-10-15" });
    await budi.post("/transaksi", { tipe: "keluar", akunId: akun.BCA, kategoriId: makan, nominal: 1_000, tanggal: "2026-10-18" });

    expect((await budi.get("/transaksi")).body.total).toBe(1);
    const semua = (await budi.get("/transaksi?periodeId=semua")).body;
    expect(semua.data.map((t: { tanggal: string }) => t.tanggal)).toEqual(["2026-10-18", "2026-10-12", "2026-10-05"]);
    const rentang = (await budi.get("/transaksi?periodeId=semua&dari=2026-10-10&sampai=2026-10-18")).body;
    expect(rentang.total).toBe(2);

    await admin.post("/periode/mulai", { tanggalMulai: "2026-10-01" });
    await admin.post("/transaksi", { tipe: "keluar", akunId: akun.BCA, kategoriId: makan, nominal: 1, tanggal: "2026-10-06" });
    expect((await budi.get("/transaksi?periodeId=semua")).body.total).toBe(3);
  });
});
