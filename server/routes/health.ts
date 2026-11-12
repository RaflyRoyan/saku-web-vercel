import { Hono } from "hono";
import type { AppEnv } from "../app.js";
import { problem } from "../common/errors.js";
import { kolomOf, NAMA_TABEL, tabelDb, type NamaTabel } from "../db/schema.js";

interface StatusTabel {
  nama: NamaTabel;
  ok: boolean;
  masalah?: string[];
}

export const health = new Hono<AppEnv>();

health.get("/", (c) => c.json({ status: "ok", waktu: c.var.clock.now().toISOString() }));

/** Bandingkan kolom tabel di database dengan schema. Kosong = cocok. Kolom tambahan (mis. `no`) diabaikan. */
export function periksaTabel(nama: NamaTabel, kolomDb: readonly string[] | undefined): string[] {
  if (!kolomDb) return [`Tabel ${tabelDb(nama)} tidak ditemukan.`];
  const ada = new Set(kolomDb);
  return kolomOf(nama)
    .filter((k) => !ada.has(k))
    .map((k) => `Kolom "${k}" tidak ada.`);
}

// Hanya nama tabel dan status kolom; isi data tidak pernah dikirim.
health.get("/db", async (c) => {
  const kolom = await c.var.store().kolomTabel();
  const tabel: StatusTabel[] = NAMA_TABEL.map((nama) => {
    const masalah = periksaTabel(nama, kolom[tabelDb(nama)]);
    return masalah.length ? { nama, ok: false, masalah } : { nama, ok: true };
  });

  if (tabel.every((t) => t.ok)) return c.json({ ok: true, tabel });
  console.error(
    "Struktur tabel tidak cocok:",
    tabel.filter((t) => !t.ok).map((t) => `${t.nama}: ${t.masalah?.join(" ")}`).join(" | "),
  );
  return problem(c, 503, "Struktur database tidak sesuai. Jalankan migrasi terbaru.", { ok: false, tabel });
});
