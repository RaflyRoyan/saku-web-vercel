import { Link } from "react-router-dom";
import { AlarmClock, ChevronRight, PiggyBank, Receipt, Settings } from "lucide-react";
import { AkunIcon } from "../components/keuangan/AkunIcon";
import { KartuAnggaran } from "../components/keuangan/KartuAnggaran";
import { KomposisiKategori } from "../components/keuangan/KomposisiKategori";
import { LanggananAksi } from "../components/keuangan/LanggananAksi";
import { PeriodeKosong } from "../components/keuangan/PeriodeKosong";
import { TransaksiItem } from "../components/keuangan/TransaksiItem";
import { fokus } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { EmptyState, ErrorState, ListSkeleton, Skeleton } from "../components/ui/States";
import { useMe } from "../hooks/useAuth";
import { useDashboard, type Pengingat } from "../hooks/useBerulang";
import { formatPeriode, formatRupiah, formatRupiahRingkas, formatTanggal } from "../lib/format";

function Judul({ title, to, link }: { title: string; to: string; link: string }) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <h2 className="font-bold">{title}</h2>
      <Link to={to} className={`flex items-center text-sm font-semibold text-brand-700 ${fokus}`}>
        {link}
        <ChevronRight className="size-4" aria-hidden />
      </Link>
    </div>
  );
}

function sisaLabel(p: Pengingat) {
  if (p.status === "hari_ini") return "hari ini";
  if (p.status === "terlambat") return `terlambat ${-p.sisaHari} hari`;
  return `${p.sisaHari} hari lagi`;
}

/** Beranda (02 §6.2): satu request `GET /api/dashboard`. */
export default function DashboardPage() {
  const { data: me } = useMe();
  const dash = useDashboard();
  const r = dash.data?.ringkasan;

  const sapa = (
    <header className="mb-4 flex items-start justify-between gap-3 pt-2">
      <div className="min-w-0">
        <h1 className="truncate text-xl font-bold">Halo, {me?.nama ?? ""}</h1>
        {r && <p className="truncate text-sm text-stone-500">{formatPeriode(r.periode)}</p>}
      </div>
      <Link to="/pengaturan" aria-label="Pengaturan" className={`flex size-11 items-center justify-center rounded-xl text-stone-500 hover:bg-brand-50 lg:hidden ${fokus}`}>
        <Settings className="size-5" aria-hidden />
      </Link>
    </header>
  );

  if (dash.isPending) {
    return (
      <>
        {sapa}
        <Skeleton className="mb-4 h-40" />
        <ListSkeleton />
      </>
    );
  }
  if (dash.isError) return <ErrorState error={dash.error} onRetry={() => dash.refetch()} />;

  const { pengingat, totalTabungan, transaksiTerakhir, anggaran } = dash.data;
  const kartuTabungan = (
    <Link to="/tabungan" className={`flex items-center gap-3 rounded-2xl border border-yellow-200 bg-yellow-50 p-4 hover:bg-yellow-100 ${fokus}`}>
      <PiggyBank className="size-6 text-tabungan" aria-hidden />
      <span className="flex-1 font-semibold text-stone-700">Tabungan</span>
      <span className={`font-bold tabular-nums ${totalTabungan < 0 ? "text-keluar" : ""}`}>{formatRupiah(totalTabungan)}</span>
      <ChevronRight className="size-4 text-stone-400" aria-hidden />
    </Link>
  );

  if (!r) {
    return (
      <>
        {sapa}
        <div className="flex flex-col gap-6">
          <PeriodeKosong />
          {totalTabungan !== 0 && kartuTabungan}
        </div>
      </>
    );
  }

  return (
    <>
      {sapa}
      <div className="flex flex-col gap-6">
        <div className="bg-sunrise rounded-2xl p-5 text-white shadow-lg shadow-rose-900/20">
          <p className="text-sm text-white/80">Total saldo</p>
          <p className="text-3xl font-extrabold tabular-nums">{formatRupiah(r.totalSaldoAkhir)}</p>
          <div className="mt-4 flex items-end justify-between gap-3">
            <div>
              <p className="text-sm text-white/80">Keluar periode ini</p>
              <p className="text-lg font-bold tabular-nums">{formatRupiah(r.totalPengeluaran)}</p>
            </div>
            <Link to="/akun" className={`flex items-center rounded-lg text-sm font-semibold text-white ${fokus} focus-visible:ring-white`}>
              Detail
              <ChevronRight className="size-4" aria-hidden />
            </Link>
          </div>
        </div>

        <KartuAnggaran data={anggaran} />

        {pengingat.length > 0 && (
          <section aria-labelledby="pengingat">
            <h2 id="pengingat" className="mb-2 flex items-center gap-2 font-bold">
              <AlarmClock className="size-5 text-brand-600" aria-hidden />
              Pengingat langganan
            </h2>
            <div className="flex flex-col gap-3">
              {pengingat.map((p) => (
                <Card key={`${p.berulangId}-${p.bulan}`} className="flex flex-col gap-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0">
                      <span className="block truncate font-semibold">{p.berulang.nama}</span>
                      <span className={`text-sm ${p.status === "terlambat" ? "font-semibold text-keluar" : "text-stone-500"}`}>
                        {formatTanggal(p.jatuhTempo)} · {sisaLabel(p)}
                      </span>
                    </p>
                    <span className="shrink-0 font-bold tabular-nums">{formatRupiah(p.berulang.nominal)}</span>
                  </div>
                  <div className="flex justify-end">
                    <LanggananAksi b={p.berulang} bulan={p.bulan} />
                  </div>
                </Card>
              ))}
            </div>
          </section>
        )}

        {r.perAkun.length === 0 ? (
          <Card className="p-4 text-sm text-stone-700">
            Belum ada akun. Tambahkan dulu di{" "}
            <Link to="/master" className="font-semibold text-brand-700 underline">
              Master
            </Link>
            .
          </Card>
        ) : (
          <section>
            <Judul title="Saldo per akun" to="/akun" link="Lihat" />
            <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
              {r.perAkun.map((a) => (
                <Link
                  key={a.akunId}
                  to={`/akun/${a.akunId}`}
                  className={`flex w-32 shrink-0 flex-col gap-1 rounded-2xl border border-garis bg-white p-3 shadow-sm hover:bg-brand-50 ${fokus}`}
                >
                  <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-stone-700">
                    <AkunIcon jenis={a.jenis} className="size-4 shrink-0 text-brand-600" />
                    <span className="truncate">{a.nama}</span>
                  </span>
                  <span className={`font-bold tabular-nums ${a.saldoAkhir < 0 ? "text-keluar" : ""}`}>{formatRupiahRingkas(a.saldoAkhir)}</span>
                </Link>
              ))}
            </div>
          </section>
        )}

        <section>
          <h2 className="mb-2 font-bold">Pengeluaran per kategori</h2>
          <Card className="p-4">
            <KomposisiKategori items={r.pengeluaranPerKelompok} periodeId={r.periode.id} />
          </Card>
        </section>

        {kartuTabungan}

        <section>
          <Judul title="Transaksi terakhir" to="/riwayat" link="Semua" />
          {transaksiTerakhir.length === 0 ? (
            <EmptyState
              icon={Receipt}
              title="Belum ada transaksi di periode ini."
              action={
                <Link to="/transaksi/baru" className={`font-semibold text-brand-700 ${fokus}`}>
                  Catat transaksi
                </Link>
              }
            />
          ) : (
            <div className="divide-y divide-garis overflow-hidden rounded-2xl border border-garis bg-white shadow-sm">
              {transaksiTerakhir.map((t) => (
                <TransaksiItem key={t.id} t={t} />
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
