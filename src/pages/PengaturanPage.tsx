import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CircleAlert, CircleCheck, GripVertical, LogOut } from "lucide-react";
import PageHeader from "../components/layout/PageHeader";
import { Button, fokus } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Input, PasswordInput } from "../components/ui/Input";
import { ErrorState, Skeleton } from "../components/ui/States";
import { authKeys, useLogout, useMe, type Pengguna } from "../hooks/useAuth";
import { usePilihanAkun, type PilihanAkun } from "../hooks/useMaster";
import { invalidateKeuangan } from "../hooks/useTransaksi";
import { useToast } from "../hooks/useToast";
import { ApiError, api, send } from "../lib/api";
import { formatRupiah } from "../lib/format";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="px-1 text-sm font-bold text-stone-500">{title}</h2>
      <Card className="flex flex-col gap-4 p-4">{children}</Card>
    </section>
  );
}

function ProfilForm({ me }: { me: Pengguna }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [nama, setNama] = useState(me.nama);
  const simpan = useMutation({
    mutationFn: () => send<Pengguna>("PUT", "/auth/profil", { nama }),
    onSuccess: (res) => {
      qc.setQueryData(authKeys.me, res);
      toast.show("Profil disimpan");
    },
  });
  const err = simpan.error instanceof ApiError ? simpan.error : null;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        simpan.mutate();
      }}
    >
      <Input label="Nama" value={nama} onChange={(e) => setNama(e.target.value)} error={err?.errors?.nama ?? (err && !err.errors ? err.title : undefined)} />
      <Input label="Username" value={me.username} readOnly disabled />
      <Input label="Peran" value={me.peran === "admin" ? "Admin" : "Pengguna"} readOnly disabled />
      <Button type="submit" loading={simpan.isPending} disabled={nama.trim() === me.nama} className="self-start">
        Simpan profil
      </Button>
    </form>
  );
}

function PasswordForm() {
  const toast = useToast();
  const empty = { passwordLama: "", passwordBaru: "", ulangi: "" };
  const [form, setForm] = useState(empty);
  const [ulangiError, setUlangiError] = useState<string>();
  const ganti = useMutation({
    mutationFn: () => send("PUT", "/auth/password", { passwordLama: form.passwordLama, passwordBaru: form.passwordBaru }),
    onSuccess: () => {
      setForm(empty);
      toast.show("Password diganti");
    },
  });
  const err = ganti.error instanceof ApiError ? ganti.error : null;
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  function submit(e: FormEvent) {
    e.preventDefault();
    if (form.passwordBaru !== form.ulangi) {
      setUlangiError("Password baru tidak sama.");
      return;
    }
    setUlangiError(undefined);
    ganti.mutate();
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
      <PasswordInput label="Password lama" autoComplete="current-password" value={form.passwordLama} onChange={set("passwordLama")} error={err?.errors?.passwordLama} />
      <PasswordInput
        label="Password baru"
        autoComplete="new-password"
        value={form.passwordBaru}
        onChange={set("passwordBaru")}
        error={err?.errors?.passwordBaru}
        hint="Minimal 8 karakter, berisi huruf dan angka."
      />
      <PasswordInput label="Ulangi password baru" autoComplete="new-password" value={form.ulangi} onChange={set("ulangi")} error={ulangiError} />
      {err && !err.errors && <p role="alert" className="text-sm text-keluar">{err.title}</p>}
      <Button
        type="submit"
        loading={ganti.isPending}
        disabled={!form.passwordLama || !form.passwordBaru || !form.ulangi}
        className="self-start"
      >
        Ganti password
      </Button>
    </form>
  );
}

type BarisAkun = PilihanAkun["akun"][number];

function IsiBaris({ a, onToggle }: { a: BarisAkun; onToggle: () => void }) {
  return (
    <label className="flex min-w-0 flex-1 items-center gap-3">
      <input type="checkbox" checked={a.dipilih} onChange={onToggle} className={`size-5 shrink-0 accent-brand-700 ${fokus}`} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{a.nama}</span>
        {a.saldo !== null && a.saldo !== 0 && <span className="block text-xs text-stone-500">Saldo {formatRupiah(a.saldo)}</span>}
      </span>
    </label>
  );
}

/** Baris akun dipilih: digeser lewat pegangan di kanan (sentuh, mouse, atau keyboard spasi + panah). */
function BarisGeser({ a, onToggle }: { a: BarisAkun; onToggle: () => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: a.id });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`relative flex min-h-12 items-center gap-3 bg-white ${isDragging ? "z-10 rounded-lg shadow-lg" : ""}`}
    >
      <IsiBaris a={a} onToggle={onToggle} />
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`Geser ${a.nama}`}
        className={`flex size-11 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-stone-400 hover:bg-brand-50 active:cursor-grabbing ${fokus}`}
      >
        <GripVertical className="size-5" aria-hidden />
      </button>
    </li>
  );
}

/** Pilih akun dari master yang dipakai sendiri + urutannya. Akun bersaldo ≠ 0 ditolak server saat dilepas. */
function AkunSayaForm({ data }: { data: PilihanAkun }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [list, setList] = useState<BarisAkun[]>(data.akun);
  const dipilih = list.filter((a) => a.dipilih);
  const lain = list.filter((a) => !a.dipilih);
  const ids = dipilih.map((a) => a.id);
  const awal = data.akun.filter((a) => a.dipilih).map((a) => a.id);
  const berubah = ids.join() !== awal.join();

  const simpan = useMutation({
    mutationFn: () => send("PUT", "/akun/pilihan", { ids }),
    onSuccess: () => {
      invalidateKeuangan(qc);
      toast.show("Pilihan akun disimpan");
    },
  });
  const err = simpan.error instanceof ApiError ? simpan.error : null;

  const toggle = (id: string) =>
    setList((l) => {
      const a = l.find((x) => x.id === id)!;
      const sisa = l.filter((x) => x.id !== id);
      const ubah = { ...a, dipilih: !a.dipilih };
      // Dicentang → paling bawah di grup dipilih; dilepas → paling atas di grup lain
      const n = sisa.filter((x) => x.dipilih).length;
      return [...sisa.slice(0, n), ubah, ...sisa.slice(n)];
    });
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  // Akun dipilih selalu di awal `list`, jadi indeks di grup dipilih = indeks di `list`
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    setList((l) => arrayMove(l, l.findIndex((x) => x.id === active.id), l.findIndex((x) => x.id === over.id)));
  };

  if (list.length === 0) return <p className="text-sm text-stone-500">Belum ada akun. Minta admin menambahkannya di Master.</p>;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        simpan.mutate();
      }}
    >
      <p className="text-sm text-stone-500">
        Centang akun yang kamu pakai. Hanya akun ini yang muncul di form transaksi, langganan, dan periode.
        {!data.eksplisit && " Saat ini semua akun dipakai."}
      </p>
      {dipilih.length > 1 && <p className="-mt-2 text-xs text-stone-500">Tahan & geser ikon di kanan untuk mengatur urutan.</p>}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ul className="flex flex-col divide-y divide-garis">
            {dipilih.map((a) => (
              <BarisGeser key={a.id} a={a} onToggle={() => toggle(a.id)} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      {lain.length > 0 && (
        <div className="flex flex-col gap-1">
          <h3 className="text-xs font-bold text-stone-500">Tidak dipakai</h3>
          <ul className="flex flex-col divide-y divide-garis">
            {lain.map((a) => (
              <li key={a.id} className="flex min-h-12 items-center gap-3">
                <IsiBaris a={a} onToggle={() => toggle(a.id)} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {dipilih.length === 0 && <p className="text-sm text-keluar">Pilih minimal satu akun.</p>}
      {err && <p role="alert" className="text-sm text-keluar">{err.errors?.ids?.[0] ?? err.title}</p>}
      <Button type="submit" loading={simpan.isPending} disabled={!berubah || dipilih.length === 0} className="self-start">
        Simpan akun
      </Button>
    </form>
  );
}

function AkunSaya() {
  const q = usePilihanAkun();
  if (q.isPending) return <Skeleton className="h-40" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  // key: form dimulai ulang dari data server setelah disimpan
  return <AkunSayaForm key={q.data.akun.map((a) => `${a.id}:${a.dipilih}`).join()} data={q.data} />;
}

function StatusSheets() {
  const q = useQuery({
    queryKey: ["health", "sheets"],
    queryFn: () => api<{ ok: boolean }>("/health/sheets"),
    retry: false,
  });
  if (q.isPending) return <Skeleton className="h-5 w-48" />;
  return q.isSuccess ? (
    <p className="flex items-center gap-2 text-sm text-masuk">
      <CircleCheck className="size-4" aria-hidden /> Terhubung ke Google Sheets
    </p>
  ) : (
    <p className="flex items-center gap-2 text-sm text-keluar">
      <CircleAlert className="size-4" aria-hidden />
      {q.error instanceof ApiError ? q.error.title : "Tidak bisa terhubung ke server."}
    </p>
  );
}

export default function PengaturanPage() {
  const { data: me } = useMe();
  const logout = useLogout();

  return (
    <>
      <PageHeader title="Pengaturan" />
      <div className="flex flex-col gap-6">
        <Section title="Profil">{me ? <ProfilForm me={me} /> : <Skeleton className="h-40" />}</Section>
        <Section title="Akun saya">
          <AkunSaya />
        </Section>
        <Section title="Ganti password">
          <PasswordForm />
        </Section>
        <Section title="Info">
          <p className="text-sm text-stone-700">Saku v{__APP_VERSION__}</p>
          <StatusSheets />
        </Section>
        <Button variant="danger" onClick={() => logout.mutate()} loading={logout.isPending} className="self-start">
          <LogOut className="size-5" aria-hidden />
          Keluar
        </Button>
      </div>
    </>
  );
}
