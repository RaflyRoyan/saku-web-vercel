import { useState } from "react";
import { ChipPicker } from "../ui/ChipPicker";
import { LAINNYA, useKelompokKategori, type Kategori } from "../../hooks/useMaster";

interface Props {
  /** Sub kategori pengeluaran yang boleh dipilih (sudah difilter aktif/sistem oleh pemanggil). */
  kategori: Kategori[];
  value: string | null;
  onChange: (kategoriId: string | null) => void;
  error?: string[] | string;
}

/**
 * Pilih kategori pengeluaran dua langkah: kategori induk dulu, lalu sub kategori.
 * Induk diambil dari sub kategori yang tersedia, jadi induk tanpa sub tidak tampil.
 */
export function KategoriBertingkat({ kategori, value, onChange, error }: Props) {
  const kelompok = useKelompokKategori(true);
  const indukDari = (k: Kategori) => k.kelompokId ?? LAINNYA;
  const [induk, setInduk] = useState<string | null>(() => {
    const k = kategori.find((x) => x.id === value);
    return k ? indukDari(k) : null;
  });

  // Urut seperti di Master ("Lainnya" terakhir); sebelum daftar induk termuat, urut nama
  const posisi = new Map((kelompok.data ?? []).map((g, i) => [g.id, i]));
  const rank = (id: string) => posisi.get(id) ?? Number.MAX_SAFE_INTEGER;
  const opsiInduk = [...new Map(kategori.map((k) => [indukDari(k), k.kelompokNama ?? "Lainnya"]))]
    .sort(([a, na], [b, nb]) => rank(a) - rank(b) || na.localeCompare(nb, "id"))
    .map(([id, nama]) => ({ value: id, label: nama }));
  const sub = induk ? kategori.filter((k) => indukDari(k) === induk) : [];

  return (
    <>
      <ChipPicker
        label="Kategori"
        value={induk}
        options={opsiInduk}
        onChange={(id) => {
          if (id === induk) return;
          setInduk(id);
          // Hanya satu sub → langsung terpilih
          const isi = kategori.filter((k) => indukDari(k) === id);
          onChange(isi.length === 1 ? isi[0].id : null);
        }}
        error={!induk ? error : undefined}
      />
      {induk && (
        <ChipPicker
          label="Sub kategori"
          value={value}
          options={sub.map((k) => ({ value: k.id, label: k.nama }))}
          onChange={onChange}
          error={error}
        />
      )}
    </>
  );
}
