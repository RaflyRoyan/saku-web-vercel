import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app.js";
import { loadSession, requireAuth } from "../auth/session.js";
import { validationError } from "../common/errors.js";
import { parseQris } from "../common/qris.js";
import { jsonBody } from "../common/validation.js";
import { newId, newRow, rowsOf, updatedRow } from "../repositories/rows.js";

/** Pengaturan per pengguna. Saat ini hanya QRIS statis untuk tagihan split bill. */
export const pengaturan = new Hono<AppEnv>();

pengaturan.use(requireAuth);

const KUNCI_QRIS = "qris";

function qrisDto(nilai: string | undefined) {
  if (!nilai) return null;
  const q = parseQris(nilai);
  return q.ok ? { payload: q.payload, merchant: q.merchant, kota: q.kota } : null;
}

pengaturan.get("/qris", async (c) => {
  const { user, data } = await loadSession(c, ["Pengaturan"]);
  const row = rowsOf(data, "Pengaturan").find((r) => r.data.user_id === user.data.id && r.data.kunci === KUNCI_QRIS);
  return c.json(qrisDto(row?.data.nilai));
});

pengaturan.put(
  "/qris",
  jsonBody(z.object({ payload: z.string({ error: "Payload harus berupa teks." }).max(1000, { error: "Payload terlalu panjang." }).nullable() })),
  async (c) => {
    const { payload } = c.req.valid("json");
    const { user, data } = await loadSession(c, ["Pengaturan"]);
    const uid = user.data.id;
    const rows = rowsOf(data, "Pengaturan");
    const row = rows.find((r) => r.data.user_id === uid && r.data.kunci === KUNCI_QRIS);
    const store = c.var.store();

    if (payload === null) {
      if (row) await store.deleteRow("Pengaturan", row.row);
      return c.json(null);
    }
    const q = parseQris(payload);
    if (!q.ok) throw validationError({ payload: [q.pesan] });
    if (row) await store.updateRow("Pengaturan", row.row, updatedRow("Pengaturan", row.data, { nilai: q.payload }, uid, c.var.clock));
    else await store.append("Pengaturan", [newRow("Pengaturan", { id: newId("Pengaturan", rows), user_id: uid, kunci: KUNCI_QRIS, nilai: q.payload }, uid, c.var.clock)]);
    return c.json(qrisDto(q.payload));
  },
);
