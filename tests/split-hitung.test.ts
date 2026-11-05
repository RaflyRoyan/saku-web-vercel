import { describe, it, expect } from "vitest";
import { AppError } from "../server/common/errors";
import { cekSplit, hitungBagian as hitungServer, type SplitBody } from "../server/services/split";
import { hitungBagian as hitungBrowser } from "../src/lib/splitHitung";

const item = (harga: number, peserta: number[], nama = "Item") => ({ nama, qty: 1, harga, peserta });

describe.each([
  ["server", hitungServer],
  ["browser", hitungBrowser],
] as const)("hitungBagian (%s)", (_, hitungBagian) => {
  it("per item + pajak proporsional; sisa pembulatan ke saya", () => {
    const body = { items: [item(30_000, [0]), item(20_000, [1]), item(10_000, [0, 1, 2])], pajak: 6_000, servis: 0, diskon: 0 };
    expect(hitungBagian(body, 3, 0)).toEqual({ subtotal: 60_000, total: 66_000, nominal: [36_666, 25_667, 3_667] });
  });

  it("bagi rata 100.000 untuk 3 orang", () => {
    const body = { items: [item(100_000, [0, 1, 2])], pajak: 0, servis: 0, diskon: 0 };
    expect(hitungBagian(body, 3, 0)).toEqual({ subtotal: 100_000, total: 100_000, nominal: [33_334, 33_333, 33_333] });
  });

  it("diskon & servis dibagi proporsional", () => {
    const body = { items: [item(25_000, [0]), item(25_000, [1])], pajak: 0, servis: 0, diskon: 10_000 };
    expect(hitungBagian(body, 2, 0).nominal).toEqual([20_000, 20_000]);
    const servis = { items: [item(30_000, [0]), item(10_000, [1])], pajak: 4_000, servis: 2_000, diskon: 0 };
    expect(hitungBagian(servis, 2, 1)).toEqual({ subtotal: 40_000, total: 46_000, nominal: [34_500, 11_500] });
  });
});

const valid = (): SplitBody => ({
  nama: "Makan Bakmi",
  akunId: "AK1",
  kategoriId: "KT1",
  akunTerimaId: "AK2",
  pajak: 0,
  servis: 0,
  diskon: 0,
  peserta: [
    { nama: "Saya", saya: true },
    { nama: "Andi", saya: false },
  ],
  items: [item(20_000, [0]), item(15_000, [1])],
});

function errors(body: SplitBody): Record<string, string[]> {
  try {
    cekSplit(body);
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    return (e as AppError).errors ?? {};
  }
  return {};
}

describe("cekSplit", () => {
  it("body valid tidak melempar", () => {
    expect(() => cekSplit(valid())).not.toThrow();
  });

  it("aturan validasi → key error per field", () => {
    expect(Object.keys(errors({ ...valid(), items: [] }))).toEqual(["items"]);
    expect(errors({ ...valid(), items: [item(20_000, []), item(15_000, [1, 5]), item(1_000, [0, 0])] })).toMatchObject({
      "items.0.peserta": ["Pilih minimal 1 orang."],
      "items.1.peserta": ["Peserta tidak valid."],
      "items.2.peserta": ["Peserta tidak valid."],
    });
    expect(errors({ ...valid(), peserta: [{ nama: "Saya", saya: true }], items: [item(1_000, [0])] })).toMatchObject({ peserta: ["Minimal 2 orang."] });
    expect(errors({ ...valid(), peserta: [{ nama: "Saya", saya: false }, { nama: "Andi", saya: false }] })).toMatchObject({
      peserta: ["Harus ada tepat 1 peserta \"Saya\"."],
    });
    const dobel = { ...valid(), peserta: [...valid().peserta, { nama: "andi", saya: false }], items: [item(1_000, [0]), item(1_000, [1]), item(1_000, [2])] };
    expect(errors(dobel)).toMatchObject({ "peserta.2.nama": ["Nama andi dobel."] });
  });

  it("peserta tanpa item → 422 di nama peserta", () => {
    const body = { ...valid(), peserta: [...valid().peserta, { nama: "Budi", saya: false }] };
    expect(errors(body)).toEqual({ "peserta.2.nama": ["Budi belum punya item."] });
  });

  it("diskon melebihi subtotal", () => {
    expect(errors({ ...valid(), diskon: 35_000 })).toEqual({ diskon: ["Diskon melebihi subtotal."] });
  });
});
