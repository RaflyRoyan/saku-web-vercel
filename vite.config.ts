import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import devServer from "@hono/vite-dev-server";
import { VitePWA } from "vite-plugin-pwa";
import pkg from "./package.json" with { type: "json" };

export default defineConfig(({ mode }) => {
  // Dev lokal: API Hono jalan di dalam server Vite. server/config.ts membaca env dari process.env,
  // jadi isi .env dimasukkan ke sana (env yang sudah ada di shell tetap menang).
  Object.assign(process.env, { ...loadEnv(mode, process.cwd(), ""), ...process.env });

  return {
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
    plugins: [
      // Hanya /api/* yang ditangani Hono; sisanya tetap dilayani Vite
      devServer({ entry: "server/app.ts", export: "app", exclude: [/^(?!\/api\/).*/] }),
      react(),
      tailwindcss(),
      VitePWA({
        // "prompt": versi baru menunggu konfirmasi lewat banner, supaya isian form tidak hilang karena reload otomatis
        registerType: "prompt",
        includeAssets: ["favicon.ico", "apple-touch-icon-180x180.png"],
        manifest: {
          id: "/",
          name: "Saku",
          short_name: "Saku",
          description: "Pencatatan keuangan pribadi",
          lang: "id",
          start_url: "/",
          scope: "/",
          display: "standalone",
          orientation: "portrait",
          categories: ["finance"],
          background_color: "#fffaf5",
          theme_color: "#c2410c",
          icons: [
            { src: "pwa-64x64.png", sizes: "64x64", type: "image/png" },
            { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
            { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
            { src: "maskable-icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          ],
        },
        workbox: {
          navigateFallbackDenylist: [/^\/api\//], // data API tidak pernah di-cache
        },
      }),
    ],
  };
});
