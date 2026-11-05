import { NavLink, Outlet } from "react-router-dom";
import {
  CalendarRange,
  CreditCard,
  History,
  House,
  LogOut,
  Menu,
  PiggyBank,
  Plus,
  QrCode,
  ReceiptText,
  Repeat,
  Settings,
  Tags,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useLogout, useMe } from "../../hooks/useAuth";
import { fokus } from "../ui/Button";

type NavItem = { to: string; label: string; icon: LucideIcon };

const bottomNav: NavItem[] = [
  { to: "/", label: "Beranda", icon: House },
  { to: "/akun", label: "Akun", icon: CreditCard },
  { to: "/transaksi/baru", label: "Catat", icon: Plus },
  { to: "/riwayat", label: "Riwayat", icon: History },
  { to: "/lainnya", label: "Lainnya", icon: Menu },
];

const sidebarNav: NavItem[] = [
  { to: "/", label: "Beranda", icon: House },
  { to: "/akun", label: "Akun", icon: CreditCard },
  { to: "/riwayat", label: "Riwayat", icon: History },
  { to: "/qris", label: "Terima QRIS", icon: QrCode },
  { to: "/split", label: "Split Bill", icon: ReceiptText },
  { to: "/langganan", label: "Langganan", icon: Repeat },
  { to: "/tabungan", label: "Tabungan", icon: PiggyBank },
  { to: "/periode", label: "Periode", icon: CalendarRange },
  { to: "/master", label: "Master", icon: Tags },
];

const sidebarBawah: (NavItem & { adminOnly?: boolean })[] = [
  { to: "/pengaturan", label: "Pengaturan", icon: Settings },
  { to: "/pengguna", label: "Pengguna", icon: Users, adminOnly: true },
];

function SidebarLink({ to, label, icon: Icon }: NavItem) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        `flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold ${fokus} ${
          isActive ? "bg-brand-50 text-brand-700" : "text-stone-500 hover:bg-brand-50"
        }`
      }
    >
      <Icon className="size-5" aria-hidden />
      {label}
    </NavLink>
  );
}

export default function AppLayout() {
  const { data: me } = useMe();
  const logout = useLogout();
  const isAdmin = me?.peran === "admin";

  return (
    <div className="min-h-full lg:flex">
      {/* Sidebar laptop (≥ lg) */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-1 border-r border-garis bg-white p-4 lg:flex">
        <p className="mb-4 px-3 text-xl font-extrabold tracking-tight text-brand-700">Saku</p>
        {sidebarNav.map((item) => (
          <SidebarLink key={item.to} {...item} />
        ))}
        <hr className="my-3 border-garis" />
        {sidebarBawah
          .filter((item) => !item.adminOnly || isAdmin)
          .map((item) => (
            <SidebarLink key={item.to} {...item} />
          ))}
        <button
          type="button"
          onClick={() => logout.mutate()}
          disabled={logout.isPending}
          className={`flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold text-stone-500 hover:bg-brand-50 ${fokus}`}
        >
          <LogOut className="size-5" aria-hidden />
          Keluar
        </button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Tombol Catat laptop */}
        <div className="hidden justify-end px-6 pt-4 lg:flex">
          <NavLink
            to="/transaksi/baru"
            className={`inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand-700 px-4 text-sm font-semibold text-white hover:bg-brand-800 ${fokus}`}
          >
            <Plus className="size-5" aria-hidden />
            Catat
          </NavLink>
        </div>

        <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-4 pb-24 lg:px-6 lg:pb-8">
          <Outlet />
        </main>
      </div>

      {/* Bottom nav HP (< lg) */}
      <nav
        className="fixed inset-x-0 bottom-0 z-10 border-t border-garis bg-white lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <ul className="mx-auto grid max-w-md grid-cols-5">
          {bottomNav.map(({ to, label, icon: Icon }) =>
            to === "/transaksi/baru" ? (
              <li key={to} className="flex justify-center">
                <NavLink
                  to={to}
                  aria-label={label}
                  className={`-mt-5 flex size-14 items-center justify-center rounded-full bg-linear-to-b from-brand-500 to-brand-700 text-white shadow-lg shadow-orange-900/20 ${fokus}`}
                >
                  <Icon className="size-7" aria-hidden />
                </NavLink>
              </li>
            ) : (
              <li key={to}>
                <NavLink
                  to={to}
                  end={to === "/"}
                  className={({ isActive }) =>
                    `flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-semibold ${fokus} ${
                      isActive ? "text-brand-700" : "text-stone-400"
                    }`
                  }
                >
                  <Icon className="size-6" aria-hidden />
                  {label}
                </NavLink>
              </li>
            ),
          )}
        </ul>
      </nav>
    </div>
  );
}
