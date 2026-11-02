import { useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { CalendarDays, History, Search, X } from "lucide-react";
import PageHeader from "../components/layout/PageHeader";
import { PeriodeKosong } from "../components/keuangan/PeriodeKosong";
import { TransaksiGroupList } from "../components/keuangan/TransaksiItem";
import { BottomSheet } from "../components/ui/BottomSheet";
import { Button, fokus } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { EmptyState, ErrorState, ListSkeleton } from "../components/ui/States";
import { useAkun, useKategori, useKelompokKategori } from "../hooks/useMaster";
import { usePeriodeList, usePeriodeTerpilih } from "../hooks/usePeriode";
import { useTransaksiList } from "../hooks/useTransaksi";
import { formatTanggal } from "../lib/format";

const TIPE = [
  { value: "keluar", label: "Keluar" },
  { value: "masuk", label: "Masuk" },
  { value: "transfer", label: "Transfer" },
];

interface FilterChipProps {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  /** Filter yang tidak bisa dihapus (periode) tetap tampil biasa. */
  wajib?: boolean;
}

/** Chip filter: select bawaan di dalam chip; aktif → warna brand + tombol ✕ (02 §6.6). */
function FilterChip({ label, value, options, onChange, wajib }: FilterChipProps) {
  const aktif = Boolean(value) && !wajib;
  return (
    <span
      className={`relative flex min-h-11 shrink-0 items-center rounded-full border text-base font-semibold ${
        aktif ? "border-brand-700 bg-brand-50 text-brand-700" : "border-garis bg-white text-stone-700"
      }`}
    >
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`min-h-11 max-w-44 appearance-none truncate rounded-full bg-transparent pr-3 pl-4 ${aktif ? "pr-11" : ""} ${fokus}`}
      >
        {!wajib && <option value="">{label}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {aktif && (
        <button
          type="button"
          aria-label={`Hapus filter ${label}`}
          onClick={() => onChange("")}
          className={`absolute right-0 flex size-11 items-center justify-center rounded-full hover:bg-brand-100 ${fokus}`}
        >
          <X className="size-4" aria-hidden />
        </button>
      )}
    </span>
  );
}

const SEMUA = "semua";

/** Chip rentang tanggal: membuka BottomSheet; aktif → warna brand + tombol ✕. */
function TanggalChip({ dari, sampai, onOpen, onClear }: { dari: string; sampai: string; onOpen: () => void; onClear: () => void }) {
  const aktif = Boolean(dari || sampai);
  const label = aktif ? `${dari ? formatTanggal(dari) : "…"} – ${sampai ? formatTanggal(sampai) : "…"}` : "Tanggal";
  return (
    <span
      className={`relative flex min-h-11 shrink-0 items-center rounded-full border text-base font-semibold ${
        aktif ? "border-brand-700 bg-brand-50 text-brand-700" : "border-garis bg-white text-stone-700"
      }`}
    >
      <button type="button" onClick={onOpen} className={`flex min-h-11 items-center gap-1.5 rounded-full pl-4 ${aktif ? "pr-11" : "pr-4"} ${fokus}`}>
        <CalendarDays className="size-4" aria-hidden />
        {label}
      </button>
      {aktif && (
        <button
          type="button"
          aria-label="Hapus filter tanggal"
          onClick={onClear}
          className={`absolute right-0 flex size-11 items-center justify-center rounded-full hover:bg-brand-100 ${fokus}`}
        >
          <X className="size-4" aria-hidden />
        </button>
      )}
    </span>
  );
}

function RentangForm({ dari, sampai, onApply }: { dari: string; sampai: string; onApply: (dari: string, sampai: string) => void }) {
  const [d, setD] = useState(dari);
  const [s, setS] = useState(sampai);
  const terbalik = Boolean(d && s && d > s);
  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!terbalik) onApply(d, s);
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <Input label="Dari" type="date" value={d} max={s || undefined} onChange={(e) => setD(e.target.value)} />
        <Input label="Sampai" type="date" value={s} min={d || undefined} onChange={(e) => setS(e.target.value)} error={terbalik ? "Harus setelah tanggal Dari." : undefined} />
      </div>
      <p className="text-sm text-stone-500">Pilih &ldquo;Semua periode&rdquo; di filter Periode untuk mencari lintas periode.</p>
      <div className="flex gap-2">
        <Button variant="secondary" block onClick={() => onApply("", "")}>
          Hapus
        </Button>
        <Button type="submit" block kirim={false} disabled={terbalik}>
          Terapkan
        </Button>
      </div>
    </form>
  );
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function RiwayatPage() {
  const [params, setParams] = useSearchParams();
  const { aktif, periodeId } = usePeriodeTerpilih(params.get("periode"));
  const periodeList = usePeriodeList();
  const akun = useAkun(true);
  const kategori = useKategori(true);
  const kelompok = useKelompokKategori(true);
  const [cari, setCari] = useState(params.get("q") ?? "");
  const q = useDebounced(cari.trim(), 300);

  const filter = {
    periodeId,
    akunId: params.get("akunId") ?? "",
    tipe: params.get("tipe") ?? "",
    kategoriId: params.get("kategoriId") ?? "",
    kelompokId: params.get("kelompokId") ?? "",
    dari: params.get("dari") ?? "",
    sampai: params.get("sampai") ?? "",
    q,
  };
  const [pilihTanggal, setPilihTanggal] = useState(false);
  const list = useTransaksiList(filter, 50, Boolean(periodeId));

  const setFilter = (key: string, value: string) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (value && !(key === "periode" && value === aktif.data?.id)) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );

  const setRentang = (dari: string, sampai: string) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        for (const [k, v] of [["dari", dari], ["sampai", sampai]]) {
          if (v) next.set(k, v);
          else next.delete(k);
        }
        return next;
      },
      { replace: true },
    );

  useEffect(() => {
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (q) next.set("q", q);
        else next.delete("q");
        return next;
      },
      { replace: true },
    );
  }, [q, setParams]);

  let isi: ReactNode;
  if (aktif.isPending || (periodeId && list.isPending)) isi = <ListSkeleton rows={5} />;
  else if (aktif.isError) isi = <ErrorState error={aktif.error} onRetry={() => aktif.refetch()} />;
  else if (!periodeId) isi = <PeriodeKosong />;
  else if (list.isError) isi = <ErrorState error={list.error} onRetry={() => list.refetch()} />;
  else {
    const items = list.data!.pages.flatMap((p) => p.data);
    const adaFilter = filter.akunId || filter.tipe || filter.kategoriId || filter.kelompokId || filter.dari || filter.sampai || q;
    isi =
      items.length === 0 ? (
        <EmptyState icon={History} title={adaFilter ? "Tidak ada transaksi yang cocok." : periodeId === SEMUA ? "Belum ada transaksi." : "Belum ada transaksi di periode ini."} />
      ) : (
        <div className="flex flex-col gap-4">
          <TransaksiGroupList items={items} />
          {list.hasNextPage && (
            <Button variant="secondary" loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
              Muat lebih banyak
            </Button>
          )}
        </div>
      );
  }

  const kategoriOptions = (kategori.data ?? [])
    // Transfer hanya punya "kategori" biaya admin
    .filter((k) => (filter.tipe === "transfer" ? k.kodeSistem === "BIAYA_ADMIN" : !filter.tipe || k.tipe === filter.tipe))
    // Sub kategori dibatasi ke kategori induk yang dipilih
    .filter((k) => !filter.kelompokId || k.kelompokId === filter.kelompokId)
    .map((k) => ({ value: k.id, label: k.nama }));
  // Kategori induk hanya ada di pengeluaran
  const pakaiInduk = !filter.tipe || filter.tipe === "keluar";
  const kelompokOptions = (kelompok.data ?? []).map((g) => ({ value: g.id, label: g.nama }));
  const setKelompok = (v: string) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (v) next.set("kelompokId", v);
        else next.delete("kelompokId");
        // Sub kategori lama mungkin tidak ada di induk baru
        next.delete("kategoriId");
        return next;
      },
      { replace: true },
    );

  return (
    <>
      <PageHeader title="Riwayat" />
      <div className="mb-4 flex flex-col gap-3">
        <label className="relative block">
          <span className="sr-only">Cari deskripsi</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-stone-400" aria-hidden />
          <input
            type="search"
            value={cari}
            onChange={(e) => setCari(e.target.value)}
            placeholder="Cari deskripsi"
            className="min-h-11 w-full rounded-xl border border-garis bg-white pr-3 pl-10 text-base placeholder:text-stone-400 focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 focus:outline-none"
          />
        </label>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {periodeId && (
            <FilterChip
              label="Periode"
              wajib
              value={periodeId}
              options={[
                ...(periodeList.data ?? []).map((p) => ({ value: p.id, label: p.aktif ? `${p.nama} (ini)` : p.nama })),
                { value: SEMUA, label: "Semua periode" },
              ]}
              onChange={(v) => setFilter("periode", v)}
            />
          )}
          <FilterChip
            label="Akun"
            value={filter.akunId}
            options={(akun.data ?? []).map((a) => ({ value: a.id, label: a.nama }))}
            onChange={(v) => setFilter("akunId", v)}
          />
          <FilterChip label="Tipe" value={filter.tipe} options={TIPE} onChange={(v) => setFilter("tipe", v)} />
          {pakaiInduk && <FilterChip label="Kategori" value={filter.kelompokId} options={kelompokOptions} onChange={setKelompok} />}
          <FilterChip
            label={filter.tipe === "masuk" ? "Kategori" : "Sub kategori"}
            value={filter.kategoriId}
            options={kategoriOptions}
            onChange={(v) => setFilter("kategoriId", v)}
          />
          <TanggalChip dari={filter.dari} sampai={filter.sampai} onOpen={() => setPilihTanggal(true)} onClear={() => setRentang("", "")} />
        </div>
      </div>
      {isi}
      <BottomSheet open={pilihTanggal} onClose={() => setPilihTanggal(false)} title="Rentang tanggal">
        {pilihTanggal && (
          <RentangForm
            dari={filter.dari}
            sampai={filter.sampai}
            onApply={(d, s) => {
              setRentang(d, s);
              setPilihTanggal(false);
            }}
          />
        )}
      </BottomSheet>
    </>
  );
}
