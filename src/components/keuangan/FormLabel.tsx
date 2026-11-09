import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Tag } from "lucide-react";
import { setLabelTransaksi, transaksiKeys, useLabelList } from "../../hooks/useTransaksi";
import { useToast } from "../../hooks/useToast";
import { ApiError } from "../../lib/api";
import { Button, fokus } from "../ui/Button";
import { FormError } from "../ui/FormError";
import { Input } from "../ui/Input";

export const MAKS_LABEL = 50;

/** Isi BottomSheet "Beri label": ketik label baru atau pilih label yang sudah ada. */
export function FormLabel({ ids, labelAwal, onSelesai }: { ids: string[]; labelAwal: string; onSelesai: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const daftar = useLabelList();
  const [label, setLabel] = useState(labelAwal);
  const cari = label.trim().toLowerCase();
  const saran = (daftar.data ?? []).filter((l) => !cari || l.label.toLowerCase().includes(cari)).slice(0, 8);

  const simpan = useMutation({
    mutationFn: (v: string | null) => setLabelTransaksi(ids, v),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: transaksiKeys.all });
      toast.show(res.label ? `${res.jumlah} transaksi diberi label ${res.label}` : `Label ${res.jumlah} transaksi dihapus`);
      onSelesai();
    },
  });
  const fe = simpan.error instanceof ApiError ? simpan.error.errors : undefined;

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (label.trim()) simpan.mutate(label);
      }}
    >
      <p className="text-sm text-stone-500">{ids.length} transaksi dipilih.</p>
      <Input label="Label" value={label} maxLength={MAKS_LABEL} autoFocus placeholder="mis. Liburan Jogja" onChange={(e) => setLabel(e.target.value)} error={fe?.label} />
      {saran.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {saran.map((l) => (
            <button
              key={l.label}
              type="button"
              onClick={() => setLabel(l.label)}
              className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border border-garis bg-white px-4 text-sm font-semibold text-stone-700 hover:bg-brand-50 ${fokus}`}
            >
              <Tag className="size-3.5 text-brand-600" aria-hidden />
              {l.label}
              <span className="font-normal text-stone-400">{l.jumlah}</span>
            </button>
          ))}
        </div>
      )}
      {!fe && <FormError error={simpan.error} />}
      <div className="flex gap-2">
        <Button variant="secondary" block kirim loading={simpan.isPending && simpan.variables === null} onClick={() => simpan.mutate(null)}>
          Hapus label
        </Button>
        <Button type="submit" block loading={simpan.isPending && simpan.variables !== null} disabled={!label.trim()}>
          Simpan
        </Button>
      </div>
    </form>
  );
}
