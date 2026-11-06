import { Link } from "react-router-dom";
import { ChevronRight, QrCode } from "lucide-react";
import { useTagihanQris } from "../../hooks/useTagihanQris";
import { formatRupiah } from "../../lib/format";
import { fokus } from "../ui/Button";

/** Beranda: tagihan QRIS yang belum dibayar. Tidak tampil kalau tidak ada. */
export function KartuTagihanQris() {
  const q = useTagihanQris();
  const menunggu = (q.data ?? []).filter((t) => !t.lunas);
  if (!menunggu.length) return null;

  return (
    <Link to="/qris" className={`flex items-center gap-3 rounded-2xl border border-garis bg-white p-4 shadow-sm hover:bg-brand-50 ${fokus}`}>
      <QrCode className="size-6 shrink-0 text-brand-600" aria-hidden />
      <span className="flex-1">
        <span className="block font-semibold">Tagihan QRIS</span>
        <span className="text-sm text-stone-500">
          {menunggu.length} belum dibayar · {formatRupiah(menunggu.reduce((a, t) => a + t.nominal, 0))}
        </span>
      </span>
      <ChevronRight className="size-4 text-stone-400" aria-hidden />
    </Link>
  );
}
