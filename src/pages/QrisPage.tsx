import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight, CircleCheck, Clock, QrCode, Share2, Trash2, Undo2 } from "lucide-react";
import PageHeader from "../components/layout/PageHeader";
import { BottomSheet } from "../components/ui/BottomSheet";
import { Button, fokus } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { ChipPicker } from "../components/ui/ChipPicker";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { FormError } from "../components/ui/FormError";
import { Input } from "../components/ui/Input";
import { MoneyInput } from "../components/ui/MoneyInput";
import { ErrorState, ListSkeleton, Skeleton } from "../components/ui/States";
import { akunUntukForm, useAkun, useKategori } from "../hooks/useMaster";
import { useQris, type Qris } from "../hooks/useSplit";
import { buatTagihanQris, hapusTagihanQris, setLunasTagihanQris, tagihanQrisKey, useTagihanQris, type TagihanQris } from "../hooks/useTagihanQris";
import { useToast } from "../hooks/useToast";
import { invalidateKeuangan } from "../hooks/useTransaksi";
import { ApiError } from "../lib/api";
import { bagikanGambar } from "../lib/bagikan";
import { formatRupiah, formatTanggal, hariIni } from "../lib/format";
import { buatKartuQris, gambarQris } from "../lib/kartuQris";

const INGAT_KATEGORI = "saku.qris.kategori";
const JUMLAH_LUNAS = 5;

function bacaIngat(): string | null {
  try {
    return localStorage.getItem(INGAT_KATEGORI);
  } catch {
    return null;
  }
}

function ingat(kategoriId: string) {
  try {
    localStorage.setItem(INGAT_KATEGORI, kategoriId);
  } catch {
    // localStorage tidak tersedia: kategori tidak diingat
  }
}

const pesanError = (e: unknown, cadangan: string) => (e instanceof ApiError ? e.title : cadangan);

/** QR besar di layar untuk di-scan langsung dari HP pengguna. */
function LayarQr({ qris, nominal }: { qris: Qris; nominal: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [gagal, setGagal] = useState(false);
  useEffect(() => {
    if (ref.current) gambarQris(ref.current, qris.payload, nominal, 640).catch(() => setGagal(true));
  }, [qris.payload, nominal]);
  if (gagal) return <p className="text-sm text-keluar">QR gagal dibuat.</p>;
  return <canvas ref={ref} aria-label={`QRIS ${formatRupiah(nominal)}`} role="img" className="aspect-square w-full max-w-80 rounded-xl bg-white" />;
}

/** Form tagihan baru. Akun & kategori pemasukan dipilih sekarang, dipakai saat ditandai sudah dibayar. */
function FormBuat({ onDibuat }: { onDibuat: (t: TagihanQris) => void }) {
  const qc = useQueryClient();
  const akun = useAkun(true);
  const kategori = useKategori(true);
  const akunList = akunUntukForm(akun.data ?? []);
  const kategoriMasuk = (kategori.data ?? []).filter((k) => k.tipe === "masuk" && k.aktif && !k.kodeSistem);
  const [nominal, setNominal] = useState<number | null>(null);
  const [keterangan, setKeterangan] = useState("");
  const [akunId, setAkunId] = useState<string | null>(null);
  const [kategoriId, setKategoriId] = useState<string | null>(bacaIngat);

  // Default: akun GoPay (penerima QRIS) & kategori terakhir, selama pengguna belum memilih
  const akunPakai = akunId ?? akunList.find((a) => /gopay/i.test(a.nama))?.id ?? null;
  const kategoriPakai = kategoriMasuk.some((k) => k.id === kategoriId) ? kategoriId : null;

  const buat = useMutation({
    mutationFn: () => buatTagihanQris({ nominal: nominal ?? 0, keterangan: keterangan.trim(), akunId: akunPakai ?? "", kategoriId: kategoriPakai ?? "" }),
    onSuccess: (t) => {
      qc.setQueryData<TagihanQris[]>(tagihanQrisKey, (lama) => [t, ...(lama ?? [])]);
      qc.invalidateQueries({ queryKey: tagihanQrisKey });
      if (kategoriPakai) ingat(kategoriPakai);
      onDibuat(t);
    },
  });
  const fe = buat.error instanceof ApiError ? buat.error.errors : undefined;

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (nominal && nominal > 0) buat.mutate();
      }}
    >
      <MoneyInput label="Nominal" besar value={nominal} onChange={setNominal} error={fe?.nominal} />
      <Input label="Keterangan" value={keterangan} maxLength={100} placeholder="Opsional, mis. Kaos ukuran L" onChange={(e) => setKeterangan(e.target.value)} error={fe?.keterangan} />
      <ChipPicker label="Masuk ke akun" scroll value={akunPakai} options={akunList.map((a) => ({ value: a.id, label: a.nama }))} onChange={setAkunId} error={fe?.akunId} />
      <ChipPicker label="Kategori" value={kategoriPakai} options={kategoriMasuk.map((k) => ({ value: k.id, label: k.nama }))} onChange={setKategoriId} error={fe?.kategoriId} />
      {!fe && <FormError error={buat.error} />}
      <Button type="submit" loading={buat.isPending} disabled={!nominal || nominal <= 0}>
        <QrCode className="size-5" aria-hidden /> Buat QRIS
      </Button>
    </form>
  );
}

function Baris({ t, onPilih }: { t: TagihanQris; onPilih: () => void }) {
  return (
    <button type="button" onClick={onPilih} className={`flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left hover:bg-brand-50 ${fokus}`}>
      <div className="min-w-0 flex-1">
        <p className="truncate font-bold tabular-nums">{formatRupiah(t.nominal)}</p>
        <p className="truncate text-sm text-stone-500">
          {formatTanggal(t.tanggal)}
          {t.keterangan ? ` · ${t.keterangan}` : ""}
        </p>
      </div>
      {t.lunas ? (
        <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-masuk">Sudah dibayar</span>
      ) : (
        <span className="shrink-0 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">Menunggu</span>
      )}
      <ChevronRight className="size-5 shrink-0 text-stone-400" aria-hidden />
    </button>
  );
}

function Daftar({ list, onPilih }: { list: TagihanQris[]; onPilih: (id: string) => void }) {
  const menunggu = list.filter((t) => !t.lunas);
  const lunas = list.filter((t) => t.lunas).slice(0, JUMLAH_LUNAS);
  return (
    <>
      {menunggu.length > 0 && (
        <section className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between px-1">
            <h2 className="flex items-center gap-1.5 text-sm font-bold text-stone-500">
              <Clock className="size-4" aria-hidden /> Menunggu bayar
            </h2>
            <p className="text-sm text-stone-500">
              {menunggu.length} · {formatRupiah(menunggu.reduce((a, t) => a + t.nominal, 0))}
            </p>
          </div>
          <Card className="divide-y divide-garis overflow-hidden">
            {menunggu.map((t) => (
              <Baris key={t.id} t={t} onPilih={() => onPilih(t.id)} />
            ))}
          </Card>
        </section>
      )}
      {lunas.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="px-1 text-sm font-bold text-stone-500">Terakhir dibayar</h2>
          <Card className="divide-y divide-garis overflow-hidden">
            {lunas.map((t) => (
              <Baris key={t.id} t={t} onPilih={() => onPilih(t.id)} />
            ))}
          </Card>
        </section>
      )}
    </>
  );
}

/** QR satu tagihan + tindakan: sudah dibayar, bagikan, batalkan. */
function Detail({ qris, t, onKembali }: { qris: Qris; t: TagihanQris; onKembali: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [dibayar, setDibayar] = useState(false);
  const [hapus, setHapus] = useState(false);
  const [tanggal, setTanggal] = useState(hariIni());
  const [berbagi, setBerbagi] = useState(false);

  const lunas = useMutation({
    mutationFn: (v: boolean) => setLunasTagihanQris(t.id, v, v ? tanggal : undefined),
    onSuccess: (res, v) => {
      qc.setQueryData<TagihanQris[]>(tagihanQrisKey, (lama) => lama?.map((x) => (x.id === res.id ? res : x)));
      invalidateKeuangan(qc);
      setDibayar(false);
      toast.show(v ? `Pemasukan ${formatRupiah(t.nominal)} tercatat` : "Ditandai belum dibayar");
      if (v) onKembali();
    },
    onError: (e) => toast.show(pesanError(e, "Gagal menyimpan."), "error"),
  });
  const hapusMut = useMutation({
    mutationFn: () => hapusTagihanQris(t.id),
    onSuccess: () => {
      qc.setQueryData<TagihanQris[]>(tagihanQrisKey, (lama) => lama?.filter((x) => x.id !== t.id));
      invalidateKeuangan(qc);
      toast.show(t.lunas ? "Tagihan & pemasukannya dihapus" : "Tagihan dibatalkan");
      onKembali();
    },
    onError: (e) => toast.show(pesanError(e, "Gagal menghapus."), "error"),
  });

  async function bagikan() {
    setBerbagi(true);
    try {
      const blob = await buatKartuQris({ payload: qris.payload, merchant: qris.merchant, nominal: t.nominal, keterangan: t.keterangan });
      const teks = `Pembayaran${t.keterangan ? ` ${t.keterangan}` : ""}: ${formatRupiah(t.nominal)}. Bayar lewat QRIS di gambar ya.`;
      if ((await bagikanGambar(blob, `qris-${t.nominal}.png`, teks)) === "unduh") toast.show("Gambar QRIS diunduh");
    } catch {
      toast.show("Gagal membuat gambar QRIS.", "error");
    } finally {
      setBerbagi(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <button type="button" onClick={onKembali} className={`flex min-h-11 items-center gap-1 self-start rounded-xl px-2 text-sm font-semibold text-stone-600 hover:bg-brand-50 ${fokus}`}>
        <ArrowLeft className="size-5" aria-hidden /> Semua tagihan
      </button>
      <Card className="flex w-full flex-col items-center gap-3 p-5 text-center">
        <p className="text-sm font-semibold text-stone-500">{t.lunas ? "Sudah dibayar" : "Scan untuk membayar"}</p>
        <p className="text-3xl font-extrabold text-brand-700 tabular-nums">{formatRupiah(t.nominal)}</p>
        {t.keterangan && <p className="text-sm text-stone-700">{t.keterangan}</p>}
        {t.lunas ? <CircleCheck className="size-16 text-masuk" aria-hidden /> : <LayarQr qris={qris} nominal={t.nominal} />}
        {!t.lunas && <p className="font-bold">{qris.merchant || "QRIS"}</p>}
        <p className="text-xs text-stone-500">
          Dibuat {formatTanggal(t.tanggal)} · masuk ke {t.akunNama} · {t.kategoriNama}
        </p>
      </Card>
      {t.lunas ? (
        <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
          <Button variant="secondary" loading={lunas.isPending} onClick={() => lunas.mutate(false)}>
            <Undo2 className="size-5" aria-hidden /> Tandai belum dibayar
          </Button>
          <Button variant="ghost" onClick={() => setHapus(true)}>
            <Trash2 className="size-5" aria-hidden /> Hapus
          </Button>
        </div>
      ) : (
        <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-3">
          <Button onClick={() => setDibayar(true)}>
            <CircleCheck className="size-5" aria-hidden /> Sudah dibayar
          </Button>
          <Button variant="secondary" loading={berbagi} onClick={bagikan}>
            <Share2 className="size-5" aria-hidden /> Bagikan
          </Button>
          <Button variant="ghost" onClick={() => setHapus(true)}>
            <Trash2 className="size-5" aria-hidden /> Batalkan
          </Button>
        </div>
      )}
      <BottomSheet open={dibayar} onClose={() => setDibayar(false)} title="Sudah dibayar">
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            lunas.mutate(true);
          }}
        >
          <p className="text-sm text-stone-500">
            Catat {formatRupiah(t.nominal)} sebagai pemasukan ke {t.akunNama} · {t.kategoriNama}.
          </p>
          <Input label="Tanggal bayar" type="date" value={tanggal} onChange={(e) => setTanggal(e.target.value)} />
          <Button type="submit" loading={lunas.isPending}>
            Simpan pemasukan
          </Button>
        </form>
      </BottomSheet>
      <ConfirmDialog
        open={hapus}
        title={t.lunas ? "Hapus tagihan?" : "Batalkan tagihan?"}
        confirmLabel={t.lunas ? "Hapus" : "Batalkan"}
        danger
        loading={hapusMut.isPending}
        onConfirm={() => hapusMut.mutate()}
        onClose={() => setHapus(false)}
      >
        {t.lunas ? `Pemasukan ${formatRupiah(t.nominal)} dari tagihan ini ikut terhapus.` : "QRIS yang sudah dibagikan tetap bisa di-scan, tapi tidak tercatat lagi di sini."}
      </ConfirmDialog>
    </div>
  );
}

export default function QrisPage() {
  const qris = useQris();
  const tagihan = useTagihanQris();
  const [params, setParams] = useSearchParams();
  const id = params.get("id");
  const pilih = (v: string | null, replace = false) => setParams(v ? { id: v } : {}, { replace });
  const aktif = id ? tagihan.data?.find((t) => t.id === id) : undefined;

  // Tagihan sudah dihapus / bukan milik pengguna → kembali ke daftar
  useEffect(() => {
    if (id && tagihan.data && !aktif) setParams({}, { replace: true });
  }, [id, tagihan.data, aktif, setParams]);

  return (
    <>
      <PageHeader title="Terima QRIS" />
      {qris.isPending ? (
        <Skeleton className="h-60" />
      ) : qris.isError ? (
        <ErrorState error={qris.error} onRetry={() => qris.refetch()} />
      ) : !qris.data ? (
        <Card className="flex flex-col items-center gap-3 p-6 text-center">
          <QrCode className="size-10 text-brand-600" aria-hidden />
          <p className="text-sm text-stone-600">QRIS belum diatur. Upload gambar QRIS merchant-mu dulu.</p>
          <Link to="/pengaturan" className="font-semibold text-brand-700 underline">
            Buka Pengaturan
          </Link>
        </Card>
      ) : aktif ? (
        <Detail key={aktif.id} qris={qris.data} t={aktif} onKembali={() => pilih(null, true)} />
      ) : (
        <div className="flex flex-col gap-6">
          <FormBuat onDibuat={(t) => pilih(t.id)} />
          {tagihan.isPending ? (
            <ListSkeleton rows={2} />
          ) : tagihan.isError ? (
            <ErrorState error={tagihan.error} onRetry={() => tagihan.refetch()} />
          ) : (
            <Daftar list={tagihan.data} onPilih={(v) => pilih(v)} />
          )}
        </div>
      )}
    </>
  );
}
