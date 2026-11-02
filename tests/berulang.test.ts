import { describe, it, expect } from "vitest";
import { addMonths, jatuhTempo, selisihHari } from "../server/services/berulang";
import { siapkan } from "./helpers";

/** Budi dengan periode aktif sejak 25 Okt 2026 (clock 30 Okt 2026). */
async function siapkanLangganan() {
  const t = await siapkan();
  await t.budi.post("/periode/mulai", { tanggalMulai: "2026-10-25", saldoAwal: [{ akunId: t.akun.GoPay, saldo: 100_000 }] });
  const tambah = (body: Record<string, unknown>) =>
    t.budi.post("/berulang", { nama: "Netflix", akunId: t.akun.GoPay, kategoriId: t.makan, nominal: 54_000, tglJatuhTempo: 2, mulai: "2026-11", ...body });
  return { ...t, tambah };
}

describe("helper tanggal", () => {
  it("T12: jatuh tempo tgl 31 di Februari = hari terakhir", () => {
    expect(jatuhTempo(31, "2027-02")).toBe("2027-02-28");
    expect(jatuhTempo(31, "2028-02")).toBe("2028-02-29");
    expect(jatuhTempo(31, "2026-11")).toBe("2026-11-30");
    expect(jatuhTempo(2, "2026-11")).toBe("2026-11-02");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(selisihHari("2026-10-30", "2026-11-02")).toBe(3);
  });
});

describe("pengingat", () => {
  it("T12 lewat HTTP: langganan tgl 31 jatuh tempo 28 Feb", async () => {
    const { budi, tambah } = await siapkanLangganan();
    const b = (await tambah({ nama: "Gym", tglJatuhTempo: 31, mulai: "2027-01" })).body;
    const p = (await budi.get("/berulang/pengingat?tanggal=2027-02-26")).body;
    expect(p).toEqual([expect.objectContaining({ berulangId: b.id, bulan: "2027-02", jatuhTempo: "2027-02-28", status: "akan_datang", sisaHari: 2 })]);
  });

  it("T13: tgl 2, H-3, hari ini 30 Okt → pengingat November", async () => {
    const { budi, tambah } = await siapkanLangganan();
    const b = (await tambah({ ingatkanHMin: 3 })).body;
    const p = (await budi.get("/berulang/pengingat")).body;
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ bulan: "2026-11", jatuhTempo: "2026-11-02", status: "akan_datang", sisaHari: 3 });
    expect(p[0].berulang).toMatchObject({ id: b.id, nama: "Netflix", akunNama: "GoPay", kategoriNama: "Makan", status: "belum", bulan: "2026-11" });
    // H-2 belum waktunya
    await budi.put(`/berulang/${b.id}`, { ...b, ingatkanHMin: 2 });
    expect((await budi.get("/berulang/pengingat")).body).toEqual([]);
    // Status hari ini & terlambat (hanya bulan berjalan); bulan lalu tidak tampil
    expect((await budi.get("/berulang/pengingat?tanggal=2026-11-02")).body[0].status).toBe("hari_ini");
    expect((await budi.get("/berulang/pengingat?tanggal=2026-11-20")).body[0]).toMatchObject({ status: "terlambat", sisaHari: -18 });
    // 1 Des: November yang belum dibayar tidak tampil, hanya Desember
    expect((await budi.get("/berulang/pengingat?tanggal=2026-12-01")).body.map((x: { bulan: string }) => x.bulan)).toEqual(["2026-12"]);
  });

  it("langganan nonaktif / belum mulai / sudah selesai tidak muncul; pengguna lain tidak lihat", async () => {
    const { budi, admin, tambah } = await siapkanLangganan();
    const b = (await tambah({ selesai: "2026-11" })).body;
    expect((await budi.get("/berulang/pengingat?tanggal=2026-12-01")).body).toEqual([]); // Des > selesai
    expect((await budi.get("/berulang/pengingat?tanggal=2026-09-30")).body).toEqual([]); // Okt < mulai
    expect((await admin.get("/berulang")).body).toEqual([]);
    expect((await admin.post(`/berulang/${b.id}/lewati`, { bulan: "2026-11" })).status).toBe(404);
    await budi.put(`/berulang/${b.id}`, { ...b, aktif: false });
    expect((await budi.get("/berulang/pengingat")).body).toEqual([]);
    expect((await budi.get("/berulang")).body).toEqual([]);
    expect((await budi.get("/berulang?termasukNonaktif=true")).body).toHaveLength(1);
  });
});

describe("T14 konfirmasi & lewati", () => {
  it("konfirmasi dua kali di bulan sama → 409; transaksi keluar dengan default langganan", async () => {
    const { budi, akun, tambah, clock } = await siapkanLangganan();
    const b = (await tambah({})).body;
    clock.set("2026-11-01T03:00:00Z");
    const bayar = await budi.post(`/berulang/${b.id}/konfirmasi`, { bulan: "2026-11" });
    expect(bayar.status).toBe(201);
    // Tanggal default hari ini
    expect(bayar.body).toMatchObject({ tipe: "keluar", akunId: akun.GoPay, nominal: 54_000, deskripsi: "Netflix", berulangId: b.id, tanggal: "2026-11-01" });
    expect((await budi.post(`/berulang/${b.id}/konfirmasi`, { bulan: "2026-11" })).status).toBe(409);
    expect((await budi.get("/berulang/pengingat")).body).toEqual([]);
    const list = (await budi.get("/berulang")).body;
    expect(list[0]).toMatchObject({ bulan: "2026-11", status: "dibayar", transaksiId: bayar.body.id });
    expect((await budi.post(`/berulang/${b.id}/lewati`, { bulan: "2026-11" })).status).toBe(409);
  });

  it("nilai bisa diubah; bulan di luar masa berlaku → 422", async () => {
    const { budi, akun, tambah } = await siapkanLangganan();
    const b = (await tambah({})).body;
    expect((await budi.post(`/berulang/${b.id}/konfirmasi`, { bulan: "2026-10" })).status).toBe(422);
    const res = await budi.post(`/berulang/${b.id}/konfirmasi`, { bulan: "2026-11", tanggal: "2026-11-01", nominal: 60_000, akunId: akun.BCA, deskripsi: "Netflix premium" });
    expect(res.body).toMatchObject({ akunId: akun.BCA, nominal: 60_000, deskripsi: "Netflix premium", tanggal: "2026-11-01" });
    expect(res.body.peringatan).toEqual(["Saldo BCA menjadi minus Rp 60.000"]);
  });

  it("setelah lewati tidak muncul di pengingat; batal lewati muncul lagi", async () => {
    const { budi, tambah } = await siapkanLangganan();
    const b = (await tambah({})).body;
    expect((await budi.post(`/berulang/${b.id}/lewati`, { bulan: "2026-11" })).status).toBe(201);
    expect((await budi.post(`/berulang/${b.id}/lewati`, { bulan: "2026-11" })).status).toBe(409);
    expect((await budi.get("/berulang/pengingat")).body).toEqual([]);
    expect((await budi.get("/berulang")).body[0]).toMatchObject({ bulan: "2026-11", status: "dilewati" });

    expect((await budi.del(`/berulang/${b.id}/lewati/2026-11`)).status).toBe(204);
    expect((await budi.get("/berulang/pengingat")).body).toHaveLength(1);
    expect((await budi.del(`/berulang/${b.id}/lewati/2026-11`)).status).toBe(404);
  });
});

describe("validasi langganan", () => {
  it("akun/kategori harus valid; selesai ≥ mulai; tgl 1–31", async () => {
    const { tambah, gaji, biayaAdmin } = await siapkanLangganan();
    const res = await tambah({ kategoriId: gaji, tglJatuhTempo: 32, mulai: "2026-11", selesai: "2026-10" });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.errors)).toEqual(["tglJatuhTempo"]);
    const bisnis = await tambah({ kategoriId: biayaAdmin, akunId: "AK-x", selesai: "2026-10" });
    expect(Object.keys(bisnis.body.errors).sort()).toEqual(["akunId", "kategoriId", "selesai"]);
    expect((await tambah({ ingatkanHMin: 16 })).status).toBe(400);
  });
});

describe("dashboard", () => {
  it("tanpa periode: ringkasan null; dengan periode: ringkasan, tabungan, pengingat, 5 transaksi terakhir", async () => {
    const t = await siapkan();
    expect((await t.budi.get("/dashboard")).body).toEqual({ ringkasan: null, anggaran: null, totalTabungan: 0, pengingat: [], transaksiTerakhir: [] });

    await t.budi.post("/periode/mulai", { tanggalMulai: "2026-10-25", saldoAwal: [{ akunId: t.akun.BCA, saldo: 1_000_000 }] });
    for (let i = 1; i <= 6; i++) {
      t.clock.advance(1000);
      await t.budi.post("/transaksi", { tipe: "keluar", akunId: t.akun.BCA, kategoriId: t.makan, nominal: 1_000 * i, tanggal: "2026-10-26", deskripsi: `T${i}` });
    }
    await t.budi.post("/berulang", { nama: "Netflix", akunId: t.akun.BCA, kategoriId: t.makan, nominal: 54_000, tglJatuhTempo: 2, mulai: "2026-11" });
    const d = (await t.budi.get("/dashboard")).body;
    expect(d.ringkasan.totalPengeluaran).toBe(21_000);
    expect(d.ringkasan.totalSaldoAkhir).toBe(979_000);
    expect(d.transaksiTerakhir.map((x: { deskripsi: string }) => x.deskripsi)).toEqual(["T6", "T5", "T4", "T3", "T2"]);
    expect(d.pengingat).toHaveLength(1);
    expect(d.totalTabungan).toBe(0);
  });
});
