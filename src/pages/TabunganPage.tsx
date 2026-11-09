import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowUpRight, PiggyBank, Trash2 } from "lucide-react";
import PageHeader from "../components/layout/PageHeader";
import { BottomSheet } from "../components/ui/BottomSheet";
import { Button, fokus } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { ChipPicker } from "../components/ui/ChipPicker";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { FormError } from "../components/ui/FormError";
import { Input } from "../components/ui/Input";
import { MoneyInput } from "../components/ui/MoneyInput";
import { EmptyState, ErrorState, ListSkeleton } from "../components/ui/States";
import { useAkun } from "../hooks/useMaster";
import { usePeriodeAktif } from "../hooks/usePeriode";
import { useTabungan, type RiwayatTabungan, type Tabungan } from "../hooks/useTabungan";
import { useToast } from "../hooks/useToast";
import { invalidateKeuangan } from "../hooks/useTransaksi";
import { ApiError, send } from "../lib/api";
import { formatAngka, formatRupiah, formatTanggal, hariIni, tambahHari } from "../lib/format";

function TarikForm({ data, onDone }: { data: Tabungan; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const akun = useAkun();
  const aktif = usePeriodeAktif();
  // Hanya akun aktif yang masih punya tabungan
  const pilihan = data.perAkun.filter((a) => a.saldo > 0 && akun.data?.some((x) => x.id === a.akunId));
  const [pilihAkun, setAkunId] = useState<string | null>(null);
  // Default akun pertama; daftar akun bisa baru selesai dimuat setelah form tampil
  const akunId = pilihAkun ?? pilihan[0]?.akunId ?? null;
  const [nominal, setNominal] = useState<number | null>(null);
  const [tanggal, setTanggal] = useState(hariIni());
  const [keterangan, setKeterangan] = useState("");
  const maks = pilihan.find((a) => a.akunId === akunId)?.saldo ?? 0;

  const tarik = useMutation({
    mutationFn: () => send("POST", "/tabungan/tarik", { akunId: akunId ?? "", nominal: nominal ?? 0, tanggal, keterangan }),
    onSuccess: () => {
      invalidateKeuangan(qc);
      toast.show("Tabungan ditarik");
      onDone();
    },
  });
  const fe = tarik.error instanceof ApiError ? tarik.error.errors : undefined;

  if (akun.isPending) return <ListSkeleton rows={2} />;
  if (pilihan.length === 0) return <p className="text-sm text-stone-500">Belum ada tabungan yang bisa ditarik.</p>;

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        tarik.mutate();
      }}
    >
      <p className="rounded-xl bg-yellow-50 px-3 py-2 text-sm text-stone-700">Uang ini akan masuk ke saldo akun di periode berjalan.</p>
      <ChipPicker
        label="Dari tabungan akun"
        value={akunId}
        options={pilihan.map((a) => ({
          value: a.akunId,
          label: (
            <>
              {a.nama} <span className="font-normal text-stone-500">{formatAngka(a.saldo)}</span>
            </>
          ),
        }))}
        onChange={setAkunId}
        error={fe?.akunId}
      />
      <MoneyInput
        label="Nominal"
        value={nominal}
        onChange={setNominal}
        error={fe?.nominal}
        hint={`Maksimal ${formatRupiah(maks)}`}
        autoFocus
      />
      <Input
        label="Tanggal"
        type="date"
        value={tanggal}
        min={aktif.data?.tanggalMulai}
        max={tambahHari(hariIni(), 31)}
        onChange={(e) => setTanggal(e.target.value)}
        error={fe?.tanggal}
      />
      <Input label="Keterangan" value={keterangan} maxLength={200} placeholder="Mis. servis motor" onChange={(e) => setKeterangan(e.target.value)} error={fe?.keterangan} />
      <FormError error={tarik.error} />
      <Button type="submit" block loading={tarik.isPending} disabled={!nominal || nominal > maks}>
        Tarik tabungan
      </Button>
    </form>
  );
}

/** Setor langsung dari saldo akun di periode aktif, tanpa menunggu tutup periode. */
function SetorForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const akun = useAkun();
  const aktif = usePeriodeAktif();
  // Akun yang dipakai pengguna dan masih punya saldo di periode aktif
  const pilihan = (akun.data ?? []).filter((a) => a.dipilih && (a.saldo ?? 0) > 0);
  const [pilihAkun, setAkunId] = useState<string | null>(null);
  // Default akun pertama; daftar akun bisa baru selesai dimuat setelah form tampil
  const akunId = pilihAkun ?? pilihan[0]?.id ?? null;
  const [nominal, setNominal] = useState<number | null>(null);
  const [tanggal, setTanggal] = useState(hariIni());
  const [keterangan, setKeterangan] = useState("");
  const maks = pilihan.find((a) => a.id === akunId)?.saldo ?? 0;

  const setor = useMutation({
    mutationFn: () => send("POST", "/tabungan/setor", { akunId: akunId ?? "", nominal: nominal ?? 0, tanggal, keterangan }),
    onSuccess: () => {
      invalidateKeuangan(qc);
      toast.show("Disetor ke tabungan");
      onDone();
    },
  });
  const fe = setor.error instanceof ApiError ? setor.error.errors : undefined;

  if (akun.isPending) return <ListSkeleton rows={2} />;
  if (pilihan.length === 0) return <p className="text-sm text-stone-500">Belum ada akun dengan saldo yang bisa disetor.</p>;

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        setor.mutate();
      }}
    >
      <p className="rounded-xl bg-yellow-50 px-3 py-2 text-sm text-stone-700">
        Saldo akun langsung berkurang dan masuk tabungan. Tidak dihitung sebagai pengeluaran.
      </p>
      <ChipPicker
        label="Dari akun"
        value={akunId}
        options={pilihan.map((a) => ({
          value: a.id,
          label: (
            <>
              {a.nama} <span className="font-normal text-stone-500">{formatAngka(a.saldo ?? 0)}</span>
            </>
          ),
        }))}
        onChange={(id) => {
          setAkunId(id);
          setNominal(null);
        }}
        error={fe?.akunId}
      />
      <div className="flex flex-col gap-2">
        <MoneyInput label="Nominal" value={nominal} onChange={setNominal} error={fe?.nominal} hint={`Saldo saat ini ${formatRupiah(maks)}`} autoFocus />
        <Button variant="secondary" className="self-start" onClick={() => setNominal(maks)} disabled={!maks}>
          Semua saldo
        </Button>
      </div>
      <Input
        label="Tanggal"
        type="date"
        value={tanggal}
        min={aktif.data?.tanggalMulai}
        max={tambahHari(hariIni(), 31)}
        onChange={(e) => setTanggal(e.target.value)}
        error={fe?.tanggal}
      />
      <Input label="Keterangan" value={keterangan} maxLength={200} placeholder="Mis. dana darurat" onChange={(e) => setKeterangan(e.target.value)} error={fe?.keterangan} />
      <FormError error={setor.error} />
      <Button type="submit" block loading={setor.isPending} disabled={!nominal || nominal > maks}>
        Setor ke tabungan
      </Button>
    </form>
  );
}

function RiwayatItem({ r, onHapus }: { r: RiwayatTabungan; onHapus: () => void }) {
  const setor = r.jenis !== "tarik";
  const Icon = setor ? ArrowDownLeft : ArrowUpRight;
  const tanda = setor ? (r.nominal < 0 ? "−" : "+") : "−";
  const merah = !setor || r.nominal < 0;
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span className={`flex size-10 shrink-0 items-center justify-center rounded-full ${setor ? "bg-yellow-50 text-tabungan" : "bg-rose-50 text-keluar"}`}>
        <Icon className="size-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">
          {setor ? "Setor" : "Tarik"} · {r.keterangan}
        </span>
        <span className="block truncate text-sm text-stone-500">
          {r.akunNama} · {formatTanggal(r.tanggal)}
        </span>
      </span>
      <span className={`shrink-0 font-bold tabular-nums ${merah ? "text-keluar" : "text-tabungan"}`}>
        {tanda}
        {formatAngka(Math.abs(r.nominal))}
      </span>
      {r.bisaHapus && (
        <button type="button" onClick={onHapus} aria-label={`Hapus ${setor ? "setor" : "tarik"} ${r.keterangan}`} className={`flex size-11 shrink-0 items-center justify-center rounded-xl text-stone-400 hover:bg-rose-50 hover:text-keluar ${fokus}`}>
          <Trash2 className="size-4" aria-hidden />
        </button>
      )}
    </li>
  );
}

export default function TabunganPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const tabungan = useTabungan();
  const aktif = usePeriodeAktif();
  const [tarik, setTarik] = useState(false);
  const [setor, setSetor] = useState(false);
  const [hapus, setHapus] = useState<RiwayatTabungan | null>(null);

  const hapusMut = useMutation({
    mutationFn: (id: string) => send("DELETE", `/tabungan/${id}`),
    onSuccess: () => {
      invalidateKeuangan(qc);
      toast.show(hapus?.jenis === "simpan" ? "Setor tabungan dihapus" : "Tarik tabungan dihapus");
      setHapus(null);
    },
  });

  if (tabungan.isPending) {
    return (
      <>
        <PageHeader title="Tabungan" />
        <ListSkeleton rows={4} />
      </>
    );
  }
  if (tabungan.isError) return <ErrorState error={tabungan.error} onRetry={() => tabungan.refetch()} />;

  const d = tabungan.data;
  return (
    <>
      <PageHeader title="Tabungan" />
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-3 rounded-2xl border border-yellow-200 bg-yellow-50 p-5">
          <p className="flex items-center gap-2 text-sm font-semibold text-tabungan">
            <PiggyBank className="size-5" aria-hidden />
            Total tabungan
          </p>
          <p className={`text-3xl font-extrabold tabular-nums ${d.total < 0 ? "text-keluar" : "text-stone-900"}`}>{formatRupiah(d.total)}</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setSetor(true)} disabled={!aktif.data} title={!aktif.data ? "Mulai periode dulu untuk menyetor." : undefined}>
              Setor sekarang
            </Button>
            <Button
              variant="secondary"
              onClick={() => setTarik(true)}
              disabled={!aktif.data || !d.perAkun.some((a) => a.saldo > 0)}
              title={!aktif.data ? "Mulai periode dulu untuk menarik tabungan." : undefined}
            >
              Tarik tabungan
            </Button>
          </div>
        </div>

        {d.riwayat.length === 0 ? (
          <EmptyState icon={PiggyBank} title="Belum ada tabungan. Setor sekarang, atau sisa saldo setiap akun masuk ke sini saat periode ditutup." />
        ) : (
          <>
            <section>
              <h2 className="mb-2 font-bold">Per akun</h2>
              <Card className="divide-y divide-garis">
                {d.perAkun.map((a) => (
                  <div key={a.akunId} className="flex justify-between gap-3 px-4 py-3">
                    <span className="font-medium">{a.nama}</span>
                    <span className={`font-bold tabular-nums ${a.saldo < 0 ? "text-keluar" : ""}`}>{formatRupiah(a.saldo)}</span>
                  </div>
                ))}
              </Card>
            </section>
            <section>
              <h2 className="mb-2 font-bold">Riwayat</h2>
              <Card className="overflow-hidden">
                <ul className="divide-y divide-garis">
                  {d.riwayat.map((r) => (
                    <RiwayatItem key={r.id} r={r} onHapus={() => setHapus(r)} />
                  ))}
                </ul>
              </Card>
            </section>
          </>
        )}
      </div>

      <BottomSheet open={tarik} onClose={() => setTarik(false)} title="Tarik tabungan">
        {tarik && <TarikForm data={d} onDone={() => setTarik(false)} />}
      </BottomSheet>
      <BottomSheet open={setor} onClose={() => setSetor(false)} title="Setor ke tabungan">
        {setor && <SetorForm onDone={() => setSetor(false)} />}
      </BottomSheet>
      <ConfirmDialog
        open={hapus !== null}
        title={hapus?.jenis === "simpan" ? "Hapus setor tabungan?" : "Hapus tarik tabungan?"}
        confirmLabel="Hapus"
        danger
        loading={hapusMut.isPending}
        onConfirm={() => hapus && hapusMut.mutate(hapus.id)}
        onClose={() => setHapus(null)}
      >
        {hapus?.jenis === "simpan"
          ? `Setor ${formatRupiah(hapus.nominal)} dari ${hapus.akunNama} dan transaksi keluarnya akan dihapus. Saldo akun kembali bertambah.`
          : `Tarik ${formatRupiah(hapus?.nominal ?? 0)} dari ${hapus?.akunNama} dan transaksi masuknya akan dihapus. Tabungan akun ini kembali bertambah.`}
        <FormError error={hapusMut.error} />
      </ConfirmDialog>
    </>
  );
}
