import { useRef, type MouseEvent, type PointerEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Check, Tag } from "lucide-react";
import type { Transaksi } from "../../hooks/useTransaksi";
import { formatGrupTanggal, formatRupiah, formatRupiahRingkas, formatTanggal } from "../../lib/format";
import { fokus } from "../ui/Button";
import { AmountText } from "./AmountText";

const IKON = {
  keluar: { icon: ArrowUpRight, cls: "bg-rose-50 text-keluar" },
  masuk: { icon: ArrowDownLeft, cls: "bg-emerald-50 text-masuk" },
  transfer: { icon: ArrowLeftRight, cls: "bg-violet-50 text-transfer" },
} as const;

/** Mode pilih banyak di Riwayat. `ids` null = belum aktif (tekan lama untuk mulai). */
export interface PilihTransaksi {
  ids: ReadonlySet<string> | null;
  toggle: (id: string) => void;
  mulai: (id: string) => void;
}

const TEKAN_LAMA_MS = 500;

/**
 * Klik yang muncul saat jari diangkat setelah tekan lama dibuang. Baris sudah berganti jadi checkbox,
 * jadi klik itu akan langsung membatalkan pilihan (atau membuka transaksi) kalau dibiarkan.
 */
function buangKlikBerikutnya() {
  const buang = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    selesai();
  };
  const selesai = () => {
    window.removeEventListener("click", buang, true);
    window.clearTimeout(batas);
  };
  window.addEventListener("click", buang, true);
  const batas = window.setTimeout(selesai, 1000);
}

/** Tekan lama (sentuh/mouse) → callback; klik sesudahnya dibuang supaya tidak membuka transaksi. */
function useTekanLama(onLama: (() => void) | undefined) {
  const timer = useRef<number | undefined>(undefined);
  const awal = useRef<{ x: number; y: number } | null>(null);
  if (!onLama) return {};
  const batal = () => {
    window.clearTimeout(timer.current);
    awal.current = null;
  };
  return {
    onPointerDown: (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      awal.current = { x: e.clientX, y: e.clientY };
      timer.current = window.setTimeout(() => {
        buangKlikBerikutnya();
        navigator.vibrate?.(15);
        onLama();
      }, TEKAN_LAMA_MS);
    },
    onPointerMove: (e: PointerEvent) => {
      // Geser (scroll) membatalkan tekan lama
      if (awal.current && Math.hypot(e.clientX - awal.current.x, e.clientY - awal.current.y) > 10) batal();
    },
    onPointerUp: batal,
    onPointerLeave: batal,
    onPointerCancel: batal,
    onContextMenu: (e: MouseEvent) => e.preventDefault(),
  };
}

/** Satu baris transaksi (02 §5.3). Tap → form edit; tarik tabungan → halaman Tabungan. Dengan `pilih`: tekan lama untuk memilih. */
export function TransaksiItem({ t, pilih }: { t: Transaksi; pilih?: PilihTransaksi }) {
  const tekanLama = useTekanLama(pilih && !pilih.ids ? () => pilih.mulai(t.id) : undefined);
  const { icon: Icon, cls } = IKON[t.tipe];
  const tarik = t.kodeSistem === "TARIK_TABUNGAN";
  const rute = `${t.akunNama} → ${t.akunTujuanNama}`;
  const judul = t.deskripsi || (t.tipe === "transfer" ? rute : (t.kategoriNama ?? "Tanpa kategori"));
  const detail =
    t.tipe === "transfer"
      ? [t.deskripsi ? rute : "Transfer", t.biayaAdmin ? `admin ${formatRupiah(t.biayaAdmin)}` : ""]
      : [t.kategoriNama, t.akunNama];

  const isi = (
    <>
      <span className={`flex size-10 shrink-0 items-center justify-center rounded-full ${cls}`}>
        <Icon className="size-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate font-semibold">{judul}</span>
          {tarik && <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-tabungan">Tabungan</span>}
        </span>
        <span className="block truncate text-sm text-stone-500">{detail.filter(Boolean).join(" · ")}</span>
        {t.label && (
          <span className="mt-1 inline-flex max-w-full items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
            <Tag className="size-3 shrink-0" aria-hidden />
            <span className="truncate">{t.label}</span>
          </span>
        )}
      </span>
      <span className="flex shrink-0 flex-col items-end">
        <AmountText tipe={t.tipe} nominal={t.nominal} />
        <span className="text-xs text-stone-500">{formatTanggal(t.tanggal)}</span>
      </span>
    </>
  );

  if (pilih?.ids) {
    const dipilih = pilih.ids.has(t.id);
    return (
      <button
        type="button"
        role="checkbox"
        aria-checked={dipilih}
        onClick={() => pilih.toggle(t.id)}
        className={`flex w-full items-center gap-3 px-4 py-3 text-left ${dipilih ? "bg-brand-50" : "hover:bg-brand-50"} ${fokus}`}
      >
        <span className={`flex size-6 shrink-0 items-center justify-center rounded-md border-2 ${dipilih ? "border-brand-700 bg-brand-700 text-white" : "border-stone-300 bg-white"}`}>
          {dipilih && <Check className="size-4" aria-hidden />}
        </span>
        {isi}
      </button>
    );
  }

  return (
    <Link to={tarik ? "/tabungan" : `/transaksi/${t.id}`} className={`flex items-center gap-3 px-4 py-3 hover:bg-brand-50 ${pilih ? "select-none" : ""} ${fokus}`} {...tekanLama}>
      {isi}
    </Link>
  );
}

/** Daftar transaksi dikelompokkan per tanggal + total keluar hari itu (02 §6.6). */
export function TransaksiGroupList({ items, pilih }: { items: Transaksi[]; pilih?: PilihTransaksi }) {
  const groups: { tanggal: string; items: Transaksi[] }[] = [];
  for (const t of items) {
    const last = groups.at(-1);
    if (last?.tanggal === t.tanggal) last.items.push(t);
    else groups.push({ tanggal: t.tanggal, items: [t] });
  }
  return (
    <div className="flex flex-col gap-4">
      {groups.map((g) => {
        // Keluar hari itu = pengeluaran + biaya admin transfer
        const keluar = g.items.reduce((n, t) => n + (t.tipe === "keluar" ? t.nominal : t.biayaAdmin), 0);
        return (
          <section key={g.tanggal} aria-label={formatGrupTanggal(g.tanggal)}>
            <div className="mb-1.5 flex items-center justify-between px-1 text-sm">
              <h2 className="font-semibold text-stone-700">{formatGrupTanggal(g.tanggal)}</h2>
              {keluar > 0 && <span className="font-semibold text-keluar tabular-nums">−{formatRupiahRingkas(keluar)}</span>}
            </div>
            <div className="divide-y divide-garis overflow-hidden rounded-2xl border border-garis bg-white shadow-sm">
              {g.items.map((t) => (
                <TransaksiItem key={t.id} t={t} pilih={pilih} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
