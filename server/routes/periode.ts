import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app.js";
import { loadSession, requireAuth } from "../auth/session.js";
import { todayWib } from "../common/clock.js";
import { AppError, validationError, type FieldErrors } from "../common/errors.js";
import { jsonBody } from "../common/validation.js";
import { findOwned, newId, newRow, rowsOf, updatedRow, type ParsedRow } from "../repositories/rows.js";
import { addDays, namaDefault, periodeDto, periodeMilik } from "../services/periode.js";
import { hitungRingkasan } from "../services/ringkasan.js";
import { periodeAktif, saldoPerAkun } from "../services/saldo.js";
import { rencanaSetor, rencanaSetorTerdampak, simpanSetor, totalTabungan } from "../services/tabungan.js";
import { transaksiMapper, urutTransaksi } from "../services/transaksi.js";
import type { CellValue, RowUpdate } from "../sheets/store.js";

const tanggalSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Format tanggal harus yyyy-MM-dd." });
const namaSchema = z
  .string({ error: "Nama periode wajib diisi." })
  .trim()
  .min(1, { error: "Nama periode wajib diisi." })
  .max(50, { error: "Nama periode maksimal 50 karakter." });
const keteranganSchema = z.string().trim().max(200, { error: "Keterangan maksimal 200 karakter." });
const saldoAwalSchema = z.array(
  z.object({
    akunId: z.string({ error: "Akun wajib dipilih." }).min(1, { error: "Akun wajib dipilih." }),
    saldo: z
      .number({ error: "Saldo harus berupa angka." })
      .int({ error: "Saldo harus bilangan bulat." })
      .min(0, { error: "Saldo awal tidak boleh minus." })
      .max(1_000_000_000_000, { error: "Saldo terlalu besar." }),
  }),
  { error: "Saldo awal harus berupa daftar." },
);

type SaldoAwalInput = z.infer<typeof saldoAwalSchema>;

/**
 * Akun saldo awal harus ada, aktif, dan tidak dobel (spec §7.4 butir 1).
 * `boleh` = akun nonaktif yang sudah punya saldo awal di periode itu (saat edit) tetap boleh.
 */
function cekSaldoAwal(items: SaldoAwalInput, akun: ParsedRow<"Akun">[], boleh: Set<string> = new Set()) {
  const errors: FieldErrors = {};
  const seen = new Set<string>();
  items.forEach((item, i) => {
    const key = `saldoAwal.${i}.akunId`;
    const a = akun.find((r) => r.data.id === item.akunId)?.data;
    if (!a) errors[key] = ["Akun tidak ditemukan."];
    else if (!a.aktif && !boleh.has(a.id)) errors[key] = [`Akun ${a.nama} nonaktif dan tidak bisa dipakai.`];
    else if (seen.has(item.akunId)) errors[key] = [`Akun ${a.nama} dobel.`];
    seen.add(item.akunId);
  });
  if (Object.keys(errors).length) throw validationError(errors);
}

const saldoAwalDto = (rows: ParsedRow<"SaldoAwal">[], periodeId: string) =>
  rows.filter((r) => r.data.periode_id === periodeId).map((r) => ({ akunId: r.data.akun_id, saldo: r.data.saldo ?? 0 }));

export const periode = new Hono<AppEnv>();

periode.use(requireAuth);

periode.get("/", async (c) => {
  const { user, data } = await loadSession(c, ["Periode"]);
  return c.json(periodeMilik(rowsOf(data, "Periode"), user.data.id).map((p) => periodeDto(p.data)));
});

periode.get("/aktif", async (c) => {
  const { user, data } = await loadSession(c, ["Periode", "SaldoAwal"]);
  const aktif = periodeAktif(rowsOf(data, "Periode"), user.data.id);
  if (!aktif) throw new AppError(404, "Belum ada periode aktif.");
  return c.json({ ...periodeDto(aktif.data), saldoAwal: saldoAwalDto(rowsOf(data, "SaldoAwal"), aktif.data.id) });
});

/** Pratinjau sisa setiap akun yang akan masuk tabungan saat periode aktif ditutup, tanpa menulis (spec §7.4). */
periode.get("/aktif/pratinjau-tutup", async (c) => {
  const { user, data } = await loadSession(c, ["Akun", "Periode", "SaldoAwal", "Transaksi"]);
  const aktif = periodeAktif(rowsOf(data, "Periode"), user.data.id);
  if (!aktif) throw new AppError(404, "Belum ada periode aktif.");
  const akun = rowsOf(data, "Akun");
  const urutan = new Map(akun.map((a) => [a.data.id, a.data]));
  const sisa = [...saldoPerAkun(aktif.data.id, rowsOf(data, "SaldoAwal"), rowsOf(data, "Transaksi"))]
    .map(([akunId, nominal]) => ({ akunId, nama: urutan.get(akunId)?.nama ?? "(akun dihapus)", nominal }))
    .sort((a, b) => (urutan.get(a.akunId)?.urutan ?? 0) - (urutan.get(b.akunId)?.urutan ?? 0));
  return c.json({ periode: periodeDto(aktif.data), sisa, total: sisa.reduce((n, s) => n + s.nominal, 0) });
});

/**
 * Mulai periode baru (spec §7.4). Kalau ada periode aktif P: tutup P, setor sisa tiap akun ke tabungan,
 * lalu buat periode baru + saldo awalnya. Urutan tulis: tabungan → update P → periode baru → saldo awal.
 * Idempoten saat diulang: setor di-upsert, dan P yang sudah tertutup tepat sehari sebelum `tanggalMulai` dilanjutkan.
 */
periode.post(
  "/mulai",
  jsonBody(
    z.object({
      nama: namaSchema.optional(),
      tanggalMulai: tanggalSchema.optional(),
      keterangan: keteranganSchema.optional(),
      saldoAwal: saldoAwalSchema.default([]),
    }),
  ),
  async (c) => {
    const body = c.req.valid("json");
    const { user, data } = await loadSession(c, ["Akun", "Kategori", "Periode", "SaldoAwal", "Transaksi", "Tabungan"]);
    const uid = user.data.id;
    const clock = c.var.clock;
    const akun = rowsOf(data, "Akun");
    const semuaPeriode = rowsOf(data, "Periode");
    const saldoAwal = rowsOf(data, "SaldoAwal");
    const transaksi = rowsOf(data, "Transaksi");
    const tabungan = rowsOf(data, "Tabungan");

    const tanggalMulai = body.tanggalMulai ?? todayWib(clock);
    const selesai = addDays(tanggalMulai, -1);
    cekSaldoAwal(body.saldoAwal, akun);

    let tutup: ParsedRow<"Periode"> | undefined;
    const aktif = periodeAktif(semuaPeriode, uid);
    if (aktif) {
      const p = aktif.data;
      if (tanggalMulai <= (p.tanggal_mulai ?? "")) {
        throw validationError({ tanggalMulai: [`Tanggal mulai harus setelah ${p.tanggal_mulai} (awal ${p.nama}).`] });
      }
      const bentrok = transaksi
        .filter((t) => t.data.user_id === uid && t.data.periode_id === p.id && (t.data.tanggal ?? "") >= tanggalMulai)
        .map((t) => t.data)
        .sort(urutTransaksi);
      if (bentrok.length) {
        const toDto = transaksiMapper(akun, rowsOf(data, "Kategori"));
        throw new AppError(
          409,
          `Masih ada ${bentrok.length} transaksi ${p.nama} pada atau setelah tanggal mulai. Ubah tanggalnya dulu.`,
          undefined,
          { transaksi: bentrok.map(toDto) },
        );
      }
      tutup = aktif;
    } else {
      const [terakhir] = periodeMilik(semuaPeriode, uid);
      const akhir = terakhir?.data.tanggal_selesai;
      if (akhir && tanggalMulai <= akhir) {
        throw validationError({ tanggalMulai: [`Tanggal mulai harus setelah ${akhir} (akhir ${terakhir.data.nama}).`] });
      }
      // Percobaan sebelumnya gagal setelah P ditutup: lanjutkan (setor di-upsert ulang)
      if (akhir === selesai) tutup = terakhir;
    }

    const store = c.var.store();
    let setor: { akunId: string; nominal: number }[] = [];
    if (tutup) {
      const closed = { ...tutup.data, tanggal_selesai: selesai };
      const plan = rencanaSetor(closed, saldoAwal, transaksi, tabungan, uid, clock);
      setor = plan.setor;
      await simpanSetor(store, plan);
      if (tutup.data.tanggal_selesai !== selesai) {
        await store.updateRow("Periode", tutup.row, updatedRow("Periode", tutup.data, { tanggal_selesai: selesai }, uid, clock));
      }
    }

    const baru = {
      id: newId("Periode", semuaPeriode),
      user_id: uid,
      nama: body.nama ?? namaDefault(tanggalMulai),
      tanggal_mulai: tanggalMulai,
      tanggal_selesai: null,
      keterangan: body.keterangan ?? "",
    };
    await store.append("Periode", [newRow("Periode", baru, uid, clock)]);

    // Saldo 0 tidak dibuatkan baris, sama seperti akun yang tidak dikirim
    const taken = [...saldoAwal];
    const rows: CellValue[][] = [];
    for (const item of body.saldoAwal.filter((s) => s.saldo > 0)) {
      const id = newId("SaldoAwal", taken);
      taken.push({ row: 0, data: { id } as ParsedRow<"SaldoAwal">["data"] });
      rows.push(newRow("SaldoAwal", { id, user_id: uid, periode_id: baru.id, akun_id: item.akunId, saldo: item.saldo }, uid, clock));
    }
    if (rows.length) await store.append("SaldoAwal", rows);

    const tanpaSetorLama = tabungan.filter((t) => !(t.data.jenis === "setor" && t.data.periode_id === tutup?.data.id));
    return c.json(
      {
        periode: periodeDto(baru),
        setorTabungan: setor,
        totalTabungan: totalTabungan(tanpaSetorLama, uid) + setor.reduce((n, s) => n + s.nominal, 0),
      },
      201,
    );
  },
);

periode.put("/:id", jsonBody(z.object({ nama: namaSchema, keterangan: keteranganSchema.default("") })), async (c) => {
  const body = c.req.valid("json");
  const { user, data } = await loadSession(c, ["Periode"]);
  const target = findOwned(rowsOf(data, "Periode"), c.req.param("id"), user.data.id);
  await c.var.store().updateRow("Periode", target.row, updatedRow("Periode", target.data, body, user.data.id, c.var.clock));
  return c.json(periodeDto({ ...target.data, ...body }));
});

/** Ganti seluruh saldo awal periode: upsert + hapus yang tidak dikirim (atau 0). Periode tertutup → hitung ulang setor (§7.5). */
periode.put("/:id/saldo-awal", jsonBody(z.object({ saldoAwal: saldoAwalSchema })), async (c) => {
  const { saldoAwal: items } = c.req.valid("json");
  const { user, data } = await loadSession(c, ["Akun", "Periode", "SaldoAwal", "Transaksi", "Tabungan"]);
  const uid = user.data.id;
  const clock = c.var.clock;
  const semuaPeriode = rowsOf(data, "Periode");
  const target = findOwned(semuaPeriode, c.req.param("id"), uid);
  const saldoAwal = rowsOf(data, "SaldoAwal");
  const milik = saldoAwal.filter((r) => r.data.user_id === uid && r.data.periode_id === target.data.id);
  cekSaldoAwal(items, rowsOf(data, "Akun"), new Set(milik.map((r) => r.data.akun_id)));

  const updates: RowUpdate[] = [];
  const appends: CellValue[][] = [];
  const hapus: number[] = [];
  const after: ParsedRow<"SaldoAwal">[] = saldoAwal.filter((r) => !milik.includes(r));
  const taken = [...saldoAwal];
  const kirim = new Map(items.filter((s) => s.saldo > 0).map((s) => [s.akunId, s.saldo]));

  for (const r of milik) {
    const saldo = kirim.get(r.data.akun_id);
    if (saldo === undefined) {
      hapus.push(r.row);
      continue;
    }
    kirim.delete(r.data.akun_id);
    after.push({ row: r.row, data: { ...r.data, saldo } });
    if (r.data.saldo !== saldo) updates.push({ sheet: "SaldoAwal", row: r.row, values: updatedRow("SaldoAwal", r.data, { saldo }, uid, clock) });
  }
  for (const [akunId, saldo] of kirim) {
    const id = newId("SaldoAwal", taken);
    const d = { id, user_id: uid, periode_id: target.data.id, akun_id: akunId, saldo };
    taken.push({ row: 0, data: d as ParsedRow<"SaldoAwal">["data"] });
    after.push({ row: 0, data: d as ParsedRow<"SaldoAwal">["data"] });
    appends.push(newRow("SaldoAwal", d, uid, clock));
  }

  const setor = rencanaSetorTerdampak([target.data.id], semuaPeriode, after, rowsOf(data, "Transaksi"), rowsOf(data, "Tabungan"), uid, clock);
  const store = c.var.store();
  await simpanSetor(store, setor, updates);
  if (appends.length) await store.append("SaldoAwal", appends);
  // Hapus dari bawah supaya nomor baris yang lain tidak bergeser
  for (const row of hapus.sort((a, b) => b - a)) await store.deleteRow("SaldoAwal", row);
  return c.body(null, 204);
});

periode.get("/:id/ringkasan", async (c) => {
  const { user, data } = await loadSession(c, ["Akun", "Kategori", "Periode", "SaldoAwal", "Transaksi", "Tabungan"]);
  const target = findOwned(rowsOf(data, "Periode"), c.req.param("id"), user.data.id);
  return c.json(
    hitungRingkasan(
      target.data,
      rowsOf(data, "Akun"),
      rowsOf(data, "Kategori"),
      rowsOf(data, "SaldoAwal"),
      rowsOf(data, "Transaksi"),
      rowsOf(data, "Tabungan"),
    ),
  );
});
