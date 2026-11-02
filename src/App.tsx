import { Route, Routes } from "react-router-dom";
import AppLayout from "./components/layout/AppLayout";
import AuthLayout from "./components/layout/AuthLayout";
import SetupPage from "./pages/SetupPage";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import TransaksiFormPage from "./pages/TransaksiFormPage";
import AkunPage from "./pages/AkunPage";
import AkunDetailPage from "./pages/AkunDetailPage";
import RiwayatPage from "./pages/RiwayatPage";
import PeriodeBaruPage from "./pages/PeriodeBaruPage";
import PeriodePage from "./pages/PeriodePage";
import AnggaranPage from "./pages/AnggaranPage";
import LanggananPage from "./pages/LanggananPage";
import TabunganPage from "./pages/TabunganPage";
import MasterPage from "./pages/MasterPage";
import LainnyaPage from "./pages/LainnyaPage";
import PengaturanPage from "./pages/PengaturanPage";
import PenggunaPage from "./pages/PenggunaPage";
import NotFoundPage from "./pages/NotFoundPage";
import RequireAuth from "./components/RequireAuth";
import SessionWatcher from "./components/SessionWatcher";
import StatusBanner from "./components/StatusBanner";

export default function App() {
  return (
    <>
      <SessionWatcher />
      <StatusBanner />
      <Routes>
        <Route element={<AuthLayout />}>
          <Route path="/setup" element={<SetupPage />} />
          <Route path="/login" element={<LoginPage />} />
        </Route>
        <Route element={<RequireAuth />}>
          <Route element={<AppLayout />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/transaksi/baru" element={<TransaksiFormPage />} />
            <Route path="/transaksi/:id" element={<TransaksiFormPage />} />
            <Route path="/akun" element={<AkunPage />} />
            <Route path="/akun/:id" element={<AkunDetailPage />} />
            <Route path="/riwayat" element={<RiwayatPage />} />
            <Route path="/periode" element={<PeriodePage />} />
            <Route path="/periode/baru" element={<PeriodeBaruPage />} />
            <Route path="/anggaran" element={<AnggaranPage />} />
            <Route path="/langganan" element={<LanggananPage />} />
            <Route path="/tabungan" element={<TabunganPage />} />
            <Route path="/master" element={<MasterPage />} />
            <Route path="/lainnya" element={<LainnyaPage />} />
            <Route path="/pengaturan" element={<PengaturanPage />} />
            <Route element={<RequireAuth adminOnly />}>
              <Route path="/pengguna" element={<PenggunaPage />} />
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </>
  );
}
