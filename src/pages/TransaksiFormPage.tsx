import { useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2, X } from "lucide-react";
import { Button, fokus } from "../components/ui/Button";
import { ChipPicker } from "../components/ui/ChipPicker";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { FormError } from "../components/ui/FormError";
import { Input } from "../components/ui/Input";
import { MoneyInput } from "../components/ui/MoneyInput";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { ErrorState, ListSkeleton } from "../components/ui/States";
import { akunUntukForm, useAkun, useKategori } from "../hooks/useMaster";
import { useToast } from "../hooks/useToast";
import { invalidateKeuangan, useTransaksi, type TipeTransaksi, type Transaksi, type TransaksiTersimpan } from "../hooks/useTransaksi";
import { ApiError, send } from "../lib/api";
import { formatRupiah, hariIni, tambahHari } from "../lib/format";

const TIPE = [
  { value: "keluar", label: "Keluar" },
  { value: "masuk", label: "Masuk" },
  { value: "transfer", label: "Transfer" },
] as const;
const BIAYA_CEPAT = [0, 2_500, 6_500];
const INGAT = "saku.transaksi.terakhir";

interface Form {
  tipe: TipeTransaksi;
  nominal: number | null;
  akunId: string | null;
  akunTujuanId: string | null;
  kategoriId: string | null;
  biayaAdmin: number | null;
  deskripsi: string;
  tanggal: string;
}

/** Akun & tipe terakhir yang dipakai jadi default (02 §6.3). */
function ingatan(): Partial<Pick<Form, "tipe" | "akunId">> {
  try {
    return JSON.parse(localStorage.getItem(INGAT) ?? "{}");
  } catch {
    return {};
  }
}

function simpanIngatan(f: Form) {
  try {
    localStorage.setItem(INGAT, JSON.stringify({ tipe: f.tipe, akunId: f.akunId }));
  } catch {
    // localStorage tidak tersedia (mode privat): abaikan
  }
}

function formBaru(akunId?: string | null): Form {
  const last = ingatan();
  return {
    tipe: last.tipe ?? "keluar",
    nominal: null,
    akunId: akunId ?? last.akunId ?? null,
    akunTujuanId: null,
    kategoriId: null,
    biayaAdmin: 0,
    deskripsi: "",
    tanggal: hariIni(),
  };
}

const dariTransaksi = (t: Transaksi): Form => ({
  tipe: t.tipe,
  nominal: t.nominal,
  akunId: t.akunId,
  akunTujuanId: t.akunTujuanId,
  kategoriId: t.kategoriId,
  biayaAdmin: t.biayaAdmin,
  deskripsi: t.deskripsi,
  tanggal: t.tanggal,
});

export default function TransaksiFormPage() {
  const { id } = useParams();
  const detail = useTransaksi(id);

  if (id && detail.isPending) return <ListSkeleton rows={5} />;
  if (id && detail.isError) return <ErrorState error={detail.error} onRetry={() => detail.refetch()} />;
  if (detail.data?.kodeSistem === "TARIK_TABUNGAN") {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <p className="text-sm text-stone-700">Transaksi tarik tabungan hanya bisa diubah lewat menu Tabungan.</p>
        <Link to="/tabungan" className={`font-semibold text-brand-700 ${fokus}`}>
          Buka Tabungan
        </Link>
      </div>
    );
  }
  return <TransaksiForm key={id ?? "baru"} edit={detail.data} />;
}

function TransaksiForm({ edit }: { edit?: Transaksi }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const toast = useToast();
  const nominalRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<Form>(() => (edit ? dariTransaksi(edit) : formBaru(params.get("akunId"))));
  const [hapus, setHapus] = useState(false);
  const akun = useAkun(true);
  const kategori = useKategori(true);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));
  const kembali = () => (location.key === "default" ? navigate("/") : navigate(-1));

  const simpan = useMutation({
    mutationFn: (_lagi: boolean) => {
      const transfer = form.tipe === "transfer";
      const body = {
        tipe: form.tipe,
        nominal: form.nominal ?? 0,
        akunId: form.akunId ?? "",
        akunTujuanId: transfer ? (form.akunTujuanId ?? "") : undefined,
        kategoriId: transfer ? undefined : (form.kategoriId ?? ""),
        biayaAdmin: transfer ? (form.biayaAdmin ?? 0) : 0,
        deskripsi: form.deskripsi,
        tanggal: form.tanggal,
      };
      return edit
        ? send<TransaksiTersimpan>("PUT", `/transaksi/${edit.id}`, body)
        : send<TransaksiTersimpan>("POST", "/transaksi", body);
    },
    onSuccess: (res, lagi) => {
      invalidateKeuangan(qc);
      simpanIngatan(form);
      toast.show("Tersimpan");
      for (const p of res.peringatan) toast.show(p, "peringatan");
      if (lagi) {
        setForm((f) => ({ ...formBaru(f.akunId), tipe: f.tipe, tanggal: f.tanggal }));
        simpan.reset();
        nominalRef.current?.focus();
      } else {
        kembali();
      }
    },
  });
  const hapusMut = useMutation({
    mutationFn: () => send("DELETE", `/transaksi/${edit!.id}`),
    onSuccess: () => {
      invalidateKeuangan(qc);
      toast.show("Transaksi dihapus");
      kembali();
    },
  });

  const err = simpan.error instanceof ApiError ? simpan.error : null;
  const fe = err?.errors;
  const tanpaPeriode = err?.status === 422;

  // Akun nonaktif/tidak dipilih & kategori nonaktif hanya tampil kalau sedang dipakai transaksi yang diedit
  const akunAktif = akunUntukForm(akun.data ?? [], [edit?.akunId, edit?.akunTujuanId]);
  const kategoriTipe = (kategori.data ?? []).filter(
    (k) => k.tipe === form.tipe && (k.aktif || k.id === edit?.kategoriId) && (!k.kodeSistem || k.id === edit?.kategoriId),
  );
  const saldoInfo = (akunId: string | null) => {
    const a = akun.data?.find((x) => x.id === akunId);
    return a && a.saldo !== null ? (
      <p className="text-sm text-stone-500">
        Saldo {a.nama} <span className={`font-semibold ${a.saldo < 0 ? "text-keluar" : "text-stone-700"}`}>{formatRupiah(a.saldo)}</span>
      </p>
    ) : null;
  };
  const akunOptions = akunAktif.map((a) => ({ value: a.id, label: a.nama }));

  return (
    <form
      noValidate
      className="flex flex-col gap-5"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        simpan.mutate(false);
      }}
    >
      <header className="sticky top-0 z-10 -mx-4 flex min-h-14 items-center gap-2 border-b border-garis bg-white px-2 lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:px-0">
        <button type="button" onClick={kembali} aria-label="Tutup" className={`flex size-11 items-center justify-center rounded-xl text-stone-500 hover:bg-brand-50 ${fokus}`}>
          <X className="size-5" aria-hidden />
        </button>
        <h1 className="flex-1 text-xl font-bold">{edit ? "Ubah transaksi" : "Catat transaksi"}</h1>
        {edit && (
          <Button variant="danger" onClick={() => setHapus(true)}>
            <Trash2 className="size-4" aria-hidden />
            Hapus
          </Button>
        )}
      </header>

      <SegmentedControl label="Tipe transaksi" value={form.tipe} options={[...TIPE]} onChange={(tipe) => setForm((f) => ({ ...f, tipe, kategoriId: null }))} />

      <MoneyInput
        ref={nominalRef}
        label="Nominal"
        besar
        autoFocus
        value={form.nominal}
        onChange={(v) => set("nominal", v)}
        error={fe?.nominal}
      />

      {akun.isPending || kategori.isPending ? (
        <ListSkeleton rows={2} />
      ) : akunAktif.length === 0 ? (
        <p className="rounded-xl bg-brand-50 px-3 py-2 text-sm text-stone-700">
          Belum ada akun. Minta admin menambahkan akun di{" "}
          <Link to="/master" className="font-semibold text-brand-700 underline">
            Master
          </Link>
          .
        </p>
      ) : (
        <>
          <ChipPicker
            label={form.tipe === "masuk" ? "Ke akun" : "Dari akun"}
            scroll
            value={form.akunId}
            options={akunOptions}
            onChange={(v) => set("akunId", v)}
            error={fe?.akunId}
            footer={saldoInfo(form.akunId)}
          />
          {form.tipe === "transfer" ? (
            <>
              <ChipPicker
                label="Ke akun"
                scroll
                value={form.akunTujuanId}
                options={akunOptions.map((o) => ({ ...o, disabled: o.value === form.akunId }))}
                onChange={(v) => set("akunTujuanId", v)}
                error={fe?.akunTujuanId}
                footer={saldoInfo(form.akunTujuanId)}
              />
              <div className="flex flex-col gap-2">
                <MoneyInput label="Biaya admin" value={form.biayaAdmin} onChange={(v) => set("biayaAdmin", v)} error={fe?.biayaAdmin} />
                <div className="flex gap-2">
                  {BIAYA_CEPAT.map((b) => (
                    <button
                      key={b}
                      type="button"
                      aria-pressed={form.biayaAdmin === b}
                      onClick={() => set("biayaAdmin", b)}
                      className={`min-h-11 rounded-full border px-4 text-sm font-semibold ${fokus} ${
                        form.biayaAdmin === b ? "border-brand-700 bg-brand-50 text-brand-700" : "border-garis bg-white text-stone-700"
                      }`}
                    >
                      {b === 0 ? "0" : formatRupiah(b).replace("Rp ", "")}
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <ChipPicker
              label="Kategori"
              value={form.kategoriId}
              options={kategoriTipe.map((k) => ({ value: k.id, label: k.nama }))}
              onChange={(v) => set("kategoriId", v)}
              error={fe?.kategoriId}
            />
          )}
        </>
      )}

      <Input
        label="Deskripsi"
        value={form.deskripsi}
        maxLength={200}
        placeholder="Opsional"
        onChange={(e) => set("deskripsi", e.target.value)}
        error={fe?.deskripsi}
      />
      <Input
        label="Tanggal"
        type="date"
        value={form.tanggal}
        max={tambahHari(hariIni(), 31)}
        onChange={(e) => set("tanggal", e.target.value)}
        error={fe?.tanggal}
      />

      {tanpaPeriode ? (
        <div role="alert" className="flex flex-col gap-2 rounded-xl bg-rose-50 px-3 py-2 text-sm font-medium text-keluar">
          {err.title}
          <Link to="/periode/baru" className={`self-start font-semibold text-brand-700 underline ${fokus}`}>
            Mulai periode
          </Link>
        </div>
      ) : (
        <FormError error={simpan.error} />
      )}

      <div className="sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] -mx-4 flex flex-col gap-2 border-t border-garis bg-white px-4 py-3 sm:flex-row-reverse lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:px-0">
        <Button type="submit" block loading={simpan.isPending && !simpan.variables}>
          Simpan
        </Button>
        {!edit && (
          <Button variant="secondary" block kirim loading={simpan.isPending && simpan.variables} onClick={() => simpan.mutate(true)}>
            Simpan & catat lagi
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={hapus}
        title="Hapus transaksi?"
        confirmLabel="Hapus"
        danger
        loading={hapusMut.isPending}
        onConfirm={() => hapusMut.mutate()}
        onClose={() => setHapus(false)}
      >
        Transaksi {edit?.deskripsi || edit?.kategoriNama || ""} sebesar {formatRupiah(edit?.nominal ?? 0)} akan dihapus permanen.
        <FormError error={hapusMut.error} />
      </ConfirmDialog>
    </form>
  );
}
