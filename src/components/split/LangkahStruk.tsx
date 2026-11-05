import { useRef, useState } from "react";
import { Camera, CircleAlert, PencilLine } from "lucide-react";
import { Button } from "../ui/Button";
import { bacaStruk } from "../../lib/ocr";
import { parseStruk } from "../../lib/parseStruk";
import type { SetForm } from "./form";

/** Langkah 1: foto struk → OCR → draf item, atau isi manual. */
export function LangkahStruk({ setForm, lanjut }: { setForm: SetForm; lanjut: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [gagal, setGagal] = useState(false);

  async function pilih(file: File | undefined) {
    if (!file) return;
    setGagal(false);
    setProgress(0);
    try {
      const hasil = parseStruk(await bacaStruk(file, setProgress));
      if (!hasil.items.length) {
        setGagal(true);
        return;
      }
      setForm((f) => ({
        ...f,
        items: hasil.items.map((it) => ({ ...it, peserta: [] })),
        pajak: hasil.pajak,
        servis: hasil.servis,
        diskon: hasil.diskon,
        totalStruk: hasil.total,
      }));
      lanjut();
    } catch {
      setGagal(true);
    } finally {
      setProgress(null);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-stone-500">Foto struk supaya item terisi otomatis. Hasil scan tetap bisa diedit di langkah berikutnya.</p>
      <input ref={input} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => pilih(e.target.files?.[0])} />
      {progress !== null ? (
        <div className="flex flex-col gap-2 rounded-2xl border border-garis bg-white p-4" role="status">
          <p className="text-sm font-semibold">Membaca struk… {Math.round(progress * 100)}%</p>
          <div className="h-2 overflow-hidden rounded-full bg-brand-100">
            <div className="h-full bg-brand-500 transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <p className="text-xs text-stone-500">Pertama kali butuh waktu lebih lama untuk mengunduh data bahasa.</p>
        </div>
      ) : (
        <>
          {gagal && (
            <p role="alert" className="flex items-center gap-2 rounded-xl bg-rose-50 px-3 py-2 text-sm font-medium text-keluar">
              <CircleAlert className="size-4 shrink-0" aria-hidden /> Struk tidak terbaca, isi manual atau foto ulang.
            </p>
          )}
          <Button block onClick={() => input.current?.click()}>
            <Camera className="size-5" aria-hidden /> Foto struk
          </Button>
          <Button block variant="secondary" onClick={lanjut}>
            <PencilLine className="size-5" aria-hidden /> Isi manual
          </Button>
        </>
      )}
    </div>
  );
}
