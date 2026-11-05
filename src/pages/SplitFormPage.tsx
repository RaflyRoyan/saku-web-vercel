import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, X } from "lucide-react";
import { Button, fokus } from "../components/ui/Button";
import { FormError } from "../components/ui/FormError";
import { ErrorState, ListSkeleton } from "../components/ui/States";
import { LangkahItem } from "../components/split/LangkahItem";
import { LangkahPeserta } from "../components/split/LangkahPeserta";
import { LangkahRingkasan } from "../components/split/LangkahRingkasan";
import { LangkahStruk } from "../components/split/LangkahStruk";
import { dariSplit, formBaru, langkahUntuk, type FormSplit } from "../components/split/form";
import { akunUntukForm, useAkun } from "../hooks/useMaster";
import { simpanSplit, useSplit, type Split } from "../hooks/useSplit";
import { useToast } from "../hooks/useToast";
import { invalidateKeuangan } from "../hooks/useTransaksi";
import { ApiError } from "../lib/api";
import { hariIni } from "../lib/format";

const JUDUL = ["Struk", "Item", "Peserta", "Ringkasan"];

function Wizard({ edit }: { edit?: Split }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const akun = useAkun(true);
  const [form, setForm] = useState<FormSplit>(() => (edit ? dariSplit(edit) : formBaru(hariIni())));
  const [langkah, setLangkah] = useState(edit ? 1 : 0);
  const [kurang, setKurang] = useState<string | null>(null);

  // Akun penerima default: akun bernama GoPay (QRIS GoPay), bisa diganti
  const terimaDefault = akunUntukForm(akun.data ?? []).find((a) => /gopay/i.test(a.nama))?.id ?? "";
  const formTampil = { ...form, akunTerimaId: form.akunTerimaId || terimaDefault };

  const simpan = useMutation({
    mutationFn: () => {
      const { totalStruk: _, lunasIds: __, ...input } = formTampil;
      return simpanSplit(input, edit?.id);
    },
    onSuccess: (res) => {
      invalidateKeuangan(qc);
      toast.show("Split bill disimpan");
      for (const p of res.peringatan) toast.show(p, "peringatan");
      navigate(`/split/${res.id}`, { replace: true });
    },
    onError: (e) => {
      // Lompat ke langkah pertama yang punya error
      if (e instanceof ApiError && e.errors) setLangkah(Math.min(...Object.keys(e.errors).map(langkahUntuk)));
    },
  });
  const err = simpan.error instanceof ApiError ? simpan.error : null;
  const fe = err?.errors;

  function lanjut() {
    setKurang(null);
    if (langkah === 1 && !form.items.length) return setKurang("Tambah minimal 1 item.");
    if (langkah === 1 && form.items.some((it) => !it.nama.trim() || it.harga <= 0)) return setKurang("Lengkapi nama & harga tiap item.");
    if (langkah === 2 && form.peserta.length < 2) return setKurang("Tambah minimal 1 orang lain.");
    if (langkah === 2 && form.items.some((it) => !it.peserta.length)) return setKurang("Tiap item harus punya pemilik.");
    setLangkah((l) => l + 1);
  }

  const kembali = () => (langkah > (edit ? 1 : 0) ? setLangkah((l) => l - 1) : navigate(edit ? `/split/${edit.id}` : "/split"));

  return (
    <div className="flex flex-col gap-5">
      <header className="sticky top-0 z-10 -mx-4 flex min-h-14 items-center gap-2 border-b border-garis bg-white px-2 lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:px-0">
        <button type="button" onClick={kembali} aria-label="Kembali" className={`flex size-11 items-center justify-center rounded-xl text-stone-500 hover:bg-brand-50 ${fokus}`}>
          {langkah > (edit ? 1 : 0) ? <ArrowLeft className="size-5" aria-hidden /> : <X className="size-5" aria-hidden />}
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold">{edit ? "Ubah split bill" : "Split bill baru"}</h1>
          <p className="text-xs text-stone-500">
            Langkah {langkah + 1} dari 4 · {JUDUL[langkah]}
          </p>
        </div>
      </header>

      <ol className="flex gap-1" aria-hidden>
        {JUDUL.map((j, i) => (
          <li key={j} className={`h-1 flex-1 rounded-full ${i <= langkah ? "bg-brand-500" : "bg-brand-100"}`} />
        ))}
      </ol>

      {langkah === 0 && <LangkahStruk setForm={setForm} lanjut={() => setLangkah(1)} />}
      {langkah === 1 && <LangkahItem form={form} setForm={setForm} fe={fe} />}
      {langkah === 2 && <LangkahPeserta form={form} setForm={setForm} fe={fe} />}
      {langkah === 3 && <LangkahRingkasan form={formTampil} setForm={setForm} fe={fe} lama={edit} />}

      {kurang && (
        <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-medium text-keluar">
          {kurang}
        </p>
      )}
      {langkah === 3 && !fe && <FormError error={simpan.error} />}

      {langkah > 0 && (
        <div className="sticky bottom-20 z-10 rounded-2xl border border-garis bg-white p-3 shadow-lg lg:bottom-4">
          {langkah < 3 ? (
            <Button block onClick={lanjut}>
              Lanjut
            </Button>
          ) : (
            <Button block kirim loading={simpan.isPending} onClick={() => simpan.mutate()}>
              Simpan
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export default function SplitFormPage() {
  const { id } = useParams();
  const q = useSplit(id);
  if (!id) return <Wizard />;
  if (q.isPending) return <ListSkeleton rows={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return <Wizard edit={q.data} />;
}
