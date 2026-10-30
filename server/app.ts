import { Hono } from "hono";
import { DEFAULT_ITERATIONS } from "./auth/password.js";
import { csrf } from "./auth/session.js";
import type { Claims } from "./auth/token.js";
import { systemClock, type Clock } from "./common/clock.js";
import { problem, problemFromError } from "./common/errors.js";
import { getConfig, getStore } from "./config.js";
import { akun } from "./routes/akun.js";
import { auth } from "./routes/auth.js";
import { berulang } from "./routes/berulang.js";
import { dashboard } from "./routes/dashboard.js";
import { health } from "./routes/health.js";
import { kategori } from "./routes/kategori.js";
import { pengguna } from "./routes/pengguna.js";
import { periode } from "./routes/periode.js";
import { tabungan } from "./routes/tabungan.js";
import { transaksi } from "./routes/transaksi.js";
import type { SheetStore } from "./sheets/store.js";

export interface Settings {
  jwtSecret: string;
  jwtExpireDays: number;
  passwordIterations: number;
}

export interface AppDeps {
  /** Lazy supaya `/api/health` tidak butuh env/Google. */
  store: () => SheetStore;
  clock: Clock;
  settings: () => Settings;
}

export type AppEnv = { Variables: AppDeps & { claims?: Claims } };

const envSettings = (): Settings => {
  const config = getConfig();
  return { jwtSecret: config.JWT_SECRET, jwtExpireDays: config.JWT_EXPIRE_DAYS, passwordIterations: DEFAULT_ITERATIONS };
};

/** Test memakai `createApp({ store: () => new MemorySheetStore(), clock: new FakeClock(...), settings })`. */
export function createApp(deps: Partial<AppDeps> = {}) {
  const resolved: AppDeps = {
    store: deps.store ?? getStore,
    clock: deps.clock ?? systemClock,
    settings: deps.settings ?? envSettings,
  };
  const app = new Hono<AppEnv>().basePath("/api");

  app.use(async (c, next) => {
    c.set("store", resolved.store);
    c.set("clock", resolved.clock);
    c.set("settings", resolved.settings);
    await next();
  });
  app.use(csrf);

  app.route("/health", health);
  app.route("/auth", auth);
  app.route("/pengguna", pengguna);
  app.route("/akun", akun);
  app.route("/kategori", kategori);
  app.route("/periode", periode);
  app.route("/transaksi", transaksi);
  app.route("/tabungan", tabungan);
  app.route("/berulang", berulang);
  app.route("/dashboard", dashboard);

  app.notFound((c) => problem(c, 404, "Endpoint tidak ditemukan."));
  app.onError((err, c) => problemFromError(c, err));

  return app;
}

export const app = createApp();
