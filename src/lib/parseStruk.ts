// Ubah teks hasil OCR struk jadi draf item + pajak/servis/diskon/total. Heuristik: user tetap wajib mengecek.

export interface HasilStruk {
  items: { nama: string; qty: number; harga: number }[];
  pajak: number;
  servis: number;
  diskon: number;
  total: number | null;
}

const ANGKA = /(-?)\s*(?:rp\.?\s*)?(\d[\d.,]*\d|\d)(?!\s*%)/gi;

const LABEL: [RegExp, "abaikan" | "subtotal" | "total" | "pajak" | "servis" | "diskon"][] = [
  [/\b(tunai|cash|kembali(an)?|change|bayar|debit|kredit|qris|kartu|card|ovo|gopay|dana|shopeepay)\b/, "abaikan"],
  [/\bsub\s*-?\s*total\b/, "subtotal"],
  [/\b(pajak|tax|pb\s*1|pbi|ppn)\b/, "pajak"],
  [/\b(service|servis|svc|layanan)\b/, "servis"],
  [/\b(disc|diskon|discount|potongan|promo|hemat)\b/, "diskon"],
  [/\b(grand\s*total|total|jumlah|harga\s*jual)\b/, "total"],
];

/** `12.000`, `12,000`, `12000`, `12.000,00` → 12000. */
function keAngka(s: string): number {
  // Desimal sen (",00") dibuang; pemisah ribuan selalu 3 digit
  return Number(s.replace(/[.,]\d{2}$/, "").replace(/[.,]/g, "")) || 0;
}

export function parseStruk(teks: string): HasilStruk {
  const hasil: HasilStruk = { items: [], pajak: 0, servis: 0, diskon: 0, total: null };
  for (const baris of teks.split(/\r?\n/)) {
    const line = baris.trim();
    const cocok = [...line.matchAll(ANGKA)];
    const akhir = cocok[cocok.length - 1];
    if (!akhir) continue;
    const nilai = keAngka(akhir[2]);
    if (nilai < 100) continue;

    let nama = line.slice(0, akhir.index).trim();
    const label = LABEL.find(([re]) => re.test(nama.toLowerCase()))?.[1];
    if (label === "abaikan" || label === "subtotal") continue;
    if (label === "total") {
      hasil.total ??= nilai;
      continue;
    }
    if (label) {
      hasil[label] += nilai;
      continue;
    }

    // Qty: "2 x 3.500" di tengah, "x3" di akhir nama, atau "2 " di awal nama
    let qty = 1;
    nama = nama
      .replace(/\s(\d{1,3})\s*[xX@]\s*[\d.,]+\s*$/, (_, q: string) => {
        qty = Number(q);
        return "";
      })
      .replace(/\s[xX](\d{1,3})\s*$/, (_, q: string) => {
        qty = Number(q);
        return "";
      })
      .replace(/^(\d{1,3})\s*[xX]?\s+(?=\D)/, (_, q: string) => {
        qty = Number(q);
        return "";
      })
      .replace(/\s*(rp\.?)?\s*$/i, "")
      .trim();
    if (!/[a-zA-Z]/.test(nama)) continue;
    hasil.items.push({ nama, qty: Math.max(1, qty), harga: nilai });
  }
  return hasil;
}
