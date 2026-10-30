import { auth, sheets, type sheets_v4 } from "@googleapis/sheets";
import { storageError } from "../common/errors.js";
import { lastColumn, type SheetName } from "./schema.js";
import { SheetMissingError, type CellValue, type RowUpdate, type SheetData, type SheetStore } from "./store.js";

export interface GoogleStoreOptions {
  spreadsheetId: string;
  clientEmail: string;
  privateKey: string;
}

const RETRY_DELAYS_MS = [500, 1000, 2000];

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function statusOf(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const e = err as { status?: unknown; code?: unknown; response?: { status?: unknown } };
  for (const v of [e.status, e.response?.status, e.code]) {
    if (typeof v === "number") return v;
  }
  return undefined;
}

/**
 * Jalankan panggilan Google dengan retry 3× (500 ms, 1 s, 2 s) untuk 429/5xx.
 * Error akhir diubah jadi 502 tanpa membocorkan detail ke client.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { clientEmail: string; sleep?: (ms: number) => Promise<void> },
): Promise<T> {
  const sleep = opts.sleep ?? defaultSleep;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = statusOf(err);
      const retryable = status === 429 || (status !== undefined && status >= 500 && status < 600);
      if (retryable && attempt < RETRY_DELAYS_MS.length) {
        await sleep(RETRY_DELAYS_MS[attempt]);
        continue;
      }
      if (status === 403) {
        console.error(`Spreadsheet belum di-share ke ${opts.clientEmail}`);
      } else {
        console.error(`Google Sheets gagal (status ${status ?? "?"}):`, err instanceof Error ? err.message : err);
      }
      throw storageError();
    }
  }
}

export class GoogleSheetStore implements SheetStore {
  private api: sheets_v4.Sheets;
  private spreadsheetId: string;
  private clientEmail: string;
  private sleep?: (ms: number) => Promise<void>;
  /** Metadata spreadsheet (judul → sheetId). Bukan data, aman disimpan lintas request. */
  private sheetIds?: Map<string, number>;

  constructor(opts: GoogleStoreOptions, deps: { api?: sheets_v4.Sheets; sleep?: (ms: number) => Promise<void> } = {}) {
    this.spreadsheetId = opts.spreadsheetId;
    this.clientEmail = opts.clientEmail;
    this.sleep = deps.sleep;
    this.api =
      deps.api ??
      sheets({
        version: "v4",
        auth: new auth.JWT({
          email: opts.clientEmail,
          key: opts.privateKey,
          scopes: ["https://www.googleapis.com/auth/spreadsheets"],
        }),
        retry: false, // retry ditangani withRetry
        timeout: 8000, // jaga di bawah batas durasi Vercel Function
      });
  }

  private call<T>(fn: () => Promise<T>): Promise<T> {
    return withRetry(fn, { clientEmail: this.clientEmail, sleep: this.sleep });
  }

  private async loadSheetIds(): Promise<Map<string, number>> {
    const res = await this.call(() =>
      this.api.spreadsheets.get({
        spreadsheetId: this.spreadsheetId,
        fields: "sheets.properties(sheetId,title)",
      }),
    );
    const map = new Map<string, number>();
    for (const s of res.data.sheets ?? []) {
      const p = s.properties;
      if (p?.title != null && p.sheetId != null) map.set(p.title, p.sheetId);
    }
    this.sheetIds = map;
    return map;
  }

  /** Pastikan semua sheet ada; metadata dimuat ulang sekali kalau ada yang belum dikenal. */
  private async ensureSheets(names: readonly SheetName[]): Promise<Map<string, number>> {
    let ids = this.sheetIds ?? (await this.loadSheetIds());
    if (names.some((n) => !ids.has(n)) && this.sheetIds) ids = await this.loadSheetIds();
    const missing = names.filter((n) => !ids.has(n));
    if (missing.length) throw new SheetMissingError(missing);
    return ids;
  }

  async readMany<S extends SheetName>(names: readonly S[]): Promise<Record<S, SheetData>> {
    await this.ensureSheets(names);
    const res = await this.call(() =>
      this.api.spreadsheets.values.batchGet({
        spreadsheetId: this.spreadsheetId,
        ranges: names.map((n) => `'${n}'`),
        valueRenderOption: "UNFORMATTED_VALUE",
        dateTimeRenderOption: "SERIAL_NUMBER",
        majorDimension: "ROWS",
      }),
    );
    const ranges = res.data.valueRanges ?? [];
    const result = {} as Record<S, SheetData>;
    names.forEach((name, i) => {
      const values = (ranges[i]?.values ?? []) as CellValue[][];
      const [header = [], ...rest] = values;
      result[name] = {
        header: header.map((h) => String(h ?? "")),
        rows: rest
          .map((v, idx) => ({ row: idx + 2, values: v ?? [] }))
          .filter((r) => r.values.some((v) => v !== "" && v != null)),
      };
    });
    return result;
  }

  async append(sheet: SheetName, rows: CellValue[][]): Promise<void> {
    if (!rows.length) return;
    await this.call(() =>
      this.api.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range: `'${sheet}'!A1:${lastColumn(sheet)}1`,
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: rows },
      }),
    );
  }

  async updateRow(sheet: SheetName, row: number, values: CellValue[]): Promise<void> {
    await this.call(() =>
      this.api.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `'${sheet}'!A${row}:${lastColumn(sheet)}${row}`,
        valueInputOption: "RAW",
        requestBody: { values: [values] },
      }),
    );
  }

  async updateRows(updates: readonly RowUpdate[]): Promise<void> {
    if (!updates.length) return;
    await this.call(() =>
      this.api.spreadsheets.values.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        requestBody: {
          valueInputOption: "RAW",
          data: updates.map((u) => ({
            range: `'${u.sheet}'!A${u.row}:${lastColumn(u.sheet)}${u.row}`,
            values: [u.values],
          })),
        },
      }),
    );
  }

  async deleteRow(sheet: SheetName, row: number): Promise<void> {
    const ids = await this.ensureSheets([sheet]);
    await this.call(() =>
      this.api.spreadsheets.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        requestBody: {
          requests: [
            {
              deleteDimension: {
                range: { sheetId: ids.get(sheet), dimension: "ROWS", startIndex: row - 1, endIndex: row },
              },
            },
          ],
        },
      }),
    );
  }
}
