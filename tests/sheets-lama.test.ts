// Tooling spreadsheet lama (dipakai skrip migrasi ke Supabase) + helper umum id & clock.
import { describe, it, expect, vi } from "vitest";
import { FakeClock, nowWibIso, todayWib } from "../server/common/clock";
import { AppError } from "../server/common/errors";
import { generateId } from "../server/common/id";
import { withRetry } from "../scripts/sheets-lama/google-store";
import { ID_PREFIX, NAMA_TABEL } from "../server/db/schema";
import { columnLetter, headerOf, lastColumn } from "../scripts/sheets-lama/schema";

describe("schema split bill", () => {
  it("4 tabel baru dengan prefix ID & urutan kolom", () => {
    for (const s of ["SplitBill", "SplitItem", "SplitPeserta", "Pengaturan"]) expect(NAMA_TABEL).toContain(s);
    expect(headerOf("SplitPeserta")).toEqual(["id", "user_id", "split_id", "nama", "saya", "nominal", "lunas", "transaksi_id", "urutan", "created_by", "created_at", "updated_by", "updated_at"]);
    expect(ID_PREFIX).toMatchObject({ SplitBill: "SB", SplitItem: "SI", SplitPeserta: "SP", Pengaturan: "PG", TagihanQris: "TQ" });
    expect(headerOf("TagihanQris")).toEqual(["id", "user_id", "tanggal", "nominal", "keterangan", "akun_id", "kategori_id", "lunas", "transaksi_id", "created_by", "created_at", "updated_by", "updated_at"]);
  });
});

describe("withRetry", () => {
  const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });

  it("retry 3× untuk 429/5xx dengan backoff 500 ms, 1 s, 2 s", async () => {
    const sleep = vi.fn(async () => {});
    const fn = vi
      .fn()
      .mockRejectedValueOnce(httpError(429))
      .mockRejectedValueOnce(httpError(503))
      .mockRejectedValueOnce(httpError(500))
      .mockResolvedValue("ok");
    await expect(withRetry(fn, { clientEmail: "sa@x", sleep })).resolves.toBe("ok");
    expect(sleep.mock.calls).toEqual([[500], [1000], [2000]]);
  });

  it("menyerah setelah 3 retry → 502", async () => {
    const fn = vi.fn().mockRejectedValue(httpError(500));
    const err: unknown = await withRetry(fn, { clientEmail: "sa@x", sleep: async () => {} }).catch((e) => e);
    expect(fn).toHaveBeenCalledTimes(4);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).status).toBe(502);
  });

  it("403 tidak di-retry dan log 'belum di-share'", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const fn = vi.fn().mockRejectedValue(httpError(403));
    await expect(withRetry(fn, { clientEmail: "sa@proyek.iam", sleep: async () => {} })).rejects.toMatchObject({ status: 502 });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("Spreadsheet belum di-share ke sa@proyek.iam");
    log.mockRestore();
  });
});

describe("id & clock", () => {
  it("ID = prefix + 8 karakter a-z2-7, cek tabrakan", () => {
    expect(generateId("TR")).toMatch(/^TR-[a-z2-7]{8}$/);
    const taken = new Set<string>();
    let calls = 0;
    const id = generateId("AK", (x) => {
      calls++;
      if (calls === 1) {
        taken.add(x);
        return true;
      }
      return taken.has(x);
    });
    expect(calls).toBe(2);
    expect(taken.has(id)).toBe(false);
  });

  it("tanggal dihitung di WIB", () => {
    const clock = new FakeClock("2026-10-29T18:30:00Z"); // 01:30 WIB tanggal 30
    expect(todayWib(clock)).toBe("2026-10-30");
    expect(nowWibIso(clock)).toBe("2026-10-30T01:30:00+07:00");
    clock.advance(24 * 60 * 60 * 1000);
    expect(todayWib(clock)).toBe("2026-10-31");
  });

  it("huruf kolom", () => {
    expect(columnLetter(0)).toBe("A");
    expect(columnLetter(25)).toBe("Z");
    expect(columnLetter(26)).toBe("AA");
    expect(lastColumn("Transaksi")).toBe("Q");
    expect(lastColumn("Pengguna")).toBe("N");
  });
});
