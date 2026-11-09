import { describe, it, expect } from "vitest";
import { findOwned } from "../server/repositories/rows";
import { parseRows } from "../server/sheets/parse";
import { ADMIN, setupTest } from "./helpers";

const MENIT = 60 * 1000;

describe("T1 · setup awal", () => {
  it("kedua kalinya 409, kategori sistem tersedia", async () => {
    const { client, store } = setupTest();
    const a = client();
    expect((await a.get("/auth/status")).body).toEqual({ perluSetup: true });

    const first = await a.post("/auth/setup", ADMIN);
    expect(first.status).toBe(201);
    expect(first.body.pengguna).toMatchObject({ username: "admin", nama: "Admin Saku", peran: "admin", aktif: true });
    expect(first.body.pengguna).not.toHaveProperty("password_hash");
    expect(first.body).not.toHaveProperty("token");
    expect(first.setCookie).toMatch(/saku_token=.+HttpOnly/i);
    expect(first.setCookie).toMatch(/SameSite=Lax/i);

    const second = await client().post("/auth/setup", { ...ADMIN, username: "lain" });
    expect(second.status).toBe(409);
    expect((await a.get("/auth/status")).body).toEqual({ perluSetup: false });

    const { Kategori } = await store.readMany(["Kategori"]);
    const kode = parseRows("Kategori", Kategori).map((r) => r.data.kode_sistem).filter(Boolean);
    expect(kode.sort()).toEqual(["BIAYA_ADMIN", "PATUNGAN", "SETOR_TABUNGAN", "TARIK_TABUNGAN"]);

    // Setup ulang tidak menggandakan kategori sistem (sudah ada)
    expect((await a.get("/auth/me")).body.username).toBe("admin");
  });

  it("validasi field → 400 dengan errors per field", async () => {
    const { client } = setupTest();
    const res = await client().post("/auth/setup", { username: "A!", password: "pendek", nama: "" });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.errors).sort()).toEqual(["nama", "password", "username"]);
    expect(res.body.errors.password).toEqual(["Password minimal 8 karakter."]);
  });

  it("JSON rusak → 400", async () => {
    const { client } = setupTest();
    const res = await client().post("/auth/setup", "{rusak");
    expect(res.status).toBe(400);
    expect(res.body.title).toBe("Format data tidak valid.");
  });
});

describe("T2 · lockout login", () => {
  it("gagal 5× → percobaan ke-6 429 walau password benar; 15 menit kemudian bisa login", async () => {
    const { client, clock } = setupTest();
    await client().post("/auth/setup", ADMIN);
    const c = client();

    for (let i = 1; i <= 4; i++) {
      const res = await c.post("/auth/login", { username: "admin", password: "salah12345" });
      expect(res.status).toBe(401);
      expect(res.body.title).toBe("Username atau password salah.");
    }
    expect((await c.post("/auth/login", { username: "admin", password: "salah12345" })).status).toBe(429);

    const locked = await c.post("/auth/login", { username: "ADMIN", password: ADMIN.password });
    expect(locked.status).toBe(429);
    expect(locked.body.title).toBe("Terlalu banyak percobaan. Coba lagi dalam 15 menit.");

    clock.advance(15 * MENIT + 1000);
    const ok = await c.post("/auth/login", { username: "admin", password: ADMIN.password });
    expect(ok.status).toBe(200);
    expect(ok.body.pengguna.lastLogin).toBeTruthy();
  });

  it("username tidak ada → pesan sama dengan password salah", async () => {
    const { client } = setupTest();
    await client().post("/auth/setup", ADMIN);
    const res = await client().post("/auth/login", { username: "tidakada", password: "apaaja123" });
    expect(res.status).toBe(401);
    expect(res.body.title).toBe("Username atau password salah.");
  });

  it("hitungan gagal di-reset kalau gagal terakhir > 15 menit lalu", async () => {
    const { client, clock } = setupTest();
    await client().post("/auth/setup", ADMIN);
    const c = client();
    for (let i = 0; i < 4; i++) await c.post("/auth/login", { username: "admin", password: "salah12345" });
    clock.advance(16 * MENIT);
    expect((await c.post("/auth/login", { username: "admin", password: "salah12345" })).status).toBe(401);
  });
});

describe("T3 · ganti password", () => {
  it("token lama → 401, token baru OK", async () => {
    const { client } = setupTest();
    const a = client();
    await a.post("/auth/setup", ADMIN);
    const oldCookie = a.cookie;

    const wrong = await a.put("/auth/password", { passwordLama: "bukan12345", passwordBaru: "baru12345" });
    expect(wrong.status).toBe(400);
    expect(wrong.body.errors.passwordLama).toEqual(["Password lama salah."]);

    const res = await a.put("/auth/password", { passwordLama: ADMIN.password, passwordBaru: "baru12345" });
    expect(res.status).toBe(200);
    expect(res.body.expiresAt).toBeTruthy();
    expect(a.cookie).not.toBe(oldCookie);
    expect((await a.get("/auth/me")).status).toBe(200);

    const old = client();
    old.cookie = oldCookie;
    const expired = await old.get("/auth/me");
    expect(expired.status).toBe(401);
    expect(expired.body.title).toBe("Sesi berakhir, silakan login ulang.");

    expect((await client().post("/auth/login", { username: "admin", password: "baru12345" })).status).toBe(200);
  });

  it("token kedaluwarsa setelah JWT_EXPIRE_DAYS", async () => {
    const { client, clock } = setupTest();
    const a = client();
    await a.post("/auth/setup", ADMIN);
    clock.advance(30 * 24 * 60 * MENIT + 1000);
    expect((await a.get("/auth/me")).status).toBe(401);
  });
});

describe("T4 · data pengguna lain", () => {
  it("ID milik pengguna lain → 404", () => {
    const rows = parseRows("Transaksi", {
      header: [],
      rows: [
        { row: 2, values: ["TR-aaaaaaaa", "US-pemilika"] },
        { row: 3, values: ["TR-bbbbbbbb", "US-pemilikb"] },
      ],
    });
    expect(findOwned(rows, "TR-aaaaaaaa", "US-pemilika").row).toBe(2);
    expect(() => findOwned(rows, "TR-bbbbbbbb", "US-pemilika")).toThrowError(
      expect.objectContaining({ status: 404, title: "Data tidak ditemukan." }),
    );
    expect(() => findOwned(rows, "TR-tidakada", "US-pemilika")).toThrowError(expect.objectContaining({ status: 404 }));
  });
});

describe("profil, logout, CSRF", () => {
  it("ubah nama profil", async () => {
    const { client } = setupTest();
    const a = client();
    await a.post("/auth/setup", ADMIN);
    const res = await a.put("/auth/profil", { nama: "Nama Baru" });
    expect(res.body).toMatchObject({ nama: "Nama Baru" });
    expect((await a.get("/auth/me")).body.nama).toBe("Nama Baru");
  });

  it("logout menghapus cookie", async () => {
    const { client } = setupTest();
    const a = client();
    await a.post("/auth/setup", ADMIN);
    const res = await a.post("/auth/logout");
    expect(res.status).toBe(204);
    expect(a.cookie).toBe("");
    expect((await a.get("/auth/me")).status).toBe(401);
  });

  it("POST tanpa X-Requested-With → 403", async () => {
    const { client } = setupTest();
    const res = await client().post("/auth/setup", ADMIN, { csrf: false });
    expect(res.status).toBe(403);
  });

  it("tanpa login → 401", async () => {
    const { client } = setupTest();
    expect((await client().get("/auth/me")).status).toBe(401);
    expect((await client().get("/pengguna")).status).toBe(401);
  });
});
