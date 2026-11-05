import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, QrCode, RotateCcw, Share2 } from "lucide-react";
import PageHeader from "../components/layout/PageHeader";
import { BottomSheet } from "../components/ui/BottomSheet";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { ChipPicker } from "../components/ui/ChipPicker";
import { FormError } from "../components/ui/FormError";
import { Input } from "../components/ui/Input";
import { MoneyInput } from "../components/ui/MoneyInput";
import { ErrorState, Skeleton } from "../components/ui/States";
import { akunUntukForm, useAkun, useKategori } from "../hooks/useMaster";
import { useQris, type Qris } from "../hooks/useSplit";
import { useToast } from "../hooks/useToast";
import { invalidateKeuangan, type TransaksiTersimpan } from "../hooks/useTransaksi";
import { ApiError, send } from "../lib/api";
import { bagikanGambar } from "../lib/bagikan";
import { formatRupiah, hariIni } from "../lib/format";
import { buatKartuQris, gambarQris } from "../lib/kartuQris";

const INGAT_KATEGORI = "saku.qris.kategori";

function bacaIngat(): string | null {
  try {
    return localStorage.getItem(INGAT_KATEGORI);
  } catch {
    return null;
  }
}

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

/** Catat pembayaran yang sudah diterima sebagai transaksi masuk. */
function FormDibayar({ nominal, keterangan, onSelesai }: { nominal: number; keterangan: string; onSelesai: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const akun = useAkun(true);
  const kategori = useKategori(true);
  const akunList = akunUntukForm(akun.data ?? []);
  const kategoriMasuk = (kategori.data ?? []).filter((k) => k.tipe === "masuk" && k.aktif && !k.kodeSistem);
  const [akunId, setAkunId] = useState<string | null>(null);
  const [kategoriId, setKategoriId] = useState<string | null>(bacaIngat);
  const [tanggal, setTanggal] = useState(hariIni());

  // Default: akun GoPay (penerima QRIS) & kategori terakhir, selama pengguna belum memilih
  const akunPakai = akunId ?? akunList.find((a) => /gopay/i.test(a.nama))?.id ?? null;
  const kategoriPakai = kategoriMasuk.some((k) => k.id === kategoriId) ? kategoriId : null;

  const simpan = useMutation({
    mutationFn: () =>
      send<TransaksiTersimpan>("POST", "/transaksi", {
        tipe: "masuk",
        akunId: akunPakai ?? "",
        kategoriId: kategoriPakai ?? "",
        nominal,
        tanggal,
        deskripsi: keterangan || "Pembayaran QRIS",
      }),
    onSuccess: (res) => {
      invalidateKeuangan(qc);
      try {
        if (kategoriPakai) localStorage.setItem(INGAT_KATEGORI, kategoriPakai);
      } catch {
        // localStorage tidak tersedia: kategori tidak diingat
      }
      toast.show(`Pemasukan ${formatRupiah(nominal)} tercatat`);
      for (const p of res.peringatan) toast.show(p, "peringatan");
      onSelesai();
    },
  });
  const fe = simpan.error instanceof ApiError ? simpan.error.errors : undefined;

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        simpan.mutate();
      }}
    >
      <p className="text-sm text-stone-500">
        Catat {formatRupiah(nominal)} sebagai pemasukan{keterangan ? ` "${keterangan}"` : ""}.
      </p>
      <ChipPicker label="Masuk ke akun" scroll value={akunPakai} options={akunList.map((a) => ({ value: a.id, label: a.nama }))} onChange={setAkunId} error={fe?.akunId} />
      <ChipPicker label="Kategori" value={kategoriPakai} options={kategoriMasuk.map((k) => ({ value: k.id, label: k.nama }))} onChange={setKategoriId} error={fe?.kategoriId} />
      <Input label="Tanggal" type="date" value={tanggal} onChange={(e) => setTanggal(e.target.value)} error={fe?.tanggal} />
      {!fe && <FormError error={simpan.error} />}
      <Button type="submit" loading={simpan.isPending}>
        Simpan pemasukan
      </Button>
    </form>
  );
}

export default function QrisPage() {
  const toast = useToast();
  const qris = useQris();
  const [nominal, setNominal] = useState<number | null>(null);
  const [keterangan, setKeterangan] = useState("");
  const [tampil, setTampil] = useState<{ nominal: number; keterangan: string } | null>(null);
  const [dibayar, setDibayar] = useState(false);
  const [berbagi, setBerbagi] = useState(false);

  const reset = () => {
    setTampil(null);
    setNominal(null);
    setKeterangan("");
  };

  async function bagikan(q: Qris, t: { nominal: number; keterangan: string }) {
    setBerbagi(true);
    try {
      const blob = await buatKartuQris({ payload: q.payload, merchant: q.merchant, nominal: t.nominal, keterangan: t.keterangan });
      const teks = `Pembayaran${t.keterangan ? ` ${t.keterangan}` : ""}: ${formatRupiah(t.nominal)}. Bayar lewat QRIS di gambar ya.`;
      if ((await bagikanGambar(blob, `qris-${t.nominal}.png`, teks)) === "unduh") toast.show("Gambar QRIS diunduh");
    } catch {
      toast.show("Gagal membuat gambar QRIS.", "error");
    } finally {
      setBerbagi(false);
    }
  }

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
      ) : tampil ? (
        <div className="flex flex-col items-center gap-4">
          <Card className="flex w-full flex-col items-center gap-3 p-5 text-center">
            <p className="text-sm font-semibold text-stone-500">Scan untuk membayar</p>
            <p className="text-3xl font-extrabold text-brand-700 tabular-nums">{formatRupiah(tampil.nominal)}</p>
            {tampil.keterangan && <p className="text-sm text-stone-700">{tampil.keterangan}</p>}
            <LayarQr qris={qris.data} nominal={tampil.nominal} />
            <p className="font-bold">{qris.data.merchant || "QRIS"}</p>
            <p className="text-xs text-stone-500">Nominal sudah terisi otomatis.</p>
          </Card>
          <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-3">
            <Button onClick={() => setDibayar(true)}>
              <CircleCheck className="size-5" aria-hidden /> Sudah dibayar
            </Button>
            <Button variant="secondary" loading={berbagi} onClick={() => bagikan(qris.data!, tampil)}>
              <Share2 className="size-5" aria-hidden /> Bagikan
            </Button>
            <Button variant="ghost" onClick={reset}>
              <RotateCcw className="size-5" aria-hidden /> Buat baru
            </Button>
          </div>
          <BottomSheet open={dibayar} onClose={() => setDibayar(false)} title="Sudah dibayar">
            {dibayar && (
              <FormDibayar
                nominal={tampil.nominal}
                keterangan={tampil.keterangan}
                onSelesai={() => {
                  setDibayar(false);
                  reset();
                }}
              />
            )}
          </BottomSheet>
        </div>
      ) : (
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (nominal && nominal > 0) setTampil({ nominal, keterangan: keterangan.trim() });
          }}
        >
          <MoneyInput label="Nominal" besar autoFocus value={nominal} onChange={setNominal} />
          <Input label="Keterangan" value={keterangan} maxLength={100} placeholder="Opsional, mis. Kaos ukuran L" onChange={(e) => setKeterangan(e.target.value)} />
          <p className="text-sm text-stone-500">QRIS: {qris.data.merchant || "tersimpan"}</p>
          {/* Tanpa server: tetap bisa dipakai saat offline */}
          <Button type="submit" kirim={false} disabled={!nominal || nominal <= 0}>
            <QrCode className="size-5" aria-hidden /> Buat QRIS
          </Button>
        </form>
      )}
    </>
  );
}
