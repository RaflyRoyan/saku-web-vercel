import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app.js";
import { loadSession, requireAdmin, requireAuth } from "../auth/session.js";
import { AppError, validationError } from "../common/errors.js";
import { formatRupiah } from "../common/format.js";
import { jsonBody } from "../common/validation.js";
import { newId, newRow, notFound, rowsOf, updatedRow, type ParsedRow } from "../repositories/rows.js";
import { pilihanAkun } from "../services/akun-pengguna.js";
import { periodeAktif, saldoAkunSemuaPengguna, saldoPerAkun } from "../services/saldo.js";
import type { CellValue, RowUpdate } from "../sheets/store.js";

// Akun = master bersama semua pengguna; hanya admin yang menulis (02 §2).

const namaSchema = z
  .string({ error: "Nama akun wajib diisi." })
  .trim()
  .min(1, { error: "Nama akun wajib diisi." })
  .max(40, { error: "Nama akun maksimal 40 karakter." });
const jenisSchema = z.enum(["bank", "ewallet", "cash"], { error: "Jenis harus bank, ewallet, atau cash." });
const urutanSchema = z
  .number({ error: "Urutan harus berupa angka." })
  .int({ error: "Urutan harus bilangan bulat." })
  .min(1, { error: "Urutan minimal 1." });

export interface AkunDto {
  id: string;
  nama: string;
  jenis: string;
  urutan: number;
  aktif: boolean;
  /** Saldo milik pengguna yang login di periode aktifnya; null kalau belum ada periode. */
  saldo: number | null;
  /** Akun ini dipakai pengguna yang login (Pengaturan → Akun saya). */
  dipilih: boolean;
  /** Kunci urut milik pengguna yang login; akun yang tidak dipilih di belakang. */
  urutanSaya: number;
}

export interface PilihanAkunDto {
  /** false = pengguna belum pernah menyimpan pilihan (semua akun aktif dipakai). */
  eksplisit: boolean;
  /** Akun aktif: yang dipilih dulu menurut urutan pengguna, lalu sisanya menurut urutan master. */
  akun: { id: string; nama: string; jenis: string; dipilih: boolean; saldo: number | null }[];
}

/** Nama unik (case-insensitive) di antara akun aktif. */
function assertNamaFree(rows: ParsedRow<"Akun">[], nama: string, exceptId?: string) {
  const n = nama.toLowerCase();
  if (rows.some((r) => r.data.aktif && r.data.id !== exceptId && r.data.nama.toLowerCase() === n)) {
    throw new AppError(409, "Nama akun sudah dipakai.", { nama: ["Nama akun sudah dipakai."] });
  }
}

function findAkun(rows: ParsedRow<"Akun">[], id: string) {
  const found = rows.find((r) => r.data.id === id);
  if (!found) throw notFound();
  return found;
}

export const akun = new Hono<AppEnv>();

akun.use(requireAuth);

/**
 * Tanpa query: akun aktif yang dipilih pengguna, urut menurut pengguna (untuk form & dropdown).
 * `termasukNonaktif=true`: semua akun, urut master (untuk Master & menampilkan nama di data lama).
 */
akun.get("/", async (c) => {
  const termasukNonaktif = c.req.query("termasukNonaktif") === "true";
  const { user, data } = await loadSession(c, ["Akun", "AkunPengguna", "Periode", "SaldoAwal", "Transaksi"]);
  const uid = user.data.id;
  const aktif = periodeAktif(rowsOf(data, "Periode"), uid);
  const saldo = aktif ? saldoPerAkun(aktif.data.id, rowsOf(data, "SaldoAwal"), rowsOf(data, "Transaksi")) : null;
  const pilihan = pilihanAkun(rowsOf(data, "AkunPengguna"), uid);

  const list: AkunDto[] = rowsOf(data, "Akun")
    .filter((r) => termasukNonaktif || (r.data.aktif && pilihan.dipilih(r.data.id)))
    .map(({ data: a }) => ({
      id: a.id,
      nama: a.nama,
      jenis: a.jenis,
      urutan: a.urutan ?? 0,
      aktif: a.aktif,
      saldo: saldo ? (saldo.get(a.id) ?? 0) : null,
      dipilih: pilihan.dipilih(a.id),
      urutanSaya: pilihan.urutan(a),
    }))
    .sort((a, b) => (termasukNonaktif ? a.urutan - b.urutan : a.urutanSaya - b.urutanSaya) || a.nama.localeCompare(b.nama, "id"));
  return c.json(list);
});

// Didaftarkan sebelum "/:id" supaya "pilihan" tidak dianggap ID
akun.get("/pilihan", async (c) => {
  const { user, data } = await loadSession(c, ["Akun", "AkunPengguna", "Periode", "SaldoAwal", "Transaksi"]);
  const uid = user.data.id;
  const aktif = periodeAktif(rowsOf(data, "Periode"), uid);
  const saldo = aktif ? saldoPerAkun(aktif.data.id, rowsOf(data, "SaldoAwal"), rowsOf(data, "Transaksi")) : null;
  const pilihan = pilihanAkun(rowsOf(data, "AkunPengguna"), uid);

  const list = pilihan.urutkan(rowsOf(data, "Akun").filter((r) => r.data.aktif)).map(({ data: a }) => ({
    id: a.id,
    nama: a.nama,
    jenis: a.jenis,
    dipilih: pilihan.dipilih(a.id),
    saldo: saldo ? (saldo.get(a.id) ?? 0) : null,
  }));
  return c.json({ eksplisit: pilihan.eksplisit, akun: list } satisfies PilihanAkunDto);
});

/**
 * Simpan akun yang dipakai pengguna + urutannya (urutan `ids`). Mengganti seluruh pilihan dan idempoten.
 * Akun yang dilepas harus bersaldo 0 di periode aktif pengguna.
 */
akun.put(
  "/pilihan",
  jsonBody(
    z.object({
      ids: z.array(z.string(), { error: "ids harus berupa daftar ID akun." }).min(1, { error: "Pilih minimal satu akun." }),
    }),
  ),
  async (c) => {
    const { ids } = c.req.valid("json");
    const { user, data } = await loadSession(c, ["Akun", "AkunPengguna", "Periode", "SaldoAwal", "Transaksi"]);
    const uid = user.data.id;
    const clock = c.var.clock;
    if (new Set(ids).size !== ids.length) throw new AppError(400, "ID akun tidak boleh dobel.", { ids: ["ID akun tidak boleh dobel."] });

    const semuaAkun = rowsOf(data, "Akun");
    const byId = new Map(semuaAkun.map((r) => [r.data.id, r.data]));
    for (const id of ids) {
      const a = byId.get(id);
      if (!a) throw validationError({ ids: ["Akun tidak ditemukan."] });
      if (!a.aktif) throw validationError({ ids: [`Akun ${a.nama} nonaktif dan tidak bisa dipilih.`] });
    }

    const semuaBaris = rowsOf(data, "AkunPengguna");
    const pilihan = pilihanAkun(semuaBaris, uid);
    const kirim = new Set(ids);

    // Akun yang sekarang dipakai tetapi tidak dikirim lagi harus bersaldo 0 di periode aktif
    const aktif = periodeAktif(rowsOf(data, "Periode"), uid);
    if (aktif) {
      const saldo = saldoPerAkun(aktif.data.id, rowsOf(data, "SaldoAwal"), rowsOf(data, "Transaksi"));
      for (const r of pilihan.urutkan(semuaAkun)) {
        const n = saldo.get(r.data.id) ?? 0;
        if (pilihan.dipilih(r.data.id) && !kirim.has(r.data.id) && n !== 0) {
          throw new AppError(409, `Saldo ${r.data.nama} masih ${formatRupiah(n)}. Pindahkan dulu sebelum akun dilepas.`);
        }
      }
    }

    // Baris yang akunnya tetap dipilih cukup diperbarui urutannya; baris sisa dipakai ulang untuk akun baru
    const lama = new Map<string, ParsedRow<"AkunPengguna">>();
    const sisa: ParsedRow<"AkunPengguna">[] = [];
    for (const r of pilihan.baris) {
      if (kirim.has(r.data.akun_id) && !lama.has(r.data.akun_id)) lama.set(r.data.akun_id, r);
      else sisa.push(r);
    }

    const updates: RowUpdate[] = [];
    const appends: CellValue[][] = [];
    const taken: { data: { id: string } }[] = [...semuaBaris];
    ids.forEach((akunId, i) => {
      const urutan = i + 1;
      const r = lama.get(akunId) ?? sisa.shift();
      if (r) {
        if (r.data.akun_id !== akunId || r.data.urutan !== urutan) {
          updates.push({ sheet: "AkunPengguna", row: r.row, values: updatedRow("AkunPengguna", r.data, { akun_id: akunId, urutan }, uid, clock) });
        }
        return;
      }
      const id = newId("AkunPengguna", taken);
      taken.push({ data: { id } });
      appends.push(newRow("AkunPengguna", { id, user_id: uid, akun_id: akunId, urutan }, uid, clock));
    });

    const store = c.var.store();
    await store.updateRows(updates);
    await store.append("AkunPengguna", appends);
    // Hapus dari bawah supaya nomor baris yang lain tidak bergeser
    for (const r of sisa.sort((a, b) => b.row - a.row)) await store.deleteRow("AkunPengguna", r.row);
    return c.body(null, 204);
  },
);

akun.post("/", jsonBody(z.object({ nama: namaSchema, jenis: jenisSchema, urutan: urutanSchema.optional() })), async (c) => {
  const body = c.req.valid("json");
  const { user, data } = await loadSession(c, ["Akun", "AkunPengguna"]);
  requireAdmin(user);
  const rows = rowsOf(data, "Akun");
  assertNamaFree(rows, body.nama);

  const urutan = body.urutan ?? Math.max(0, ...rows.map((r) => r.data.urutan ?? 0)) + 1;
  const baru = { id: newId("Akun", rows), nama: body.nama, jenis: body.jenis, urutan, aktif: true };
  await c.var.store().append("Akun", [newRow("Akun", baru, user.data.id, c.var.clock)]);
  // Akun baru tidak otomatis masuk pilihan pengguna yang sudah memilih sendiri
  const pilihan = pilihanAkun(rowsOf(data, "AkunPengguna"), user.data.id);
  const full = { ...baru, created_by: "", created_at: null, updated_by: "", updated_at: null };
  return c.json({ ...baru, saldo: null, dipilih: pilihan.dipilih(baru.id), urutanSaya: pilihan.urutan(full) } satisfies AkunDto, 201);
});

// Didaftarkan sebelum "/:id" supaya "urutan" tidak dianggap ID
akun.put(
  "/urutan",
  jsonBody(z.object({ ids: z.array(z.string(), { error: "ids harus berupa daftar ID akun." }).min(1, { error: "ids tidak boleh kosong." }) })),
  async (c) => {
    const { ids } = c.req.valid("json");
    const { user, data } = await loadSession(c, ["Akun"]);
    requireAdmin(user);
    const rows = rowsOf(data, "Akun");
    if (new Set(ids).size !== ids.length) throw new AppError(400, "ID akun tidak boleh dobel.", { ids: ["ID akun tidak boleh dobel."] });

    const updates: RowUpdate[] = [];
    ids.forEach((id, i) => {
      const r = findAkun(rows, id);
      if (r.data.urutan !== i + 1) {
        updates.push({ sheet: "Akun", row: r.row, values: updatedRow("Akun", r.data, { urutan: i + 1 }, user.data.id, c.var.clock) });
      }
    });
    await c.var.store().updateRows(updates);
    return c.body(null, 204);
  },
);

akun.put("/:id", jsonBody(z.object({ nama: namaSchema, jenis: jenisSchema, urutan: urutanSchema })), async (c) => {
  const body = c.req.valid("json");
  const { user, data } = await loadSession(c, ["Akun"]);
  requireAdmin(user);
  const rows = rowsOf(data, "Akun");
  const target = findAkun(rows, c.req.param("id"));
  if (target.data.aktif) assertNamaFree(rows, body.nama, target.data.id);

  await c.var.store().updateRow("Akun", target.row, updatedRow("Akun", target.data, body, user.data.id, c.var.clock));
  return c.body(null, 204);
});

akun.put("/:id/aktif", jsonBody(z.object({ aktif: z.boolean({ error: "Aktif harus true/false." }) })), async (c) => {
  const { aktif } = c.req.valid("json");
  const { user, data } = await loadSession(c, ["Akun", "Periode", "SaldoAwal", "Transaksi"]);
  requireAdmin(user);
  const rows = rowsOf(data, "Akun");
  const target = findAkun(rows, c.req.param("id"));

  if (aktif) {
    assertNamaFree(rows, target.data.nama, target.data.id);
  } else if (target.data.aktif) {
    // Spec §7.1 + 02 §2: ditolak kalau saldo ≠ 0 di periode aktif pengguna mana pun
    const saldo = saldoAkunSemuaPengguna(target.data.id, rowsOf(data, "Periode"), rowsOf(data, "SaldoAwal"), rowsOf(data, "Transaksi"));
    const milikSendiri = saldo.find((s) => s.userId === user.data.id)?.saldo ?? 0;
    if (milikSendiri !== 0) {
      throw new AppError(409, `Saldo akun masih ${formatRupiah(milikSendiri)}. Pindahkan dulu sebelum dinonaktifkan.`);
    }
    if (saldo.some((s) => s.saldo !== 0)) {
      throw new AppError(409, "Akun masih dipakai pengguna lain dengan saldo ≠ 0.");
    }
  }

  if (target.data.aktif !== aktif) {
    await c.var.store().updateRow("Akun", target.row, updatedRow("Akun", target.data, { aktif }, user.data.id, c.var.clock));
  }
  return c.body(null, 204);
});
