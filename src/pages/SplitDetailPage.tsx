import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Pencil, Share2, Trash2 } from "lucide-react";
import { Button, fokus } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { ErrorState, ListSkeleton } from "../components/ui/States";
import { hapusSplit, setLunas, splitKeys, useSplit, type Split, type SplitPeserta } from "../hooks/useSplit";
import { useToast } from "../hooks/useToast";
import { invalidateKeuangan } from "../hooks/useTransaksi";
import { ApiError } from "../lib/api";
import { formatRupiah, formatTanggalPanjang } from "../lib/format";
import { TombolBagikan } from "../components/split/TombolBagikan";

function Baris({ label, nilai, tebal }: { label: string; nilai: string; tebal?: boolean }) {
  return (
    <div className={`flex justify-between gap-2 ${tebal ? "text-base font-bold" : "text-sm"}`}>
      <span className={tebal ? "" : "text-stone-500"}>{label}</span>
      <span className={tebal ? "" : "font-semibold"}>{nilai}</span>
    </div>
  );
}

function Peserta({ split, p }: { split: Split; p: SplitPeserta }) {
  const qc = useQueryClient();
  const toast = useToast();
  const lunas = useMutation({
    mutationFn: (v: boolean) => setLunas(split.id, p.id, v),
    onSuccess: (res, v) => {
      qc.setQueryData(splitKeys.detail(split.id), res);
      invalidateKeuangan(qc);
      toast.show(v ? `${p.nama} lunas, tercatat sebagai pemasukan` : `${p.nama} ditandai belum bayar`);
    },
    onError: (e) => toast.show(e instanceof ApiError ? e.title : "Gagal menyimpan.", "error"),
  });

  return (
    <div className="flex min-h-16 items-center gap-3 px-4 py-2">
      {p.saya ? (
        <span className="flex size-11 items-center justify-center text-stone-300" aria-hidden>
          <Check className="size-5" />
        </span>
      ) : (
        <button
          type="button"
          role="checkbox"
          aria-checked={p.lunas}
          aria-label={`${p.nama} sudah bayar`}
          disabled={lunas.isPending}
          onClick={() => lunas.mutate(!p.lunas)}
          className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${fokus}`}
        >
          <span className={`flex size-6 items-center justify-center rounded-md border-2 ${p.lunas ? "border-masuk bg-masuk text-white" : "border-stone-300 bg-white"} ${lunas.isPending ? "opacity-50" : ""}`}>
            {p.lunas && <Check className="size-4" aria-hidden />}
          </span>
        </button>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">
          {p.nama}
          {p.saya && <span className="font-normal text-stone-400"> (kamu)</span>}
        </p>
        <p className={`text-sm ${p.saya ? "text-stone-500" : p.lunas ? "text-masuk" : "text-amber-700"}`}>
          {formatRupiah(p.nominal)} · {p.saya ? "bagianmu" : p.lunas ? "sudah bayar" : "belum bayar"}
        </p>
      </div>
      {!p.saya && !p.lunas && <TombolBagikan split={split} peserta={p} />}
    </div>
  );
}

export default function SplitDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useSplit(id);
  const [hapus, setHapus] = useState(false);
  const hapusMut = useMutation({
    mutationFn: () => hapusSplit(id!),
    onSuccess: () => {
      invalidateKeuangan(qc);
      toast.show("Split bill dihapus");
      navigate("/split", { replace: true });
    },
    onError: (e) => toast.show(e instanceof ApiError ? e.title : "Gagal menghapus.", "error"),
  });

  if (q.isPending) return <ListSkeleton rows={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const s = q.data;
  const biaya = s.pajak + s.servis;

  return (
    <div className="flex flex-col gap-5">
      <header className="sticky top-0 z-10 -mx-4 flex min-h-14 items-center gap-2 border-b border-garis bg-white px-2 lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:px-0">
        <Link to="/split" aria-label="Kembali" className={`flex size-11 items-center justify-center rounded-xl text-stone-500 hover:bg-brand-50 ${fokus}`}>
          <ArrowLeft className="size-5" aria-hidden />
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-xl font-bold">{s.nama}</h1>
        <Link to={`/split/${s.id}/ubah`} aria-label="Ubah" className={`flex size-11 items-center justify-center rounded-xl text-stone-500 hover:bg-brand-50 ${fokus}`}>
          <Pencil className="size-5" aria-hidden />
        </Link>
        <Button variant="danger" onClick={() => setHapus(true)} aria-label="Hapus">
          <Trash2 className="size-5" aria-hidden />
        </Button>
      </header>

      <Card className="flex flex-col gap-1 p-4">
        <p className="mb-1 text-sm text-stone-500">
          {formatTanggalPanjang(s.tanggal)} · dibayar dari {s.akunNama} · {s.kategoriNama}
        </p>
        {s.items.map((it) => (
          <Baris key={it.id} label={`${it.qty > 1 ? `${it.qty}× ` : ""}${it.nama}`} nilai={formatRupiah(it.harga)} />
        ))}
        <div className="my-1 border-t border-garis" />
        <Baris label="Subtotal" nilai={formatRupiah(s.subtotal)} />
        {s.pajak > 0 && <Baris label="Pajak" nilai={formatRupiah(s.pajak)} />}
        {s.servis > 0 && <Baris label="Servis" nilai={formatRupiah(s.servis)} />}
        {s.diskon > 0 && <Baris label="Diskon" nilai={`−${formatRupiah(s.diskon)}`} />}
        <Baris label="Total" nilai={formatRupiah(s.total)} tebal />
        {biaya > 0 && <p className="mt-1 text-xs text-stone-400">Pajak, servis & diskon dibagi sebanding dengan pesanan tiap orang.</p>}
      </Card>

      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between px-1">
          <h2 className="text-sm font-bold text-stone-500">Tagihan</h2>
          <p className="text-sm text-stone-500">
            {s.belumLunas.jumlah > 0 ? `${s.belumLunas.jumlah} belum bayar · ${formatRupiah(s.belumLunas.nominal)}` : "Lunas semua"}
          </p>
        </div>
        <Card className="divide-y divide-garis overflow-hidden">
          {s.peserta.map((p) => (
            <Peserta key={p.id} split={s} p={p} />
          ))}
        </Card>
        <p className="flex items-center gap-1.5 px-1 text-xs text-stone-500">
          <Share2 className="size-3.5" aria-hidden /> Bayaran masuk ke {s.akunTerimaNama}. Centang setelah teman bayar.
        </p>
      </section>

      <ConfirmDialog open={hapus} title="Hapus split bill?" confirmLabel="Hapus" danger loading={hapusMut.isPending} onConfirm={() => hapusMut.mutate()} onClose={() => setHapus(false)}>
        Transaksi pengeluaran {formatRupiah(s.total)} dan semua pemasukan dari teman yang sudah bayar ikut terhapus.
      </ConfirmDialog>
    </div>
  );
}
