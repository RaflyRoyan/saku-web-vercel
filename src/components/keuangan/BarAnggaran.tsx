import { WARNA_STATUS, type PosAnggaran } from "../../hooks/useAnggaran";
import { formatRupiah } from "../../lib/format";

/** Progress bar terpakai/anggaran; lebih dari 100% tetap penuh dengan warna "lewat". */
export function BarAnggaran({ p, tipis }: { p: PosAnggaran; tipis?: boolean }) {
  if (p.anggaran === null || p.status === null) return null;
  return (
    <span
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.min(p.persen ?? 0, 100)}
      aria-valuetext={`${p.persen}% terpakai`}
      className={`block overflow-hidden rounded-full bg-stone-100 ${tipis ? "h-1.5" : "h-2.5"}`}
    >
      <span className={`block h-full rounded-full ${WARNA_STATUS[p.status].bar}`} style={{ width: `${Math.min(p.persen ?? 0, 100)}%` }} />
    </span>
  );
}

/** "Sisa Rp X · 45%" / "Terlewati Rp X · 120%" / "Tanpa anggaran". */
export function SisaAnggaran({ p, className = "" }: { p: PosAnggaran; className?: string }) {
  if (p.anggaran === null || p.status === null || p.sisa === null) return <span className={`text-stone-500 ${className}`}>Tanpa anggaran</span>;
  const w = WARNA_STATUS[p.status];
  return (
    <span className={`${w.teks} ${className}`}>
      {p.sisa < 0 ? `Terlewati ${formatRupiah(-p.sisa)}` : `Sisa ${formatRupiah(p.sisa)}`} · {p.persen}%
    </span>
  );
}
