import { describe, it, expect } from "vitest";
import { PostgresStore } from "../server/db/store";
import { tabelDb } from "../server/db/schema";
import { barisDari, sqlTest } from "./helpers";

const store = () => new PostgresStore(sqlTest);

async function duaPengguna(s: PostgresStore) {
  await s.append("Pengguna", [
    barisDari("Pengguna", ["US-a", "a", "hash", "A", "user", true]),
    barisDari("Pengguna", ["US-b", "b", "hash", "B", "user", true]),
  ]);
}

describe("PostgresStore", () => {
  it("nilai kembali dalam bentuk Baris: teks kosong \"\", angka number, tanggal yyyy-MM-dd, datetime WIB", async () => {
    const s = store();
    await duaPengguna(s);
    await s.append("Transaksi", [
      {
        ...barisDari("Transaksi", ["TR-1", "US-a", "PR-1", "2026-10-31", "keluar", "AK-1", "", "KT-1", 15_000.5, 0, "Makan"]),
        created_by: "US-a",
        created_at: "2026-10-31T23:30:00+07:00",
      },
    ]);
    const [t] = (await s.read(["Transaksi"])).Transaksi;
    expect(t.data).toMatchObject({
      tanggal: "2026-10-31",
      nominal: 15_000.5,
      biaya_admin: 0,
      akun_tujuan_id: "",
      berulang_id: "",
      label: "",
      created_at: "2026-10-31T23:30:00+07:00",
      updated_at: null,
    });
    // Teks kosong disimpan sebagai NULL
    const [raw] = await sqlTest`select akun_tujuan_id from transaksi where id = 'TR-1'`;
    expect(raw.akun_tujuan_id).toBeNull();
  });

  it("userId hanya membaca baris milik pengguna itu; master & Pengguna tetap utuh", async () => {
    const s = store();
    await duaPengguna(s);
    await s.append("Akun", [barisDari("Akun", ["AK-1", "BCA", "bank", 1, true])]);
    await s.append("Periode", [barisDari("Periode", ["PR-a", "US-a", "A"]), barisDari("Periode", ["PR-b", "US-b", "B"])]);
    const milikA = await s.read(["Periode", "Akun", "Pengguna"], { userId: "US-a" });
    expect(milikA.Periode.map((r) => r.data.id)).toEqual(["PR-a"]);
    expect(milikA.Akun).toHaveLength(1);
    expect(milikA.Pengguna).toHaveLength(2);
    expect((await s.read(["Periode"])).Periode).toHaveLength(2);
  });

  it("urutan baca = urutan insert, update/hapus berdasarkan id", async () => {
    const s = store();
    await s.append("Kategori", ["KT-c", "KT-a", "KT-b"].map((id) => barisDari("Kategori", [id, id, "keluar"])));
    const awal = (await s.read(["Kategori"])).Kategori;
    expect(awal.map((r) => r.data.id)).toEqual(["KT-c", "KT-a", "KT-b"]);

    await s.updateRow("Kategori", { ...awal[1].data, nama: "Diubah" });
    await s.deleteRows([{ tabel: "Kategori", id: "KT-c" }, { tabel: "Kategori", id: "KT-b" }]);
    const akhir = (await s.read(["Kategori"])).Kategori;
    expect(akhir.map((r) => [r.data.id, r.data.nama])).toEqual([["KT-a", "Diubah"]]);
  });

  it("batch gagal di tengah → tidak ada yang tertulis, error jadi 502", async () => {
    const s = store();
    const dobel = barisDari("Akun", ["AK-x", "X"]);
    await expect(
      s.batch([
        { jenis: "insert", tabel: "Kategori", baris: [barisDari("Kategori", ["KT-1", "Makan", "keluar"])] },
        { jenis: "insert", tabel: "Akun", baris: [dobel, dobel] },
      ]),
    ).rejects.toMatchObject({ status: 502 });
    const [{ n }] = await sqlTest`select count(*)::int as n from ${sqlTest(tabelDb("Kategori"))}`;
    expect(n).toBe(0);
  });

  it("kolomTabel memuat semua tabel aplikasi", async () => {
    const kolom = await store().kolomTabel();
    expect(kolom.akun_pengguna).toEqual(expect.arrayContaining(["id", "user_id", "akun_id", "urutan", "no"]));
  });
});
