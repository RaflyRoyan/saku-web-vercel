import { Plus, Trash2, TriangleAlert } from "lucide-react";
import { Button, fokus } from "../ui/Button";
import { Input } from "../ui/Input";
import { MoneyInput } from "../ui/MoneyInput";
import { formatRupiah } from "../../lib/format";
import type { FormSplit, SetForm } from "./form";

type Errors = Record<string, string[]> | undefined;

/** Langkah 2: koreksi item, pajak, servis, diskon. */
export function LangkahItem({ form, setForm, fe }: { form: FormSplit; setForm: SetForm; fe: Errors }) {
  const subtotal = form.items.reduce((a, it) => a + it.harga, 0);
  const total = subtotal + form.pajak + form.servis - form.diskon;
  const setItem = (i: number, changes: Partial<FormSplit["items"][number]>) =>
    setForm((f) => ({ ...f, items: f.items.map((it, j) => (j === i ? { ...it, ...changes } : it)) }));
  // Pemilik item diatur di langkah Peserta
  const tambah = () => setForm((f) => ({ ...f, items: [...f.items, { nama: "", qty: 1, harga: 0, peserta: [] }] }));

  return (
    <div className="flex flex-col gap-4">
      {fe?.items && <p className="text-sm text-keluar">{fe.items[0]}</p>}
      {form.items.map((it, i) => (
        <div key={i} className="flex flex-col gap-3 rounded-2xl border border-garis bg-white p-3">
          <div className="flex items-start gap-2">
            <div className="flex-1">
              <Input label={`Item ${i + 1}`} value={it.nama} maxLength={80} onChange={(e) => setItem(i, { nama: e.target.value })} error={fe?.[`items.${i}.nama`]} />
            </div>
            <button
              type="button"
              aria-label={`Hapus item ${i + 1}`}
              onClick={() => setForm((f) => ({ ...f, items: f.items.filter((_, j) => j !== i) }))}
              className={`mt-7 flex size-11 items-center justify-center rounded-xl text-stone-400 hover:bg-rose-50 hover:text-keluar ${fokus}`}
            >
              <Trash2 className="size-5" aria-hidden />
            </button>
          </div>
          <div className="grid grid-cols-[5rem_1fr] gap-2">
            <Input
              label="Qty"
              inputMode="numeric"
              value={String(it.qty)}
              onChange={(e) => setItem(i, { qty: Math.max(1, Number(e.target.value.replace(/\D/g, "")) || 1) })}
              error={fe?.[`items.${i}.qty`]}
            />
            <MoneyInput label="Harga total" value={it.harga || null} onChange={(v) => setItem(i, { harga: v ?? 0 })} error={fe?.[`items.${i}.harga`]} />
          </div>
        </div>
      ))}
      <Button variant="secondary" onClick={tambah}>
        <Plus className="size-5" aria-hidden /> Tambah item
      </Button>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MoneyInput label="Pajak (PB1/PPN)" value={form.pajak || null} onChange={(v) => setForm((f) => ({ ...f, pajak: v ?? 0 }))} error={fe?.pajak} />
        <MoneyInput label="Servis" value={form.servis || null} onChange={(v) => setForm((f) => ({ ...f, servis: v ?? 0 }))} error={fe?.servis} />
        <MoneyInput label="Diskon" value={form.diskon || null} onChange={(v) => setForm((f) => ({ ...f, diskon: v ?? 0 }))} error={fe?.diskon} />
      </div>

      <div className="flex flex-col gap-1 rounded-2xl bg-brand-50 px-4 py-3 text-sm">
        <div className="flex justify-between">
          <span className="text-stone-500">Subtotal</span>
          <span className="font-semibold">{formatRupiah(subtotal)}</span>
        </div>
        <div className="flex justify-between text-base">
          <span className="font-bold">Total</span>
          <span className="font-bold">{formatRupiah(total)}</span>
        </div>
      </div>
      {form.totalStruk !== null && form.totalStruk !== total && (
        <p role="status" className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          Total struk {formatRupiah(form.totalStruk)}, hasil hitung {formatRupiah(total)}. Cek lagi item.
        </p>
      )}
    </div>
  );
}
