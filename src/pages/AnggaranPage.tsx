import { useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChevronDown, PencilLine, Target, TriangleAlert } from "lucide-react";
import { BarAnggaran, SisaAnggaran } from "../components/keuangan/BarAnggaran";
import { PeriodeKosong } from "../components/keuangan/PeriodeKosong";
import { PeriodeSelect } from "../components/keuangan/PeriodeSelect";
import { Button, fokus } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { FormError } from "../components/ui/FormError";
import { MoneyInput } from "../components/ui/MoneyInput";
import { EmptyState, ErrorState, ListSkeleton } from "../components/ui/States";
import {
  anggaranKey,
  simpanAnggaran,
  useAnggaran,
  type AnggaranPeriode,
  type ItemAnggaran,
} from "../hooks/useAnggaran";
import { useKategori, useKelompokKategori } from "../hooks/useMaster";
import { usePeriodeList, usePeriodeTerpilih } from "../hooks/usePeriode";
import { useToast } from "../hooks/useToast";
import { invalidateKeuangan } from "../hooks/useTransaksi";
import { ApiError } from "../lib/api";
import { formatPeriode, formatRupiah } from "../lib/format";

function Ringkas({ data }: { data: AnggaranPeriode }) {
  const t = data.total;
  return (
    <Card className="flex flex-col gap-2 p-4">
      <p className="text-sm text-stone-500">Terpakai</p>
      <p className="text-2xl font-extrabold tabular-nums">
        {formatRupiah(t.terpakai)}
        <span className="text-base font-semibold text-stone-500"> dari {formatRupiah(t.anggaran ?? 0)}</span>
      </p>
      <BarAnggaran p={t} />
      <SisaAnggaran p={t} className="text-sm font-semibold" />
    </Card>
  );
}

function Daftar({ data, periodeId }: { data: AnggaranPeriode; periodeId: string }) {
  const [buka, setBuka] = useState<string | null>(null);
  return (
    <ul className="flex flex-col gap-3">
      {data.kelompok.map((g) => {
        const terbuka = buka === g.kelompokId;
        return (
          <li key={g.kelompokId}>
            <Card className="overflow-hidden">
              <button
                type="button"
                aria-expanded={terbuka}
                onClick={() => setBuka(terbuka ? null : g.kelompokId)}
                className={`flex w-full flex-col gap-2 p-4 text-left hover:bg-brand-50 ${fokus}`}
              >
                <span className="flex items-center gap-2">
                  {g.status === "lewat" && <TriangleAlert className="size-4 shrink-0 text-keluar" aria-label="Terlewati" />}
                  <span className="min-w-0 flex-1 truncate font-semibold">{g.nama}</span>
                  <span className="text-sm tabular-nums">
                    <span className="font-bold">{formatRupiah(g.terpakai)}</span>
                    {g.anggaran !== null && <span className="text-stone-500"> / {formatRupiah(g.anggaran)}</span>}
                  </span>
                  <ChevronDown aria-hidden className={`size-4 shrink-0 text-stone-400 transition-transform ${terbuka ? "rotate-180" : ""}`} />
                </span>
                <BarAnggaran p={g} />
                <span className="flex justify-between gap-2 text-sm">
                  <SisaAnggaran p={g} />
                  {g.anggaran !== null && g.anggaranSendiri === null && <span className="text-stone-400">dari jumlah sub</span>}
                </span>
              </button>
              {terbuka && (
                <ul className="flex flex-col border-t border-garis bg-stone-50/50 px-4 py-2">
                  {g.sub.length === 0 && <li className="py-2 text-sm text-stone-500">Belum ada pengeluaran.</li>}
                  {g.sub.map((s) => (
                    <li key={s.kategoriId}>
                      <Link
                        to={`/riwayat?periode=${periodeId}&kategoriId=${s.kategoriId}`}
                        className={`flex flex-col gap-1.5 rounded-lg py-2 text-sm hover:bg-brand-50 ${fokus}`}
                      >
                        <span className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-stone-700">{s.nama}</span>
                          <span className="tabular-nums">
                            {formatRupiah(s.terpakai)}
                            {s.anggaran !== null && <span className="text-stone-500"> / {formatRupiah(s.anggaran)}</span>}
                          </span>
                        </span>
                        <BarAnggaran p={s} tipis />
                        {s.anggaran !== null && <SisaAnggaran p={s} className="text-xs" />}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

const kunciG = (id: string) => `g:${id}`;
const kunciK = (id: string) => `k:${id}`;

/** Isi batas per kategori induk (opsional) & per sub kategori. Kosong / 0 = tidak dianggarkan. */
function FormAnggaran({ data, periodeId, onSelesai }: { data: AnggaranPeriode; periodeId: string; onSelesai: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const kelompok = useKelompokKategori();
  const kategori = useKategori();
  const [nilai, setNilai] = useState<Record<string, number | null>>(() => {
    const awal: Record<string, number | null> = {};
    for (const g of data.kelompok) {
      if (g.anggaranSendiri !== null) awal[kunciG(g.kelompokId)] = g.anggaranSendiri;
      for (const s of g.sub) if (s.anggaran !== null) awal[kunciK(s.kategoriId)] = s.anggaran;
    }
    return awal;
  });
  const [buka, setBuka] = useState<Set<string>>(() => new Set(data.kelompok.filter((g) => g.sub.some((s) => s.anggaran !== null)).map((g) => g.kelompokId)));

  // Urutan item yang dikirim = urutan kunci, untuk memetakan error `items.N.*` kembali ke input
  const kirim = Object.entries(nilai)
    .filter(([, v]) => v)
    .map(([k, v]): ItemAnggaran => (k.startsWith("g:") ? { kelompokId: k.slice(2), nominal: v ?? 0 } : { kategoriId: k.slice(2), nominal: v ?? 0 }));
  const kunciKirim = Object.entries(nilai)
    .filter(([, v]) => v)
    .map(([k]) => k);

  const simpan = useMutation({
    mutationFn: () => simpanAnggaran(periodeId, kirim),
    onSuccess: (hasil) => {
      qc.setQueryData(anggaranKey(periodeId), hasil);
      invalidateKeuangan(qc);
      toast.show("Anggaran disimpan");
      onSelesai();
    },
  });
  const err = simpan.error instanceof ApiError ? simpan.error : null;
  const errorDi = (k: string) => {
    const i = kunciKirim.indexOf(k);
    if (i < 0 || !err?.errors) return undefined;
    const pesan = [...(err.errors[`items.${i}`] ?? []), ...(err.errors[`items.${i}.nominal`] ?? []), ...(err.errors[`items.${i}.kategoriId`] ?? []), ...(err.errors[`items.${i}.kelompokId`] ?? [])];
    return pesan.length ? pesan : undefined;
  };

  if (kelompok.isPending || kategori.isPending) return <ListSkeleton rows={4} />;
  if (kelompok.isError) return <ErrorState error={kelompok.error} onRetry={() => kelompok.refetch()} />;
  if (kategori.isError) return <ErrorState error={kategori.error} onRetry={() => kategori.refetch()} />;

  // Sub kategori aktif + sub lama yang sudah punya anggaran (mis. sudah dinonaktifkan)
  const subPer = new Map<string, { id: string; nama: string }[]>();
  for (const k of kategori.data.filter((k) => k.tipe === "keluar")) {
    const g = k.kelompokId ?? "LAINNYA";
    subPer.set(g, [...(subPer.get(g) ?? []), { id: k.id, nama: k.nama }]);
  }
  for (const g of data.kelompok)
    for (const s of g.sub)
      if (s.anggaran !== null && !subPer.get(g.kelompokId)?.some((x) => x.id === s.kategoriId))
        subPer.set(g.kelompokId, [...(subPer.get(g.kelompokId) ?? []), { id: s.kategoriId, nama: s.nama }]);

  const total = kelompok.data.reduce((n, g) => {
    const sub = (subPer.get(g.id) ?? []).reduce((m, s) => m + (nilai[kunciK(s.id)] ?? 0), 0);
    return n + (nilai[kunciG(g.id)] || sub);
  }, 0);

  return (
    <form
      noValidate
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        simpan.mutate();
      }}
    >
      <p className="rounded-xl bg-brand-50 px-3 py-2 text-sm text-stone-700">
        Isi batas kategori, sub kategori, atau keduanya. Kalau batas kategori dikosongkan, batasnya = jumlah sub kategori.
      </p>
      {kelompok.data.map((g) => {
        const subs = subPer.get(g.id) ?? [];
        const jumlahSub = subs.reduce((n, s) => n + (nilai[kunciK(s.id)] ?? 0), 0);
        const batas = nilai[kunciG(g.id)] ?? null;
        const terbuka = buka.has(g.id);
        const lebih = batas !== null && batas > 0 && jumlahSub > batas;
        return (
          <Card key={g.id} className="flex flex-col gap-3 p-4">
            <MoneyInput
              label={g.nama}
              value={batas}
              onChange={(v) => setNilai((n) => ({ ...n, [kunciG(g.id)]: v }))}
              hint={jumlahSub > 0 && !lebih ? `Jumlah sub kategori ${formatRupiah(jumlahSub)}` : undefined}
              error={lebih ? `Jumlah sub kategori ${formatRupiah(jumlahSub)} melebihi batas kategori.` : errorDi(kunciG(g.id))}
            />
            {subs.length > 0 && (
              <button
                type="button"
                aria-expanded={terbuka}
                onClick={() =>
                  setBuka((b) => {
                    const next = new Set(b);
                    if (terbuka) next.delete(g.id);
                    else next.add(g.id);
                    return next;
                  })
                }
                className={`flex min-h-11 items-center justify-between rounded-lg text-sm font-semibold text-brand-700 ${fokus}`}
              >
                Sub kategori ({subs.length})
                <ChevronDown aria-hidden className={`size-4 transition-transform ${terbuka ? "rotate-180" : ""}`} />
              </button>
            )}
            {terbuka && (
              <div className="flex flex-col gap-2 border-l border-garis pl-3">
                {subs.map((s) => (
                  <div key={s.id} className="flex items-center gap-3">
                    <span className="w-28 shrink-0 truncate text-sm text-stone-700">{s.nama}</span>
                    <div className="flex-1 [&_label]:sr-only">
                      <MoneyInput
                        label={`Anggaran ${s.nama}`}
                        value={nilai[kunciK(s.id)] ?? null}
                        onChange={(v) => setNilai((n) => ({ ...n, [kunciK(s.id)]: v }))}
                        error={errorDi(kunciK(s.id))}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        );
      })}
      <div className="sticky bottom-20 z-10 flex flex-col gap-2 rounded-2xl border border-garis bg-white p-3 shadow-lg lg:bottom-4">
        <p className="flex justify-between text-sm font-semibold">
          <span>Total anggaran</span>
          <span className="tabular-nums">{formatRupiah(total)}</span>
        </p>
        {!err?.errors && <FormError error={simpan.error} />}
        {err?.errors && <p className="text-sm text-keluar">Periksa isian yang ditandai merah.</p>}
        <div className="flex gap-2">
          <Button variant="secondary" block onClick={onSelesai} disabled={simpan.isPending}>
            Batal
          </Button>
          <Button type="submit" block loading={simpan.isPending}>
            Simpan
          </Button>
        </div>
      </div>
    </form>
  );
}

/** Anggaran per periode: batas per kategori induk & sub kategori vs pengeluaran. Dibuka dari kartu Anggaran di Beranda. */
export default function AnggaranPage() {
  const [params, setParams] = useSearchParams();
  const { aktif, periodeId } = usePeriodeTerpilih(params.get("periode"));
  const periodeList = usePeriodeList();
  const anggaran = useAnggaran(periodeId);
  const [ubah, setUbah] = useState(false);
  const periode = periodeList.data?.find((p) => p.id === periodeId);

  const header = (
    <header className="sticky top-0 z-10 -mx-4 mb-4 flex min-h-14 items-center gap-2 border-b border-garis bg-white px-2 lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:px-0">
      <Link to="/" aria-label="Kembali ke Beranda" className={`flex size-11 items-center justify-center rounded-xl text-stone-500 hover:bg-brand-50 ${fokus}`}>
        <ArrowLeft className="size-5" aria-hidden />
      </Link>
      <h1 className="flex-1 truncate text-xl font-bold">{ubah ? "Atur anggaran" : "Anggaran"}</h1>
      {periodeId && !ubah && <PeriodeSelect value={periodeId} onChange={(p) => setParams(p === aktif.data?.id ? {} : { periode: p })} />}
    </header>
  );

  let isi: ReactNode;
  if (aktif.isPending || (periodeId && anggaran.isPending)) isi = <ListSkeleton rows={4} />;
  else if (aktif.isError) isi = <ErrorState error={aktif.error} onRetry={() => aktif.refetch()} />;
  else if (!periodeId) isi = <PeriodeKosong />;
  else if (anggaran.isError) isi = <ErrorState error={anggaran.error} onRetry={() => anggaran.refetch()} />;
  else {
    const data = anggaran.data!;
    isi = ubah ? (
      <FormAnggaran data={data} periodeId={periodeId} onSelesai={() => setUbah(false)} />
    ) : (
      <div className="flex flex-col gap-4">
        {periode && <p className="-mt-2 text-sm text-stone-500">{formatPeriode(periode)}</p>}
        {data.ada ? (
          <>
            <Ringkas data={data} />
            <Daftar data={data} periodeId={periodeId} />
          </>
        ) : (
          <EmptyState icon={Target} title="Belum ada anggaran di periode ini." />
        )}
        <Button variant={data.ada ? "secondary" : "primary"} block onClick={() => setUbah(true)}>
          <PencilLine className="size-4" aria-hidden />
          {data.ada ? "Ubah anggaran" : "Atur anggaran"}
        </Button>
      </div>
    );
  }

  return (
    <>
      {header}
      {isi}
    </>
  );
}
