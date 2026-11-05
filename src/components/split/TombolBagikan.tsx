import { useState } from "react";
import { Share2 } from "lucide-react";
import { Button } from "../ui/Button";
import { useQris, type Split, type SplitPeserta } from "../../hooks/useSplit";
import { useToast } from "../../hooks/useToast";
import { bagikanGambar } from "../../lib/bagikan";
import { formatRupiah } from "../../lib/format";
import { buatKartu } from "../../lib/kartuSplit";

/** Buat kartu tagihan (QRIS bernominal) untuk satu peserta lalu bagikan ke WhatsApp. */
export function TombolBagikan({ split, peserta }: { split: Split; peserta: SplitPeserta }) {
  const toast = useToast();
  const qris = useQris();
  const [sibuk, setSibuk] = useState(false);

  async function bagikan() {
    setSibuk(true);
    try {
      const blob = await buatKartu({ split, pesertaId: peserta.id, qris: qris.data ?? null });
      const slug = `${split.nama}-${peserta.nama}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const hasil = await bagikanGambar(blob, `tagihan-${slug}.png`, `Halo ${peserta.nama}, tagihan ${split.nama}: ${formatRupiah(peserta.nominal)}. Bayar lewat QRIS di gambar ya.`);
      if (hasil === "unduh") toast.show("Gambar tagihan diunduh, kirim lewat WhatsApp");
      if (!qris.data) toast.show("QRIS belum diatur di Pengaturan, kartu dibuat tanpa QR", "peringatan");
    } catch {
      toast.show("Gagal membuat gambar tagihan.", "error");
    } finally {
      setSibuk(false);
    }
  }

  return (
    <Button variant="secondary" loading={sibuk || qris.isPending} onClick={bagikan} aria-label={`Bagikan tagihan ${peserta.nama}`}>
      <Share2 className="size-4" aria-hidden /> Bagikan
    </Button>
  );
}
