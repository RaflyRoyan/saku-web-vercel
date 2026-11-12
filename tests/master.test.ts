import { describe, it, expect } from "vitest";
import { saldoPerAkun } from "../server/services/saldo";
import { ADMIN, appendRaw, rowsDari, setupTest } from "./helpers";

const BUDI = { username: "budi", password: "budi12345", nama: "Budi", peran: "user" };

async function withUsers() {
  const t = setupTest();
  const admin = t.client();
  const setup = await admin.post("/auth/setup", ADMIN);
  await admin.post("/pengguna", BUDI);
  const budi = t.client();
  const login = await budi.post("/auth/login", { username: "budi", password: BUDI.password });
  return { ...t, admin, budi, adminId: setup.body.pengguna.id as string, budiId: login.body.pengguna.id as string };
}

describe("rumus saldo (spec §7.3)", () => {
  it("contoh bagi gaji T5", () => {
    const saldoAwal = rowsDari("SaldoAwal", [["SA-1", "US-a", "PR-1", "BCA", 6_000_000]]);
    const transaksi = rowsDari("Transaksi", [
      ["TR-1", "US-a", "PR-1", "2026-10-25", "transfer", "BCA", "MANDIRI", "", 2_000_000, 2_500],
      ["TR-2", "US-a", "PR-1", "2026-10-25", "transfer", "BCA", "JAGO", "", 1_000_000, 0],
      ["TR-3", "US-a", "PR-1", "2026-10-25", "transfer", "JAGO", "GOPAY", "", 300_000, 1_000],
      ["TR-4", "US-a", "PR-LAIN", "2026-09-25", "keluar", "BCA", "", "KT-1", 99_999, 0],
    ]);
    const saldo = saldoPerAkun("PR-1", saldoAwal, transaksi);
    expect(Object.fromEntries(saldo)).toEqual({ BCA: 2_997_500, MANDIRI: 2_000_000, JAGO: 699_000, GOPAY: 300_000 });
    expect([...saldo.values()].reduce((a, b) => a + b, 0)).toBe(5_996_500);
  });
});

describe("akun (master bersama)", () => {
  it("admin tambah; semua pengguna bisa lihat; bukan admin → 403", async () => {
    const { admin, budi } = await withUsers();
    const bca = await admin.post("/akun", { nama: "BCA", jenis: "bank" });
    expect(bca.status).toBe(201);
    expect(bca.body).toMatchObject({ nama: "BCA", jenis: "bank", urutan: 1, aktif: true });
    expect((await admin.post("/akun", { nama: "GoPay", jenis: "ewallet" })).body.urutan).toBe(2);

    const list = await budi.get("/akun");
    expect(list.body.map((a: { nama: string }) => a.nama)).toEqual(["BCA", "GoPay"]);
    expect(list.body[0].saldo).toBeNull(); // belum ada periode

    expect((await budi.post("/akun", { nama: "Jago", jenis: "bank" })).status).toBe(403);
    expect((await budi.put(`/akun/${bca.body.id}`, { nama: "X", jenis: "bank", urutan: 1 })).status).toBe(403);
  });

  it("nama unik case-insensitive di antara akun aktif; validasi jenis", async () => {
    const { admin } = await withUsers();
    const bca = await admin.post("/akun", { nama: "BCA", jenis: "bank" });
    expect((await admin.post("/akun", { nama: "bca", jenis: "bank" })).status).toBe(409);
    const bad = await admin.post("/akun", { nama: "", jenis: "kripto" });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.errors).sort()).toEqual(["jenis", "nama"]);

    // Setelah dinonaktifkan, nama boleh dipakai lagi; mengaktifkan yang lama jadi bentrok
    await admin.put(`/akun/${bca.body.id}/aktif`, { aktif: false });
    expect((await admin.post("/akun", { nama: "BCA", jenis: "bank" })).status).toBe(201);
    expect((await admin.put(`/akun/${bca.body.id}/aktif`, { aktif: true })).status).toBe(409);
  });

  it("ubah dan atur urutan", async () => {
    const { admin } = await withUsers();
    const a = (await admin.post("/akun", { nama: "BCA", jenis: "bank" })).body;
    const b = (await admin.post("/akun", { nama: "GoPay", jenis: "ewallet" })).body;
    expect((await admin.put(`/akun/${a.id}`, { nama: "BCA Utama", jenis: "bank", urutan: 1 })).status).toBe(204);
    expect((await admin.put("/akun/urutan", { ids: [b.id, a.id] })).status).toBe(204);
    const list = (await admin.get("/akun")).body;
    expect(list.map((x: { nama: string; urutan: number }) => [x.nama, x.urutan])).toEqual([
      ["GoPay", 1],
      ["BCA Utama", 2],
    ]);
    expect((await admin.put("/akun/urutan", { ids: ["AK-tidakada"] })).status).toBe(404);
  });

  it("T15 · nonaktifkan akun bersaldo → 409; saldo 0 → OK", async () => {
    const { admin, budi, store, adminId, budiId } = await withUsers();
    const bca = (await admin.post("/akun", { nama: "BCA", jenis: "bank" })).body;

    // Periode & saldo diisi langsung ke database (endpoint periode/transaksi ada di M4)
    await appendRaw(store, "Periode", [
      ["PR-admin", adminId, "Periode Admin", "2026-10-25", ""],
      ["PR-budi", budiId, "Periode Budi", "2026-10-25", ""],
    ]);
    await appendRaw(store, "SaldoAwal", [["SA-1", adminId, "PR-admin", bca.id, 150_000]]);

    const saldoAdmin = await admin.put(`/akun/${bca.id}/aktif`, { aktif: false });
    expect(saldoAdmin.status).toBe(409);
    expect(saldoAdmin.body.title).toBe("Saldo akun masih Rp 150.000. Pindahkan dulu sebelum dinonaktifkan.");

    // Saldo admin habis, tapi Budi masih punya saldo di akun yang sama
    await appendRaw(store, "Transaksi", [
      ["TR-1", adminId, "PR-admin", "2026-10-26", "keluar", bca.id, "", "KT-x", 150_000, 0],
      ["TR-2", budiId, "PR-budi", "2026-10-26", "masuk", bca.id, "", "KT-y", 50_000, 0],
    ]);
    const saldoLain = await admin.put(`/akun/${bca.id}/aktif`, { aktif: false });
    expect(saldoLain.status).toBe(409);
    expect(saldoLain.body.title).toBe("Akun masih dipakai pengguna lain dengan saldo ≠ 0.");

    // Saldo per pengguna: Budi melihat saldonya sendiri
    expect((await budi.get("/akun")).body[0].saldo).toBe(50_000);
    expect((await admin.get("/akun")).body[0].saldo).toBe(0);

    await appendRaw(store, "Transaksi", [["TR-3", budiId, "PR-budi", "2026-10-27", "keluar", bca.id, "", "KT-x", 50_000, 0]]);
    expect((await admin.put(`/akun/${bca.id}/aktif`, { aktif: false })).status).toBe(204);
    expect((await budi.get("/akun")).body).toEqual([]);
    expect((await budi.get("/akun?termasukNonaktif=true")).body[0]).toMatchObject({ nama: "BCA", aktif: false });
  });
});

describe("kategori (master bersama)", () => {
  it("daftar, filter tipe, untukInput menyembunyikan kategori sistem", async () => {
    const { admin, budi } = await withUsers();
    await admin.post("/kategori", { nama: "Makan", tipe: "keluar" });
    await admin.post("/kategori", { nama: "Gaji", tipe: "masuk" });

    const semua = (await budi.get("/kategori")).body as { nama: string; kodeSistem: string | null }[];
    expect(semua.map((k) => k.nama).sort()).toEqual(["Biaya Admin Bank", "Gaji", "Makan", "Patungan", "Setor Tabungan", "Tarik Tabungan"]);
    const keluarInput = (await budi.get("/kategori?tipe=keluar&untukInput=true")).body as { nama: string }[];
    expect(keluarInput.map((k) => k.nama)).toEqual(["Makan"]);
  });

  it("bukan admin → 403; nama unik per tipe; kategori sistem tidak bisa dinonaktifkan", async () => {
    const { admin, budi } = await withUsers();
    expect((await budi.post("/kategori", { nama: "Kopi", tipe: "keluar" })).status).toBe(403);

    expect((await admin.post("/kategori", { nama: "Lainnya", tipe: "keluar" })).status).toBe(201);
    expect((await admin.post("/kategori", { nama: "lainnya", tipe: "keluar" })).status).toBe(409);
    expect((await admin.post("/kategori", { nama: "Lainnya", tipe: "masuk" })).status).toBe(201);

    const sistem = ((await admin.get("/kategori")).body as { id: string; kodeSistem: string | null }[]).find(
      (k) => k.kodeSistem === "BIAYA_ADMIN",
    )!;
    const res = await admin.put(`/kategori/${sistem.id}/aktif`, { aktif: false });
    expect(res.status).toBe(409);
    expect(res.body.title).toBe("Kategori sistem tidak bisa dinonaktifkan.");
  });

  it("ubah nama dan nonaktifkan", async () => {
    const { admin } = await withUsers();
    const k = (await admin.post("/kategori", { nama: "Makan", tipe: "keluar" })).body;
    expect((await admin.put(`/kategori/${k.id}`, { nama: "Makan & Minum" })).body.nama).toBe("Makan & Minum");
    expect((await admin.put(`/kategori/${k.id}/aktif`, { aktif: false })).status).toBe(204);
    const list = (await admin.get("/kategori?tipe=keluar")).body as { nama: string }[];
    expect(list.map((x) => x.nama)).toEqual(["Biaya Admin Bank", "Setor Tabungan"]);
  });
});
