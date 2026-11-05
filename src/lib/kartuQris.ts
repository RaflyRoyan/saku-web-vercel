import { formatRupiah } from "./format";
import { qrisDinamis } from "./qris";

const WARNA = { brand: "#c2410c", teks: "#1c1917", abu: "#78716c", latar: "#fffaf5" };
const FONT = '"Manrope Variable", system-ui, sans-serif';
const LEBAR = 1080;
const QR = 640;

/** Gambar QRIS di canvas (ukuran piksel `ukuran`). Dipakai untuk tampilan layar & kartu. */
export async function gambarQris(canvas: HTMLCanvasElement, payload: string, nominal: number, ukuran: number) {
  const { default: QRCode } = await import("qrcode");
  await QRCode.toCanvas(canvas, qrisDinamis(payload, nominal), { width: ukuran, margin: 2, errorCorrectionLevel: "M" });
  // qrcode memasang ukuran inline; biarkan CSS (aspect-square, lebar responsif) yang mengatur tampilan
  canvas.style.removeProperty("width");
  canvas.style.removeProperty("height");
}

/** Kartu PNG "Terima QRIS": nominal, keterangan, QR bernominal, nama merchant. */
export async function buatKartuQris(opts: { payload: string; merchant: string; nominal: number; keterangan: string }): Promise<Blob> {
  await document.fonts.load(`700 40px ${FONT}`).catch(() => undefined);
  const tinggi = 1250 + (opts.keterangan ? 70 : 0);
  const canvas = document.createElement("canvas");
  canvas.width = LEBAR;
  canvas.height = tinggi;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas tidak didukung.");
  ctx.fillStyle = WARNA.latar;
  ctx.fillRect(0, 0, LEBAR, tinggi);
  ctx.fillStyle = WARNA.brand;
  ctx.fillRect(0, 0, LEBAR, 16);

  const teks = (s: string, y: number, size: number, bold = false, color = WARNA.teks) => {
    ctx.font = `${bold ? 700 : 500} ${size}px ${FONT}`;
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    let t = s;
    while (t.length > 1 && ctx.measureText(t).width > LEBAR - 144) t = t.slice(0, -2) + "…";
    ctx.fillText(t, LEBAR / 2, y);
  };

  let y = 130;
  teks("Bayar dengan QRIS", y, 40, true, WARNA.abu);
  y += 110;
  teks(formatRupiah(opts.nominal), y, 88, true, WARNA.brand);
  if (opts.keterangan) {
    y += 70;
    teks(opts.keterangan, y, 34);
  }
  y += 60;
  const qr = document.createElement("canvas");
  await gambarQris(qr, opts.payload, opts.nominal, QR);
  const x = (LEBAR - QR) / 2;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x - 12, y - 12, QR + 24, QR + 24);
  ctx.drawImage(qr, x, y, QR, QR);
  y += QR + 90;
  teks(opts.merchant || "QRIS", y, 36, true);
  y += 56;
  teks("Nominal sudah terisi otomatis.", y, 28, false, WARNA.abu);
  y += 90;
  teks("Simpan gambar ini, lalu bayar lewat Scan QR → Galeri di aplikasi e-wallet.", y, 26, false, WARNA.abu);

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Gagal membuat gambar."))), "image/png"));
}
