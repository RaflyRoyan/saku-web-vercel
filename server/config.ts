import { z } from "zod";
import { GoogleSheetStore } from "./sheets/google-store";
import { FileSheetStore } from "./sheets/memory-store";
import type { SheetStore } from "./sheets/store";

const envSchema = z
  .object({
    SHEETS_MODE: z.enum(["memory", "google"], {
      error: "SHEETS_MODE harus 'memory' atau 'google'.",
    }).default("memory"),
    SPREADSHEET_ID: z.string().optional(),
    GOOGLE_CLIENT_EMAIL: z.string().optional(),
    GOOGLE_PRIVATE_KEY: z.string().optional(),
    JWT_SECRET: z
      .string({ error: "JWT_SECRET wajib diisi." })
      .min(32, { error: "JWT_SECRET minimal 32 karakter." }),
    JWT_EXPIRE_DAYS: z.coerce
      .number({ error: "JWT_EXPIRE_DAYS harus berupa angka." })
      .int({ error: "JWT_EXPIRE_DAYS harus bilangan bulat." })
      .positive({ error: "JWT_EXPIRE_DAYS harus lebih dari 0." })
      .default(30),
  })
  .superRefine((env, ctx) => {
    if (env.SHEETS_MODE !== "google") return;
    for (const key of ["SPREADSHEET_ID", "GOOGLE_CLIENT_EMAIL", "GOOGLE_PRIVATE_KEY"] as const) {
      if (!env[key]) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `${key} wajib diisi jika SHEETS_MODE=google.`,
        });
      }
    }
  })
  .transform((env) => ({
    ...env,
    // Private key dari env biasanya berisi "\n" literal
    GOOGLE_PRIVATE_KEY: env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  }));

export type AppConfig = z.infer<typeof envSchema>;

let cached: AppConfig | undefined;

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `- ${i.path.join(".") || "env"}: ${i.message}`)
      .join("\n");
    throw new Error(`Konfigurasi environment tidak valid:\n${detail}`);
  }
  return result.data;
}

export function getConfig(): AppConfig {
  cached ??= loadConfig();
  return cached;
}

export function createStore(config: AppConfig): SheetStore {
  // Mode memory hanya untuk dev lokal; data disimpan di .data/ (tidak di-commit)
  if (config.SHEETS_MODE === "memory") return new FileSheetStore(".data/saku-memory.json");
  // superRefine sudah memastikan ketiganya terisi saat SHEETS_MODE=google
  return new GoogleSheetStore({
    spreadsheetId: config.SPREADSHEET_ID!,
    clientEmail: config.GOOGLE_CLIENT_EMAIL!,
    privateKey: config.GOOGLE_PRIVATE_KEY!,
  });
}

let store: SheetStore | undefined;

/** Satu store per instance function. Mode memory: data hilang saat instance mati. */
export function getStore(): SheetStore {
  store ??= createStore(getConfig());
  return store;
}
