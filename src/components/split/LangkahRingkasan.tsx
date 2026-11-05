import { KategoriBertingkat } from "../keuangan/KategoriBertingkat";
import { ChipPicker } from "../ui/ChipPicker";
import { Input } from "../ui/Input";
import { ListSkeleton } from "../ui/States";
import { akunUntukForm, useAkun, useKategori } from "../../hooks/useMaster";
import { formatRupiah } from "../../lib/format";
import { hitungBagian } from "../../lib/splitHitung";
import type { FormSplit, SetForm } from "./form";

type Errors = Record<string, string[]> | undefined;

/** Langkah 4: nama, tanggal, akun pembayar, kategori, akun penerima + ringkasan bagian. */
export function LangkahRingkasan({ form, setForm, fe, lama }: { form: FormSplit; setForm: SetForm; fe: Errors; lama?: { akunId: string; akunTerimaId: string; kategoriId: string } }) {
  const akun = useAkun(true);
  const kategori = useKategori(true);
  const set = <K extends keyof FormSplit>(key: K, value: FormSplit[K]) => setForm((f) => ({ ...f, [key]: value }));
  const indeksSaya = Math.max(0, form.peserta.findIndex((p) => p.saya));
  const { total, nominal } = hitungBagian(form, form.peserta.length, indeksSaya);

  if (akun.isPending || kategori.isPending) return <ListSkeleton rows={3} />;
  const akunOptions = akunUntukForm(akun.data ?? [], [lama?.akunId, lama?.akunTerimaId]).map((a) => ({ value: a.id, label: a.nama }));
  const kategoriKeluar = (kategori.data ?? []).filter((k) => k.tipe === "keluar" && !k.kodeSistem && (k.aktif || k.id === lama?.kategoriId));

  return (
    <div className="flex flex-col gap-5">
      <Input label="Nama tagihan" value={form.nama} maxLength={60} placeholder="mis. Makan Bakmi" onChange={(e) => set("nama", e.target.value)} error={fe?.nama} />
      <Input label="Tanggal" type="date" value={form.tanggal ?? ""} onChange={(e) => set("tanggal", e.target.value)} error={fe?.tanggal} />
      <ChipPicker label="Dibayar dari akun" scroll value={form.akunId || null} options={akunOptions} onChange={(v) => set("akunId", v)} error={fe?.akunId} />
      <KategoriBertingkat kategori={kategoriKeluar} value={form.kategoriId || null} onChange={(v) => set("kategoriId", v ?? "")} error={fe?.kategoriId} />
      <ChipPicker label="Pembayaran teman masuk ke" scroll value={form.akunTerimaId || null} options={akunOptions} onChange={(v) => set("akunTerimaId", v)} error={fe?.akunTerimaId} />

      <div className="flex flex-col gap-1 rounded-2xl bg-brand-50 px-4 py-3 text-sm">
        {form.peserta.map((p, i) => (
          <div key={i} className="flex justify-between">
            <span>
              {p.nama}
              {p.saya && <span className="text-stone-400"> (kamu)</span>}
            </span>
            <span className="font-semibold">{formatRupiah(nominal[i] ?? 0)}</span>
          </div>
        ))}
        <div className="mt-1 flex justify-between border-t border-brand-200 pt-1 text-base">
          <span className="font-bold">Total</span>
          <span className="font-bold">{formatRupiah(total)}</span>
        </div>
      </div>
    </div>
  );
}
