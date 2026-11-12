import { describe, it, expect } from "vitest";
import {
  parseAngka,
  parseBoolean,
  parseBulan,
  parseDatetime,
  parseRows,
  parseTanggal,
  toRow,
} from "../scripts/sheets-lama/parse";
import { headerOf } from "../scripts/sheets-lama/schema";

describe("T16 · parser toleran", () => {
  it("tanggal serial number", () => {
    expect(parseTanggal(46324)).toBe("2026-10-29");
    expect(parseTanggal(46324.75)).toBe("2026-10-29"); // jam diabaikan
  });

  it("tanggal teks", () => {
    expect(parseTanggal("2026-10-29")).toBe("2026-10-29");
    expect(parseTanggal("29/10/2026")).toBe("2026-10-29");
    expect(parseTanggal("2/3/2026")).toBe("2026-03-02");
    expect(parseTanggal("2026-02-30")).toBeNull();
    expect(parseTanggal("")).toBeNull();
  });

  it("nominal teks", () => {
    expect(parseAngka("Rp 1.500.000")).toBe(1500000);
    expect(parseAngka("Rp1.500.000")).toBe(1500000);
    expect(parseAngka("1.500.000")).toBe(1500000);
    expect(parseAngka("-25.000")).toBe(-25000);
    expect(parseAngka("2.500,50")).toBe(2500.5);
    expect(parseAngka("6000000")).toBe(6000000);
    expect(parseAngka(2500)).toBe(2500);
    expect(parseAngka("")).toBeNull();
    expect(parseAngka("abc")).toBeNull();
  });

  it("boolean", () => {
    expect(parseBoolean("TRUE")).toBe(true);
    expect(parseBoolean("true")).toBe(true);
    expect(parseBoolean(true)).toBe(true);
    expect(parseBoolean("FALSE")).toBe(false);
    expect(parseBoolean("")).toBe(false);
  });

  it("bulan", () => {
    expect(parseBulan("2026-02")).toBe("2026-02");
    expect(parseBulan("2026-2")).toBe("2026-02");
    expect(parseBulan(46324)).toBe("2026-10");
    expect(parseBulan("2026-13")).toBeNull();
  });

  it("datetime", () => {
    expect(parseDatetime("2026-10-29T10:15:00+07:00")).toBe("2026-10-29T10:15:00+07:00");
    expect(parseDatetime("2026-10-29T03:15:00Z")).toBe("2026-10-29T10:15:00+07:00");
    expect(parseDatetime("2026-10-29 10:15")).toBe("2026-10-29T10:15:00+07:00");
    expect(parseDatetime(46324.5)).toBe("2026-10-29T12:00:00+07:00");
    expect(parseDatetime("")).toBeNull();
  });

  it("baris tanpa id dilewati dan kolom kosong di akhir tetap terbaca", () => {
    const rows = parseRows("Akun", {
      header: headerOf("Akun"),
      rows: [
        { row: 2, values: ["AK-aaaaaaaa", "BCA", "bank", "1", "TRUE"] },
        { row: 3, values: ["", "Yatim", "bank", 2, true] },
        { row: 4, values: ["AK-cccccccc", "GoPay", "ewallet", 3, false, "SYSTEM"] },
      ],
    });
    expect(rows.map((r) => r.row)).toEqual([2, 4]);
    expect(rows[0].data).toMatchObject({ nama: "BCA", urutan: 1, aktif: true, created_by: "" });
    expect(rows[1].data).toMatchObject({ aktif: false, created_by: "SYSTEM", created_at: null });
  });

  it("toRow menulis sesuai urutan kolom", () => {
    const [parsed] = parseRows("Akun", {
      header: headerOf("Akun"),
      rows: [{ row: 2, values: ["AK-aaaaaaaa", "BCA", "bank", 1, true] }],
    });
    expect(toRow("Akun", parsed.data)).toEqual(["AK-aaaaaaaa", "BCA", "bank", 1, true, "", "", "", ""]);
  });
});
