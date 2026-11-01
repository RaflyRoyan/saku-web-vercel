import { describe, it, expect } from "vitest";
import { siapkan } from "./helpers";

type PilihanDto = { eksplisit: boolean; akun: { id: string; nama: string; dipilih: boolean; saldo: number | null }[] };

const namaAkun = (list: { nama: string }[]) => list.map((a) => a.nama);

describe("akun pilihan pengguna", () => {
  it("pengguna lama tanpa pilihan memakai semua akun aktif, urut master", async () => {
    const { budi } = await siapkan();
    const p = (await budi.get("/akun/pilihan")).body as PilihanDto;
    expect(p.eksplisit).toBe(false);
    expect(p.akun.map((a) => [a.nama, a.dipilih])).toEqual([
      ["BCA", true],
      ["Mandiri", true],
      ["Jago", true],
      ["GoPay", true],
    ]);
    expect(namaAkun((await budi.get("/akun")).body)).toEqual(["BCA", "Mandiri", "Jago", "GoPay"]);
  });

  it("simpan pilihan + urutan sendiri; tidak memengaruhi pengguna lain", async () => {
    const { budi, admin, akun } = await siapkan();
    expect((await budi.put("/akun/pilihan", { ids: [akun.GoPay, akun.BCA] })).status).toBe(204);

    const list = (await budi.get("/akun")).body as { nama: string; dipilih: boolean; urutanSaya: number }[];
    expect(namaAkun(list)).toEqual(["GoPay", "BCA"]);

    const p = (await budi.get("/akun/pilihan")).body as PilihanDto;
    expect(p.eksplisit).toBe(true);
    expect(p.akun.map((a) => [a.nama, a.dipilih])).toEqual([
      ["GoPay", true],
      ["BCA", true],
      ["Mandiri", false],
      ["Jago", false],
    ]);

    // termasukNonaktif = semua akun, urut master, dengan penanda dipilih
    const semua = (await budi.get("/akun?termasukNonaktif=true")).body as { nama: string; dipilih: boolean }[];
    expect(semua.map((a) => [a.nama, a.dipilih])).toEqual([
      ["BCA", true],
      ["Mandiri", false],
      ["Jago", false],
      ["GoPay", true],
    ]);

    expect(namaAkun((await admin.get("/akun")).body)).toEqual(["BCA", "Mandiri", "Jago", "GoPay"]);
  });

  it("ganti pilihan memakai ulang baris, idempoten, dan akun baru admin tidak otomatis dipilih", async () => {
    const { budi, admin, akun, store } = await siapkan();
    await budi.put("/akun/pilihan", { ids: [akun.BCA, akun.Mandiri, akun.Jago] });
    await budi.put("/akun/pilihan", { ids: [akun.GoPay, akun.BCA] });
    await budi.put("/akun/pilihan", { ids: [akun.GoPay, akun.BCA] });

    const rows = (await store.readMany(["AkunPengguna"])).AkunPengguna.rows;
    expect(rows).toHaveLength(2);
    expect(namaAkun((await budi.get("/akun")).body)).toEqual(["GoPay", "BCA"]);

    await admin.post("/akun", { nama: "Cash", jenis: "cash" });
    expect(namaAkun((await budi.get("/akun")).body)).toEqual(["GoPay", "BCA"]);
    const p = (await budi.get("/akun/pilihan")).body as PilihanDto;
    expect(p.akun.find((a) => a.nama === "Cash")?.dipilih).toBe(false);
  });

  it("validasi: minimal satu, tidak dobel, akun harus ada & aktif", async () => {
    const { budi, admin, akun } = await siapkan();
    expect((await budi.put("/akun/pilihan", { ids: [] })).body.errors.ids).toEqual(["Pilih minimal satu akun."]);
    expect((await budi.put("/akun/pilihan", { ids: [akun.BCA, akun.BCA] })).status).toBe(400);
    expect((await budi.put("/akun/pilihan", { ids: ["AK-tidakada"] })).body.errors.ids).toEqual(["Akun tidak ditemukan."]);

    await admin.put(`/akun/${akun.Jago}/aktif`, { aktif: false });
    expect((await budi.put("/akun/pilihan", { ids: [akun.Jago] })).body.errors.ids).toEqual(["Akun Jago nonaktif dan tidak bisa dipilih."]);
  });

  it("akun bersaldo ≠ 0 di periode aktif tidak bisa dilepas", async () => {
    const { budi, akun } = await siapkan();
    await budi.post("/periode/mulai", { tanggalMulai: "2026-10-25", saldoAwal: [{ akunId: akun.BCA, saldo: 1_500_000 }] });

    const res = await budi.put("/akun/pilihan", { ids: [akun.GoPay] });
    expect(res.status).toBe(409);
    expect(res.body.title).toMatch(/^Saldo BCA masih Rp\s?1\.500\.000\. Pindahkan dulu sebelum akun dilepas\.$/);

    // Akun bersaldo 0 boleh dilepas
    expect((await budi.put("/akun/pilihan", { ids: [akun.BCA] })).status).toBe(204);
  });

  it("akun yang tidak dipilih ditolak di transaksi, langganan, tabungan & saldo awal", async () => {
    const { budi, akun, makan } = await siapkan();
    await budi.post("/periode/mulai", { tanggalMulai: "2026-10-25", saldoAwal: [{ akunId: akun.BCA, saldo: 1_000_000 }] });
    await budi.put("/akun/pilihan", { ids: [akun.BCA, akun.GoPay] });

    const pesan = ["Akun Mandiri belum dipilih di Pengaturan."];
    const keluar = await budi.post("/transaksi", { tipe: "keluar", akunId: akun.Mandiri, kategoriId: makan, nominal: 10_000, tanggal: "2026-10-26" });
    expect(keluar.body.errors.akunId).toEqual(pesan);

    const tf = await budi.post("/transaksi", { tipe: "transfer", akunId: akun.BCA, akunTujuanId: akun.Mandiri, nominal: 10_000, tanggal: "2026-10-26" });
    expect(tf.body.errors.akunTujuanId).toEqual(pesan);

    const langganan = await budi.post("/berulang", { nama: "Netflix", akunId: akun.Mandiri, kategoriId: makan, nominal: 50_000, tglJatuhTempo: 5, mulai: "2026-10" });
    expect(langganan.body.errors.akunId).toEqual(pesan);

    const tarik = await budi.post("/tabungan/tarik", { akunId: akun.Mandiri, nominal: 1 });
    expect(tarik.body.errors.akunId).toEqual(pesan);

    const periode = (await budi.get("/periode/aktif")).body as { id: string };
    const sa = await budi.put(`/periode/${periode.id}/saldo-awal`, {
      saldoAwal: [{ akunId: akun.BCA, saldo: 1_000_000 }, { akunId: akun.Mandiri, saldo: 5 }, { akunId: akun.Jago, saldo: 0 }],
    });
    expect(sa.body.errors).toEqual({ "saldoAwal.1.akunId": pesan });

    // Akun yang dipilih tetap jalan
    const ok = await budi.post("/transaksi", { tipe: "keluar", akunId: akun.GoPay, kategoriId: makan, nominal: 10_000, tanggal: "2026-10-26" });
    expect(ok.status).toBe(201);
  });

  it("transaksi lama dengan akun yang sudah dilepas tetap bisa diedit tanpa ganti akun", async () => {
    const { budi, akun, makan } = await siapkan();
    await budi.post("/periode/mulai", { tanggalMulai: "2026-10-25", saldoAwal: [{ akunId: akun.Jago, saldo: 10_000 }] });
    const body = { tipe: "keluar", akunId: akun.Jago, kategoriId: makan, nominal: 10_000, tanggal: "2026-10-26" };
    const t = (await budi.post("/transaksi", body)).body;
    // Saldo Jago jadi 0 → boleh dilepas
    expect((await budi.put("/akun/pilihan", { ids: [akun.BCA] })).status).toBe(204);

    expect((await budi.put(`/transaksi/${t.id}`, { ...body, deskripsi: "Makan siang" })).status).toBe(200);
    const ganti = await budi.put(`/transaksi/${t.id}`, { ...body, akunId: akun.Mandiri });
    expect(ganti.body.errors.akunId).toEqual(["Akun Mandiri belum dipilih di Pengaturan."]);
  });

  it("ringkasan dashboard hanya akun dipilih + akun lain yang punya data, urut pengguna", async () => {
    const { budi, akun } = await siapkan();
    await budi.post("/periode/mulai", { tanggalMulai: "2026-10-25", saldoAwal: [{ akunId: akun.Jago, saldo: 0 }] });
    await budi.put("/akun/pilihan", { ids: [akun.GoPay, akun.BCA] });
    const d = (await budi.get("/dashboard")).body as { ringkasan: { perAkun: { nama: string }[] } };
    expect(namaAkun(d.ringkasan.perAkun)).toEqual(["GoPay", "BCA"]);
  });

  it("isolasi: pilihan pengguna lain tidak terbaca", async () => {
    const { budi, admin, akun } = await siapkan();
    await admin.put("/akun/pilihan", { ids: [akun.Jago] });
    expect((await budi.get("/akun/pilihan")).body.eksplisit).toBe(false);
    expect(namaAkun((await budi.get("/akun")).body)).toHaveLength(4);
  });
});
