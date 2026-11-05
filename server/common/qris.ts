// Validasi QRIS (EMV QR Code Merchant-Presented). Versi browser ada di src/lib/qris.ts (plus pembuat QRIS dinamis);
// keduanya diuji dengan vektor yang sama di tests/qris.test.ts.

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
