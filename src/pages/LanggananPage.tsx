import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Repeat } from "lucide-react";
import PageHeader from "../components/layout/PageHeader";
import { LanggananAksi } from "../components/keuangan/LanggananAksi";
import { BottomSheet } from "../components/ui/BottomSheet";
import { Button, fokus } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { ChipPicker } from "../components/ui/ChipPicker";
import { FormError } from "../components/ui/FormError";
import { Input, Switch } from "../components/ui/Input";
import { MoneyInput } from "../components/ui/MoneyInput";
import { EmptyState, ErrorState, ListSkeleton } from "../components/ui/States";
import { useBerulang, type Berulang } from "../hooks/useBerulang";
import { akunUntukForm, useAkun, useKategori } from "../hooks/useMaster";
import { useToast } from "../hooks/useToast";
import { invalidateKeuangan } from "../hooks/useTransaksi";
import { ApiError, send } from "../lib/api";
import { formatBulan, formatRupiah, hariIni } from "../lib/format";

interface Form {
  nama: string;
  nominal: number | null;
  akunId: string | null;
  kategoriId: string | null;
  tglJatuhTempo: string;
  ingatkanHMin: string;
  mulai: string;
  selesai: string;
  aktif: boolean;
}

const dariBerulang = (b?: Berulang): Form => ({
  nama: b?.nama ?? "",
  nominal: b?.nominal ?? null,
  akunId: b?.akunId ?? null,
  kategoriId: b?.kategoriId ?? null,
  tglJatuhTempo: b ? String(b.tglJatuhTempo) : "",
  ingatkanHMin: b ? String(b.ingatkanHMin) : "3",
  mulai: b?.mulai ?? hariIni().slice(0, 7),
  selesai: b?.selesai ?? "",
  aktif: b?.aktif ?? true,
});

/** Angka dari input teks; kosong/rusak dikirim apa adanya supaya API yang memberi pesan error. */
const angka = (v: string) => (v.trim() === "" || Number.isNaN(Number(v)) ? v : Number(v));

function LanggananForm({ edit, onDone }: { edit?: Berulang; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const akun = useAkun(true);
  const kategori = useKategori(true);
  const [form, setForm] = useState<Form>(() => dariBerulang(edit));
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const simpan = useMutation({
    mutationFn: () => {
      const body = {
        nama: form.nama,
        nominal: form.nominal ?? 0,
        akunId: form.akunId ?? "",
        kategoriId: form.kategoriId ?? "",
        tglJatuhTempo: angka(form.tglJatuhTempo),
        ingatkanHMin: angka(form.ingatkanHMin),
        mulai: form.mulai,
        selesai: form.selesai || null,
        ...(edit ? { aktif: form.aktif } : {}),
      };
      return edit ? send("PUT", `/berulang/${edit.id}`, body) : send("POST", "/berulang", body);
    },
    onSuccess: () => {
      invalidateKeuangan(qc);
      toast.show(edit ? "Langganan disimpan" : "Langganan ditambahkan");
      onDone();
    },
  });
  const fe = simpan.error instanceof ApiError ? simpan.error.errors : undefined;
  const akunOpt = akunUntukForm(akun.data ?? [], [edit?.akunId]).map((a) => ({ value: a.id, label: a.nama }));
  const katOpt = (kategori.data ?? [])
    .filter((k) => k.tipe === "keluar" && !k.kodeSistem && (k.aktif || k.id === edit?.kategoriId))
    .map((k) => ({ value: k.id, label: k.nama }));

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        simpan.mutate();
      }}
    >
      <Input label="Nama" value={form.nama} maxLength={50} placeholder="Mis. Netflix" onChange={(e) => set("nama", e.target.value)} error={fe?.nama} autoFocus />
      <MoneyInput label="Nominal" value={form.nominal} onChange={(v) => set("nominal", v)} error={fe?.nominal} />
      <ChipPicker label="Dari akun" scroll value={form.akunId} options={akunOpt} onChange={(v) => set("akunId", v)} error={fe?.akunId} />
      <ChipPicker label="Kategori" value={form.kategoriId} options={katOpt} onChange={(v) => set("kategoriId", v)} error={fe?.kategoriId} />
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Jatuh tempo (tgl)"
          inputMode="numeric"
          value={form.tglJatuhTempo}
          placeholder="1–31"
          onChange={(e) => set("tglJatuhTempo", e.target.value.replace(/\D/g, "").slice(0, 2))}
          error={fe?.tglJatuhTempo}
        />
        <Input
          label="Ingatkan H-"
          inputMode="numeric"
          value={form.ingatkanHMin}
          onChange={(e) => set("ingatkanHMin", e.target.value.replace(/\D/g, "").slice(0, 2))}
          error={fe?.ingatkanHMin}
        />
        <Input label="Mulai bulan" type="month" value={form.mulai} onChange={(e) => set("mulai", e.target.value)} error={fe?.mulai} />
        <Input label="Selesai bulan" type="month" value={form.selesai} min={form.mulai} onChange={(e) => set("selesai", e.target.value)} error={fe?.selesai} hint="Kosong = tanpa batas" />
      </div>
      {edit && <Switch label="Aktif" checked={form.aktif} onChange={(v) => set("aktif", v)} />}
      <FormError error={simpan.error} />
      <Button type="submit" block loading={simpan.isPending}>
        {edit ? "Simpan" : "Tambah langganan"}
      </Button>
    </form>
  );
}

const BADGE = {
  belum: "bg-stone-100 text-stone-600",
  dibayar: "bg-emerald-50 text-masuk",
  dilewati: "border border-dashed border-stone-300 text-stone-500",
} as const;

function LanggananCard({ b, onEdit }: { b: Berulang; onEdit: () => void }) {
  const label = { belum: "Belum dibayar", dibayar: "Dibayar", dilewati: "Dilewati" }[b.status];
  return (
    <Card className={`flex flex-col gap-3 p-4 ${b.aktif ? "" : "opacity-70"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-bold">{b.nama}</p>
          <p className="truncate text-sm text-stone-500">
            Tiap tgl {b.tglJatuhTempo} · {b.akunNama} · {b.kategoriNama}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <span className="font-bold tabular-nums">{formatRupiah(b.nominal)}</span>
          <button type="button" onClick={onEdit} aria-label={`Ubah ${b.nama}`} className={`flex size-11 items-center justify-center rounded-xl text-stone-400 hover:bg-brand-50 hover:text-brand-700 ${fokus}`}>
            <Pencil className="size-4" aria-hidden />
          </button>
        </div>
      </div>
      {b.aktif && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {b.berlaku ? (
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${BADGE[b.status]}`}>
              {label} {formatBulan(b.bulan)}
            </span>
          ) : (
            <span className="text-xs text-stone-500">
              {b.mulai > b.bulan ? `Mulai ${formatBulan(b.mulai, true)}` : `Selesai ${formatBulan(b.selesai ?? b.bulan, true)}`}
            </span>
          )}
          {b.berlaku && b.status !== "dibayar" && <LanggananAksi b={b} bulan={b.bulan} dilewati={b.status === "dilewati"} />}
        </div>
      )}
    </Card>
  );
}

export default function LanggananPage() {
  const list = useBerulang();
  const [form, setForm] = useState<{ edit?: Berulang } | null>(null);

  const tambah = (
    <Button onClick={() => setForm({})}>
      <Plus className="size-4" aria-hidden />
      Tambah
    </Button>
  );
  const aktif = list.data?.filter((b) => b.aktif) ?? [];
  const nonaktif = list.data?.filter((b) => !b.aktif) ?? [];

  return (
    <>
      <PageHeader title="Langganan" action={list.data?.length ? tambah : undefined} />
      {list.isPending ? (
        <ListSkeleton />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : list.data.length === 0 ? (
        <EmptyState icon={Repeat} title="Belum ada langganan. Tambahkan tagihan rutin seperti Netflix atau listrik untuk diingatkan tiap bulan." action={tambah} />
      ) : (
        <div className="flex flex-col gap-3">
          {aktif.map((b) => (
            <LanggananCard key={b.id} b={b} onEdit={() => setForm({ edit: b })} />
          ))}
          {nonaktif.length > 0 && (
            <details className="group">
              <summary className={`flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-xl px-1 text-sm font-semibold text-stone-500 ${fokus}`}>
                Nonaktif ({nonaktif.length}) <span aria-hidden className="group-open:rotate-180">▾</span>
              </summary>
              <div className="mt-2 flex flex-col gap-3">
                {nonaktif.map((b) => (
                  <LanggananCard key={b.id} b={b} onEdit={() => setForm({ edit: b })} />
                ))}
              </div>
            </details>
          )}
        </div>
      )}
      <BottomSheet open={form !== null} onClose={() => setForm(null)} title={form?.edit ? "Ubah langganan" : "Tambah langganan"}>
        {form && <LanggananForm key={form.edit?.id ?? "baru"} edit={form.edit} onDone={() => setForm(null)} />}
      </BottomSheet>
    </>
  );
}
