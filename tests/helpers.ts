import { createApp } from "../server/app";
import { FakeClock } from "../server/common/clock";
import { createSql } from "../server/db/client";
import { NAMA_TABEL, SCHEMA, tabelDb, type Baris, type NamaTabel } from "../server/db/schema";
import { PostgresStore, type Row, type Store } from "../server/db/store";

/** Postgres lokal dari `npx supabase start`. Semua file test memakai database yang sama (fileParallelism: false). */
export const DATABASE_URL_TEST = process.env.DATABASE_URL_TEST ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
export const sqlTest = createSql(DATABASE_URL_TEST);

/** Kosongkan semua tabel aplikasi. Dipanggil sebelum tiap test (tests/setup-db.ts). */
export async function kosongkanDb() {
  await sqlTest.unsafe(`truncate ${NAMA_TABEL.map(tabelDb).join(", ")} restart identity cascade`);
}

/** App + Postgres lokal + clock palsu, dengan client yang menyimpan cookie seperti browser. */
export function setupTest(start = "2026-10-30T03:00:00Z") {
  const store = new PostgresStore(sqlTest);
  const clock = new FakeClock(start);
  const app = createApp({
    store: () => store,
    clock,
    // Iterasi kecil supaya test cepat; format hash tetap sama
    settings: () => ({ jwtSecret: "rahasia-test-minimal-32-karakter-xxxx", jwtExpireDays: 30, passwordIterations: 1000 }),
  });

  function client() {
    let cookie = "";
    async function request(method: string, path: string, body?: unknown, opts: { csrf?: boolean } = {}) {
      const headers: Record<string, string> = {};
      if (cookie) headers.Cookie = cookie;
      if (body !== undefined) headers["Content-Type"] = "application/json";
      if (opts.csrf !== false) headers["X-Requested-With"] = "saku";
      const res = await app.request(`/api${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
      });
      const set = res.headers.get("set-cookie");
      if (set) {
        const value = /saku_token=([^;]*)/.exec(set)?.[1] ?? "";
        cookie = value ? `saku_token=${value}` : "";
      }
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : undefined, setCookie: set };
    }
    return {
      get: (path: string) => request("GET", path),
      post: (path: string, body?: unknown, opts?: { csrf?: boolean }) => request("POST", path, body ?? {}, opts),
      put: (path: string, body?: unknown) => request("PUT", path, body ?? {}),
      del: (path: string) => request("DELETE", path),
      get cookie() {
        return cookie;
      },
      set cookie(v: string) {
        cookie = v;
      },
    };
  }

  return { app, store, clock, client };
}

export const ADMIN = { username: "admin", password: "rahasia123", nama: "Admin Saku" };

export const BUDI = { username: "budi", password: "budi12345", nama: "Budi", peran: "user" };

/** Admin + Budi, 4 akun, kategori Makan & Gaji. Clock: 30 Okt 2026 10.00 WIB. */
export async function siapkan() {
  // Beberapa test memanggil siapkan() dua kali; masing-masing mulai dari database kosong
  await kosongkanDb();
  const t = setupTest();
  const admin = t.client();
  await admin.post("/auth/setup", ADMIN);
  await admin.post("/pengguna", BUDI);
  const budi = t.client();
  await budi.post("/auth/login", { username: "budi", password: BUDI.password });

  const akun: Record<string, string> = {};
  for (const [nama, jenis] of [["BCA", "bank"], ["Mandiri", "bank"], ["Jago", "bank"], ["GoPay", "ewallet"]]) {
    akun[nama] = (await admin.post("/akun", { nama, jenis })).body.id;
  }
  const makan = (await admin.post("/kategori", { nama: "Makan", tipe: "keluar" })).body.id as string;
  const gaji = (await admin.post("/kategori", { nama: "Gaji", tipe: "masuk" })).body.id as string;
  const kategori = (await admin.get("/kategori")).body as { id: string; kodeSistem: string | null }[];
  const biayaAdmin = kategori.find((k) => k.kodeSistem === "BIAYA_ADMIN")!.id;
  const tarik = kategori.find((k) => k.kodeSistem === "TARIK_TABUNGAN")!.id;
  return { ...t, admin, budi, akun, makan, gaji, biayaAdmin, tarik };
}


/** Baris dari nilai mentah berurutan kolom schema; kolom yang tidak diisi = kosong. */
export function barisDari<S extends NamaTabel>(tabel: S, values: unknown[]): Baris<S> {
  const obj: Record<string, unknown> = {};
  SCHEMA[tabel].forEach(([nama, tipe], i) => {
    const v = values[i];
    obj[nama] = v === undefined || v === "" ? (tipe === "teks" ? "" : tipe === "boolean" ? false : null) : v;
  });
  return obj as Baris<S>;
}

export function rowsDari<S extends NamaTabel>(tabel: S, rows: unknown[][]): Row<S>[] {
  return rows.map((values) => ({ data: barisDari(tabel, values) }));
}

/** Tulis baris mentah (nilai urut kolom schema) langsung ke database, untuk menyiapkan data test. */
export async function appendRaw<S extends NamaTabel>(store: Store, tabel: S, rows: unknown[][]) {
  await store.append(tabel, rows.map((values) => barisDari(tabel, values)));
}
