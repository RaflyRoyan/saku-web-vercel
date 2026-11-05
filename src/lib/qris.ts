// QRIS di browser: validasi + ubah QRIS statis jadi dinamis bernominal (tag 54).
// Logika validasi sama dengan server/common/qris.ts; keduanya diuji di tests/qris.test.ts.

const PESAN = "Kode ini bukan QRIS. Pastikan QR dari GoPay Merchant/QRIS atas namamu.";

export type HasilQris = { ok: true; payload: string; merchant: string; kota: string } | { ok: false; pesan: string };

/** CRC16-CCITT-FALSE (poly 0x1021, init 0xFFFF), 4 digit hex huruf besar. */
export function crc16(s: string): string {
  let crc = 0xffff;
  for (let i = 0; i < s.length; i++) {
    crc ^= s.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/** TLV EMV → daftar [tag, nilai]; null kalau rusak/terpotong. */
function tlv(s: string): [string, string][] | null {
  const out: [string, string][] = [];
  let i = 0;
  while (i < s.length) {
    const id = s.slice(i, i + 2);
    const len = Number(s.slice(i + 2, i + 4));
    if (!/^\d{2}$/.test(id) || !/^\d{2}$/.test(s.slice(i + 2, i + 4)) || i + 4 + len > s.length) return null;
    out.push([id, s.slice(i + 4, i + 4 + len)]);
    i += 4 + len;
  }
  return out;
}

const gabung = (tags: [string, string][]) => tags.map(([t, v]) => `${t}${String(v.length).padStart(2, "0")}${v}`).join("");

export function parseQris(input: string): HasilQris {
  const gagal = { ok: false as const, pesan: PESAN };
  const payload = input.trim();
  const tags = tlv(payload);
  if (!tags || tags.length < 3) return gagal;
  const get = (id: string) => tags.find(([t]) => t === id)?.[1];
  const last = tags[tags.length - 1];
  if (get("00") !== "01" || !get("01") || get("58") !== "ID" || last[0] !== "63" || last[1].length !== 4) return gagal;
  if (crc16(payload.slice(0, -4)) !== last[1].toUpperCase()) return gagal;
  // Merchant account information (tag 26–51) harus memuat penanda QRIS nasional
  const qris = tags.some(([t, v]) => Number(t) >= 26 && Number(t) <= 51 && v.toUpperCase().includes("ID.CO.QRIS"));
  if (!qris) return gagal;
  return { ok: true, payload, merchant: get("59") ?? "", kota: get("60") ?? "" };
}

/**
 * QRIS dinamis: tag 01 = "12", tag 54 = nominal (rupiah bulat) disisipkan sebelum tag 58, CRC dihitung ulang.
 * Yang scan tidak perlu mengetik nominal. Payload harus sudah lolos `parseQris`.
 */
export function qrisDinamis(payload: string, nominal: number): string {
  const tags = tlv(payload.trim());
  if (!tags) throw new Error("Payload QRIS rusak.");
  const isi = tags.filter(([t]) => t !== "54" && t !== "63").map(([t, v]): [string, string] => (t === "01" ? [t, "12"] : [t, v]));
  const i58 = isi.findIndex(([t]) => t === "58");
  isi.splice(i58 < 0 ? isi.length : i58, 0, ["54", String(Math.round(nominal))]);
  const body = `${gabung(isi)}6304`;
  return body + crc16(body);
}
