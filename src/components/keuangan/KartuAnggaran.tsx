import { Link } from "react-router-dom";
import { ChevronRight, Target, TriangleAlert } from "lucide-react";
import type { AnggaranPeriode, PosAnggaran } from "../../hooks/useAnggaran";
import { formatRupiah } from "../../lib/format";
import { BarAnggaran, SisaAnggaran } from "./BarAnggaran";
import { fokus } from "../ui/Button";

/** Beranda: total anggaran periode aktif + maks 3 pos yang paling mendekati / melewati batas. Tap → halaman Anggaran. */
export function KartuAnggaran({ data }: { data: AnggaranPeriode | null }) {
  const kelas = `flex flex-col gap-3 rounded-2xl border border-garis bg-white p-4 shadow-sm hover:bg-brand-50 ${fokus}`;
  if (!data?.ada) {
    return (
      <Link to="/anggaran" className={`${kelas} flex-row items-center`}>
        <Target className="size-6 shrink-0 text-brand-600" aria-hidden />
        <span className="flex-1">
          <span className="block font-semibold">Anggaran</span>
          <span className="text-sm text-stone-500">Atur batas pengeluaran periode ini.</span>
        </span>
        <ChevronRight className="size-4 text-stone-400" aria-hidden />
      </Link>
    );
  }

  // Sub kategori & kategori induk yang punya batas, persen terbesar dulu
  const pos: (PosAnggaran & { id: string; nama: string })[] = [];
  for (const g of data.kelompok) {
    if (g.anggaranSendiri !== null) pos.push({ ...g, id: `g:${g.kelompokId}` });
    for (const s of g.sub) if (s.anggaran !== null) pos.push({ ...s, id: `k:${s.kategoriId}` });
  }
  const teratas = pos.sort((a, b) => (b.persen ?? 0) - (a.persen ?? 0)).slice(0, 3);
  const lewat = pos.filter((p) => p.status === "lewat").length;
  const t = data.total;

  return (
    <Link to="/anggaran" className={kelas}>
      <span className="flex items-center gap-2">
        <Target className="size-5 text-brand-600" aria-hidden />
        <span className="flex-1 font-bold">Anggaran</span>
        <ChevronRight className="size-4 text-stone-400" aria-hidden />
      </span>
      {lewat > 0 && (
        <span role="alert" className="flex items-center gap-2 rounded-xl bg-rose-50 px-3 py-2 text-sm font-semibold text-keluar">
          <TriangleAlert className="size-4 shrink-0" aria-hidden />
          {lewat} anggaran sudah terlewati
        </span>
      )}
      <span className="flex items-baseline justify-between gap-2 text-sm">
        <span className="text-stone-500">Terpakai</span>
        <span className="tabular-nums">
          <span className="font-bold">{formatRupiah(t.terpakai)}</span>
          <span className="text-stone-500"> / {formatRupiah(t.anggaran ?? 0)}</span>
        </span>
      </span>
      <BarAnggaran p={t} />
      {teratas.length > 0 && (
        <span className="flex flex-col gap-2.5 border-t border-garis pt-3">
          {teratas.map((p) => (
            <span key={p.id} className="flex flex-col gap-1 text-sm">
              <span className="flex justify-between gap-2">
                <span className="truncate font-medium text-stone-700">{p.nama}</span>
                <SisaAnggaran p={p} className="shrink-0 tabular-nums" />
              </span>
              <BarAnggaran p={p} tipis />
            </span>
          ))}
        </span>
      )}
    </Link>
  );
}
