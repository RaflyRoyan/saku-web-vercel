import { useState, type FormEvent } from "react";
import { Equal, Plus, X } from "lucide-react";
import { Button, fokus } from "../ui/Button";
import { Input } from "../ui/Input";
import { useNamaPeserta } from "../../hooks/useSplit";
import { formatRupiah } from "../../lib/format";
import { hitungBagian } from "../../lib/splitHitung";
import type { FormSplit, SetForm } from "./form";

type Errors = Record<string, string[]> | undefined;

/** Langkah 3: siapa saja yang ikut & item milik siapa. */
export function LangkahPeserta({ form, setForm, fe }: { form: FormSplit; setForm: SetForm; fe: Errors }) {
  const nama = useNamaPeserta();
  const [baru, setBaru] = useState("");
  const indeksSaya = Math.max(0, form.peserta.findIndex((p) => p.saya));
  const { nominal } = hitungBagian(form, form.peserta.length, indeksSaya);
  const dipakai = new Set(form.peserta.map((p) => p.nama.toLowerCase()));

  function tambah(e?: FormEvent) {
    e?.preventDefault();
    const n = baru.trim();
    if (!n || dipakai.has(n.toLowerCase())) return;
    setForm((f) => ({ ...f, peserta: [...f.peserta, { nama: n, saya: false }] }));
    setBaru("");
  }

  const hapus = (k: number) =>
    setForm((f) => ({
      ...f,
      peserta: f.peserta.filter((_, i) => i !== k),
      items: f.items.map((it) => ({ ...it, peserta: it.peserta.filter((p) => p !== k).map((p) => (p > k ? p - 1 : p)) })),
    }));

  const toggle = (i: number, p: number) =>
    setForm((f) => ({
      ...f,
      items: f.items.map((it, j) => (j !== i ? it : { ...it, peserta: it.peserta.includes(p) ? it.peserta.filter((x) => x !== p) : [...it.peserta, p].sort((a, b) => a - b) })),
    }));

  const bagiRata = () => setForm((f) => ({ ...f, items: f.items.map((it) => ({ ...it, peserta: f.peserta.map((_, i) => i) })) }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          {form.peserta.map((p, i) => (
            <span key={i} className="inline-flex min-h-9 items-center gap-1 rounded-full border border-garis bg-white pr-1 pl-3 text-sm font-semibold">
              {p.nama}
              {p.saya ? (
                <span className="pr-2 text-xs font-medium text-stone-400">(kamu)</span>
              ) : p.id && form.lunasIds.includes(p.id) ? (
                <span className="pr-2 text-xs font-medium text-masuk">(lunas)</span>
              ) : (
                <button type="button" aria-label={`Hapus ${p.nama}`} onClick={() => hapus(i)} className={`flex size-7 items-center justify-center rounded-full text-stone-400 hover:bg-rose-50 hover:text-keluar ${fokus}`}>
                  <X className="size-4" aria-hidden />
                </button>
              )}
            </span>
          ))}
        </div>
        {fe?.peserta && <p className="text-sm text-keluar">{fe.peserta[0]}</p>}
        {form.peserta.map((_, i) => fe?.[`peserta.${i}.nama`] && <p key={i} className="text-sm text-keluar">{fe[`peserta.${i}.nama`][0]}</p>)}
        <form className="flex items-end gap-2" onSubmit={tambah}>
          <div className="flex-1">
            <Input label="Tambah orang" value={baru} maxLength={40} list="nama-peserta" placeholder="Nama" onChange={(e) => setBaru(e.target.value)} />
            <datalist id="nama-peserta">
              {(nama.data ?? []).filter((n) => !dipakai.has(n.toLowerCase())).map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </div>
          <Button variant="secondary" type="button" onClick={() => tambah()} disabled={!baru.trim() || dipakai.has(baru.trim().toLowerCase())} aria-label="Tambah orang">
            <Plus className="size-5" aria-hidden />
          </Button>
        </form>
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-stone-500">Item milik siapa?</h2>
        <Button variant="ghost" onClick={bagiRata} disabled={form.peserta.length < 2}>
          <Equal className="size-4" aria-hidden /> Bagi rata
        </Button>
      </div>
      {form.items.map((it, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-2xl border border-garis bg-white p-3">
          <div className="flex justify-between gap-2 text-sm">
            <span className="font-semibold">
              {it.qty > 1 && `${it.qty}× `}
              {it.nama || `Item ${i + 1}`}
            </span>
            <span className="text-stone-500">{formatRupiah(it.harga)}</span>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label={`Pemilik ${it.nama}`}>
            {form.peserta.map((p, k) => {
              const aktif = it.peserta.includes(k);
              return (
                <button
                  key={k}
                  type="button"
                  aria-pressed={aktif}
                  onClick={() => toggle(i, k)}
                  className={`min-h-9 rounded-full border px-3 text-sm font-semibold ${fokus} ${aktif ? "border-brand-700 bg-brand-50 text-brand-700" : "border-garis bg-white text-stone-500"}`}
                >
                  {p.nama}
                </button>
              );
            })}
          </div>
          {fe?.[`items.${i}.peserta`] && <p className="text-sm text-keluar">{fe[`items.${i}.peserta`][0]}</p>}
        </div>
      ))}

      <div className="flex flex-col gap-1 rounded-2xl bg-brand-50 px-4 py-3 text-sm">
        {form.peserta.map((p, i) => (
          <div key={i} className="flex justify-between">
            <span>{p.nama}</span>
            <span className="font-semibold">{formatRupiah(nominal[i] ?? 0)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
