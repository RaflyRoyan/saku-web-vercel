import { TriangleAlert } from "lucide-react";
import { useAnggaran, type PosAnggaran } from "../../hooks/useAnggaran";
import { formatRupiah } from "../../lib/format";

interface Props {
  periodeId: string | undefined;
  kategoriId: string | null;
  /** Kategori induk sub kategori ini ("LAINNYA" kalau tanpa induk). */
  kelompokId: string | null;
  nominal: number;
  /** Saat edit: nominal lama yang sudah terhitung di sub kategori ini, supaya tidak dihitung dua kali. */
  nominalLama: number;
  /** Saat edit: nominal lama yang sudah terhitung di kategori induk ini. */
  nominalLamaKelompok: number;
}

/** Sisa anggaran sub kategori & kategori induknya di form transaksi, plus peringatan kalau nominal ini melewati batas. */
export function InfoAnggaran({ periodeId, kategoriId, kelompokId, nominal, nominalLama, nominalLamaKelompok }: Props) {
  const anggaran = useAnggaran(periodeId);
  if (!kategoriId || !anggaran.data?.ada) return null;
  const g = anggaran.data.kelompok.find((x) => x.kelompokId === (kelompokId ?? "LAINNYA"));
  const s = g?.sub.find((x) => x.kategoriId === kategoriId);

  const baris: { label: string; sisa: number; lewat: number }[] = [];
  const tambah = (label: string, p: PosAnggaran | undefined, lama: number) => {
    if (!p || p.anggaran === null) return;
    const sisa = p.anggaran - p.terpakai + lama;
    baris.push({ label, sisa, lewat: nominal - sisa });
  };
  tambah(s?.nama ?? "", s, nominalLama);
  tambah(`kategori ${g?.nama ?? ""}`, g, nominalLamaKelompok);
  if (!baris.length) return null;

  const lewat = baris.filter((b) => b.lewat > 0);
  return (
    <div className="-mt-2 flex flex-col gap-1">
      {baris.map((b) => (
        <p key={b.label} className="text-sm text-stone-500">
          Sisa anggaran {b.label}{" "}
          <span className={`font-semibold ${b.sisa < 0 ? "text-keluar" : "text-stone-700"}`}>{formatRupiah(b.sisa)}</span>
        </p>
      ))}
      {lewat.length > 0 && (
        <p role="alert" className="mt-1 flex items-start gap-2 rounded-xl bg-rose-50 px-3 py-2 text-sm font-semibold text-keluar">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {lewat.map((b) => `Melebihi anggaran ${b.label} ${formatRupiah(b.lewat)}.`).join(" ")} Transaksi tetap bisa disimpan.
          </span>
        </p>
      )}
    </div>
  );
}
