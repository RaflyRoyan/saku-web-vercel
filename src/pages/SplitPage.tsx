import { Link } from "react-router-dom";
import { ChevronRight, Plus, ReceiptText } from "lucide-react";
import PageHeader from "../components/layout/PageHeader";
import { fokus } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { EmptyState, ErrorState, ListSkeleton } from "../components/ui/States";
import { useSplitList } from "../hooks/useSplit";
import { formatRupiah, formatTanggal } from "../lib/format";

const tombolBaru = `inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand-700 px-4 text-sm font-semibold text-white hover:bg-brand-800 ${fokus}`;

export default function SplitPage() {
  const q = useSplitList();

  return (
    <>
      <PageHeader
        title="Split Bill"
        action={
          <Link to="/split/baru" className={tombolBaru}>
            <Plus className="size-5" aria-hidden /> Split baru
          </Link>
        }
      />
      {q.isPending ? (
        <ListSkeleton rows={3} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState icon={ReceiptText} title="Belum ada split bill. Foto struk, bagi ke teman, kirim QRIS lewat WhatsApp." />
      ) : (
        <Card className="divide-y divide-garis overflow-hidden">
          {q.data.map((s) => (
            <Link key={s.id} to={`/split/${s.id}`} className={`flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-brand-50 ${fokus}`}>
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold">{s.nama}</p>
                <p className="text-sm text-stone-500">
                  {formatTanggal(s.tanggal)} · {s.jumlahPeserta} orang · {formatRupiah(s.total)}
                </p>
              </div>
              {s.belumLunas.jumlah > 0 ? (
                <span className="shrink-0 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">
                  {s.belumLunas.jumlah} belum · {formatRupiah(s.belumLunas.nominal)}
                </span>
              ) : (
                <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-masuk">Lunas semua</span>
              )}
              <ChevronRight className="size-5 shrink-0 text-stone-400" aria-hidden />
            </Link>
          ))}
        </Card>
      )}
    </>
  );
}
