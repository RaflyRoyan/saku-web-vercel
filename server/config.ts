import { z } from "zod";
import { createSql } from "./db/client.js";
import { PostgresStore, type Store } from "./db/store.js";

const envSchema = z.object({
  DATABASE_URL: z
    .string({ error: "DATABASE_URL wajib diisi." })
    .regex(/^postgres(ql)?:\/\//, { error: "DATABASE_URL harus diawali postgresql://." }),
  JWT_SECRET: z
    .string({ error: "JWT_SECRET wajib diisi." })
    .min(32, { error: "JWT_SECRET minimal 32 karakter." }),
  JWT_EXPIRE_DAYS: z.coerce
    .number({ error: "JWT_EXPIRE_DAYS harus berupa angka." })
    .int({ error: "JWT_EXPIRE_DAYS harus bilangan bulat." })
    .positive({ error: "JWT_EXPIRE_DAYS harus lebih dari 0." })
    .default(30),
});

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

let store: Store | undefined;

/** Satu koneksi database per instance function, dipakai ulang antar-request. */
export function getStore(): Store {
  store ??= new PostgresStore(createSql(getConfig().DATABASE_URL));
  return store;
}
