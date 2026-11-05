import { describe, it, expect } from "vitest";
import { rincianPeserta } from "../src/lib/kartuSplit";
import type { Split } from "../src/hooks/useSplit";

const split = {
  id: "SB1",
  nama: "Makan",
  tanggal: "2026-10-29",
  pajak: 6_000,
  servis: 0,
  diskon: 0,
  total: 66_000,
  items: [
    { id: "I1", nama: "Bakmi", qty: 2, harga: 30_000, peserta: ["P1"] },
    { id: "I2", nama: "Nasi", qty: 1, harga: 20_000, peserta: ["P2"] },
    { id: "I3", nama: "Kerupuk", qty: 1, harga: 10_000, peserta: ["P1", "P2", "P3"] },
  ],
  peserta: [
    { id: "P1", nama: "Saya", saya: true, nominal: 36_666, lunas: true, transaksiId: null },
    { id: "P2", nama: "Andi", saya: false, nominal: 25_667, lunas: false, transaksiId: null },
    { id: "P3", nama: "Budi", saya: false, nominal: 3_667, lunas: false, transaksiId: null },
  ],
} as unknown as Split;

describe("rincianPeserta", () => {
  it("porsi item (dengan pecahan) + selisih pajak = nominal", () => {
    expect(rincianPeserta(split, "P2")).toMatchObject({
      items: [
        { nama: "Nasi", porsi: 20_000 },
        { nama: "Kerupuk (⅓)", porsi: 3_333 },
      ],
      selisih: 2_334,
    });
    expect(rincianPeserta(split, "P1").items[0]).toEqual({ nama: "2× Bakmi", porsi: 30_000 });
  });
});
