import { Link, useSearchParams } from "react-router-dom";
import { CreditCard } from "lucide-react";
import PageHeader from "../components/layout/PageHeader";
import { AkunIcon } from "../components/keuangan/AkunIcon";
import { SaldoText } from "../components/keuangan/AmountText";
import { PeriodeKosong } from "../components/keuangan/PeriodeKosong";
import { PeriodeSelect } from "../components/keuangan/PeriodeSelect";
import { fokus } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { EmptyState, ErrorState, ListSkeleton } from "../components/ui/States";
import { usePeriodeTerpilih, useRingkasan, type RingkasanAkun } from "../hooks/usePeriode";
import { formatAngka, formatPeriode, formatRupiah } from "../lib/format";

const bertanda = (n: number) => (n > 0 ? `+${formatAngka(n)}` : n < 0 ? `−${formatAngka(-n)}` : "0");

/** Rincian saldo awal → saldo akhir satu akun (dipakai juga di Detail Akun). */
export function RincianAkun({ a }: { a: RingkasanAkun }) {
  const transferNet = a.transferMasuk - a.transferKeluar;
  const sisa = a.saldoAwal > 0 ? Math.max(0, Math.min(100, Math.round((a.saldoAkhir / a.saldoAwal) * 100))) : null;
  const baris: [string, string, string?][] = [
    ["Saldo awal", formatAngka(a.saldoAwal)],
    ["Masuk", bertanda(a.masuk), a.masuk ? "text-masuk" : undefined],
    ["Keluar", bertanda(-a.keluar), a.keluar ? "text-keluar" : undefined],
    ["Biaya admin", bertanda(-a.biayaAdmin), a.biayaAdmin ? "text-keluar" : undefined],
  ];
  if (a.ditabung) baris.push(["Ditabung", bertanda(-a.ditabung), "text-tabungan"]);
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <dl className="flex flex-col gap-1">
        {baris.map(([label, nilai, cls]) => (
          <div key={label} className="flex justify-between gap-3">
            <dt className="text-stone-500">{label}</dt>
            <dd className={`font-semibold tabular-nums ${cls ?? ""}`}>{nilai}</dd>
          </div>
        ))}
      </dl>
      <details className="group">
        <summary className={`flex cursor-pointer list-none justify-between gap-3 rounded ${fokus}`}>
          <span className="text-stone-500">
            Transfer <span aria-hidden className="text-xs text-stone-400 group-open:hidden">▸</span>
            <span aria-hidden className="hidden text-xs text-stone-400 group-open:inline">▾</span>
          </span>
          <span className="font-semibold tabular-nums text-transfer">{bertanda(transferNet)}</span>
        </summary>
        <dl className="mt-1 flex flex-col gap-1 border-l-2 border-violet-100 pl-3">
          <div className="flex justify-between">
            <dt className="text-stone-500">Transfer masuk</dt>
            <dd className="tabular-nums">{bertanda(a.transferMasuk)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-stone-500">Transfer keluar</dt>
            <dd className="tabular-nums">{bertanda(-a.transferKeluar)}</dd>
          </div>
        </dl>
      </details>
      {sisa !== null && (
        <div className="mt-1 flex items-center gap-2">
          <div
            role="meter"
            aria-label="Sisa dari saldo awal"
            aria-valuenow={sisa}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-2 flex-1 overflow-hidden rounded-full bg-brand-100"
          >
            <div className="h-full rounded-full bg-brand-500" style={{ width: `${sisa}%` }} />
          </div>
          <span className="w-16 text-right text-xs text-stone-500">{sisa}% sisa</span>
        </div>
      )}
    </div>
  );
}

export default function AkunPage() {
  const [params, setParams] = useSearchParams();
  const { aktif, periodeId } = usePeriodeTerpilih(params.get("periode"));
  const ringkasan = useRingkasan(periodeId);

  const header = (
    <PageHeader
      title="Akun"
      action={periodeId && <PeriodeSelect value={periodeId} onChange={(id) => setParams(id === aktif.data?.id ? {} : { periode: id })} />}
    />
  );

  if (aktif.isPending || (periodeId && ringkasan.isPending)) {
    return (
      <>
        {header}
        <ListSkeleton rows={4} />
      </>
    );
  }
  if (aktif.isError) return <ErrorState error={aktif.error} onRetry={() => aktif.refetch()} />;
  if (!periodeId) {
    return (
      <>
        {header}
        <PeriodeKosong />
      </>
    );
  }
  if (ringkasan.isError) return <ErrorState error={ringkasan.error} onRetry={() => ringkasan.refetch()} />;

  const r = ringkasan.data!;
  const query = params.get("periode") ? `?periode=${r.periode.id}` : "";
  return (
    <>
      {header}
      <p className="mb-1 text-sm text-stone-500">{formatPeriode(r.periode)}</p>
      <p className="mb-4 text-lg">
        <span className="text-stone-500">Total </span>
        <SaldoText saldo={r.totalSaldoAkhir} className="text-2xl" />
      </p>

      {r.perAkun.length === 0 ? (
        <EmptyState icon={CreditCard} title="Belum ada akun. Admin bisa menambahkan akun di Master." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {r.perAkun.map((a) => (
            <Card key={a.akunId} className="flex flex-col gap-3 p-4">
              <Link to={`/akun/${a.akunId}${query}`} className={`-m-1 flex flex-col gap-1 rounded-xl p-1 hover:bg-brand-50 ${fokus}`}>
                <span className="flex items-center gap-2 font-semibold text-stone-700">
                  <AkunIcon jenis={a.jenis} className="size-5 text-brand-600" />
                  {a.nama}
                  {!a.aktif && <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500">Nonaktif</span>}
                </span>
                <SaldoText saldo={a.saldoAkhir} className="text-2xl" />
              </Link>
              <hr className="border-garis" />
              <RincianAkun a={a} />
            </Card>
          ))}
        </div>
      )}
      {r.setorTabungan.length > 0 && (
        <p className="mt-4 text-sm text-stone-500">
          Sisa periode ini masuk tabungan: {formatRupiah(r.setorTabungan.reduce((n, s) => n + s.nominal, 0))}
        </p>
      )}
    </>
  );
}
