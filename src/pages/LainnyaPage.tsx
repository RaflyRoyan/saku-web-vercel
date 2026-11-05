import { Link } from "react-router-dom";
import { Braces, CalendarRange, ChevronRight, LogOut, PiggyBank, QrCode, ReceiptText, Repeat, Settings, Tags, Users, type LucideIcon } from "lucide-react";
import PageHeader from "../components/layout/PageHeader";
import { fokus } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { useLogout, useMe } from "../hooks/useAuth";

const MENU: { to: string; label: string; icon: LucideIcon; adminOnly?: boolean }[] = [
  { to: "/qris", label: "Terima QRIS", icon: QrCode },
  { to: "/split", label: "Split Bill", icon: ReceiptText },
  { to: "/langganan", label: "Langganan", icon: Repeat },
  { to: "/tabungan", label: "Tabungan", icon: PiggyBank },
  { to: "/master", label: "Master", icon: Tags },
  { to: "/periode", label: "Periode", icon: CalendarRange },
  { to: "/pengaturan", label: "Pengaturan", icon: Settings },
  { to: "/dokumentasi-api", label: "Dokumentasi API", icon: Braces },
  { to: "/pengguna", label: "Kelola Pengguna", icon: Users, adminOnly: true },
];

const item = `flex min-h-14 w-full items-center gap-3 px-4 text-left text-sm font-semibold ${fokus}`;

export default function LainnyaPage() {
  const { data: me } = useMe();
  const logout = useLogout();

  return (
    <>
      <PageHeader title="Lainnya" />
      <Card className="divide-y divide-garis overflow-hidden">
        {MENU.filter((m) => !m.adminOnly || me?.peran === "admin").map(({ to, label, icon: Icon }) => (
          <Link key={to} to={to} className={`${item} hover:bg-brand-50`}>
            <Icon className="size-5 text-brand-600" aria-hidden />
            <span className="flex-1">{label}</span>
            <ChevronRight className="size-5 text-stone-400" aria-hidden />
          </Link>
        ))}
        <button
          type="button"
          onClick={() => logout.mutate()}
          disabled={logout.isPending}
          className={`${item} text-keluar hover:bg-rose-50`}
        >
          <LogOut className="size-5" aria-hidden />
          Keluar
        </button>
      </Card>
      <p className="mt-6 text-center text-xs text-stone-400">Saku v{__APP_VERSION__}</p>
    </>
  );
}
