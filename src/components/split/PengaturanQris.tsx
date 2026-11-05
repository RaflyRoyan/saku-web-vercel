import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, QrCode } from "lucide-react";
import { Button } from "../ui/Button";
import { Skeleton } from "../ui/States";
import { simpanQris, splitKeys, useQris } from "../../hooks/useSplit";
import { useToast } from "../../hooks/useToast";
import { ApiError } from "../../lib/api";
import { parseQris, type HasilQris } from "../../lib/qris";

/** Baca QR dari gambar (jsQR dimuat saat dipakai saja). */
async function bacaQr(file: File): Promise<string | null> {
  const [{ default: jsQR }, bitmap] = await Promise.all([import("jsqr"), createImageBitmap(file)]);
  // Gambar besar diperkecil supaya cepat; QR tetap terbaca
  const skala = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * skala);
  canvas.height = Math.round(bitmap.height * skala);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return jsQR(img.data, img.width, img.height)?.data ?? null;
}

/** Pengaturan → QRIS statis untuk tagihan split bill. */
export function PengaturanQris() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQris();
  const input = useRef<HTMLInputElement>(null);
  const [hasil, setHasil] = useState<HasilQris | null>(null);
  const [membaca, setMembaca] = useState(false);

  const simpan = useMutation({
    mutationFn: simpanQris,
    onSuccess: (res) => {
      qc.setQueryData(splitKeys.qris, res);
      setHasil(null);
      toast.show(res ? "QRIS disimpan" : "QRIS dihapus");
    },
  });
  const err = simpan.error instanceof ApiError ? simpan.error : null;

  async function pilih(file: File | undefined) {
    if (!file) return;
    setMembaca(true);
    try {
      const teks = await bacaQr(file);
      setHasil(teks ? parseQris(teks) : { ok: false, pesan: "QR tidak terbaca, coba gambar lebih jelas." });
    } catch {
      setHasil({ ok: false, pesan: "Gambar tidak bisa dibaca." });
    } finally {
      setMembaca(false);
      if (input.current) input.current.value = "";
    }
  }

  if (q.isPending) return <Skeleton className="h-16" />;
  const tersimpan = q.data;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-stone-500">
        Dipakai untuk tagihan split bill: nominal tiap orang otomatis masuk ke QRIS. Pakai QRIS merchant (mis. GoPay Merchant/GoBiz), bukan QR kirim uang pribadi.
      </p>
      {tersimpan && !hasil && (
        <div className="flex items-center gap-3 rounded-xl bg-stone-50 px-3 py-2">
          <QrCode className="size-6 text-brand-600" aria-hidden />
          <div className="min-w-0">
            <p className="truncate font-bold">{tersimpan.merchant || "QRIS"}</p>
            <p className="text-sm text-stone-500">{tersimpan.kota}</p>
          </div>
        </div>
      )}
      {hasil?.ok === false && (
        <p role="alert" className="flex items-center gap-2 rounded-xl bg-rose-50 px-3 py-2 text-sm font-medium text-keluar">
          <CircleAlert className="size-4 shrink-0" aria-hidden /> {hasil.pesan}
        </p>
      )}
      {hasil?.ok && (
        <div className="flex items-center gap-3 rounded-xl bg-emerald-50 px-3 py-2">
          <QrCode className="size-6 text-masuk" aria-hidden />
          <div className="min-w-0">
            <p className="truncate font-bold">{hasil.merchant || "QRIS"}</p>
            <p className="text-sm text-stone-500">{hasil.kota}</p>
          </div>
        </div>
      )}
      {err && <p className="text-sm text-keluar">{err.errors?.payload?.[0] ?? err.title}</p>}
      <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => pilih(e.target.files?.[0])} />
      <div className="flex flex-wrap gap-2">
        {hasil?.ok ? (
          <>
            <Button kirim loading={simpan.isPending} onClick={() => simpan.mutate(hasil.payload)}>
              Simpan QRIS
            </Button>
            <Button variant="secondary" onClick={() => setHasil(null)}>
              Batal
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" loading={membaca} onClick={() => input.current?.click()}>
              {tersimpan ? "Ganti QRIS" : "Upload gambar QRIS"}
            </Button>
            {tersimpan && (
              <Button variant="ghost" kirim loading={simpan.isPending} onClick={() => simpan.mutate(null)}>
                Hapus
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
