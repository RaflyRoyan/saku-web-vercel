import { describe, it, expect } from "vitest";
import { siapkan } from "./helpers";

type Tr = { id: string; label: string | null; nominal: number };

async function siap() {
  const t = await siapkan();
  await t.budi.post("/periode/mulai", { tanggalMulai: "2026-10-25", saldoAwal: [{ akunId: t.akun.BCA, saldo: 1_000_000 }] });
  const tr = async (o: Record<string, unknown>) => (await t.budi.post("/transaksi", { tipe: "keluar", akunId: t.akun.BCA, kategoriId: t.makan, nominal: 10_000, tanggal: "2026-10-29", ...o })).body as Tr;
  const list = async (qs = "") => (await t.budi.get(`/transaksi?periodeId=semua${qs}`)).body.data as Tr[];
  return { ...t, tr, list };
}

describe("label transaksi", () => {
  it("POST dengan label; tanpa label → null; PUT tanpa field label tidak menghapus label", async () => {
    const { tr, budi, akun, makan } = await siap();
    const a = await tr({ label: "  Liburan   Jogja " });
    expect(a.label).toBe("Liburan Jogja");
    expect((await tr({})).label).toBeNull();
    const ubah = await budi.put(`/transaksi/${a.id}`, { tipe: "keluar", akunId: akun.BCA, kategoriId: makan, nominal: 20_000, tanggal: "2026-10-29" });
    expect(ubah.body).toMatchObject({ nominal: 20_000, label: "Liburan Jogja" });
    const hapus = await budi.put(`/transaksi/${a.id}`, { tipe: "keluar", akunId: akun.BCA, kategoriId: makan, nominal: 20_000, tanggal: "2026-10-29", label: null });
    expect(hapus.body.label).toBeNull();
  });

  it("ejaan label lama dipakai (beda huruf besar/kecil); lebih dari 50 karakter → 400", async () => {
    const { tr, budi } = await siap();
    await tr({ label: "Liburan Jogja" });
    expect((await tr({ label: "liburan JOGJA" })).label).toBe("Liburan Jogja");
    const r = await budi.post("/transaksi", { tipe: "keluar", akunId: "x", kategoriId: "x", nominal: 1, label: "a".repeat(51) });
    expect(r.status).toBe(400);
  });

  it("PUT /transaksi/label massal + hapus label; daftar label", async () => {
    const { tr, budi, list } = await siap();
    const a = await tr({});
    const b = await tr({});
    const c = await tr({ label: "Kantor" });
    const r = await budi.put("/transaksi/label", { ids: [a.id, b.id, a.id], label: "liburan jogja" });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ label: "liburan jogja", jumlah: 2 });
    expect((await list()).filter((t) => t.label === "liburan jogja").map((t) => t.id).sort()).toEqual([a.id, b.id].sort());
    expect((await budi.get("/transaksi/label")).body).toEqual([
      { label: "liburan jogja", jumlah: 2 },
      { label: "Kantor", jumlah: 1 },
    ]);

    await budi.put("/transaksi/label", { ids: [c.id], label: null });
    expect((await budi.get("/transaksi/label")).body).toEqual([{ label: "liburan jogja", jumlah: 2 }]);
  });

  it("transaksi milik user lain → 404, tidak ada yang berubah", async () => {
    const { tr, budi, admin, list } = await siap();
    const a = await tr({});
    const r = await admin.put("/transaksi/label", { ids: [a.id], label: "Iseng" });
    expect(r.status).toBe(404);
    expect((await list())[0].label).toBeNull();
    expect((await budi.put("/transaksi/label", { ids: [], label: "X" })).status).toBe(400);
  });

  it("filter ?label= lintas periode + ringkasan (transfer tidak dihitung)", async () => {
    const { tr, budi, list, akun, gaji } = await siap();
    await tr({ nominal: 300_000, label: "Liburan Jogja" });
    await tr({ nominal: 50_000, label: "liburan jogja" });
    await tr({ nominal: 99_000 });
    await tr({ tipe: "masuk", kategoriId: gaji, nominal: 40_000, label: "Liburan Jogja", tanggal: "2026-10-30" });
    await tr({ tipe: "transfer", kategoriId: undefined, akunTujuanId: akun.GoPay, nominal: 100_000, label: "Liburan Jogja" });

    expect(await list("&label=LIBURAN%20JOGJA")).toHaveLength(4);
    const r = await budi.get("/transaksi/label/ringkasan?label=liburan%20jogja");
    expect(r.body).toMatchObject({ label: "Liburan Jogja", jumlah: 4, masuk: 40_000, keluar: 350_000, dari: "2026-10-29", sampai: "2026-10-30" });
    expect(r.body.perKategori).toEqual([{ kategoriId: expect.any(String), kategoriNama: "Makan", nominal: 350_000 }]);
    expect((await budi.get("/transaksi/label/ringkasan")).status).toBe(400);
  });
});
