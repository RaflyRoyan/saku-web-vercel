import { useState, type ReactNode } from "react";
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Banknote, ChevronDown, ChevronUp, GripVertical, Landmark, Plus, Tags, Wallet, type LucideIcon } from "lucide-react";
import PageHeader from "../components/layout/PageHeader";
import { BottomSheet } from "../components/ui/BottomSheet";
import { Button, fokus } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { FormError } from "../components/ui/FormError";
import { Input, Select, Switch } from "../components/ui/Input";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { EmptyState, ErrorState, ListSkeleton } from "../components/ui/States";
import { useMe } from "../hooks/useAuth";
import {
  LAINNYA,
  masterKeys,
  useAkun,
  useKategori,
  useKelompokKategori,
  type Akun,
  type JenisAkun,
  type Kategori,
  type KelompokKategori,
  type TipeKategori,
} from "../hooks/useMaster";
import { invalidateKeuangan } from "../hooks/useTransaksi";
import { useToast } from "../hooks/useToast";
import { ApiError, send } from "../lib/api";
import { formatRupiah } from "../lib/format";

const JENIS: Record<JenisAkun, { label: string; icon: LucideIcon }> = {
  bank: { label: "Bank", icon: Landmark },
  ewallet: { label: "E-Wallet", icon: Wallet },
  cash: { label: "Cash", icon: Banknote },
};
const JENIS_OPTIONS = (Object.keys(JENIS) as JenisAkun[]).map((value) => ({ value, label: JENIS[value].label }));

function Badge({ children }: { children: ReactNode }) {
  return <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">{children}</span>;
}

/** Item nonaktif dikelompokkan di bawah dalam bagian yang bisa dibuka (02 §6.10). */
function NonaktifGroup({ count, children }: { count: number; children: ReactNode }) {
  if (count === 0) return null;
  return (
    <details className="group mt-4">
      <summary className={`flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-xl px-1 text-sm font-semibold text-stone-500 ${fokus}`}>
        <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
        Nonaktif ({count})
      </summary>
      <Card className="mt-2 divide-y divide-garis overflow-hidden opacity-75">{children}</Card>
    </details>
  );
}

// ---------------- Akun ----------------

function AkunRow({ akun, isAdmin, onEdit, move }: {
  akun: Akun;
  isAdmin: boolean;
  onEdit: () => void;
  move?: { up?: () => void; down?: () => void; pending: boolean };
}) {
  const { icon: Icon, label } = JENIS[akun.jenis] ?? JENIS.bank;
  const saldo =
    akun.saldo === null ? (
      <span className="text-sm text-stone-400">—</span>
    ) : (
      <span className={`text-base font-bold tabular-nums ${akun.saldo < 0 ? "text-keluar" : ""}`}>{formatRupiah(akun.saldo)}</span>
    );
  const body = (
    <>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600">
        <Icon className="size-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{akun.nama}</span>
        <span className="block text-sm text-stone-500">{label}</span>
      </span>
      {saldo}
    </>
  );

  return (
    <div className="flex items-center">
      {isAdmin ? (
        <button type="button" onClick={onEdit} className={`flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left hover:bg-brand-50 ${fokus}`}>
          {body}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3">{body}</div>
      )}
      {move && (
        <div className="flex pr-1">
          <button
            type="button"
            onClick={move.up}
            disabled={!move.up || move.pending}
            aria-label={`Naikkan ${akun.nama}`}
            className={`flex size-11 items-center justify-center rounded-lg text-stone-500 hover:bg-brand-50 disabled:opacity-30 ${fokus}`}
          >
            <ChevronUp className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={move.down}
            disabled={!move.down || move.pending}
            aria-label={`Turunkan ${akun.nama}`}
            className={`flex size-11 items-center justify-center rounded-lg text-stone-500 hover:bg-brand-50 disabled:opacity-30 ${fokus}`}
          >
            <ChevronDown className="size-4" aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}

function AkunForm({ akun, nextUrutan, onDone }: { akun: Akun | null; nextUrutan: number; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({ nama: akun?.nama ?? "", jenis: akun?.jenis ?? ("bank" as JenisAkun), aktif: akun?.aktif ?? true });

  const simpan = useMutation({
    mutationFn: async () => {
      if (!akun) return send("POST", "/akun", { nama: form.nama, jenis: form.jenis, urutan: nextUrutan });
      // Ubah aktif dulu: kalau ditolak (saldo ≠ 0), nama/jenis juga tidak berubah
      if (form.aktif !== akun.aktif) await send("PUT", `/akun/${akun.id}/aktif`, { aktif: form.aktif });
      return send("PUT", `/akun/${akun.id}`, { nama: form.nama, jenis: form.jenis, urutan: akun.urutan });
    },
    onSuccess: () => {
      invalidateKeuangan(qc); // nama/urutan akun tampil di ringkasan, riwayat, langganan
      toast.show(akun ? "Akun disimpan" : "Akun ditambahkan");
      onDone();
    },
  });
  const err = simpan.error instanceof ApiError ? simpan.error : null;

  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        simpan.mutate();
      }}
    >
      <Input label="Nama akun" value={form.nama} onChange={(e) => setForm((f) => ({ ...f, nama: e.target.value }))} error={err?.errors?.nama} autoFocus={!akun} maxLength={40} />
      <Select label="Jenis" value={form.jenis} onChange={(e) => setForm((f) => ({ ...f, jenis: e.target.value as JenisAkun }))} options={JENIS_OPTIONS} error={err?.errors?.jenis} />
      {akun && <Switch label="Aktif" checked={form.aktif} onChange={(aktif) => setForm((f) => ({ ...f, aktif }))} />}
      {akun && !form.aktif && akun.aktif && (
        <p className="-mt-2 text-xs text-stone-500">Akun hanya bisa dinonaktifkan kalau saldonya Rp 0 di semua pengguna.</p>
      )}
      <FormError error={simpan.error} />
      <Button type="submit" block loading={simpan.isPending}>
        {akun ? "Simpan" : "Tambah akun"}
      </Button>
    </form>
  );
}

function AkunTab({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useAkun(isAdmin);
  const [sheet, setSheet] = useState<{ akun: Akun | null } | null>(null);

  const urutkan = useMutation({
    mutationFn: (ids: string[]) => send("PUT", "/akun/urutan", { ids }),
    onSettled: () => invalidateKeuangan(qc),
    onError: (e) => toast.show(e instanceof ApiError ? e.title : "Gagal mengubah urutan.", "error"),
  });

  if (q.isPending) return <ListSkeleton />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;

  const aktif = q.data.filter((a) => a.aktif);
  const nonaktif = q.data.filter((a) => !a.aktif);
  const nextUrutan = Math.max(0, ...q.data.map((a) => a.urutan)) + 1;
  const swap = (i: number, j: number) => {
    const ids = aktif.map((a) => a.id);
    [ids[i], ids[j]] = [ids[j], ids[i]];
    urutkan.mutate(ids);
  };
  const addButton = isAdmin && (
    <Button onClick={() => setSheet({ akun: null })}>
      <Plus className="size-4" aria-hidden />
      Tambah akun
    </Button>
  );

  return (
    <>
      {aktif.length === 0 ? (
        <EmptyState icon={Wallet} title={isAdmin ? "Belum ada akun. Tambahkan rekening bank, e-wallet, atau cash." : "Belum ada akun. Minta admin menambahkannya."} action={addButton} />
      ) : (
        <>
          {isAdmin && <div className="mb-3 flex justify-end">{addButton}</div>}
          <Card className="divide-y divide-garis overflow-hidden">
            {aktif.map((a, i) => (
              <AkunRow
                key={a.id}
                akun={a}
                isAdmin={isAdmin}
                onEdit={() => setSheet({ akun: a })}
                move={
                  isAdmin
                    ? { up: i > 0 ? () => swap(i, i - 1) : undefined, down: i < aktif.length - 1 ? () => swap(i, i + 1) : undefined, pending: urutkan.isPending }
                    : undefined
                }
              />
            ))}
          </Card>
          {aktif[0]?.saldo === null && <p className="mt-3 px-1 text-sm text-stone-500">Saldo tampil setelah kamu memulai periode.</p>}
        </>
      )}
      <NonaktifGroup count={nonaktif.length}>
        {nonaktif.map((a) => (
          <AkunRow key={a.id} akun={a} isAdmin={isAdmin} onEdit={() => setSheet({ akun: a })} />
        ))}
      </NonaktifGroup>

      <BottomSheet open={sheet !== null} onClose={() => setSheet(null)} title={sheet?.akun ? "Ubah akun" : "Tambah akun"}>
        {sheet && <AkunForm key={sheet.akun?.id ?? "baru"} akun={sheet.akun} nextUrutan={nextUrutan} onDone={() => setSheet(null)} />}
      </BottomSheet>
    </>
  );
}

// ---------------- Kategori ----------------

function KategoriRow({ k, isAdmin, onEdit }: { k: Kategori; isAdmin: boolean; onEdit: () => void }) {
  const body = (
    <>
      <span className="min-w-0 flex-1 truncate font-semibold">{k.nama}</span>
      {k.kodeSistem && <Badge>Sistem</Badge>}
    </>
  );
  return isAdmin ? (
    <button type="button" onClick={onEdit} className={`flex min-h-14 w-full items-center gap-3 px-4 text-left hover:bg-brand-50 ${fokus}`}>
      {body}
    </button>
  ) : (
    <div className="flex min-h-14 items-center gap-3 px-4">{body}</div>
  );
}

/** Form kategori pemasukan, atau sub kategori pengeluaran (dengan pilihan kategori induk). */
function KategoriForm({
  kategori,
  tipe,
  kelompokAwal,
  kelompok,
  onDone,
}: {
  kategori: Kategori | null;
  tipe: TipeKategori;
  kelompokAwal: string;
  kelompok: KelompokKategori[];
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [nama, setNama] = useState(kategori?.nama ?? "");
  const [aktif, setAktif] = useState(kategori?.aktif ?? true);
  const [kelompokId, setKelompokId] = useState(kategori?.kelompokId ?? kelompokAwal);
  const keluar = tipe === "keluar";
  const label = keluar ? "sub kategori" : "kategori";

  const simpan = useMutation({
    mutationFn: async () => {
      const k = keluar ? { kelompokId } : {};
      if (!kategori) return send("POST", "/kategori", { nama, tipe, ...k });
      if (aktif !== kategori.aktif) await send("PUT", `/kategori/${kategori.id}/aktif`, { aktif });
      return send("PUT", `/kategori/${kategori.id}`, { nama, ...k });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: masterKeys.kategori });
      invalidateKeuangan(qc);
      toast.show(kategori ? `${kapital(label)} disimpan` : `${kapital(label)} ditambahkan`);
      onDone();
    },
  });
  // Induk nonaktif tetap tampil kalau sedang dipakai sub kategori ini
  const opsiInduk = kelompok.filter((g) => g.aktif || g.id === kategori?.kelompokId).map((g) => ({ value: g.id, label: g.nama }));
  const err = simpan.error instanceof ApiError ? simpan.error : null;
  const sistem = Boolean(kategori?.kodeSistem);

  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        simpan.mutate();
      }}
    >
      <Input label={`Nama ${label}`} value={nama} onChange={(e) => setNama(e.target.value)} error={err?.errors?.nama} autoFocus={!kategori} maxLength={40} />
      {keluar ? (
        <Select label="Kategori" value={kelompokId} onChange={(e) => setKelompokId(e.target.value)} options={opsiInduk} error={err?.errors?.kelompokId} />
      ) : (
        <Input label="Tipe" value="Pemasukan" readOnly disabled />
      )}
      {kategori && (
        <Switch
          label="Aktif"
          checked={aktif}
          onChange={setAktif}
          disabled={sistem}
          title={sistem ? "Kategori sistem tidak bisa dinonaktifkan." : undefined}
        />
      )}
      {sistem && <p className="-mt-2 text-xs text-stone-500">Kategori sistem dipakai otomatis oleh aplikasi dan tidak bisa dinonaktifkan.</p>}
      <FormError error={simpan.error} />
      <Button type="submit" block loading={simpan.isPending}>
        {kategori ? "Simpan" : `Tambah ${label}`}
      </Button>
    </form>
  );
}

const kapital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Form kategori induk pengeluaran (KelompokKategori). */
function KelompokForm({ kelompok, onDone }: { kelompok: KelompokKategori | null; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [nama, setNama] = useState(kelompok?.nama ?? "");
  const [aktif, setAktif] = useState(kelompok?.aktif ?? true);

  const simpan = useMutation({
    mutationFn: async () => {
      if (!kelompok) return send("POST", "/kelompok-kategori", { nama });
      if (aktif !== kelompok.aktif) await send("PUT", `/kelompok-kategori/${kelompok.id}/aktif`, { aktif });
      return send("PUT", `/kelompok-kategori/${kelompok.id}`, { nama });
    },
    onSuccess: () => {
      invalidateKategori(qc);
      toast.show(kelompok ? "Kategori disimpan" : "Kategori ditambahkan");
      onDone();
    },
  });
  const err = simpan.error instanceof ApiError ? simpan.error : null;

  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        simpan.mutate();
      }}
    >
      <Input label="Nama kategori" value={nama} onChange={(e) => setNama(e.target.value)} error={err?.errors?.nama} autoFocus={!kelompok} maxLength={40} />
      <p className="-mt-2 text-xs text-stone-500">Contoh: Tempat Tinggal, Makan & Minum, Transportasi. Sub kategori dikelompokkan di bawahnya.</p>
      {kelompok && <Switch label="Aktif" checked={aktif} onChange={setAktif} />}
      <FormError error={simpan.error} />
      <Button type="submit" block loading={simpan.isPending}>
        {kelompok ? "Simpan" : "Tambah kategori"}
      </Button>
    </form>
  );
}

function invalidateKategori(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: masterKeys.kelompok });
  qc.invalidateQueries({ queryKey: masterKeys.kategori });
  invalidateKeuangan(qc);
}

/** Satu kartu kategori induk + sub kategorinya. Admin: pegangan geser di kanan judul (kecuali "Lainnya"). */
function KelompokCard({
  g,
  subs,
  isAdmin,
  onEdit,
  onTambahSub,
  onEditSub,
}: {
  g: KelompokKategori;
  subs: Kategori[];
  isAdmin: boolean;
  onEdit: () => void;
  onTambahSub: () => void;
  onEditSub: (k: Kategori) => void;
}) {
  const geser = isAdmin && !g.sistem;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: g.id, disabled: !geser });
  return (
    <section ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`relative ${isDragging ? "z-10" : ""}`}>
      <Card className={`overflow-hidden ${isDragging ? "shadow-lg" : ""}`}>
        <div className="flex min-h-12 items-center gap-2 border-b border-garis bg-brand-50/50 pl-4">
          {isAdmin && !g.sistem ? (
            <button type="button" onClick={onEdit} className={`min-w-0 flex-1 truncate py-3 text-left font-bold hover:text-brand-700 ${fokus}`}>
              {g.nama}
            </button>
          ) : (
            <h3 className="min-w-0 flex-1 truncate py-3 font-bold">{g.nama}</h3>
          )}
          <span className="shrink-0 text-xs text-stone-500">{subs.length} sub</span>
          {isAdmin && (
            <button type="button" onClick={onTambahSub} aria-label={`Tambah sub kategori di ${g.nama}`} className={iconBtn}>
              <Plus className="size-4" aria-hidden />
            </button>
          )}
          {geser ? (
            <button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label={`Geser ${g.nama}`} className={`${iconBtn} cursor-grab touch-none active:cursor-grabbing`}>
              <GripVertical className="size-5" aria-hidden />
            </button>
          ) : (
            isAdmin && <span className="size-11 shrink-0" aria-hidden />
          )}
        </div>
        {subs.length === 0 ? (
          <p className="px-4 py-3 text-sm text-stone-500">Belum ada sub kategori.</p>
        ) : (
          <div className="divide-y divide-garis">
            {subs.map((k) => (
              <KategoriRow key={k.id} k={k} isAdmin={isAdmin} onEdit={() => onEditSub(k)} />
            ))}
          </div>
        )}
      </Card>
    </section>
  );
}

const iconBtn = `flex size-11 shrink-0 items-center justify-center rounded-lg text-stone-500 hover:bg-brand-50 ${fokus}`;

type SheetKategori = { jenis: "sub"; kategori: Kategori | null; kelompokAwal: string } | { jenis: "kelompok"; kelompok: KelompokKategori | null };

function KategoriKeluar({ isAdmin, kategori }: { isAdmin: boolean; kategori: Kategori[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useKelompokKategori(isAdmin);
  const [sheet, setSheet] = useState<SheetKategori | null>(null);
  const [urutLokal, setUrutLokal] = useState<string[] | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const urutkan = useMutation({
    mutationFn: (ids: string[]) => send("PUT", "/kelompok-kategori/urutan", { ids }),
    onSettled: () => {
      setUrutLokal(null);
      invalidateKategori(qc);
    },
    onError: (e) => toast.show(e instanceof ApiError ? e.title : "Gagal mengubah urutan.", "error"),
  });
  const bawaan = useMutation({
    mutationFn: () => send<{ ditambah: number }>("POST", "/kelompok-kategori/bawaan"),
    onSuccess: (res) => {
      invalidateKategori(qc);
      toast.show(res.ditambah ? `${res.ditambah} kategori ditambahkan` : "Semua kategori bawaan sudah ada");
    },
  });

  if (q.isPending) return <ListSkeleton />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;

  const aktifG = q.data.filter((g) => g.aktif);
  const nonaktifG = q.data.filter((g) => !g.aktif);
  const byId = new Map(aktifG.map((g) => [g.id, g]));
  const tampil = urutLokal ? urutLokal.map((id) => byId.get(id)!).filter(Boolean) : aktifG;
  const subAktif = kategori.filter((k) => k.aktif);
  const subNonaktif = kategori.filter((k) => !k.aktif);
  const subDari = (id: string) => subAktif.filter((k) => (k.kelompokId ?? LAINNYA) === id);
  const opsiInduk = q.data;

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id || over.id === LAINNYA) return;
    const ids = tampil.map((g) => g.id);
    const next = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
    setUrutLokal(next);
    urutkan.mutate(next.filter((id) => id !== LAINNYA));
  };

  return (
    <>
      {isAdmin && (
        <div className="mb-3 flex flex-wrap justify-end gap-2">
          {aktifG.length <= 1 && (
            <Button variant="secondary" onClick={() => bawaan.mutate()} loading={bawaan.isPending}>
              Tambah kategori bawaan
            </Button>
          )}
          <Button onClick={() => setSheet({ jenis: "kelompok", kelompok: null })}>
            <Plus className="size-4" aria-hidden />
            Tambah kategori
          </Button>
        </div>
      )}
      {isAdmin && aktifG.length > 2 && <p className="mb-3 px-1 text-xs text-stone-500">Tahan & geser ikon di kanan judul untuk mengatur urutan kategori.</p>}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={tampil.map((g) => g.id)} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-3">
            {tampil.map((g) => (
              <KelompokCard
                key={g.id}
                g={g}
                subs={subDari(g.id)}
                isAdmin={isAdmin}
                onEdit={() => setSheet({ jenis: "kelompok", kelompok: g })}
                onTambahSub={() => setSheet({ jenis: "sub", kategori: null, kelompokAwal: g.id })}
                onEditSub={(k) => setSheet({ jenis: "sub", kategori: k, kelompokAwal: g.id })}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <NonaktifGroup count={nonaktifG.length + subNonaktif.length}>
        {nonaktifG.map((g) => (
          <KelompokNonaktifRow key={g.id} g={g} onEdit={() => setSheet({ jenis: "kelompok", kelompok: g })} />
        ))}
        {subNonaktif.map((k) => (
          <KategoriRow key={k.id} k={k} isAdmin={isAdmin} onEdit={() => setSheet({ jenis: "sub", kategori: k, kelompokAwal: k.kelompokId ?? LAINNYA })} />
        ))}
      </NonaktifGroup>

      <BottomSheet
        open={sheet !== null}
        onClose={() => setSheet(null)}
        title={
          sheet?.jenis === "kelompok"
            ? sheet.kelompok
              ? "Ubah kategori"
              : "Tambah kategori"
            : sheet?.kategori
              ? "Ubah sub kategori"
              : "Tambah sub kategori"
        }
      >
        {sheet?.jenis === "kelompok" && <KelompokForm key={sheet.kelompok?.id ?? "baru"} kelompok={sheet.kelompok} onDone={() => setSheet(null)} />}
        {sheet?.jenis === "sub" && (
          <KategoriForm
            key={sheet.kategori?.id ?? `baru-${sheet.kelompokAwal}`}
            kategori={sheet.kategori}
            tipe="keluar"
            kelompokAwal={sheet.kelompokAwal}
            kelompok={opsiInduk}
            onDone={() => setSheet(null)}
          />
        )}
      </BottomSheet>
    </>
  );
}

function KelompokNonaktifRow({ g, onEdit }: { g: KelompokKategori; onEdit: () => void }) {
  return (
    <button type="button" onClick={onEdit} className={`flex min-h-14 w-full items-center gap-3 px-4 text-left hover:bg-brand-50 ${fokus}`}>
      <span className="min-w-0 flex-1 truncate font-bold">{g.nama}</span>
      <Badge>Kategori</Badge>
    </button>
  );
}

function KategoriTab({ isAdmin }: { isAdmin: boolean }) {
  const q = useKategori(isAdmin);
  const [tipe, setTipe] = useState<TipeKategori>("keluar");
  const [sheet, setSheet] = useState<{ kategori: Kategori | null } | null>(null);

  const list = q.data?.filter((k) => k.tipe === tipe) ?? [];
  const aktif = list.filter((k) => k.aktif);
  const nonaktif = list.filter((k) => !k.aktif);
  const addButton = isAdmin && (
    <Button onClick={() => setSheet({ kategori: null })}>
      <Plus className="size-4" aria-hidden />
      Tambah kategori
    </Button>
  );

  return (
    <>
      <div className="mb-3 flex items-center gap-3">
        <div className="flex-1">
          <SegmentedControl
            label="Tipe kategori"
            value={tipe}
            onChange={setTipe}
            options={[
              { value: "keluar", label: "Keluar" },
              { value: "masuk", label: "Masuk" },
            ]}
          />
        </div>
        {tipe === "masuk" && aktif.length > 0 && addButton}
      </div>

      {tipe === "keluar" ? (
        q.isPending ? (
          <ListSkeleton />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : (
          <KategoriKeluar isAdmin={isAdmin} kategori={list} />
        )
      ) : q.isPending ? (
        <ListSkeleton />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : aktif.length === 0 ? (
        <EmptyState icon={Tags} title="Belum ada kategori." action={addButton} />
      ) : (
        <Card className="divide-y divide-garis overflow-hidden">
          {aktif.map((k) => (
            <KategoriRow key={k.id} k={k} isAdmin={isAdmin} onEdit={() => setSheet({ kategori: k })} />
          ))}
        </Card>
      )}
      {tipe === "masuk" && (
        <NonaktifGroup count={nonaktif.length}>
          {nonaktif.map((k) => (
            <KategoriRow key={k.id} k={k} isAdmin={isAdmin} onEdit={() => setSheet({ kategori: k })} />
          ))}
        </NonaktifGroup>
      )}

      <BottomSheet open={sheet !== null} onClose={() => setSheet(null)} title={sheet?.kategori ? "Ubah kategori" : "Tambah kategori"}>
        {sheet && (
          <KategoriForm key={sheet.kategori?.id ?? "baru-masuk"} kategori={sheet.kategori} tipe="masuk" kelompokAwal={LAINNYA} kelompok={[]} onDone={() => setSheet(null)} />
        )}
      </BottomSheet>
    </>
  );
}

// ---------------- Halaman ----------------

type Tab = "akun" | "kategori";

export default function MasterPage() {
  const { data: me } = useMe();
  const isAdmin = me?.peran === "admin";
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get("tab") === "kategori" ? "kategori" : "akun";

  return (
    <>
      <PageHeader title="Master" />
      <div className="flex flex-col gap-4">
        <SegmentedControl
          label="Data master"
          value={tab}
          onChange={(t) => setParams(t === "akun" ? {} : { tab: t }, { replace: true })}
          options={[
            { value: "akun", label: "Akun" },
            { value: "kategori", label: "Kategori" },
          ]}
        />
        {!isAdmin && <p className="px-1 text-sm text-stone-500">Akun dan kategori dipakai bersama semua pengguna. Hanya admin yang bisa mengubahnya.</p>}
        <div>{tab === "akun" ? <AkunTab isAdmin={isAdmin} /> : <KategoriTab isAdmin={isAdmin} />}</div>
      </div>
    </>
  );
}
