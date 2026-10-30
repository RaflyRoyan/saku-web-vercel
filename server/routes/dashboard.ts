import { Hono } from "hono";
import type { AppEnv } from "../app.js";
import { loadSession, requireAuth } from "../auth/session.js";
import { todayWib } from "../common/clock.js";
import { rowsOf } from "../repositories/rows.js";
import { hitungRingkasan } from "../services/ringkasan.js";
import { periodeAktif } from "../services/saldo.js";
import { totalTabungan } from "../services/tabungan.js";
import { transaksiMapper, urutTransaksi } from "../services/transaksi.js";
import { pengingatDto } from "./berulang.js";

const SHEETS = ["Akun", "Kategori", "Periode", "SaldoAwal", "Transaksi", "Tabungan", "Berulang", "BerulangLewati"] as const;

export const dashboard = new Hono<AppEnv>();

dashboard.use(requireAuth);

/** Ringkasan periode aktif (atau null) + total tabungan + pengingat + 5 transaksi terakhir (spec §10.9). Satu batchGet. */
dashboard.get("/", async (c) => {
  const { user, data } = await loadSession(c, SHEETS);
  const uid = user.data.id;
  const s = {
    akun: rowsOf(data, "Akun"),
    kategori: rowsOf(data, "Kategori"),
    periode: rowsOf(data, "Periode"),
    saldoAwal: rowsOf(data, "SaldoAwal"),
    transaksi: rowsOf(data, "Transaksi"),
    tabungan: rowsOf(data, "Tabungan"),
    berulang: rowsOf(data, "Berulang"),
    lewati: rowsOf(data, "BerulangLewati"),
  };
  const aktif = periodeAktif(s.periode, uid);
  const toDto = transaksiMapper(s.akun, s.kategori);

  return c.json({
    ringkasan: aktif ? hitungRingkasan(aktif.data, s.akun, s.kategori, s.saldoAwal, s.transaksi, s.tabungan) : null,
    totalTabungan: totalTabungan(s.tabungan, uid),
    pengingat: pengingatDto(s, uid, todayWib(c.var.clock)),
    transaksiTerakhir: aktif
      ? s.transaksi
          .map((r) => r.data)
          .filter((t) => t.user_id === uid && t.periode_id === aktif.data.id)
          .sort(urutTransaksi)
          .slice(0, 5)
          .map(toDto)
      : [],
  });
});
