import { Tag } from "lucide-react";
import { useRingkasanLabel } from "../../hooks/useTransaksi";
import { formatRupiah, formatTanggal } from "../../lib/format";
import { Card } from "../ui/Card";
import { Skeleton } from "../ui/States";

/** Riwayat difilter label: total keluar/masuk lintas periode + rincian keluar per kategori. */
export function KartuRingkasanLabel({ label }: { label: string }) {
  const q = useRingkasanLabel(label);
  if (q.isPending) return <Skeleton className="mb-4 h-32" />;
  if (q.isError || q.data.jumlah === 0) return null;
  const r = q.data;
  const maks = Math.max(...r.perKategori.map((k) => k.nominal), 1);

  return (
    <Card className="mb-4 flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <Tag className="size-5 shrink-0 text-brand-600" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold">{r.label}</p>
          <p className="text-sm text-stone-500">
            {r.jumlah} transaksi
            {r.dari && ` · ${formatTanggal(r.dari)}${r.sampai && r.sampai !== r.dari ? ` – ${formatTanggal(r.sampai)}` : ""}`}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-sm text-stone-500">Keluar</p>
          <p className="text-lg font-bold text-keluar tabular-nums">{formatRupiah(r.keluar)}</p>
        </div>
        <div>
          <p className="text-sm text-stone-500">Masuk</p>
          <p className="text-lg font-bold text-masuk tabular-nums">{formatRupiah(r.masuk)}</p>
        </div>
      </div>
      {r.perKategori.length > 0 && (
        <ul className="flex flex-col gap-2 border-t border-garis pt-3" aria-label="Pengeluaran per kategori">
          {r.perKategori.map((k) => (
            <li key={k.kategoriId} className="flex flex-col gap-1">
              <div className="flex justify-between gap-2 text-sm">
                <span className="truncate">{k.kategoriNama}</span>
                <span className="shrink-0 font-semibold tabular-nums">{formatRupiah(k.nominal)}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-stone-100" aria-hidden>
                <div className="h-full rounded-full bg-keluar" style={{ width: `${(k.nominal / maks) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-stone-400">Transfer tidak dihitung.</p>
    </Card>
  );
}
