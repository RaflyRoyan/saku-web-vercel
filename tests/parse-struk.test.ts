import { describe, it, expect } from "vitest";
import { parseStruk } from "../src/lib/parseStruk";

describe("parseStruk", () => {
  it("struk restoran: PB1 + service, subtotal/total/bayar dibuang dari item", () => {
    const teks = `BAKMI GM
Jl. Pemuda 12 Surabaya
Meja 7   Kasir: Rina
2 Bakmi Ayam         70.000
1 Pangsit Goreng     28,000
Es Teh Manis x3      Rp24.000
Kerupuk                5000
Sub Total           127.000
Service 5%            6.350
PB1 10%              13.335
Total               146.685
Tunai               150.000
Kembali               3.315
Terima kasih`;
    expect(parseStruk(teks)).toEqual({
      items: [
        { nama: "Bakmi Ayam", qty: 2, harga: 70_000 },
        { nama: "Pangsit Goreng", qty: 1, harga: 28_000 },
        { nama: "Es Teh Manis", qty: 3, harga: 24_000 },
        { nama: "Kerupuk", qty: 1, harga: 5_000 },
      ],
      pajak: 13_335,
      servis: 6_350,
      diskon: 0,
      total: 146_685,
    });
  });

  it("struk minimarket: qty '2 x', diskon negatif, desimal ,00, angka kecil dibuang", () => {
    const teks = `INDOMARET
AQUA 600ML  2 x 3.500     7.000,00
ROTI TAWAR                15.500,00
DISC ROTI                 -2.000,00
PPN                        1.500
HARGA JUAL                22.000
QRIS                      22.000
NO 12`;
    expect(parseStruk(teks)).toEqual({
      items: [
        { nama: "AQUA 600ML", qty: 2, harga: 7_000 },
        { nama: "ROTI TAWAR", qty: 1, harga: 15_500 },
      ],
      pajak: 1_500,
      servis: 0,
      diskon: 2_000,
      total: 22_000,
    });
  });

  it("teks kosong / tanpa angka → item kosong", () => {
    expect(parseStruk("")).toEqual({ items: [], pajak: 0, servis: 0, diskon: 0, total: null });
    expect(parseStruk("Terima kasih\natas kunjungan").items).toEqual([]);
  });
});
