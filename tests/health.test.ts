import { describe, it, expect } from "vitest";
import { app, createApp } from "../server/app";
import { createSql } from "../server/db/client";
import { kolomOf, NAMA_TABEL, tabelDb } from "../server/db/schema";
import { PostgresStore } from "../server/db/store";
import { sqlTest } from "./helpers";

/** Store asli, tapi daftar kolom database bisa dimanipulasi. */
function storeDenganKolom(ubah: (kolom: Record<string, string[]>) => void) {
  const store = new PostgresStore(sqlTest);
  store.kolomTabel = async () => {
    const kolom = Object.fromEntries(NAMA_TABEL.map((t) => [tabelDb(t), [...kolomOf(t), "no"]]));
    ubah(kolom);
    return kolom;
  };
  return store;
}

describe("health", () => {
  it("GET /api/health → ok", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok" });
  });

  it("endpoint tidak dikenal → 404 ProblemDetails", async () => {
    const res = await app.request("/api/tidak-ada");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    expect(await res.json()).toMatchObject({ status: 404, title: "Endpoint tidak ditemukan." });
  });

  it("GET /api/health/db → 200 kalau semua tabel & kolom ada (database lokal hasil migrasi)", async () => {
    const store = new PostgresStore(sqlTest);
    const res = await createApp({ store: () => store }).request("/api/health/db");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.tabel).toHaveLength(NAMA_TABEL.length);
  });

  it("T17 · tabel hilang atau kolom kurang → 503", async () => {
    const store = storeDenganKolom((k) => {
      delete k.tabungan;
      k.pengguna = k.pengguna.filter((c) => c !== "updated_at");
    });
    const res = await createApp({ store: () => store }).request("/api/health/db");
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    const byName = Object.fromEntries(body.tabel.map((t: { nama: string }) => [t.nama, t]));
    expect(byName.Tabungan.masalah).toEqual(["Tabel tabungan tidak ditemukan."]);
    expect(byName.Pengguna.masalah).toEqual(['Kolom "updated_at" tidak ada.']);
    expect(byName.Transaksi.ok).toBe(true);
  });

  it("database tidak bisa diakses → 502 tanpa detail", async () => {
    // Port 1 di localhost: koneksi langsung ditolak
    const mati = createSql("postgresql://postgres:salah@127.0.0.1:1/postgres");
    const store = new PostgresStore(mati);
    const res = await createApp({ store: () => store }).request("/api/health/db");
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toMatchObject({ title: "Gagal mengakses penyimpanan data." });
    expect(JSON.stringify(body)).not.toContain("127.0.0.1");
    await mati.end();
  });
});
