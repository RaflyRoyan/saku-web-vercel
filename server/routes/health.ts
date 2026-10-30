import { Hono } from "hono";
import type { AppEnv } from "../app.js";
import { problem } from "../common/errors.js";
import { SHEET_NAMES, validateHeader, type SheetName } from "../sheets/schema.js";
import { SheetMissingError, type SheetData } from "../sheets/store.js";

interface StatusSheet {
  nama: SheetName;
  ok: boolean;
  masalah?: string[];
}

export const health = new Hono<AppEnv>();

health.get("/", (c) => c.json({ status: "ok", waktu: c.var.clock.now().toISOString() }));

// Hanya nama sheet dan status kolom; isi data tidak pernah dikirim.
health.get("/sheets", async (c) => {
  const store = c.var.store();
  let data: Partial<Record<SheetName, SheetData>>;
  let missing: SheetName[] = [];
  try {
    data = await store.readMany(SHEET_NAMES);
  } catch (err) {
    if (!(err instanceof SheetMissingError)) throw err;
    missing = err.sheets;
    const ada = SHEET_NAMES.filter((s) => !missing.includes(s));
    data = ada.length ? await store.readMany(ada) : {};
  }

  const sheets: StatusSheet[] = SHEET_NAMES.map((nama) => {
    const sheet = data[nama];
    if (!sheet) return { nama, ok: false, masalah: ["Sheet tidak ditemukan."] };
    const masalah = validateHeader(nama, sheet.header);
    return masalah.length ? { nama, ok: false, masalah } : { nama, ok: true };
  });

  if (sheets.every((s) => s.ok)) return c.json({ ok: true, sheets });
  console.error(
    "Header sheet tidak cocok:",
    sheets.filter((s) => !s.ok).map((s) => `${s.nama}: ${s.masalah?.join(" ")}`).join(" | "),
  );
  return problem(c, 503, "Struktur spreadsheet tidak sesuai.", { ok: false, sheets });
});
