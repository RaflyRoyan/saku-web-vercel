import { describe, it, expect } from "vitest";
import * as server from "../server/common/qris";
import * as browser from "../src/lib/qris";

const PESAN = "Kode ini bukan QRIS. Pastikan QR dari GoPay Merchant/QRIS atas namamu.";

const tlv = (id: string, v: string) => `${id}${String(v.length).padStart(2, "0")}${v}`;

/** QRIS statis contoh (bukan milik siapa pun). */
function statis(merchantInfo = tlv("00", "ID.CO.QRIS.WWW") + tlv("01", "ID1023000000001")) {
  const body =
    tlv("00", "01") + tlv("01", "11") + tlv("26", merchantInfo) + tlv("52", "5812") + tlv("53", "360") + tlv("58", "ID") + tlv("59", "TOKO SAKU") + tlv("60", "SURABAYA") + "6304";
  return body + browser.crc16(body);
}

describe.each([
  ["server", server],
  ["browser", browser],
] as const)("QRIS (%s)", (_, lib) => {
  it("crc16 CCITT-FALSE", () => {
    expect(lib.crc16("123456789")).toBe("29B1");
  });

  it("payload statis valid → merchant & kota", () => {
    expect(lib.parseQris(statis())).toEqual({ ok: true, payload: statis(), merchant: "TOKO SAKU", kota: "SURABAYA" });
  });

  it("spasi/newline di ujung & CRC huruf kecil tetap valid", () => {
    const p = statis();
    expect(lib.parseQris(`${p}\n `)).toMatchObject({ ok: true, payload: p });
    expect(lib.parseQris(p.slice(0, -4) + p.slice(-4).toLowerCase())).toMatchObject({ ok: true });
  });

  it("CRC salah, bukan QRIS, atau TLV rusak → ditolak", () => {
    const p = statis();
    const crcSalah = p.slice(0, -4) + (p.slice(-4) === "0000" ? "0001" : "0000");
    expect(lib.parseQris(crcSalah)).toEqual({ ok: false, pesan: PESAN });
    expect(lib.parseQris(statis(tlv("00", "COM.GOJEK.PERSONAL")))).toEqual({ ok: false, pesan: PESAN });
    expect(lib.parseQris("halo dunia")).toEqual({ ok: false, pesan: PESAN });
    expect(lib.parseQris(p.slice(0, 30))).toEqual({ ok: false, pesan: PESAN });
  });
});

describe("qrisDinamis", () => {
  it("tag 01 = 12, tag 54 = nominal, CRC baru valid", () => {
    const d = browser.qrisDinamis(statis(), 25_000);
    expect(d).toContain("010212");
    expect(d).toContain("540525000");
    expect(d.indexOf("5405")).toBeLessThan(d.indexOf("5802ID"));
    expect(browser.parseQris(d)).toMatchObject({ ok: true, merchant: "TOKO SAKU" });
    expect(server.parseQris(d)).toMatchObject({ ok: true });
  });

  it("tag 54 lama diganti, bukan dobel", () => {
    const d = browser.qrisDinamis(browser.qrisDinamis(statis(), 1_000), 2_000);
    expect(d.match(/54\d{2}\d+?5802ID/g)).toHaveLength(1);
    expect(d).toContain("54042000");
    expect(d).not.toContain("54041000");
  });
});
