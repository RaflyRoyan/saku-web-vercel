import { Link } from "react-router-dom";
import { ChevronRight, ReceiptText } from "lucide-react";
import { useSplitList } from "../../hooks/useSplit";
import { formatRupiah } from "../../lib/format";
import { fokus } from "../ui/Button";

/** Beranda: pengingat teman yang belum bayar split bill. Tidak tampil kalau semua lunas. */
export function KartuSplit() {
  const q = useSplitList();
  const jumlah = (q.data ?? []).reduce((a, s) => a + s.belumLunas.jumlah, 0);
  if (!jumlah) return null;
  const nominal = (q.data ?? []).reduce((a, s) => a + s.belumLunas.nominal, 0);

  return (
    <Link to="/split" className={`flex items-center gap-3 rounded-2xl border border-garis bg-white p-4 shadow-sm hover:bg-brand-50 ${fokus}`}>
      <ReceiptText className="size-6 shrink-0 text-brand-600" aria-hidden />
      <span className="flex-1">
        <span className="block font-semibold">Split bill</span>
        <span className="text-sm text-stone-500">
          {jumlah} orang belum bayar · {formatRupiah(nominal)}
        </span>
      </span>
      <ChevronRight className="size-4 text-stone-400" aria-hidden />
    </Link>
  );
}
