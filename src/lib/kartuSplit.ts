import type { Split } from "../hooks/useSplit";
import { formatRupiah, formatTanggalPanjang } from "./format";
import { qrisDinamis } from "./qris";

// Warna tema Sunrise (src/index.css)
const WARNA = { brand: "#c2410c", brandMuda: "#fff7ed", garis: "#f3e3d3", teks: "#1c1917", abu: "#78716c", latar: "#fffaf5" };
const FONT = '"Manrope Variable", system-ui, sans-serif';
const LEBAR = 1080;
const PAD = 72;

const PECAHAN: Record<number, string> = { 2: "½", 3: "⅓", 4: "¼", 5: "⅕" };

/** Rincian tagihan satu peserta: porsi item + selisih pajak/servis/diskon (sama dengan hitungan server). */
export function rincianPeserta(split: Split, pesertaId: string) {
  const p = split.peserta.find((x) => x.id === pesertaId);
  if (!p) throw new Error("Peserta tidak ditemukan.");
  const items = split.items
    .filter((it) => it.peserta.includes(pesertaId))
    .map((it) => {
      const n = it.peserta.length;
      return { nama: `${it.qty > 1 ? `${it.qty}× ` : ""}${it.nama}${n > 1 ? ` (${PECAHAN[n] ?? `1/${n}`})` : ""}`, porsi: Math.round(it.harga / n) };
    });
  const selisih = p.nominal - items.reduce((a, it) => a + it.porsi, 0);
  return { peserta: p, items, selisih };
}

function potong(ctx: CanvasRenderingContext2D, teks: string, maks: number): string {
  if (ctx.measureText(teks).width <= maks) return teks;
  let s = teks;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maks) s = s.slice(0, -1);
  return `${s}…`;
}

/** Gambar kartu tagihan (PNG) untuk dibagikan ke WhatsApp: rincian + QRIS bernominal. */
export async function buatKartu(opts: { split: Split; pesertaId: string; qris: { payload: string; merchant: string } | null }): Promise<Blob> {
  const { split, pesertaId, qris } = opts;
  const { peserta, items, selisih } = rincianPeserta(split, pesertaId);
  await Promise.all([document.fonts.load(`700 40px ${FONT}`), document.fonts.load(`500 32px ${FONT}`)]).catch(() => undefined);

  const QR = 600;
  const barisItem = items.length + (selisih !== 0 ? 1 : 0);
  const tinggi = PAD + 250 + barisItem * 56 + 150 + (qris ? QR + 170 : 200) + 120 + PAD;
  const canvas = document.createElement("canvas");
  canvas.width = LEBAR;
  canvas.height = tinggi;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas tidak didukung.");

  ctx.fillStyle = WARNA.latar;
  ctx.fillRect(0, 0, LEBAR, tinggi);
  ctx.fillStyle = WARNA.brand;
  ctx.fillRect(0, 0, LEBAR, 16);

  let y = PAD + 40;
  const teks = (s: string, x: number, size: number, opt: { bold?: boolean; color?: string; align?: CanvasTextAlign; maks?: number } = {}) => {
    ctx.font = `${opt.bold ? 700 : 500} ${size}px ${FONT}`;
    ctx.fillStyle = opt.color ?? WARNA.teks;
    ctx.textAlign = opt.align ?? "left";
    ctx.fillText(opt.maks ? potong(ctx, s, opt.maks) : s, x, y);
  };

  teks(split.nama, PAD, 52, { bold: true, maks: LEBAR - PAD * 2 });
  y += 52;
  teks(formatTanggalPanjang(split.tanggal), PAD, 30, { color: WARNA.abu });
  y += 80;
  teks(`Tagihan untuk ${peserta.nama}`, PAD, 36, { bold: true, color: WARNA.brand, maks: LEBAR - PAD * 2 });
  y += 30;
  ctx.fillStyle = WARNA.garis;
  ctx.fillRect(PAD, y, LEBAR - PAD * 2, 3);
  y += 64;

  for (const it of items) {
    teks(it.nama, PAD, 32, { maks: LEBAR - PAD * 2 - 260 });
    teks(formatRupiah(it.porsi), LEBAR - PAD, 32, { align: "right" });
    y += 56;
  }
  if (selisih !== 0) {
    teks(selisih > 0 ? "Pajak & servis" : "Diskon", PAD, 32, { color: WARNA.abu });
    teks(selisih > 0 ? formatRupiah(selisih) : `−${formatRupiah(-selisih)}`, LEBAR - PAD, 32, { align: "right", color: WARNA.abu });
    y += 56;
  }
  y -= 20;
  ctx.fillStyle = WARNA.garis;
  ctx.fillRect(PAD, y, LEBAR - PAD * 2, 3);
  y += 80;
  teks("Total", PAD, 44, { bold: true });
  teks(formatRupiah(peserta.nominal), LEBAR - PAD, 56, { bold: true, align: "right", color: WARNA.brand });
  y += 70;

  if (qris) {
    const { default: QRCode } = await import("qrcode");
    const qr = document.createElement("canvas");
    await QRCode.toCanvas(qr, qrisDinamis(qris.payload, peserta.nominal), { width: QR, margin: 2, errorCorrectionLevel: "M" });
    const x = (LEBAR - QR) / 2;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x - 12, y - 12, QR + 24, QR + 24);
    ctx.drawImage(qr, x, y, QR, QR);
    y += QR + 70;
    teks(`QRIS · ${qris.merchant}`, LEBAR / 2, 32, { bold: true, align: "center", maks: LEBAR - PAD * 2 });
    y += 50;
    teks("Nominal sudah terisi otomatis.", LEBAR / 2, 28, { color: WARNA.abu, align: "center" });
  } else {
    ctx.fillStyle = WARNA.brandMuda;
    ctx.fillRect(PAD, y, LEBAR - PAD * 2, 140);
    y += 82;
    teks("Transfer sesuai total di atas", LEBAR / 2, 34, { bold: true, align: "center" });
    y += 58;
  }
  y += 70;
  teks(qris ? "Simpan gambar ini, lalu bayar lewat Scan QR → Galeri di aplikasi e-wallet." : "Terima kasih!", LEBAR / 2, 26, { color: WARNA.abu, align: "center", maks: LEBAR - PAD * 2 });

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Gagal membuat gambar."))), "image/png"));
}
