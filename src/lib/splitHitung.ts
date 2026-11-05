// Pratinjau bagian split bill di browser. Duplikat server/services/split.ts `hitungBagian` (server tetap sumber kebenaran);
// keduanya diuji dengan kasus yang sama di tests/split-hitung.test.ts — ubah bersamaan.

type InputHitung = {
  items: readonly { harga: number; peserta: readonly number[] }[];
  pajak: number;
  servis: number;
  diskon: number;
};

export function hitungBagian(body: InputHitung, jumlahPeserta: number, indeksSaya: number): { subtotal: number; total: number; nominal: number[] } {
  const porsi = Array.from({ length: jumlahPeserta }, () => 0);
  let subtotal = 0;
  for (const it of body.items) {
    subtotal += it.harga;
    const pemilik = it.peserta.filter((p) => p >= 0 && p < jumlahPeserta);
    for (const p of pemilik) porsi[p] += it.harga / pemilik.length;
  }
  const total = subtotal + body.pajak + body.servis - body.diskon;
  const faktor = subtotal > 0 ? total / subtotal : 0;
  const nominal = porsi.map((x) => Math.round(x * faktor));
  const sisa = total - nominal.reduce((a, b) => a + b, 0);
  if (jumlahPeserta > 0) nominal[indeksSaya] += sisa;
  return { subtotal, total, nominal };
}
